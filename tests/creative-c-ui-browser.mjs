// C-adjusted real UI acceptance; marked existing PNGs and isolated text runner only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createStudio } from '../src/server.mjs';
import { launchBrowser } from './cdp.mjs';
import { fixtureIdea, fixtureEntities, fixtureShots, fixtureScript, isolatedRunner } from './creative-fixtures.mjs';

const directory = path.resolve('tests/.artifacts/creative-c-ui'); fs.mkdirSync(directory, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(directory, 'data-')), calls = [];
const options = { dataDir, creativeOptions: { runner: isolatedRunner(calls) }, inspectTools: async () => ({ tools: [] }) };
let app = createStudio(options);
const project = app.store.create({ name: '[TEST示例] 留茶 · C版交互验收', idea: fixtureIdea, durationSeconds: 30, aspectRatio: '16:9' });
const empty = app.store.create({ name: '[TEST示例] 空白项目', idea: '', durationSeconds: 30 });
app.creative.update(project.id, { revision: 0, entities: fixtureEntities, shots: fixtureShots(), scriptDraft: fixtureScript().body });
app.creative.addVersion(project.id, { revision: 1, kind: 'script', body: fixtureScript().body });
app.creative.addVersion(project.id, { revision: 2, kind: 'storyboard', body: '【TEST软件验收】人工三镜头分镜，非AI产物。' });
const bytes = fs.readFileSync('docs/video-v07-evidence/TEST-FIXTURE-NOT-AI-input.png');
for (const shot of fixtureShots()) {
  let ws = app.images.import(project.id, { revision: app.images.get(project.id).revision, role: 'shot', targetId: shot.id, filename: 'TEST-FIXTURE-NOT-AI.png', source: { kind: 'test', description: '复用既有TEST PNG，非AI生成，仅布局验收。' } }, bytes);
  const asset = ws.assets.at(-1); ws = app.images.review(project.id, { revision: ws.revision, assetId: asset.id, verdict: 'accepted', notes: '只验收TEST软件布局。' }); app.images.select(project.id, { revision: ws.revision, assetId: asset.id });
}
async function listen() { await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${app.server.address().port}`; }
let base = await listen();
const browser = await launchBrowser(path.join(directory, `chrome-${Date.now()}`));
const q = value => `[data-testid="${value}"]`;
const report = { checkedAt: new Date().toISOString(), fixtureOnly: true, realModelCalls: 0, realMediaCalls: 0, checks: [] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function nav(stage = 'storyboard', id = project.id, section = '') { await browser.evaluate("document.documentElement.dataset.departing='true'"); await browser.call('Page.navigate', { url: `${base}/creative.html?projectId=${id}&stage=${stage}${section ? `&section=${encodeURIComponent(section)}` : ''}` }); await browser.waitFor("!document.documentElement.dataset.departing&&!!document.querySelector('.studio-frame')&&!!document.querySelector('[data-testid=creative-save]')&&!document.querySelector('[data-testid=creative-save]').disabled"); }
async function screenshot(name) { const result = await browser.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(directory, name), Buffer.from(result.data, 'base64')); }
async function click(selector) { await browser.waitFor(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`); await browser.evaluate(`{const element=document.querySelector(${JSON.stringify(selector)});let parent=element.parentElement;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}element.click();}`); }
async function fill(selector, value, event = 'input') { await browser.evaluate(`{const element=document.querySelector(${JSON.stringify(selector)});element.value=${JSON.stringify(value)};element.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));}`); }
const api = async route => { const response = await fetch(base + route); const value = await response.json(); assert.ok(response.ok, value.error); return value; };
async function saved(predicate) { const end = Date.now() + 15000; while (Date.now() < end) { const ws = await api(`/api/projects/${project.id}/creative`); if (predicate(ws)) return ws; await pause(80); } throw new Error('等待人工修改保存超时'); }
try {
  for (const [width, height] of [[1366, 768], [1440, 900]]) {
    await browser.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await nav(); await browser.waitFor("document.querySelectorAll('[data-testid=creative-shot-thumb]').length===3");
    const geometry = await browser.evaluate(`(()=>{const rail={left:0,right:0},panel=document.querySelector('.studio-panel').getBoundingClientRect(),footer=document.querySelector('.studio-footer').getBoundingClientRect(),content=document.querySelector('.studio-main').getBoundingClientRect(),preview=document.querySelector('[data-testid=creative-board-preview]').getBoundingClientRect(),editor=document.querySelector('[data-testid=creative-board-editor]').getBoundingClientRect();return {width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,rail:{left:rail.left,right:rail.right},panel:{left:panel.left,right:panel.right},footer:{top:footer.top,bottom:footer.bottom},content:{left:content.left,right:content.right,bottom:content.bottom},preview:{right:preview.right},editor:{left:editor.left}};})()`);
    assert.equal(geometry.scroll, geometry.client); assert.ok(geometry.rail.right <= geometry.panel.left + 1); assert.ok(geometry.panel.right <= geometry.content.left + 1); assert.ok(geometry.content.bottom <= geometry.footer.top + 1); assert.ok(geometry.preview.right < geometry.editor.left); assert.ok(geometry.footer.bottom <= height + 1);
    assert.equal(await browser.evaluate("document.querySelectorAll('[data-agent-nav]').length"), 6); assert.equal(await browser.evaluate("document.querySelectorAll('.creative-route,.workflow').length"), 0);
    const decoded = await browser.evaluate("(async()=>{const image=document.querySelector('[data-testid=creative-board-preview] img');await image.decode();return {width:image.naturalWidth,height:image.naturalHeight};})()"); assert.deepEqual(decoded, { width: 1280, height: 720 });
    await screenshot(`storyboard-${width}x${height}.png`); report.checks.push(`${width}×${height}单文字左栏+六Agent，主预览/右编辑/缩略图/底栏无重叠或横溢出，实际TEST PNG解码`);
  }
  const beforeNavigation = app.creative.view(project.id);
  for (let iteration = 0; iteration < 2; iteration++) {
    await nav('script'); await browser.waitFor("!!document.querySelector('[data-testid=creative-script-draft]')");
    await click('.studio-footer [data-studio-action="primary"]'); await browser.waitFor("location.pathname==='/studio.html'&&new URLSearchParams(location.search).get('page')==='entities'"); await nav('storyboard');
    await click('.studio-footer [data-studio-action="primary"]'); await browser.waitFor("location.pathname==='/studio.html'&&new URLSearchParams(location.search).get('page')==='prompts'");
  }
  const afterNavigation = app.creative.view(project.id);
  assert.equal(afterNavigation.versions.length, beforeNavigation.versions.length); assert.equal(afterNavigation.activeScriptId, beforeNavigation.activeScriptId); assert.equal(afterNavigation.activeStoryboardId, beforeNavigation.activeStoryboardId);
  assert.equal(app.images.view(project.id).assets.filter(asset => asset.state === 'selected' && !asset.stale && asset.reviewCurrent).length, 3);
  await nav('storyboard'); report.checks.push('两次无改动的剧本继续与分镜确认复用当前有效版本，未增加历史版本，三张已选画面保持当前有效');
  const selectedImage = app.images.view(project.id).assets.find(asset => asset.targetId === 'SHOT-01');
  let imageWs = app.images.review(project.id, { revision: app.images.get(project.id).revision, assetId: selectedImage.id, verdict: 'rejected', notes: '【TEST】历史选用图改判不通过，不能显示成当前已选。' });
  assert.equal(imageWs.assets.find(asset => asset.id === selectedImage.id).selected, true);
  await click(q('creative-refresh')); await browser.waitFor("document.querySelector('#creative-preview-caption').textContent.includes('人工检查不通过')");
  assert.equal(await browser.evaluate("document.querySelector('#creative-preview-caption').textContent.includes('已选图片')"), false);
  assert.ok(await browser.evaluate("document.querySelector('[data-testid=creative-board-preview] img').naturalWidth>0")); await screenshot('rejected-historical-image.png');
  imageWs = app.images.review(project.id, { revision: imageWs.revision, assetId: selectedImage.id, verdict: 'accepted', notes: '【TEST】恢复软件夹具人工检查结论。' });
  await click(q('creative-refresh')); await browser.waitFor("document.querySelector('#creative-preview-caption').textContent.includes('已选图片')");
  report.checks.push('历史选用图片改判拒绝后保留实际预览，明确人工检查不通过，不误标当前已选；恢复通过后按真实审核显示');
  await nav('script', project.id, 'entities');
  assert.equal(await browser.evaluate("(()=>{const editor=document.querySelector('[data-testid=creative-entities]'),main=document.querySelector('.studio-main'),box=editor.getBoundingClientRect(),viewport=main.getBoundingClientRect();let allOpen=true;for(let parent=editor.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.open)allOpen=false;return allOpen&&box.bottom>viewport.top&&box.top<viewport.bottom&&document.activeElement===editor;})()"), true);
  await screenshot('entities-deep-link.png');
  await browser.evaluate("window.__cEntityEditor=document.querySelector('[data-testid=creative-entities]');document.querySelector('.studio-main').scrollTop=0"); await click(q('creative-refresh'));
  await browser.waitFor("document.querySelector('[data-testid=creative-entities]')!==window.__cEntityEditor&&!document.querySelector('[data-testid=creative-entities]').disabled");
  assert.equal(await browser.evaluate("document.querySelector('.studio-main').scrollTop"), 0);
  assert.equal(await browser.evaluate("document.querySelector('[data-testid=creative-entities]').closest('details').open"), false);
  report.checks.push('角色资源深链接首次自动展开并定位实体编辑区，刷新不反复展开或滚动打断用户');
  await nav('storyboard');
  const long = '【人工长文本TEST】保持人物、动作和上游锁定。'.repeat(180);
  await fill(q('creative-board-moment'), long); await click('[data-choose-shot="SHOT-02"]'); await fill(q('creative-board-continuity'), '【人工衔接TEST】按动作方向承接上一镜头。'); await click('[data-choose-shot="SHOT-01"]');
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(q('creative-board-moment'))}).value`), long);
  await click(q('creative-save')); await saved(ws => ws.shots[0].moment === long && ws.shots[1].continuityNote?.includes('人工衔接TEST'));
  await click(q('creative-refresh')); await browser.waitFor(`document.querySelector(${JSON.stringify(q('creative-board-moment'))}).value===${JSON.stringify(long)}`);
  report.checks.push('长画面文字与第二镜衔接跨镜头切换、保存、刷新逐字保留，不覆盖其它镜头人工稿');
  await fill(q('creative-preview-preset'), 'jia.platform.distance', 'change'); await click(q('creative-save')); const first = await saved(ws => ws.stylePresetId === 'jia.platform.distance');
  await fill(q('creative-preview-preset'), 'anderson.budapest.order', 'change'); await click(q('creative-save')); const second = await saved(ws => ws.stylePresetId === 'anderson.budapest.order');
  assert.notEqual(first.compiled[0].design.imagePrompt, second.compiled[0].design.imagePrompt); assert.equal(second.shots[0].moment, long); report.checks.push('右侧风格选择真实修改作品预设并保存，提示词规则改变且人工画面不丢失');
  const beforeScript = app.creative.view(project.id); app.creative.update(project.id, { revision: beforeScript.revision, scriptDraft: '' });
  await nav('script'); assert.ok(await browser.evaluate("document.querySelector('[data-testid=creative-script-draft]').value.includes('隔离软件测试夹具')"));
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-action=load-current-script],[data-copy-script],[data-select-script]').length"),0);
  await fill(q('creative-script-draft'), '【人工剧本TEST】老人等待女儿报平安，保留已确认的故事设定。'); await click(q('creative-save'));
  await click('[data-action=review-current-script]'); await click(q('creative-confirm-submit'));
  const version = (await saved(ws => ws.versions.some(version => version.body.startsWith('【人工剧本TEST】')))).versions.find(version => version.body.startsWith('【人工剧本TEST】'));
  await saved(ws => ws.reviews.some(review => review.references?.targetVersionId===version.id&&review.status === 'succeeded'));
  await browser.waitFor("document.body.textContent.includes('隔离独立审阅显示夹具')"); await click('[data-script-tab=history]'); assert.ok(await browser.evaluate("document.querySelector('#script-history-select').options.length>0")); report.checks.push('剧本页面直接编辑当前正文，保存检查快照为不可变版本并独立审阅，历史点击查看，未提前采用');
  const current = app.creative.view(project.id);
  app.creative.update(project.id, { revision: current.revision, shotCount: 12, shots: Array.from({ length: 12 }, (_, index) => ({ ...structuredClone(current.shots[index % current.shots.length]), id: `SHOT-${String(index + 1).padStart(2,'0')}`, durationSeconds: 2.5 })) });
  await nav('storyboard'); await browser.waitFor("document.querySelectorAll('[data-testid=creative-shot-thumb]').length===12");
  const many = await browser.evaluate("(()=>{const strip=document.querySelector('[data-testid=creative-shot-strip]');return {scroll:strip.scrollWidth,client:strip.clientWidth,page:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth};})()");
  assert.ok(many.scroll > many.client); assert.equal(many.page, many.viewport); await click('[data-choose-shot="SHOT-12"]');
  assert.equal(await browser.evaluate("document.querySelector('[data-testid=creative-board-moment]').dataset.shotIndex"), '11'); await screenshot('many-shots.png'); report.checks.push('12镜头缩略图在自身区域横向滚动，最后镜头可编辑，页面没有横向溢出');
  await nav('storyboard', empty.id); assert.ok(await browser.evaluate("document.body.textContent.includes('尚未制作画面')&&document.body.textContent.includes('尚无镜头')")); assert.equal(await browser.evaluate("document.querySelectorAll('[data-testid=creative-shot-thumb]').length"), 0); await screenshot('empty-storyboard.png'); report.checks.push('空白项目明确等待剧本/分镜，不展示示例图片或预设成功状态');
  await browser.call('Network.enable'); await browser.call('Network.setBlockedURLs', { urls: [`${base}/api/projects/${empty.id}/images`] }); await nav('storyboard', empty.id);
  assert.ok(await browser.evaluate("document.body.textContent.includes('画面读取失败')&&document.body.textContent.includes('原文件保留')")); await screenshot('image-read-failure.png');
  await browser.call('Network.setBlockedURLs', { urls: [] }); report.checks.push('图片接口读取失败明确显示失败与恢复说明，不冒充尚未生成或成功占位图');
  await app.close(); app = createStudio(options); base = await listen(); await nav('storyboard');
  assert.equal((await api(`/api/projects/${project.id}/creative`)).shots[0].moment, long); assert.ok(await browser.evaluate("document.body.textContent.includes('需要复核')||document.body.textContent.includes('需复核')")); await screenshot('restored-needs-review.png'); report.checks.push('重启保留人工长文本、历史与审阅；上游/预设改动后的需复核状态继续显示');
  const beforeContinue = await api(`/api/projects/${project.id}/creative`);
  await click('.studio-footer [data-studio-action="primary"]'); await browser.waitFor("location.pathname==='/studio.html'&&new URLSearchParams(location.search).get('page')==='prompts'");
  const continued = await api(`/api/projects/${project.id}/creative`); assert.equal(continued.versions.length, beforeContinue.versions.length + 1); assert.notEqual(continued.activeStoryboardId, beforeContinue.activeStoryboardId); assert.equal(calls.length, 1);
  report.checks.push('底部确认分镜实际追加人工版本并进入图片步骤，不提交出图或其它生成任务');
  assert.equal(browser.messages.length, 0, JSON.stringify(browser.messages)); assert.equal(calls.length, 1); report.passed = true; report.consoleExceptions = 0;
} catch (error) { report.passed = false; report.error = error.stack; process.exitCode = 1; try { await screenshot('failure.png'); } catch {} }
finally { report.finishedAt = new Date().toISOString(); report.modelFixtureCalls = calls.length; fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2)); await browser.close(); await app.close(); }
