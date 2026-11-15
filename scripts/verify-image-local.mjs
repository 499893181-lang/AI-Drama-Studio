// Explicit local software acceptance using labelled raster test fixtures, never AI generation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixtureIdea, fixtureEntities, fixtureShots } from '../tests/creative-fixtures.mjs';
import { testPng } from '../tests/image-fixtures.mjs';
import { launchBrowser } from '../tests/cdp.mjs';

const base = process.env.STUDIO_URL || 'http://127.0.0.1:4319';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('验收只连接本机工作台。');
const directory = path.resolve('tests/.artifacts/image-local'); fs.mkdirSync(directory, { recursive: true });
const receiptPath = path.join(directory, 'receipt.json');
const receipt = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : { startedAt: new Date().toISOString(), base, checks: [], testImagesOnly: true, generationSubmissions: 0 };
const save = () => fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(route, body, method = 'POST') {
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json(); if (!response.ok) throw new Error(`${response.status}: ${result.error}`); return result;
}
const projectRoute = () => `/api/projects/${receipt.projectId}`;
const view = () => api(projectRoute() + '/images');
async function importTest(role, targetId, variant, packetId) {
  const ws = await view(), pixels = testPng(320, 180, [40 + variant * 18, 50 + variant * 12, 90 + variant * 9]);
  const metadata = { revision: ws.revision, role, targetId, filename: `TEST-FIXTURE-NOT-AI-${role}-${targetId}-${variant}.png`, source: { kind: 'test', description: `TEST FIXTURE / NOT AI，明确的软件测试图片，编号${variant}，不代表AI结果。` }, ...(packetId ? { packetId } : {}) };
  const response = await fetch(base + projectRoute() + '/images/import', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-image-metadata': encodeURIComponent(JSON.stringify(metadata)) }, body: pixels });
  const result = await response.json(); if (!response.ok) throw new Error(result.error);
  const asset = result.assets.at(-1); assert.equal(asset.sha256, sha(pixels)); assert.equal(asset.width, 320); assert.equal(asset.height, 180);
  const downloaded = await fetch(base + asset.url); assert.ok(downloaded.ok); assert.equal(sha(Buffer.from(await downloaded.arrayBuffer())), asset.sha256);
  return asset;
}
async function choose(asset) {
  let ws = await view(); ws = await api(projectRoute() + '/images/review', { revision: ws.revision, assetId: asset.id, verdict: 'accepted', notes: '软件测试：核对TEST标识、文件和绑定；不是实际作品审美或AI效果验收。' });
  return api(projectRoute() + '/images/select', { revision: ws.revision, assetId: asset.id });
}
async function browserCheck(name) {
  const browser = await launchBrowser(path.join(directory, 'browser'));
  try {
    await browser.call('Page.navigate', { url: `${base}/images.html?projectId=${receipt.projectId}` });
    await browser.waitFor("document.querySelectorAll('[data-testid=\"image-target-card\"][data-target-role=\"shot\"]').length===3");
    await browser.evaluate("document.querySelector('[data-testid=\"image-target-card\"][data-target-role=\"shot\"]').scrollIntoView()");
    await browser.waitFor("Array.from(document.images).some(image=>image.naturalWidth===320)");
    const screenshot = await browser.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
    assert.equal(browser.messages.length, 0, JSON.stringify(browser.messages));
    return { realBrowser: true, consoleExceptions: 0, threeShotCards: true, decodedTestImage: true };
  } finally { await browser.close(); }
}
if (!process.argv.includes('--run-test') && !process.argv.includes('--restore')) throw new Error('使用--run-test建立独立软件验收项目，或--restore只读检查已保存记录。');
let ready = false; for (let n = 0; n < 40; n++) { try { await api('/api/health'); ready = true; break; } catch { await pause(200); } }
if (!ready) throw new Error('4319验收服务尚未就绪。');
if (process.argv.includes('--restore')) {
  const ws = await view(); assert.equal(ws.assets.length, receipt.final.assets.length); assert.equal(ws.selectionHistory.length, receipt.final.selectionHistory.length);
  for (const expected of receipt.final.assets) { const asset = ws.assets.find(item => item.id === expected.id); assert.equal(asset.sha256, expected.sha256); const response = await fetch(base + asset.url); assert.ok(response.ok); assert.equal(sha(Buffer.from(await response.arrayBuffer())), expected.sha256); }
  receipt.restoredAt = new Date().toISOString(); receipt.restore = { assets: ws.assets.length, selectionHistory: ws.selectionHistory.length, hashesMatched: true, browser: await browserCheck('restored') }; save(); console.log(JSON.stringify(receipt.restore)); process.exit(0);
}
if (receipt.projectId) throw new Error('已存在本地验收项目，保留原数据；使用--restore核对，勿盲目重复创建。');
try {
  const project = await api('/api/projects', { name: '[测试图片验收] 三镜头等一杯茶', idea: '【软件测试输入，不是正式作品】' + fixtureIdea, durationSeconds: 30, aspectRatio: '16:9' }); receipt.projectId = project.id; save();
  let creative = await api(projectRoute() + '/creative', { revision: 0, stylePresetId: 'jia.platform.distance', instructions: '【软件测试】3镜头，每镜10秒。实体和分镜为人工测试输入，不调用模型。', entities: structuredClone(fixtureEntities), shots: fixtureShots(), scriptDraft: '【人工测试剧本】老人留茶、收到平安消息、拉近空椅子，30秒三段。', storyboardDraft: '【人工软件测试分镜】仅用于图片绑定与恢复。', locks: [{ path: 'shot.weather', value: '阴天' }, { path: 'shot.subject', value: 'CHAR-01，老人，灰蓝长衫' }] }, 'PUT');
  creative = await api(projectRoute() + '/creative/versions', { revision: creative.revision, kind: 'script', body: creative.scriptDraft });
  creative = await api(projectRoute() + '/creative/versions', { revision: creative.revision, kind: 'storyboard', body: creative.storyboardDraft });
  receipt.storyboardVersionId = creative.activeStoryboardId;
  const character = await importTest('character', 'CHAR-01', 1); await choose(character);
  const scene = await importTest('scene', 'SCENE-01', 2); await choose(scene);
  receipt.packets = []; const shotAssets = [];
  for (const [index, shotId] of ['SHOT-01', 'SHOT-02', 'SHOT-03'].entries()) {
    const ws = await view(), packet = await api(projectRoute() + '/images/prepare', { revision: ws.revision, shotId, referenceAssetIds: [character.id, scene.id] });
    assert.equal(packet.references.length, 2); assert.ok(packet.references.every(ref => ref.includedInBundle === true && ref.attached === false)); assert.equal(packet.submitted, false);
    const response = await fetch(base + `${projectRoute()}/images/packets/${packet.id}/bundle`); assert.ok(response.ok);
    const zip = Buffer.from(await response.arrayBuffer()); assert.equal(zip.readUInt32LE(0), 0x04034b50); assert.ok(zip.includes(Buffer.from('prompt.txt')));
    for (const ref of [character, scene]) { const image = Buffer.from(await (await fetch(base + ref.url)).arrayBuffer()); assert.ok(zip.includes(image)); }
    fs.writeFileSync(path.join(directory, `${shotId}.zip`), zip); receipt.packets.push(packet);
    const asset = await importTest('shot', shotId, index + 3, packet.id); shotAssets.push(asset); await choose(asset);
  }
  receipt.checks.push('人物/场景参考与三镜头实际PNG导入、预览字节核对、人工检查选用通过；ZIP实际含两张参考图但未发送');
  const before = await view(), oldSecond = shotAssets[1], replacement = await importTest('shot', 'SHOT-02', 6, receipt.packets[1].id); await choose(replacement);
  const replaced = await view(); assert.equal(replaced.assets.filter(asset => asset.role === 'shot' && asset.targetId === 'SHOT-02').length, 2); assert.equal(replaced.assets.find(asset => asset.id === oldSecond.id).sha256, oldSecond.sha256);
  for (const id of [shotAssets[0].id, shotAssets[2].id]) assert.equal(replaced.assets.find(asset => asset.id === id).state, 'selected');
  receipt.beforeChange = { assetCount: replaced.assets.length, selectedShots: replaced.assets.filter(asset => asset.role === 'shot' && asset.state === 'selected').length, selectionHistory: replaced.selectionHistory.length, oldImagePreserved: true, otherShotsUnchanged: true, browser: await browserCheck('three-shots') };
  assert.equal(receipt.beforeChange.selectedShots, 3);
  receipt.checks.push('只换SHOT-02图片，旧版文件与选用记录保留，其他两镜选用不变');
  const revisedCharacter = await importTest('character', 'CHAR-01', 7); await choose(revisedCharacter);
  const changedReferences = await view(); assert.ok(changedReferences.assets.filter(asset => asset.role === 'shot').every(asset => asset.stale));
  receipt.checks.push('人物参考版本变化使依赖的镜头图片需复核，原文件保留');
  const currentProject = await api(projectRoute()); await api(projectRoute(), { revision: currentProject.revision, idea: currentProject.idea + '\n【软件测试变更】老人结尾停顿后再抬头；旧图片需要复核。' }, 'PUT');
  const final = await view(); assert.ok(final.assets.every(asset => asset.stale));
  receipt.final = { assets: final.assets.map(({id,role,targetId,targetVersion,sha256,width,height,format,source,packetId,stale}) => ({id,role,targetId,targetVersion,sha256,width,height,format,source,packetId,stale})), selectionHistory: final.selectionHistory, formalStageStatus: final.formalStageStatus, mediaStatus: final.mediaStatus };
  receipt.checks.push('上游输入改变后旧图片明确需复核，未覆盖原稿或旧图片');
  receipt.capability = await api('/api/images/capabilities'); receipt.completedAt = new Date().toISOString(); receipt.page = `${base}/images.html?projectId=${receipt.projectId}`; save();
  assert.equal(before.assets.length, 5); assert.equal(final.assets.length, 7);
  console.log(JSON.stringify({ projectId: receipt.projectId, page: receipt.page, assets: final.assets.length, checks: receipt.checks, generationSubmissions: 0 }));
} catch (error) { receipt.failure = { at: new Date().toISOString(), message: error.message }; save(); throw error; }
