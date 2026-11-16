import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createStudio } from '../src/server.mjs';
import { createCanvasFixture } from './canvas-fixtures.mjs';

async function setup(t) {
  const ctx = await createCanvasFixture(t);
  const app = createStudio({ dataDir: ctx.store.root, canvasVideoOptions: { adapter: ctx.adapter, evidence: ctx.evidence } });
  t.after(() => app.close()); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (url, body) => { const response = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { response, value: await response.json() }; };
  return { ...ctx, app, base, api, route: `/api/projects/${ctx.project.id}/canvas-video` };
}

test('HTTP不能自发授权；签名本机批准后仍重查70阈值，失败不留下真实提交意图', async t => {
  const ctx = await setup(t), prepared = await ctx.api(ctx.route, { revision: ctx.videos.get(ctx.project.id).revision, shotId: 'SHOT-01' });
  assert.equal(prepared.response.status, 201); const task = prepared.value;
  const forged = await ctx.api(`/api/canvas-video-tasks/${task.id}/submit`, { confirm: true, authorized: true, ignoreCost: true, grant: { scopeHash: task.authorizationBinding.scopeHash, maxEstimatedCredits: 70 }, maxSubmissions: 1 });
  assert.equal(forged.response.status, 409); assert.match(forged.value.error, /本人批准|授权/); assert.equal(ctx.calls.confirm, 0); assert.equal(ctx.calls.run, 0); assert.equal(ctx.app.canvasVideo.read(task.id).submittedAt, null);
  const issue = await ctx.api(`/api/canvas-video-tasks/${task.id}/approve`, { approved: true }); assert.equal(issue.response.status, 404);
  ctx.approve(task); ctx.faults.quoteAmount = 71;
  const blocked = await ctx.api(`/api/canvas-video-tasks/${task.id}/submit`, {}); assert.equal(blocked.response.status, 409); assert.match(blocked.value.error, /70/); assert.equal(ctx.calls.confirm, 0); assert.equal(ctx.app.canvasVideo.read(task.id).submittedAt, null);
  const view = (await ctx.api(ctx.route)).value; assert.equal(view.tasks[0].canSubmit, false); assert.ok(view.tasks[0].quoteError);
});

test('HTTP隔离成功只入候选；原片下载Hash/Range、人工检查与选用独立且实际来源留存', async t => {
  const ctx = await setup(t), task = (await ctx.api(ctx.route, { revision: ctx.videos.get(ctx.project.id).revision, shotId: 'SHOT-01' })).value;
  ctx.approve(task);
  const submit = await ctx.api(`/api/canvas-video-tasks/${task.id}/submit`, {}); assert.equal(submit.response.status, 202); assert.equal(submit.value.submitId, task.submitId);
  await ctx.api(`/api/canvas-video-tasks/${task.id}/submit`, {}); assert.equal(ctx.calls.run, 1);
  await ctx.api(`/api/canvas-video-tasks/${task.id}/query`, {}); const done = await ctx.api(`/api/canvas-video-tasks/${task.id}/download`, {});
  assert.equal(done.value.status, 'succeeded', done.value.downloadError); const asset = ctx.videos.view(ctx.project.id).assets.find(asset => asset.id === done.value.result.assetId);
  assert.equal(asset.state, 'pending_check'); assert.equal(asset.testFixture, true); assert.equal(asset.provenance.submitId, task.submitId); assert.equal(asset.provenance.original.sha256, ctx.clip.sha256); assert.equal(asset.selected, false);
  const url = ctx.base + `/api/canvas-video-tasks/${task.id}/original`, response = await fetch(url); assert.equal(response.status, 200); const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(createHash('sha256').update(bytes).digest('hex'), done.value.result.originalSha256);
  const range = await fetch(url, { headers: { Range: 'bytes=0-63' } }); assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 64));
  const head = await fetch(url, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
  const view = ctx.videos.get(ctx.project.id); const checked = await ctx.api(`/api/projects/${ctx.project.id}/videos/review`, { revision: view.revision, assetId: asset.id, verdict: 'accepted', notes: '只对TEST软件素材人工核对，不是AI生成验收。' }); assert.equal(checked.response.status, 200);
  assert.equal(ctx.videos.view(ctx.project.id).assets.find(item => item.id === asset.id).selected, false);
});
