import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, now, validId } from './store.mjs';
import { creativeHash } from './creative-store.mjs';
import { VideoWorkspace } from './video-store.mjs';

const clone = value => structuredClone(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const timelineVersionHash = version => creativeHash({ projectId: version.projectId, revision: version.revision, clips: version.clips, audioMode: version.audioMode, durationSeconds: version.durationSeconds });

/** Local editing metadata only. No production guard, provider call, or media mutation. */
export class TimelineWorkspace {
  constructor(store, { videos } = {}) {
    this.store = store; this.videos = videos?.workspace ?? videos ?? new VideoWorkspace(store);
    for (const name of ['timeline-workspaces', 'timeline-versions']) fs.mkdirSync(path.join(store.root, name), { recursive: true });
  }
  get(projectId) {
    this.store.read('projects', projectId);
    if (fs.existsSync(this.store.file('timeline-workspaces', projectId))) {
      const value = this.store.read('timeline-workspaces', projectId);
      if (!Number.isInteger(value.revision) || !Array.isArray(value.versionIds)) throw new AppError('时间轴记录损坏，原件保留，不能覆盖。', 500);
      return value;
    }
    return { id: projectId, revision: 0, versionIds: [], activeVersionId: null, createdAt: now(), updatedAt: now() };
  }
  check(workspace, revision) { if (workspace.revision !== revision) throw new AppError('时间轴已更新，请刷新后核对；旧版本和人工修改保留。', 409); }
  readVersion(projectId, id) {
    const version = this.store.read('timeline-versions', id);
    if (version.projectId !== projectId || !Array.isArray(version.clips) || !version.clips.length || !['preserve', 'mute_derivative'].includes(version.audioMode) || version.contentHash !== timelineVersionHash(version)) throw new AppError('时间轴版本或内容Hash不一致，历史原件保留。', 409);
    return version;
  }
  source(projectId, assetId) {
    if (!validId(assetId)) throw new AppError('视频资产ID无效。');
    const workspace = this.videos.get(projectId), asset = workspace.assets.find(item => item.id === assetId);
    if (!asset) throw new AppError('时间轴引用的视频候选不存在。', 404);
    const state = this.videos.assetState(projectId, asset, workspace), selection = this.videos.active(workspace).get(asset.shotId);
    if (state.stale || state.state !== 'selected' || !state.selected || !state.reviewCurrent || state.review?.verdict !== 'accepted' || state.fileStatus !== 'intact' || selection?.assetId !== asset.id) throw new AppError('时间轴只接受当前有效、人工检查通过并已选用的视频；过期、被拒绝或未选用素材须先复核。', 409);
    const file = this.videos.file(projectId, assetId);
    if (sha(file.bytes) !== asset.sha256 || !asset.probe?.verified || asset.probe.sha256 !== asset.sha256 || !(asset.probe.durationSeconds > 0)) throw new AppError('源视频文件Hash或实测信息不一致，原片保留。', 409);
    const binding = { projectId, assetId, shotId: asset.shotId, version: asset.version, sha256: asset.sha256, videoBinding: clone(asset.binding), videoBindingHash: asset.bindingHash, videoReviewId: state.review.id, videoSelectionId: selection.id, durationSeconds: asset.probe.durationSeconds, width: asset.probe.width, height: asset.probe.height, source: clone(asset.source), testFixture: asset.testFixture === true };
    return { asset: state, file, binding, bindingHash: creativeHash(binding) };
  }
  assertClip(projectId, clip) {
    if (creativeHash(clip.binding) !== clip.bindingHash || clip.assetId !== clip.binding.assetId || clip.sha256 !== clip.binding.sha256 || clip.version !== clip.binding.version || clip.durationSeconds !== clip.binding.durationSeconds || clip.shotId !== clip.binding.shotId) throw new AppError('时间轴镜头绑定或Hash不一致，不能重新绑定历史记录。', 409);
    const current = this.source(projectId, clip.assetId);
    if (current.bindingHash !== clip.bindingHash) throw new AppError('镜头、源视频版本、文件、审核或选用已改变；旧时间轴需复核。', 409);
    return current;
  }
  assertVersion(projectId, id, { active = true } = {}) {
    const workspace = this.get(projectId), version = this.readVersion(projectId, id);
    if (!workspace.versionIds.includes(id) || (active && workspace.activeVersionId !== id)) throw new AppError('时间轴已有新版本，旧版本保留，不能执行旧导出任务。', 409);
    const sources = version.clips.map(clip => this.assertClip(projectId, clip));
    return { workspace, version, sources };
  }
  update(projectId, input) {
    const workspace = this.get(projectId); this.check(workspace, input.revision);
    if (!Array.isArray(input.clips) || input.clips.length < 1 || input.clips.length > 100) throw new AppError('请按顺序添加1–100个已选用视频镜头。');
    if (!['preserve', 'mute_derivative'].includes(input.audioMode)) throw new AppError('音频模式须为保留原音轨或显式后处理静音。');
    let durationSeconds = 0;
    const clips = input.clips.map((value, index) => {
      if (!value || typeof value !== 'object' || Object.hasOwn(value, 'trimIn') || Object.hasOwn(value, 'trimOut') || Object.hasOwn(value, 'durationSeconds')) throw new AppError('基础时间轴使用源片完整实测时长；暂不支持裁剪、变速或改写时长。');
      if (Object.keys(value).some(key => !['assetId', 'id'].includes(key))) throw new AppError('镜头输入只接受已保存的视频资产ID；不能指定路径、网址或自行声明来源。');
      const current = this.source(projectId, value.assetId), startSeconds = durationSeconds; durationSeconds += current.binding.durationSeconds;
      return { id: validId(value.id) ? value.id : randomUUID(), position: index + 1, assetId: current.asset.id, shotId: current.asset.shotId, version: current.asset.version, sha256: current.asset.sha256, durationSeconds: current.binding.durationSeconds, startSeconds, endSeconds: durationSeconds, source: clone(current.asset.source), testFixture: current.asset.testFixture === true, filename: current.asset.filename, binding: current.binding, bindingHash: current.bindingHash };
    });
    if (new Set(clips.map(item => item.id)).size !== clips.length) throw new AppError('时间轴片段ID重复。');
    const timestamp = now(), version = { id: randomUUID(), projectId, revision: workspace.revision + 1, clips, audioMode: input.audioMode, durationSeconds, createdAt: timestamp, formalStageStatus: 'not_checked', testFixture: clips.some(clip => clip.testFixture) };
    version.contentHash = timelineVersionHash(version);
    // Every version is written exactly once; only the workspace's active pointer changes.
    fs.writeFileSync(this.store.file('timeline-versions', version.id), JSON.stringify(version, null, 2) + '\n', { flag: 'wx' });
    this.store.write('timeline-workspaces', { ...workspace, revision: version.revision, versionIds: [...workspace.versionIds, version.id], activeVersionId: version.id, updatedAt: timestamp });
    return this.view(projectId);
  }
  createVersion(projectId, input) {
    if (input.clips) { this.update(projectId, input); return this.readVersion(projectId, this.get(projectId).activeVersionId); }
    const workspace = this.get(projectId); this.check(workspace, input.revision);
    if (!workspace.activeVersionId) throw new AppError('请先保存至少一个已选用视频的时间轴。', 409);
    return this.assertVersion(projectId, workspace.activeVersionId).version;
  }
  view(projectId) {
    const workspace = this.get(projectId), versions = [], warnings = [];
    for (const id of workspace.versionIds) {
      try {
        const version = this.readVersion(projectId, id); let stale = false, inputValidationError = null;
        try { version.clips.forEach(clip => this.assertClip(projectId, clip)); } catch (error) { stale = true; inputValidationError = error.message; }
        versions.push({ ...version, stale, inputValidationError, active: id === workspace.activeVersionId });
      } catch (error) { warnings.push(error.message); }
    }
    const active = versions.find(item => item.id === workspace.activeVersionId), video = this.videos.get(projectId);
    const availableAssets = video.assets.map(asset => { const state = this.videos.assetState(projectId, asset, video); return { ...state, eligible: state.state === 'selected' && !state.stale && state.reviewCurrent && state.review?.verdict === 'accepted' && state.fileStatus === 'intact' }; });
    return { ...workspace, clips: active?.clips ?? [], audioMode: active?.audioMode ?? 'preserve', totalDurationSeconds: active?.durationSeconds ?? 0, versions, availableAssets, warnings, stale: active?.stale ?? false, inputValidationError: active?.inputValidationError ?? null, formalStageStatus: 'not_checked', description: '本地时间轴与MP4无损拼接；测试素材不是AI成片。去音轨仅为显式本地后处理静音，原片保留。', limitations: ['完整镜头顺序拼接；暂不支持裁剪、变速、转场、字幕或配音。', '仅支持经实测兼容的H.264 MP4；不同尺寸、帧率或编码参数明确阻断，不自动缩放或拉伸。'] };
  }
}
