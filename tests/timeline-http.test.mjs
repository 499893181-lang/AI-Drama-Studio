import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createStudio } from '../src/server.mjs';
import { createTimelineFixture } from './timeline-fixtures.mjs';

async function context(t) {
  const fixture = await createTimelineFixture();
  const app = createStudio({ dataDir: fixture.store.root });
  t.after(async () => { fixture.timeline.close(); await app.close(); });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (route, body, method = 'POST') => {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { response, value: await response.json() };
  };
  return { ...fixture, app, base, api, route: `/api/projects/${fixture.project.id}/timeline` };
}
async function completed(ctx, id) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = (await ctx.api(`/api/timeline-exports/${id}`)).value;
    if (value.status !== 'exporting') return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('本地导出未在20秒内结束');
}

test('HTTP本地顺序拼接持久化去重，实际MP4 Range/HEAD、manifest及旧导出保留', async t => {
  const ctx = await context(t), sourceHashes = ctx.assets.map(asset => asset.sha256);
  const saved = await ctx.api(ctx.route, { revision: 0, clips: [ctx.assets[2], ctx.assets[0], ctx.assets[1]].map(asset => ({ assetId: asset.id })), audioMode: 'mute_derivative' }, 'PUT');
  assert.equal(saved.response.status, 200);
  assert.deepEqual(saved.value.clips.map(clip => clip.shotId), ['SHOT-03', 'SHOT-01', 'SHOT-02']);
  assert.equal(saved.value.formalStageStatus, 'not_checked');
  const input = { revision: saved.value.revision }, a = await ctx.api(ctx.route + '/exports', input), b = await ctx.api(ctx.route + '/exports', input);
  assert.equal(a.response.status, 201); assert.equal(a.value.id, b.value.id); assert.equal(a.value.submittedAt, null);
  const replies = await Promise.all([ctx.api(`/api/timeline-exports/${a.value.id}/run`, {}), ctx.api(`/api/timeline-exports/${a.value.id}/run`, {})]);
  for (const reply of replies) { assert.equal(reply.response.status, 202); assert.equal(reply.value.id, a.value.id); }
  const task = await completed(ctx, a.value.id); assert.equal(task.status, 'succeeded', task.error); assert.equal(task.runAttempts, 1); assert.equal(task.externalProviderCalls, 0);
  assert.equal(task.testFixture, true); assert.equal(task.result.probe.audioStreams, 0); assert.ok(Math.abs(task.result.probe.durationSeconds - 15) < 0.2);
  const endpoint = ctx.base + `/api/timeline-exports/${task.id}/file`, file = await fetch(endpoint), bytes = Buffer.from(await file.arrayBuffer());
  assert.equal(file.status, 200); assert.equal(createHash('sha256').update(bytes).digest('hex'), task.result.sha256);
  const head = await fetch(endpoint, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
  const range = await fetch(endpoint, { headers: { Range: 'bytes=0-127' } }); assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 128));
  const manifest = (await ctx.api(`/api/timeline-exports/${task.id}/manifest`)).value;
  assert.equal(manifest.testFixture, true); assert.equal(manifest.formalStageStatus, 'not_checked'); assert.equal(manifest.clips.length, 3); assert.match(manifest.audioDescription, /后处理/);
  assert.deepEqual(manifest.clips.map(clip => clip.shotId), ['SHOT-03', 'SHOT-01', 'SHOT-02']);
  const next = await ctx.api(ctx.route, { revision: saved.value.revision, clips: [{ assetId: ctx.assets[0].id }], audioMode: 'preserve' }, 'PUT');
  assert.equal(next.value.versions.length, 2); assert.equal((await ctx.api(ctx.route)).value.exports[0].stale, true); assert.equal((await fetch(endpoint)).status, 200);
  assert.deepEqual(ctx.assets.map(asset => ctx.videos.file(ctx.project.id, asset.id).bytes).map(bytes => createHash('sha256').update(bytes).digest('hex')), sourceHashes);
});

test('HTTP旧准备任务在源审核撤销后返回真实409且不执行，拒绝任意文件路径', async t => {
  const ctx = await context(t);
  const saved = await ctx.api(ctx.route, { revision: 0, clips: [{ assetId: ctx.assets[0].id }], audioMode: 'preserve' }, 'PUT');
  const prepared = (await ctx.api(ctx.route + '/exports', { revision: saved.value.revision })).value;
  ctx.videos.review(ctx.project.id, { revision: ctx.videos.get(ctx.project.id).revision, assetId: ctx.assets[0].id, verdict: 'rejected', notes: '明确测试：撤销当前源视频检查。' });
  const result = await ctx.api(`/api/timeline-exports/${prepared.id}/run`, {});
  assert.equal(result.response.status, 409); assert.match(result.value.error, /过期|拒绝|复核/);
  const task = ctx.app.timeline.read(prepared.id); assert.equal(task.submittedAt, null); assert.equal(task.runAttempts, 0);
  const malicious = await ctx.api(ctx.route, { revision: saved.value.revision, clips: [{ assetId: '../../private.mp4', path: 'C:\\private.mp4' }], audioMode: 'preserve' }, 'PUT');
  assert.equal(malicious.response.status, 400); assert.equal(ctx.app.timeline.view(ctx.project.id).revision, saved.value.revision);
});

test('画布报价证据HTTP只读，检查页不提供生成/确认入口，不能写入或挪用direct', async t => {
  const ctx = await context(t), result = await ctx.api('/api/video-channels/canvas');
  assert.equal(result.response.status, 200); assert.equal(result.value.canSubmit, false);
  const blocked = await ctx.api('/api/video-channels/canvas', { run: true, confirm: true }); assert.equal(blocked.response.status, 405);
  const html = await (await fetch(ctx.base + '/video-channel.html')).text(); assert.match(html, /只读/); assert.doesNotMatch(html, /<form/);
});
