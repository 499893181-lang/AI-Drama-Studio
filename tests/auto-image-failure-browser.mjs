// Isolated reproduction of a real artifact whose automatic evidence is incomplete.
// It never calls Codex or an image generator.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createStudio } from '../src/server.mjs';
import { launchBrowser } from './cdp.mjs';
import { fixtureEntities, fixtureShots } from './creative-fixtures.mjs';
import { testPng } from './image-fixtures.mjs';

const directory = path.resolve('tests/.artifacts/auto-image-failure-browser'); fs.mkdirSync(directory, { recursive: true });
let calls = 0;
const app = createStudio({
  dataDir: fs.mkdtempSync(path.join(directory, 'data-')),
  inspectImageTools: async () => ({ message: '隔离显示夹具，无真实账号检测。' }),
  imageGenerationOptions: {
    inspectCapabilities: async () => ({ canSubmit: true, contractVerified: true, auth: { loggedIn: true }, message: '隔离自动验收失败场景。' }),
    runner: async input => { calls++; const output = path.join(input.cwd, 'TEST-FIXTURE-NOT-AI.png'); fs.writeFileSync(output, testPng()); return { exitCode: 0, completed: true, threadId: 'failure-fixture-thread', turnId: 'failure-fixture-turn', error: '隔离复现：真实文件存在，但单次hook和参考附加证据未通过，不能导入自动候选。', imageGeneration: { id: 'failure-fixture-item', status: 'completed', savedPath: output, inputImages: [] }, images: [{ path: output }] }; },
    decoder: async () => { throw new Error('自动验收前置失败，不能继续导入'); },
  },
});
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
const project = app.store.create({ name: '[隔离失败验收] 保留原图', idea: '明确的软件测试故事，无真实生成。' });
app.creative.update(project.id, { revision: 0, entities: structuredClone(fixtureEntities), shots: fixtureShots() });
app.creative.addVersion(project.id, { revision: 1, kind: 'storyboard', body: '人工软件测试分镜' });
const browser = await launchBrowser(path.join(directory, 'browser'));
const q = id => `[data-testid="${id}"]`;
const click = async selector => { await browser.waitFor(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`); await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };
const report = { at: new Date().toISOString(), isolatedFixtureOnly: true, realModelOrImageCalls: 0, checks: [] };
try {
  await browser.call('Page.navigate', { url: `${base}/images.html?projectId=${project.id}` });
  await click(q('image-auto-prepare')); await click(q('image-auto-submit')); await browser.waitFor("document.querySelector('#image-confirm').open"); await click(q('image-confirm-submit'));
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('image-unverified-artifact'))})`, 20000);
  const generation = await (await fetch(`${base}/api/projects/${project.id}/images/generation`)).json(), task = generation.tasks[0];
  assert.equal(task.status, 'failed'); assert.equal(task.result, null); assert.equal(generation.usageLimit.remaining, 0); assert.equal(generation.capability.actualGenerationVerified, false); assert.equal(app.images.get(project.id).assets.length, 0); assert.equal(calls, 1);
  assert.ok(await browser.evaluate("document.body.textContent.includes('隔离测试产物已保留（非真实生成），未通过自动验收')&&document.body.textContent.includes('人民币费用：未知')&&document.body.textContent.includes('积分费用：未知')"));
  report.checks.push('失败仍占原提交次数，官方完成文字及真实文件不能冒充自动候选或免费');
  const decoded = await browser.evaluate(`(async()=>{const response=await fetch('/api/image-generation-tasks/${task.id}/artifacts/0');if(!response.ok)throw new Error('保留原图读取失败');const url=URL.createObjectURL(await response.blob());const image=new Image();image.src=url;await image.decode();const result={width:image.naturalWidth,height:image.naturalHeight};URL.revokeObjectURL(url);return result;})()`);
  assert.deepEqual(decoded, { width: 320, height: 180 }); report.checks.push('只读保留原图接口返回真实可解码PNG，不将它导入为可信自动来源');
  await click(q('image-prepare'));
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('image-packet'))})`);
  assert.equal(calls, 1); report.checks.push('自动验收失败后手工任务包流程仍可使用，未重复生成');
  await browser.evaluate("document.querySelector('[data-testid=\"image-unverified-artifact\"]').scrollIntoView()");
  const screenshot = await browser.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(directory, 'unverified-artifact.png'), Buffer.from(screenshot.data, 'base64'));
  assert.equal(browser.messages.length, 0, JSON.stringify(browser.messages)); report.passed = true; report.consoleExceptions = 0; report.fixtureCalls = calls;
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); await app.close(); }
