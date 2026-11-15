// Read-only browser acceptance against the original v06 DATA_DIR.
// No task preparation, submit, retry, upload, review or model calls are made.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { launchBrowser } from '../tests/cdp.mjs';

const data = path.resolve(process.env.DATA_DIR ?? '../AI-Drama-Studio-auto-image-v06/data/auto-image-acceptance');
const taskId = process.env.IMAGE_TASK_ID ?? '8eb1182e-5a89-47fe-9220-2e1ea08c1f00';
const base = process.env.STUDIO_URL ?? 'http://127.0.0.1:4320';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/); assert.match(taskId, /^[a-zA-Z0-9-]{1,80}$/);
const file = path.join(data, 'image-generation-jobs', `${taskId}.json`), original = fs.readFileSync(file), job = JSON.parse(original);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = path.resolve('tests/.artifacts/contract-v061/browser'); fs.mkdirSync(directory, { recursive: true });
for (let n = 0; ; n++) { try { assert.ok((await fetch(base + '/api/health')).ok); break; } catch (error) { if (n === 49) throw error; await new Promise(resolve => setTimeout(resolve, 200)); } }
const view = await (await fetch(`${base}/api/projects/${job.projectId}/images/generation`)).json();
const current = view.tasks.find(item => item.id === taskId), diagnostic = current.diagnostic;
assert.equal(current.status, 'failed'); assert.equal(current.error, job.error); assert.equal(current.result, null);
assert.equal(view.usageLimit.maxSubmissions, 1); assert.equal(view.usageLimit.submitted, 1); assert.equal(view.usageLimit.remaining, 0);
assert.equal(view.capability.canSubmit, false); assert.equal(diagnostic.current, true);
assert.equal(diagnostic.evidence.artifact.status, 'produced'); assert.equal(diagnostic.evidence.protection.strictSingleCallGuaranteed, false);
assert.equal(diagnostic.evidence.references.status, 'unverified'); assert.equal(diagnostic.evidence.acceptance.status, 'incomplete');
for (const key of ['applicationSubmissions', 'modelTurnRequests', 'imageToolStarts', 'imageToolCompletions']) assert.equal(diagnostic.counts[key], 1);
const browser = await launchBrowser(path.join(directory, `profile-${Date.now()}`));
const report = { at: new Date().toISOString(), taskId, newApplicationSubmissions: 0, newModelTurns: 0, newImageGenerations: 0, originalCounts: diagnostic.counts, checks: [] };
const shot = async name => { const value = await browser.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(directory, name), Buffer.from(value.data, 'base64')); };
try {
  await browser.call('Page.navigate', { url: `${base}/images.html?projectId=${job.projectId}` });
  await browser.waitFor("!!document.querySelector('[data-testid=\"image-diagnostic-artifact\"]')", 45000);
  for (const [key, title] of [['artifact','真实图片已产出'], ['protection','执行保护未验证'], ['references','参考使用未验证'], ['acceptance','候选未通过完整验收']]) assert.ok(await browser.evaluate(`document.querySelector('[data-testid="image-diagnostic-${key}"]').textContent.includes(${JSON.stringify(title)})`), title);
  report.checks.push('同页分别显示真实图片已产出、执行保护未验证、参考使用未验证、候选未通过完整验收');
  await browser.evaluate("document.querySelector('[data-testid=\"image-diagnostic-artifact\"]').scrollIntoView({block:'center'})"); await shot('real-four-states.png');
  for (const key of ['application', 'turn', 'image-start', 'image-complete']) assert.ok(await browser.evaluate(`document.querySelector('[data-testid="image-count-${key}"]').textContent.includes('1')`));
  report.checks.push('应用提交1次、模型turn请求1次、图像开始/完成各1次分别展示；原1/1仍占用');
  assert.equal(diagnostic.attachments.sessionSent.status, 'observed'); assert.equal(diagnostic.attachments.sessionReceived.status, 'observed');
  assert.equal(diagnostic.attachments.toolArguments.status, 'unverified'); assert.equal(diagnostic.attachments.toolReadReceipt.status, 'not_returned');
  assert.equal(diagnostic.attachments.toolReadReceipt.value, null); assert.equal(diagnostic.attachments.serverReceipt.status, 'not_returned');
  assert.equal(diagnostic.attachments.visualCheck.status, 'unverified');
  await browser.evaluate("document.querySelector('[data-testid=\"image-attachment-toolReadReceipt\"]').scrollIntoView({block:'center'})"); await shot('real-attachment-layers.png');
  report.checks.push('真实会话发送与接收已观测；工具参数、本地读取回执、服务端使用和视觉符合程度未验证，不补造inputImages');
  const dimensions = await browser.evaluate(`(async()=>{const response=await fetch('/api/image-generation-tasks/${taskId}/artifacts/0');if(!response.ok)throw new Error('原图读取失败');const url=URL.createObjectURL(await response.blob());const image=new Image();image.src=url;await image.decode();const result={width:image.naturalWidth,height:image.naturalHeight};URL.revokeObjectURL(url);return result;})()`);
  assert.deepEqual(dimensions, { width: diagnostic.evidence.artifact.width, height: diagnostic.evidence.artifact.height });
  report.checks.push('原有真实PNG仍可由浏览器解码，图片证据与执行保护、参考使用独立');
  assert.deepEqual(fs.readFileSync(file), original); assert.equal(browser.messages.length, 0, JSON.stringify(browser.messages));
  report.originalJobSha256 = hash(original); report.passed = true; report.consoleExceptions = 0;
  report.checks.push('只读页面和诊断不改原任务字节、错误、回执或原1/1记录；无页面异常');
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
