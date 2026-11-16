/**
 * Pure creative-design core. No model, browser, account, media or stage-guard calls.
 *
 * loadCreativeKnowledge(root) reads manifest.json, image-rules.json, motion.json,
 * directors.json, workflow.json and the sources/source-anchors/source-links
 * provenance files. All these files contribute to the knowledge hash.
 * compileShotDesign accepts the documented
 * project/episode/source snapshot, a work-scoped stylePresetId and a single shot.
 * A shot camera has motionId plus separate viewpoint, stability and focalChange.
 * Its optional focusPlan is text or an object (e.g. {start,transition,end}) for
 * dynamic focus, distinct from the static shot.focus and optical focalChange.
 * Compound movement additionally needs phases or linkage. Locks use own-property
 * dot paths into this input, e.g. shot.weather. References are {id,version,attached}.
 * Provider parameters are allowlisted only; this module does not verify a provider.
 *
 * A valid_draft means structure/declarations passed these checks. It is never a
 * semantic, visual, formal-stage or media PASS. Model text cannot change that.
 * Import validation is not persistence: callers retain raw results before calling
 * it and supply a trusted task packet from their own storage. An optional third
 * currentContext argument requires the current project/episode/revision, upstream
 * hashes, knowledgeHash and a nonempty inputHash recompiled from the current shot
 * input (including style). Without it the result is only packet-matched. Callers
 * must derive this hash from current input, not copy it from an old task packet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AppError } from './store.mjs';

const defaultKnowledgeRoot = fileURLToPath(new URL('../knowledge/creative/', import.meta.url));
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const motionDimensions = new Set(['camera_motion', 'camera_orientation', 'camera_trajectory_mode', 'compound_camera_lens']);
const own = (value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const copy = value => structuredClone(value);

function error(message, code, status = 400) {
  const value = new AppError(message, status); value.code = code; return value;
}
function canonical(value, seen = new Set(), depth = 0) {
  if (depth > 35) throw error('设计资料层级过深。', 'invalid_input');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || seen.has(value)) throw error('设计资料须为有限、无循环的JSON值。', 'invalid_input');
  seen.add(value);
  let result;
  if (Array.isArray(value)) result = value.map(item => canonical(item, seen, depth + 1));
  else {
    result = {};
    for (const key of Object.keys(value).sort()) {
      if (forbiddenKeys.has(key)) throw error('设计资料包含无效字段。', 'invalid_input');
      if (value[key] !== undefined) result[key] = canonical(value[key], seen, depth + 1);
    }
  }
  seen.delete(value); return result;
}
function digest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function jsonRead(root, filename) {
  try { return JSON.parse(fs.readFileSync(path.join(root, filename), 'utf8')); }
  catch (cause) { throw error(`创作知识文件 ${filename} 无法读取或解析：${cause.message}`, 'knowledge_unavailable', 503); }
}
function sourceArray(value) { return Array.isArray(value) ? value : []; }
function text(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  return JSON.stringify(canonical(value));
}
function line(label, value) { const content = text(value); return content ? `${label}：${content}` : null; }
function dimensionValue(value) {
  if (object(value)) return text(value.description ?? value.text ?? value.name ?? value.id);
  return text(value);
}
function readPath(input, fieldPath) {
  if (!nonempty(fieldPath)) throw error('锁定项须提供字段路径。', 'invalid_lock');
  const keys = fieldPath.split('.');
  if (keys.some(key => !/^[a-zA-Z0-9_-]+$/.test(key) || forbiddenKeys.has(key))) throw error('锁定项字段路径不正确。', 'invalid_lock');
  let value = input;
  for (const key of keys) { if (!own(value, key)) return { exists: false }; value = value[key]; }
  return { exists: true, value };
}
function snapshot(input) {
  if (!object(input)) throw error('设计输入须为JSON对象。', 'invalid_input');
  const value = canonical(input);
  if (JSON.stringify(value).length > 300000) throw error('设计资料过大。', 'invalid_input');
  return value;
}

export function loadCreativeKnowledge(root = defaultKnowledgeRoot) {
  const manifest = jsonRead(root, 'manifest.json');
  const imageRules = jsonRead(root, 'image-rules.json');
  const motion = jsonRead(root, 'motion.json');
  const directors = jsonRead(root, 'directors.json');
  const workflow = jsonRead(root, 'workflow.json');
  const provenance = { sources: jsonRead(root, 'sources.json'), sourceAnchors: jsonRead(root, 'source-anchors.json'), sourceLinks: jsonRead(root, 'source-links.json') };
  if (!object(manifest) || !Array.isArray(imageRules.rules) || !Array.isArray(motion.camera_vocabulary) || !Array.isArray(directors.directors) || !object(workflow)) throw error('创作知识结构不完整。', 'knowledge_invalid', 503);
  const knowledge = { manifest, imageRules, motion, directors, workflow, provenance };
  knowledge.version = text(manifest.version ?? manifest.schema_version ?? directors.schema_version) || 'unversioned';
  knowledge.hash = digest(knowledge);
  // Reject ambiguous style/motion references rather than silently choosing one.
  const styles = listStylePresets(knowledge);
  if (new Set(styles.map(item => item.id)).size !== styles.length || new Set(motion.camera_vocabulary.map(item => item.id)).size !== motion.camera_vocabulary.length) throw error('创作知识存在重复标识。', 'knowledge_invalid', 503);
  return knowledge;
}

export function listStylePresets(knowledge) {
  if (!Array.isArray(knowledge?.directors?.directors)) throw error('导演知识结构不完整。', 'knowledge_invalid', 503);
  return knowledge.directors.directors.flatMap(director => sourceArray(director.variants).map(preset => ({
    id: preset.id, label: preset.label, directorId: director.id, directorName: director.name,
    referenceWorks: copy(preset.reference_works ?? []), sourceIds: copy(preset.source_ids ?? []),
    status: preset.status ?? 'design_candidate', rules: copy(preset.rules ?? {}),
    pitfalls: copy(preset.pitfalls ?? []), manualDerivedRules: copy(director.manual_derived_rules ?? []),
  })));
}

function findMotion(knowledge, id) {
  const entry = knowledge?.motion?.camera_vocabulary?.find(item => item.id === id);
  if (!entry) throw error(`未知运镜或摄影维度标识：${id ?? '未填写'}`, 'unknown_motion');
  return entry;
}
function validateAxis(value, expected, fieldPath, knowledge, findings) {
  if (!object(value) || !value.id) return;
  const entry = findMotion(knowledge, value.id);
  if (entry.dimension !== expected) findings.push({ code: 'camera_dimension_mismatch', severity: 'blocking', path: fieldPath, message: `${entry.name} 属于 ${entry.dimension}，应在对应维度填写，不能充当 ${expected}。` });
}
function selectedRules(preset, knowledge, input) {
  const rows = [];
  for (const kind of ['narrative', 'still_image', 'motion', 'editing']) {
    for (const rule of sourceArray(preset.rules[kind])) rows.push({ id: rule.id, stage: kind, text: rule.text, origin: rule.origin ?? 'editorial_design', sourceIds: copy(rule.source_ids ?? preset.sourceIds) });
  }
  // Include only a small, explicit subset of the general manual rules per shot.
  const desired = new Set(['IMG-01', 'IMG-02', 'IMG-03', 'IMG-08', 'IMG-12', 'IMG-18']);
  for (const rule of sourceArray(knowledge.imageRules?.rules).filter(item => desired.has(item.id))) rows.push({ id: rule.id, stage: 'image_guidance', text: rule.rule, origin: 'user_manual_translation', sourceDocument: knowledge.imageRules.source_document ?? null, sourceRefs: copy(rule.source_refs ?? []) });
  for (const rule of sourceArray(knowledge.motion?.general_rules).filter(item => ['M02_R01', 'M02_R02', 'M02_R04', 'M02_R06', 'M02_R11'].includes(item.id))) rows.push({ id: rule.id, stage: 'motion_guidance', text: rule.rule, origin: 'user_manual_translation', sourceDocument: knowledge.motion.source_file ?? null, sourceRefs: copy(rule.source_anchors ?? []) });
  if (input.manualRuleIds !== undefined && (!Array.isArray(input.manualRuleIds) || input.manualRuleIds.some(id => !nonempty(id)))) throw error('manualRuleIds须为规则ID数组。', 'invalid_manual_rules');
  const requested = input.manualRuleIds ?? [];
  if (new Set(requested).size !== requested.length) throw error('手册扩展规则重复。', 'invalid_manual_rules');
  for (const id of requested) {
    const rule = preset.manualDerivedRules.find(item => item.id === id);
    if (!rule) throw error(`规则 ${id} 不属于当前导演或未在知识库中定义。`, 'unknown_manual_rule');
    rows.push({ id: rule.id, stage: rule.stage, text: rule.text, origin: 'explicitly_selected_handbook_extension', sourceDocument: rule.source?.document ?? null, sourceRefs: copy(rule.source?.paragraph_ids ?? []), secondaryRecordIds: copy(rule.source?.secondary_record_ids ?? []), caseOnly: rule.case_only === true, status: rule.status ?? 'design_candidate' });
  }
  return rows;
}

export function compileShotDesign(rawInput, knowledge) {
  const input = snapshot(rawInput);
  for (const key of ['projectId', 'episodeId', 'stylePresetId']) if (!nonempty(input[key])) throw error(`请填写 ${key}。`, 'missing_field');
  if (!Number.isInteger(input.sourceRevision) || input.sourceRevision < 0) throw error('sourceRevision须为非负整数。', 'missing_revision');
  if (!object(input.inputHashes) || !Object.keys(input.inputHashes).length || Object.values(input.inputHashes).some(value => !nonempty(value))) throw error('请提供实际上游输入Hash。', 'missing_input_hashes');
  if (!object(input.shot)) throw error('请提供单镜头shot。', 'missing_shot');
  const shot = input.shot;
  for (const key of ['id', 'purpose', 'moment', 'subject', 'action', 'framing']) if (!nonempty(shot[key])) throw error(`请填写 shot.${key}。`, 'missing_field');
  if (!object(shot.camera)) throw error('请提供独立的摄影运动计划。', 'missing_camera');
  const preset = listStylePresets(knowledge).find(item => item.id === input.stylePresetId);
  if (!preset) throw error(`未知作品级风格预设：${input.stylePresetId}`, 'unknown_style');
  const motion = findMotion(knowledge, shot.camera.motionId);
  const findings = [];
  if (!motionDimensions.has(motion.dimension)) findings.push({ code: 'camera_dimension_mismatch', severity: 'blocking', path: 'shot.camera.motionId', message: `${motion.name}属于${motion.dimension}。请将它与实际相机位移／朝向分别填写。` });
  validateAxis(shot.camera.viewpoint, 'viewpoint', 'shot.camera.viewpoint', knowledge, findings);
  validateAxis(shot.camera.stability, 'camera_stability', 'shot.camera.stability', knowledge, findings);
  validateAxis(shot.camera.focalChange, 'lens_change', 'shot.camera.focalChange', knowledge, findings);
  if (typeof shot.durationSeconds !== 'number' || !Number.isFinite(shot.durationSeconds) || shot.durationSeconds <= 0) findings.push({ code: 'invalid_duration', severity: 'blocking', path: 'shot.durationSeconds', message: '镜头设计时长须为大于0的有限秒数；它不是实际媒体实测时长。' });
  if (motion.dimension === 'compound_camera_lens' && !(Array.isArray(shot.camera.phases) && shot.camera.phases.length >= 2) && !nonempty(shot.camera.linkage)) findings.push({ code: 'compound_plan_required', severity: 'blocking', path: 'shot.camera', message: '复合运镜需要明确分阶段或相机与焦距的联动条件。' });
  if (shot.camera.motionId === 'CAM_FIXED' && own(shot.camera, 'path') && !(object(shot.camera.path) && ['none', 'fixed', 'stationary'].includes(shot.camera.path.mode))) findings.push({ code: 'fixed_camera_path_conflict', severity: 'blocking', path: 'shot.camera.path', message: '固定机位仅接受省略路径或明确的{mode:none/fixed/stationary}，自由路径与固定机位冲突；请明确选择或分阶段。' });
  if (shot.camera.motionId !== 'CAM_FIXED' && (!text(shot.camera.start) || !text(shot.camera.end) || !text(shot.camera.path))) findings.push({ code: 'motion_plan_incomplete', severity: 'blocking', path: 'shot.camera', message: '运动镜头须写明起幅、路径和落幅。' });
  if (input.locks !== undefined && !Array.isArray(input.locks)) throw error('locks须为锁定项数组。', 'invalid_lock');
  if (input.references !== undefined && !Array.isArray(input.references)) throw error('references须为实际参考素材数组。', 'invalid_reference');
  if (shot.materials !== undefined && (!Array.isArray(shot.materials) || shot.materials.some(value => !nonempty(value)))) throw error('shot.materials须为材质说明数组。', 'invalid_input');
  const locks = sourceArray(input.locks);
  for (const lock of locks) {
    if (!object(lock) || !Object.hasOwn(lock, 'value')) throw error('锁定项须包含path与value。', 'invalid_lock');
    const actual = readPath(input, lock.path);
    if (!actual.exists || digest(actual.value) !== digest(lock.value)) findings.push({ code: 'locked_fact_conflict', severity: 'blocking', path: lock.path, message: `输入与锁定事实 ${lock.path} 不一致。保留原输入并停止交付，不能由风格覆盖。`, expected: copy(lock.value), actual: actual.exists ? copy(actual.value) : null });
  }
  const references = sourceArray(input.references);
  if (references.some(ref => !object(ref) || !nonempty(ref.id) || !nonempty(ref.version) || typeof ref.attached !== 'boolean')) throw error('参考素材须分别提供id、version和实际附件状态attached。', 'invalid_reference');
  if (new Set(references.map(ref => `${ref.id}@${ref.version}`)).size !== references.length) throw error('参考素材引用重复。', 'invalid_reference');
  for (const ref of references.filter(item => !item.attached)) findings.push({ code: 'reference_not_attached', severity: 'warning', path: 'references', message: `${ref.id}@${ref.version} 仅被引用，尚未实际附加；不得声称模型已读。` });
  const capabilities = input.providerCapabilities ?? {};
  if (!object(capabilities)) throw error('providerCapabilities格式不正确。', 'invalid_capabilities');
  if (capabilities.supportedParameters !== undefined && (!Array.isArray(capabilities.supportedParameters) || capabilities.supportedParameters.some(value => !nonempty(value)))) throw error('supportedParameters须为已核实的参数名数组。', 'invalid_capabilities');
  if (capabilities.parameters !== undefined && !object(capabilities.parameters)) throw error('parameters须为参数对象。', 'invalid_capabilities');
  if (capabilities.negativePrompt !== undefined && typeof capabilities.negativePrompt !== 'boolean') throw error('negativePrompt须明确为布尔值。', 'invalid_capabilities');
  const parameters = {};
  const supported = new Set(sourceArray(capabilities.supportedParameters));
  for (const [key, value] of Object.entries(capabilities.parameters ?? {})) {
    if (supported.has(key)) parameters[key] = copy(value);
    else findings.push({ code: 'unsupported_provider_parameter', severity: 'warning', path: `providerCapabilities.parameters.${key}`, message: `${key} 未列在目标接口已核实支持项中，未输出该专属参数。` });
  }
  const avoid = sourceArray(shot.avoid).filter(nonempty);
  const referenceText = references.map(ref => `${ref.id}@${ref.version}（${ref.attached ? '调用方声明已附加，仍需实际输入回执核对' : '仅引用，未附加'}）`).join('；');
  const lockText = locks.map(lock => `${lock.path}=${text(lock.value)}`).join('；');
  const ruleRows = selectedRules(preset, knowledge, input);
  const imageRules = ruleRows.filter(rule => ['still_image', 'image_guidance'].includes(rule.stage)).map(rule => ({ ...rule, target: 'imagePrompt' }));
  const videoRules = ruleRows.filter(rule => ['motion', 'motion_guidance'].includes(rule.stage)).map(rule => ({ ...rule, target: 'videoPrompt' }));
  const contextRules = ruleRows.filter(rule => !['still_image', 'image_guidance', 'motion', 'motion_guidance'].includes(rule.stage));
  for (const rule of ruleRows.filter(rule => rule.caseOnly)) findings.push({ code: 'case_rule_scope_review', severity: 'warning', path: 'manualRuleIds', message: `${rule.id} 是显式选择的案例限定扩展，需核对当前场景是否适用，不能泛化为导演固定技法。` });
  const imagePrompt = [
    '生成本镜头一个明确时刻的静态分镜图。下列内容为待执行设计，不代表已经生成或验收。',
    line('镜头目的', shot.purpose), line('叙事瞬间', shot.moment), line('主体', shot.subject), line('此刻的动作状态', shot.action),
    line('情绪', shot.emotion), line('景别', shot.framing), line('视点', dimensionValue(shot.camera.viewpoint)), line('构图与人物占位', shot.composition),
    line('前景', shot.foreground), line('中景', shot.midground), line('后景', shot.background), line('焦点', shot.focus),
    line('光源', shot.lighting?.source), line('光线方向', shot.lighting?.direction), line('光线软硬', shot.lighting?.softness),
    line('材质与使用痕迹', sourceArray(shot.materials).join('；')), line('色彩', shot.palette), line('天气', shot.weather), line('时间', shot.timeOfDay),
    line('本镜实际采用的画面规则', imageRules.map(rule => `[${rule.id}] ${rule.text}`).join('；')), line('必须保留的声明锁', lockText), line('参考素材', referenceText),
    avoid.length ? `针对本镜头的避免项：${avoid.join('；')}。保留以上正向状态。` : null,
    '仅描述选定时刻；相机路线、变焦联动、切镜和声音计划见独立视频提示词。规则冲突时锁定事实优先，交由创作者处理。',
  ].filter(Boolean).join('\n');
  const videoPrompt = [
    '依据本镜头实际选定并附加的分镜图制作视频；执行器须先核对真实素材，以下不表示素材已发送。',
    line('镜头目的', shot.purpose), line('设计时长秒', shot.durationSeconds), line('起幅', shot.camera.start ?? shot.moment),
    line('相机运动或朝向', `${motion.name}；${motion.intent ?? ''}`), line('路径', shot.camera.path), line('速度与停稳', shot.camera.speed),
    line('落幅', shot.camera.end), line('主体动作进程', shot.camera.subjectMotion ?? shot.action), line('环境运动', shot.camera.environmentMotion),
    line('视点', dimensionValue(shot.camera.viewpoint)), line('稳定性', dimensionValue(shot.camera.stability)), line('焦距或光学变化', dimensionValue(shot.camera.focalChange)),
    line('动态焦点计划（起点／转移／落点）', shot.camera.focusPlan),
    line('分阶段运动', shot.camera.phases), line('联动条件', shot.camera.linkage),
    line('本镜实际采用的运动规则', videoRules.map(rule => `[${rule.id}] ${rule.text}`).join('；')), line('必须保留的声明锁', lockText), line('参考素材', referenceText),
    '对白、旁白与背景音乐均不需要。关闭音轨的实际方式由已验证的模型适配器决定；本设计不保证某个模型支持同名参数。',
    '保持人物、服装、场景锚点和光线连续。依据实际结果检查动作、空间与运镜，不以提示词名称作为成功证据。',
  ].filter(Boolean).join('\n');
  const structuralStatus = findings.some(item => item.severity === 'blocking') ? 'blocked' : 'valid_draft';
  return {
    schemaVersion: '0.4.0', projectId: input.projectId, episodeId: input.episodeId, sourceRevision: input.sourceRevision,
    shotId: shot.id, inputHash: digest(input), inputHashes: copy(input.inputHashes),
    knowledgeVersion: knowledge.version ?? knowledge.manifest?.version ?? knowledge.manifest?.schema_version ?? 'unversioned', knowledgeHash: knowledge.hash ?? digest(knowledge),
    style: { id: preset.id, directorId: preset.directorId, directorName: preset.directorName, label: preset.label, referenceWorks: preset.referenceWorks, status: preset.status },
    imagePrompt, videoPrompt, providerParameters: parameters,
    negativePrompt: capabilities.negativePrompt === true && avoid.length ? avoid.join('；') : null,
    appliedRules: [...imageRules, ...videoRules], contextRules, motionEvidence: { id: motion.id, dimension: motion.dimension, sourceRefs: copy(motion.source_anchors ?? []) },
    findings, structuralStatus, semanticReviewRequired: true, formalStageStatus: 'not_checked', mediaStatus: 'not_generated',
    validationScope: '结构及显式声明检查；不代表叙事、视觉、正式阶段、工具能力或媒体验收通过。',
  };
}

export function buildCreativeTaskPacket(rawInput, knowledge) {
  const input = snapshot(rawInput), design = compileShotDesign(input, knowledge);
  return {
    schemaVersion: '0.4.0', taskKind: 'creative_shot_design', stage: 'drama-visual',
    projectId: design.projectId, episodeId: design.episodeId, shotId: design.shotId,
    sourceRevision: design.sourceRevision, inputHash: design.inputHash, inputHashes: design.inputHashes,
    knowledgeVersion: design.knowledgeVersion, knowledgeHash: design.knowledgeHash,
    sourceSnapshot: input, attachments: copy(input.references ?? []),
    design, reviewRequired: true, formalStageStatus: 'not_checked',
    responseContract: { required: ['projectId', 'episodeId', 'shotId', 'inputHash', 'sourceRevision', 'rawText'], note: '回答中的PASS仅为模型或用户文字；正式岗位verify与账本由工作区适配器独立执行。' },
  };
}

export function validateImportedCandidate(packet, candidate, currentContext) {
  if (!object(packet) || !object(packet.sourceSnapshot) || !object(packet.design)) throw error('任务包结构不完整。', 'invalid_packet');
  if (packet.inputHash !== digest(packet.sourceSnapshot) || packet.design.inputHash !== packet.inputHash || packet.sourceSnapshot.projectId !== packet.projectId || packet.sourceSnapshot.episodeId !== packet.episodeId || packet.sourceSnapshot.shot?.id !== packet.shotId || packet.sourceSnapshot.sourceRevision !== packet.sourceRevision) throw error('任务包快照或绑定已改变，请重新准备。', 'invalid_packet', 409);
  if (!object(candidate) || !nonempty(candidate.rawText)) throw error('导入须保留非空原始回答。', 'missing_raw_result');
  if (candidate.rawText.length > 150000) throw error('导入原文过长。', 'invalid_input');
  for (const key of ['projectId', 'episodeId', 'shotId']) if (candidate[key] !== packet[key]) throw error(`导入结果 ${key} 与任务包不一致。`, 'candidate_identity_mismatch', 409);
  if (candidate.inputHash !== packet.inputHash || candidate.sourceRevision !== packet.sourceRevision) throw error('导入回答基于过期输入或版本；调用方应保留原文，不得覆盖当前正式稿。', 'stale_candidate', 409);
  if (currentContext !== undefined) {
    if (!object(currentContext) || !nonempty(currentContext.projectId) || !nonempty(currentContext.episodeId) || !Number.isInteger(currentContext.sourceRevision) || !object(currentContext.inputHashes) || !nonempty(currentContext.knowledgeHash) || !nonempty(currentContext.inputHash)) throw error('当前上下文须提供项目、分集、revision、上游Hash、知识库Hash和当前镜头输入重新编译所得inputHash。', 'invalid_current_context');
    if (currentContext.projectId !== packet.projectId || currentContext.episodeId !== packet.episodeId || currentContext.sourceRevision !== packet.sourceRevision || digest(currentContext.inputHashes) !== digest(packet.inputHashes) || currentContext.knowledgeHash !== packet.knowledgeHash || currentContext.inputHash !== packet.inputHash) throw error('当前上游、设计或知识库已经变化；旧包和旧回答即使彼此匹配也不能采用。', 'stale_current_context', 409);
  }
  if (packet.design.structuralStatus !== 'valid_draft') throw error('原任务包有未解决的结构或锁冲突，请先修正。', 'blocked_packet', 409);
  return {
    projectId: packet.projectId, episodeId: packet.episodeId, shotId: packet.shotId,
    sourceRevision: packet.sourceRevision, inputHash: packet.inputHash, knowledgeVersion: packet.knowledgeVersion,
    rawText: candidate.rawText, sourceDeclaration: copy(candidate.sourceDeclaration ?? null),
    originEvidence: 'user_declared_import', formatStatus: 'identity_and_snapshot_valid',
    freshnessStatus: currentContext === undefined ? 'packet_matched_only' : 'current_context_matched',
    semanticStatus: 'pending_review', adoptionStatus: 'candidate_only', formalStageStatus: 'not_checked',
    note: `${currentContext === undefined ? '仅核对所给任务包，未核对最新上游。' : '已与调用方提供的当前上下文比较。'}结构绑定有效不等于内容通过；未运行正式guard、未发布、未调用任何模型或媒体服务。`,
  };
}
