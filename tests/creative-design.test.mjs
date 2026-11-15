import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCreativeKnowledge, listStylePresets, compileShotDesign, buildCreativeTaskPacket, validateImportedCandidate } from '../src/creative-design.mjs';

const fixture = () => ({
  version: 'fixture-0.4', manifest: { version: 'fixture-0.4' },
  imageRules: { rules: [{ id: 'IMG-01', rule: '先写一个瞬间', source_refs: ['P004'] }] },
  motion: {
    camera_vocabulary: [
      { id: 'CAM_FIXED', name: '固定', dimension: 'camera_motion', intent: '观察动作', source_anchors: ['T001'] },
      { id: 'CAM_DOLLY_IN', name: '推进', dimension: 'camera_motion', intent: '接近人物', source_anchors: ['T001'] },
      { id: 'CAM_PAN_TILT', name: '摇镜', dimension: 'camera_orientation', source_anchors: ['T001'] },
      { id: 'CAM_HANDHELD', name: '手持', dimension: 'camera_stability', source_anchors: ['T001'] },
      { id: 'LENS_ZOOM', name: '变焦', dimension: 'lens_change', source_anchors: ['T001'] },
      { id: 'VIEW_POV', name: '第一视角', dimension: 'viewpoint', source_anchors: ['T001'] },
      { id: 'CAM_DOLLY_ZOOM', name: '推进与反向变焦联动', dimension: 'compound_camera_lens', source_anchors: ['T001'] },
    ],
    general_rules: [{ id: 'M02_R04', rule: '静态和动态分开', source_anchors: ['P021', 'P022'] }],
  },
  directors: { directors: [
    { id: 'director-observer', name: '观察预设（隔离夹具）', manual_derived_rules: [{ id: 'manual-observer-still', stage: 'still_image', text: '仅本案例桌缘限定', source: { document: '手册夹具', paragraph_ids: ['P040'] }, case_only: true }, { id: 'manual-observer-sound', stage: 'editing_sound', text: '后期道具声在动作后进入', source: { document: '手册夹具', paragraph_ids: ['P042'] }, case_only: false }], variants: [{ id: 'observer', label: '固定远观', reference_works: ['隔离案例'], source_ids: ['fixture-source'], rules: { narrative: [{ id: 'observer.narrative.1', text: '关系通过行为表达', source_ids: ['fixture-source'] }], still_image: [{ id: 'observer.still.1', text: '人物与环境共同可读', source_ids: ['fixture-source'] }], motion: [{ id: 'observer.motion.1', text: '机位保持有动机', source_ids: ['fixture-source'] }], editing: [{ id: 'observer.edit.1', text: '动作结束后再切', source_ids: ['fixture-source'] }] } }] },
    { id: 'director-color', name: '色彩预设（隔离夹具）', variants: [{ id: 'color', label: '叙事色块', reference_works: ['隔离案例'], source_ids: ['fixture-source-2'], rules: { still_image: [{ id: 'color.still.1', text: '服装与环境组织少量色块', source_ids: ['fixture-source-2'] }], motion: [{ id: 'color.motion.1', text: '保持色块关系可读', source_ids: ['fixture-source-2'] }] } }] },
  ] }, workflow: { status: 'design_only' },
});
const input = () => ({
  projectId: 'project-test', episodeId: 'episode-01', sourceRevision: 3,
  inputHashes: { brief: 'real-brief-hash', script: 'real-script-hash' }, stylePresetId: 'observer',
  shot: { id: 'shot-01', purpose: '呈现等待', moment: '老人刚放下听筒', subject: '角色CHAR-01，灰蓝长衫', action: '手停在听筒旁', framing: '中景',
    composition: '人物位于左三分之一', foreground: '门框', midground: '老人和旧木桌', background: '窗外树和灰砖墙', focus: '手与下垂肩部',
    lighting: { source: '窗外阴天散射光', direction: '左侧', softness: '柔和' }, materials: ['旧木低光泽', '粗布有洗旧折痕'], palette: '灰蓝与少量暖灰', weather: '阴天', timeOfDay: '傍晚', durationSeconds: 6,
    camera: { motionId: 'CAM_FIXED', start: '中景老人', end: '中景老人', path: { mode: 'none' }, speed: '固定', subjectMotion: '手从听筒离开并停在桌上', environmentMotion: '窗外树叶轻动' },
  },
  locks: [{ path: 'shot.weather', value: '阴天' }, { path: 'shot.subject', value: '角色CHAR-01，灰蓝长衫' }],
  references: [{ id: 'CHAR-01', version: 'v1', attached: false }],
  providerCapabilities: { supportedParameters: ['quality'], parameters: { quality: 'high', bogus_style_weight: 99 }, negativePrompt: false },
});
const candidate = packet => ({ projectId: packet.projectId, episodeId: packet.episodeId, shotId: packet.shotId, inputHash: packet.inputHash, sourceRevision: packet.sourceRevision, rawText: '{"result":"PASS"}', sourceDeclaration: { platform: '用户声明的平台', model: '用户声明模型' } });

test('知识文件可加载且来源明确，不把手册或预设标记为已生成验收', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-knowledge-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const k = fixture();
  const files = { 'manifest.json': k.manifest, 'image-rules.json': k.imageRules, 'motion.json': k.motion, 'directors.json': k.directors, 'workflow.json': k.workflow, 'sources.json': { manuals: [{ id: 'M01', sha256: 'original-source-hash' }] }, 'source-anchors.json': { M01: ['P004'] }, 'source-links.json': { S01: ['M01'] } };
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(root, name), JSON.stringify(value));
  const loaded = loadCreativeKnowledge(root);
  assert.equal(loaded.version, 'fixture-0.4');
  assert.match(loaded.hash, /^[a-f0-9]{64}$/);
  assert.equal(listStylePresets(loaded).length, 2);
  const result = compileShotDesign(input(), loaded);
  assert.equal(result.structuralStatus, 'valid_draft');
  assert.equal(result.formalStageStatus, 'not_checked');
  assert.equal(result.mediaStatus, 'not_generated');
  assert.equal(result.semanticReviewRequired, true);
  assert.ok(result.appliedRules.some(rule => rule.sourceIds?.includes('fixture-source')));
  assert.ok(result.appliedRules.some(rule => rule.sourceRefs?.includes('P004')));
  assert.ok(result.appliedRules.every(rule => result[rule.target].includes(rule.id) && result[rule.target].includes(rule.text)));
  assert.ok(result.contextRules.some(rule => rule.id === 'observer.narrative.1'));
  assert.ok(!result.appliedRules.some(rule => rule.id === 'observer.narrative.1'));
  assert.deepEqual(result.motionEvidence.sourceRefs, ['T001']);
  for (const filename of ['sources.json', 'source-anchors.json', 'source-links.json']) {
    fs.writeFileSync(path.join(root, filename), JSON.stringify({ ...files[filename], changedSourceEvidence: true }));
    assert.notEqual(loadCreativeKnowledge(root).hash, loaded.hash, filename);
    fs.writeFileSync(path.join(root, filename), JSON.stringify(files[filename]));
    assert.equal(loadCreativeKnowledge(root).hash, loaded.hash, filename);
  }
});

test('真实知识库的画面、运动及显式导演手册规则均按实际ID进入对应提示词', () => {
  const knowledge = loadCreativeKnowledge(), a = input();
  a.stylePresetId = 'jiang.bullets.dialogue';
  a.manualRuleIds = ['M03.jiang_wen.2', 'M03.jiang_wen.3', 'M03.jiang_wen.4'];
  const result = compileShotDesign(a, knowledge);
  assert.equal(result.structuralStatus, 'valid_draft');
  for (const id of ['IMG-01', 'IMG-02', 'IMG-03', 'IMG-08', 'IMG-12', 'IMG-18', 'M03.jiang_wen.2']) {
    const rule = result.appliedRules.find(item => item.id === id);
    assert.equal(rule?.target, 'imagePrompt', id);
    assert.ok(rule.sourceRefs.length > 0, id);
    assert.ok(result.imagePrompt.includes(`[${id}] ${rule.text}`), id);
  }
  for (const id of ['M02_R01', 'M02_R02', 'M02_R04', 'M02_R06', 'M02_R11', 'M03.jiang_wen.3']) {
    const rule = result.appliedRules.find(item => item.id === id);
    assert.equal(rule?.target, 'videoPrompt', id);
    assert.ok(rule.sourceRefs.length > 0, id);
    assert.ok(result.videoPrompt.includes(`[${id}] ${rule.text}`), id);
  }
  const manualStill = result.appliedRules.find(item => item.id === 'M03.jiang_wen.2');
  assert.deepEqual(manualStill.sourceRefs, ['P035', 'P040']);
  assert.match(manualStill.sourceDocument, /十五位导演/);
  assert.ok(result.contextRules.some(item => item.id === 'M03.jiang_wen.4' && item.stage === 'editing_sound'));
  assert.ok(!result.appliedRules.some(item => item.id === 'M03.jiang_wen.4' || item.caseOnly));
  assert.ok(result.appliedRules.every(rule => result[rule.target].includes(rule.id) && result[rule.target].includes(rule.text)));
});

test('同一场景切换预设产生具体规则差异，人物天气与锁不被重写', () => {
  const k = fixture(), a = input(), before = structuredClone(a);
  const observer = compileShotDesign(a, k);
  const colored = compileShotDesign({ ...a, stylePresetId: 'color' }, k);
  assert.match(observer.imagePrompt, /人物与环境共同可读/);
  assert.match(colored.imagePrompt, /服装与环境组织少量色块/);
  assert.notEqual(observer.imagePrompt, colored.imagePrompt);
  for (const result of [observer, colored]) { assert.match(result.imagePrompt, /灰蓝长衫/); assert.match(result.imagePrompt, /阴天/); }
  assert.deepEqual(a, before);
});

test('单时刻图像与动态运动分开，修改路线不污染静态提示词', () => {
  const a = input(); a.shot.camera = { motionId: 'CAM_DOLLY_IN', start: '中景老人', end: '近景老人', path: '沿唯一轨迹TRACE-ROUTE向前推进', speed: '均速', subjectMotion: '抬起手TRACE-ACTION' };
  const result = compileShotDesign(a, fixture());
  assert.ok(!result.imagePrompt.includes('TRACE-ROUTE'));
  assert.ok(!result.imagePrompt.includes('TRACE-ACTION'));
  assert.match(result.videoPrompt, /TRACE-ROUTE/);
  assert.match(result.videoPrompt, /TRACE-ACTION/);
  assert.match(result.videoPrompt, /对白、旁白与背景音乐均不需要/);
});

test('动态焦点起落独立进入视频计划，与静态焦点和变焦分开', () => {
  const a = input(), before = compileShotDesign(a, fixture());
  a.shot.camera.focusPlan = { start: 'TRACE-FOCUS-START听筒', transition: '手离开时拉焦到脸', end: 'TRACE-FOCUS-END眼睛' };
  a.shot.camera.focalChange = { id: 'LENS_ZOOM', description: 'TRACE-ZOOM固定机位光学拉近' };
  const result = compileShotDesign(a, fixture());
  assert.equal(result.structuralStatus, 'valid_draft');
  assert.equal(result.imagePrompt, before.imagePrompt);
  assert.match(result.imagePrompt, /焦点：手与下垂肩部/);
  assert.ok(!result.imagePrompt.includes('TRACE-FOCUS'));
  assert.ok(!result.imagePrompt.includes('TRACE-ZOOM'));
  assert.match(result.videoPrompt, /动态焦点计划（起点／转移／落点）：.*TRACE-FOCUS-START听筒/);
  assert.match(result.videoPrompt, /手离开时拉焦到脸/);
  assert.match(result.videoPrompt, /TRACE-FOCUS-END眼睛/);
  assert.match(result.videoPrompt, /焦距或光学变化：TRACE-ZOOM固定机位光学拉近/);
  assert.ok(!result.videoPrompt.includes('焦点：手与下垂肩部'));
  a.shot.camera.focusPlan = '保持焦点于听筒，再随手转移到老人眼睛';
  assert.match(compileShotDesign(a, fixture()).videoPrompt, /动态焦点计划（起点／转移／落点）：保持焦点于听筒/);
});

test('视点、稳定性及变焦分别记录，不能当作相机位移', () => {
  const a = input(); a.shot.camera.viewpoint = { id: 'VIEW_POV', description: '人物第一视角' }; a.shot.camera.stability = { id: 'CAM_HANDHELD', description: '轻微手持' }; a.shot.camera.focalChange = { id: 'LENS_ZOOM', description: '保持机位不动，光学拉近' };
  const result = compileShotDesign(a, fixture());
  assert.equal(result.structuralStatus, 'valid_draft');
  assert.match(result.imagePrompt, /视点：人物第一视角/);
  assert.match(result.videoPrompt, /视点：人物第一视角/);
  assert.match(result.videoPrompt, /稳定性：轻微手持/);
  assert.match(result.videoPrompt, /焦距或光学变化：保持机位不动/);
  for (const bad of ['VIEW_POV', 'CAM_HANDHELD', 'LENS_ZOOM']) {
    const next = input(); next.shot.camera.motionId = bad;
    assert.ok(compileShotDesign(next, fixture()).findings.some(item => item.code === 'camera_dimension_mismatch' && item.severity === 'blocking'));
  }
});

test('复合运动须分阶段或给联动条件，固定机位不能声明环绕路径', () => {
  const a = input(); a.shot.camera = { motionId: 'CAM_DOLLY_ZOOM', start: '中景', end: '中景人物比例不变', path: '向前', speed: '缓慢' };
  assert.equal(compileShotDesign(a, fixture()).structuralStatus, 'blocked');
  a.shot.camera.linkage = '摄影机向前移动时同步减小焦距，人物画幅占比保持，背景透视变化';
  assert.equal(compileShotDesign(a, fixture()).structuralStatus, 'valid_draft');
  const fixed = input(); fixed.shot.camera.path = { mode: 'orbit' };
  assert.ok(compileShotDesign(fixed, fixture()).findings.some(item => item.code === 'fixed_camera_path_conflict'));
  for (const path of ['环绕360度', { waypoints: ['绕到人物身后'] }, {}, null]) {
    const next = input(); next.shot.camera.path = path;
    assert.ok(compileShotDesign(next, fixture()).findings.some(item => item.code === 'fixed_camera_path_conflict' && item.severity === 'blocking'));
  }
  for (const mode of ['none', 'fixed', 'stationary']) {
    const next = input(); next.shot.camera.path = { mode };
    assert.equal(compileShotDesign(next, fixture()).structuralStatus, 'valid_draft');
  }
  const omitted = input(); delete omitted.shot.camera.path;
  assert.equal(compileShotDesign(omitted, fixture()).structuralStatus, 'valid_draft');
});

test('锁冲突阻断且不偷偷改写输入，未知预设或运镜拒绝', () => {
  const a = input(); a.shot.weather = '暴雨';
  const result = compileShotDesign(a, fixture());
  assert.equal(result.structuralStatus, 'blocked');
  assert.equal(a.shot.weather, '暴雨');
  assert.ok(result.findings.some(item => item.code === 'locked_fact_conflict' && item.expected === '阴天' && item.actual === '暴雨'));
  assert.throws(() => compileShotDesign({ ...input(), stylePresetId: 'unknown' }, fixture()), err => err.code === 'unknown_style');
  const bad = input(); bad.shot.camera.motionId = 'NONEXISTENT';
  assert.throws(() => compileShotDesign(bad, fixture()), err => err.code === 'unknown_motion');
});

test('专属参数只按已声明支持项输出，附件引用不冒充已读内容', () => {
  const a = input(); a.shot.avoid = ['不要磨皮，保留自然肤色'];
  const result = compileShotDesign(a, fixture());
  assert.deepEqual(result.providerParameters, { quality: 'high' });
  assert.equal(result.negativePrompt, null);
  assert.ok(result.findings.some(item => item.code === 'unsupported_provider_parameter'));
  assert.ok(result.findings.some(item => item.code === 'reference_not_attached'));
  assert.match(result.imagePrompt, /仅引用，未附加/);
  a.providerCapabilities.negativePrompt = true;
  assert.match(compileShotDesign(a, fixture()).negativePrompt, /保留自然肤色/);
});

test('任务包快照可追溯且独立，模型PASS不会变成正式通过', () => {
  const a = input(), packet = buildCreativeTaskPacket(a, fixture());
  a.shot.subject = '之后的修改';
  assert.equal(packet.sourceSnapshot.shot.subject, '角色CHAR-01，灰蓝长衫');
  assert.equal(packet.attachments[0].attached, false);
  const imported = validateImportedCandidate(packet, { ...candidate(packet), formalStageStatus: 'PASS', semanticStatus: 'PASS' });
  assert.equal(imported.rawText, '{"result":"PASS"}');
  assert.equal(imported.formalStageStatus, 'not_checked');
  assert.equal(imported.semanticStatus, 'pending_review');
  assert.equal(imported.adoptionStatus, 'candidate_only');
  assert.equal(imported.originEvidence, 'user_declared_import');
  assert.equal(imported.freshnessStatus, 'packet_matched_only');
  assert.equal(imported.sourceDeclaration.platform, '用户声明的平台');
});

test('旧包和旧回答相互匹配，仍须核对最新上游、知识库及当前镜头设计Hash', () => {
  const packet = buildCreativeTaskPacket(input(), fixture());
  const current = { projectId: packet.projectId, episodeId: packet.episodeId, sourceRevision: packet.sourceRevision, inputHashes: packet.inputHashes, knowledgeHash: packet.knowledgeHash, inputHash: compileShotDesign(input(), fixture()).inputHash };
  assert.equal(validateImportedCandidate(packet, candidate(packet), current).freshnessStatus, 'current_context_matched');
  const changedShot = input(); changedShot.shot.moment = '老人拿起听筒';
  const changedStyle = { ...input(), stylePresetId: 'color' };
  for (const changed of [{ ...current, sourceRevision: 4 }, { ...current, inputHashes: { ...current.inputHashes, script: 'new-script-hash' } }, { ...current, knowledgeHash: 'changed-knowledge' }, { ...current, inputHash: compileShotDesign(changedShot, fixture()).inputHash }, { ...current, inputHash: compileShotDesign(changedStyle, fixture()).inputHash }]) {
    assert.throws(() => validateImportedCandidate(packet, candidate(packet), changed), err => err.code === 'stale_current_context');
  }
  for (const invalid of [undefined, '', ' ']) assert.throws(() => validateImportedCandidate(packet, candidate(packet), { ...current, inputHash: invalid }), err => err.code === 'invalid_current_context');
  assert.throws(() => validateImportedCandidate(packet, candidate(packet), {}), err => err.code === 'invalid_current_context');
});

test('手册导演扩展只显式选择，案例标范围，声音仅进入后期上下文', () => {
  const a = input(), k = fixture();
  const original = compileShotDesign(a, k);
  assert.ok(!original.imagePrompt.includes('仅本案例桌缘限定'));
  a.manualRuleIds = ['manual-observer-still', 'manual-observer-sound'];
  const selected = compileShotDesign(a, k);
  assert.match(selected.imagePrompt, /仅本案例桌缘限定/);
  assert.ok(selected.appliedRules.some(rule => rule.id === 'manual-observer-still' && rule.sourceRefs.includes('P040')));
  assert.ok(selected.findings.some(item => item.code === 'case_rule_scope_review'));
  assert.ok(!selected.videoPrompt.includes('后期道具声在动作后进入'));
  assert.ok(selected.contextRules.some(rule => rule.id === 'manual-observer-sound'));
  assert.throws(() => compileShotDesign({ ...a, stylePresetId: 'color' }, k), err => err.code === 'unknown_manual_rule');
});

test('过期Hash、错项目、缺原文及被改快照均拒绝导入，原稿不被写入', () => {
  const packet = buildCreativeTaskPacket(input(), fixture());
  assert.throws(() => validateImportedCandidate(packet, { ...candidate(packet), inputHash: 'old' }), err => err.code === 'stale_candidate');
  assert.throws(() => validateImportedCandidate(packet, { ...candidate(packet), sourceRevision: 2 }), err => err.code === 'stale_candidate');
  assert.throws(() => validateImportedCandidate(packet, { ...candidate(packet), projectId: 'another-project' }), err => err.code === 'candidate_identity_mismatch');
  assert.throws(() => validateImportedCandidate(packet, { ...candidate(packet), rawText: '' }), err => err.code === 'missing_raw_result');
  const changed = structuredClone(packet); changed.sourceSnapshot.shot.action = '改变动作';
  assert.throws(() => validateImportedCandidate(changed, candidate(changed)), err => err.code === 'invalid_packet');
  const blockedInput = input(); blockedInput.shot.weather = '雨夜';
  const blocked = buildCreativeTaskPacket(blockedInput, fixture());
  assert.throws(() => validateImportedCandidate(blocked, candidate(blocked)), err => err.code === 'blocked_packet');
});

test('时长仅检查设计值，字段Hash不依赖对象键顺序', () => {
  const a = input(), b = Object.fromEntries(Object.entries(input()).reverse());
  assert.equal(compileShotDesign(a, fixture()).inputHash, compileShotDesign(b, fixture()).inputHash);
  a.shot.durationSeconds = 0;
  const result = compileShotDesign(a, fixture());
  assert.ok(result.findings.some(item => item.code === 'invalid_duration'));
  assert.equal(result.mediaStatus, 'not_generated');
  assert.throws(() => compileShotDesign({ ...input(), inputHashes: {} }, fixture()), err => err.code === 'missing_input_hashes');
});
