// Existing TEST media registration and read-only download. No generation route.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { runCanvasPreparationCommand, sanitizeCanvasReceipt, sanitizeCanvasDiagnostic, createCanvasAuditRecorder } from '../src/canvas-video.mjs';
import { buildCanvasResourceDownloadArgs, runCanvasResourceDownload, parseCanvasResourceDownload, verifyCanvasDownloadedVideo } from '../src/canvas-video-download.mjs';
import { resolveExecutable } from '../src/tools.mjs';
import { probeVideo } from '../src/video-media.mjs';
import { launchBrowser } from '../tests/cdp.mjs';

if (!process.argv.slice(2).every(arg => ['--prepare', '--download', '--browser', '--write-evidence'].includes(arg))) throw new Error('Only prepare/download/browser/write-evidence modes exist; no generation or confirmation.');
const options = new Set(process.argv.slice(2)), root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const directory = path.join(root, 'tests', '.artifacts', 'v09-download'); fs.mkdirSync(directory, { recursive: true });
const audit = createCanvasAuditRecorder(directory), stateFile = path.join(directory, 'state.json'), binary = resolveExecutable('dreamina-canvas');
const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
const id = () => 'node_' + [...randomBytes(10)].map(byte => alphabet[byte % 32]).join('');
const input = path.join(root, 'docs', 'video-v07-evidence', 'TEST-FIXTURE-NOT-AI.mp4');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const expectedHash = '7de983635b4b445d23d72d09ca41f0c30d255a14a0e3df25647ad6e2116800b3';
assert.equal(sha(fs.readFileSync(input)), expectedHash);
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { name: 'AI-Drama-Studio_v09_视频下载预检', projectId: randomUUID(), resourceId: randomUUID(), nodeId: id(), updateId: randomUUID(), importSubmitId: randomUUID(), originalSha256: expectedHash };
const persist = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
function parse(result) { for (const text of [result.stdout, result.stderr]) { try { return JSON.parse(text.trim().replace(/^\uFEFF/, '')); } catch {} } return null; }
async function call(name, args) {
  const result = await runCanvasPreparationCommand(binary, args, { timeoutMs: 45000 }), response = parse(result);
  audit.write(name, { command: ['dreamina-canvas', ...args], exitCode: result.exitCode, timedOut: result.timedOut, response, stdout: sanitizeCanvasDiagnostic(result.stdout), stderr: sanitizeCanvasDiagnostic(result.stderr) });
  if (result.exitCode !== 0 || result.timedOut || response?.ok !== true) throw new Error(`${name} failed; preserve identities and inspect ${audit.runId}. ${JSON.stringify(sanitizeCanvasReceipt(response?.error))}`);
  return response;
}
const [version, schema, auth] = await Promise.all([call('version', ['version']), call('schema', ['schema']), call('auth-status', ['auth', 'status'])]);
const resources = schema.data.subcommands.find(item => item.name === 'resource'), nodes = schema.data.subcommands.find(item => item.name === 'node');
const create = nodes.subcommands.find(item => item.name === 'create').subcommands.find(item => item.name === 'video'), upload = resources.subcommands.find(item => item.name === 'upload'), downloadSchema = resources.subcommands.find(item => item.name === 'download');
assert.equal(auth.data.loggedIn, true); assert.equal(create.summary, '创建视频节点，不触发生成'); assert.ok(create.flags.some(flag => flag.name === 'run' && flag.default === 'false' && flag.constraints.includes('only save the draft'))); assert.equal(upload.confirmation, false); assert.ok(upload.summary.includes('视频')); assert.equal(downloadSchema.reads, true); assert.equal(downloadSchema.writes, false);
const account = await call('account', ['auth', 'account']), space = await call('space', ['space', 'current']);
assert.equal(space.data.kind, 'personal'); assert.equal(account.data.teamSpaceDiscovery.hasTeamSpace, false);
persist();
if (options.has('--prepare')) {
  const canvases = []; let cursor;
  do { const list = await call('canvas-list', ['canvas', 'ls', '--limit', '100', ...(cursor ? ['--cursor', cursor] : [])]); canvases.push(...list.data.items); if (list.data.hasMore && !list.data.nextCursor) throw new Error('Incomplete list; no canvas creation.'); cursor = list.data.hasMore ? list.data.nextCursor : null; } while (cursor);
  const matches = canvases.filter(item => item.name === state.name); assert.ok(matches.length <= 1, 'Duplicate test canvas names; no automatic selection.');
  if (matches.length && matches[0].projectId !== state.projectId) { if (state.webUrl || state.attemptedAt) throw new Error('Stable canvas binding differs; stop.'); state.projectId = matches[0].projectId; persist(); }
  state.attemptedAt ??= new Date().toISOString(); persist();
  const canvas = matches[0] ?? (await call('canvas-create', ['canvas', 'create', state.name, '--project-id', state.projectId, '--non-interactive'])).data.project;
  state.webUrl = canvas.webUrl; persist(); console.log('TEST canvas:', state.webUrl);
  if (!state.uploaded) { const result = await call('upload-existing-test-video', ['resource', 'upload', '--project-id', state.projectId, '--resource-id', state.resourceId, '--file', input, '--type', 'video', '--import-kind', 'local_upload', '--name', 'TEST FIXTURE / NOT AI - Existing 5s MP4', '--non-interactive']); assert.equal(result.data.resourceId, state.resourceId); assert.equal(result.data.mediaType, 'video'); state.uploaded = true; persist(); }
  const existing = await call('node-before-import', ['node', 'show', '--project-id', state.projectId, '--node-id', state.nodeId]);
  if (!existing.data.nodes.some(item => item.result === 'FOUND' && item.node?.nodeId === state.nodeId)) await call('import-existing-test-video', ['node', 'create', 'video', '--project-id', state.projectId, '--node-id', state.nodeId, '--update-id', state.updateId, '--submit-id', state.importSubmitId, '--title', 'TEST FIXTURE / NOT AI - IMPORTED, NOT GENERATED', '--resource-id', state.resourceId, '--import-kind', 'local_upload', '--non-interactive']);
}
const [resource, show] = await Promise.all([call('resource-get', ['resource', 'get', state.resourceId, '--project-id', state.projectId]), call('node-show', ['node', 'show', '--project-id', state.projectId, '--node-id', state.nodeId])]);
assert.equal(resource.data.resourceId, state.resourceId); assert.equal(resource.data.type, 'video'); assert.equal(resource.data.status, 'success');
const imported = show.data.nodes.find(item => item.result === 'FOUND' && item.node?.nodeId === state.nodeId)?.node;
assert.equal(imported?.type, 'video'); assert.equal(imported.status, 'success'); assert.equal(imported.resources.length, 1); assert.equal(imported.resources[0].resourceId, state.resourceId);
const before = await probeVideo(input), compact = p => Object.fromEntries(['sha256', 'size', 'format', 'durationSeconds', 'width', 'height', 'audioStreams', 'videoStreams', 'videoCodec', 'pixelFormat', 'frameRate'].map(key => [key, p[key]]));
let verified;
if (options.has('--download')) {
  const outputPath = path.join(audit.runDirectory, 'TEST-FIXTURE-NOT-AI-downloaded.mp4'), args = buildCanvasResourceDownloadArgs({ projectId: state.projectId, resourceId: state.resourceId, outputPath });
  const result = await runCanvasResourceDownload(binary, args), response = parse(result);
  audit.write('download', { command: ['dreamina-canvas', ...args], exitCode: result.exitCode, timedOut: result.timedOut, response, stdout: sanitizeCanvasDiagnostic(result.stdout), stderr: sanitizeCanvasDiagnostic(result.stderr) });
  verified = await verifyCanvasDownloadedVideo(parseCanvasResourceDownload(result, { projectId: state.projectId, resourceId: state.resourceId, outputPath }));
  state.downloadPath = outputPath; state.downloadSha256 = verified.sha256; persist();
} else if (state.downloadPath) verified = { path: state.downloadPath, probe: await probeVideo(state.downloadPath), sha256: state.downloadSha256 };
assert.ok(verified, 'Use --download for first download.'); assert.equal(sha(fs.readFileSync(input)), expectedHash);
const report = { checkedAt: new Date().toISOString(), cliVersion: version.data.version, testFixture: true, actualGenerationVerified: false, realGenerationSubmissions: 0, creditConfirmations: 0, source: 'existing tracked TEST FIXTURE / NOT AI MP4; local_upload', canvas: { projectId: state.projectId, nodeId: state.nodeId, resourceId: state.resourceId, importSubmitId: state.importSubmitId, webUrl: state.webUrl }, original: compact(before), downloaded: compact(verified.probe), exactFileBytesRetained: before.sha256 === verified.probe.sha256, mediaDifferences: Object.keys(compact(before)).filter(key => compact(before)[key] !== compact(verified.probe)[key]), schemaDownloadSummary: downloadSchema.summary, conclusion: 'Actual existing TEST video resource download only; no AI generation, model admission or frame-reference result claimed.', formalStageStatus: 'not_checked' };
if (options.has('--browser')) {
  const files = { '/original.mp4': fs.readFileSync(input), '/downloaded.mp4': fs.readFileSync(verified.path) };
  const server = http.createServer((request, response) => { if (files[request.url]) { response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': files[request.url].length }); response.end(files[request.url]); } else { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end('<h1>TEST FIXTURE / NOT AI · Video resource download preflight</h1><p>Existing local test clip and official registered-resource download. Not AI generation.</p><h2>Original existing fixture</h2><video width="560" controls muted src="/original.mp4"></video><h2>Official resource download</h2><video width="560" controls muted src="/downloaded.mp4"></video>'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const browser = await launchBrowser(path.join(directory, `chrome-${Date.now()}`));
  try {
    await browser.call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` }); await browser.waitFor('document.querySelectorAll("video").length===2');
    report.browser = await browser.evaluate('(async()=>{const output=[];for(const video of document.querySelectorAll("video")){if(video.readyState<1)await new Promise((resolve,reject)=>{video.addEventListener("loadedmetadata",resolve,{once:true});video.addEventListener("error",()=>reject(new Error("MP4 failed Chrome decode")),{once:true});});await video.play();await new Promise(resolve=>setTimeout(resolve,250));video.pause();output.push({width:video.videoWidth,height:video.videoHeight,duration:video.duration,currentTime:video.currentTime,readyState:video.readyState});}return output;})()');
    for (const decoded of report.browser) { assert.equal(decoded.width, 1280); assert.equal(decoded.height, 720); assert.ok(Math.abs(decoded.duration - 5) < 0.2); assert.ok(decoded.currentTime > 0); assert.ok(decoded.readyState >= 2); }
    assert.equal(browser.messages.length, 0); report.browserConsoleExceptions = 0;
    const screenshot = await browser.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(audit.runDirectory, 'test-resource-download-playback.png'), Buffer.from(screenshot.data, 'base64'), { flag: 'wx' });
    if (options.has('--write-evidence')) { const target = path.join(root, 'docs', 'canvas-video-download-v09-evidence'); fs.mkdirSync(target, { recursive: true }); fs.copyFileSync(path.join(audit.runDirectory, 'test-resource-download-playback.png'), path.join(target, 'test-resource-download-playback.png')); }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
const record = audit.write('report', report); audit.pointer('check', record, { checkedAt: report.checkedAt });
if (options.has('--write-evidence')) {
  const target = path.join(root, 'docs', 'canvas-video-download-v09-evidence'); fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'check.json'), JSON.stringify(sanitizeCanvasReceipt(report), null, 2) + '\n');
  const downloadReceipt = verified.receipt ? sanitizeCanvasReceipt(verified.receipt) : null;
  if (downloadReceipt?.data?.path) downloadReceipt.data.path = '[local download path redacted]';
  fs.writeFileSync(path.join(target, 'receipts.json'), JSON.stringify({ scope: 'Existing TEST video registration/download, never AI generation.', localPathRedacted: true, resource: sanitizeCanvasReceipt(resource), node: sanitizeCanvasReceipt(show), download: downloadReceipt }, null, 2) + '\n');
  fs.writeFileSync(path.join(target, 'schema-excerpts.json'), JSON.stringify({ source: 'Actual dreamina-canvas 1.2.0 Schema; exact selected command fields.', upload, createVideo: { summary: create.summary, flags: create.flags.filter(flag => ['run', 'resource-id', 'import-kind', 'submit-id'].includes(flag.name)) }, download: downloadSchema }, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
