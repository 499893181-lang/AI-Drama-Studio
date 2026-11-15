import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, now } from './store.mjs';
import { creativeHash } from './creative-store.mjs';
import { VideoWorkspace } from './video-store.mjs';
import { createDreaminaVideoAdapter } from './dreamina-video.mjs';
import { probeVideo } from './video-media.mjs';
import { redact } from './tools.mjs';

const clone = value => structuredClone(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const safe = error => redact(String(error?.message ?? error ?? '操作失败')).slice(0, 6000);
const externalId = value => typeof value === 'string' && value.trim().length > 0 && value.length < 240 && !/[\x00-\x1f]/.test(value);
export const videoQuoteFingerprint = quote => creativeHash({ status: quote?.status, amount: quote?.amount, currency: quote?.currency, billingType: quote?.billingType, unit: quote?.unit, basis: quote?.basis, sources: quote?.sources, conditions: quote?.conditions, expiresAt: quote?.expiresAt, evidenceId: quote?.evidenceId, officialQuoteId: quote?.officialQuoteId, channel: quote?.channel, canSubmit: quote?.canSubmit });
const unknownQuote = reason => ({ status: 'unknown', amount: null, currency: 'CREDITS', canSubmit: false, basis: reason, sources: [], conditions: [], expiresAt: null, channel: 'dreamina-cli-image2video' });

export class VideoService {
  constructor(store, { images, adapter, probe = probeVideo, timeoutMs = 120000 } = {}) {
    this.store = store; this.workspace = new VideoWorkspace(store, { images }); this.adapter = adapter ?? createDreaminaVideoAdapter(); this.probe = probe; this.timeoutMs = timeoutMs;
    // Custom adapters are always test/integration injections, even if their
    // caller forgets a fixture label. Only our native factory can label results.
    this.mode = adapter ? 'isolated-fixture' : 'official-dreamina-cli'; this.active = new Map(); this.closed = false;
    for (const name of ['video-jobs', 'runtime/video-generation']) fs.mkdirSync(path.join(store.root, name), { recursive: true });
    for (const job of this.list().values) if (['submitting', 'querying', 'downloading'].includes(job.status)) {
      job.status = job.externalTaskId ? 'interrupted' : 'submission_unknown'; job.error = job.externalTaskId ? '服务重启；保留原外部任务号，只能查询或重试下载，不自动重提。' : '提交结果未知，服务重启后不自动重提；先核对原回执与官方任务历史。';
      this.record(job, 'restart.recovered', job.error);
    }
  }
  list() {
    const values = [], warnings = [];
    for (const name of fs.readdirSync(path.join(this.store.root, 'video-jobs')).filter(name => name.endsWith('.json'))) {
      try { const job = this.store.read('video-jobs', name.slice(0, -5)); if (typeof job.updatedAt !== 'string' || !job.projectId || !Array.isArray(job.events)) throw new Error(); values.push(job); }
      catch { warnings.push(`视频任务${name}损坏，原件保留；提交历史未完整核实，停止新提交。`); }
    }
    values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); return { values, warnings };
  }
  read(id) { return this.store.read('video-jobs', id); }
  assertTask(task, { current = true } = {}) {
    const fingerprint = creativeHash({ projectId: task.projectId, binding: task.binding, parameters: task.parameters, creditsBudget: task.creditsBudget, quote: videoQuoteFingerprint(task.quote), redoOfTaskId: task.redoOfTaskId });
    if (task.bindingHash !== creativeHash(task.binding) || task.inputSnapshotHash !== creativeHash(task.inputSnapshot) || task.quoteFingerprint !== videoQuoteFingerprint(task.quote) || task.fingerprint !== fingerprint || task.inputSnapshot?.sourceHash !== task.binding?.sourceHash || task.inputSnapshot?.sourceVersion !== task.binding?.storyboardVersion) throw new AppError('原视频任务输入快照、参数或Hash绑定不一致，原记录保留，不能执行或重绑。', 409);
    return current ? this.workspace.assertBinding(task.projectId, task.binding) : null;
  }
  record(job, type, message) { job.updatedAt = now(); job.message = safe(message); job.events.push({ at: job.updatedAt, type, message: job.message }); return this.store.write('video-jobs', job); }
  async inspect() {
    try { return await this.adapter.inspect(); }
    catch (error) { return { canSubmit: false, realSubmissionEnabled: false, contractVerified: false, auth: { loggedIn: false }, models: [], defaults: {}, error: safe(error), message: safe(error) }; }
  }
  async view(projectId) {
    const workspace = this.workspace.view(projectId), capability = await this.inspect(), list = this.list();
    const tasks = list.values.filter(task => task.projectId === projectId).map(task => { let stale = false, inputValidationError = null; try { this.assertTask(task); } catch (error) { stale = true; inputValidationError = error.message; } return { ...task, stale, inputValidationError }; });
    const verified = tasks.some(task => task.executionMode === 'official-dreamina-cli' && task.status === 'succeeded' && task.result?.assetId);
    return { ...workspace, tasks, capability: { ...capability, canSubmit: capability.canSubmit === true && !list.warnings.length && (this.mode === 'isolated-fixture' || capability.realSubmissionEnabled === true), actualGenerationVerified: verified, actualVideoGenerationVerified: verified, executionMode: this.mode, historyWarnings: list.warnings }, mediaStatus: workspace.assets.length ? 'candidates_need_human_review' : 'not_generated', formalStageStatus: 'not_checked' };
  }
  parameters(input, capability, source) {
    const defaults = capability.defaults ?? {}, model = input.model ?? defaults.model;
    const spec = (capability.models ?? []).find(item => (typeof item === 'string' ? item : item.id ?? item.model) === model);
    if (!model || !spec) throw new AppError('视频模型尚未从实际CLI帮助核实，不能猜测模型或参数。', 409);
    const durationSeconds = Number(input.durationSeconds ?? defaults.durationSeconds), resolution = input.resolution ?? defaults.resolution;
    const min = spec.duration?.min, max = spec.duration?.max, step = spec.duration?.step ?? 1;
    if (!Number.isFinite(min) || !Number.isFinite(max)) throw new AppError('当前模型时长范围尚未核实，不能猜测。', 409);
    if (!Number.isInteger(durationSeconds) || durationSeconds < min || durationSeconds > max || (durationSeconds - min) % step !== 0) throw new AppError(`视频时长不符合当前模型已核实范围${min}–${max}秒。`);
    if (!Array.isArray(spec.resolutions) || !spec.resolutions.includes(resolution)) throw new AppError('视频分辨率不在当前模型已核实参数内。');
    const audioMode = input.audioMode ?? defaults.audioMode ?? 'provider_default';
    if (!['provider_default', 'mute_derivative'].includes(audioMode)) throw new AppError('CLI没有已核实的原生关闭音频参数；请选择原始音频未控制或静音派生计划。');
    const motionPrompt = input.motionPrompt ?? source.motionPrompt;
    if (typeof motionPrompt !== 'string' || !motionPrompt.trim() || motionPrompt.length > 12000) throw new AppError('请提供有效的镜头运动提示词。');
    return { model, durationSeconds, resolution, audioMode, motionPrompt: motionPrompt.trim(), ratioPolicy: 'infer_from_first_frame', audioDescription: audioMode === 'provider_default' ? '保留模型原始音频行为，CLI未验证原生静音；下载后实测音轨。' : '仅计划显式去音轨派生；本阶段不自动剪辑，原片保留。' };
  }
  async quote(parameters, source) { try { return await this.adapter.quote({ ...parameters, parameters, imageSha256: source.image.sha256, channel: 'dreamina-cli-image2video' }); } catch (error) { return unknownQuote(safe(error)); } }
  async prepare(projectId, input) {
    if (this.closed) throw new AppError('服务正在关闭。', 503);
    const workspace = this.workspace.get(projectId); this.workspace.check(workspace, input.revision);
    const source = this.workspace.source(projectId, input.shotId, input.imageAssetId), capability = await this.inspect(), parameters = this.parameters(input, capability, source);
    const quote = await this.quote(parameters, source);
    if (this.closed) throw new AppError('服务正在关闭，未保存新的任务。', 503);
    const fresh = this.workspace.source(projectId, input.shotId, source.image.id); this.workspace.check(this.workspace.get(projectId), input.revision);
    if (fresh.bindingHash !== source.bindingHash) throw new AppError('等待参数或报价期间来源已改变，没有保存旧任务。', 409);
    const creditsBudget = input.creditsBudget === '' || input.creditsBudget == null ? null : Number(input.creditsBudget);
    if (creditsBudget !== null && (!Number.isFinite(creditsBudget) || creditsBudget < 0 || creditsBudget > 100000000)) throw new AppError('积分预算上限须为非负数字或留空。');
    let redoOfTaskId = input.redoOfTaskId ?? null;
    if (redoOfTaskId) { const previous = this.read(redoOfTaskId); if (previous.projectId !== projectId || previous.shotId !== input.shotId) throw new AppError('重做任务不属于本项目和镜头。', 409); }
    const fingerprint = creativeHash({ projectId, binding: source.binding, parameters, creditsBudget, quote: videoQuoteFingerprint(quote), redoOfTaskId });
    const existing = this.list().values.find(job => job.fingerprint === fingerprint); if (existing) return existing;
    const timestamp = now(), task = { id: randomUUID(), requestId: randomUUID(), projectId, shotId: input.shotId, imageAssetId: source.image.id, executionMode: this.mode, provider: this.mode === 'isolated-fixture' ? 'isolated-video-fixture' : 'dreamina-cli-image2video', status: 'prepared', providerStatus: null, binding: clone(source.binding), bindingHash: source.bindingHash, inputSnapshot: clone(source.snapshot), inputSnapshotHash: creativeHash(source.snapshot), parameters, quote: clone(quote), quoteFingerprint: videoQuoteFingerprint(quote), creditsBudget, redoOfTaskId, fingerprint, externalTaskId: null, submittedAt: null, result: null, error: null, queryError: null, downloadError: null, events: [], createdAt: timestamp, updatedAt: timestamp, formalStageStatus: 'not_checked', canvasStatus: 'not_synced', cost: { amount: null, currency: 'CREDITS', actualAmount: null }, message: '视频任务已准备；尚未提交或消耗积分，请核对图片、参数、费用及预算。' };
    task.rawResultPath = path.join('runtime', 'video-generation', task.id); task.receipts = [];
    return this.store.write('video-jobs', task);
  }
  spending(task, quote) {
    if (quote?.status !== 'known' || quote.canSubmit !== true || !Number.isFinite(quote.amount) || quote.amount < 0 || typeof quote.basis !== 'string' || !quote.basis.trim() || !Array.isArray(quote.sources) || quote.sources.length === 0 || !(quote.evidenceId || quote.officialQuoteId) || (quote.channel && quote.channel !== 'dreamina-cli-image2video')) throw new AppError('费用待确认：没有适用于本次图生视频CLI和参数的实际报价依据；余额或即梦文字价格不能代替。', 409);
    if (quote.expiresAt && (!Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= Date.now())) throw new AppError('视频费用依据已过期或有效期无效，请重新准备。', 409);
    if (quote.currency === 'FREE' && quote.amount === 0 && quote.billingType === 'free') return { amount: 0, currency: 'FREE', budgetCap: task.creditsBudget, basis: quote.basis };
    if (quote.currency !== 'CREDITS') throw new AppError('视频需要独立的积分报价与积分预算，不能使用人民币或文字报价换算。', 409);
    if (!Number.isFinite(task.creditsBudget) || task.creditsBudget < 0) throw new AppError('请先明确视频积分预算上限；余额不是预算，也不是报价。', 409);
    const list = this.list(); if (list.warnings.length) throw new AppError(list.warnings.join('；'), 409);
    const reserved = list.values.filter(item => item.projectId === task.projectId && item.submittedAt && item.cost?.currency === 'CREDITS').reduce((sum, item) => { if (!Number.isFinite(item.cost.amount)) throw new AppError('既有视频提交费用未核实，停止新提交以免漏算预算。', 409); return sum + item.cost.amount; }, 0);
    if (reserved + quote.amount > task.creditsBudget) throw new AppError('本次费用与已预留费用超过视频积分预算上限，未提交。', 409);
    return { amount: quote.amount, currency: 'CREDITS', quotedAmount: quote.amount, actualAmount: null, kind: 'reserved_quote_not_actual_charge', budgetCap: task.creditsBudget, reserved, basis: quote.basis };
  }
  exclusive(id, kind, operation) {
    const key = id;
    if (this.active.has(key)) return this.active.get(key).kind === kind ? this.active.get(key).promise : Promise.reject(new AppError('原视频任务有操作正在进行，请等待原操作；不会并行提交、查询和下载。', 409));
    if (this.closed) return Promise.reject(new AppError('服务正在关闭。', 503));
    const run = { id, kind, controller: new AbortController(), promise: null };
    run.promise = Promise.resolve().then(() => operation(run)).finally(() => this.active.delete(key)); this.active.set(key, run); return run.promise;
  }
  async call(run, name, input) {
    const task = this.read(run.id), directory = path.join(this.store.root, 'runtime', 'video-generation', task.id); fs.mkdirSync(directory, { recursive: true });
    const callId = `${Date.now()}-${randomUUID()}`, receiptFile = path.join(directory, `${name}-${callId}.json`);
    let timer, rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = () => reject(new Error('本地等待已取消，原任务保留，不自动重提。')); run.controller.signal.addEventListener('abort', rejectAbort, { once: true }); });
    const rememberReceipt = (receipt, error = null) => {
      const latest = this.read(run.id); latest.receipts = [...(latest.receipts ?? []), { stage: name, path: path.relative(this.store.root, receiptFile), at: now(), externalTaskId: receipt?.externalTaskId ?? null, status: receipt?.status ?? null, error }]; latest.updatedAt = now(); this.store.write('video-jobs', latest);
    };
    const request = Promise.resolve().then(() => this.adapter[name]({ ...input, cwd: directory, signal: run.controller.signal })).then(receipt => { fs.writeFileSync(receiptFile, JSON.stringify(receipt ?? null, null, 2), { flag: 'wx' }); rememberReceipt(receipt); return receipt; }, error => { fs.writeFileSync(receiptFile, JSON.stringify({ error: safe(error), stage: name, at: now() }, null, 2), { flag: 'wx' }); rememberReceipt(null, safe(error)); throw error; });
    request.then(receipt => {
      if (name !== 'submit' || !externalId(receipt?.externalTaskId)) return;
      const latest = this.read(run.id);
      if (!latest.externalTaskId && latest.submittedAt && ['submission_unknown', 'interrupted', 'cancelled'].includes(latest.status)) { latest.externalTaskId = receipt.externalTaskId; latest.lateReceiptPath = path.relative(this.store.root, receiptFile); latest.recoveryAction = 'query'; this.record(latest, 'submit.late_receipt', '迟到受理回执已保留；只可查询原任务，不重提。'); }
    }).catch(() => {});
    try { return await Promise.race([request, aborted, new Promise((_, reject) => { timer = setTimeout(() => { reject(new Error(`${name}本地等待超时，原任务可能仍在处理；不会重新提交。`)); run.controller.abort(); }, this.timeoutMs); })]); }
    finally { clearTimeout(timer); run.controller.signal.removeEventListener('abort', rejectAbort); }
  }
  submit(id, { confirm, quoteFingerprint } = {}) {
    return this.exclusive(id, 'submit', async run => {
      let task = this.read(id); if (task.submittedAt) return task;
      if (confirm !== true || quoteFingerprint !== task.quoteFingerprint) throw new AppError('请明确确认本次视频参数、费用依据与积分预算。', 409);
      if (task.status !== 'prepared') throw new AppError('此任务已取消或中断，不能重新提交。', 409);
      this.assertTask(task);
      const capability = await this.inspect(), quote = await this.quote(task.parameters, this.workspace.source(task.projectId, task.shotId, task.imageAssetId));
      if (videoQuoteFingerprint(quote) !== task.quoteFingerprint) throw new AppError('视频费用或适用条件已变化，请重新准备并确认，不使用旧报价。', 409);
      const cost = this.spending(task, quote);
      if (capability.auth?.loggedIn !== true || capability.canSubmit !== true || (this.mode !== 'isolated-fixture' && capability.realSubmissionEnabled !== true)) throw new AppError(capability.message || '本轮不允许真实视频提交；等待方案确认和官方登录。', 409);
      if (this.list().warnings.length) throw new AppError('视频任务历史损坏，不能漏算提交与费用。', 409);
      task = this.read(id); if (task.submittedAt) return task;
      if (task.status !== 'prepared' || this.closed || run.controller.signal.aborted) throw new AppError('提交前任务已取消或服务关闭，未提交。', 409);
      const current = this.assertTask(task), directory = path.join(this.store.root, 'runtime', 'video-generation', id);
      fs.mkdirSync(directory, { recursive: true });
      const imagePath = path.join(directory, `input-image.${current.image.extension}`);
      if (fs.existsSync(imagePath)) { if (sha(fs.readFileSync(imagePath)) !== current.image.sha256) throw new AppError('原视频参考副本Hash不符，禁止覆盖。', 409); } else fs.writeFileSync(imagePath, current.file.bytes, { flag: 'wx' });
      task.inputImage = { path: path.relative(this.store.root, imagePath), sha256: current.image.sha256, copied: true }; task.submittedAt = now(); task.status = 'submitting'; task.cost = cost;
      this.record(task, 'submit.intent', '已先保存唯一视频提交意图和图片副本，不自动重提。');
      try {
        this.assertTask(task);
        const receipt = await this.call(run, 'submit', { taskId: id, requestId: task.requestId, imagePath, prompt: task.parameters.motionPrompt, parameters: task.parameters, beforeSubmit: () => {
          const latest = this.read(id);
          if (this.closed || run.controller.signal.aborted || latest.status !== 'submitting') throw new AppError('实际提交前任务已取消或服务关闭，不能启动生成。', 409);
          return this.assertTask(latest);
        } });
        const latest = this.read(id); if (this.closed || run.controller.signal.aborted || latest.status === 'cancelled') return latest;
        if (externalId(receipt?.externalTaskId) && !['querying', 'success', 'fail'].includes(receipt.status)) {
          latest.externalTaskId = receipt.externalTaskId; latest.providerStatus = 'unknown';
          this.record(latest, 'submit.external_id_observed', '已保留回执中实际观察到的外部任务号，但状态未知；不视为受理成功，只能查询原任务。');
        }
        if (!externalId(receipt?.externalTaskId) || !['querying', 'success', 'fail'].includes(receipt.status)) throw new Error(receipt?.error || '提交回执缺少有效外部任务ID或真实状态，结果未知；禁止自动重提。');
        latest.externalTaskId = receipt.externalTaskId; latest.providerStatus = receipt.status; latest.status = receipt.status === 'success' ? 'download_ready' : receipt.status === 'fail' ? 'failed' : 'querying'; latest.error = receipt.status === 'fail' ? safe(receipt.error ?? '即梦视频任务失败。') : null;
        return this.record(latest, 'submit.receipt', '视频提交回执已保存；受理不等于实际视频文件成功。');
      } catch (error) { const latest = this.read(id); if (latest.status !== 'cancelled' && latest.status !== 'interrupted') { latest.status = 'submission_unknown'; latest.error = safe(error); this.record(latest, 'submit.unknown', latest.error); } return latest; }
    });
  }
  query(id) {
    return this.exclusive(id, 'query', async run => {
      let task = this.read(id); if (!externalId(task.externalTaskId)) throw new AppError('缺少外部任务号，不能猜测重提；请核对原始回执或官方任务历史。', 409);
      this.assertTask(task, { current: false });
      const originalId = task.externalTaskId;
      try {
        const receipt = await this.call(run, 'query', { externalTaskId: originalId }); task = this.read(id);
        if (this.closed || run.controller.signal.aborted) return task;
        if (receipt?.externalTaskId !== originalId || !['querying', 'success', 'fail'].includes(receipt.status)) throw new Error(receipt?.error || '查询未返回本任务有效状态，保留原任务号继续查询。');
        task.providerStatus = receipt.status; task.queryError = null;
        if (task.status !== 'cancelled') task.status = receipt.status === 'success' ? task.result ? 'succeeded' : 'download_ready' : receipt.status === 'fail' ? 'failed' : 'querying';
        task.error = receipt.status === 'fail' ? safe(receipt.error || '即梦视频任务失败。') : null;
        return this.record(task, 'query.receipt', '已查询原外部任务，没有重新生成。');
      } catch (error) { task = this.read(id); task.queryError = safe(error); if (!['cancelled', 'interrupted'].includes(task.status)) task.status = 'query_failed'; return this.record(task, 'query.failed', task.queryError); }
    });
  }
  download(id) {
    return this.exclusive(id, 'download', async run => {
      let task = this.read(id);
      this.assertTask(task, { current: false });
      if (!externalId(task.externalTaskId) || task.providerStatus !== 'success') throw new AppError('须先查询原任务并核实真实成功终态，才能下载候选。', 409);
      if (task.result?.assetId) { try { this.workspace.file(task.projectId, task.result.assetId); return task; } catch { /* Explicit download may recover the same missing file. */ } }
      const originalId = task.externalTaskId; task.status = 'downloading'; this.record(task, 'download.started', '仅下载原成功任务，不重新提交生成。');
      try {
        const receipt = await this.call(run, 'download', { externalTaskId: originalId }); task = this.read(id);
        if (this.closed || run.controller.signal.aborted || task.status === 'cancelled') return task;
        if (receipt?.externalTaskId !== originalId || receipt.status !== 'success' || typeof (receipt.path ?? receipt.file) !== 'string') throw new Error(receipt?.error || '未下载到本任务的唯一实际视频文件；只能重试下载。');
        const file = receipt.path ?? receipt.file;
        if (this.mode !== 'isolated-fixture') {
          const canonical = value => { const real = fs.realpathSync.native(value).replace(/^\\\\\?\\/, ''); return process.platform === 'win32' ? real.toLowerCase() : real; };
          const directory = path.join(this.store.root, 'runtime', 'video-generation', id);
          if (!canonical(file).startsWith(canonical(directory) + path.sep)) throw new Error('下载文件不在原任务受控目录内，不能用任意路径冒充即梦产物。');
        }
        const probe = await this.probe(file, { signal: run.controller.signal }), bytes = fs.readFileSync(file);
        if (this.closed || run.controller.signal.aborted || this.read(id).status === 'cancelled') return this.read(id);
        task = this.read(id); this.assertTask(task, { current: false });
        const asset = this.workspace.importCandidate(task.projectId, { task, bytes, probe });
        task.result = { assetId: asset.id, sha256: asset.sha256, probe: clone(probe), automaticallySelected: false, sourceBoundToOriginalInput: true }; task.status = 'succeeded'; task.downloadError = null; task.error = null;
        return this.record(task, 'candidate.imported', this.mode === 'isolated-fixture' ? '明确测试视频已下载并核验，作为隔离候选导入，非真实即梦结果；未自动选用。' : '实际视频已下载且FFprobe核验，作为新候选导入，未自动选用。');
      } catch (error) { task = this.read(id); task.downloadError = safe(error); if (!['cancelled', 'interrupted'].includes(task.status)) task.status = 'download_failed'; return this.record(task, 'download.failed', task.downloadError); }
    });
  }
  cancel(id) {
    const task = this.read(id); if (task.status === 'succeeded' || task.status === 'failed') throw new AppError('任务已有终态，不能倒退取消；原结果保留。', 409);
    for (const run of this.active.values()) if (run.id === id) run.controller.abort();
    task.status = 'cancelled'; task.cancelledAt = now(); return this.record(task, 'cancel.local', '已取消本地等待，不能证明服务端取消或返还积分；原任务号、文件及回执保留，不自动重提。');
  }
  async review(projectId, input) { this.workspace.review(projectId, input); return this.view(projectId); }
  async select(projectId, input) { this.workspace.select(projectId, input); return this.view(projectId); }
  file(projectId, assetId) { return this.workspace.file(projectId, assetId); }
  close() {
    this.closed = true;
    for (const run of this.active.values()) { run.controller.abort(); const task = this.read(run.id); if (task.submittedAt && !['succeeded', 'failed', 'cancelled'].includes(task.status)) { task.status = task.externalTaskId ? 'interrupted' : 'submission_unknown'; task.error = '服务关闭，本次原任务保留，不自动重提。'; this.record(task, 'service.closed', task.error); } }
  }
}
