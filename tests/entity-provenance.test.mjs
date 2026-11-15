import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { CreativeService, validateCreativeScript } from '../src/creative-jobs.mjs';
import { provenanceHash, assessEntityProvenance, validateEntityProvenance } from '../src/entity-provenance.mjs';
import { fixtureIdea, fixtureEntities, fixtureResult, fixtureScript } from './creative-fixtures.mjs';

const artifacts = path.resolve('tests/.artifacts'); fs.mkdirSync(artifacts, { recursive: true });
const extra = { id: 'CHAR-99', type: 'character', version: 'v1', description: '具有空间瞬移能力的秘密皇室继承人。', source: 'user' };
function fixture(t, transform = value => value) {
  const root = fs.mkdtempSync(path.join(artifacts, 'entity-provenance-')), store = new Store(root);
  let calls = 0;
  const service = new CreativeService(store, { runner: async options => {
    calls++;
    const result = fixtureResult(options.schema);
    if (result.entities) transform(result, service.workspace.context(project.id, 'script'));
    return { exitCode: 0, completed: true, finalMessage: JSON.stringify(result), threadId: `source-fixture-${calls}` };
  } });
  t.after(() => service.close());
  const project = store.create({ name: '[来源隔离测试] 不是真实作品', idea: fixtureIdea, durationSeconds: 30 });
  service.update(project.id, { revision: 0, entities: structuredClone(fixtureEntities) });
  return { root, store, service, project };
}
function context(ctx) { return ctx.service.workspace.context(ctx.project.id, 'script'); }
function entry(report, id = 'CHAR-99') { return report.entries.find(row => row.entityId === id); }
async function run(ctx) {
  const ws = ctx.service.view(ctx.project.id);
  const task = ctx.service.start(ctx.project.id, { kind: 'script', revision: ws.revision, projectRevision: ws.project.revision });
  for (let i = 0; i < 100; i++) { const value = ctx.store.read('creative-jobs', task.id); if (!['queued', 'running'].includes(value.status)) { assert.equal(value.status, 'succeeded', value.error); return value; } await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('隔离来源任务超时');
}
function adopt(ctx, task, confirmPendingSources = false) { const ws = ctx.service.view(ctx.project.id); return ctx.service.adopt(ctx.project.id, { revision: ws.revision, taskId: task.id, projectRevision: ws.project.revision, confirmPendingSources }); }

test('新增实体自报用户且没有证据时结构稿可保留，来源必须待确认，不能伪装用户指定', t => {
  const ctx = fixture(t), value = fixtureScript(); value.entities.push(extra); value.addedSettings = [];
  const validated = validateCreativeScript(value, context(ctx));
  assert.equal(entry(validated.entityProvenance).resolvedSource, 'pending');
  assert.equal(entry(validated.entityProvenance).status, 'pending_confirmation');
  assert.equal(validated.entities.at(-1).source, 'user', '原始声明保留但不当作核验结果');
  assert.ok(validated.entityProvenance.entries.slice(0, 3).every(row => row.resolvedSource === 'user'));
});

test('从用户原文逐字提取的新ID可合法来自用户，证据有快照及UTF-16位置', t => {
  const ctx = fixture(t), input = context(ctx), value = fixtureScript();
  const quote = '穿灰蓝长衫的独居老人', start = input.snapshot.source.idea.indexOf(quote);
  value.entities.push({ ...extra, description: quote });
  value.entityEvidence = [{ entityId: extra.id, version: 'v1', path: 'source.idea', start, end: start + quote.length, quote, snapshotHash: provenanceHash(input.snapshot) }];
  const report = validateCreativeScript(value, input).entityProvenance;
  assert.equal(entry(report).resolvedSource, 'user'); assert.equal(entry(report).status, 'verified_user_input');
  assert.equal(entry(report).evidence[0].path, 'source.idea'); assert.equal(entry(report).inputSnapshotHash, provenanceHash(input.snapshot));
});

test('合法引文不能给夹带在描述中的未经指定设定背书', t => {
  const ctx = fixture(t), input = context(ctx), value = fixtureScript(), quote = '独居老人';
  const start = input.snapshot.source.idea.indexOf(quote);
  value.entities.push({ ...extra, description: quote + '，能够控制天气。' });
  value.entityEvidence = [{ entityId: extra.id, version: 'v1', path: 'source.idea', start, end: start + quote.length, quote, snapshotHash: provenanceHash(input.snapshot) }];
  assert.equal(entry(validateCreativeScript(value, input).entityProvenance).resolvedSource, 'pending');
});

test('错误快照、位置和引用AI补充路径都不能核实用户来源', t => {
  const ctx = fixture(t), input = context(ctx), quote = '独居老人', start = input.snapshot.source.idea.indexOf(quote);
  for (const bad of [{ snapshotHash: '0'.repeat(64) }, { start: start + 1 }, { path: 'source.creativeBrief.addedSettings.0' }]) {
    const value = fixtureScript(); value.entities.push({ ...extra, description: quote });
    value.entityEvidence = [{ entityId: extra.id, version: 'v1', path: 'source.idea', start, end: start + quote.length, quote, snapshotHash: provenanceHash(input.snapshot), ...bad }];
    assert.equal(entry(validateCreativeScript(value, input).entityProvenance).resolvedSource, 'pending');
  }
});

test('明确声明且逐项解释的AI补充被保留为AI来源，不因新增ID一律当作用户', t => {
  const ctx = fixture(t), value = fixtureScript();
  value.entities.push({ ...extra, source: 'ai', description: '【AI补充】桌旁留有一只旧木茶托。' });
  value.addedSettings.push(value.entities.at(-1).description);
  const report = validateCreativeScript(value, context(ctx)).entityProvenance;
  assert.equal(entry(report).resolvedSource, 'ai'); assert.equal(entry(report).status, 'ai_addition');
});

test('AI声明缺说明仍待确认，不能用AI实体摘录另建user ID洗白', t => {
  const ctx = fixture(t), input = context(ctx), value = fixtureScript();
  value.entities.push({ ...extra, source: 'ai' }); value.addedSettings = [];
  assert.equal(entry(validateCreativeScript(value, input).entityProvenance).resolvedSource, 'pending');
  const snapshot = { entities: [{ ...extra, source: 'ai' }], entityInputEvidence: {} };
  const hash = provenanceHash({ id: extra.id, type: extra.type, version: extra.version, description: extra.description, source: 'ai' });
  snapshot.entityInputEvidence['CHAR-99@v1'] = { kind: 'explicit_user_edit', entityHash: hash };
  const malicious = { entities: [{ ...extra, id: 'CHAR-98' }], addedSettings: [], entityEvidence: [{ entityId: 'CHAR-98', version: 'v1', path: 'entities.0.description', start: 0, end: extra.description.length, quote: extra.description, snapshotHash: provenanceHash(snapshot) }] };
  assert.equal(entry(assessEntityProvenance(malicious, snapshot), 'CHAR-98').resolvedSource, 'pending');
});

test('采用待确认来源必须明确确认，采用和下游引用后仍待确认且原模型原文保留', async t => {
  const ctx = fixture(t, result => { result.entities.push(extra); result.addedSettings = []; });
  const task = await run(ctx), raw = task.rawText;
  assert.throws(() => adopt(ctx, task), error => error.status === 409 && /来源待确认/.test(error.message));
  const ws = adopt(ctx, task, true);
  assert.equal(ws.versions[0].pendingSourcesAcknowledged.remainsPending, true);
  ctx.service.update(ctx.project.id, { revision: ws.revision, selectedScriptTaskId: task.id });
  const downstream = ctx.service.workspace.context(ctx.project.id, 'storyboard');
  const entity = downstream.effective.entities.find(row => row.id === extra.id);
  assert.equal(entity.source, 'user'); assert.equal(entity.resolvedSource, 'pending');
  assert.equal(entity.sourceProvenance.status, 'pending_confirmation');
  assert.equal(ctx.store.read('creative-jobs', task.id).rawText, raw);
});

test('实体/侧录/输入快照被改后采用拒绝；旧证据不能在下游继续当用户来源', async t => {
  const ctx = fixture(t), task = await run(ctx);
  task.entityProvenance.entries[0].resolvedSource = 'ai'; ctx.store.write('creative-jobs', task);
  assert.throws(() => adopt(ctx, task, true), error => error.status === 409 && /来源证据/.test(error.message));
  const report = ctx.service.view(ctx.project.id).tasks[0].entityProvenance;
  assert.ok(report.entries.every(row => row.bindingValid === false));
  let ws = ctx.service.view(ctx.project.id); ctx.service.update(ctx.project.id, { revision: ws.revision, selectedScriptTaskId: task.id });
  ws = ctx.service.view(ctx.project.id);
  assert.throws(() => ctx.service.start(ctx.project.id, { revision: ws.revision, kind: 'storyboard', scriptTaskId: task.id }), error => error.status === 409);
});

test('历史任务缺侧录只标待确认，不改旧文件，不按source=user回填用户证据', async t => {
  const ctx = fixture(t), task = await run(ctx);
  delete task.entityProvenance; delete task.result.entityProvenance; ctx.store.write('creative-jobs', task);
  const file = ctx.store.file('creative-jobs', task.id), before = fs.readFileSync(file);
  const report = ctx.service.view(ctx.project.id).tasks[0].entityProvenance;
  assert.equal(report.pendingCount, task.result.entities.length);
  assert.ok(report.entries.every(row => row.evidence.length === 0 && row.resolvedSource === 'pending'));
  assert.deepEqual(fs.readFileSync(file), before);
  assert.throws(() => adopt(ctx, task), error => error.status === 409);
});

test('相同实体数组保存不洗白旧记录；真实人工修改才记录新的人工来源证明', t => {
  const ctx = fixture(t), ws = ctx.service.workspace.get(ctx.project.id);
  delete ws.entityInputEvidence; ctx.store.write('creative-workspaces', ws);
  let view = ctx.service.update(ctx.project.id, { revision: ws.revision, entities: structuredClone(fixtureEntities) });
  assert.equal(view.entityProvenance.pendingCount, 3);
  const edited = structuredClone(fixtureEntities); edited[0].description += '人工明确确认老人戴眼镜。';
  view = ctx.service.update(ctx.project.id, { revision: view.revision, entities: edited });
  assert.equal(entry(view.entityProvenance, 'CHAR-01').resolvedSource, 'user');
  assert.equal(entry(view.entityProvenance, 'SCENE-01').resolvedSource, 'pending');
});

test('来源侧录绑定完整快照及实体Hash，改变实体或输入无法复用旧证明', t => {
  const ctx = fixture(t), input = context(ctx), result = fixtureScript(), report = assessEntityProvenance(result, input.snapshot);
  const changed = structuredClone(result); changed.entities[0].description += '新事实';
  assert.ok(validateEntityProvenance(report, changed, input.snapshot).entries.every(row => row.bindingValid === false));
  const snapshot = structuredClone(input.snapshot); snapshot.source.idea += '新要求';
  assert.ok(validateEntityProvenance(report, result, snapshot).entries.every(row => row.bindingValid === false));
});

test('输入快照与报告一起被修改也不能绕过原任务Hash，在下游不得重新洗白', async t => {
  const ctx = fixture(t, (result, input) => {
    const quote = '独居老人', start = input.snapshot.source.idea.indexOf(quote);
    result.entities.push({ ...extra, description: quote });
    result.entityEvidence = [{ entityId: extra.id, version: 'v1', path: 'source.idea', start, end: start + quote.length, quote, snapshotHash: provenanceHash(input.snapshot) }];
  });
  const task = await run(ctx), oldHash = task.inputHash;
  task.inputSnapshot.instructions += '恶意修改保存的快照。';
  task.result.entityEvidence[0].snapshotHash = provenanceHash(task.inputSnapshot);
  task.entityProvenance = assessEntityProvenance(task.result, task.inputSnapshot);
  assert.equal(entry(task.entityProvenance).resolvedSource, 'user', '证明快照和报告单独互相匹配不足够');
  assert.equal(task.inputHash, oldHash); ctx.store.write('creative-jobs', task);
  const ws = ctx.service.update(ctx.project.id, { revision: ctx.service.view(ctx.project.id).revision, selectedScriptTaskId: task.id });
  const row = entry(ws.entityProvenance);
  assert.equal(row.resolvedSource, 'pending'); assert.equal(row.bindingValid, false);
  assert.throws(() => ctx.service.start(ctx.project.id, { revision: ws.revision, kind: 'storyboard', scriptTaskId: task.id }), error => error.status === 409);
});

test('人工版本继承的来源base保留独立expectedSnapshotHash，不接受修改后的快照和报告自证', async t => {
  const ctx = fixture(t, (result, input) => {
    const quote = '独居老人', start = input.snapshot.source.idea.indexOf(quote);
    result.entities.push({ ...extra, description: quote });
    result.entityEvidence = [{ entityId: extra.id, version: 'v1', path: 'source.idea', start, end: start + quote.length, quote, snapshotHash: provenanceHash(input.snapshot) }];
  });
  const task = await run(ctx);
  let ws = ctx.service.update(ctx.project.id, { revision: ctx.service.view(ctx.project.id).revision, selectedScriptTaskId: task.id });
  ws = ctx.service.addVersion(ctx.project.id, { revision: ws.revision, kind: 'script', body: '人工保留原人物与来源，只修改剧本文字。' });
  const value = ctx.store.read('creative-workspaces', ctx.project.id), base = value.versions.at(-1).entityProvenanceBases[0];
  assert.equal(base.expectedSnapshotHash, task.inputHash);
  base.inputSnapshot.instructions += '偷换快照。'; base.result.entityEvidence[0].snapshotHash = provenanceHash(base.inputSnapshot);
  base.report = assessEntityProvenance(base.result, base.inputSnapshot); ctx.store.write('creative-workspaces', value);
  const report = ctx.service.view(ctx.project.id).entityProvenance;
  assert.equal(entry(report).resolvedSource, 'pending'); assert.equal(entry(report).bindingValid, false);
});
