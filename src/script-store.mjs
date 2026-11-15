import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, now, generationInput, validId } from './store.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const scriptSourceHash = project => hash({ project: generationInput(project), creativeBrief: project.creativeBrief });
export const scriptInputHash = (workspace, project) => hash({ currentSource: scriptSourceHash(project), preparedSource: workspace.sourceHash, input: workspace.input, binding: { projectId: workspace.binding.projectId, teamId: workspace.binding.teamId } });
export const scriptReviewHash = (workspace, project, version) => hash({ source: scriptSourceHash(project), input: scriptInputHash(workspace, project), versionId: version.id, body: version.body });
const textFields = ['idea', 'ref_content', 'story_engine', 'characters', 'current_episode_summary', 'world_setting', 'requirement'];

export function organizeScriptInput(project) {
  const brief = project.creativeBrief;
  return {
    episode_num: 1, current_episode: 1, script_localization: 'cn',
    idea: brief ? [brief.synopsis, brief.background, brief.conflict, brief.emotion, brief.ending].join('\n\n') : '',
    ref_content: project.idea,
    story_engine: brief ? `故事主线：${brief.synopsis}\n核心冲突：${brief.conflict}\n情绪发展：${brief.emotion}\n结局锁定：${brief.ending}` : '',
    characters: brief?.characters ?? '', current_episode_summary: brief ? `${brief.synopsis}\n结局：${brief.ending}` : '',
    world_setting: brief?.background ?? '',
    requirement: brief ? [
      `用户原始构思：${project.idea}`,
      `用户指定内容：\n${brief.preservedContent.join('\n')}`,
      `目标时长：${project.durationSeconds}秒；画幅：${project.aspectRatio}；画风：${project.style || '未指定'}`,
      `预算计划：${project.budgetCap === null ? '尚未指定' : `${project.budgetCap}人民币元`}（计划上限不代表即梦报价或积分换算）`,
      `创作说明中AI补充的设定，保留来源供核对：\n${brief.addedSettings.join('\n')}`,
      '只创作剧本文字，不创建图片、视频、配音或剪辑；保留人物关系与结尾，不把AI补充说成用户指定。',
    ].join('\n\n') : '',
  };
}
function validateInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('剧本输入格式不正确。');
  const result = {};
  for (const key of textFields) {
    if (typeof value[key] !== 'string' || value[key].length > 20000) throw new AppError(`剧本输入 ${key} 须为不超过20000字的文本。`);
    result[key] = value[key];
  }
  for (const key of ['episode_num', 'current_episode']) {
    if (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > 100) throw new AppError('集数须为1–100的整数。');
    result[key] = value[key];
  }
  if (!['cn', 'i18n'].includes(value.script_localization)) throw new AppError('剧本本地化参数不正确。');
  result.script_localization = value.script_localization;
  return result;
}
export function novelInput(workspace, kind) {
  const value = validateInput(workspace.input);
  if (kind === 'outline') {
    if (!value.idea.trim() && !value.ref_content.trim()) throw new AppError('大纲生成需要构思或参考文本。');
    return { episode_num: value.episode_num, idea: value.idea, ref_content: value.ref_content, script_localization: value.script_localization };
  }
  if (kind !== 'script') throw new AppError('只支持大纲与单集剧本文字任务。');
  for (const key of ['story_engine', 'characters', 'current_episode_summary']) if (!value[key].trim()) throw new AppError(`单集剧本缺少必填内容：${key}`);
  return { current_episode: value.current_episode, story_engine: value.story_engine, characters: value.characters, current_episode_summary: value.current_episode_summary, world_setting: value.world_setting, requirement: value.requirement, script_localization: value.script_localization };
}

export class ScriptWorkspace {
  constructor(store) {
    this.store = store;
    for (const kind of ['scripts', 'script-jobs', 'script-reviews']) fs.mkdirSync(path.join(store.root, kind), { recursive: true });
  }
  project(id) { return this.store.read('projects', id); }
  get(id) {
    const project = this.project(id);
    if (fs.existsSync(this.store.file('scripts', id))) return this.store.read('scripts', id);
    return { id, revision: 0, sourceHash: scriptSourceHash(project), sourceProjectRevision: project.revision, input: organizeScriptInput(project), binding: { projectId: '', teamId: '', verified: false, title: null, verifiedAt: null }, versions: [], activeOutlineId: null, activeScriptId: null, inputHistory: [], createdAt: now(), updatedAt: now() };
  }
  check(workspace, revision) { if (workspace.revision !== revision) throw new AppError('剧本页面已在其他窗口更新，请先刷新核对；当前手稿未被覆盖。', 409); }
  save(value) { return this.store.write('scripts', { ...value, revision: value.revision + 1, updatedAt: now() }); }
  update(id, body) {
    const previous = this.get(id); this.check(previous, body.revision);
    const next = { ...previous };
    if (body.input !== undefined) next.input = validateInput(body.input);
    if (body.binding !== undefined) {
      if (!body.binding || typeof body.binding !== 'object') throw new AppError('即梦项目绑定格式不正确。');
      const projectId = body.binding.projectId ?? '';
      const teamId = body.binding.teamId ?? '';
      if (typeof projectId !== 'string' || projectId.length > 200 || typeof teamId !== 'string' || teamId.length > 100 || /[\r\n\x00]/.test(projectId + teamId)) throw new AppError('即梦画布ID或空间ID格式不正确。');
      if (projectId.trim() !== previous.binding.projectId || teamId.trim() !== previous.binding.teamId) next.binding = { projectId: projectId.trim(), teamId: teamId.trim(), verified: false, title: null, verifiedAt: null };
    }
    return this.save(next);
  }
  sync(id, revision) {
    const project = this.project(id), workspace = this.get(id); this.check(workspace, revision);
    if (!project.creativeBrief) throw new AppError('请先在故事立项页面保存创作说明。', 409);
    return this.save({ ...workspace, input: organizeScriptInput(project), sourceHash: scriptSourceHash(project), sourceProjectRevision: project.revision, inputHistory: [...workspace.inputHistory, { at: now(), input: workspace.input, sourceHash: workspace.sourceHash }].slice(-100) });
  }
  verifyBinding(id, revision, result) {
    const workspace = this.get(id); this.check(workspace, revision);
    if (!result?.verified || result.projectId !== workspace.binding.projectId || String(result.teamId ?? '') !== workspace.binding.teamId) throw new AppError('未收到与当前画布和空间一致的真实绑定验证结果。', 409);
    return this.save({ ...workspace, binding: { ...workspace.binding, verified: true, title: result.title ?? null, verifiedAt: now() } });
  }
  addVersion(id, { revision, kind = 'script', body, parentVersionId = null }, provenance = null) {
    const workspace = this.get(id), project = this.project(id); this.check(workspace, revision);
    if (!['outline', 'script'].includes(kind) || typeof body !== 'string' || !body.trim() || body.length > 100000) throw new AppError('请提供1–100000字的完整大纲或剧本文字。');
    if (workspace.versions.length >= 500) throw new AppError('本项目已有500个文字版本，请先备份整理。');
    if (parentVersionId && !workspace.versions.some(version => version.id === parentVersionId)) throw new AppError('引用的父版本不存在。', 409);
    const version = { id: randomUUID(), kind, origin: provenance ? 'jimeng-novel' : 'user', body, parentVersionId, taskId: provenance?.taskId ?? null, createdAt: now(), sourceHash: workspace.sourceHash, inputHash: scriptInputHash(workspace, project), sourceProjectRevision: project.revision };
    return this.save({ ...workspace, versions: [...workspace.versions, version], [kind === 'outline' ? 'activeOutlineId' : 'activeScriptId']: version.id });
  }
  activate(id, revision, versionId) {
    const workspace = this.get(id); this.check(workspace, revision);
    if (!validId(versionId)) throw new AppError('文字版本ID无效。');
    const version = workspace.versions.find(item => item.id === versionId);
    if (!version) throw new AppError('文字版本不存在。', 404);
    return this.save({ ...workspace, [version.kind === 'outline' ? 'activeOutlineId' : 'activeScriptId']: versionId });
  }
  versionStale(version, workspace, project) { return version.sourceHash !== scriptSourceHash(project) || version.inputHash !== scriptInputHash(workspace, project); }
  view(id) {
    const project = this.project(id), workspace = this.get(id), currentHash = scriptSourceHash(project), inputHash = scriptInputHash(workspace, project);
    const tasks = this.store.list('script-jobs').values.filter(task => task.projectId === id).map(task => ({ ...task, stale: task.inputHash !== inputHash || task.sourceHash !== currentHash }));
    const reviews = this.store.list('script-reviews').values.filter(review => review.projectId === id).map(review => {
      const version = workspace.versions.find(version => version.id === review.versionId);
      return { ...review, needsReview: !version || workspace.activeScriptId !== review.versionId || review.inputHash !== scriptReviewHash(workspace, project, version) || this.versionStale(version, workspace, project) };
    });
    return { ...workspace, hasCreativeBrief: !!project.creativeBrief, currentSourceHash: currentHash, upstreamStale: workspace.sourceHash !== currentHash, versions: workspace.versions.map(version => ({ ...version, stale: this.versionStale(version, workspace, project) })), tasks, reviews };
  }
}
