// Local preparation ONLY. This script has no submit/query/download invocation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { testPng } from '../tests/image-fixtures.mjs';
import { fixtureShots } from '../tests/creative-fixtures.mjs';

assert.ok(process.argv.includes('--prepare-only'), '只支持--prepare-only，不提供真实提交选项。');
const base = process.env.STUDIO_URL ?? 'http://127.0.0.1:4320'; assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const directory = path.resolve('tests/.artifacts/video-v07'); fs.mkdirSync(directory, { recursive: true });
const file = path.join(directory, 'local-preparation.json'), marker = 'VIDEO-V07-NONPERSONAL-TEST-CARD';
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { at: new Date().toISOString(), tag: marker, newImageGenerationCalls: 0, realVideoSubmissions: 0 };
const save = () => fs.writeFileSync(file, JSON.stringify(state, null, 2));
for (let attempt = 0; ; attempt++) { try { assert.ok((await fetch(base + '/api/health')).ok); break; } catch (error) { if (attempt === 49) throw error; await new Promise(resolve => setTimeout(resolve, 200)); } }
async function api(route, body, method = 'POST') {
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json(); assert.ok(response.ok, `${response.status}: ${value.error}`); return value;
}
const health = await api('/api/health'); assert.equal(health.version, '0.6.0', '必须连接最终视频工作台，不能修改旧服务。');
if (!state.projectId) {
  const matches = (await api('/api/projects')).projects.filter(project => project.idea.includes(marker)); assert.ok(matches.length < 2);
  const project = matches[0] ?? await api('/api/projects', { name: '[视频工作台验收] 色卡微动', idea: `${marker}\n独立非个人软件验收：只有明确标记TEST FIXTURE / NOT AI的蓝色测试卡，固定机位观察5秒轻微明暗变化。没有人物、真实场景或个人信息。此输入不作为正式短剧素材。`, durationSeconds: 5, aspectRatio: '16:9', style: '明确软件测试色卡；不调用模型制作图片，不伪称AI画面。' });
  state.projectId = project.id; save();
}
const projectRoute = `/api/projects/${state.projectId}`, project = await api(projectRoute); assert.ok(project.idea.includes(marker));
let creative = await api(projectRoute + '/creative');
if (!creative.activeStoryboardId) {
  assert.equal(creative.revision, 0, '已有人工编辑时不覆盖，请保留并核对。');
  const entities = [{ id: 'SCENE-01', type: 'scene', version: 'v1', description: '人工录入的纯色软件测试背景，无真实空间。', source: 'user' }, { id: 'PROP-01', type: 'prop', version: 'v1', description: '人工软件验收测试卡，实际像素含TEST FIXTURE / NOT AI标记。', source: 'user' }];
  const shot = { ...fixtureShots()[0], id: 'SHOT-01', durationSeconds: 5, subject: 'PROP-01，软件验收测试卡', action: '保持测试卡布局，色块轻微明暗变化', moment: '测试卡显示', purpose: '核对图生视频链路；不做剧情效果验收', entityRefs: entities.map(({ id, version }) => ({ id, version })), weather: '不适用：测试卡', timeOfDay: '不适用：测试卡', emotion: '中性测试', framing: '正视全幅测试卡', composition: '文字与色块位置固定', foreground: '无', midground: '测试卡', background: '蓝色背景', focus: '测试文字和色块', lighting: { source: '图形均匀底色', direction: '正面', softness: '均匀' }, materials: ['明确测试色块'], palette: '蓝底白字', avoid: ['不新增人物', '不替换测试文字', '不宣称正式剧情画面'], camera: { ...fixtureShots()[0].camera, start: '测试卡完整显示', end: '测试卡布局保持', subjectMotion: '仅色块轻微明暗变化', focusPlan: { start: '测试卡', transition: '保持', end: '测试卡' } }, postSound: '不创建配音或音效任务；提示词不作为模型原生静音的证据。' };
  creative = await api(projectRoute + '/creative', { revision: 0, entities, shots: [shot], instructions: '仅供视频工作台独立软件验收，不是正式故事，不启动任何生成。' }, 'PUT');
  creative = await api(projectRoute + '/creative/versions', { revision: creative.revision, kind: 'storyboard', body: `${marker}\n人工分镜：SHOT-01，5秒，16:9测试卡，固定机位，仅轻微明暗变化。` });
}
let images = await api(projectRoute + '/images');
const bytes = testPng(1280, 720, [40, 61, 93]), sha256 = createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(path.join(directory, 'TEST-FIXTURE-NOT-AI-input.png'), bytes);
let image = images.assets.find(asset => asset.sha256 === sha256 && asset.targetId === 'SHOT-01' && asset.source.kind === 'test');
if (!image) {
  const metadata = { revision: images.revision, role: 'shot', targetId: 'SHOT-01', filename: 'TEST-FIXTURE-NOT-AI-input.png', source: { kind: 'test', description: '确定性软件测试PNG，实际像素明确TEST FIXTURE / NOT AI，1280×720；非AI生成、非个人素材，不作为剧情视觉质量通过依据。' } };
  const response = await fetch(base + projectRoute + '/images/import', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-image-metadata': encodeURIComponent(JSON.stringify(metadata)) }, body: bytes }); assert.ok(response.ok, await response.clone().text()); images = await response.json(); image = images.assets.at(-1);
}
assert.notEqual(image.review?.verdict, 'rejected', '已有人工拒绝不能自动翻为通过。');
if (!image.review) images = await api(projectRoute + '/images/review', { revision: images.revision, assetId: image.id, verdict: 'accepted', notes: '开发软件验收输入检查：文件Hash、尺寸和TEST标记已核对，仅接受用于隔离链路与后续待确认方案；不是正式素材PASS或用户成片签收。' });
image = images.assets.find(asset => asset.id === image.id);
if (!image.selected) { assert.ok(!images.assets.some(asset => asset.role === 'shot' && asset.targetId === 'SHOT-01' && asset.selected), '保留用户已改变的选用，不自动覆盖。'); images = await api(projectRoute + '/images/select', { revision: images.revision, assetId: image.id }); }
image = images.assets.find(asset => asset.id === image.id); assert.equal(image.state, 'selected'); assert.equal(image.stale, false);
const videos = await api(projectRoute + '/videos'), target = videos.targets.find(target => target.shotId === 'SHOT-01'); assert.equal(target.ready, true);
const task = await api(projectRoute + '/videos/prepare', { revision: videos.revision, shotId: 'SHOT-01', imageAssetId: image.id, model: 'seedance2.0_vip', durationSeconds: 5, resolution: '720p', audioMode: 'provider_default', motionPrompt: '保持首帧测试卡的文字和布局；固定机位，5秒内仅蓝色色块做轻微明暗变化。不新增人物、真实场景或额外字幕。本次是软件链路验收。', creditsBudget: 100 });
assert.equal(task.status, 'prepared'); assert.equal(task.submittedAt, null); assert.equal(task.externalTaskId, null); assert.equal(task.quote.amount, null); assert.equal(task.quote.status, 'unknown');
state.projectName = project.name; state.image = { id: image.id, version: image.version, width: image.width, height: image.height, sha256: image.sha256, source: image.source, selected: true, reviewId: image.review.id, storyboardVersion: target.storyboardVersion, url: image.url }; state.task = { id: task.id, requestId: task.requestId, status: task.status, parameters: task.parameters, quote: task.quote, creditsBudget: task.creditsBudget, submittedAt: task.submittedAt, externalTaskId: task.externalTaskId, bindingHash: task.bindingHash }; state.capability = { directLoggedIn: videos.capability.auth.loggedIn, canvasLoggedIn: videos.capability.canvas.auth.loggedIn, nativeAudioDisable: videos.capability.audio.nativeDisableSupported, canSubmit: videos.capability.canSubmit, canvasImport: videos.capability.canvas.mediaImport.status }; state.page = `${base}/video.html?projectId=${state.projectId}`; state.budgetMeaning = '100积分只是待确认方案的建议硬上限，不是报价或授权；费用未知仍禁止提交。'; save();
console.log(JSON.stringify({ projectId: state.projectId, imageSha256: image.sha256, taskId: task.id, status: task.status, quote: task.quote.status, proposedBudgetCredits: task.creditsBudget, realVideoSubmissions: 0, page: state.page }));
