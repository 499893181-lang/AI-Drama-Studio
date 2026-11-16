// Real Chrome + real deterministic test MP4/FFprobe. No Dreamina submission.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createStudio } from '../src/server.mjs';
import { launchBrowser } from './cdp.mjs';
import { fixtureEntities, fixtureShots } from './creative-fixtures.mjs';
import { testPng } from './image-fixtures.mjs';
import { createTestVideo } from './video-fixtures.mjs';

const directory = path.resolve('tests/.artifacts/video-browser'); fs.mkdirSync(directory, { recursive: true });
const source = await createTestVideo(fs.mkdtempSync(path.join(directory, 'media-')), { width: 1280, height: 720, durationSeconds: 5 });
const calls = { submit: 0, query: 0, download: 0 }, submittedIds = [];
let unknown = true, queryFailure = true, downloadFailure = true;
const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const capability = {
  executionMode: 'isolated-fixture', canSubmit: true, realSubmissionEnabled: false,
  auth: { loggedIn: true }, message: 'UI隔离契约夹具，非真实账号检测。',
  defaults: { model: 'fixture-video-model', durationSeconds: 5, resolution: '720p', audioMode: 'provider_default' },
  models: [{ id: 'fixture-video-model', duration: { min: 5, max: 10, step: 1 }, resolutions: ['720p'] }],
  audio: { nativeDisableSupported: false, reason: '隔离复现已核实的限制：CLI无原生关闭音频参数，原片保留，派生不自动处理。' },
  canvas: { auth: { loggedIn: true }, mediaImport: { status: 'detected_not_verified', reason: '仅能力夹具，媒体没有导入画布；直接生成与画布同步分别记录。' } },
};
const adapter = {
  executionMode: 'isolated-fixture', inspect: async () => structuredClone(capability),
  quote: async () => unknown ? { status: 'unknown', amount: null, canSubmit: false, currency: 'CREDITS', basis: '隔离测试：本次视频费用尚无依据，余额不是报价。', sources: [] } : { status: 'known', amount: 5, currency: 'CREDITS', billingType: 'credits', canSubmit: true, channel: 'dreamina-cli-image2video', evidenceId: 'isolated-video-price', basis: '明确隔离的5积分费用夹具，不是生产价格。', sources: [{ title: '软件测试费用依据，非官方报价', url: 'https://example.invalid/test-fixture-only' }], conditions: ['仅隔离UI测试'], expiresAt },
  submit: async input => { calls.submit++; const id = `ISOLATED-VIDEO-${calls.submit}`; submittedIds.push(id); assert.ok(fs.existsSync(input.imagePath)); return { externalTaskId: id, status: 'querying', raw: { testFixture: true, requestId: input.requestId } }; },
  query: async input => { calls.query++; assert.ok(submittedIds.includes(input.externalTaskId)); if (queryFailure) { queryFailure = false; throw new Error('隔离查询网络失败，原外部任务号仍有效。'); } return { externalTaskId: input.externalTaskId, status: 'success', raw: { testFixture: true, gen_status: 'success' } }; },
  download: async input => { calls.download++; assert.ok(submittedIds.includes(input.externalTaskId)); if (downloadFailure) { downloadFailure = false; throw new Error('隔离下载失败，仅允许重试下载。'); } return { externalTaskId: input.externalTaskId, status: 'success', path: source.path, raw: { testFixture: true, bytes: source.bytes.length } }; },
};
const dataDir = fs.mkdtempSync(path.join(directory, 'data-'));
const options = { dataDir, videoOptions: { adapter }, inspectImageTools: async () => ({ message: '隔离，不调用图像工具。' }), imageGenerationOptions: { inspectCapabilities: async () => ({ canSubmit: false, message: '自动出图保持关闭。' }) } };
let app = createStudio(options);
async function listen() { await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${app.server.address().port}`; }
let base = await listen();
const project = app.store.create({ name: '[隔离视频UI验收] 单镜留茶', idea: '【软件测试输入】老人留茶，30秒故事，当前只测试一个镜头，不调用生成。' });
app.creative.update(project.id, { revision: 0, entities: structuredClone(fixtureEntities), shots: fixtureShots() });
app.creative.addVersion(project.id, { revision: 1, kind: 'storyboard', body: '【人工测试分镜】明确隔离验收。' });
let images = app.images.import(project.id, { revision: 0, role: 'shot', targetId: 'SHOT-01', filename: 'TEST-FIXTURE-NOT-AI-SHOT-01.png', source: { kind: 'test', description: '确定性软件测试PNG，像素标记TEST FIXTURE / NOT AI，不是真实生成。' } }, testPng());
const image = images.assets[0]; images = app.images.review(project.id, { revision: images.revision, assetId: image.id, verdict: 'accepted', notes: '隔离软件验收图片，仅验证版本绑定。' }); app.images.select(project.id, { revision: images.revision, assetId: image.id });
const browser = await launchBrowser(path.join(directory, `browser-${Date.now()}`));
const q = id => `[data-testid="${id}"]`;
const click = async selector => { await browser.waitFor(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`); await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };
const fill = async (selector, value) => { await browser.evaluate(`{const node=document.querySelector(${JSON.stringify(selector)});node.value=${JSON.stringify(value)};node.dispatchEvent(new Event('input',{bubbles:true}));}`); };
async function api(route, body) { const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const result = await response.json(); assert.ok(response.ok, `${response.status}: ${result.error}`); return result; }
const videoRoute = `/api/projects/${project.id}/videos`;
async function waitForState(check, timeout = 20000) { const start = Date.now(); while (Date.now() - start < timeout) { const view = await api(videoRoute); if (check(view)) return view; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('等待视频状态超时'); }
async function screenshot(name) { const result = await browser.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(directory, name), Buffer.from(result.data, 'base64')); }
const report = { at: new Date().toISOString(), isolatedFixturesOnly: true, newModelTurns: 0, realDreaminaSubmissions: 0, realImageGenerationCalls: 0, testVideo: { sha256: source.sha256, width: source.probe.width, height: source.probe.height, durationSeconds: source.probe.durationSeconds, audioStreams: source.probe.audioStreams }, checks: [] };
try {
  await browser.call('Page.navigate', { url: `${base}/video.html?projectId=${project.id}` });
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('video-input'))})`);
  assert.ok(await browser.evaluate("document.body.textContent.includes('本轮关闭')&&document.body.textContent.includes('TEST FIXTURE / NOT AI')&&document.body.textContent.includes('CLI无原生关闭音频参数')"));
  await fill(q('video-creditsBudget'), '20'); await click(q('video-prepare'));
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('video-quote'))})`);
  assert.ok(await browser.evaluate("document.querySelector('[data-testid=\"video-quote\"]').textContent.includes('费用待确认')&&document.querySelector('[data-testid=\"video-submit\"]').disabled"));
  assert.equal(calls.submit, 0);
  await screenshot('fixture-unknown-fee.png');
  report.checks.push('当前人工选用的TEST图片显示实际Hash/版本；CLI与画布分开，未知视频报价禁提交，不把余额或文字报价当视频价格');
  unknown = false; await click(q('video-prepare'));
  await browser.waitFor(`!document.querySelector(${JSON.stringify(q('video-submit'))}).disabled`);
  let view = await api(videoRoute), task = view.tasks.find(item => item.quote.status === 'known');
  assert.ok(task); const taskId = task.id;
  await click(q('video-prepare')); view = await api(videoRoute); assert.equal(view.tasks.filter(item => item.quote.status === 'known').length, 1);
  await click(q('video-submit')); await click(q('video-confirm-submit'));
  view = await waitForState(value => value.tasks.find(item => item.id === taskId)?.externalTaskId); task = view.tasks.find(item => item.id === taskId);
  assert.equal(task.externalTaskId, 'ISOLATED-VIDEO-1'); assert.equal(calls.submit, 1);
  await api(`/api/video-tasks/${taskId}/submit`, { confirm: true, quoteFingerprint: task.quoteFingerprint }); assert.equal(calls.submit, 1);
  report.checks.push('有明确隔离费用依据后人工确认；重复准备和重复提交复用同一任务，仅1次fixture提交、0真实提交');
  await click(q('video-query'));
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('video-query-error'))})`); assert.equal(calls.submit, 1);
  await click(q('video-query')); await waitForState(value => value.tasks.find(item => item.id === taskId)?.status === 'download_ready');
  await click(q('video-download'));
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('video-download-error'))})`); assert.equal(calls.submit, 1);
  await click(q('video-download')); view = await waitForState(value => value.assets.length === 1);
  let candidate = view.assets[0]; assert.equal(candidate.testFixture, true); assert.equal(candidate.state, 'pending_check'); assert.equal(candidate.probe.audioStreams, 0);
  await browser.waitFor(`!!document.querySelector('[data-asset-id="${candidate.id}"] video')`);
  const decoded = await browser.evaluate(`(async()=>{const video=document.querySelector('[data-asset-id="${candidate.id}"] video');if(video.readyState<1)await new Promise((resolve,reject)=>{video.addEventListener('loadedmetadata',resolve,{once:true});video.addEventListener('error',()=>reject(new Error('Chrome视频解码失败')),{once:true});});video.muted=true;await video.play();video.pause();return {width:video.videoWidth,height:video.videoHeight,duration:video.duration,readyState:video.readyState};})()`);
  assert.equal(decoded.width, 1280); assert.equal(decoded.height, 720); assert.ok(Math.abs(decoded.duration - 5) < 0.15); assert.ok(decoded.readyState >= 2);
  assert.deepEqual(calls, { submit: 1, query: 2, download: 2 });
  report.checks.push('查询失败继续原ID；下载失败只重试原下载；FFprobe实测后才导入候选，真实Chrome加载并播放测试MP4，未自动检查或选用');
  await browser.evaluate(`document.querySelector('[data-asset-id="${candidate.id}"]').scrollIntoView()`);
  await fill(`[data-video-review="${candidate.id}"]`, '【软件验收】测试视频非即梦生成；实际播放、时长尺寸及无音轨已核对。');
  await click(`[data-review="${candidate.id}"][data-verdict="accepted"]`);
  await click(`[data-select="${candidate.id}"]`); await click(q('video-confirm-submit'));
  view = await waitForState(value => value.assets.find(item => item.id === candidate.id)?.state === 'selected'); assert.equal(view.selectionHistory.length, 1);
  await screenshot('fixture-candidate-selected.png');
  report.checks.push('候选、人工检查和显式选用分别保存；测试来源醒目标识，费用未知不显示免费');
  await click(q('video-redo')); await click(q('video-confirm-submit'));
  view = await waitForState(value => value.tasks.some(item => item.redoOfTaskId === taskId)); const redo = view.tasks.find(item => item.redoOfTaskId === taskId); assert.ok(redo); assert.notEqual(redo.id, taskId); assert.equal(view.assets.length, 1);
  await click(q('video-submit')); await click(q('video-confirm-submit')); await click(q('video-query')); await click(q('video-download'));
  view = await waitForState(value => value.assets.length === 2); const second = view.assets.find(item => item.id !== candidate.id); assert.equal(view.selectionHistory.length, 1); assert.equal(view.assets.find(item => item.id === candidate.id).state, 'selected');
  assert.equal(calls.submit, 2); assert.equal((await fetch(base + candidate.url)).status, 200);
  report.checks.push('显式单镜重做另存任务和第二个视频版本；旧片可读取、旧选用记录保留，新候选不自动替换');
  await fill(q('video-creditsBudget'), '23');
  await browser.evaluate("for(const asset of document.querySelectorAll('[data-asset-id]'))asset.scrollIntoView=function(){window.lastScrolledAsset=this.dataset.assetId;}");
  await click(`[data-view-task="${taskId}"]`); await click('[data-studio-action="primary"]');
  assert.equal(await browser.evaluate('window.lastScrolledAsset'), candidate.id);
  assert.equal(await browser.evaluate("document.querySelector('[data-testid=video-creditsBudget]').value"), '23');
  await click(`[data-view-task="${redo.id}"]`); await click('[data-studio-action="primary"]');
  assert.equal(await browser.evaluate('window.lastScrolledAsset'), second.id);
  assert.equal(await browser.evaluate("document.querySelector('[data-testid=video-creditsBudget]').value"), '23');
  assert.equal(calls.submit, 2);
  report.checks.push('历史任务切换同步底部主要操作到当前候选，保留未保存参数和原表单DOM；点击底栏不操作旧任务或重复提交');
  images = app.images.view(project.id); app.images.review(project.id, { revision: images.revision, assetId: image.id, verdict: 'rejected', notes: '隔离复现：撤销上游图片审核。' });
  await click(q('video-refresh')); await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('video-stale'))})`);
  view = await api(videoRoute); assert.equal(view.assets.length, 2); assert.ok(view.assets.every(item => item.stale)); assert.equal(calls.submit, 2);
  report.checks.push('上游选用图片改判拒绝后两个旧视频及任务需复核；保留文件与历史，不重新生成');
  await app.close(); app = createStudio(options); base = await listen();
  await browser.call('Page.navigate', { url: `${base}/video.html?projectId=${project.id}` }); await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('video-stale'))})`);
  view = await api(videoRoute); assert.equal(view.assets.length, 2); assert.equal(view.selectionHistory.length, 1); assert.equal(view.tasks.find(item => item.id === taskId).externalTaskId, 'ISOLATED-VIDEO-1'); assert.equal(calls.submit, 2);
  await screenshot('fixture-restored-stale.png');
  assert.equal(browser.messages.length, 0, JSON.stringify(browser.messages)); report.checks.push('服务重启恢复原任务号、真实测试文件、人工选用历史和过期状态；0自动重提、0未处理页面异常');
  report.passed = true; report.consoleExceptions = 0; report.fixtureCalls = calls; report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); await app.close(); }
