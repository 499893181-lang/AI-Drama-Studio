// Explicit one-image real acceptance. Preparation/observation never starts a model turn.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixtureIdea, fixtureEntities, fixtureShots } from '../tests/creative-fixtures.mjs';
import { testPng } from '../tests/image-fixtures.mjs';

const base = process.env.STUDIO_URL || 'http://127.0.0.1:4320';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('仅连接本机验收服务。');
const root = path.resolve('tests/.artifacts/auto-image-real'); fs.mkdirSync(root, { recursive: true });
const file = path.join(root, 'receipt.json');
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { startedAt: new Date().toISOString(), base, maxImageCalls: 1, maxImages: 1 };
const save = () => fs.writeFileSync(file, JSON.stringify(state, null, 2));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function api(route, body, method = 'POST') {
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json(); if (!response.ok) throw new Error(`${response.status}: ${result.error}`); return result;
}
const project = () => `/api/projects/${state.projectId}`;
const imageView = () => api(project() + '/images');
const task = () => api(`/api/image-generation-tasks/${state.taskId}`);
let ready = false;
for (let n = 0; n < 40; n++) { try { await api('/api/health'); ready = true; break; } catch { await pause(200); } }
if (!ready) throw new Error('独立4320服务尚未就绪。');

if (process.argv.includes('--prepare-only')) {
  if (!state.projectId) {
    const created = await api('/api/projects', { name: '[真实单图验收] 等一杯茶', idea: '【独立非个人验收故事】' + fixtureIdea, durationSeconds: 30, aspectRatio: '16:9', style: '朴素生活观察。本轮只生成一个镜头的一张静态图片。' });
    state.projectId = created.id; save();
    const shots = fixtureShots(); shots[0].avoid.push('最终图不出现任何文字、字幕、TEST FIXTURE、NOT AI或参考图水印；测试色块只用于核对附件和色调，不复制版式。');
    let ws = await api(project() + '/creative', { revision: 0, stylePresetId: 'jia.platform.distance', instructions: '独立软件验收：30秒三镜头，阴天傍晚，灰蓝长衫老人及空椅子、茶杯。这里只准备已保存输入，不调用剧本模型。本轮只允许SHOT-01生成一张图片，不迭代、不变体、不生成其他镜头。', entities: structuredClone(fixtureEntities), shots, scriptDraft: '【人工验收输入】老人留茶，收到女儿报平安消息后拉近空椅子，温暖结尾。', storyboardDraft: '【人工验收分镜】3镜头每镜10秒，SHOT-01是老人放茶的单一瞬间。', locks: [{ path: 'shot.weather', value: '阴天' }, { path: 'shot.subject', value: 'CHAR-01，老人，灰蓝长衫' }] }, 'PUT');
    ws = await api(project() + '/creative/versions', { revision: ws.revision, kind: 'script', body: ws.scriptDraft });
    await api(project() + '/creative/versions', { revision: ws.revision, kind: 'storyboard', body: ws.storyboardDraft });
    const imageWs = await imageView(), bytes = testPng(320, 180, [82, 91, 108]);
    const metadata = { revision: imageWs.revision, role: 'scene', targetId: 'SCENE-01', filename: 'SCENE-01-MANUAL-TEST-REFERENCE-NOT-AI.png', source: { kind: 'test', description: '确定性软件验收参考色块，像素标记TEST FIXTURE / NOT AI；仅检查实际附件传递，不作为场景或人物一致性验收依据。最终生成图不得复制此测试文字。' } };
    const response = await fetch(base + project() + '/images/import', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-image-metadata': encodeURIComponent(JSON.stringify(metadata)) }, body: bytes });
    assert.ok(response.ok, await response.clone().text()); let images = await response.json(); const ref = images.assets.at(-1);
    images = await api(project() + '/images/review', { revision: images.revision, assetId: ref.id, verdict: 'accepted', notes: '明确测试参考，接受仅用于软件附件与Hash核对，不代表真实场景定稿。' });
    await api(project() + '/images/select', { revision: images.revision, assetId: ref.id }); state.reference = { id: ref.id, sha256: ref.sha256, testFixture: true }; save();
  }
  if (!state.taskId) { const images = await imageView(); const prepared = await api(project() + '/images/generation-prepare', { revision: images.revision, shotId: 'SHOT-01', referenceAssetIds: [state.reference.id] }); state.taskId = prepared.id; save(); }
  state.page = `${base}/images.html?projectId=${state.projectId}`; state.preparedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ prepared: true, projectId: state.projectId, taskId: state.taskId, page: state.page, imageCalls: 0 })); process.exit(0);
}
if (!state.taskId) throw new Error('先执行--prepare-only，当前没有可观察任务。');
if (process.argv.includes('--submit-once')) {
  const before = await task();
  if (!before.submittedAt) {
    const view = await api(project() + '/images/generation'); state.beforeUsage = view.capability.accountUsage; save();
    assert.equal(view.capability.canSubmit, true, view.capability.message || JSON.stringify(view.capability.limitations));
    assert.equal(view.usageLimit.maxSubmissions, 1, '真实验收上限必须显式为1');
    fs.writeFileSync(path.join(root, 'only-submit-intent.json'), JSON.stringify({ at: new Date().toISOString(), taskId: state.taskId, maxCalls: 1, maxImages: 1 }), { flag: 'wx' });
    await api(`/api/image-generation-tasks/${state.taskId}/submit`, { confirm: true, acknowledgeUsage: true });
  }
}
if (!process.argv.includes('--submit-once') && !process.argv.includes('--observe') && !process.argv.includes('--restore')) throw new Error('使用--submit-once明确提交，或--observe/--restore只读观察。');
let job;
for (let n = 0; n < 360; n++) {
  job = await task(); if (!['submitting', 'running'].includes(job.status)) break;
  if (n % 10 === 0) console.log(`真实单图任务：${job.status} — ${job.message}`);
  await pause(2000);
}
state.lastObservedAt = new Date().toISOString(); state.job = job; save();
fs.writeFileSync(path.join(root, 'job.json'), JSON.stringify(job, null, 2));
if (job.status === 'succeeded') {
  const images = await imageView(), asset = images.assets.find(item => item.id === job.result.assetId); assert.ok(asset);
  const response = await fetch(base + asset.url); assert.ok(response.ok); const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(sha(bytes), asset.sha256);
  fs.writeFileSync(path.join(root, `real-image.${asset.extension}`), bytes);
  state.image = { id: asset.id, sha256: asset.sha256, width: asset.width, height: asset.height, format: asset.format, source: asset.source, automaticSelection: false }; save();
}
console.log(JSON.stringify({ taskId: state.taskId, status: job.status, error: job.error, image: state.image ?? null, sourceBoundToOriginalPacket: job.result?.sourceBoundToOriginalPacket }));
if (job.status !== 'succeeded' && job.status !== 'prepared') process.exitCode = 1;
