import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { CreativeService } from '../src/creative-jobs.mjs';
import { entityFacts } from '../src/entity-provenance.mjs';
import { fixtureIdea, fixtureSubject, fixtureEntities, fixtureShots, fixtureResult, isolatedRunner } from './creative-fixtures.mjs';

const artifacts = path.resolve('tests/.artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(artifacts, 'creative-workbench-'));
  const store = new Store(root), calls = [];
  const knowledgeRoot = path.join(root, 'knowledge');
  fs.cpSync(new URL('../knowledge/creative/', import.meta.url), knowledgeRoot, { recursive: true });
  const service = new CreativeService(store, { runner: isolatedRunner(calls), knowledgeRoot, ...options });
  t.after(() => service.close());
  const project = store.create({ name: '[隔离测试] 30秒三镜头双预设', idea: fixtureIdea, durationSeconds: 30 });
  return { root, store, service, project, calls, knowledgeRoot };
}
function current(ctx) { return ctx.service.view(ctx.project.id); }
function update(ctx, fields) { const ws = current(ctx); return ctx.service.update(ctx.project.id, { revision: ws.revision, ...fields }); }
function start(ctx, kind, more = {}) { const ws = current(ctx); return ctx.service.start(ctx.project.id, { revision: ws.revision, projectRevision: ws.project.revision, kind, ...more }); }
async function finished(ctx, job) {
  for (let n = 0; n < 100; n++) {
    const task = ctx.store.read('creative-jobs', job.id);
    if (!['queued', 'running'].includes(task.status)) return task;
    await pause(10);
  }
  throw new Error('隔离文字任务未结束');
}
async function script(ctx) { const task = await finished(ctx, start(ctx, 'script')); assert.equal(task.status, 'succeeded', task.error); return task; }
async function storyboard(ctx, scriptTaskId) { const task = await finished(ctx, start(ctx, 'storyboard', { scriptTaskId })); assert.equal(task.status, 'succeeded', task.error); return task; }
function adopt(ctx, task) { const ws = current(ctx); return ctx.service.adopt(ctx.project.id, { revision: ws.revision, projectRevision: ws.project.revision, taskId: task.id, confirmPendingSources: true }); }

test('Codex文字路线不依赖即梦报价，重复点击只执行一次；30秒三镜头与独立审阅分开保存', async t => {
  const ctx = fixture(t);
  update(ctx, { locks: [{ path: 'shot.weather', value: '阴天' }, { path: 'shot.subject', value: fixtureSubject }] });
  const first = start(ctx, 'script'), repeated = start(ctx, 'script');
  assert.equal(first.id, repeated.id);
  const generated = await finished(ctx, first);
  assert.equal(generated.status, 'succeeded', generated.error);
  assert.equal(ctx.calls.length, 1);
  assert.equal(start(ctx, 'script').id, first.id);
  update(ctx, { stylePresetId: 'jia.platform.distance', shots: fixtureShots() });
  const board = await storyboard(ctx, first.id);
  const review = await finished(ctx, start(ctx, 'review', { targetTaskId: board.id }));
  assert.equal(review.status, 'succeeded', review.error);
  assert.notEqual(review.threadId, generated.threadId);
  assert.notEqual(review.threadId, board.threadId);
  const ws = current(ctx);
  assert.equal(ws.reviews.length, 1);
  assert.equal(board.result.shots.length, 3);
  assert.equal(board.result.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0), 30);
  assert.ok(board.result.shots.every(shot => shot.weather === '阴天' && shot.subject === fixtureSubject));
  assert.equal(ws.versions.length, 0, '成功生成和模型PASS都不能自动采用');
  assert.ok(fs.existsSync(ctx.store.file('creative-jobs', review.id)));
});

test('同一三镜头切换两个作品级预设：规则有差异、人物天气锁保留、静态不混入运动和后期', async t => {
  const ctx = fixture(t);
  update(ctx, { locks: [{ path: 'shot.weather', value: '阴天' }] });
  const generated = await script(ctx);
  update(ctx, { selectedScriptTaskId: generated.id, shots: fixtureShots(), stylePresetId: 'jia.platform.distance' });
  const first = current(ctx).compiled;
  update(ctx, { stylePresetId: 'anderson.budapest.order' });
  const second = current(ctx).compiled;
  assert.equal(first.length, 3); assert.equal(second.length, 3);
  assert.notEqual(first[0].design.imagePrompt, second[0].design.imagePrompt);
  for (const shot of second) {
    assert.match(shot.design.imagePrompt, /灰蓝长衫/);
    assert.match(shot.design.imagePrompt, /阴天/);
    assert.match(shot.design.videoPrompt, /对白、旁白与背景音乐均不需要/);
    assert.equal(shot.design.formalStageStatus, 'not_checked');
    assert.equal(shot.design.mediaStatus, 'not_generated');
    assert.ok(!shot.design.appliedRules.some(rule => rule.origin === 'explicitly_selected_handbook_extension'));
  }
  const shots = fixtureShots();
  shots[0].camera = { ...shots[0].camera, motionId: 'CAM_DOLLY_IN', path: 'TRACE-ROUTE独立向前推进', start: '中景', end: '近景', subjectMotion: 'TRACE-ACTION缓缓抬手' };
  shots[0].postSound = 'TRACE-POST后期杯碟音效';
  update(ctx, { shots });
  const design = current(ctx).compiled[0].design;
  assert.ok(!design.imagePrompt.includes('TRACE-ROUTE'));
  assert.ok(!design.imagePrompt.includes('TRACE-ACTION'));
  assert.ok(!design.imagePrompt.includes('TRACE-POST'));
  assert.match(design.videoPrompt, /TRACE-ROUTE/);
  assert.ok(!design.videoPrompt.includes('TRACE-POST'));
  await storyboard(ctx, generated.id);
});

test('人工修改只追加不可变版本；采用候选后仍保留人工原文与备份', async t => {
  const ctx = fixture(t), generated = await script(ctx);
  let ws = current(ctx);
  ctx.service.addVersion(ctx.project.id, { revision: ws.revision, kind: 'script', body: '【人工原稿】逐字保留，不因模型候选覆盖。' });
  ws = current(ctx);
  ctx.service.addVersion(ctx.project.id, { revision: ws.revision, kind: 'script', body: '【人工修改稿】逐字保留，第二个不可变版本。' });
  const before = current(ctx), oldVersions = structuredClone(before.versions);
  adopt(ctx, generated);
  ws = current(ctx);
  assert.equal(ws.versions.length, 3);
  assert.deepEqual(ws.versions.slice(0, 2), oldVersions);
  assert.equal(ws.versions[2].origin, 'codex-cli');
  const backup = JSON.parse(fs.readFileSync(ctx.store.file('creative-workspaces', ctx.project.id) + '.bak', 'utf8'));
  assert.equal(backup.revision, before.revision);
  assert.equal(backup.versions.length, 2);
  assert.equal(backup.versions[1].body, '【人工修改稿】逐字保留，第二个不可变版本。');
  assert.throws(() => adopt(ctx, generated), error => error.status === 409);
});

test('采用时重读项目要求，拒绝上游新要求且逐字保留人工稿和原始任务结果', async t => {
  const ctx = fixture(t), generated = await script(ctx);
  const ws = current(ctx);
  ctx.service.addVersion(ctx.project.id, { revision: ws.revision, kind: 'script', body: '【人工保留】当前用户稿。' });
  ctx.store.update(ctx.project.id, { revision: ctx.project.revision, idea: fixtureIdea + ' 新要求：电话必须保持红色。' });
  const file = ctx.store.file('creative-workspaces', ctx.project.id), bytes = fs.readFileSync(file, 'utf8');
  assert.throws(() => adopt(ctx, generated), error => error.status === 409);
  assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  assert.equal(ctx.store.read('creative-jobs', generated.id).result.body, generated.result.body);
  assert.equal(current(ctx).tasks.find(task => task.id === generated.id).stale, true);
});

for (const change of ['shot', 'style', 'knowledge']) test(`采用时重新编译当前${change}Hash，旧任务包与回答匹配也不能覆盖当前稿`, async t => {
  const ctx = fixture(t), generated = await script(ctx);
  update(ctx, { selectedScriptTaskId: generated.id, shots: fixtureShots(), stylePresetId: 'jia.platform.distance' });
  const board = await storyboard(ctx, generated.id);
  const ws = current(ctx);
  ctx.service.addVersion(ctx.project.id, { revision: ws.revision, kind: 'storyboard', body: '【人工分镜】保留这份正文。' });
  // Keep revision unchanged: this specifically verifies storage recompilation, not only optimistic revision checks.
  if (change === 'knowledge') {
    const file = path.join(ctx.knowledgeRoot, 'sources.json');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    value.evidence_policy.source_fact += '【来源记录已改变】';
    fs.writeFileSync(file, JSON.stringify(value));
  } else {
    const value = ctx.store.read('creative-workspaces', ctx.project.id);
    if (change === 'shot') value.shots[0].moment += '【新的叙事瞬间】';
    else value.stylePresetId = 'anderson.budapest.order';
    ctx.store.write('creative-workspaces', value);
  }
  const file = ctx.store.file('creative-workspaces', ctx.project.id), bytes = fs.readFileSync(file, 'utf8');
  assert.throws(() => adopt(ctx, board), error => error.status === 409);
  assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  assert.equal(current(ctx).versions.at(-1).body, '【人工分镜】保留这份正文。');
  assert.equal(current(ctx).tasks.find(task => task.id === board.id).stale, true);
});

test('上游、风格及镜头改变后旧独立报告需复核；模型PASS仍不能成为正式岗位PASS', async t => {
  const ctx = fixture(t), generated = await script(ctx);
  update(ctx, { shots: fixtureShots(), stylePresetId: 'jia.platform.distance' });
  const board = await storyboard(ctx, generated.id);
  const review = await finished(ctx, start(ctx, 'review', { targetTaskId: board.id }));
  assert.equal(review.status, 'succeeded', review.error);
  assert.equal(current(ctx).reviews[0].needsReview, false);
  update(ctx, { instructions: '【新的用户锁】不能再使用空椅子近景。' });
  assert.equal(current(ctx).reviews[0].needsReview, true);
  assert.equal(current(ctx).versions.length, 0);
});

test('没有真实成功终态时保留原文并失败，不把看似完整的JSON当作成功或自动重提', async t => {
  const calls = [];
  const ctx = fixture(t, { runner: async options => {
    calls.push(options);
    return { exitCode: 0, completed: false, finalMessage: JSON.stringify(fixtureResult(options.schema)), threadId: 'incomplete-fixture-thread' };
  } });
  const task = await finished(ctx, start(ctx, 'script'));
  assert.equal(task.status, 'failed');
  assert.equal(current(ctx).versions.length, 0);
  assert.equal(start(ctx, 'script').id, task.id);
  assert.equal(calls.length, 1);
  assert.throws(() => adopt(ctx, task), error => error.status === 409);
});

test('候选显式违反人物天气锁时拒绝，保存原始模型结果和人工分镜', async t => {
  const ctx = fixture(t, { runner: async options => {
    const result = fixtureResult(options.schema);
    if (result.shots) result.shots[0].weather = '暴雨';
    return { exitCode: 0, completed: true, finalMessage: JSON.stringify(result), threadId: 'conflicting-fixture-thread' };
  } });
  update(ctx, { locks: [{ path: 'shot.weather', value: '阴天' }] });
  const generated = await script(ctx);
  update(ctx, { selectedScriptTaskId: generated.id, shots: fixtureShots() });
  let ws = current(ctx);
  ctx.service.addVersion(ctx.project.id, { revision: ws.revision, kind: 'storyboard', body: '【人工分镜原件】只有阴天。' });
  const task = await finished(ctx, start(ctx, 'storyboard', { scriptTaskId: generated.id }));
  assert.equal(task.status, 'failed');
  assert.match(task.rawText, /暴雨/);
  ws = current(ctx);
  assert.equal(ws.versions.at(-1).body, '【人工分镜原件】只有阴天。');
  assert.throws(() => adopt(ctx, task), error => error.status === 409);
});

test('上游要求已变时不能用旧剧本启动分镜，也不能把对旧目标的新审阅显示为当前有效', async t => {
  const ctx = fixture(t), generated = await script(ctx);
  update(ctx, { selectedScriptTaskId: generated.id, shots: fixtureShots() });
  const board = await storyboard(ctx, generated.id);
  const before = ctx.calls.length;
  update(ctx, { instructions: '【新的上游要求】结尾改为关窗后微笑。' });
  assert.throws(() => start(ctx, 'storyboard', { scriptTaskId: generated.id }), error => error.status === 409);
  assert.throws(() => start(ctx, 'review', { targetTaskId: board.id }), error => error.status === 409);
  assert.equal(ctx.calls.length, before);
});

test('已有用户实体不吞掉剧本候选新增AI实体，稳定ID和来源完整传入分镜', async t => {
  const added = { id: 'PROP-02', type: 'prop', version: 'v1', description: '【AI补充】承载女儿报平安语音的手机。', source: 'ai' };
  const ctx = fixture(t, { runner: async options => {
    const result = fixtureResult(options.schema);
    if (result.entities) {
      result.entities.push(added);
      result.addedSettings.push(added.description);
      result.shotSeeds[1].entityRefs.push({ id: added.id, version: added.version });
    }
    if (result.shots) result.shots[1].entityRefs.push({ id: added.id, version: added.version });
    return { exitCode: 0, completed: true, finalMessage: JSON.stringify(result), threadId: options.schema.properties.shots ? 'added-entity-board' : 'added-entity-script' };
  } });
  const locks = [{ path: 'shot.weather', value: '阴天' }];
  update(ctx, { entities: fixtureEntities, locks });
  const generated = await script(ctx);
  update(ctx, { selectedScriptTaskId: generated.id });
  const ws = current(ctx);
  assert.equal(ws.effectiveEntities.length, 4);
  assert.deepEqual(entityFacts(ws.effectiveEntities.find(entity => entity.id === fixtureEntities[0].id)), fixtureEntities[0]);
  assert.deepEqual(entityFacts(ws.effectiveEntities.find(entity => entity.id === added.id)), added);
  assert.deepEqual(ws.entities, fixtureEntities);
  assert.deepEqual(ws.locks, locks);
  const board = await storyboard(ctx, generated.id);
  assert.equal(board.inputSnapshot.effectiveEntities.find(entity => entity.id === added.id).source, 'ai');
  assert.ok(board.result.shots[1].entityRefs.some(ref => ref.id === added.id && ref.version === added.version));
  assert.deepEqual(current(ctx).entities, fixtureEntities);
  assert.deepEqual(ctx.store.read('creative-jobs', generated.id).result.entities.find(entity => entity.id === added.id), added);
});

test('审阅返回创作同一会话ID时拒绝独立审阅，保留报告原文不标成成功', async t => {
  const ctx = fixture(t, { runner: async options => ({ exitCode: 0, completed: true, finalMessage: JSON.stringify(fixtureResult(options.schema)), threadId: 'same-test-session' }) });
  const generated = await script(ctx);
  const review = await finished(ctx, start(ctx, 'review', { targetTaskId: generated.id }));
  assert.equal(review.status, 'failed');
  assert.equal(review.result, null);
  assert.match(review.rawText, /隔离独立审阅显示夹具/);
  assert.match(review.error, /会话/);
});

test('人工剧本新版本成为下游来源，继续分镜不丢AI新增实体，原始结果和旧审阅保留', async t => {
  const calls = [], originalRunner = isolatedRunner(calls);
  const added = { id: 'PROP-02', type: 'prop', version: 'v1', description: '【AI补充】承载女儿报平安语音的手机。', source: 'ai' };
  const ctx = fixture(t, { runner: async options => {
    const receipt = await originalRunner(options), result = JSON.parse(receipt.finalMessage);
    if (result.entities) { result.entities.push(added); result.addedSettings.push(added.description); result.shotSeeds[1].entityRefs.push({ id: added.id, version: added.version }); }
    if (result.shots) result.shots[1].entityRefs.push({ id: added.id, version: added.version });
    return { ...receipt, finalMessage: JSON.stringify(result) };
  } });
  update(ctx, { entities: fixtureEntities, locks: [{ path: 'shot.weather', value: '阴天' }] });
  const generated = await script(ctx);
  update(ctx, { selectedScriptTaskId: generated.id });
  const board = await storyboard(ctx, generated.id);
  const review = await finished(ctx, start(ctx, 'review', { targetTaskId: board.id }));
  assert.equal(review.status, 'succeeded', review.error);
  const originalRaw = ctx.store.read('creative-jobs', generated.id).rawText;
  update(ctx, { scriptDraft: generated.result.body + '\n【人工修改】老人先放下手机，再拉近椅子。' });
  let ws = current(ctx);
  ctx.service.addVersion(ctx.project.id, { revision: ws.revision, kind: 'script', body: ws.scriptDraft });
  ws = current(ctx);
  const manual = ws.versions.find(version => version.id === ws.activeScriptId);
  assert.equal(ws.selectedScriptTaskId, null);
  assert.equal(manual.origin, 'user'); assert.equal(manual.stale, false);
  assert.equal(manual.data.entities.find(entity => entity.id === added.id).source, 'ai');
  assert.deepEqual(manual.parentSource, { id: generated.id, type: 'task' });
  const next = await storyboard(ctx);
  assert.equal(next.inputSnapshot.parent.id, manual.id);
  assert.equal(next.inputSnapshot.parent.type, 'version');
  assert.ok(next.result.shots[1].entityRefs.some(ref => ref.id === added.id && ref.version === added.version));
  assert.equal(current(ctx).reviews.find(task => task.id === review.id).needsReview, true);
  assert.equal(ctx.store.read('creative-jobs', generated.id).rawText, originalRaw);
  assert.deepEqual(current(ctx).entities, fixtureEntities);
});

test('切换到另一剧本候选后采用必须使用当前来源，不可用旧任务references掩盖来源变化', async t => {
  const ctx = fixture(t), first = await script(ctx);
  update(ctx, { selectedScriptTaskId: first.id });
  const board = await storyboard(ctx, first.id);
  const second = await finished(ctx, start(ctx, 'script', { retry: true }));
  assert.equal(second.status, 'succeeded', second.error);
  assert.notEqual(second.id, first.id);
  update(ctx, { selectedScriptTaskId: second.id });
  assert.equal(current(ctx).tasks.find(task => task.id === board.id).stale, true);
  assert.throws(() => adopt(ctx, board), error => error.status === 409);
});

test('当前人工活动来源改变后，显式旧task引用不能绕过采用校验', async t => {
  const ctx = fixture(t), generated = await script(ctx);
  const board = await storyboard(ctx, generated.id);
  const ws = current(ctx);
  // A client may save a version directly without also editing the separate draft field.
  ctx.service.addVersion(ctx.project.id, { revision: ws.revision, kind: 'script', body: '【新人工活动来源】当前剧本已经更换。' });
  assert.equal(current(ctx).scriptDraft, '');
  assert.equal(current(ctx).selectedScriptTaskId, null);
  assert.equal(current(ctx).tasks.find(task => task.id === board.id).stale, true);
  assert.throws(() => adopt(ctx, board), error => error.status === 409);
});

test('重启恢复真实中断状态与原任务ID，不自动再次运行；迟到结果不得复活旧任务', async t => {
  let release;
  const calls = [];
  const ctx = fixture(t, { runner: options => { calls.push(options); return new Promise(resolve => { release = () => resolve({ exitCode: 0, completed: true, finalMessage: JSON.stringify(fixtureResult(options.schema)), threadId: 'late-test-thread' }); }); } });
  const task = start(ctx, 'script');
  for (let i = 0; i < 50 && !release; i++) await pause(10);
  assert.equal(calls.length, 1);
  ctx.service.close();
  const next = new CreativeService(ctx.store, { runner: isolatedRunner(calls), knowledgeRoot: ctx.knowledgeRoot });
  t.after(() => next.close());
  const restored = next.view(ctx.project.id).tasks.find(item => item.id === task.id);
  assert.ok(['interrupted', 'cancelled'].includes(restored.status));
  const ws = next.view(ctx.project.id);
  const repeated = next.start(ctx.project.id, { revision: ws.revision, projectRevision: ws.project.revision, kind: 'script' });
  assert.equal(repeated.id, task.id);
  release(); await pause(30);
  assert.equal(calls.length, 1);
  assert.notEqual(ctx.store.read('creative-jobs', task.id).status, 'succeeded');
});
