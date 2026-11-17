import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, now, generationInput } from './store.mjs';
import { loadCreativeKnowledge, listStylePresets, buildCreativeTaskPacket, validateImportedCandidate } from './creative-design.mjs';
import { entityFacts, entityFactsHash, assessEntityProvenance, validateEntityProvenance, legacyEntityProvenance, provenanceBase, mergeEntityProvenance, evidenceForExplicitEdits } from './entity-provenance.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const creativeHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const copy = value => structuredClone(value);
const text = (value, name, max = 100000) => { if (typeof value !== 'string' || value.length > max) throw new AppError(`${name}须为不超过${max}字的文字。`); return value; };
const jsonArray = (value, name, max = 100) => { if (!Array.isArray(value) || value.length > max || JSON.stringify(value).length > 250000) throw new AppError(`${name}格式或长度不正确。`); return copy(value); };
export function validateEntities(value) {
  const rows = jsonArray(value, '实体'); const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !/^[A-Za-z0-9_-]{1,80}$/.test(row.id) || seen.has(row.id) || !['character', 'scene', 'prop'].includes(row.type) || typeof row.version !== 'string' || !row.version || row.version.length > 80 || typeof row.description !== 'string' || row.description.length > 16000 || !['user', 'ai'].includes(row.source)) throw new AppError('实体需唯一稳定ID、类型、版本、描述及user/ai来源。');
    seen.add(row.id);
  }
  return rows;
}
export function validateEntityRefs(shot, entities) {
  if (!Array.isArray(shot.entityRefs) || !shot.entityRefs.length || shot.entityRefs.some(ref => !entities.some(entity => ref.id === entity.id && ref.version === entity.version))) throw new AppError(`镜头${shot.id}须引用现存实体的准确ID及版本。`);
}
export function seedToShot(seed) {
  return { ...copy(seed), framing: '中景（待分镜细化）', emotion: '', composition: '', foreground: '', midground: '', background: '', focus: '', lighting: { source: '', direction: '', softness: '' }, materials: [], palette: '', avoid: [], camera: { motionId: 'CAM_FIXED', start: seed.moment, end: seed.moment, path: { mode: 'none', description: '仅基础输入，待分镜设计' }, speed: '', subjectMotion: seed.action, environmentMotion: '', viewpoint: '平视（待分镜细化）', stability: '固定机位', focalChange: '固定焦距', focusPlan: { start: '', transition: '', end: '' } }, postSound: '' };
}

export class CreativeWorkspace {
  constructor(store, { knowledgeRoot } = {}) {
    this.store = store; this.knowledgeRoot = knowledgeRoot;
    for (const dir of ['creative-workspaces', 'creative-jobs']) fs.mkdirSync(path.join(store.root, dir), { recursive: true });
  }
  knowledge() { return loadCreativeKnowledge(this.knowledgeRoot); }
  catalog() {
    const knowledge = this.knowledge();
    return { hash: knowledge.hash, version: knowledge.version, manifest: knowledge.manifest, directors: knowledge.directors.directors, presets: listStylePresets(knowledge), motions: knowledge.motion.camera_vocabulary, sources: [...knowledge.directors.sources, ...(knowledge.provenance.sources.manuals ?? [])], provenance: knowledge.provenance, formalStageStatus: 'not_checked', mediaStatus: 'not_generated' };
  }
  get(id) {
    this.store.read('projects', id);
    if (fs.existsSync(this.store.file('creative-workspaces', id))) return this.store.read('creative-workspaces', id);
    return { id, revision: 0, episodeId: 'EP-01', instructions: '', shotCount: 3, stylePresetId: listStylePresets(this.knowledge())[0].id, manualRuleIds: [], locks: [], entities: [], shots: [], selectedScriptTaskId: null, scriptDraft: '', storyboardDraft: '', versions: [], activeScriptId: null, activeStoryboardId: null, createdAt: now(), updatedAt: now() };
  }
  check(value, revision) { if (value.revision !== revision) throw new AppError('创作页面已被更新，请刷新核对；磁盘人工稿未被覆盖。', 409); }
  save(value) { return this.store.write('creative-workspaces', { ...value, revision: value.revision + 1, updatedAt: now() }); }
  update(id, body) {
    const value = this.get(id); this.check(value, body.revision); const next = copy(value);
    for (const key of ['instructions', 'scriptDraft', 'storyboardDraft']) if (Object.hasOwn(body, key)) next[key] = text(body[key], key);
    if (Object.hasOwn(body, 'episodeId')) { if (!/^[A-Za-z0-9_-]{1,80}$/.test(body.episodeId)) throw new AppError('分集ID格式不正确。'); next.episodeId = body.episodeId; }
    if (Object.hasOwn(body, 'shotCount')) { if (!Number.isInteger(body.shotCount) || body.shotCount < 1 || body.shotCount > 30) throw new AppError('镜头数须为1–30。'); next.shotCount = body.shotCount; }
    if (Object.hasOwn(body, 'stylePresetId')) next.stylePresetId = text(body.stylePresetId, '预设ID', 150);
    const knowledge = this.knowledge(), preset = listStylePresets(knowledge).find(item => item.id === next.stylePresetId);
    if (!preset) throw new AppError('未知作品级预设。');
    if (Object.hasOwn(body, 'manualRuleIds')) next.manualRuleIds = jsonArray(body.manualRuleIds, '手册扩展');
    if (new Set(next.manualRuleIds).size !== next.manualRuleIds.length || next.manualRuleIds.some(id => !preset.manualDerivedRules.some(rule => rule.id === id))) throw new AppError('扩展规则须属于当前导演，且不可重复。切换导演时请重新勾选。');
    if (Object.hasOwn(body, 'locks')) {
      next.locks = jsonArray(body.locks, '锁定项');
      for (const lock of next.locks) if (!lock || !/^shot\.[a-zA-Z0-9_.-]+$/.test(lock.path) || /(?:__proto__|constructor|prototype)/.test(lock.path) || !Object.hasOwn(lock, 'value')) throw new AppError('锁定项须为shot字段路径与value。');
    }
    if (Object.hasOwn(body, 'entities')) {
      next.entities = validateEntities(body.entities).map(entityFacts);
      next.entityInputEvidence = evidenceForExplicitEdits(value.entities, next.entities, value.entityInputEvidence ?? {});
    }
    if (Object.hasOwn(body, 'shots')) {
      next.shots = jsonArray(body.shots, '镜头', 30);
      if (new Set(next.shots.map(shot => shot?.id)).size !== next.shots.length || next.shots.some(shot => !shot || !/^[A-Za-z0-9_-]{1,80}$/.test(shot.id))) throw new AppError('镜头须有唯一稳定ID。');
    }
    if (Object.hasOwn(body, 'selectedScriptTaskId')) {
      if (body.selectedScriptTaskId !== null) this.scriptTask(id, body.selectedScriptTaskId);
      next.selectedScriptTaskId = body.selectedScriptTaskId;
    }
    // Draft editing remains possible even with explicit conflicts; compile/view diagnoses them.
    return this.save(next);
  }
  scriptTask(id, taskId) {
    const job = this.store.read('creative-jobs', taskId);
    if (job.projectId !== id || job.kind !== 'script' || job.status !== 'succeeded' || !job.result) throw new AppError('请选择本项目成功返回的剧本候选。', 409);
    return job;
  }
  taskEntityProvenance(job) {
    if (!job.entityProvenance) return legacyEntityProvenance(job.result?.entities ?? []);
    if (!job.inputSnapshot || creativeHash(job.inputSnapshot) !== job.inputHash) { const report = legacyEntityProvenance(job.result?.entities ?? [], '输入快照已改变，来源绑定失效。'); report.entries.forEach(entry => { entry.bindingValid = false; }); return report; }
    return validateEntityProvenance(job.entityProvenance, job.result, job.inputSnapshot);
  }
  parentSourceBases(id, parent) {
    if (!parent) return [];
    if (parent.type === 'task') {
      const job = this.store.read('creative-jobs', parent.id);
      if (!job.entityProvenance) return [];
      return [provenanceBase(job.result, job.inputSnapshot, this.taskEntityProvenance(job), job.inputHash)];
    }
    return this.get(id).versions.find(version => version.id === parent.id)?.entityProvenanceBases ?? [];
  }
  manualSourceBase(workspace) {
    const snapshot = { projectId: workspace.id, entities: copy(workspace.entities), entityInputEvidence: copy(workspace.entityInputEvidence ?? {}) };
    const result = { entities: copy(workspace.entities), addedSettings: [], entityEvidence: [] };
    return provenanceBase(result, snapshot, assessEntityProvenance(result, snapshot));
  }
  parentScript(id, workspace, taskId) {
    const selected = taskId ?? workspace.selectedScriptTaskId;
    if (selected) { const task = this.scriptTask(id, selected); return { id: task.id, type: 'task', body: task.result.body, data: task.result, entityProvenance: this.taskEntityProvenance(task) }; }
    const version = workspace.versions.find(item => item.id === workspace.activeScriptId && item.kind === 'script');
    if (version) return { id: version.id, type: 'version', body: version.body, data: version.data ?? null, entityProvenance: mergeEntityProvenance(version.data?.entities ?? [], version.entityProvenanceBases ?? []) };
    return null;
  }
  effective(workspace, parent) {
    // Parent candidates may add explicitly sourced, unadopted supporting entities
    // (e.g. an off-screen voice). Keep these available for downstream references;
    // current user entities with the same stable ID always take precedence.
    const entities = [...new Map([...(parent?.data?.entities ?? []), ...workspace.entities].map(entity => [entity.id, entityFacts(entity)])).values()];
    const provenance = mergeEntityProvenance(entities, [...this.parentSourceBases(workspace.id, parent), this.manualSourceBase(workspace)]);
    const shots = workspace.shots.length ? workspace.shots : (parent?.data?.shotSeeds ?? []).map(seedToShot);
    return { entities: entities.map(entity => { const entry = provenance.entries.find(row => row.entityId === entity.id && row.version === entity.version); return { ...copy(entity), resolvedSource: entry.resolvedSource, sourceProvenance: copy(entry) }; }), shots: copy(shots), provenance };
  }
  context(id, kind, { scriptTaskId, targetTaskId, targetVersionId, bindingPolicy = 1 } = {}, workspaceOverride = null) {
    const workspace = workspaceOverride ?? this.get(id), project = this.store.read('projects', id), knowledge = this.knowledge();
    const source = { ...generationInput(project), creativeBrief: project.creativeBrief, projectRevision: project.revision };
    if(bindingPolicy===2){
      // Revision is a concurrency token, not a semantic dependency. Budgets and
      // project labels do not rewrite a story. Old snapshots keep policy 1.
      delete source.projectRevision;delete source.budgetCap;delete source.budgetCurrency;delete source.name;
      source.references=project.references.map(ref=>{const file=path.join(this.store.directory('references',id),ref.storedName);return{id:ref.id,name:ref.name,mimeType:ref.mimeType,sha256:fs.existsSync(file)?createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null};});
    }
    const sourceHash = creativeHash(source);
    const common = { projectId: id, episodeId: workspace.episodeId, source, instructions: workspace.instructions, shotCount: workspace.shotCount, locks: workspace.locks, entities: workspace.entities, scriptDraft: workspace.scriptDraft, knowledgeHash: knowledge.hash };
    if (workspace.entityInputEvidence && Object.keys(workspace.entityInputEvidence).length) common.entityInputEvidence = copy(workspace.entityInputEvidence);
    let parent = null, target = null, effective = { entities: workspace.entities, shots: workspace.shots }, packets = [];
    let snapshot = common;
    if (kind !== 'script') {
      parent = this.parentScript(id, workspace, scriptTaskId);
      effective = this.effective(workspace, parent);
      snapshot = { ...common, stylePresetId: workspace.stylePresetId, manualRuleIds: workspace.manualRuleIds, shots: effective.shots, effectiveEntities: effective.entities, selectedScriptTaskId: workspace.selectedScriptTaskId, parent, storyboardDraft: workspace.storyboardDraft };
      if(bindingPolicy===2&&fs.existsSync(this.store.file('studio-production',id))){const visual=this.store.read('studio-production',id);snapshot.visualReferences={visualStyleId:visual.visualStyleId,visualNotes:visual.visualNotes,visuals:effective.entities.filter(e=>['character','scene'].includes(e.type)).map(entity=>[...visual.visuals].reverse().find(v=>v.entityId===entity.id&&v.entityVersion===entity.version)??{entityId:entity.id,status:'not_defined'})};}
      if (kind === 'review') {
        if (targetTaskId) {
          const task = this.store.read('creative-jobs', targetTaskId);
          if (task.projectId !== id || task.kind === 'review' || task.status !== 'succeeded' || !task.result) throw new AppError('审阅目标须为本项目已成功返回的文字候选。', 409);
          target = { id: task.id, type: 'task', kind: task.kind, result: task.result, threadId: task.threadId };
        } else if (targetVersionId) {
          const version = workspace.versions.find(item => item.id === targetVersionId);
          if (!version) throw new AppError('审阅版本不存在。', 404);
          target = { id: version.id, type: 'version', kind: version.kind, body: version.body, result: version.data ?? null };
        } else throw new AppError('请选择需要独立审阅的候选或人工版本。');
        snapshot = { ...snapshot, target };
      }
      const upstream = { source: sourceHash, script: creativeHash(parent), design: creativeHash({ ...snapshot, target: undefined }) };
      for (const shot of effective.shots) {
        const input = { projectId: id, episodeId: workspace.episodeId, sourceRevision: project.revision, inputHashes: upstream, stylePresetId: workspace.stylePresetId, manualRuleIds: workspace.manualRuleIds, shot, locks: workspace.locks, references: [], entities: effective.entities };
        packets.push(buildCreativeTaskPacket(input, knowledge));
      }
    }
    return { workspace, project, knowledge, parent, target, effective, snapshot: copy(snapshot), sourceHash, inputHash: creativeHash(snapshot), packets };
  }
  matchesSelectedParent(job, workspace) {
    if (job.kind === 'script') return true;
    const actual = this.parentScript(job.projectId, workspace);
    // Explicit task references remain the immutable historical binding; they
    // cannot supersede a source the user has subsequently chosen or saved.
    return !actual || actual.id === job.inputSnapshot.parent?.id && actual.type === job.inputSnapshot.parent?.type;
  }
  editorReviewScope(id, workspace = this.get(id),bindingPolicy=1) {
    const context=this.context(id,'script',{bindingPolicy},workspace);
    if(bindingPolicy===2)return creativeHash({source:context.sourceHash,knowledge:context.knowledge.hash,episodeId:workspace.episodeId,instructions:workspace.instructions,shotCount:workspace.shotCount,locks:workspace.locks,entities:workspace.entities,entityInputEvidence:workspace.entityInputEvidence??{}});
    return creativeHash({source:context.sourceHash,knowledge:context.knowledge.hash,episodeId:workspace.episodeId,instructions:workspace.instructions,shotCount:workspace.shotCount,locks:workspace.locks,entities:workspace.entities,entityInputEvidence:workspace.entityInputEvidence??{},stylePresetId:workspace.stylePresetId,manualRuleIds:workspace.manualRuleIds});
  }
  editorReviewProof(target, workspace) {
    if(target?.type==='task'){const task=this.store.read('creative-jobs',target.id);return creativeHash({inputHash:task.inputHash,inputSnapshot:task.inputSnapshot,entityProvenance:task.entityProvenance??null});}
    const version=workspace.versions.find(item=>item.id===target?.id);
    return creativeHash(version?.entityProvenanceBases??[]);
  }
  fresh(job) {
    try {
      if(job.serviceSnapshot&&this.services)this.services.assertSnapshotCurrent(job.serviceSnapshot,job.projectId);
      const current = this.context(job.projectId, job.kind, job.references);
      if(job.kind==='review'&&job.editorReviewBinding){
        const binding=job.editorReviewBinding,body=current.workspace.scriptEditor?.body??current.workspace.scriptDraft;
        // Confirming an unchanged script moves a source pointer, not its text.
        // Keep this explicitly bound editor review current only while both the
        // immutable target and actual editor text/requirements still match.
        return creativeHash(job.inputSnapshot)===job.inputHash&&binding.targetHash===creativeHash(current.target)&&binding.proofHash===this.editorReviewProof(current.target,current.workspace)&&binding.bodyHash===creativeHash(body)&&binding.scopeHash===this.editorReviewScope(job.projectId,current.workspace,binding.bindingPolicy??1);
      }
      return this.matchesSelectedParent(job, current.workspace) && current.inputHash === job.inputHash;
    } catch { return false; }
  }
  validateCurrent(job, current) {
    if(job.serviceSnapshot&&this.services)this.services.assertSnapshotCurrent(job.serviceSnapshot,job.projectId);
    if (current.parent?.entityProvenance?.entries.some(entry => entry.bindingValid === false)) throw new AppError('当前剧本来源证据绑定损坏，不能采用下游结果。', 409);
    if (creativeHash(job.inputSnapshot) !== job.inputHash) throw new AppError('原任务输入快照已改变，来源证据失效，不能采用。', 409);
    if (job.kind === 'script' && this.taskEntityProvenance(job).entries.some(entry => entry.bindingValid === false)) throw new AppError('实体来源证据与原输入或实体内容不匹配，不能采用。', 409);
    if (!this.matchesSelectedParent(job, current.workspace)) throw new AppError('当前选择的来源剧本已经改变；旧分镜或审阅保留供参考，不能采用。', 409);
    if (current.inputHash !== job.inputHash || current.sourceHash !== job.sourceHash || current.knowledge.hash !== job.knowledgeHash) throw new AppError('当前输入、镜头、预设或知识库已改变；旧结果保留，不能覆盖当前人工稿。', 409);
    if (job.kind === 'storyboard') {
      if (current.packets.length !== job.packets.length) throw new AppError('当前镜头数量已经改变。', 409);
      for (const packet of job.packets) {
        const fresh = current.packets.find(item => item.shotId === packet.shotId);
        if (!fresh) throw new AppError('当前镜头身份已经改变。', 409);
        validateImportedCandidate(packet, { projectId: job.projectId, episodeId: packet.episodeId, shotId: packet.shotId, sourceRevision: packet.sourceRevision, inputHash: packet.inputHash, rawText: job.rawText }, { projectId: fresh.projectId, episodeId: fresh.episodeId, sourceRevision: fresh.sourceRevision, inputHashes: fresh.inputHashes, knowledgeHash: current.knowledge.hash, inputHash: fresh.inputHash });
      }
    }
  }
  addVersion(id, { revision, kind, body, parentVersionId = null }) {
    const workspace = this.get(id); this.check(workspace, revision);
    if (workspace.versions.length >= 500) throw new AppError('已有500个不可变版本，请先备份整理。');
    if (!['script', 'storyboard'].includes(kind) || !text(body, '人工稿正文').trim()) throw new AppError('请填写剧本或分镜人工稿正文。');
    if (parentVersionId && !workspace.versions.some(item => item.id === parentVersionId)) throw new AppError('父版本不存在。');
    const references=this.defaultBindingPolicy===2?{bindingPolicy:2}:{};
    const context = this.context(id, kind,references);
    let data = { shots: copy(context.effective.shots), notes: body }, parentSource = null;
    if (kind === 'script') {
      const parent = this.parentScript(id, workspace), effective = this.effective(workspace, parent);
      const seedKeys = ['id', 'purpose', 'moment', 'subject', 'action', 'durationSeconds', 'entityRefs', 'weather', 'timeOfDay'];
      data = { body, entities: effective.entities.map(entityFacts), addedSettings: copy(parent?.data?.addedSettings ?? []), shotSeeds: effective.shots.map(shot => Object.fromEntries(seedKeys.filter(key => Object.hasOwn(shot, key)).map(key => [key, copy(shot[key])]))) };
      parentSource = parent ? { id: parent.id, type: parent.type } : null;
    }
    const parent = this.parentScript(id, workspace);
    const entityProvenanceBases = [...this.parentSourceBases(id, parent), this.manualSourceBase(workspace)];
    const version = { id: randomUUID(), kind, body, data, entityProvenanceBases, origin: 'user', taskId: null, parentVersionId, parentSource, references, createdAt: now(), sourceHash: context.sourceHash, inputHash: context.inputHash, knowledgeHash: context.knowledge.hash };
    // Saving a manual script explicitly chooses that immutable version as the
    // downstream source. Preserve inherited candidate entities/seeds in it,
    // instead of leaving downstream work pinned to an obsolete model task.
    return this.save({ ...workspace, versions: [...workspace.versions, version], [kind === 'script' ? 'activeScriptId' : 'activeStoryboardId']: version.id, ...(kind === 'script' ? { selectedScriptTaskId: null } : {}) });
  }
  adopt(id, body) {
    const workspace = this.get(id); this.check(workspace, body.revision);
    if (workspace.versions.length >= 500) throw new AppError('已有500个不可变版本，请先备份整理。');
    const job = this.store.read('creative-jobs', body.taskId);
    if (job.projectId !== id || !['script', 'storyboard'].includes(job.kind) || job.status !== 'succeeded' || !job.result) throw new AppError('任务未返回完整创作候选。', 409);
    if (workspace.versions.some(version => version.taskId === job.id)) throw new AppError('候选已经采用过。', 409);
    const current = this.context(id, job.kind, job.references);
    if (body.projectRevision !== undefined && body.projectRevision !== current.project.revision) throw new AppError('故事立项已更新，请刷新。', 409);
    this.validateCurrent(job, current);
    const provenance = job.kind === 'script' ? this.taskEntityProvenance(job) : current.effective.provenance;
    if (provenance?.pendingCount && body.confirmPendingSources !== true) throw new AppError('部分实体来源待确认。请明确确认仅保存待确认候选，不把它们提升为用户事实或事实锁。', 409);
    const entityProvenanceBases = job.kind === 'script' && job.entityProvenance ? [provenanceBase(job.result, job.inputSnapshot, provenance, job.inputHash)] : [...this.parentSourceBases(id, current.parent), this.manualSourceBase(workspace)];
    const version = { id: randomUUID(), kind: job.kind, body: job.kind === 'script' ? job.result.body : renderStoryboard(job.result.shots), data: copy(job.result), entityProvenanceBases, pendingSourcesAcknowledged: provenance?.pendingCount ? { at: now(), entityIds: provenance.entries.filter(entry => entry.resolvedSource === 'pending').map(entry => entry.entityId), remainsPending: true } : null, origin: job.provider??'codex-cli', taskId: job.id, parentVersionId: workspace[job.kind === 'script' ? 'activeScriptId' : 'activeStoryboardId'], createdAt: now(), sourceHash: job.sourceHash, inputHash: job.inputHash, knowledgeHash: job.knowledgeHash, references: copy(job.references) };
    // One atomic workspace write: append immutable version and move pointer together. Drafts untouched.
    return this.save({ ...workspace, versions: [...workspace.versions, version], [job.kind === 'script' ? 'activeScriptId' : 'activeStoryboardId']: version.id });
  }
  export(id) {
    const context = this.context(id, 'storyboard');
    return { projectId: id, episodeId: context.workspace.episodeId, exportScope: 'current_saved_input_design', inputHash: context.inputHash, knowledgeHash: context.knowledge.hash, packets: context.packets, prompts: context.packets.map(packet => ({ shotId: packet.shotId, imagePrompt: packet.design.imagePrompt, videoPrompt: packet.design.videoPrompt, postSound: context.effective.shots.find(shot => shot.id === packet.shotId)?.postSound ?? '' })), adoptedStoryboard: context.workspace.versions.find(version => version.id === context.workspace.activeStoryboardId) ?? null, formalStageStatus: 'not_checked', mediaStatus: 'not_generated', note: 'packets与prompts由当前保存的输入镜头编译；adoptedStoryboard单列已采用分镜版本，两者不混同。仅导出文字，未提交媒体或画布任务。' };
  }
  view(id) {
    const workspace = this.get(id), project = this.store.read('projects', id), knowledge = this.knowledge();
    let effective = { entities: workspace.entities, shots: workspace.shots }, compiled = [], compileError = null;
    try { const context = this.context(id, 'storyboard'); effective = context.effective; compiled = context.packets.map(packet => ({ shotId: packet.shotId, design: packet.design, packet })); } catch (error) { compileError = error.message; }
    const tasks = this.store.list('creative-jobs').values.filter(job => job.projectId === id).map(job => ({ ...job, entityProvenance: job.kind === 'script' && job.result ? this.taskEntityProvenance(job) : job.entityProvenance ?? null, stale: !this.fresh(job), candidateStatus: job.status === 'succeeded' ? (this.fresh(job) ? 'pending_adoption' : 'stale') : 'unavailable', formalStageStatus: 'not_checked', mediaStatus: 'not_generated' }));
    const versions = workspace.versions.map(version => { let stale = true; try { stale = version.taskId ? !this.fresh(this.store.read('creative-jobs', version.taskId)) : this.context(id, version.kind, version.references).inputHash !== version.inputHash; } catch {} return { ...version, stale }; });
    return { ...workspace, versions, project, tasks, entityProvenance: effective.provenance ?? legacyEntityProvenance(effective.entities), reviews: tasks.filter(job => job.kind === 'review').map(job => ({ ...job, report: job.result, needsReview: job.stale })), effectiveShots: effective.shots, effectiveEntities: effective.entities, compiled, compileError, knowledgeHash: knowledge.hash, formalStageStatus: 'not_checked', formalStageMessage: '四岗位真实guard、正式15文件及账本未接入；此处仅管理文字候选与独立审阅。', mediaStatus: 'not_generated' };
  }
}

export function renderStoryboard(shots) {
  return shots.map(shot => `### ${shot.id} · ${shot.durationSeconds}秒\n目的：${shot.purpose}\n静态画面：${shot.moment}\n主体：${shot.subject}\n动作状态：${shot.action}\n构图：${shot.framing}；${shot.composition ?? ''}\n动态摄影：${JSON.stringify(shot.camera)}\n后期声音：${shot.postSound ?? ''}`).join('\n\n');
}
