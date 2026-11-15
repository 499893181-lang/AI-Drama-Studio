import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { AppError, now, validId } from './store.mjs';
import { creativeHash } from './creative-store.mjs';
import { ImageWorkspace } from './image-store.mjs';
import { inspectImage } from './image-files.mjs';
import { decodeActualImage } from './image-decoder.mjs';
import { redact } from './tools.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const pending = ['submitting', 'running'];
const clone = value => structuredClone(value);
const safe = value => redact(String(value ?? '')).slice(0, 4000);
export function sameImageFile(left, right) {
  const real = value => {
    let file = fs.realpathSync.native(value);
    if (process.platform === 'win32') {
      if (file.startsWith('\\\\?\\UNC\\')) file = '\\\\' + file.slice(8);
      else if (file.startsWith('\\\\?\\')) file = file.slice(4);
      return path.normalize(file).toLowerCase();
    }
    return file;
  };
  try { return typeof left === 'string' && typeof right === 'string' && real(left) === real(right); } catch { return false; }
}
const unavailable = message => ({ canSubmit: false, contractVerified: false, auth: { loggedIn: false }, accountUsage: null, limitations: [message], message });
async function nativeInspect() { try { return await (await import('./codex-image-runner.mjs')).inspectCodexImageCapability(); } catch (error) { return unavailable(`官方图像契约尚未就绪：${safe(error.message)}`); } }
async function nativeRun(options) { return (await import('./codex-image-runner.mjs')).runCodexImage(options); }

export class ImageGenerationJobs {
  constructor(store, { images = new ImageWorkspace(store), runner, decoder = decodeActualImage, inspectCapabilities = nativeInspect, maxSubmissions = Number(process.env.AI_DRAMA_IMAGE_MAX_SUBMISSIONS ?? 1), timeoutMs = 600000 } = {}) {
    if (!Number.isInteger(maxSubmissions) || maxSubmissions < 1 || maxSubmissions > 1000) throw new AppError('自动出图提交上限须为1–1000的整数。');
    this.store = store; this.images = images; this.runner = runner ?? nativeRun; this.decoder = decoder; this.inspector = inspectCapabilities; this.maxSubmissions = maxSubmissions; this.timeoutMs = timeoutMs;
    this.mode = runner ? 'isolated-fixture' : 'official-codex-account'; this.active = new Map(); this.closed = false; this.inspection = null; this.capability = null;
    fs.mkdirSync(path.join(store.root, 'image-generation-jobs'), { recursive: true });
    for (const job of store.list('image-generation-jobs').values) if (pending.includes(job.status)) {
      job.status = 'interrupted'; job.error = '上次服务关闭，原提交可能仍在处理；不自动重提，保留原任务、输入和附件。'; this.record(job, 'interrupted', job.error);
    }
  }
  read(id) { return this.store.read('image-generation-jobs', id); }
  record(job, type, message) { job.updatedAt = now(); job.message = safe(message || type); job.events.push({ at: now(), type, message: job.message }); job.events = job.events.slice(-120); return this.store.write('image-generation-jobs', job); }
  async inspect(refresh = false) {
    if (!refresh && this.capability && Date.now() - this.capability.at < 30000) return clone(this.capability.value);
    if (!this.inspection) this.inspection = Promise.resolve().then(() => this.inspector()).catch(error => unavailable(safe(error.message))).then(value => { this.capability = { at: Date.now(), value }; return value; }).finally(() => { this.inspection = null; });
    return clone(await this.inspection);
  }
  usage() { const { values, warnings } = this.store.list('image-generation-jobs'), used = values.filter(job => job.submittedAt).length, historyVerified = warnings.length === 0; return { maxSubmissions: this.maxSubmissions, submitted: used, remaining: historyVerified ? Math.max(0, this.maxSubmissions - used) : 0, restartResetsBudget: false, historyVerified, warnings }; }
  async view(id) {
    this.store.read('projects', id);
    const capability = await this.inspect(), usageLimit = this.usage();
    const tasks = this.store.list('image-generation-jobs').values.filter(job => job.projectId === id).map(job => { let stale = false; try { this.images.assertExecutablePacket(id, job.packetId); } catch { stale = true; } return { ...job, stale }; });
    const verified = tasks.some(job => job.status === 'succeeded' && job.provider === 'codex-cli-built-in-image' && job.executionMode === 'official-codex-account' && job.result?.completionEvidenceMode === 'official-codex-account');
    return { tasks, capability: { ...capability, actualGenerationVerified: verified, evidenceStatus: verified ? 'real_task_verified' : capability.contractVerified ? 'contract_checked_not_real_task_verified' : 'not_verified', canSubmit: capability.canSubmit === true && usageLimit.remaining > 0 }, usageLimit, cost: { account: capability.accountUsage ?? null, cny: { amount: null, status: 'unknown' }, credits: { amount: null, status: 'unknown' }, label: '使用现有Codex账号额度；人民币及积分费用未知，不代表免费。' }, formalStageStatus: 'not_checked' };
  }
  prepare(id, { revision, shotId, referenceAssetIds }) {
    if (this.closed) throw new AppError('服务正在关闭。', 503);
    const workspace = this.images.get(id); this.images.check(workspace, revision);
    const source = this.images.source(id), target = source.targets.find(item => item.role === 'shot' && item.targetId === shotId);
    if (!target?.ready) throw new AppError('当前镜头或来源分镜未有效保存，请先复核。', 409);
    const references = this.images.references(workspace, target, source), ids = referenceAssetIds ?? references.filter(row => row.assetId).map(row => row.assetId);
    const fingerprint = creativeHash({ projectId: id, shotId, binding: this.images.binding(workspace, target, source), prompt: target.prompt, referenceAssetIds: ids });
    const existing = this.store.list('image-generation-jobs').values.find(job => job.projectId === id && job.fingerprint === fingerprint);
    if (existing) return existing;
    const packet = this.images.prepare(id, { revision, shotId, referenceAssetIds: ids }); this.images.assertExecutablePacket(id, packet.id);
    const job = { id: randomUUID(), requestId: randomUUID(), projectId: id, shotId, packetId: packet.id, fingerprint, provider: this.mode === 'official-codex-account' ? 'codex-cli-built-in-image' : 'isolated-image-fixture', status: 'prepared', prompt: packet.prompt, inputSnapshot: clone(packet.sourceSnapshot), inputSnapshotHash: creativeHash(packet.sourceSnapshot), binding: clone(packet.binding), plannedReferences: clone(packet.references), attachments: [], result: null, artifact: null, submittedAt: null, createdAt: now(), updatedAt: now(), events: [], error: null, message: '当前提示词、输入与参考版本已准备；尚未生成，请核对账号用量说明后明确提交。', threadId: null, turnId: null, usage: null, accountUsage: null, cnyCost: null, creditsCost: null, formalStageStatus: 'not_checked' };
    return this.store.write('image-generation-jobs', job);
  }
  async submit(id, { confirm, acknowledgeUsage } = {}) {
    if (this.closed) throw new AppError('服务正在关闭。', 503);
    let job = this.read(id);
    if (confirm !== true || acknowledgeUsage !== true) throw new AppError('请明确确认本次提示词、实际参考和账号额度使用；人民币/积分费用未知，不代表免费。', 409);
    if (job.submittedAt) return job;
    if (job.status !== 'prepared') throw new AppError('任务已取消或中断，不能重新提交。', 409);
    if (!this.usage().historyVerified) throw new AppError('自动出图任务历史存在损坏记录，无法核实已提交次数；已阻止生成，请先检查原文件与备份，不重置预算。', 409);
    const capability = await this.inspect(true);
    if (this.closed) throw new AppError('服务已关闭，未保存提交意图，未消耗本轮提交次数。', 503);
    if (capability.canSubmit !== true || capability.contractVerified !== true) throw new AppError(`官方自动出图尚未满足提交条件：${safe(capability.message || capability.limitations?.join('；') || '调用/产物/单次上限契约未核实')}`, 409);
    job = this.read(id); if (job.submittedAt) return job;
    if (job.status !== 'prepared') throw new AppError('任务状态已改变，未发起重复提交。', 409);
    const usageLimit = this.usage();
    if (!usageLimit.historyVerified) throw new AppError('自动出图任务历史存在损坏记录，无法核实已提交次数；已阻止生成，请先检查原文件与备份，不重置预算。', 409);
    if (usageLimit.remaining < 1) throw new AppError('本轮真实提交次数已用尽，重启不会重置；不会自动重试或购买额度。', 409);
    if ([...this.active.values()].some(run => run.job.projectId === job.projectId)) throw new AppError('本项目已有自动出图在运行，请观察原任务。', 409);
    const executable = this.images.assertExecutablePacket(job.projectId, job.packetId);
    if (creativeHash(executable.packet.sourceSnapshot) !== job.inputSnapshotHash || creativeHash(executable.packet.binding) !== creativeHash(job.binding)) throw new AppError('原任务包或输入快照已改变，禁止提交。', 409);
    const cwd = path.join(this.store.root, 'runtime', 'image-generation', job.id); fs.mkdirSync(path.join(cwd, 'references'), { recursive: true });
    job.attachments = executable.references.map(ref => {
      const bytes = ref.file.bytes; if (digest(bytes) !== ref.sha256) throw new AppError('实际参考图片Hash与任务包不一致。', 409);
      const file = path.join(cwd, 'references', `${ref.id}.${path.extname(ref.file.path).slice(1)}`);
      if (fs.existsSync(file)) { if (digest(fs.readFileSync(file)) !== ref.sha256) throw new AppError('原任务参考副本Hash改变，禁止覆盖或提交。', 409); }
      else fs.writeFileSync(file, bytes, { flag: 'wx' });
      return { id: ref.id, sha256: ref.sha256, path: file, size: bytes.length, inputCopied: true, attached: false };
    });
    this.images.assertExecutablePacket(job.projectId, job.packetId);
    job.submittedAt = now(); job.status = 'submitting'; job.capabilitySnapshot = capability; job.rawResultPath = path.relative(this.store.root, cwd);
    fs.writeFileSync(path.join(cwd, 'packet.json'), JSON.stringify(executable.packet, null, 2)); fs.writeFileSync(path.join(cwd, 'prompt.txt'), job.prompt); fs.writeFileSync(path.join(cwd, 'attachments.json'), JSON.stringify(job.attachments, null, 2));
    this.record(job, 'submit.intent', '已保存本次唯一提交意图及实际参考副本，开始官方账号图像调用；不会自动重提。');
    const run = { job, cwd, controller: new AbortController(), timer: null }; this.active.set(id, run);
    Promise.resolve().then(() => this.execute(run)).catch(error => this.fail(run, error.message)); return job;
  }
  async retainReceipt(run, receipt) {
    fs.writeFileSync(path.join(run.cwd, 'receipt.json'), JSON.stringify(receipt ?? null, null, 2));
    if (this.active.has(run.job.id) && !run.controller.signal.aborted && !this.closed) return;
    const late = [];
    for (const [index, item] of (receipt?.images ?? []).entries()) {
      try { const bytes = item.bytes ? Buffer.from(item.bytes) : fs.readFileSync(item.path); const info = inspectImage(bytes); const target = path.join(run.cwd, `late-output-${index}.${info.extension}`); fs.writeFileSync(target, bytes, { flag: 'wx' }); late.push({ path: path.relative(this.store.root, target), sha256: digest(bytes), width: info.width, height: info.height }); } catch {}
    }
    const latest = this.read(run.job.id); latest.lateReceiptAt = now(); latest.lateArtifacts = late; this.store.write('image-generation-jobs', latest);
  }
  retainArtifacts(run, receipt) {
    const items = [...(Array.isArray(receipt?.images) ? receipt.images : [])];
    if (!items.length && receipt?.imageGeneration?.savedPath) items.push({ path: receipt.imageGeneration.savedPath });
    if (!items.length && typeof receipt?.imageGeneration?.result === 'string') {
      const encoded = receipt.imageGeneration.result.replace(/^data:image\/(png|jpeg|webp);base64,/, '');
      if (/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) && encoded.length % 4 === 0) items.push({ bytes: Buffer.from(encoded, 'base64') });
    }
    const artifacts = [];
    for (const [index, item] of items.slice(0, 10).entries()) {
      try {
        if (!item.bytes && (!item.path || !fs.statSync(item.path).isFile() || fs.statSync(item.path).size > 20 * 1024 * 1024)) continue;
        const bytes = item.bytes ? Buffer.from(item.bytes) : fs.readFileSync(item.path), info = inspectImage(bytes), sha256 = digest(bytes);
        const file = path.join(run.cwd, `retained-output-${index}.${info.extension}`);
        if (fs.existsSync(file)) { if (digest(fs.readFileSync(file)) !== sha256) throw new Error('原保留图像Hash不匹配，未覆盖。'); }
        else fs.writeFileSync(file, bytes, { flag: 'wx' });
        artifacts.push({ index, path: path.relative(this.store.root, file), sha256, width: info.width, height: info.height, format: info.format, mimeType: info.mimeType, verification: 'not_accepted', sourceBinding: 'original_task_packet', note: '实际文件已保留；尚未证明单次调用限制、参考附加及自动验收通过。' });
      } catch { /* Keep raw receipt as-is even when a purported artifact is unreadable. */ }
    }
    run.job.retainedArtifacts = artifacts;
    if (artifacts.length) { run.job.artifact = clone(artifacts[0]); run.job.recoveryStatus = 'actual_image_retained_not_imported'; }
    this.store.write('image-generation-jobs', run.job);
  }
  artifactFile(id, index = 0) {
    if (!Number.isInteger(index) || index < 0) throw new AppError('原图索引不正确。');
    const job = this.read(id), artifact = job.retainedArtifacts?.find(item => item.index === index);
    if (!artifact) throw new AppError('此任务未保存可读取的原图；请核对私有原始回执。', 404);
    const base = fs.realpathSync.native(path.join(this.store.root, 'runtime', 'image-generation', id)), file = fs.realpathSync.native(path.resolve(this.store.root, artifact.path));
    const compare = value => process.platform === 'win32' ? value.toLowerCase() : value;
    if (!compare(file).startsWith(compare(base + path.sep)) || !fs.statSync(file).isFile()) throw new AppError('保留原图路径无效。', 409);
    const bytes = fs.readFileSync(file); if (digest(bytes) !== artifact.sha256) throw new AppError('保留原图Hash已改变，停止预览；原记录保留。', 409);
    const info = inspectImage(bytes);
    return { path: file, bytes, mimeType: info.mimeType, name: `unverified-${job.shotId}-${job.id}.${info.extension}`, verification: artifact.verification };
  }
  /** Trusted local recovery only; never invoked by submission or by a public write route. */
  recordRetainedArtifact(id, { path: file, sha256, decoded, evidence }) {
    const job = this.read(id);
    if (!['failed', 'cancelled', 'timed_out', 'interrupted'].includes(job.status)) throw new AppError('只允许为已结束且未通过自动验收的原任务追加恢复记录。', 409);
    const originalStatus = job.status, base = fs.realpathSync.native(path.join(this.store.root, 'runtime', 'image-generation', id)), actual = fs.realpathSync.native(file);
    const comparable = value => process.platform === 'win32' ? value.toLowerCase() : value;
    if (!comparable(actual).startsWith(comparable(base + path.sep)) || !fs.statSync(actual).isFile()) throw new AppError('恢复文件必须先保留在原任务运行目录内。', 409);
    const bytes = fs.readFileSync(actual), info = inspectImage(bytes);
    if (digest(bytes) !== sha256 || decoded?.decoded !== true || decoded.width !== info.width || decoded.height !== info.height) throw new AppError('恢复文件Hash或实际解码证据不匹配。', 409);
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) || JSON.stringify(evidence).length > 100000) throw new AppError('请保留原任务的本地恢复检查记录。');
    job.retainedArtifacts ??= [];
    if (job.retainedArtifacts.some(item => item.sha256 === sha256 && sameImageFile(path.join(this.store.root, item.path), actual))) return job;
    const relative = path.join('runtime', 'image-generation', id, path.relative(base, actual));
    const artifact = { index: Math.max(-1, ...job.retainedArtifacts.map(item => item.index)) + 1, path: relative, sha256, width: info.width, height: info.height, format: info.format, mimeType: info.mimeType, decoded: clone(decoded), verification: 'not_accepted', sourceBinding: 'original_task_packet', note: '真实产物已解码并保留，但未通过原任务自动验收；参考附加或调用约束仍未核实，未导入自动候选。' };
    job.retainedArtifacts.push(artifact); job.artifact = clone(artifact); job.recoveryStatus = 'actual_image_retained_not_imported';
    job.recoveryHistory = [...(job.recoveryHistory ?? []), { at: now(), originalStatus, packetId: job.packetId, inputSnapshotHash: job.inputSnapshotHash, artifactIndex: artifact.index, validationFailed: true, evidence: clone(evidence) }];
    // Keep failed/cancelled status, original error, events, submission intent and binding unchanged.
    return this.store.write('image-generation-jobs', job);
  }
  async execute(run) {
    if (this.closed || run.controller.signal.aborted) return;
    const current = this.images.assertExecutablePacket(run.job.projectId, run.job.packetId);
    if (creativeHash(current.packet.binding) !== creativeHash(run.job.binding)) throw new Error('实际执行前输入或参考审核已改变；没有调用生成，原意图和输入保留。');
    const job = run.job; job.status = 'running'; this.record(job, 'running', '等待真实官方图像事件、图片文件与解码校验。');
    run.timer = setTimeout(() => { if (!this.active.has(job.id)) return; job.status = 'timed_out'; job.error = '本地等待超时，原任务可能仍在服务端处理；保留原绑定，不自动重提。'; this.record(job, 'timed_out', job.error); this.active.delete(job.id); run.controller.abort(); }, this.timeoutMs);
    job.executionMode = this.mode;
    const receipt = await this.runner({ prompt: job.prompt, references: clone(job.attachments), cwd: run.cwd, signal: run.controller.signal, policy: { dataRoot: this.store.root, projectId: job.projectId, packetId: job.packetId, expectedBindingHash: creativeHash(job.binding), expectedInputSnapshotHash: job.inputSnapshotHash }, onEvent: event => {
      if (this.closed || run.controller.signal.aborted || !this.active.has(job.id)) return;
      if (event.threadId) job.threadId = event.threadId; if (event.turnId) job.turnId = event.turnId; if (event.usage) job.usage = event.usage;
      this.record(job, event.type || 'event', event.message || event.type || '官方事件');
    } });
    clearTimeout(run.timer); await this.retainReceipt(run, receipt);
    if (this.closed || run.controller.signal.aborted || !this.active.has(job.id)) return;
    job.threadId = receipt?.threadId ?? job.threadId; job.turnId = receipt?.turnId ?? job.turnId; job.usage = receipt?.usage ?? null; job.accountUsage = receipt?.accountUsage ?? null; job.exitCode = receipt?.exitCode ?? null;
    this.retainArtifacts(run, receipt);
    const generation = receipt?.imageGeneration;
    if (receipt?.exitCode !== 0 || receipt?.completed !== true || receipt?.error || !job.threadId || !job.turnId || !generation || generation.status !== 'completed' || !generation.id || receipt.images?.length !== 1) throw new Error('缺少真实完成的官方图像事件、独立任务引用或恰好一张图片；原始回执已保留。');
    const image = receipt.images[0];
    if (!image.path || !fs.statSync(image.path).isFile()) throw new Error('真实图像文件不存在；文字或任意路径不能算成功。');
    const bytes = fs.readFileSync(image.path), info = inspectImage(bytes), sha256 = digest(bytes);
    let artifactBound = Boolean(generation.savedPath && sameImageFile(image.path, generation.savedPath));
    if (!artifactBound && typeof generation.result === 'string') {
      const encoded = generation.result.replace(/^data:image\/(png|jpeg|webp);base64,/, '');
      if (encoded.length >= 16 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) && encoded.length % 4 === 0) {
        const returnedBytes = Buffer.from(encoded, 'base64'); artifactBound = digest(returnedBytes) === sha256;
      }
    }
    if (!artifactBound) throw new Error('实际图像未绑定官方savedPath或真实base64结果；fileId缺少受支持的取回契约时不能判成功。');
    const original = path.join(run.cwd, `original-output.${info.extension}`); fs.writeFileSync(original, bytes, { flag: 'wx' });
    job.artifact = { path: path.relative(this.store.root, original), sha256, width: info.width, height: info.height, format: info.format, verification: 'pending_acceptance' };
    const inputs = generation.inputImages ?? [];
    for (const ref of job.attachments) if (!inputs.some(item => item.sha256 === ref.sha256 && item.path && sameImageFile(item.path, ref.path))) throw new Error('官方图像事件未证明本次实际参考图片已附加，原图保留但不冒充成功。');
    const decoded = await this.decoder({ bytes, cwd: path.join(run.cwd, 'decode'), signal: run.controller.signal });
    if (decoded?.decoded !== true || decoded.width !== info.width || decoded.height !== info.height) throw new Error('实际图片未通过解码和尺寸核验。');
    if (this.closed || run.controller.signal.aborted || !this.active.has(job.id)) return;
    const { result: rawBase64, ...eventSummary } = generation;
    if (rawBase64) { eventSummary.resultLength = rawBase64.length; eventSummary.resultMatchesImageSha256 = sha256; }
    const completionEvidence = { officialImageEvent: clone(eventSummary), completedTurn: true, threadId: job.threadId, turnId: job.turnId, exitCode: receipt.exitCode, decoded, sha256, attachmentsVerified: true, rawReceiptPath: path.relative(this.store.root, path.join(run.cwd, 'receipt.json')), runnerMode: this.mode };
    const updated = this.images.importGenerated(job.projectId, { packetId: job.packetId, bytes, filename: `Codex-${job.shotId}-${job.id}.${info.extension}`, provenance: { taskId: job.id, provider: job.provider, threadId: job.threadId, callId: generation.generationId || generation.id, completionEvidence, ...(this.mode === 'isolated-fixture' ? { testFixture: true } : {}) } });
    const asset = updated.assets.find(item => item.generation?.taskId === job.id);
    if (!asset) throw new Error('图片已处理但未找到绑定该执行任务的候选记录，保留原图供核对。');
    job.attachments = job.attachments.map(ref => ({ ...ref, attached: true, officialEventVerified: true })); job.result = { assetId: asset.id, sha256, width: info.width, height: info.height, decoded, sourceBoundToOriginalPacket: true, stale: asset.stale, automaticallySelected: false, completionEvidenceMode: this.mode }; job.status = 'succeeded'; job.error = null; job.recoveryStatus = 'imported_as_candidate'; job.artifact.verification = 'validated_for_candidate'; job.retainedArtifacts = job.retainedArtifacts.map(item => ({ ...item, verification: item.sha256 === sha256 ? 'validated_for_candidate' : 'not_accepted' }));
    this.record(job, 'candidate.imported', '真实图片已解码并按原输入导入为新候选；未覆盖旧图，未自动选用。'); this.active.delete(job.id);
  }
  fail(run, message) { clearTimeout(run.timer); if (this.closed || !this.active.has(run.job.id)) return; run.job.status = 'failed'; run.job.error = safe(message); this.record(run.job, 'failed', run.job.error); this.active.delete(run.job.id); }
  cancel(id) {
    const job = this.read(id), run = this.active.get(id);
    if (job.status === 'prepared') { job.status = 'cancelled'; job.error = null; return this.record(job, 'cancelled', '已取消尚未提交的任务，原包保留。'); }
    if (!run) throw new AppError('此任务已结束或中断，不能再次取消。', 409);
    clearTimeout(run.timer); run.job.status = 'cancelled'; run.job.error = null; this.record(run.job, 'cancelled', '本地等待已取消；不保证服务端已停止或退还额度。迟到原图留在原任务目录。'); this.active.delete(id); run.controller.abort(); return run.job;
  }
  close() { this.closed = true; for (const run of this.active.values()) { clearTimeout(run.timer); run.job.status = 'interrupted'; run.job.error = '服务关闭，原任务保留，不自动重提。'; this.record(run.job, 'interrupted', run.job.error); run.controller.abort(); } this.active.clear(); }
}
