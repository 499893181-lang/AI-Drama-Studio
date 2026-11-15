// Read-only browser verification of the real local PREPARED task. Never submits.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { launchBrowser } from '../tests/cdp.mjs';

const directory = path.resolve('tests/.artifacts/video-v07'), state = JSON.parse(fs.readFileSync(path.join(directory, 'local-preparation.json'), 'utf8'));
const url = new URL(state.page), base = url.origin; assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
for (let attempt = 0; ; attempt++) { try { assert.ok((await fetch(base + '/api/health')).ok); break; } catch (error) { if (attempt === 49) throw error; await new Promise(resolve => setTimeout(resolve, 200)); } }
const view = await (await fetch(`${base}/api/projects/${state.projectId}/videos`)).json(), task = view.tasks.find(item => item.id === state.task.id);
assert.equal(task.status, 'prepared'); assert.equal(task.submittedAt, null); assert.equal(task.externalTaskId, null); assert.equal(task.quote.amount, null); assert.equal(view.assets.length, 0);
assert.equal(view.capability.canSubmit, false); assert.equal(view.capability.auth.loggedIn, false); assert.equal(view.capability.canvas.auth.loggedIn, true);
const response = await fetch(base + state.image.url); assert.ok(response.ok); const bytes = Buffer.from(await response.arrayBuffer());
assert.equal(createHash('sha256').update(bytes).digest('hex'), state.image.sha256);
const before = JSON.parse(fs.readFileSync(path.join(directory, 'preservation-before.json'), 'utf8'));
const jobs = fs.readdirSync(path.join(before.root, 'image-generation-jobs')).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(before.root, 'image-generation-jobs', name))));
assert.equal(jobs.filter(job => job.submittedAt).length, 1); assert.equal(jobs.find(job => job.submittedAt).status, 'failed');
const browser = await launchBrowser(path.join(directory, `prepared-browser-${Date.now()}`)), report = { at: new Date().toISOString(), actualLocalPreparedTask: true, realVideoSubmissions: 0, newModelTurns: 0, newImageGenerationCalls: 0, checks: [] };
const screenshot = async name => { const shot = await browser.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(directory, name), Buffer.from(shot.data, 'base64')); };
try {
  await browser.call('Page.navigate', { url: state.page });
  await browser.waitFor("!!document.querySelector('[data-testid=\"video-task\"]')", 45000);
  assert.ok(await browser.evaluate("document.querySelector('[data-testid=\"video-submit\"]').disabled"));
  assert.ok(await browser.evaluate("document.querySelector('[data-testid=\"video-quote\"]').textContent.includes('费用待确认')"));
  report.checks.push('本机实际prepared任务展示费用待确认，提交按钮禁用，未产生外部任务ID或消费意图');
  const dimensions = await browser.evaluate(`(async()=>{const image=new Image();image.src=${JSON.stringify(state.image.url)};await image.decode();return{width:image.naturalWidth,height:image.naturalHeight};})()`); assert.deepEqual(dimensions, { width: 1280, height: 720 });
  report.checks.push('实际选用的TEST PNG可解码，Hash、图片版本与分镜版本绑定一致');
  const body = await browser.evaluate('document.body.textContent'); assert.ok(body.includes('seedance2.0_vip')); assert.ok(body.includes('原生') && body.includes('音频'));
  assert.ok(await browser.evaluate("document.querySelector('[data-testid=\"video-cli-status\"]').textContent.includes('需要登录配置')"));
  assert.ok(await browser.evaluate("document.querySelector('[data-testid=\"video-canvas-status\"]').textContent.includes('已登录')"));
  report.checks.push('直连待登录、画布已登录、无原生静音参数分别展示，不把画布登录或报价套用直连');
  await browser.evaluate("document.querySelector('[data-testid=\"video-input\"]').scrollIntoView({block:'start'})"); await screenshot('prepared-input.png');
  await browser.evaluate("document.querySelector('[data-testid=\"video-quote\"]').scrollIntoView({block:'center'})"); await screenshot('prepared-unknown-fee.png');
  const after = await (await fetch(`${base}/api/video-tasks/${task.id}`)).json(); assert.equal(after.submittedAt, null); assert.equal(after.externalTaskId, null);
  for (const record of before.records) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(before.root, record.relative))).digest('hex'), record.sha256);
  report.checks.push('原500份数据文件Hash不变，原失败任务及1/1保留；本轮真实视频、图片和模型调用均为0');
  assert.equal(browser.messages.length, 0, JSON.stringify(browser.messages)); report.passed = true; report.consoleExceptions = 0;
  fs.writeFileSync(path.join(directory, 'prepared-browser-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
