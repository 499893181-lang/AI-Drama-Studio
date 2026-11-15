import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { CreativeWorkspace } from '../src/creative-store.mjs';
import { ImageWorkspace } from '../src/image-store.mjs';
import { ImageGenerationJobs, sameImageFile } from '../src/image-jobs.mjs';
import { fixtureEntities, fixtureShots } from './creative-fixtures.mjs';
import { testPng } from './image-fixtures.mjs';

const artifacts = path.resolve('tests/.artifacts'); fs.mkdirSync(artifacts, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const available = async () => ({ canSubmit: true, contractVerified: true, auth: { loggedIn: true }, accountUsage: { source: 'isolated-account-fixture', remainingPercent: null } });
const decoder = async ({ bytes }) => ({ decoded: true, width: 320, height: 180, decoder: 'isolated-decoder-fixture' });
function receipt(options, overrides = {}) {
  const filename = path.join(options.cwd, 'fixture-output.png'); fs.writeFileSync(filename, testPng());
  return { exitCode: 0, completed: true, threadId: 'fixture-image-thread', turnId: 'fixture-image-turn', imageGeneration: { id: 'fixture-image-item', generationId: null, status: 'completed', savedPath: filename, inputImages: options.references.map(ref => ({ path: ref.path, sha256: ref.sha256 })) }, images: [{ path: filename }], usage: { input_tokens: 0, output_tokens: 0, source: 'fixture' }, accountUsage: { source: 'fixture', remaining: null }, ...overrides };
}
function fixture(t, options = {}) {
  const store = new Store(fs.mkdtempSync(path.join(artifacts, 'image-jobs-'))), creative = new CreativeWorkspace(store);
  const project = store.create({ name: '[隔离测试] 单镜自动任务', idea: '明确软件测试故事，老人留茶，30秒三镜。' });
  creative.update(project.id, { revision: 0, entities: structuredClone(fixtureEntities), shots: fixtureShots(), stylePresetId: 'jia.platform.distance' });
  creative.addVersion(project.id, { revision: 1, kind: 'storyboard', body: '【软件测试分镜】' });
  const images = new ImageWorkspace(store, { creativeWorkspace: creative }), calls = [];
  const service = new ImageGenerationJobs(store, { images, runner: async input => { calls.push(input); return receipt(input); }, decoder, inspectCapabilities: available, ...options });
  t.after(() => service.close()); return { store, creative, project, images, service, calls };
}
function prepare(ctx) { return ctx.service.prepare(ctx.project.id, { revision: ctx.images.view(ctx.project.id).revision, shotId: 'SHOT-01' }); }
const submit = (ctx, job) => ctx.service.submit(job.id, { confirm: true, acknowledgeUsage: true });
async function finish(ctx, id) { for (let n = 0; n < 200; n++) { const job = ctx.service.read(id); if (!['submitting', 'running'].includes(job.status)) return job; await pause(10); } throw new Error('隔离图像任务未结束'); }

test('真实文件别名按realpath核对，Windows junction、大小写和长路径前缀不伪报未附加', async t => {
  const ctx = fixture(t, { runner: async input => {
    const result = receipt(input);
    result.imageGeneration.savedPath = fs.realpathSync.native(result.images[0].path);
    result.imageGeneration.inputImages = input.references.map(ref => ({ path: fs.realpathSync.native(ref.path), sha256: ref.sha256 }));
    return result;
  } });
  const file = path.join(ctx.store.root, 'alias-test.png'); fs.writeFileSync(file, testPng());
  assert.equal(sameImageFile(file, fs.realpathSync.native(file)), true);
  if (process.platform === 'win32') { assert.equal(sameImageFile(file, fs.realpathSync.native(file).toUpperCase()), true); assert.equal(sameImageFile(file, '\\\\?\\' + fs.realpathSync.native(file).replace(/^\\\\\?\\/, '')), true); }
  let ws = ctx.images.import(ctx.project.id, { revision: 0, role: 'character', targetId: 'CHAR-01', filename: 'alias.png', source: { kind: 'test', description: '路径别名测试图片。' } }, testPng()); const ref = ws.assets[0];
  ws = ctx.images.review(ctx.project.id, { revision: ws.revision, assetId: ref.id, verdict: 'accepted' }); ctx.images.select(ctx.project.id, { revision: ws.revision, assetId: ref.id });
  const job = prepare(ctx); await submit(ctx, job); const done = await finish(ctx, job.id); assert.equal(done.status, 'succeeded', done.error);
});

test('准备只保存输入；重复点击/并发提交仅调用一次，实际文件解码后导入候选而不选用', async t => {
  const ctx = fixture(t), job = prepare(ctx); assert.equal(ctx.calls.length, 0); assert.equal(prepare(ctx).id, job.id);
  await Promise.all([submit(ctx, job), submit(ctx, job)]);
  const done = await finish(ctx, job.id); assert.equal(done.status, 'succeeded', done.error); assert.equal(ctx.calls.length, 1);
  assert.equal((await submit(ctx, job)).id, job.id); assert.equal(ctx.calls.length, 1);
  const ws = ctx.images.view(ctx.project.id); assert.equal(ws.assets.length, 1); assert.equal(ws.selectionHistory.length, 0); assert.equal(ws.assets[0].state, 'pending_check'); assert.equal(ws.assets[0].source.kind, 'test');
  assert.equal(done.result.automaticallySelected, false); assert.equal(done.cnyCost, null); assert.equal(done.creditsCost, null);
  assert.equal((await ctx.service.view(ctx.project.id)).capability.actualGenerationVerified, false, '夹具不能把能力变真实验证');
});

test('flag存在但官方契约缺失时阻止真实提交，不发起备用API或制造免费费用', async t => {
  let calls = 0;
  const ctx = fixture(t, { runner: async () => { calls++; }, inspectCapabilities: async () => ({ canSubmit: false, contractVerified: false, imageGenerationFlagDetected: true, message: '单次工具上限未验证' }) });
  const job = prepare(ctx); await assert.rejects(() => submit(ctx, job), /单次工具上限未验证/); assert.equal(calls, 0); assert.equal(ctx.service.read(job.id).submittedAt, null);
});

test('提交前必须明确确认账号用量，次数按持久意图累计且重启不清零', async t => {
  const ctx = fixture(t), job = prepare(ctx);
  await assert.rejects(() => ctx.service.submit(job.id, { confirm: true }), /明确确认/);
  await submit(ctx, job); assert.equal((await finish(ctx, job.id)).status, 'succeeded'); ctx.service.close();
  const restored = new ImageGenerationJobs(ctx.store, { images: ctx.images, runner: async () => { throw new Error('不可重复'); }, decoder, inspectCapabilities: available }); t.after(() => restored.close());
  const second = restored.prepare(ctx.project.id, { revision: ctx.images.view(ctx.project.id).revision, shotId: 'SHOT-02' });
  await assert.rejects(() => restored.submit(second.id, { confirm: true, acknowledgeUsage: true }), /次数已用尽/); assert.equal(restored.usage().submitted, 1);
});

test('隔离夹具任务经真实模式服务重启也不能被升级为真实图像能力证据', async t => {
  const ctx = fixture(t), job = prepare(ctx); await submit(ctx, job); assert.equal((await finish(ctx, job.id)).status, 'succeeded'); ctx.service.close();
  const native = new ImageGenerationJobs(ctx.store, { images: ctx.images, inspectCapabilities: available }); t.after(() => native.close());
  const view = await native.view(ctx.project.id); assert.equal(view.capability.actualGenerationVerified, false); assert.equal(view.tasks[0].provider, 'isolated-image-fixture');
});

test('已提交任务历史损坏时重启仍暂停生成，不把缺失记录当作剩余额度', async t => {
  const ctx = fixture(t, { maxSubmissions: 2 }), first = prepare(ctx);
  await submit(ctx, first); assert.equal((await finish(ctx, first.id)).status, 'succeeded');
  const second = ctx.service.prepare(ctx.project.id, { revision: ctx.images.view(ctx.project.id).revision, shotId: 'SHOT-02' });
  assert.equal(ctx.service.usage().remaining, 1); ctx.service.close();
  const corruptedFile = ctx.store.file('image-generation-jobs', first.id), damaged = '{"originalSubmittedTask":';
  fs.writeFileSync(corruptedFile, damaged);
  let retryCalls = 0;
  const restored = new ImageGenerationJobs(ctx.store, { images: ctx.images, runner: async () => { retryCalls++; }, inspectCapabilities: available, maxSubmissions: 2 }); t.after(() => restored.close());
  const usage = restored.usage(), view = await restored.view(ctx.project.id);
  assert.equal(usage.historyVerified, false); assert.equal(usage.remaining, 0); assert.equal(usage.warnings.length, 1); assert.match(usage.warnings[0], /损坏/); assert.equal(view.capability.canSubmit, false);
  await assert.rejects(() => restored.submit(second.id, { confirm: true, acknowledgeUsage: true }), /历史存在损坏/);
  assert.equal(retryCalls, 0); assert.equal(restored.read(second.id).submittedAt, null); assert.equal(fs.readFileSync(corruptedFile, 'utf8'), damaged, '损坏历史保留，不重写或重置');
});

test('等待只读认证期间服务关闭，不写提交意图或消耗提交次数', async t => {
  let finishInspection;
  const ctx = fixture(t, { inspectCapabilities: () => new Promise(resolve => { finishInspection = resolve; }) }), job = prepare(ctx);
  const promise = submit(ctx, job); while (!finishInspection) await pause(1); ctx.service.close(); finishInspection(await available());
  await assert.rejects(() => promise, error => error.status === 503); assert.equal(ctx.service.read(job.id).submittedAt, null); assert.equal(ctx.service.usage().submitted, 0); assert.equal(ctx.calls.length, 0);
});

test('过期输入或参考审核变化在调用前拒绝；复制的实际参考附件Hash必须有官方事件回执', async t => {
  const ctx = fixture(t);
  let ws = ctx.images.import(ctx.project.id, { revision: 0, role: 'character', targetId: 'CHAR-01', filename: 'TEST.png', source: { kind: 'test', description: '测试参考图，非AI结果。' } }, testPng());
  const ref = ws.assets[0]; ws = ctx.images.review(ctx.project.id, { revision: ws.revision, assetId: ref.id, verdict: 'accepted', notes: '测试' }); ctx.images.select(ctx.project.id, { revision: ws.revision, assetId: ref.id });
  const old = prepare(ctx); ws = ctx.images.view(ctx.project.id); ctx.images.review(ctx.project.id, { revision: ws.revision, assetId: ref.id, verdict: 'rejected', notes: '改判拒绝' });
  await assert.rejects(() => submit(ctx, old)); assert.equal(ctx.calls.length, 0);
});

test('真实完成文字、任意路径、未完成事件、多图、解码失败均不能变为成功', async t => {
  const cases = [
    input => receipt(input, { completed: false }),
    input => receipt(input, { imageGeneration: null, finalMessage: '图片生成成功，路径已返回。' }),
    input => receipt(input, { imageGeneration: { id: 'fixture', status: 'completed', savedPath: path.join(input.cwd, 'different.png') } }),
    input => { const result = receipt(input); result.images.push(result.images[0]); return result; },
  ];
  for (const [index, make] of cases.entries()) {
    await t.test(`不完整证据${index}`, async st => { const ctx = fixture(st, { runner: async input => make(input) }); const job = prepare(ctx); await submit(ctx, job); const done = await finish(ctx, job.id); assert.equal(done.status, 'failed'); assert.equal(ctx.images.get(ctx.project.id).assets.length, 0); assert.ok(fs.existsSync(path.join(ctx.store.root, done.rawResultPath, 'receipt.json'))); });
  }
  await t.test('解码拒绝', async st => { const ctx = fixture(st, { decoder: async () => { throw new Error('真实像素解码失败'); } }); const job = prepare(ctx); await submit(ctx, job); const done = await finish(ctx, job.id); assert.equal(done.status, 'failed'); assert.equal(ctx.images.get(ctx.project.id).assets.length, 0); assert.ok(done.artifact.sha256); });
});

test('实际参考副本会传给runner，但没有对应inputImages回执仍失败并保留原图', async t => {
  let input;
  const ctx = fixture(t, { runner: async options => { input = options; const value = receipt(options); value.imageGeneration.inputImages = []; return value; } });
  let ws = ctx.images.import(ctx.project.id, { revision: 0, role: 'scene', targetId: 'SCENE-01', filename: 'TEST.png', source: { kind: 'test', description: '测试参考' } }, testPng());
  const ref = ws.assets[0]; ws = ctx.images.review(ctx.project.id, { revision: ws.revision, assetId: ref.id, verdict: 'accepted' }); ctx.images.select(ctx.project.id, { revision: ws.revision, assetId: ref.id });
  const job = prepare(ctx); await submit(ctx, job); const done = await finish(ctx, job.id); assert.equal(done.status, 'failed'); assert.equal(input.references.length, 1); assert.ok(fs.existsSync(input.references[0].path)); assert.match(done.error, /实际参考图片已附加/);
});

test('仅有官方base64结果时按返回字节Hash绑定文件，不伪造savedPath', async t => {
  const ctx = fixture(t, { runner: async input => { const value = receipt(input); delete value.imageGeneration.savedPath; value.imageGeneration.result = testPng().toString('base64'); return value; } });
  const job = prepare(ctx); await submit(ctx, job); const done = await finish(ctx, job.id); assert.equal(done.status, 'succeeded', done.error); const asset = ctx.images.view(ctx.project.id).assets[0]; assert.equal(asset.generation.completionEvidence.officialImageEvent.savedPath, undefined); assert.equal(asset.generation.completionEvidence.officialImageEvent.resultMatchesImageSha256, asset.sha256);
});

test('官方产生实际图片但hook/参考验收失败时保留原图，不导入、不成功、不返还本轮次数', async t => {
  const ctx = fixture(t, { runner: async input => receipt(input, { error: '隔离复现：hook未核实、inputImages缺失，不能认定自动验收通过。' }) });
  const job = prepare(ctx); await submit(ctx, job); const done = await finish(ctx, job.id);
  assert.equal(done.status, 'failed'); assert.equal(done.result, null); assert.equal(done.retainedArtifacts.length, 1); assert.equal(ctx.images.get(ctx.project.id).assets.length, 0); assert.equal(ctx.service.usage().remaining, 0);
  const retained = ctx.service.artifactFile(job.id, 0); assert.ok(retained.bytes.equals(testPng())); assert.equal(retained.verification, 'not_accepted'); assert.equal((await ctx.service.view(ctx.project.id)).capability.actualGenerationVerified, false);
});

test('已失败任务可由可信本地恢复追加已解码原图，保持原失败状态/原意图且不伪造候选', async t => {
  let output;
  const ctx = fixture(t, { runner: async input => { output = receipt(input).images[0].path; throw new Error('隔离复现：图像事件后旧runner抛错'); } });
  const job = prepare(ctx); await submit(ctx, job); const failed = await finish(ctx, job.id); assert.equal(failed.status, 'failed');
  const bytes = fs.readFileSync(output), sha256 = createHash('sha256').update(bytes).digest('hex');
  const recovered = ctx.service.recordRetainedArtifact(job.id, { path: fs.realpathSync.native(output), sha256, decoded: { decoded: true, width: 320, height: 180, decoder: 'isolated-recovery-fixture' }, evidence: { fixture: true, reason: '只恢复原图，不补造失败hook或附件证据' } });
  assert.equal(recovered.status, 'failed'); assert.equal(recovered.error, failed.error); assert.equal(recovered.submittedAt, failed.submittedAt); assert.equal(recovered.result, null); assert.equal(recovered.recoveryHistory.length, 1); assert.ok(ctx.service.artifactFile(job.id, 0).bytes.equals(bytes)); assert.equal(ctx.images.get(ctx.project.id).assets.length, 0);
  const repeat = ctx.service.recordRetainedArtifact(job.id, { path: output, sha256, decoded: { decoded: true, width: 320, height: 180 }, evidence: { fixture: true } }); assert.equal(repeat.retainedArtifacts.length, 1);
  fs.writeFileSync(output, testPng(320,180,[200,100,50])); assert.throws(() => ctx.service.artifactFile(job.id, 0), /Hash已改变/);
});

test('生成等待期间输入改变，迟到候选仍绑定原包并需复核，不盖新输入或自动选用', async t => {
  let resolve, input;
  const ctx = fixture(t, { runner: async options => { input = options; return new Promise(done => { resolve = done; }); } }); const job = prepare(ctx); await submit(ctx, job); while (!resolve) await pause(1);
  const project = ctx.store.read('projects', ctx.project.id); ctx.store.update(project.id, { revision: project.revision, idea: '新的用户要求，旧生成不得覆盖。' }); resolve(receipt(input));
  const done = await finish(ctx, job.id); assert.equal(done.status, 'succeeded', done.error); const ws = ctx.images.view(ctx.project.id); assert.equal(ws.assets[0].stale, true); assert.equal(ws.selectionHistory.length, 0); assert.equal(ws.assets[0].packetId, job.packetId); assert.equal(ws.assets[0].inputSnapshotHash, job.inputSnapshotHash);
});

test('失败回执原图索引不连续时，本地恢复分配新索引并保留各文件的独立下载', async t => {
  const ctx = fixture(t, { runner: async input => { const result = receipt(input); result.images.unshift({ path: path.join(input.cwd, 'missing-first.png') }); return result; } });
  const job = prepare(ctx); await submit(ctx, job); const failed = await finish(ctx, job.id);
  assert.equal(failed.status, 'failed'); assert.deepEqual(failed.retainedArtifacts.map(item => item.index), [1]);
  const bytes = testPng(320, 180, [100, 50, 200]), file = path.join(ctx.store.root, failed.rawResultPath, 'separate-recovery.png'); fs.writeFileSync(file, bytes);
  const recovered = ctx.service.recordRetainedArtifact(job.id, { path: file, sha256: createHash('sha256').update(bytes).digest('hex'), decoded: { decoded: true, width: 320, height: 180, decoder: 'isolated-recovery-fixture' }, evidence: { fixture: true, reason: '验证不连续索引，非真实生成结果' } });
  assert.deepEqual(recovered.retainedArtifacts.map(item => item.index), [1, 2]); assert.equal(recovered.status, 'failed'); assert.equal(recovered.error, failed.error); assert.equal(recovered.result, null);
  assert.ok(ctx.service.artifactFile(job.id, 1).bytes.equals(testPng())); assert.ok(ctx.service.artifactFile(job.id, 2).bytes.equals(bytes)); assert.equal(ctx.images.get(ctx.project.id).assets.length, 0);
});

test('取消和重启不重提；迟到图片留原运行目录，不能复活任务或自动入库', async t => {
  let resolve, input;
  const ctx = fixture(t, { runner: async options => { input = options; return new Promise(done => { resolve = done; }); } }); const job = prepare(ctx); await submit(ctx, job); while (!resolve) await pause(1);
  ctx.service.cancel(job.id); resolve(receipt(input)); await pause(30); const cancelled = ctx.service.read(job.id); assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.lateArtifacts.length, 1); assert.equal(ctx.images.get(ctx.project.id).assets.length, 0);
  let retryCalls = 0; const restored = new ImageGenerationJobs(ctx.store, { images: ctx.images, runner: async () => { retryCalls++; }, inspectCapabilities: available }); t.after(() => restored.close());
  assert.equal(restored.read(job.id).status, 'cancelled'); assert.equal((await restored.submit(job.id, { confirm: true, acknowledgeUsage: true })).id, job.id); assert.equal(retryCalls, 0);
});

test('超时与服务关闭保留意图，原任务不恢复运行且不能通过重新点击消耗第二笔', async t => {
  const ctx = fixture(t, { runner: async () => new Promise(() => {}), timeoutMs: 15 }); const job = prepare(ctx); await submit(ctx, job); const done = await finish(ctx, job.id); assert.equal(done.status, 'timed_out'); assert.ok(done.submittedAt);
  const ctx2 = fixture(t, { runner: async () => new Promise(() => {}) }); const second = prepare(ctx2); await submit(ctx2, second); ctx2.service.close(); const restored = new ImageGenerationJobs(ctx2.store, { images: ctx2.images, runner: async () => { throw new Error('不应重提'); }, inspectCapabilities: available }); t.after(() => restored.close()); assert.equal(restored.read(second.id).status, 'interrupted'); assert.equal((await restored.submit(second.id, { confirm: true, acknowledgeUsage: true })).status, 'interrupted');
});
