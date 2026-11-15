import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createStudio } from '../src/server.mjs';
import { fixtureEntities, fixtureShots } from './creative-fixtures.mjs';
import { testPng } from './image-fixtures.mjs';
import { createTestVideo } from './video-fixtures.mjs';

const directory = path.resolve('tests/.artifacts'); fs.mkdirSync(directory, { recursive: true });
const cap = { canSubmit: true, realSubmissionEnabled: false, contractVerified: true, auth: { loggedIn: true }, defaults: { model: 'seedance2.0_vip', durationSeconds: 5, resolution: '720p', audioMode: 'provider_default' }, models: [{ id: 'seedance2.0_vip', duration: { min: 4, max: 15, step: 1 }, resolutions: ['720p'] }], message: '隔离软件测试，非真实服务能力证明。' };
function testPrice() { return { status: 'known', canSubmit: true, currency: 'CREDITS', billingType: 'credits', amount: 5, unit: 'credits/task', channel: 'dreamina-cli-image2video', basis: '仅隔离测试价格，不是官方价格。', sources: [{ type: 'isolated_fixture' }], conditions: ['仅软件测试'], evidenceId: 'TEST-PRICE-NOT-OFFICIAL', expiresAt: '2099-01-01T00:00:00Z' }; }
async function fixture(t, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(directory, 'video-http-')); let calls = 0;
  const adapter = { executionMode: 'isolated-fixture', inspect: async () => structuredClone(cap), quote: async () => testPrice(), submit: async () => { calls++; return { status: 'success', externalTaskId: 'TEST-SUBMIT-ONLY' }; }, download: async ({ cwd }) => { const video = await createTestVideo(cwd); return { status: 'success', externalTaskId: 'TEST-SUBMIT-ONLY', path: video.path }; }, ...options };
  const app = createStudio({ dataDir, videoOptions: { adapter } }); t.after(() => app.close());
  const project = app.store.create({ name: '[隔离HTTP视频验收]', idea: 'TEST FIXTURE ONLY，未调用即梦。' });
  app.creative.update(project.id, { revision: 0, entities: structuredClone(fixtureEntities), shots: fixtureShots() });
  app.creative.addVersion(project.id, { revision: 1, kind: 'storyboard', body: '【测试】三个镜头' });
  let images = app.images.import(project.id, { revision: 0, role: 'shot', targetId: 'SHOT-01', filename: 'TEST-FIXTURE-NOT-AI.png', source: { kind: 'test', description: '明确像素标记非AI测试图。' } }, testPng());
  const image = images.assets.at(-1);
  images = app.images.review(project.id, { revision: images.revision, assetId: image.id, verdict: 'accepted', notes: '仅隔离输入检查' }); app.images.select(project.id, { revision: images.revision, assetId: image.id });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (route, body) => { const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { response, value: await response.json() }; };
  return { app, base, project, image, api, calls: () => calls };
}

test('HTTP实际测试视频下载后才候选，Range/HEAD预览及Hash完整，未自动检查或选用', async t => {
  const ctx = await fixture(t), route = `/api/projects/${ctx.project.id}/videos`;
  const prepared = await ctx.api(route + '/prepare', { revision: 0, shotId: 'SHOT-01', imageAssetId: ctx.image.id, creditsBudget: 5 });
  assert.equal(prepared.response.status, 201); assert.equal(ctx.calls(), 0); const task = prepared.value;
  const submitted = await ctx.api(`/api/video-tasks/${task.id}/submit`, { confirm: true, quoteFingerprint: task.quoteFingerprint });
  assert.equal(submitted.response.status, 202); assert.equal(submitted.value.status, 'download_ready'); assert.equal(ctx.calls(), 1);
  assert.equal((await ctx.api(route)).value.assets.length, 0);
  const downloaded = await ctx.api(`/api/video-tasks/${task.id}/download`, {}); assert.equal(downloaded.value.status, 'succeeded', downloaded.value.downloadError);
  const ws = (await ctx.api(route)).value, asset = ws.assets[0]; assert.equal(asset.source.kind, 'test'); assert.equal(asset.state, 'pending_check'); assert.equal(ws.selectionHistory.length, 0); assert.equal(asset.probe.audioStreams, 0); assert.ok(Math.abs(asset.probe.durationSeconds - 5) < 0.1);
  const file = ctx.app.videos.file(ctx.project.id, asset.id), url = ctx.base + asset.url;
  const head = await fetch(url, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(Number(head.headers.get('content-length')), file.bytes.length); assert.equal((await head.arrayBuffer()).byteLength, 0);
  const partial = await fetch(url, { headers: { Range: 'bytes=0-127' } }); assert.equal(partial.status, 206); assert.equal(partial.headers.get('content-range'), `bytes 0-127/${file.bytes.length}`); assert.deepEqual(Buffer.from(await partial.arrayBuffer()), file.bytes.subarray(0, 128));
  const suffix = await fetch(url, { headers: { Range: 'bytes=-64' } }); assert.equal(suffix.status, 206); assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), file.bytes.subarray(-64));
  for (const range of ['bytes=999999999-', 'bytes=5-1', 'bytes=0-1,5-6', 'bytes=-0']) assert.equal((await fetch(url, { headers: { Range: range } })).status, 416);
  const full = await fetch(url); assert.deepEqual(Buffer.from(await full.arrayBuffer()), file.bytes); assert.equal(ctx.calls(), 1);
});

test('HTTP未知报价不能以余额/预算/fixture请求参数绕过提交，原图片改判后准备受阻', async t => {
  const ctx = await fixture(t, { quote: async () => ({ status: 'unknown', amount: null, currency: 'CREDITS', canSubmit: false, basis: '缺视频报价，余额不替代。' }) }), route = `/api/projects/${ctx.project.id}/videos`;
  const prepared = await ctx.api(route + '/prepare', { revision: 0, shotId: 'SHOT-01', creditsBudget: 100 });
  const result = await ctx.api(`/api/video-tasks/${prepared.value.id}/submit`, { confirm: true, quoteFingerprint: prepared.value.quoteFingerprint, fixtureMode: true, ignoreCost: true });
  assert.equal(result.response.status, 409); assert.match(result.value.error, /费用待确认/); assert.equal(ctx.calls(), 0);
  let images = ctx.app.images.view(ctx.project.id); ctx.app.images.review(ctx.project.id, { revision: images.revision, assetId: ctx.image.id, verdict: 'rejected', notes: '测试撤销审核' });
  const rejected = await ctx.api(route + '/prepare', { revision: 0, shotId: 'SHOT-01', creditsBudget: 100 }); assert.equal(rejected.response.status, 409); assert.equal(ctx.calls(), 0);
});
