import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, now, validId } from './store.mjs';
import { creativeHash } from './creative-store.mjs';
import { ImageWorkspace } from './image-store.mjs';

const clone = value => structuredClone(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const text = (value, label, max = 8000) => { if (typeof value !== 'string' || value.length > max) throw new AppError(`${label}格式不正确。`); return value; };

export class VideoWorkspace {
  constructor(store, { images = new ImageWorkspace(store) } = {}) {
    this.store = store; this.images = images;
    for (const name of ['video-workspaces', 'video-files']) fs.mkdirSync(path.join(store.root, name), { recursive: true });
  }
  get(projectId) {
    this.store.read('projects', projectId);
    if (fs.existsSync(this.store.file('video-workspaces', projectId))) return this.store.read('video-workspaces', projectId);
    return { id: projectId, revision: 0, assets: [], reviews: [], selectionHistory: [], createdAt: now(), updatedAt: now() };
  }
  check(workspace, revision) { if (workspace.revision !== revision) throw new AppError('视频工作台版本已更新，请刷新；旧视频和人工选择没有覆盖。', 409); }
  save(workspace) { return this.store.write('video-workspaces', { ...workspace, revision: workspace.revision + 1, updatedAt: now() }); }
  source(projectId, shotId, imageAssetId) {
    const view = this.images.view(projectId), source = this.images.source(projectId);
    const target = view.targets.find(item => item.role === 'shot' && item.targetId === shotId);
    if (!target || !target.ready || source.sourceStale || view.sourceError) throw new AppError('当前分镜已过期或未有效保存，不能准备或提交视频。', 409);
    const selection = [...view.selectionHistory].reverse().find(item => item.key === `shot:${shotId}`);
    const id = imageAssetId ?? selection?.assetId, image = view.assets.find(item => item.id === id && item.role === 'shot' && item.targetId === shotId);
    if (!image || selection?.assetId !== image.id || !image.selected || image.state !== 'selected' || image.stale || !image.reviewCurrent || image.review?.verdict !== 'accepted' || image.fileStatus !== 'intact') throw new AppError('视频输入必须是当前有效、人工检查通过且已选用的分镜图；拒绝过期、拒绝或未选用图片。', 409);
    const file = this.images.file(projectId, image.id);
    if (sha(file.bytes) !== image.sha256) throw new AppError('分镜图实际文件Hash已变化，原图记录保留，停止视频提交。', 409);
    const binding = {
      projectId, shotId, storyboardVersion: source.sourceVersion, sourceHash: source.sourceHash, knowledgeHash: source.knowledge.hash,
      imageAssetId: image.id, imageVersion: image.version, imageSha256: image.sha256, imageWidth: image.width, imageHeight: image.height, imageTargetVersion: image.targetVersion,
      imageTargetHash: image.targetHash, imageInputSnapshotHash: image.inputSnapshotHash, imageReferenceHash: image.referenceHash,
      imageReviewId: image.review.id, imageSelectionId: selection.id, references: clone(this.images.binding(view, target, source).references),
    };
    return { view, source, target, image, file, binding, bindingHash: creativeHash(binding), motionPrompt: target.design?.videoPrompt ?? '', snapshot: this.images.snapshot(source, target) };
  }
  assertBinding(projectId, binding) {
    const current = this.source(projectId, binding.shotId, binding.imageAssetId);
    if (creativeHash(current.binding) !== creativeHash(binding)) throw new AppError('原视频任务的分镜、图片、审核或选用版本已改变；旧任务与文件保留，请基于当前版本重新准备。', 409);
    return current;
  }
  active(workspace) { const selected = new Map(); for (const entry of workspace.selectionHistory) selected.set(entry.shotId, entry); return selected; }
  file(projectId, assetId) {
    if (!validId(assetId)) throw new AppError('视频资产ID无效。');
    const asset = this.get(projectId).assets.find(item => item.id === assetId);
    if (!asset || !['mp4', 'webm', 'mov'].includes(asset.extension) || asset.storedName !== `${asset.id}.${asset.extension}`) throw new AppError('视频文件不存在。', 404);
    const file = path.join(this.store.directory('video-files',projectId),asset.storedName);
    if (!fs.existsSync(file)) throw new AppError('视频原文件缺失，版本和历史记录已保留。', 404);
    const bytes = fs.readFileSync(file);
    if (sha(bytes) !== asset.sha256) throw new AppError('视频实际文件Hash改变，停止预览和选用；原记录保留。', 409);
    return { path: file, bytes, mimeType: asset.mimeType, name: asset.filename, size: bytes.length };
  }
  assetState(projectId, asset, workspace) {
    let stale = false, fileStatus = 'intact';
    try { this.assertBinding(projectId, asset.binding); } catch { stale = true; }
    try { this.file(projectId, asset.id); } catch (error) { stale = true; fileStatus = error.status === 404 ? 'missing' : 'hash_changed'; }
    const review = [...workspace.reviews].reverse().find(item => item.assetId === asset.id) ?? null;
    const reviewCurrent = !stale && Boolean(review && review.bindingHash === asset.bindingHash && review.sha256 === asset.sha256);
    const selected = this.active(workspace).get(asset.shotId)?.assetId === asset.id;
    const state = stale ? 'needs_review' : reviewCurrent && review.verdict === 'rejected' ? 'rejected' : selected && reviewCurrent && review.verdict === 'accepted' ? 'selected' : reviewCurrent && review.verdict === 'accepted' ? 'checked' : 'pending_check';
    return { ...clone(asset), stale, fileStatus, selected, review, reviewCurrent, state, url: `/api/projects/${projectId}/video-assets/${asset.id}` };
  }
  view(projectId) {
    const workspace = this.get(projectId); let imageView = null, sourceError = null;
    try { imageView = this.images.view(projectId); sourceError = imageView.sourceError ?? null; } catch (error) { sourceError = error.message; }
    const targets = (imageView?.targets ?? []).filter(item => item.role === 'shot').map(target => {
      try { const current = this.source(projectId, target.targetId); return { shotId: target.targetId, label: target.label, ready: true, error: null, imageAssetId: current.image.id, imageVersion: current.image.version, imageSha256: current.image.sha256, imageUrl: current.image.url, imageFilename: current.image.filename, imageSource: clone(current.image.source), storyboardVersion: current.binding.storyboardVersion, motionPrompt: current.motionPrompt, binding: current.binding, bindingHash: current.bindingHash }; }
      catch (error) { return { shotId: target.targetId, label: target.label, ready: false, error: error.message, imageAssetId: null, imageUrl: null, motionPrompt: target.design?.videoPrompt ?? '' }; }
    });
    return { ...workspace, project: this.store.read('projects', projectId), targets, assets: workspace.assets.map(asset => this.assetState(projectId, asset, workspace)), sourceError, formalStageStatus: 'not_checked', canvasSync: { status: 'not_synced', message: 'CLI直接视频任务与画布媒体导入独立；没有写入画布或文本节点。' } };
  }
  importCandidate(projectId, { task, bytes, probe, provenance = null }) {
    const workspace = this.get(projectId), existing = workspace.assets.find(item => item.taskId === task.id), hash = sha(bytes);
    if (existing) {
      if (existing.sha256 !== hash) throw new AppError('同一视频任务已有不同产物，旧文件保留，不能覆盖。', 409);
      const original = path.join(this.store.directory('video-files',projectId),existing.storedName);
      if (!fs.existsSync(original)) fs.writeFileSync(original, bytes, { flag: 'wx' });
      this.file(projectId, existing.id); return existing;
    }
    if (task.providerStatus !== 'success' || !task.externalTaskId || probe?.verified !== true || probe.sha256 !== hash || !(probe.durationSeconds > 0) || !(probe.width > 0 && probe.height > 0) || !(probe.videoStreams > 0)) throw new AppError('候选缺少真实成功终态、下载文件或FFprobe核验，不能显示生成成功。', 409);
    const id = randomUUID(), extension = probe.mimeType === 'video/webm' ? 'webm' : probe.mimeType === 'video/quicktime' ? 'mov' : 'mp4';
    const directory = this.store.directory('video-files',projectId); fs.mkdirSync(directory, { recursive: true });
    const asset = { id, taskId: task.id, externalTaskId: task.externalTaskId, shotId: task.shotId, version: workspace.assets.filter(item => item.shotId === task.shotId).length + 1, filename: `${task.executionMode === 'isolated-fixture' ? 'TEST-FIXTURE-NOT-AI-' : 'Dreamina-'}${task.shotId}-v${workspace.assets.filter(item => item.shotId === task.shotId).length + 1}.${extension}`, storedName: `${id}.${extension}`, extension, mimeType: probe.mimeType ?? 'video/mp4', size: bytes.length, sha256: hash, binding: clone(task.binding), bindingHash: task.bindingHash, inputSnapshot: clone(task.inputSnapshot), parameters: clone(task.parameters), probe: clone(probe), createdAt: now(), source: { kind: task.executionMode === 'isolated-fixture' ? 'test' : 'dreamina-cli', description: task.executionMode === 'isolated-fixture' ? '隔离runner与明确测试视频；不是即梦真实生成结果。' : '官方即梦CLI任务成功、实际下载且FFprobe核验；仍需人工视觉检查。' }, testFixture: task.executionMode === 'isolated-fixture', canvasStatus: 'not_synced', audioStatus: task.parameters.audioMode === 'mute_derivative' && probe.hasAudio ? 'requires_explicit_derivation' : probe.hasAudio ? 'original_has_audio' : 'no_audio_detected' };
    if (provenance) {
      asset.provenance = clone(provenance);
      if(task.executionMode==='official-service-api'){
        if(!provenance.completionEvidence||provenance.provider!==task.provider)throw new AppError('云端候选缺少原渠道原生完成证据。',409);
        asset.filename=`${task.provider}-${task.shotId}-v${asset.version}.${extension}`;
        asset.source={kind:'service-api',description:`${task.provider} 官方接口终态、原任务下载与FFprobe核验；实际画面仍待人工检查。`};
      }
      if (task.provider === 'dreamina-canvas-node-video') {
        asset.canvasStatus = 'source_canvas_resource_bound';
        if (!asset.testFixture) asset.source = { kind: 'dreamina-canvas', description: '官方画布原任务成功终态、资源下载与FFprobe核验；实际首帧/画面仍待人工检查。' };
      }
      if (provenance.derivative) asset.audioStatus = 'local_silent_derivative_verified';
    }
    fs.writeFileSync(path.join(directory, asset.storedName), bytes, { flag: 'wx' });
    this.save({ ...workspace, assets: [...workspace.assets, asset] }); return asset;
  }
  review(projectId, { revision, assetId, verdict, notes = '' }) {
    const workspace = this.get(projectId); this.check(workspace, revision);
    if (!['accepted', 'rejected'].includes(verdict)) throw new AppError('视频检查结论无效。');
    const asset = workspace.assets.find(item => item.id === assetId); if (!asset) throw new AppError('视频候选不存在。', 404);
    const state = this.assetState(projectId, asset, workspace); if (state.stale) throw new AppError('视频来源已过期或文件异常，原片保留；不能以旧检查覆盖新要求。', 409);
    const record = { id: randomUUID(), assetId, verdict, notes: text(notes, '检查说明'), bindingHash: asset.bindingHash, sha256: asset.sha256, createdAt: now() };
    this.save({ ...workspace, reviews: [...workspace.reviews, record] }); return record;
  }
  select(projectId, { revision, assetId }) {
    const workspace = this.get(projectId); this.check(workspace, revision);
    const asset = workspace.assets.find(item => item.id === assetId); if (!asset) throw new AppError('视频候选不存在。', 404);
    const state = this.assetState(projectId, asset, workspace);
    if (state.stale || !state.reviewCurrent || state.review?.verdict !== 'accepted') throw new AppError('须先核对当前来源并人工检查通过，才能选用视频。', 409);
    if (asset.audioStatus === 'requires_explicit_derivation') throw new AppError('原片检测到音轨，静音派生尚未执行与核验，不能当作无声交付选用；原片保留。', 409);
    const previous = this.active(workspace).get(asset.shotId); if (previous?.assetId === assetId) return previous;
    const selection = { id: randomUUID(), shotId: asset.shotId, assetId, previousAssetId: previous?.assetId ?? null, bindingHash: asset.bindingHash, createdAt: now() };
    this.save({ ...workspace, selectionHistory: [...workspace.selectionHistory, selection] }); return selection;
  }
}
