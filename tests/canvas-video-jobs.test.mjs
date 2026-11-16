import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CanvasVideoService } from '../src/canvas-video-jobs.mjs';
import { probeVideo } from '../src/video-media.mjs';
import { createCanvasFixture, canvasDeferred } from './canvas-fixtures.mjs';

async function waitFor(predicate, timeout = 5000) { const until = Date.now() + timeout; while (!predicate()) { if (Date.now() > until) throw new Error('Fixture wait timed out'); await new Promise(resolve => setTimeout(resolve, 5)); } }

test('画布准备与重复准备持久化同submitId完整范围，缺本人签名/请求自报批准均0确认0生成', async t => {
  const ctx = await createCanvasFixture(t), [a, b] = await Promise.all([ctx.prepare(), ctx.prepare()]);
  assert.equal(a.id, b.id); assert.equal(a.submitId, b.submitId); assert.equal(ctx.service.list().values.length, 1);
  assert.equal(a.plan.localProjectId, ctx.project.id); assert.equal(a.authorizationBinding.scope.canvasProjectId, a.plan.projectId); assert.equal(a.authorizationBinding.scope.draftVersion, 3); assert.equal(a.authorizationBinding.scope.inputSha256, ctx.image.sha256); assert.equal(a.authorizationBinding.scope.parameters.outputCount, 1);
  assert.equal(a.authorization.status, 'not_granted'); assert.equal(a.canSubmit, false); assert.equal(a.submittedAt, null); assert.equal(a.cost.actualAmount, null); assert.equal(a.cost.estimatedMaximum, 70);
  await assert.rejects(ctx.service.submit(a.id, { confirm: true, approved: true, authorization: { maxEstimatedCredits: 70 } }), /待本人批准/);
  assert.equal(ctx.calls.submit, 0); assert.equal(ctx.calls.confirm, 0); assert.equal(ctx.calls.run, 0); assert.equal(ctx.service.read(a.id).submittedAt, null);
});

test('批准后最新报价超70或草稿版本改变均在消费意图前阻断，原范围不重绑', async t => {
  const ctx = await createCanvasFixture(t), task = await ctx.prepare(); ctx.approve(task);
  ctx.faults.quoteAmount = 71; await assert.rejects(ctx.service.submit(task.id), /超过70/);
  assert.equal(ctx.service.read(task.id).submittedAt, null); assert.equal(ctx.calls.confirm, 0);
  ctx.faults.quoteAmount = 70; ctx.faults.draftVersion = 4; await assert.rejects(ctx.service.submit(task.id), /草稿版本|范围失效/);
  const view = await ctx.service.refresh(task.id); assert.equal(view.stale, true); assert.equal(view.authorizationBinding.scope.draftVersion, 3); assert.equal(ctx.service.read(task.id).submittedAt, null); assert.equal(ctx.calls.run, 0);
});

test('等待确认前当前图片人工审核改变，可信回调重新读取输入并停止后续确认运行', async t => {
  const ctx = await createCanvasFixture(t), task = await ctx.prepare(); ctx.approve(task);
  ctx.faults.onSubmit = async () => { const images = ctx.images.get(ctx.project.id); ctx.images.review(ctx.project.id, { revision: images.revision, assetId: ctx.image.id, verdict: 'rejected', notes: '【ISOLATED】确认前撤销图片审核' }); };
  const result = await ctx.service.submit(task.id); assert.equal(result.status, 'submission_unknown'); assert.ok(result.submittedAt); assert.equal(result.stale, true); assert.equal(ctx.calls.confirm, 0); assert.equal(ctx.calls.run, 0);
  await ctx.service.submit(task.id); assert.equal(ctx.calls.submit, 1); assert.equal(ctx.calls.confirm, 0);
});

test('并发/重复提交只进入一条隔离执行，稳定submitId、授权claim和意图在确认前落盘', async t => {
  const ctx = await createCanvasFixture(t), task = await ctx.prepare(); ctx.approve(task);
  ctx.faults.onSubmit = async input => { const saved = ctx.service.read(task.id); assert.equal(saved.status, 'submitting'); assert.ok(saved.submittedAt); assert.equal(saved.submitId, input.submitId); assert.equal(ctx.authority.find(task.id).claimedSubmitId, input.submitId); };
  const results = await Promise.all([ctx.service.submit(task.id), ctx.service.submit(task.id), ctx.service.submit(task.id)]);
  assert.ok(results.every(result => result.status === 'querying')); assert.equal(ctx.calls.submit, 1); assert.equal(ctx.calls.confirm, 1); assert.equal(ctx.calls.run, 1); assert.deepEqual(ctx.calls.submitIds, [task.submitId]);
  await ctx.service.submit(task.id); assert.equal(ctx.calls.run, 1); assert.equal(ctx.service.read(task.id).cost.actualAmount, null);
});

test('查询失败只恢复原ID，下载失败只重试下载，实际候选/人工检查/选用分开且旧版保留', async t => {
  const ctx = await createCanvasFixture(t), task = await ctx.prepare(); ctx.approve(task); await ctx.service.submit(task.id);
  ctx.faults.queryFailures = 1; let result = await ctx.service.query(task.id); assert.equal(result.status, 'query_failed'); assert.equal(result.submitId, task.submitId);
  await ctx.service.submit(task.id); assert.equal(ctx.calls.run, 1); result = await ctx.service.query(task.id); assert.equal(result.status, 'download_ready');
  const previous = ctx.videos.get(ctx.project.id), oldAsset = previous.assets.find(asset => asset.shotId === 'SHOT-01'); ctx.faults.downloadFailures = 1;
  result = await ctx.service.download(task.id); assert.equal(result.status, 'download_failed'); await ctx.service.submit(task.id); assert.equal(ctx.calls.run, 1);
  result = await ctx.service.download(task.id); assert.equal(result.status, 'succeeded', result.downloadError); assert.equal(ctx.calls.download, 2); assert.deepEqual(ctx.calls.queryIds, [task.submitId, task.submitId]); assert.deepEqual(ctx.calls.downloadIds, [task.submitId, task.submitId]);
  let workspace = ctx.videos.view(ctx.project.id), candidate = workspace.assets.find(asset => asset.id === result.result.assetId);
  assert.equal(candidate.source.kind, 'test'); assert.equal(candidate.testFixture, true); assert.equal(candidate.state, 'pending_check'); assert.equal(candidate.selected, false); assert.equal(candidate.version, 2); assert.equal(candidate.provenance.canvasProjectId, task.plan.projectId); assert.equal(candidate.provenance.submitId, task.submitId); assert.equal(candidate.provenance.original.sha256, ctx.clip.sha256);
  assert.equal(workspace.selectionHistory.length, previous.selectionHistory.length); assert.equal(workspace.assets.find(asset => asset.id === oldAsset.id).selected, true);
  assert.throws(() => ctx.videos.select(ctx.project.id, { revision: workspace.revision, assetId: candidate.id }), /人工检查/);
  ctx.videos.review(ctx.project.id, { revision: workspace.revision, assetId: candidate.id, verdict: 'accepted', notes: '【ISOLATED TEST ONLY】测试素材检查，不是模型首帧符合性证据。' }); workspace = ctx.videos.view(ctx.project.id); ctx.videos.select(ctx.project.id, { revision: workspace.revision, assetId: candidate.id });
  assert.equal(ctx.hash(ctx.videos.file(ctx.project.id, oldAsset.id).bytes), ctx.clip.sha256); assert.equal(ctx.videos.view(ctx.project.id).selectionHistory.length, previous.selectionHistory.length + 1); assert.equal(result.result.automaticallySelected, false);
});

test('下载中上游变化保留原输入候选并需复核，不能把迟到产物重绑新要求', async t => {
  const ctx = await createCanvasFixture(t), task = await ctx.ready();
  ctx.faults.onDownload = async () => { const project = ctx.store.read('projects', ctx.project.id); ctx.store.update(project.id, { revision: project.revision, idea: project.idea + '\n【ISOLATED】新的输入要求' }); };
  const done = await ctx.service.download(task.id); assert.equal(done.status, 'succeeded', done.downloadError); assert.equal(done.stale, true); assert.equal(done.bindingHash, task.bindingHash);
  const candidate = ctx.videos.view(ctx.project.id).assets.find(asset => asset.id === done.result.assetId); assert.equal(candidate.stale, true); assert.equal(candidate.state, 'needs_review'); assert.equal(candidate.bindingHash, task.bindingHash);
  assert.throws(() => ctx.videos.review(ctx.project.id, { revision: ctx.videos.get(ctx.project.id).revision, assetId: candidate.id, verdict: 'accepted' }), /过期/); assert.equal(ctx.calls.run, 1);
});

test('隔离有音轨分支保存原片并生成本地静音派生；测试字节本身无声，不冒充真实有声转无声', async t => {
  let ctx;
  ctx = await createCanvasFixture(t, { serviceOptions: {
    probe: async file => { const actual = await probeVideo(file); return path.basename(file) === 'original.mp4' ? { ...actual, hasAudio: true, audioStreams: 1, audioCodecs: ['ISOLATED-SIMULATED-AUDIO'] } : actual; },
    stripAudio: async (input, output, options) => { ctx.calls.strip++; assert.equal(options.confirmed, true); fs.copyFileSync(input, output, fs.constants.COPYFILE_EXCL); return probeVideo(output); },
  } });
  const task = await ctx.ready(), done = await ctx.service.download(task.id); assert.equal(done.status, 'succeeded', done.downloadError); assert.equal(ctx.calls.strip, 1); assert.equal(done.result.derivative.originalRetained, true); assert.equal(done.result.derivative.nativeSilent, false);
  const asset = ctx.videos.get(ctx.project.id).assets.find(asset => asset.id === done.result.assetId); assert.equal(asset.provenance.original.sha256, ctx.clip.sha256); assert.equal(asset.provenance.derivative.parentSha256, ctx.clip.sha256); assert.equal(asset.audioStatus, 'local_silent_derivative_verified'); assert.equal(asset.probe.audioStreams, 0);
  const original = ctx.service.originalFile(task.id); assert.equal(ctx.hash(original.bytes), ctx.clip.sha256); assert.ok(fs.existsSync(ctx.calls.downloads[0].outputPath)); assert.equal(ctx.calls.run, 1);
});

test('服务关闭重启恢复原submitId及interrupted，迟到受理不复活，不自动再确认或提交', async t => {
  const pending = canvasDeferred(), ctx = await createCanvasFixture(t, { faults: { pendingSubmit: pending } }), task = await ctx.prepare(); ctx.approve(task);
  const first = ctx.service.submit(task.id); await waitFor(() => ctx.calls.run === 1); ctx.service.close();
  const recovered = new CanvasVideoService(ctx.store, ctx.options); t.after(() => recovered.close()); assert.equal(recovered.read(task.id).status, 'interrupted'); assert.equal(recovered.read(task.id).submitId, task.submitId);
  pending.resolve({ submitId: task.submitId, status: 'querying', raw: { testFixture: true, late: true } }); await first;
  assert.equal(recovered.read(task.id).status, 'interrupted'); await recovered.submit(task.id); assert.equal(ctx.calls.run, 1); assert.equal(ctx.calls.confirm, 1); assert.equal(recovered.read(task.id).externalTaskId, task.submitId);
  const queried = await recovered.query(task.id); assert.equal(queried.status, 'download_ready'); assert.deepEqual(ctx.calls.queryIds, [task.submitId]);
});

test('损坏任务快照Hash或签名不消费，保留损坏文件及旧人工视频；不按新目录清额度', async t => {
  const ctx = await createCanvasFixture(t), task = await ctx.prepare(), grant = ctx.approve(task), file = ctx.authority.file(grant.id);
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8')); envelope.value.maxEstimatedCredits = 100; fs.writeFileSync(file, JSON.stringify(envelope));
  await assert.rejects(ctx.service.submit(task.id), /批准|签名|历史/); assert.equal(ctx.calls.submit, 0); assert.equal(ctx.service.read(task.id).submittedAt, null);
  const saved = ctx.service.read(task.id); saved.plan.prompt += ' tampered'; ctx.store.write('canvas-video-jobs', saved); await assert.rejects(ctx.service.submit(task.id), /Hash|范围/); assert.equal(ctx.calls.confirm, 0);
  assert.equal(ctx.hash(ctx.videos.file(ctx.project.id, ctx.assets[0].id).bytes), ctx.clip.sha256); assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).value.maxEstimatedCredits, 100);
});

test('本地超时和取消后只保留原身份，迟到回执留证不复活或自动重新生成', async t => {
  for (const kind of ['timeout', 'cancel']) {
    const pending = canvasDeferred(), ctx = await createCanvasFixture(t, { serviceOptions: { timeoutMs: kind === 'timeout' ? 40 : 5000 }, faults: { pendingSubmit: pending } }), task = await ctx.prepare(); ctx.approve(task);
    const waiting = ctx.service.submit(task.id); await waitFor(() => ctx.calls.run === 1);
    if (kind === 'cancel') ctx.service.cancel(task.id);
    const stopped = await waiting; assert.equal(stopped.status, kind === 'cancel' ? 'cancelled' : 'submission_unknown'); assert.equal(stopped.submitId, task.submitId);
    pending.resolve({ submitId: task.submitId, status: 'querying', raw: { testFixture: true, late: true } }); await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(ctx.service.read(task.id).status, stopped.status); await ctx.service.submit(task.id); assert.equal(ctx.calls.run, 1); assert.equal(ctx.calls.confirm, 1); assert.equal(ctx.calls.query, 0);
    assert.ok(ctx.service.read(task.id).receipts.some(receipt => receipt.stage === 'submit')); assert.equal(ctx.videos.get(ctx.project.id).assets.length, 3);
  }
});
