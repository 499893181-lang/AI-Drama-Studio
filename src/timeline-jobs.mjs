import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, now } from './store.mjs';
import { creativeHash } from './creative-store.mjs';
import { TimelineWorkspace, timelineVersionHash } from './timeline-store.mjs';
import { probeVideo, runMedia } from './video-media.mjs';
import { resolveExecutable, redact } from './tools.mjs';

const clone = value => structuredClone(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const safe = error => redact(String(error?.message ?? error)).slice(0, 5000);
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'timed_out', 'interrupted']);

const streams = (probe, kind) => (probe.rawProbe?.streams ?? []).filter(item => item.codec_type === kind);
function compatibility(probe, audioMode) {
  if (probe.extension !== 'mp4' || probe.videoCodec !== 'h264' || probe.videoStreams !== 1 || !probe.frameRate || !probe.pixelFormat) throw new AppError('基础导出只支持已核实的H.264 MP4单视频轨；不同容器或缺失编码参数须人工转换，未静默转码。', 409);
  const video = streams(probe, 'video')[0];
  if (!video || !video.time_base || !video.r_frame_rate) throw new AppError('缺少实测视频流时间基或帧率，不能确认无损拼接兼容。', 409);
  const videoKeys = ['codec_name', 'codec_tag_string', 'profile', 'level', 'width', 'height', 'pix_fmt', 'avg_frame_rate', 'r_frame_rate', 'time_base', 'sample_aspect_ratio', 'field_order', 'color_range', 'color_space', 'color_transfer', 'color_primaries', 'extradata_size'];
  const result = { video: Object.fromEntries(videoKeys.map(key => [key, video[key] ?? null])) };
  if (audioMode === 'preserve') {
    const audio = streams(probe, 'audio');
    if (audio.length > 1) throw new AppError('保留音轨的基础导出暂只支持每片0或1条兼容音轨，不能静默丢弃多音轨。', 409);
    result.audio = audio.map(track => Object.fromEntries(['codec_name', 'profile', 'sample_rate', 'channels', 'channel_layout', 'sample_fmt', 'time_base', 'extradata_size'].map(key => [key, track[key] ?? null])));
  }
  return result;
}

/** Deterministic local FFmpeg exports; never calls a media provider. */
export class TimelineService {
  constructor(store, { videos, probe = probeVideo, runner = runMedia, ffmpegBin = resolveExecutable('ffmpeg'), timeoutMs = 120000 } = {}) {
    this.store = store; this.workspace = new TimelineWorkspace(store, { videos }); this.probe = probe; this.runner = runner; this.ffmpegBin = ffmpegBin; this.timeoutMs = timeoutMs;
    this.executionMode = runner !== runMedia || probe !== probeVideo ? 'isolated-fixture' : 'local-ffmpeg'; this.active = new Map(); this.closed = false;
    for (const name of ['timeline-exports', 'runtime/timeline-exports']) fs.mkdirSync(path.join(store.root, name), { recursive: true });
    for (const task of this.list().values) if (task.status === 'exporting') {
      task.status = 'interrupted'; task.error = '服务重启，旧导出意图、文件和错误保留；不会自动重新导出。需要时显式创建重导出任务。'; this.record(task, 'restart.interrupted', task.error);
    }
  }
  list() {
    const values = [], warnings = [];
    for (const name of fs.readdirSync(path.join(this.store.root, 'timeline-exports')).filter(item => item.endsWith('.json'))) {
      try { const item = this.store.read('timeline-exports', name.slice(0, -5)); if (!item.projectId || !Array.isArray(item.events) || typeof item.updatedAt !== 'string' || !item.versionId || !item.inputSnapshot) throw new Error(); values.push(item); }
      catch { warnings.push(`导出任务${name}损坏，原件保留；请先核对历史，不执行新导出。`); }
    }
    values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); return { values, warnings };
  }
  read(id) { return this.store.read('timeline-exports', id); }
  record(task, type, message) { task.updatedAt = now(); task.message = safe(message); task.events.push({ at: task.updatedAt, type, message: task.message }); return this.store.write('timeline-exports', task); }
  assertTask(task, { current = true } = {}) {
    const snapshot = task.inputSnapshot;
    if (!snapshot || timelineVersionHash(snapshot) !== task.versionHash || snapshot.id !== task.versionId || snapshot.projectId !== task.projectId || task.inputSnapshotHash !== creativeHash(snapshot) || task.fingerprint !== creativeHash({ projectId: task.projectId, versionId: task.versionId, versionHash: task.versionHash, redoOfTaskId: task.redoOfTaskId })) throw new AppError('导出任务快照或版本Hash不一致，旧记录保留，不能执行。', 409);
    const stored = this.workspace.readVersion(task.projectId, task.versionId);
    if (creativeHash(stored) !== task.inputSnapshotHash) throw new AppError('不可变时间轴版本与导出快照不一致。', 409);
    return current ? this.workspace.assertVersion(task.projectId, task.versionId) : { version: stored };
  }
  taskView(task) {
    let stale = false, inputValidationError = null;
    try { this.assertTask(task); } catch (error) { stale = true; inputValidationError = error.message; }
    return { ...task, stale, inputValidationError, url: task.status === 'succeeded' ? `/api/timeline-exports/${task.id}/file` : null, manifestUrl: task.status === 'succeeded' ? `/api/timeline-exports/${task.id}/manifest` : null };
  }
  view(projectId) { const list = this.list(), tasks = list.values.filter(task => task.projectId === projectId).map(task => this.taskView(task)); return { ...this.workspace.view(projectId), tasks, exports: tasks, historyWarnings: list.warnings, capability: { localOnly: true, externalProviderCalls: 0, paidGenerationEnabled: false, nativeSilentClaim: false, executionMode: this.executionMode, supportedContainer: 'mp4', supportedCodec: 'h264', trimsSupported: false } }; }
  update(projectId, input) { if (this.closed) throw new AppError('服务正在关闭。', 503); this.workspace.update(projectId, input); return this.view(projectId); }
  createVersion(projectId, input) { return this.workspace.createVersion(projectId, input); }
  prepareExport(projectId, input) {
    if (this.closed) throw new AppError('服务正在关闭。', 503);
    const workspace = this.workspace.get(projectId); this.workspace.check(workspace, input.revision);
    const list = this.list(); if (list.warnings.length) throw new AppError(list.warnings.join('\n'), 409);
    const versionId = input.versionId ?? workspace.activeVersionId;
    if (!versionId) throw new AppError('请先保存有效时间轴。', 409);
    const { version } = this.workspace.assertVersion(projectId, versionId);
    const redoOfTaskId = input.redoOfTaskId ?? null;
    if (redoOfTaskId) { const previous = this.read(redoOfTaskId); if (previous.projectId !== projectId || !terminal.has(previous.status)) throw new AppError('重导出只能引用本项目已结束的旧任务。', 409); }
    const fingerprint = creativeHash({ projectId, versionId, versionHash: version.contentHash, redoOfTaskId });
    const existing = list.values.find(task => task.fingerprint === fingerprint); if (existing) return this.taskView(existing);
    const timestamp = now(), id = randomUUID();
    const task = { id, projectId, versionId, versionHash: version.contentHash, inputSnapshot: clone(version), inputSnapshotHash: creativeHash(version), fingerprint, redoOfTaskId, status: 'prepared', executionMode: this.executionMode, submittedAt: null, runAttempts: 0, externalProviderCalls: 0, result: null, error: null, events: [], createdAt: timestamp, updatedAt: timestamp, formalStageStatus: 'not_checked', testFixture: version.testFixture || this.executionMode === 'isolated-fixture', message: '本地导出已准备，尚未执行FFmpeg；不会调用生成、配音或画布。' };
    this.store.write('timeline-exports', task); return this.taskView(task);
  }
  startExport(id) {
    if (this.active.has(id)) return this.active.get(id).promise;
    if (this.closed) return Promise.reject(new AppError('服务正在关闭。', 503));
    let task;
    try {
      task = this.read(id);
      // The durable intent is checked before any async work. Errors, timeout,
      // restart and second service instances never turn the same task into a rerun.
      if (task.submittedAt || task.status !== 'prepared') return Promise.resolve(this.taskView(task));
      if (this.list().warnings.length) throw new AppError('导出历史未完整核实，停止执行。', 409);
      this.assertTask(task);
      if (!this.ffmpegBin && this.executionMode !== 'isolated-fixture') throw new AppError('未找到本机FFmpeg，未执行导出。', 409);
    } catch (error) { return Promise.reject(error); }
    const controller = new AbortController(), active = { controller, promise: null, reason: null };
    task.status = 'exporting'; task.submittedAt = now(); task.runAttempts = 1; this.record(task, 'export.intent', '导出意图已落盘，只执行本地FFmpeg一次；原素材不会覆盖。');
    this.active.set(id, active);
    const timer = setTimeout(() => { active.reason = 'timed_out'; controller.abort(new Error('本地导出超时')); }, this.timeoutMs);
    active.promise = this.execute(task, controller.signal).then(() => this.taskView(this.read(id))).catch(error => {
      const latest = this.read(id);
      if (latest.status === 'exporting') { latest.status = active.reason ?? (controller.signal.aborted ? 'cancelled' : 'failed'); latest.error = safe(error); this.record(latest, `export.${latest.status}`, latest.error); }
      return this.taskView(this.read(id));
    }).finally(() => { clearTimeout(timer); this.active.delete(id); });
    return active.promise;
  }
  async step(promise, signal) {
    if (signal.aborted) throw new AppError('本地导出已取消或超时；保留已产生的诊断文件。', 409);
    let abort;
    const interrupted = new Promise((_, reject) => { abort = () => reject(new AppError('本地导出已取消或超时；不自动重新导出。', 409)); signal.addEventListener('abort', abort, { once: true }); });
    try { const result = await Promise.race([promise, interrupted]); if (signal.aborted || this.closed) throw new AppError('本地导出已中断，迟到产物不会改为成功。', 409); return result; }
    finally { signal.removeEventListener('abort', abort); }
  }
  async execute(task, signal) {
    const { version, sources } = this.assertTask(task), directory = path.join(this.store.root, 'runtime', 'timeline-exports', task.id);
    fs.mkdirSync(directory, { recursive: false });
    const audits = []; let compatible = null;
    for (let index = 0; index < sources.length; index++) {
      const current = this.workspace.assertClip(task.projectId, version.clips[index]), probe = await this.step(this.probe(current.file.path, { signal }), signal);
      if (probe.sha256 !== version.clips[index].sha256 || Math.abs(probe.durationSeconds - version.clips[index].durationSeconds) > 0.02) throw new AppError('导出前实测源文件Hash或时长改变，停止并保留原片。', 409);
      const signature = compatibility(probe, version.audioMode);
      if (compatible !== null && creativeHash(signature) !== compatible) throw new AppError('源片尺寸、帧率、编码、时间基、色彩或音轨参数不兼容；请人工转换后重新导入，不会静默拉伸、缩放或转码。', 409);
      compatible = creativeHash(signature);
      const copiedName = `clip-${String(index).padStart(3, '0')}.mp4`, copiedPath = path.join(directory, copiedName);
      const bytes = fs.readFileSync(current.file.path); if (sha(bytes) !== probe.sha256) throw new AppError('源文件检查后发生变化，未复制旧Hash素材。', 409);
      fs.writeFileSync(copiedPath, bytes, { flag: 'wx' });
      audits.push({ position: index + 1, clipId: version.clips[index].id, assetId: current.asset.id, shotId: current.asset.shotId, version: current.asset.version, sha256: probe.sha256, source: clone(current.asset.source), testFixture: current.asset.testFixture === true, binding: clone(version.clips[index].binding), copiedName, actualProbe: probe });
    }
    this.assertTask(this.read(task.id));
    const concatList = path.join(directory, 'input.ffconcat'), output = path.join(directory, 'output.mp4');
    fs.writeFileSync(concatList, 'ffconcat version 1.0\n' + audits.map(item => `file '${item.copiedName}'`).join('\n') + '\n', { flag: 'wx' });
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-protocol_whitelist', 'file,pipe', '-f', 'concat', '-safe', '1', '-i', concatList, '-map', '0:v:0', '-c:v', 'copy'];
    if (version.audioMode === 'mute_derivative') args.push('-an'); else args.push('-map', '0:a:0?', '-c:a', 'copy');
    args.push('-movflags', '+faststart', '-metadata', `title=${version.testFixture ? 'TEST FIXTURE / NOT AI - ' : ''}AI-Drama-Studio local timeline export`, output);
    const build = await this.step(this.runner(this.ffmpegBin, ['-hide_banner', '-version'], { signal, timeoutMs: this.timeoutMs }), signal);
    if (typeof build?.stdout !== 'string' || build.exitCode !== 0) throw new AppError('FFmpeg版本检查未返回有效完成回执。', 409);
    task = this.read(task.id); task.inputAudits = audits; task.command = { executable: this.ffmpegBin, args, build: build.stdout.slice(0, 12000), shell: false, overwrites: false }; this.record(task, 'export.inputs_verified', '当前来源、文件Hash、FFprobe和拼接兼容性已核对。');
    const receipt = await this.step(this.runner(this.ffmpegBin, args, { signal, timeoutMs: this.timeoutMs }), signal);
    if (receipt?.exitCode !== 0) throw new AppError('FFmpeg没有返回明确成功终态，文件仅作诊断保留。', 409);
    const resultProbe = await this.step(this.probe(output, { signal }), signal);
    const first = audits[0].actualProbe, expectedDuration = audits.reduce((sum, item) => sum + item.actualProbe.durationSeconds, 0);
    if (!resultProbe.verified || resultProbe.videoCodec !== 'h264' || resultProbe.extension !== 'mp4' || resultProbe.width !== first.width || resultProbe.height !== first.height || resultProbe.frameRate !== first.frameRate || Math.abs(resultProbe.durationSeconds - expectedDuration) > Math.max(0.2, audits.length * 0.05) || (version.audioMode === 'mute_derivative' ? resultProbe.audioStreams !== 0 : resultProbe.audioStreams !== first.audioStreams)) throw new AppError('实际导出格式、尺寸、帧率、时长或音轨不符合计划，保留原片与输出诊断，不标成功。', 409);
    this.assertTask(this.read(task.id));
    for (const item of audits) if (sha(fs.readFileSync(path.join(directory, item.copiedName))) !== item.sha256) throw new AppError('导出期间工作副本Hash变化，不标成功。', 409);
    task = this.read(task.id);
    if (signal.aborted || task.status !== 'exporting' || this.closed) throw new AppError('导出已经中断，迟到产物保留但不能覆盖状态。', 409);
    const filename = `${version.testFixture ? 'TEST-FIXTURE-NOT-AI-' : ''}timeline-v${version.revision}.mp4`;
    const manifest = { schemaVersion: 1, exportId: task.id, projectId: task.projectId, timelineVersionId: version.id, timelineVersionHash: version.contentHash, inputSnapshotHash: task.inputSnapshotHash, clips: audits, audioMode: version.audioMode, audioDescription: version.audioMode === 'mute_derivative' ? '显式本地后处理去音轨派生；原片保留，不是模型原生无声。' : '保留源片实测兼容音轨；无音轨来源保持无音轨。', editing: { trims: false, speedChanges: false, transitions: false, scaled: false, reencoded: false }, command: task.command, receipt: { exitCode: receipt.exitCode, stdout: safe(receipt.stdout ?? ''), stderr: safe(receipt.stderr ?? '') }, output: { filename, sha256: resultProbe.sha256, size: resultProbe.size, probe: resultProbe }, testFixture: version.testFixture || this.executionMode === 'isolated-fixture', sourceDescription: version.testFixture ? '明确标记的软件测试视频拼接，不是即梦真实生成或正式AI成片。' : '本地拼接已选用源视频；仅技术检查通过，内容与成片需另行人工验收。', externalProviderCalls: 0, formalStageStatus: 'not_checked', completedAt: now() };
    const manifestPath = path.join(directory, 'manifest.json'); fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    task.result = { filename, relativePath: path.relative(this.store.root, output), manifestRelativePath: path.relative(this.store.root, manifestPath), manifestSha256: sha(fs.readFileSync(manifestPath)), sha256: resultProbe.sha256, size: resultProbe.size, probe: resultProbe, testFixture: manifest.testFixture, locallyExported: true, automaticallySelected: false }; task.status = 'succeeded'; task.error = null; this.record(task, 'export.succeeded', '本地MP4已导出并经FFprobe检查；原片保留，未调用外部生成，尚需人工成片检查。');
  }
  cancel(id) {
    const task = this.read(id); if (terminal.has(task.status)) return this.taskView(task);
    const active = this.active.get(id); if (active) { active.reason = 'cancelled'; active.controller.abort(); }
    task.status = 'cancelled'; task.error = '用户取消本地导出；保留意图、错误与已生成诊断文件，不自动重导。'; this.record(task, 'export.cancelled', task.error); return this.taskView(task);
  }
  artifact(task, name, hash) {
    if (task.status !== 'succeeded' || !task.result) throw new AppError('本地导出尚未成功，不能提供成片下载。', 409);
    const expected = path.join('runtime', 'timeline-exports', task.id, name), relative = name === 'manifest.json' ? task.result.manifestRelativePath : task.result.relativePath;
    if (relative !== expected) throw new AppError('导出文件路径绑定异常，原记录保留。', 409);
    const file = path.join(this.store.root, expected); let bytes; try { bytes = fs.readFileSync(file); } catch { throw new AppError('导出文件缺失，历史和原片保留。', 404); }
    if (sha(bytes) !== hash) throw new AppError('导出文件实际Hash变化，停止下载；原记录保留。', 409);
    return { path: file, bytes, size: bytes.length };
  }
  file(id) { const task = this.read(id), file = this.artifact(task, 'output.mp4', task.result?.sha256); return { ...file, mimeType: 'video/mp4', name: task.result.filename }; }
  manifest(id) { const task = this.read(id), file = this.artifact(task, 'manifest.json', task.result?.manifestSha256); return JSON.parse(file.bytes.toString('utf8')); }
  close() { this.closed = true; for (const [id, active] of this.active) { active.reason = 'interrupted'; active.controller.abort(); const task = this.read(id); if (task.status === 'exporting') { task.status = 'interrupted'; task.error = '服务关闭，本地导出已中断，原片与诊断保留；不自动重新导出。'; this.record(task, 'export.interrupted', task.error); } } }
}
