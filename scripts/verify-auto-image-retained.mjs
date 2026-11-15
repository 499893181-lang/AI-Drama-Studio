// Non-generating acceptance of the one already completed, unaccepted artifact.
// --manual-check edits only the explicitly named independent acceptance project.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { launchBrowser } from '../tests/cdp.mjs';

const directory = path.resolve('tests/.artifacts/auto-image-real');
const state = JSON.parse(fs.readFileSync(path.join(directory, 'receipt.json'), 'utf8'));
const base = process.env.STUDIO_URL || state.base;
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const file = path.join(directory, 'retained-browser.json');
const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const report = { ...previous, at: new Date().toISOString(), newModelOrImageCalls: 0, automaticAcceptancePassed: false, checks: [...(previous.checks ?? [])] };
const projectRoute = `/api/projects/${state.projectId}`;
for (let attempt = 0; ; attempt++) {
  try { assert.ok((await fetch(base + '/api/health')).ok); break; }
  catch (error) { if (attempt === 49) throw error; await new Promise(resolve => setTimeout(resolve, 200)); }
}
async function api(route, body, method = 'POST') {
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json(); assert.ok(response.ok, `${response.status}: ${value.error}`); return value;
}
const job = await api(`/api/image-generation-tasks/${state.taskId}`);
assert.equal(job.status, 'failed'); assert.equal(job.result, null); assert.equal(job.retainedArtifacts.length, 1);
const generation = await api(projectRoute + '/images/generation');
assert.equal(generation.usageLimit.submitted, 1); assert.equal(generation.usageLimit.remaining, 0);
assert.equal(generation.capability.canSubmit, false); assert.equal(generation.capability.actualGenerationVerified, false);
const artifactResponse = await fetch(`${base}/api/image-generation-tasks/${job.id}/artifacts/0`);
assert.ok(artifactResponse.ok); const bytes = Buffer.from(await artifactResponse.arrayBuffer());
assert.equal(createHash('sha256').update(bytes).digest('hex'), state.retainedImage.sha256);
report.checks.push('原任务仍failed/result=null，保留一张真实图；现有提交次数1/1，自动能力未声称验证成功');
const browser = await launchBrowser(path.join(directory, `retained-browser-${Date.now()}`));
const click = async selector => { await browser.waitFor(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`); await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };
const screenshot = async name => { const result = await browser.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(directory, name), Buffer.from(result.data, 'base64')); };
try {
  await browser.call('Page.navigate', { url: `${base}/images.html?projectId=${state.projectId}` });
  await browser.waitFor("!!document.querySelector('[data-testid=\"image-unverified-artifact\"]')", 45000);
  report.decoded = await browser.evaluate(`(async()=>{const response=await fetch('/api/image-generation-tasks/${job.id}/artifacts/0');if(!response.ok)throw new Error('原图不可读');const url=URL.createObjectURL(await response.blob());const image=new Image();image.src=url;await image.decode();const dimensions={width:image.naturalWidth,height:image.naturalHeight};URL.revokeObjectURL(url);return dimensions;})()`);
  assert.deepEqual(report.decoded, { width: state.retainedImage.width, height: state.retainedImage.height });
  await browser.evaluate("document.querySelector('[data-testid=\"image-unverified-artifact\"]').scrollIntoView()");
  await screenshot('real-failed-artifact.png');
  report.checks.push('真实Chrome读取原图接口、实际img.decode及Hash一致；页面明确显示未通过自动验收');
  if (process.argv.includes('--manual-check')) {
    const project = await api(projectRoute); assert.ok(project.name.startsWith('[真实单图验收]'), '禁止修改个人项目');
    let images = await api(projectRoute + '/images');
    let asset = images.assets.find(item => item.sha256 === state.retainedImage.sha256 && item.packetId === job.packetId && item.source.kind === 'other');
    if (!asset) {
      const metadata = { revision: images.revision, role: 'shot', targetId: job.shotId, packetId: job.packetId, filename: 'Codex-real-UNVERIFIED-manual-check.png', source: { kind: 'other', description: '真实Codex一次生成的原图；PreToolUse执行失败且inputImages缺失，自动验收未通过。这里只手工导入验证预览、原包绑定与拒绝检查，不是已验证自动候选或用户签收。' } };
      const response = await fetch(base + projectRoute + '/images/import', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-image-metadata': encodeURIComponent(JSON.stringify(metadata)) }, body: bytes });
      assert.ok(response.ok, await response.clone().text()); images = await response.json(); asset = images.assets.at(-1);
    }
    assert.equal(asset.generation, null); assert.equal(asset.packetId, job.packetId); assert.equal(asset.inputSnapshotHash, job.inputSnapshotHash);
    report.manualAssetId = asset.id; report.manualSourceKind = asset.source.kind;
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    await click('[data-testid="image-refresh"]');
    await browser.waitFor(`!!document.querySelector('[data-asset-id="${asset.id}"] img')&&document.querySelector('[data-asset-id="${asset.id}"] img').naturalWidth===${state.retainedImage.width}`);
    await browser.evaluate(`document.querySelector('[data-asset-id="${asset.id}"]').scrollIntoView()`);
    if (!asset.review && !asset.stale) {
      const notes = '开发验收操作（非用户签收）：画面可解码，老人/灰蓝衣/茶杯可见；缺官方附件与单次hook证据，因此拒绝作为可信自动产物，不选用。';
      await browser.evaluate(`{const field=document.querySelector('[data-review-notes="${asset.id}"]');field.value=${JSON.stringify(notes)};field.dispatchEvent(new Event('input',{bubbles:true}));}`);
      await click(`[data-review-asset="${asset.id}"][data-verdict="rejected"]`);
      await browser.waitFor(`document.querySelector('[data-asset-id="${asset.id}"]').textContent.includes('已拒绝')||document.querySelector('[data-asset-id="${asset.id}"]').textContent.includes('开发验收操作')`);
    }
    images = await api(projectRoute + '/images'); asset = images.assets.find(item => item.id === asset.id);
    assert.equal(asset.review.verdict, 'rejected'); assert.equal(asset.selected, false);
    report.checks.push('实际原图沿手工流程导入，保留原packet及inputSnapshotHash；浏览器检查明确拒绝、未选用，非用户签收');
    await screenshot('real-manual-rejected.png');
    if (!project.idea.includes('【单图验收新要求】')) await api(projectRoute, { revision: project.revision, idea: project.idea + '\n【单图验收新要求】保留原图和原始任务，仅验证输入变化使旧图需复核，不重新生成。' }, 'PUT');
    await click('[data-testid="image-refresh"]'); await browser.waitFor("!!document.querySelector('[data-testid=\"image-stale\"]')");
    images = await api(projectRoute + '/images'); asset = images.assets.find(item => item.id === asset.id);
    assert.equal(asset.stale, true); assert.equal(asset.review.verdict, 'rejected'); assert.equal(asset.sha256, state.retainedImage.sha256);
    const download = await fetch(`${base}${projectRoute}/images/packets/${job.packetId}/bundle`); assert.equal(download.status, 409);
    await screenshot('real-input-stale.png');
    report.checks.push('输入改变后手工原图和旧任务需复核，原Hash/拒绝历史保留、旧包409，没有追加生成');
  } else if (report.manualAssetId) {
    const images = await api(projectRoute + '/images'), asset = images.assets.find(item => item.id === report.manualAssetId);
    assert.ok(asset); assert.equal(asset.stale, true); assert.equal(asset.review.verdict, 'rejected'); assert.equal(asset.sha256, state.retainedImage.sha256);
    report.checks.push('重启后真实原图、手工来源声明、原绑定、拒绝记录和过期状态恢复，没有重复生成');
    await browser.evaluate("document.querySelector('[data-testid=\"image-stale\"]').scrollIntoView()");
    await screenshot('real-input-stale.png');
  }
  const after = await api(`/api/image-generation-tasks/${state.taskId}`);
  assert.equal(after.status, job.status); assert.equal(after.submittedAt, job.submittedAt); assert.equal(after.error, job.error); assert.equal(after.result, null);
  assert.equal(browser.messages.length, 0, JSON.stringify(browser.messages)); report.consoleExceptions = 0; report.browserChecksPassed = true;
  report.checks = [...new Set(report.checks)];
  fs.writeFileSync(file, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
