import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { AppError, now } from './store.mjs';
import { creativeHash } from './creative-store.mjs';
import { CanvasVideoAuthority } from './canvas-authorization.mjs';
import { createCanvasExecutionAdapter } from './canvas-execution.mjs';
import { readCanvasVideoEvidence, sanitizeCanvasReceipt, sanitizeCanvasDiagnostic } from './canvas-video.mjs';
import { probeVideo, stripVideoAudio } from './video-media.mjs';

const clone = value => structuredClone(value);
const safe = error => sanitizeCanvasDiagnostic(String(error?.message ?? error)).slice(0, 6000);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const frozen = task => creativeHash({ id: task.id, projectId: task.projectId, shotId: task.shotId, binding: task.binding, inputSnapshotHash: task.inputSnapshotHash, plan: task.plan, authorizationBinding: task.authorizationBinding, submitId: task.submitId, redoOfTaskId: task.redoOfTaskId });

export function defaultCanvasVideoPlan(evidence = readCanvasVideoEvidence()) {
  const { prompt, references: _references, ...parameters } = evidence.parameters ?? {};
  return { projectId: evidence.canvas?.projectId, nodeId: evidence.canvas?.nodeId, sourceNodeId: evidence.canvas?.sourceNodeId, sourceResourceId: evidence.canvas?.sourceResourceId, inputSha256: evidence.input?.sha256, registeredResourceSha256: evidence.input?.registeredResource?.downloadSha256, prompt, parameters };
}

/** Persistent one-node execution. No HTTP method can issue an operator approval. */
export class CanvasVideoService {
  constructor(store, { videos, adapter, authority, probe = probeVideo, stripAudio = stripVideoAudio, evidence, timeoutMs = 120000, recoverPending = true } = {}) {
    this.store = store; this.workspace = videos.workspace ?? videos; this.authority = authority ?? new CanvasVideoAuthority(store); this.probe = probe; this.stripAudio = stripAudio; this.timeoutMs = timeoutMs; this.evidence = evidence ?? readCanvasVideoEvidence();
    this.mode = adapter ? 'isolated-fixture' : 'official-dreamina-canvas'; this.active = new Map(); this.closed = false;
    this.adapter = adapter ?? createCanvasExecutionAdapter({ verifyAuthorization: (grant, binding, options = {}) => this.authority.verify(grant, binding, { submitId: options.submitId, allowClaimed: true }) });
    for (const name of ['canvas-video-jobs', 'runtime/canvas-video']) fs.mkdirSync(path.join(store.root, name), { recursive: true });
    if (recoverPending) for (const task of this.list().values) if (['submitting', 'querying_active', 'downloading'].includes(task.status)) { task.status = task.submittedAt ? 'interrupted' : 'prepared'; task.error = '服务重启，只能查询原submitId或恢复下载，不自动确认或重新生成。'; this.record(task, 'restart.recovered', task.error); }
  }
  list() {
    const values = [], warnings = [];
    for (const file of fs.readdirSync(path.join(this.store.root, 'canvas-video-jobs')).filter(file => file.endsWith('.json'))) {
      try { const task = this.store.read('canvas-video-jobs', file.slice(0, -5)); if (!task.plan || !Array.isArray(task.events) || !task.submitId || typeof task.updatedAt !== 'string') throw new Error(); values.push(task); }
      catch { warnings.push(`画布视频任务${file}损坏；原件保留，不能核实次数，停止新提交。`); }
    }
    values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); return { values, warnings };
  }
  read(id) { return this.store.read('canvas-video-jobs', id); }
  record(task, type, message) { task.updatedAt = now(); task.message = safe(message); task.events.push({ at: task.updatedAt, type, message: task.message }); return this.store.write('canvas-video-jobs', task); }
  assertTask(task, { current = true } = {}) {
    if (frozen(task) !== task.fingerprint || creativeHash(task.binding) !== task.bindingHash || creativeHash(task.inputSnapshot) !== task.inputSnapshotHash || creativeHash(task.authorizationBinding?.scope) !== task.authorizationBinding?.scopeHash || task.plan.taskId !== task.id || task.plan.localProjectId !== task.projectId || task.plan.localBindingHash !== task.bindingHash || task.plan.inputSnapshotHash !== task.inputSnapshotHash || task.plan.inputSha256 !== task.binding.imageSha256) throw new AppError('原画布任务输入、批准范围或Hash不一致；保留旧记录，不重新绑定。', 409);
    return current ? this.workspace.assertBinding(task.projectId, task.binding) : null;
  }
  quoteGate(quote) {
    if (!['quoted_snapshot', 'known'].includes(quote?.status) || quote.currency !== 'CREDITS' || !Number.isInteger(quote.amount) || quote.amount < 0 || quote.amount !== quote.totalMaxCredits || !quote.requestId) throw new AppError('缺少同节点的完整最新最大积分预估；未知不是免费。', 409);
    if (quote.amount > 70) throw new AppError('最新最大预估超过70积分批准阈值，不能确认消费或提交。', 409);
  }
  async inspect(task) {
    const result = await this.adapter.inspectPlan(task.plan, { onReceipt: receipt => this.receipt(task.id, 'inspect.cli', receipt) });
    if (creativeHash(result.authorizationBinding?.scope) !== result.authorizationBinding?.scopeHash) throw new AppError('当前节点范围Hash无效。', 409);
    return result;
  }
  taskView(task) {
    let stale = Boolean(task.externalStale), inputValidationError = task.externalValidationError ?? null;
    try { this.assertTask(task); } catch (error) { stale = true; inputValidationError = error.message; }
    const authorization = this.authority.publicStatus(task.id, task.authorizationBinding);
    return { ...task, stale, inputValidationError, authorization, canSubmit: !stale && !task.quoteError && task.status === 'prepared' && authorization.status === 'approved' && task.quote?.amount <= 70 };
  }
  view(projectId) {
    const list = this.list(), tasks = list.values.filter(task => task.projectId === projectId).map(task => this.taskView(task));
    return { ...this.workspace.view(projectId), tasks, bindingPlan: defaultCanvasVideoPlan(this.evidence), approvalEstimateThreshold: 70, authorization: { status: tasks.some(task => task.authorization.status === 'approved') ? 'task_approval_available' : 'not_granted', reason: '只有本机记录本人对当前范围的明确批准后才可消费；请求参数不能授权。' }, capability: { executionMode: this.mode, executionEnabled: tasks.some(task => task.canSubmit) && !list.warnings.length, authorizationMode: 'local-signed-task-approval', message: `${tasks.some(task => task.submittedAt) ? '已有提交意图，按原submitId及实际回执恢复。' : '尚无外部提交意图，待本人明确批准。'}70仅为最大预估批准阈值，不是最终结算或平台绝对扣费上限。` }, historyWarnings: list.warnings, formalStageStatus: 'not_checked' };
  }
  exclusive(key, kind, operation) {
    if (this.closed) return Promise.reject(new AppError('服务正在关闭。', 503));
    if (this.active.has(key)) return this.active.get(key).kind === kind ? this.active.get(key).promise : Promise.reject(new AppError('原任务正在处理，不并行执行其他操作。', 409));
    const run = { key, kind, controller: new AbortController() }; run.promise = Promise.resolve().then(() => operation(run)).finally(() => this.active.delete(key)); this.active.set(key, run); return run.promise;
  }
  prepare(projectId, input) {
    return this.exclusive(`prepare:${projectId}`, creativeHash(input), async () => {
      const workspace = this.workspace.get(projectId); this.workspace.check(workspace, input.revision);
      const source = this.workspace.source(projectId, input.shotId, input.imageAssetId), defaultPlan = defaultCanvasVideoPlan(this.evidence);
      if (this.mode !== 'isolated-fixture' && input.plan && creativeHash(input.plan) !== creativeHash(defaultPlan)) throw new AppError('本次真实范围只允许已验证的测试首帧与同一画布节点，不接受客户端另造来源绑定。', 409);
      const base = clone(input.plan ?? defaultPlan);
      if (base.inputSha256 !== source.image.sha256 || base.parameters?.durationSeconds !== 5 || base.parameters?.resolution !== '720p' || base.parameters?.outputCount !== 1 || base.parameters?.audioMode !== 'mute_derivative') throw new AppError('本次仅准备同一有效测试首帧、5秒720p/count1及后处理无声交付。', 409);
      const prepFingerprint = creativeHash({ projectId, binding: source.binding, plan: base, redoOfTaskId: input.redoOfTaskId ?? null });
      if (this.list().warnings.length) throw new AppError('任务历史损坏，停止准备新提交。', 409);
      const existing = this.list().values.find(task => task.prepFingerprint === prepFingerprint); if (existing) return this.taskView(existing);
      if (input.redoOfTaskId) { const previous = this.read(input.redoOfTaskId); if (previous.projectId !== projectId || previous.shotId !== input.shotId) throw new AppError('重做引用不属于本项目镜头。', 409); }
      const id = randomUUID(), submitId = randomUUID(), snapshot = clone(source.snapshot);
      const plan = { ...base, localProjectId: projectId, taskId: id, localBindingHash: source.bindingHash, inputSnapshotHash: creativeHash(snapshot) };
      const pendingReceipts = [];
      const inspection = await this.adapter.inspectPlan(plan, { onReceipt: receipt => pendingReceipts.push(receipt) });
      if (this.closed) throw new AppError('服务关闭，未保存新准备任务。', 503);
      this.workspace.check(this.workspace.get(projectId), input.revision); this.workspace.assertBinding(projectId, source.binding);
      const timestamp = now(), task = { id, projectId, shotId: input.shotId, imageAssetId: source.image.id, submitId, externalTaskId: null, prepFingerprint, plan, parameters: { ...plan.parameters, motionPrompt: plan.prompt }, binding: source.binding, bindingHash: source.bindingHash, inputSnapshot: snapshot, inputSnapshotHash: creativeHash(snapshot), authorizationBinding: clone(inspection.authorizationBinding), draftVersion: inspection.readback?.draftVersion ?? inspection.authorizationBinding.scope.draftVersion, quote: clone(inspection.quote), quoteHistory: [], status: 'prepared', providerStatus: null, executionMode: this.mode, provider: 'dreamina-canvas-node-video', redoOfTaskId: input.redoOfTaskId ?? null, submittedAt: null, result: null, cost: { estimatedMaximum: inspection.quote.amount, actualAmount: null, currency: 'CREDITS', finalSettlementVerified: false }, receipts: [], events: [], error: null, queryError: null, downloadError: null, createdAt: timestamp, updatedAt: timestamp, formalStageStatus: 'not_checked' };
      task.fingerprint = frozen(task); this.store.write('canvas-video-jobs', task); for (const receipt of pendingReceipts) this.receipt(task.id, 'prepare.cli', receipt); this.receipt(task.id, 'prepare.inspect', inspection); return this.taskView(this.read(id));
    });
  }
  receipt(id, stage, value) {
    const directory = path.join(this.store.root, 'runtime', 'canvas-video', id); fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${stage}-${Date.now()}-${randomUUID()}.json`);
    fs.writeFileSync(file, JSON.stringify(sanitizeCanvasReceipt(value), null, 2), { flag: 'wx' });
    const task = this.read(id); task.receipts.push({ stage, at: now(), path: path.relative(this.store.root, file) }); this.store.write('canvas-video-jobs', task);
  }
  async timed(run, operation) {
    if (run.controller.signal.aborted || this.closed) throw new AppError('本地等待已中断，保留原任务。', 409);
    let timer, abort; const interrupted = new Promise((_, reject) => { abort = () => reject(new Error('本地等待中断，保留原submitId，不重复生成。')); run.controller.signal.addEventListener('abort', abort, { once: true }); timer = setTimeout(() => { run.controller.abort(); reject(new Error('本地等待超时，只查询原submitId或恢复下载。')); }, this.timeoutMs); });
    try { return await Promise.race([Promise.resolve().then(operation), interrupted]); } finally { clearTimeout(timer); run.controller.signal.removeEventListener('abort', abort); }
  }
  invoke(run, stage, input) {
    if (run.controller.signal.aborted || this.closed) return Promise.reject(new AppError('原操作已取消，未启动下一步。', 409));
    // Keep even late sanitized receipts. A late success never changes task state
    // after timeout/cancel/restart and never creates a second submission.
    const request = Promise.resolve().then(() => this.adapter[stage]({ ...input, signal: run.controller.signal, onReceipt: receipt => this.receipt(run.key, `cli.${stage}`, receipt) })).then(value => { this.receipt(run.key, stage, value); return value; }, error => { this.receipt(run.key, `${stage}.error`, { error: safe(error) }); throw error; });
    return this.timed(run, () => request);
  }
  refresh(id) {
    return this.exclusive(id, 'refresh', async () => {
      let task = this.read(id); this.assertTask(task); if (task.submittedAt) return this.taskView(task);
      let inspection;
      try { inspection = await this.inspect(task); }
      catch (error) { task = this.read(id); task.quoteError = safe(error); this.record(task, 'quote.refresh_failed', task.quoteError); throw error; }
      this.receipt(id, 'refresh.inspect', inspection); task = this.read(id); task.quoteError = null;
      task.quoteHistory.push(task.quote); task.quote = clone(inspection.quote);
      task.externalStale = inspection.authorizationBinding.scopeHash !== task.authorizationBinding.scopeHash;
      task.externalValidationError = task.externalStale ? '当前草稿版本、账户、节点或参数范围改变；原批准不能覆盖，请保留旧任务并重新准备。' : null;
      this.record(task, 'quote.refreshed', '已读取同节点最新预估；报价不是本人授权或实际扣费。'); return this.taskView(task);
    });
  }
  async preflight(id) {
    const task = this.read(id); this.assertTask(task);
    try {
      const inspection = await this.inspect(task);
      this.assertTask(this.read(id));
      if (inspection.authorizationBinding.scopeHash !== task.authorizationBinding.scopeHash) throw new AppError('草稿版本、节点、输入、账户或参数已经改变，原范围失效。', 409);
      this.quoteGate(inspection.quote);
      const latest = this.read(id); if (latest.quoteError) { latest.quoteError = null; this.record(latest, 'quote.revalidated', '当前同节点报价及范围已重新核实。'); }
      return { task: this.read(id), inspection };
    } catch (error) { const latest = this.read(id); latest.quoteError = safe(error); this.record(latest, 'preflight.blocked', latest.quoteError); throw error; }
  }
  submit(id) {
    return this.exclusive(id, 'submit', async run => {
      let task = this.read(id); if (task.submittedAt) return this.taskView(task);
      if (task.status !== 'prepared') throw new AppError('任务已取消或中断，不重新提交。', 409);
      const { inspection } = await this.preflight(id); const grant = this.authority.find(id); this.authority.verify(grant, inspection.authorizationBinding);
      if (this.list().warnings.length || this.list().values.some(other => other.id !== id && other.submittedAt && other.plan.projectId === task.plan.projectId && other.plan.nodeId === task.plan.nodeId)) throw new AppError('同一节点已有提交意图或次数历史不完整，只能恢复原任务，不能重复生成。', 409);
      this.assertTask(task); if (run.controller.signal.aborted || this.closed || this.read(id).status !== 'prepared') throw new AppError('消费确认前已取消或服务关闭。', 409);
      const claimed = this.authority.claim(grant, inspection.authorizationBinding, task.submitId);
      task = this.read(id); task.submittedAt = now(); task.externalTaskId = task.submitId; task.status = 'submitting'; task.quoteHistory.push(task.quote); task.quote = clone(inspection.quote); task.cost.estimatedMaximum = inspection.quote.amount;
      this.record(task, 'submit.intent', '稳定submitId与唯一提交意图先落盘；批准阈值不是最终扣费，未知结果不重提。');
      const check = async () => { const current = this.read(id); if (this.closed || run.controller.signal.aborted || current.status !== 'submitting') throw new AppError('消费/运行前已取消或中断。', 409); this.assertTask(current); return this.authority.verify(claimed, current.authorizationBinding, { submitId: current.submitId, allowClaimed: true }); };
      try {
        const result = await this.invoke(run, 'submit', { plan: task.plan, submitId: task.submitId, authorization: claimed, beforeConfirm: check, beforeRun: check });
        task = this.read(id); if (this.closed || run.controller.signal.aborted || task.status !== 'submitting') return this.taskView(task);
        this.accept(task, result); return this.taskView(this.record(task, 'submit.receipt', '已保存原任务回执；受理不是生成成功。'));
      } catch (error) { task = this.read(id); if (!['cancelled', 'interrupted'].includes(task.status)) { task.status = 'submission_unknown'; task.error = safe(error); this.record(task, 'submit.unknown', task.error); } return this.taskView(task); }
    });
  }
  accept(task, result) {
    if (result?.submitId !== task.submitId || !['querying', 'success', 'fail', 'unknown'].includes(result.status)) throw new Error('回执缺少原submitId或可核实状态，只能查询原身份。');
    task.providerStatus = result.status; if (result.resourceId) task.resourceId = result.resourceId;
    if (result.generationDiff !== undefined) task.generationDiff = clone(result.generationDiff);
    if (result.status === 'success' && !task.resourceId) throw new Error('成功状态没有本次视频资源身份，不能导入候选。');
    task.status = result.status === 'success' ? task.result ? 'succeeded' : 'download_ready' : result.status === 'fail' ? 'failed' : result.status === 'unknown' ? 'submission_unknown' : 'querying'; task.error = result.status === 'fail' ? safe(result.error ?? '平台原任务失败。') : null;
  }
  query(id) {
    return this.exclusive(id, 'query', async run => {
      let task = this.read(id); this.assertTask(task, { current: false }); if (!task.submittedAt) throw new AppError('尚未提交，没有真实外部任务可查询。', 409);
      try { const result = await this.invoke(run, 'query', { plan: task.plan, submitId: task.submitId }); task = this.read(id); if (this.closed || run.controller.signal.aborted) return this.taskView(task); const cancelled = task.status === 'cancelled'; this.accept(task, result); task.queryError = null; if (cancelled) task.status = 'cancelled'; return this.taskView(this.record(task, 'query.receipt', '只查询原submitId，未再次确认或运行。')); }
      catch (error) { task = this.read(id); task.queryError = safe(error); if (!['cancelled', 'interrupted'].includes(task.status)) task.status = 'query_failed'; return this.taskView(this.record(task, 'query.failed', task.queryError)); }
    });
  }
  download(id) {
    return this.exclusive(id, 'download', async run => {
      let task = this.read(id); this.assertTask(task, { current: false }); if (!task.submittedAt || task.providerStatus !== 'success' || !task.resourceId) throw new AppError('须先查询原任务成功终态与具体视频资源。', 409);
      if (task.result?.assetId) { try { this.workspace.file(task.projectId, task.result.assetId); return this.taskView(task); } catch { /* Explicit recovery of missing candidate bytes only. */ } }
      task.status = 'downloading'; this.record(task, 'download.intent', '只恢复原成功资源下载，原片保留；有音轨时生成本地静音派生。');
      try {
        const directory = path.join(this.store.root, 'runtime', 'canvas-video', id, `download-${randomUUID()}`); fs.mkdirSync(directory, { recursive: true });
        const result = await this.invoke(run, 'download', { plan: task.plan, submitId: task.submitId, resourceId: task.resourceId, cwd: directory, outputPath: path.join(directory, 'original.mp4') });
        if (result?.submitId !== task.submitId || result.resourceId !== task.resourceId || result.status !== 'success' || !path.isAbsolute(result.path ?? '')) throw new Error('未获得原任务原资源的实际下载文件。');
        if (this.mode !== 'isolated-fixture') { const normalize = value => fs.realpathSync.native(value).toLowerCase(); if (!normalize(result.path).startsWith(normalize(directory) + path.sep)) throw new Error('下载结果不在本任务受控目录。'); }
        const original = await this.probe(result.path, { signal: run.controller.signal });
        let file = result.path, probe = original, derivative = null;
        if (original.hasAudio) { file = path.join(directory, 'silent-derivative.mp4'); probe = await this.stripAudio(result.path, file, { confirmed: true, signal: run.controller.signal, probe: this.probe }); derivative = { kind: 'local_audio_removed', parentSha256: original.sha256, sha256: probe.sha256, originalRetained: true, nativeSilent: false }; }
        if (probe.audioStreams !== 0 || probe.width !== 1280 || probe.height !== 720 || Math.abs(probe.durationSeconds - 5) > 0.5) throw new Error('实际视频未满足5秒720p无音轨交付；原片和诊断保留，不自动通过。');
        if (this.closed || run.controller.signal.aborted || this.read(id).status !== 'downloading') return this.taskView(this.read(id));
        task = this.read(id); this.assertTask(task, { current: false }); const bytes = fs.readFileSync(file); if (sha(bytes) !== probe.sha256) throw new Error('导入前实际文件Hash变化。');
        const asset = this.workspace.importCandidate(task.projectId, { task, bytes, probe, provenance: { channel: 'dreamina-canvas-node-video', original: { relativePath: path.relative(this.store.root, result.path), sha256: original.sha256, probe: original }, derivative, canvasProjectId: task.plan.projectId, nodeId: task.plan.nodeId, resourceId: task.resourceId, submitId: task.submitId, generationDiff: clone(task.generationDiff ?? null), referenceConformity: 'not_reviewed', effectiveGenerationEvidence: task.generationDiff === undefined ? 'not_returned' : 'returned_difference_record_only' } });
        task.result = { assetId: asset.id, sha256: asset.sha256, probe, originalSha256: original.sha256, originalRelativePath: path.relative(this.store.root, result.path), originalProbe: original, derivative, automaticallySelected: false, sourceBoundToOriginalInput: true }; task.status = 'succeeded'; task.downloadError = null; task.error = null;
        return this.taskView(this.record(task, 'candidate.imported', this.mode === 'isolated-fixture' ? '仅TEST隔离视频候选，非真实AI生成；人工检查和选用尚未完成。' : '原成功视频已下载并核验，静音交付候选待人工检查；不自动认定首帧或画面合格。'));
      } catch (error) { task = this.read(id); task.downloadError = safe(error); if (!['cancelled', 'interrupted'].includes(task.status)) task.status = 'download_failed'; return this.taskView(this.record(task, 'download.failed', task.downloadError)); }
    });
  }
  cancel(id) { const task = this.read(id); if (['succeeded', 'failed'].includes(task.status)) return this.taskView(task); this.active.get(id)?.controller.abort(); task.status = 'cancelled'; return this.taskView(this.record(task, 'cancel.local', '仅取消本地等待，不证明远端取消或退款；不重提生成。')); }
  originalFile(id) { const task = this.read(id); this.assertTask(task, { current: false }); const relative = task.result?.originalRelativePath, prefix = path.join('runtime', 'canvas-video', id) + path.sep; if (typeof relative !== 'string' || !relative.startsWith(prefix) || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new AppError('原片记录不存在或路径绑定异常。', 404); const file = path.join(this.store.root, relative); let bytes; try { bytes = fs.readFileSync(file); } catch { throw new AppError('原片文件缺失，记录保留。', 404); } if (sha(bytes) !== task.result.originalSha256) throw new AppError('原片Hash改变，停止下载。', 409); return { path: file, bytes, mimeType: task.result.originalProbe.mimeType, name: `${task.executionMode === 'isolated-fixture' ? 'TEST-NOT-AI-' : ''}original-${task.submitId}.mp4` }; }
  close() { this.closed = true; for (const [key, run] of this.active) { run.controller.abort(); if (!key.startsWith('prepare:')) { const task = this.read(key); if (!['succeeded', 'failed', 'cancelled'].includes(task.status)) { task.status = 'interrupted'; this.record(task, 'service.closed', '原身份保留，不自动确认或重新提交。'); } } } }
}
