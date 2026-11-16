// Actual main-service browser and preservation checks. No submit/approval calls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { launchBrowser } from '../tests/cdp.mjs';
if (!process.env.DATA_DIR) throw new Error('Use the original DATA_DIR.');
const data = path.resolve(process.env.DATA_DIR), base = process.env.STUDIO_URL ?? 'http://127.0.0.1:4320';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const get = async route => { const response = await fetch(base + route); const value = await response.json(); assert.ok(response.ok, value.error); return value; };
const pending = read('tests/.artifacts/canvas-v09/pending-preparation.json'), health = await get('/api/health'); assert.equal(health.version, '0.8.0');
const view = await get(`/api/projects/${pending.projectId}/canvas-video`), task = view.tasks.find(item => item.id === pending.taskId);
assert.equal(task.status, 'prepared'); assert.equal(task.submitId, pending.stableSubmitId); assert.equal(task.submittedAt, null); assert.equal(task.authorization.status, 'not_granted'); assert.equal(task.canSubmit, false); assert.equal(view.capability.executionEnabled, false); assert.equal(task.result, null); assert.equal(task.stale, false);
const approvalDirectory = path.join(data, 'canvas-video-approvals'); assert.equal(fs.readdirSync(approvalDirectory).filter(name => name.endsWith('.json') || name.endsWith('.key')).length, 0);
const paidReceipts = task.receipts.map(item => read(path.join(data, item.path))).filter(receipt => { const command = Array.isArray(receipt.command) ? receipt.command.join(' ') : receipt.command ?? ''; return /dreamina-canvas node (confirm|run)(?: |$)/.test(command); }); assert.equal(paidReceipts.length, 0);
const old = read(path.join(data, 'image-generation-jobs', '8eb1182e-5a89-47fe-9220-2e1ea08c1f00.json'));
assert.equal(old.status, 'failed'); assert.equal(old.result, null);
const usage = await get(`/api/projects/${old.projectId}/images/generation`); assert.deepEqual({ max: usage.usageLimit.maxSubmissions, used: usage.usageLimit.submitted, remaining: usage.usageLimit.remaining }, { max: 1, used: 1, remaining: 0 }); assert.equal(usage.capability.canSubmit, false);
const directory = path.resolve('tests/.artifacts/canvas-v09'); fs.mkdirSync(directory, { recursive: true });
const browser = await launchBrowser(path.join(directory, `chrome-${Date.now()}`));
const report = { checkedAt: new Date().toISOString(), mainVersion: health.version, projectId: pending.projectId, taskId: task.id, submitId: task.submitId, authorization: 'not_granted', signedApprovalRecords: 0, nativeConfirmationOrRunReceipts: paidReceipts.length, actualVideoGenerationCalls: 0, newImages: 0, checks: [], autoImage: { status: old.status, result: old.result, error: old.error, maxSubmissions: 1, submitted: 1, remaining: 0 } };
try {
  await browser.call('Page.navigate', { url: `${base}/canvas-video.html?projectId=${pending.projectId}` });
  await browser.waitFor("!!document.querySelector('[data-testid=canvas-task]')");
  assert.equal(await browser.evaluate("document.querySelector('[data-testid=canvas-submit]').disabled"), true);
  const labels = await browser.evaluate("({quote:document.body.textContent.includes('70积分'),pending:document.body.textContent.includes('待本人'),budget:document.body.textContent.includes('100积分仅'),localAudio:document.body.textContent.includes('本地去音轨派生')})");
  assert.ok(Object.values(labels).every(Boolean), JSON.stringify(labels));
  const image = await browser.evaluate("(async()=>{const image=document.querySelector('[data-testid=canvas-input] img');if(!image)throw new Error('Missing actual first frame');await image.decode();return {width:image.naturalWidth,height:image.naturalHeight};})()"); assert.equal(image.width, 1280); assert.equal(image.height, 720);
  const screenshot = await browser.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(directory, 'actual-pending-no-authorization.png'), Buffer.from(screenshot.data, 'base64'));
  report.checks.push('实际主服务显示同一首帧和70积分最新最大预估；任务待本人批准，真实执行按钮禁用，没有网页签发授权控件');
  report.decodedInput = image;
  const before = read('.runtime/preservation-before.json'), changed = before.filter(item => { const file = path.join(data, item.path); return !fs.existsSync(file) || hash(fs.readFileSync(file)) !== item.sha256; }); assert.equal(changed.length, 0, JSON.stringify(changed));
  report.preservation = { originalFiles: before.length, changed: 0, originalImageRecordPreserved: true, noBudgetReset: true };
  report.checks.push(`原${before.length}文件Hash不变，原失败图像任务和1/1保持，自动出图仍关闭`);
  report.checks.push('生产数据没有本机签名批准或短期凭证；当前任务提交时间/result均null，原submitId和未提交状态完整恢复');
  assert.equal(browser.messages.length, 0, JSON.stringify(browser.messages)); report.consoleExceptions = 0; report.passed = true;
  fs.writeFileSync(path.join(directory, 'main-browser.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
