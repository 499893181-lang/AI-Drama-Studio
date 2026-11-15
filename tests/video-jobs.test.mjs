import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { CreativeWorkspace } from '../src/creative-store.mjs';
import { ImageWorkspace } from '../src/image-store.mjs';
import { VideoService } from '../src/video-jobs.mjs';
import { fixtureEntities, fixtureShots } from './creative-fixtures.mjs';
import { testPng } from './image-fixtures.mjs';
import { createTestVideo } from './video-fixtures.mjs';

const artifacts = path.resolve('tests/.artifacts'); fs.mkdirSync(artifacts, { recursive: true });
const clip = await createTestVideo(path.join(artifacts, `video-jobs-fixture-${randomUUID()}`));
const price = { status: 'known', amount: 5, currency: 'CREDITS', billingType: 'credits', canSubmit: true, evidenceId: 'ISOLATED-FIXTURE-PRICE-NOT-OFFICIAL', basis: '隔离费用夹具，仅验证门槛，不是官方报价。', sources: [{ title: '明确隔离夹具', url: 'https://example.invalid/test-price' }], conditions: ['仅隔离runner'], expiresAt: '2099-01-01T00:00:00Z', channel: 'dreamina-cli-image2video' };
const capability = { canSubmit: true, realSubmissionEnabled: false, auth: { loggedIn: true }, defaults: { model: 'fixture-seedance', durationSeconds: 5, resolution: '720p', audioMode: 'provider_default' }, models: [{ id: 'fixture-seedance', duration: { min: 4, max: 15, step: 1 }, resolutions: ['720p'] }], audio: { nativeDisableSupported: false }, canvas: { status: 'not_synced' } };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function fixture(t, options = {}) {
  const store = new Store(fs.mkdtempSync(path.join(artifacts, 'video-jobs-'))), creative = new CreativeWorkspace(store);
  const project = store.create({ name: '[隔离视频工作台测试]', idea: '明确测试故事，非个人数据；不提交真实生成。' });
  creative.update(project.id, { revision: 0, entities: structuredClone(fixtureEntities), shots: fixtureShots() });
  creative.addVersion(project.id, { revision: 1, kind: 'storyboard', body: '隔离人工分镜，非真实模型输出。' });
  const images = new ImageWorkspace(store, { creativeWorkspace: creative });
  let view = images.import(project.id, { revision: 0, role: 'shot', targetId: 'SHOT-01', filename: 'TEST-FIXTURE-NOT-AI.png', source: { kind: 'test', description: '明确测试图，像素TEST FIXTURE / NOT AI。' } }, testPng());
  const image = view.assets[0]; view = images.review(project.id, { revision: view.revision, assetId: image.id, verdict: 'accepted', notes: '只作软件测试参考。' }); images.select(project.id, { revision: view.revision, assetId: image.id });
  const calls = { submit: [], query: [], download: [] }, adapter = { executionMode: 'isolated-fixture', inspect: async () => structuredClone(capability), quote: async () => structuredClone(price), submit: async input => { calls.submit.push(input); return { externalTaskId: 'ISOLATED-EXTERNAL-ID', status: 'querying', raw: { fixture: true } }; }, query: async input => { calls.query.push(input); return { externalTaskId: input.externalTaskId, status: 'success', raw: { fixture: true } }; }, download: async input => { calls.download.push(input); return { externalTaskId: input.externalTaskId, status: 'success', path: clip.path, raw: { fixture: true } }; }, ...(options.adapter ?? {}) };
  const service = new VideoService(store, { images, adapter, ...(options.service ?? {}) }); t.after(() => service.close());
  return { store, project, creative, images, image, adapter, service, calls };
}
const prepare = (ctx, values = {}) => ctx.service.prepare(ctx.project.id, { revision: ctx.service.workspace.get(ctx.project.id).revision, shotId: 'SHOT-01', imageAssetId: ctx.image.id, creditsBudget: 20, ...values });
const submit = (ctx, job) => ctx.service.submit(job.id, { confirm: true, quoteFingerprint: job.quoteFingerprint });
async function completed(ctx) { let task = await prepare(ctx); task = await submit(ctx, task); task = await ctx.service.query(task.id); return ctx.service.download(task.id); }

test('prepare绑定当前图/分镜/审核/选用及真实文件Hash，重复点击复用且不提交', async t => {
  const ctx = await fixture(t), a = await prepare(ctx), b = await prepare(ctx);
  assert.equal(a.id, b.id); assert.equal(a.binding.imageAssetId, ctx.image.id); assert.equal(a.binding.imageSha256, ctx.image.sha256); assert.ok(a.binding.imageReviewId); assert.ok(a.binding.imageSelectionId); assert.equal(a.status, 'prepared'); assert.equal(ctx.calls.submit.length, 0); assert.equal(a.parameters.audioMode, 'provider_default');
});

test('selected历史存在但图片改判rejected时，prepare与submit均拒绝', async t => {
  const ctx = await fixture(t), task = await prepare(ctx); const ws = ctx.images.get(ctx.project.id); ctx.images.review(ctx.project.id, { revision: ws.revision, assetId: ctx.image.id, verdict: 'rejected', notes: '撤销检查' });
  await assert.rejects(prepare(ctx), /当前有效|拒绝/); await assert.rejects(submit(ctx, task), /当前有效|拒绝/); assert.equal(ctx.calls.submit.length, 0); assert.equal(ctx.service.read(task.id).submittedAt, null);
});

test('分镜过期target.ready=false和实际图片Hash变化都不能提交旧准备任务', async t => {
  const ctx = await fixture(t), task = await prepare(ctx), original = ctx.images.file(ctx.project.id, ctx.image.id);
  fs.appendFileSync(original.path, 'changed'); await assert.rejects(submit(ctx, task), /当前有效|Hash/); fs.writeFileSync(original.path, original.bytes);
  const creative = ctx.creative.get(ctx.project.id); ctx.creative.update(ctx.project.id, { revision: creative.revision, episodeId: 'EP-02' });
  await assert.rejects(submit(ctx, task), /分镜已过期|未有效保存/); assert.equal(ctx.calls.submit.length, 0);
});

test('未知视频费用保持null，不能用余额、文字报价或确认按钮绕过', async t => {
  const ctx = await fixture(t, { adapter: { quote: async () => ({ status: 'unknown', amount: null, currency: 'CREDITS', canSubmit: false, basis: '缺当前视频渠道单价', sources: [] }) } }), task = await prepare(ctx);
  assert.equal(task.quote.amount, null); await assert.rejects(submit(ctx, task), /费用待确认/); assert.equal(ctx.calls.submit.length, 0); assert.equal(ctx.service.read(task.id).submittedAt, null);
  ctx.adapter.quote = async () => ({ ...price, channel: 'jimeng-novel-cli' }); const novel = await prepare(ctx); await assert.rejects(submit(ctx, novel), /费用待确认/);
});

test('积分预算独立于余额与人民币，已预留费用累计且不能因重做漏算', async t => {
  const ctx = await fixture(t), tooSmall = await prepare(ctx, { creditsBudget: 4 }); await assert.rejects(submit(ctx, tooSmall), /超过/);
  const a = await prepare(ctx, { creditsBudget: 5 }); await submit(ctx, a);
  const redo = await prepare(ctx, { creditsBudget: 5, redoOfTaskId: a.id }); await assert.rejects(submit(ctx, redo), /超过/); assert.equal(ctx.calls.submit.length, 1);
});

test('未知费用、过期报价、等待报价时改输入均不留下消费意图', async t => {
  const ctx = await fixture(t), task = await prepare(ctx); ctx.adapter.quote = async () => ({ ...price, expiresAt: '2000-01-01T00:00:00Z' }); await assert.rejects(submit(ctx, task), /费用.*变化/);
  const expired = await prepare(ctx); await assert.rejects(submit(ctx, expired), /过期/);
  ctx.adapter.quote = async () => structuredClone(price); const valid = await prepare(ctx), wait = deferred(); ctx.adapter.quote = async () => wait.promise; const submitting = submit(ctx, valid);
  await new Promise(resolve => setTimeout(resolve, 10)); const project = ctx.store.read('projects', ctx.project.id); ctx.store.update(project.id, { revision: project.revision, idea: project.idea + ' 新要求。' }); wait.resolve(structuredClone(price));
  await assert.rejects(submitting, /过期|改变|当前有效/); assert.equal(ctx.calls.submit.length, 0); assert.equal(ctx.service.read(valid.id).submittedAt, null);
});

test('提交意图先落盘、并发/重复点击仅调用一次，不把受理算成功', async t => {
  const ctx = await fixture(t), task = await prepare(ctx), wait = deferred();
  ctx.adapter.submit = async input => { ctx.calls.submit.push(input); const stored = ctx.service.read(input.taskId); assert.ok(stored.submittedAt); assert.equal(stored.status, 'submitting'); assert.ok(fs.existsSync(input.imagePath)); return wait.promise; };
  const a = submit(ctx, task), b = submit(ctx, task); await new Promise(resolve => setTimeout(resolve, 10)); wait.resolve({ externalTaskId: 'SINGLE-TEST-ID', status: 'querying', raw: { fixture: true } });
  const [first, second] = await Promise.all([a, b]); assert.equal(first.id, second.id); assert.equal(first.status, 'querying'); assert.equal(first.result, null); assert.equal(ctx.calls.submit.length, 1); await submit(ctx, task); assert.equal(ctx.calls.submit.length, 1);
});

test('query失败保留原任务号，继续query原任务；download失败只重试下载', async t => {
  const ctx = await fixture(t), task = await prepare(ctx); await submit(ctx, task); const query = ctx.adapter.query; ctx.adapter.query = async input => { ctx.calls.query.push(input); throw new Error('隔离网络错误'); };
  let result = await ctx.service.query(task.id); assert.equal(result.status, 'query_failed'); assert.equal(result.externalTaskId, 'ISOLATED-EXTERNAL-ID');
  ctx.adapter.query = query; result = await ctx.service.query(task.id); assert.equal(result.status, 'download_ready');
  const download = ctx.adapter.download; ctx.adapter.download = async input => { ctx.calls.download.push(input); throw new Error('隔离下载失败'); }; result = await ctx.service.download(task.id); assert.equal(result.status, 'download_failed');
  ctx.adapter.download = download; result = await ctx.service.download(task.id); assert.equal(result.status, 'succeeded'); assert.equal(ctx.calls.submit.length, 1); assert.equal(ctx.calls.query.length, 2); assert.equal(ctx.calls.download.length, 2); assert.equal(result.result.automaticallySelected, false);
});

test('真实测试MP4经FFprobe后入候选，人工检查和选用分离，重做保留旧视频历史', async t => {
  const ctx = await fixture(t), first = await completed(ctx); let view = await ctx.service.view(ctx.project.id), old = view.assets[0];
  assert.equal(old.testFixture, true); assert.equal(old.source.kind, 'test'); assert.equal(old.state, 'pending_check'); assert.equal(old.probe.videoStreams, 1); assert.equal(old.probe.audioStreams, 0); assert.equal(old.probe.width, 320); assert.equal(view.selectionHistory.length, 0);
  await assert.rejects(ctx.service.select(ctx.project.id, { revision: view.revision, assetId: old.id }), /检查通过/);
  view = await ctx.service.review(ctx.project.id, { revision: view.revision, assetId: old.id, verdict: 'accepted', notes: '测试视频标记可见，非真实即梦效果验收。' });
  view = await ctx.service.select(ctx.project.id, { revision: view.revision, assetId: old.id }); assert.equal(view.assets[0].state, 'selected');
  const redo = await prepare(ctx, { redoOfTaskId: first.id }); assert.notEqual(redo.id, first.id); const duplicate = await prepare(ctx, { redoOfTaskId: first.id }); assert.equal(redo.id, duplicate.id);
  await submit(ctx, redo); await ctx.service.query(redo.id); await ctx.service.download(redo.id); view = await ctx.service.view(ctx.project.id);
  assert.equal(view.assets.length, 2); assert.equal(view.selectionHistory.length, 1); assert.equal(view.assets.find(item => item.id === old.id).state, 'selected'); assert.ok(ctx.service.file(ctx.project.id, old.id).bytes.equals(clip.bytes));
});

test('上游变化使旧视频需复核，原文件、版本与选用历史保留', async t => {
  const ctx = await fixture(t); await completed(ctx); let view = await ctx.service.view(ctx.project.id); const asset = view.assets[0]; view = await ctx.service.review(ctx.project.id, { revision: view.revision, assetId: asset.id, verdict: 'accepted' }); await ctx.service.select(ctx.project.id, { revision: view.revision, assetId: asset.id });
  const project = ctx.store.read('projects', ctx.project.id); ctx.store.update(project.id, { revision: project.revision, style: '新画风要求。' }); view = await ctx.service.view(ctx.project.id);
  assert.equal(view.assets[0].stale, true); assert.equal(view.assets[0].state, 'needs_review'); assert.equal(view.selectionHistory.length, 1); assert.ok(ctx.service.file(ctx.project.id, asset.id).bytes.equals(clip.bytes)); await assert.rejects(ctx.service.select(ctx.project.id, { revision: view.revision, assetId: asset.id }), /检查通过/);
});

test('外部ID或终态不符、只给路径、无效下载文件均不能冒充成功', async t => {
  const ctx = await fixture(t), task = await prepare(ctx); await submit(ctx, task);
  ctx.adapter.query = async () => ({ externalTaskId: 'FOREIGN-ID', status: 'success' }); assert.equal((await ctx.service.query(task.id)).status, 'query_failed');
  ctx.adapter.query = async input => ({ externalTaskId: input.externalTaskId, status: 'success' }); await ctx.service.query(task.id);
  ctx.adapter.download = async input => ({ externalTaskId: input.externalTaskId, status: 'success', path: path.join(ctx.store.root, 'missing.mp4') }); assert.equal((await ctx.service.download(task.id)).status, 'download_failed'); assert.equal(ctx.service.workspace.get(ctx.project.id).assets.length, 0);
});

test('取消与超时不重提，迟到受理ID保留以便查询，绝不自动导入', async t => {
  const ctx = await fixture(t, { service: { timeoutMs: 25 } }), task = await prepare(ctx), wait = deferred(); ctx.adapter.submit = async input => { ctx.calls.submit.push(input); return wait.promise; };
  let result = await submit(ctx, task); assert.equal(result.status, 'submission_unknown'); assert.equal(ctx.calls.submit.length, 1);
  wait.resolve({ externalTaskId: 'LATE-TEST-ID', status: 'success', raw: { fixture: true } }); await new Promise(resolve => setTimeout(resolve, 15)); result = ctx.service.read(task.id); assert.equal(result.externalTaskId, 'LATE-TEST-ID'); assert.equal(result.status, 'submission_unknown'); assert.equal(result.result, null); await submit(ctx, result); assert.equal(ctx.calls.submit.length, 1);
});

test('取消与重启恢复原视频ID和提交记录，不自动提交或查询', async t => {
  const ctx = await fixture(t), task = await prepare(ctx); await submit(ctx, task); ctx.service.cancel(task.id); ctx.service.close();
  const restored = new VideoService(ctx.store, { images: ctx.images, adapter: ctx.adapter }); t.after(() => restored.close());
  const value = restored.read(task.id); assert.equal(value.externalTaskId, 'ISOLATED-EXTERNAL-ID'); assert.equal(value.status, 'cancelled'); assert.equal(ctx.calls.submit.length, 1); assert.equal(ctx.calls.query.length, 0); assert.equal(ctx.calls.download.length, 0); await restored.submit(task.id, { confirm: true, quoteFingerprint: task.quoteFingerprint }); assert.equal(ctx.calls.submit.length, 1);
});

test('静音是明确派生计划，不伪造原生关音频，也不自动去轨或选用', async t => {
  const ctx = await fixture(t, { service: { probe: async () => ({ ...clip.probe, hasAudio: true, audioStreams: 1, audioCodecs: ['aac'], note: '音轨状态隔离逻辑夹具' }) } }), task = await prepare(ctx, { audioMode: 'mute_derivative' });
  await submit(ctx, task); await ctx.service.query(task.id); await ctx.service.download(task.id); let view = await ctx.service.view(ctx.project.id); const asset = view.assets[0]; assert.equal(asset.audioStatus, 'requires_explicit_derivation');
  view = await ctx.service.review(ctx.project.id, { revision: view.revision, assetId: asset.id, verdict: 'accepted' }); await assert.rejects(ctx.service.select(ctx.project.id, { revision: view.revision, assetId: asset.id }), /静音派生尚未执行/); assert.equal(view.selectionHistory.length, 0);
});

test('未选用图片和审核current失效即使selection历史仍在也拒绝', async t => {
  const ctx = await fixture(t); let view = ctx.images.view(ctx.project.id);
  view = ctx.images.import(ctx.project.id, { revision: view.revision, role: 'shot', targetId: 'SHOT-01', filename: 'SECOND-TEST-NOT-AI.png', source: { kind: 'test', description: '第二个未选用隔离图' } }, testPng());
  const unused = view.assets.at(-1); await assert.rejects(prepare(ctx, { imageAssetId: unused.id }), /未选用|当前有效/);
  const ws = ctx.images.get(ctx.project.id); ws.reviews[0].referenceHash = 'invalid-old-review'; ctx.images.save(ws);
  await assert.rejects(prepare(ctx), /当前有效|人工检查/); assert.equal(ctx.calls.submit.length, 0);
});

test('下载途中输入变化只导入原绑定的过期候选，不覆盖新输入或自动选用', async t => {
  const ctx = await fixture(t), task = await prepare(ctx); await submit(ctx, task); await ctx.service.query(task.id); const wait = deferred();
  ctx.adapter.download = async input => { ctx.calls.download.push(input); return wait.promise; }; const downloading = ctx.service.download(task.id); await new Promise(resolve => setTimeout(resolve, 10));
  const project = ctx.store.read('projects', ctx.project.id); ctx.store.update(project.id, { revision: project.revision, style: '下载期间的新要求' });
  wait.resolve({ externalTaskId: 'ISOLATED-EXTERNAL-ID', status: 'success', path: clip.path, raw: { fixture: true } }); const done = await downloading; assert.equal(done.status, 'succeeded');
  const view = await ctx.service.view(ctx.project.id); assert.equal(view.assets[0].stale, true); assert.deepEqual(view.assets[0].binding, task.binding); assert.equal(view.selectionHistory.length, 0); assert.equal(ctx.calls.submit.length, 1);
});

test('原输入快照/参数Hash损坏不得提交或把旧任务重绑', async t => {
  const ctx = await fixture(t), task = await prepare(ctx); task.parameters.motionPrompt = '磁盘上未经确认的新提示词'; ctx.store.write('video-jobs', task);
  await assert.rejects(submit(ctx, task), /Hash绑定不一致/); assert.equal(ctx.calls.submit.length, 0); assert.equal(ctx.service.read(task.id).submittedAt, null);
});

test('提交意图存在但ID缺失时重启停在unknown，不能自动或重复提交', async t => {
  const ctx = await fixture(t), task = await prepare(ctx); task.submittedAt = new Date().toISOString(); task.status = 'submitting'; task.cost = { amount: 5, currency: 'CREDITS' }; ctx.store.write('video-jobs', task); ctx.service.close();
  const restored = new VideoService(ctx.store, { images: ctx.images, adapter: ctx.adapter }); t.after(() => restored.close());
  assert.equal(restored.read(task.id).status, 'submission_unknown'); assert.equal(restored.read(task.id).externalTaskId, null); await restored.submit(task.id, { confirm: true, quoteFingerprint: task.quoteFingerprint }); assert.equal(ctx.calls.submit.length, 0); assert.equal(ctx.calls.query.length, 0);
});

test('漏写fixture标志的注入adapter仍标测试来源，不提升真实即梦验收', async t => {
  const ctx = await fixture(t, { adapter: { executionMode: undefined } }); await completed(ctx); const view = await ctx.service.view(ctx.project.id);
  assert.equal(view.assets[0].testFixture, true); assert.equal(view.assets[0].source.kind, 'test'); assert.equal(view.capability.actualGenerationVerified, false); assert.equal(view.capability.executionMode, 'isolated-fixture');
});

test('服务关闭时查询等待及时结束且保留interrupted，不改成query_failed', async t => {
  const ctx = await fixture(t), task = await prepare(ctx); await submit(ctx, task); const wait = deferred(); ctx.adapter.query = async input => { ctx.calls.query.push(input); return wait.promise; };
  const querying = ctx.service.query(task.id); await new Promise(resolve => setTimeout(resolve, 10)); ctx.service.close(); const stopped = await querying;
  assert.equal(stopped.status, 'interrupted'); assert.equal(stopped.externalTaskId, 'ISOLATED-EXTERNAL-ID'); wait.resolve({ externalTaskId: 'ISOLATED-EXTERNAL-ID', status: 'success', raw: { fixture: true } }); await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(ctx.service.read(task.id).status, 'interrupted'); assert.equal(ctx.calls.submit.length, 1);
});

test('提交状态未知仍保存实际外部ID，仅查询原ID且不重复提交', async t => {
  const ctx = await fixture(t); ctx.adapter.submit = async input => { ctx.calls.submit.push(input); return { externalTaskId: 'OBSERVED-UNKNOWN-ID', status: 'unknown', error: '隔离传输错误：状态尚未核实。', raw: { fixture: true, submit_id: 'OBSERVED-UNKNOWN-ID', gen_status: 'future_unrecognized_status' } }; };
  const task = await prepare(ctx), unknown = await submit(ctx, task);
  assert.equal(unknown.status, 'submission_unknown'); assert.equal(unknown.providerStatus, 'unknown'); assert.equal(unknown.externalTaskId, 'OBSERVED-UNKNOWN-ID'); assert.equal(unknown.result, null); assert.match(unknown.error, /状态尚未核实/); assert.ok(unknown.receipts.some(receipt => receipt.externalTaskId === 'OBSERVED-UNKNOWN-ID'));
  await submit(ctx, task); assert.equal(ctx.calls.submit.length, 1);
  const queried = await ctx.service.query(task.id); assert.equal(queried.status, 'download_ready'); assert.equal(ctx.calls.query[0].externalTaskId, 'OBSERVED-UNKNOWN-ID'); assert.equal(queried.externalTaskId, 'OBSERVED-UNKNOWN-ID'); assert.equal(ctx.calls.submit.length, 1); assert.equal(ctx.calls.download.length, 0);
});

test('adapter内部等待后实际执行前的可信回调再次核对图片审核', async t => {
  const ctx = await fixture(t); let externalCalls = 0;
  ctx.adapter.submit = async input => {
    assert.equal(typeof input.beforeSubmit, 'function');
    const images = ctx.images.get(ctx.project.id); ctx.images.review(ctx.project.id, { revision: images.revision, assetId: ctx.image.id, verdict: 'rejected', notes: 'adapter等待期间撤回参考图' });
    input.beforeSubmit(); externalCalls++; return { externalTaskId: 'SHOULD-NOT-SUBMIT', status: 'querying', raw: { fixture: true } };
  };
  const task = await prepare(ctx), blocked = await submit(ctx, task);
  assert.equal(externalCalls, 0); assert.equal(blocked.externalTaskId, null); assert.equal(blocked.status, 'submission_unknown'); assert.match(blocked.error, /当前有效|人工检查/); assert.equal(blocked.result, null);
});
