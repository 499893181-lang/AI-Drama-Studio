// Real Chrome and HTTP/UI, with explicitly isolated Codex-shaped fixtures.
// This validates software behavior, never a real model, account or media task.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createStudio } from '../src/server.mjs';
import { launchBrowser } from './cdp.mjs';
import { fixtureIdea, fixtureSubject, isolatedRunner } from './creative-fixtures.mjs';

const artifacts = path.resolve('tests/.artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(artifacts, 'creative-browser-data-'));
const browserArtifacts = path.join(artifacts, 'creative-browser');
const calls = [];
const fixtureRunner = isolatedRunner(calls);
const options = { dataDir, creativeOptions: { runner: async input => {
  // Keep one task running across the real UI polling interval, so dirty-editor protection is actually exercised.
  if (input.schema?.properties?.criteria) await new Promise(resolve => setTimeout(resolve, 3500));
  return fixtureRunner(input);
} }, inspectTools: async () => ({ checkedAt: new Date().toISOString(), tools: [] }) };
let app = createStudio(options);
const project = app.store.create({ name: '[隔离浏览器验收] 30秒三镜头双预设', idea: fixtureIdea, durationSeconds: 30 });
async function listen() { await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${app.server.address().port}`; }
let base = await listen();
const browser = await launchBrowser(browserArtifacts);
const report = { startedAt: new Date().toISOString(), isolatedFixturesOnly: true, realModelOrMediaInvoked: false, checks: [] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const q = name => `[data-testid="${name}"]`;
async function clickSelector(selector) {
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`);
  await browser.evaluate(`{let parent=document.querySelector(${JSON.stringify(selector)}).parentElement;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}}`);
  await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
const click = name => clickSelector(q(name));
async function fill(name, value, event = 'input') {
  const selector = q(name);
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`);
  await browser.evaluate(`{let parent=document.querySelector(${JSON.stringify(selector)}).parentElement;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}}`);
  await browser.evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true})); })()`);
}
async function get(route) { const res = await fetch(base + route); const value = await res.json(); if (!res.ok) throw new Error(`${res.status} ${value.error}`); return value; }
async function workspace(predicate) {
  for (let i = 0; i < 100; i++) { const value = await get(`/api/projects/${project.id}/creative`); if (predicate(value)) return value; await pause(100); }
  throw new Error('隔离创作工作区状态等待超时');
}
async function shot(name) { const result = await browser.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(browserArtifacts, name), Buffer.from(result.data, 'base64')); }
async function confirmDialog() { await click('creative-confirm-submit'); }
try {
  await browser.call('Page.navigate', { url: `${base}/creative.html?projectId=${project.id}&stage=script` });
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('creative-generate-script'))})`);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(q('creative-director'))}).options.length`), 15);
  const catalog = await get('/api/creative/knowledge');
  assert.equal(catalog.presets.length, 17);
  assert.ok(JSON.stringify(catalog).includes('anderson.budapest.order'));
  await fill('creative-instructions', '【隔离验收】30秒、3镜头。保留阴天傍晚与灰蓝长衫；只允许老人出镜。');
  const locks = [{ path: 'shot.weather', value: '阴天' }, { path: 'shot.subject', value: fixtureSubject }];
  await fill('creative-locks', JSON.stringify(locks, null, 2));
  await click('creative-save');
  await workspace(ws => ws.instructions.includes('3镜头'));
  await click('creative-generate-script');
  await confirmDialog();
  let ws = await workspace(ws => ws.tasks.some(task => task.kind === 'script' && task.status === 'succeeded'));
  const script = ws.tasks.find(task => task.kind === 'script');
  await workspace(ws => ws.reviews.some(review => review.references?.targetTaskId === script.id && review.status === 'succeeded'));
  assert.equal(calls.length, 2);
  report.checks.push('从已保存构思执行文字创作并串联一次独立检查，自动进入可编辑正文，未访问即梦报价或提前采用');
  await browser.waitFor("!!document.querySelector('[data-testid=creative-script-draft]')");
  await clickSelector('[data-studio-action=primary]'); await confirmDialog();
  ws = await workspace(ws => Boolean(ws.activeScriptId));
  assert.equal(ws.selectedScriptTaskId,null);assert.equal(ws.versions.find(version=>version.id===ws.activeScriptId).body,script.result.body);
  await browser.waitFor(`document.querySelectorAll('[data-testid="creative-shot-thumb"]').length===3`);
  await browser.waitFor(`document.querySelectorAll(${JSON.stringify(q('creative-shot'))}).length === 3`);
  await fill('creative-director', 'jia_zhangke', 'change');
  await fill('creative-preset', 'jia.platform.distance', 'change');
  await click('creative-save');
  ws = await workspace(ws => ws.stylePresetId === 'jia.platform.distance');
  const imageOne = ws.compiled[0].design.imagePrompt;
  const ruleTextOne = await browser.evaluate(`document.querySelector(${JSON.stringify(q('creative-preset-info'))}).textContent`);
  await browser.evaluate(`document.querySelector(${JSON.stringify(q('creative-preset-info'))}).closest('section').scrollIntoView({block:'start'})`);
  await shot('preset-jia.png');
  assert.equal(await browser.evaluate(`document.querySelectorAll('input[type="checkbox"][data-manual-rule]:checked').length`), 0);
  await fill('creative-director', 'wes_anderson', 'change');
  await fill('creative-preset', 'anderson.budapest.order', 'change');
  await click('creative-save');
  ws = await workspace(ws => ws.stylePresetId === 'anderson.budapest.order');
  assert.notEqual(ws.compiled[0].design.imagePrompt, imageOne);
  assert.deepEqual(ws.locks, locks);
  assert.notEqual(await browser.evaluate(`document.querySelector(${JSON.stringify(q('creative-preset-info'))}).textContent`), ruleTextOne);
  assert.equal(ws.compiled.length, 3);
  assert.ok(ws.compiled.every(row => row.design.imagePrompt.includes('灰蓝长衫') && row.design.imagePrompt.includes('阴天')));
  assert.equal(await browser.evaluate(`document.querySelectorAll(${JSON.stringify(q('shot-static'))}).length`), 3);
  assert.equal(await browser.evaluate(`document.querySelectorAll(${JSON.stringify(q('shot-motion'))}).length`), 3);
  assert.equal(await browser.evaluate(`document.querySelectorAll(${JSON.stringify(q('shot-post'))}).length`), 3);
  await browser.evaluate(`document.querySelector(${JSON.stringify(q('creative-preset-info'))}).closest('section').scrollIntoView({block:'start'})`);
  await shot('preset-anderson.png');
  await browser.evaluate(`document.querySelector(${JSON.stringify(q('creative-shot'))}).scrollIntoView({block:'start'})`);
  await shot('three-editing-zones.png');
  await browser.evaluate(`document.querySelector(${JSON.stringify(q('shot-post'))}).scrollIntoView({block:'start'})`);
  await shot('post-sound-zone.png');
  report.checks.push('真实Chrome显示15导演/17预设数据、显式手册勾选默认关闭、三镜头三区编辑；两种预设规则差异可见，人物天气保持');
  await click('creative-generate-storyboard');
  await confirmDialog();
  ws = await workspace(ws => ws.tasks.some(task => task.kind === 'storyboard' && task.status === 'succeeded'));
  const board = ws.tasks.find(task => task.kind === 'storyboard');
  await clickSelector(`[data-review-task="${board.id}"]`);
  await confirmDialog();
  await workspace(ws => ws.reviews.some(review => review.references?.targetTaskId === board.id && ['queued', 'running'].includes(review.status)));
  const unsaved = '【轮询期间未保存】这行内容必须保留。';
  await fill('creative-script-draft', unsaved);
  ws = await workspace(ws => ws.reviews.some(review => review.references?.targetTaskId === board.id && review.status === 'succeeded'));
  const review = ws.reviews.find(review => review.references?.targetTaskId === board.id);
  assert.notEqual(review.threadId, board.threadId);
  await browser.waitFor(`document.body.textContent.includes('隔离独立审阅显示夹具')`);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(q('creative-script-draft'))}).value`), unsaved);
  await fill('creative-script-draft', script.result.body);
  await click('creative-save');
  await workspace(ws => ws.scriptDraft === script.result.body);
  assert.equal(ws.versions.filter(version=>version.kind==='storyboard').length,0);
  report.checks.push('生成分镜候选与独立审阅分别保存；模型PASS未自动采用或冒充正式岗位PASS');
  await clickSelector(`[data-adopt-task="${board.id}"]`);
  await confirmDialog();
  ws = await workspace(ws => ws.versions.some(version => version.taskId === board.id));
  await browser.call('Page.navigate',{url:`${base}/creative.html?projectId=${project.id}&stage=script`});await browser.waitFor("!!document.querySelector('[data-testid=script-document]')");
  await fill('creative-script-draft', '【隔离人工稿】这份用户正文必须跨轮询和重启保留。');
  await pause(3500);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(q('creative-script-draft'))}).value`), '【隔离人工稿】这份用户正文必须跨轮询和重启保留。');
  await clickSelector('[data-studio-action=primary]');await confirmDialog();
  ws = await workspace(ws => ws.versions.some(version => version.body === '【隔离人工稿】这份用户正文必须跨轮询和重启保留。'));
  const manualId = ws.versions.find(version => version.body.startsWith('【隔离人工稿】')).id;
  assert.equal(ws.selectedScriptTaskId, null);
  await browser.waitFor("!!document.querySelector('[data-testid=creative-board-stage]')");await click('creative-generate-storyboard');
  await confirmDialog();
  ws = await workspace(ws => ws.tasks.some(task => task.kind === 'storyboard' && task.id !== board.id && task.status === 'succeeded'));
  const manualBoard = ws.tasks.find(task => task.kind === 'storyboard' && task.id !== board.id);
  assert.equal(manualBoard.inputSnapshot.parent.id, manualId);
  assert.equal(manualBoard.inputSnapshot.parent.type, 'version');
  report.checks.push('人工点击采用候选，人工修改另存不可变版本；轮询不覆盖未保存输入');
  report.checks.push('人工剧本新版本成为实际分镜来源，继续生成绑定新版本而非旧候选');
  await fill('creative-instructions', ws.instructions + '\n【新要求】茶杯必须为白色。');
  await click('creative-save');
  ws = await workspace(ws => ws.instructions.includes('白色'));
  assert.equal(ws.tasks.find(task => task.id === board.id).stale, true);
  assert.equal(ws.reviews.find(task => task.id === review.id).needsReview, true);
  await browser.waitFor(`document.body.textContent.includes('需要复核') || document.body.textContent.includes('已过期')`);
  const denied = await fetch(`${base}/api/projects/${project.id}/creative/adopt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: ws.revision, projectRevision: ws.project.revision, taskId: board.id }) });
  assert.equal(denied.status, 409);
  report.checks.push('新要求使旧分镜和审阅过期，后端拒绝旧候选采用并保留人工稿');
  await app.close();
  app = createStudio(options); base = await listen();
  await browser.call('Page.navigate', { url: `${base}/creative.html?projectId=${project.id}&stage=script` });
  await browser.waitFor("!!document.querySelector('[data-testid=script-workbench]')");await clickSelector('[data-script-tab=requirements]');await browser.waitFor(`document.querySelector('[data-testid=creative-instructions]').value.includes('白色')`);
  ws = await get(`/api/projects/${project.id}/creative`);
  assert.ok(ws.versions.some(version => version.id === manualId));
  assert.ok(ws.tasks.some(task => task.id === board.id));
  assert.equal(ws.reviews.find(task => task.id === review.id).needsReview, true);
  assert.equal(calls.length, 5);
  assert.equal(browser.messages.length, 0);
  await shot('creative-restored.png');
  report.checks.push('重启恢复原任务、原候选、人工版本及审阅过期状态；无重复调用，无未处理页面异常');
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.stack; process.exitCode = 1;
  try { await shot('creative-failure.png'); } catch {}
} finally {
  report.finishedAt = new Date().toISOString(); report.modelFixtureCalls = calls.length;
  fs.writeFileSync(path.join(browserArtifacts, 'creative-browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close(); await app.close();
}
