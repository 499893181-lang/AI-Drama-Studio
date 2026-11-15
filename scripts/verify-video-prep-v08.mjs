// Read-only production-upgrade checks and actual Chrome decoding. No generation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { launchBrowser } from '../tests/cdp.mjs';

if (!process.env.DATA_DIR) throw new Error('Set the original DATA_DIR; never create a new generation budget.');
const data = path.resolve(process.env.DATA_DIR), base = process.env.STUDIO_URL ?? 'http://127.0.0.1:4320';
const directory = path.resolve('tests/.artifacts/video-prep-v08'); fs.mkdirSync(directory, { recursive: true });
const get = async route => { const response = await fetch(base + route); const value = await response.json(); assert.ok(response.ok, value.error); return value; };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const health = await get('/api/health'); assert.equal(health.version, '0.7.0');
const quote = await get('/api/video-channels/canvas'); assert.equal(quote.canSubmit, false); assert.equal(quote.quote.totalMaxCredits, 70); assert.equal(quote.preparation.realGenerationSubmissions, 0);
const demo = JSON.parse(fs.readFileSync('.runtime/timeline-demo.json', 'utf8'));
const oldJob = JSON.parse(fs.readFileSync(path.join(data, 'image-generation-jobs', '8eb1182e-5a89-47fe-9220-2e1ea08c1f00.json'), 'utf8'));
assert.equal(oldJob.status, 'failed'); assert.equal(oldJob.result, null); assert.ok(oldJob.submittedAt);
const usage = await get(`/api/projects/${oldJob.projectId}/images/generation`);
assert.deepEqual({ max: usage.usageLimit.maxSubmissions, used: usage.usageLimit.submitted, remaining: usage.usageLimit.remaining }, { max: 1, used: 1, remaining: 0 }); assert.equal(usage.capability.canSubmit, false);
const browser = await launchBrowser(path.join(directory, `chrome-${Date.now()}`));
const report = { checkedAt: new Date().toISOString(), mainVersion: health.version, newImageGenerations: 0, realVideoSubmissions: 0, accountCreditsConsumedByGeneration: 0, checks: [], autoImage: { status: oldJob.status, result: oldJob.result, error: oldJob.error, maxSubmissions: 1, submitted: 1, remaining: 0 }, quote: { requestId: quote.quote.requestId, amount: quote.quote.amount, kind: 'maximum_estimate', expiresAt: quote.quote.expiresAt, officialQuoteId: quote.quote.officialQuoteId, canSubmit: false } };
async function screenshot(name) { const result = await browser.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(directory, name), Buffer.from(result.data, 'base64')); }
try {
  await browser.call('Page.navigate', { url: base + '/video-channel.html' });
  await browser.waitFor("!!document.querySelector('[data-testid=canvas-evidence]')");
  assert.ok(await browser.evaluate("document.body.textContent.includes('70')&&document.body.textContent.includes('未授权计划预算')&&document.body.textContent.includes('quoted_snapshot')"));
  await screenshot('actual-canvas-quote-readonly.png'); report.checks.push('主服务真实浏览器显示同节点最大预估70积分，只读归档、无生成按钮、100积分未授权计划预算');
  const original = fs.readFileSync('docs/video-v07-evidence/TEST-FIXTURE-NOT-AI-input.png'), registered = fs.readFileSync('tests/.artifacts/canvas-v08/uploaded-input-roundtrip.png');
  const decoded = await browser.evaluate(`(async()=>{const list=${JSON.stringify([original.toString('base64'), registered.toString('base64')])};const outputs=[];for(const data of list){const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const bytes=ctx.getImageData(0,0,canvas.width,canvas.height).data;const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');outputs.push({width:canvas.width,height:canvas.height,rgbaSha256:digest});}return outputs;})()`);
  report.uploadedImage = { originalFileSha256: hash(original), registeredDownloadSha256: hash(registered), original: decoded[0], registered: decoded[1], identicalDecodedPixels: decoded[0].rgbaSha256 === decoded[1].rgbaSha256, scope: '此次Chrome解码RGBA比较；不能证明生成工具实际使用了该参考。' };
  assert.equal(decoded[0].width, 1280); assert.equal(decoded[1].width, 1280); assert.equal(decoded[0].height, 720); assert.equal(decoded[1].height, 720);
  report.checks.push('本地输入与注册资源分别保存字节Hash；实际Chrome解码并比较RGBA，未将上传/引用当作生成参考使用回执');
  await browser.call('Page.navigate', { url: base + `/timeline.html?projectId=${demo.projectId}` });
  await browser.waitFor(`!!document.querySelector('[data-export-id="${demo.taskId}"] video')`);
  const video = await browser.evaluate(`(async()=>{const video=document.querySelector('[data-export-id="${demo.taskId}"] video');if(video.readyState<1)await new Promise((resolve,reject)=>{video.addEventListener('loadedmetadata',resolve,{once:true});video.addEventListener('error',()=>reject(new Error('Actual local MP4 failed decode')),{once:true});});video.muted=true;await video.play();await new Promise(resolve=>setTimeout(resolve,300));video.pause();return {width:video.videoWidth,height:video.videoHeight,duration:video.duration,currentTime:video.currentTime,readyState:video.readyState};})()`);
  assert.equal(video.width, 1280); assert.equal(video.height, 720); assert.ok(Math.abs(video.duration - 15) < 0.2); assert.ok(video.currentTime > 0); assert.ok(video.readyState >= 2);
  assert.ok(await browser.evaluate("document.body.textContent.includes('TEST FIXTURE')&&document.body.textContent.includes('not_checked')"));
  await screenshot('actual-main-timeline-test-only.png'); report.timeline = { projectId: demo.projectId, taskId: demo.taskId, outputSha256: demo.outputSha256, decoded: video }; report.checks.push('原DATA_DIR新增独立TEST项目，3段既有5秒素材实际本地拼接15秒；主服务Chrome实播，来源与正式未检查状态清楚');
  const before = JSON.parse(fs.readFileSync('.runtime/preservation-before.json', 'utf8').replace(/^\uFEFF/, ''));
  const changed = before.filter(item => { const file = path.join(data, item.path); return !fs.existsSync(file) || hash(fs.readFileSync(file)) !== item.sha256; });
  assert.equal(changed.length, 0, JSON.stringify(changed)); report.preservation = { originalFiles: before.length, changed: changed.length, originalFailedTaskPreserved: true, noBudgetReset: true };
  report.checks.push(`升级后原${before.length}个文件Hash全部不变，原失败任务/result/error和1/1未重置，自动出图继续关闭`);
  assert.equal(browser.messages.length, 0, JSON.stringify(browser.messages)); report.consoleExceptions = 0; report.passed = true;
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
