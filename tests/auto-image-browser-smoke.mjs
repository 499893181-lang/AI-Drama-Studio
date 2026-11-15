// Real Chromium UI and pixel decoding, isolated generator only. No real model/media call.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createStudio } from '../src/server.mjs';
import { launchBrowser } from './cdp.mjs';
import { fixtureEntities, fixtureShots } from './creative-fixtures.mjs';
import { testPng } from './image-fixtures.mjs';

const artifacts = path.resolve('tests/.artifacts/auto-image-browser'); fs.mkdirSync(artifacts, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(artifacts, 'data-'));
let calls = 0;
const options = {
  dataDir,
  inspectImageTools: async () => ({ checkedAt: new Date().toISOString(), message: '隔离官方能力显示夹具，不是账号状态证明。' }),
  imageGenerationOptions: {
    maxSubmissions: 1,
    inspectCapabilities: async () => ({ canSubmit: true, contractVerified: true, auth: { loggedIn: true }, accountUsage: { source: 'explicit-isolated-fixture', usedPercent: null }, message: '隔离官方契约显示夹具；本测试不调用模型。' }),
    runner: async input => {
      calls++; input.onEvent?.({ type: 'thread.started', threadId: 'isolated-browser-image-thread', turnId: 'isolated-browser-image-turn', message: '明确隔离生成夹具，非真实AI任务。' });
      const filename = path.join(input.cwd, 'TEST-FIXTURE-NOT-AI.png'); fs.writeFileSync(filename, testPng());
      return { exitCode: 0, completed: true, threadId: 'isolated-browser-image-thread', turnId: 'isolated-browser-image-turn', imageGeneration: { id: 'isolated-image-item', generationId: null, status: 'completed', savedPath: filename, inputImages: input.references.map(ref => ({ path: ref.path, sha256: ref.sha256 })) }, images: [{ path: filename }], usage: { source: 'isolated-fixture', input_tokens: 0, output_tokens: 0 }, accountUsage: { source: 'isolated-fixture', remaining: null } };
    },
  },
};
let app = createStudio(options);
async function listen() { await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${app.server.address().port}`; }
let base = await listen();
const project = app.store.create({ name: '[隔离自动图片验收] 三镜留茶', idea: '【软件测试输入】阴天傍晚，灰蓝长衫老人留茶，温暖结尾。' });
app.creative.update(project.id, { revision: 0, entities: structuredClone(fixtureEntities), shots: fixtureShots(), stylePresetId: 'jia.platform.distance' });
app.creative.addVersion(project.id, { revision: 1, kind: 'storyboard', body: '【人工软件测试分镜】' });
let ws = app.images.import(project.id, { revision: 0, role: 'character', targetId: 'CHAR-01', filename: 'TEST-FIXTURE-reference.png', source: { kind: 'test', description: '像素TEST FIXTURE / NOT AI，隔离参考。' } }, testPng());
const reference = ws.assets[0]; ws = app.images.review(project.id, { revision: ws.revision, assetId: reference.id, verdict: 'accepted', notes: '隔离参考检查。' }); app.images.select(project.id, { revision: ws.revision, assetId: reference.id });
const browser = await launchBrowser(path.join(artifacts, 'browser'));
const q = value => `[data-testid="${value}"]`;
const report = { startedAt: new Date().toISOString(), isolatedGeneratorOnly: true, realModelOrImageGenerationCalls: 0, productionPixelDecoder: true, checks: [] };
async function api(route, body, method = 'POST') { const response = await fetch(base + route, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const result = await response.json(); if (!response.ok) throw new Error(`${response.status}: ${result.error}`); return result; }
const imageRoute = `/api/projects/${project.id}/images`;
async function click(selector) { await browser.waitFor(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`); await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function fill(selector, value) { await browser.evaluate(`{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));}`); }
async function wait(predicate, timeout = 30000) { const start = Date.now(); while (Date.now() - start < timeout) { const value = await api(imageRoute); const generation = await api(imageRoute + '/generation'); if (predicate(value, generation)) return { value, generation }; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('自动图片浏览器验收等待超时'); }
async function shot(name) { const picture = await browser.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(artifacts, name), Buffer.from(picture.data, 'base64')); }
try {
  await browser.call('Page.navigate', { url: `${base}/images.html?projectId=${project.id}` });
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('image-auto-prepare'))})`);
  await click(q('image-auto-prepare'));
  const prepared = await wait((_images, generation) => generation.tasks.some(job => job.status === 'prepared'));
  const job = prepared.generation.tasks[0]; assert.equal(calls, 0); assert.equal(job.plannedReferences.length, 1);
  await browser.waitFor(`document.body.textContent.includes('人民币费用：未知') && document.body.textContent.includes('积分费用：未知')`);
  report.checks.push('真实Chrome预览当前镜头提示词、实际参考Hash和账号用量说明；准备不调用生成，不把未知费用显示免费');
  await click(q('image-auto-submit'));
  await browser.waitFor("document.querySelector('#image-confirm').open");
  assert.ok(await browser.evaluate("document.querySelector('#image-confirm').textContent.includes('现有Codex账号额度')"));
  await click(q('image-confirm-submit'));
  const completed = await wait((_images, generation) => generation.tasks.some(task => task.id === job.id && ['succeeded','failed'].includes(task.status)), 60000);
  const task = completed.generation.tasks.find(task => task.id === job.id); assert.equal(task.status, 'succeeded', task.error); assert.equal(calls, 1); assert.equal(task.attachments[0].attached, true);
  const candidate = completed.value.assets.find(asset => asset.generation?.taskId === job.id); assert.ok(candidate); assert.equal(candidate.source.kind, 'test'); assert.equal(candidate.state, 'pending_check'); assert.equal(completed.value.selectionHistory.length, 1);
  assert.equal(task.result.decoded.decoder, 'isolated-local-chromium-img.decode'); assert.equal(completed.generation.capability.actualGenerationVerified, false);
  report.checks.push('一次隔离runner返回真实PNG文件；生产Chrome解码器核对像素后自动导入新候选，保存回执与输入附件，不自动选用');
  await api(`/api/image-generation-tasks/${job.id}/submit`, { confirm: true, acknowledgeUsage: true }); assert.equal(calls, 1);
  await browser.waitFor(`!!document.querySelector('[data-asset-id="${candidate.id}"]')`);
  await browser.evaluate(`document.querySelector('[data-asset-id="${candidate.id}"]').scrollIntoView()`);
  await browser.waitFor(`document.querySelector('[data-asset-id="${candidate.id}"] img').naturalWidth===320`);
  await fill(`[data-review-notes="${candidate.id}"]`, '【软件测试】实际解码、绑定与TEST标记核对，非AI效果验收。');
  await click(`[data-review-asset="${candidate.id}"][data-verdict="accepted"]`);
  await wait(value => value.assets.find(asset => asset.id === candidate.id)?.review?.verdict === 'accepted');
  await click(`[data-select-asset="${candidate.id}"]`); await browser.waitFor("document.querySelector('#image-confirm').open"); await click(q('image-confirm-submit'));
  await wait(value => value.assets.find(asset => asset.id === candidate.id)?.state === 'selected');
  await browser.waitFor(`!document.querySelector('#image-confirm').open`);
  report.checks.push('浏览器实际预览、人工填写检查依据并明确选用；重复submit复用原任务，fixture调用仍一次');
  await shot('candidate-selected.png');
  const source = app.store.read('projects', project.id); app.store.update(project.id, { revision: source.revision, idea: source.idea + '\n【新要求】旧图需复核。' });
  await click(q('image-refresh'));
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('image-stale'))})`);
  const changed = await wait(value => value.assets.find(asset => asset.id === candidate.id)?.stale === true); assert.equal(changed.value.assets.length, 2); assert.equal(calls, 1);
  report.checks.push('上游输入改变后原候选与任务需复核，原参考及图片Hash不变，不自动重新生成');
  await app.close(); app = createStudio(options); base = await listen();
  await browser.call('Page.navigate', { url: `${base}/images.html?projectId=${project.id}` });
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('image-auto-panel'))})`);
  const restored = await api(imageRoute + '/generation'); assert.equal(restored.tasks[0].id, job.id); assert.equal(restored.tasks[0].status, 'succeeded'); assert.equal(restored.usageLimit.remaining, 0); assert.equal(calls, 1);
  const after = await api(imageRoute); assert.equal(after.assets.find(asset => asset.id === candidate.id).sha256, candidate.sha256); assert.equal(after.selectionHistory.length, 2);
  await shot('restored-stale.png');
  report.checks.push('重启恢复原任务、实际图片、检查和选择历史，提交次数不重置，未发第二次调用');
  assert.equal(browser.messages.length, 0, JSON.stringify(browser.messages));
  report.consoleExceptions = 0; report.fixtureCalls = calls; report.passed = true; report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); await app.close(); }
