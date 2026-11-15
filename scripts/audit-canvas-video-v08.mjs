import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createCanvasVideoPreparationAdapter, runCanvasPreparationCommand, sanitizeCanvasReceipt, sanitizeCanvasDiagnostic, createCanvasAuditRecorder, validateCanvasVideoPlan, buildCanvasVideoDraftArgs, verifyCanvasVideoReadback, parseCanvasVideoQuote } from '../src/canvas-video.mjs';
import { resolveExecutable } from '../src/tools.mjs';

// Intentionally no generation mode: --run/confirm/ceiling/token/yes are never accepted.
const allowedOptions = new Set(['--prepare', '--refresh-quote', '--write-evidence']);
if (process.argv.slice(2).some(arg => !allowedOptions.has(arg))) throw new Error('Only --prepare, --refresh-quote and --write-evidence are supported; generation and authorization are disabled.');
const options = new Set(process.argv.slice(2));
const repository = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const directory = path.join(repository, 'tests', '.artifacts', 'canvas-v08');
fs.mkdirSync(directory, { recursive: true });
const audit = createCanvasAuditRecorder(directory);
const stateFile = path.join(directory, 'state.json');
const input = path.join(repository, 'docs', 'video-v07-evidence', 'TEST-FIXTURE-NOT-AI-input.png');
const expectedSha256 = '0a016af311df50b5b82ead4dc39292d03e8ed5eef738eac3197336de3c6b53ba';
const fileHash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const binary = resolveExecutable('dreamina-canvas');
const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
const newNodeId = () => 'node_' + [...randomBytes(10)].map(byte => alphabet[byte % 32]).join('');
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { name: 'AI-Drama-Studio_v08_单镜5s验收', projectId: randomUUID(), uploadedResourceId: randomUUID(), imageNodeId: newNodeId(), imageUpdateId: randomUUID(), imageImportSubmitId: randomUUID(), videoNodeId: newNodeId(), videoUpdateId: randomUUID() };
const persist = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
async function call(name, args) {
  const result = await runCanvasPreparationCommand(binary, args, { timeoutMs: 45000 });
  let parsed;
  for (const text of [result.stdout, result.stderr]) { try { parsed = JSON.parse(text.trim()); break; } catch { /* Fail closed. */ } }
  audit.write(name, { command: ['dreamina-canvas', ...args], exitCode: result.exitCode, timedOut: result.timedOut, response: sanitizeCanvasReceipt(parsed), stdout: sanitizeCanvasDiagnostic(result.stdout), stderr: sanitizeCanvasDiagnostic(result.stderr) });
  if (result.exitCode !== 0 || result.timedOut || parsed?.ok !== true) throw new Error(`${name}: ${JSON.stringify(sanitizeCanvasReceipt(parsed?.error ?? { reason: 'No valid official JSON response' }))}; preserve original identities and inspect before recovery.`);
  return { result, response: parsed };
}

const inspection = await createCanvasVideoPreparationAdapter({ run: async (executable, args, limits) => {
  const result = await runCanvasPreparationCommand(executable, args, limits);
  audit.write('inspect-command', { command: ['dreamina-canvas', ...args], exitCode: result.exitCode, timedOut: result.timedOut, stdout: sanitizeCanvasDiagnostic(result.stdout), stderr: sanitizeCanvasDiagnostic(result.stderr) });
  return result;
} }).inspect();
const inspectionRecord = audit.write('inspection', inspection);
audit.pointer('inspection', inspectionRecord, { checkedAt: inspection.checkedAt });
audit.pointer('latest', inspectionRecord, { checkedAt: inspection.checkedAt, stage: 'inspection' });
console.log(JSON.stringify({ channel: inspection.channel, version: inspection.version, loggedIn: inspection.auth.loggedIn, space: inspection.space, contractDetected: inspection.contractDetected, canSubmit: false }));
if (!options.has('--prepare') && !options.has('--refresh-quote')) process.exit(0);
if (!inspection.contractDetected || !inspection.auth.loggedIn || inspection.space.kind !== 'personal' || inspection.space.hasTeamSpace !== false) throw new Error('Verified save-only schema, current login and unambiguous personal space are required. No context is switched.');
if (fileHash(input) !== expectedSha256) throw new Error('Existing labeled input fixture changed. No upload/save requested.');
state.sourceSha256 = expectedSha256;
state.model = state.model ?? 'seedance_2.0_vip';
state.prompt = state.prompt ?? '保持首帧测试卡的文字和布局；固定机位，5秒内仅蓝色色块做轻微明暗变化。不新增人物、真实场景或额外字幕。本次是软件链路验收。';
state.params = state.params ?? { mode: 'first_last_frame', model: state.model, ratio: '16:9', resolution: '720p', durationSeconds: 5, outputCount: 1 };
state.params.audioMode = 'mute_derivative';
persist(); // Stable identities precede every possible remote save.

if (options.has('--prepare')) {
  const canvases = [];
  let cursor;
  do { const response = (await call('canvas-list', ['canvas', 'ls', '--limit', '100', ...(cursor ? ['--cursor', cursor] : [])])).response; canvases.push(...response.data.items); if (response.data.hasMore && !response.data.nextCursor) throw new Error('Incomplete canvas directory; do not create duplicates.'); cursor = response.data.hasMore ? response.data.nextCursor : null; } while (cursor);
  const sameName = canvases.filter(item => item.name === state.name);
  if (sameName.length > 1) throw new Error('Duplicate test canvas names; select explicitly before continuing.');
  if (sameName.length === 1 && sameName[0].projectId !== state.projectId) {
    if (state.webUrl || state.preparationAttemptedAt) throw new Error('Stored test canvas identity differs; no automatic rebinding.');
    state.projectId = sameName[0].projectId;
  }
  state.preparationAttemptedAt ??= new Date().toISOString(); persist();
  const canvas = sameName[0] ?? (await call('canvas-create', ['canvas', 'create', state.name, '--project-id', state.projectId, '--non-interactive'])).response.data.project;
  state.webUrl = canvas.webUrl; persist();
  console.log('Test canvas:', state.webUrl);
  await call('resource-upload', ['resource', 'upload', '--project-id', state.projectId, '--resource-id', state.uploadedResourceId, '--file', input, '--type', 'image', '--name', 'TEST-FIXTURE-NOT-AI-input.png', '--import-kind', 'local_upload', '--non-interactive']);
  const readImage = (await call('source-before-save', ['node', 'show', '--project-id', state.projectId, '--node-id', state.imageNodeId])).response;
  if (!readImage.data.nodes.some(item => item.result === 'FOUND' && item.node?.nodeId === state.imageNodeId)) await call('source-import', ['node', 'create', 'image', '--project-id', state.projectId, '--node-id', state.imageNodeId, '--update-id', state.imageUpdateId, '--submit-id', state.imageImportSubmitId, '--title', 'TEST FIXTURE / NOT AI - 1280x720', '--resource-id', state.uploadedResourceId, '--import-kind', 'local_upload', '--non-interactive']);
}
const plan = { projectId: state.projectId, nodeId: state.videoNodeId, sourceNodeId: state.imageNodeId, sourceResourceId: state.uploadedResourceId, inputSha256: state.sourceSha256, prompt: state.prompt, parameters: state.params };
validateCanvasVideoPlan(plan, inspection.models);
if (options.has('--prepare')) {
  const before = (await call('video-before-save', ['node', 'show', '--project-id', state.projectId, '--node-id', state.videoNodeId])).response;
  if (!before.data.nodes.some(item => item.result === 'FOUND' && item.node?.nodeId === state.videoNodeId)) await call('video-draft-save', buildCanvasVideoDraftArgs(plan, state.videoUpdateId));
}
const readback = (await call('nodes-readback', ['node', 'show', '--project-id', state.projectId, '--node-id', state.imageNodeId, '--node-id', state.videoNodeId])).response;
const binding = verifyCanvasVideoReadback(plan, readback);
const quoteResult = await call('node-quote', ['node', 'quote', '--project-id', state.projectId, '--node-id', state.videoNodeId]);
const quote = parseCanvasVideoQuote(plan, quoteResult.result, binding);
const evidence = { checkedAt: quote.checkedAt, channel: inspection.channel, cliVersion: inspection.version, canvas: { projectId: state.projectId, nodeId: state.videoNodeId, webUrl: state.webUrl, sourceNodeId: state.imageNodeId, sourceResourceId: state.uploadedResourceId, draftVersion: binding.draftVersion }, input: { path: 'docs/video-v07-evidence/TEST-FIXTURE-NOT-AI-input.png', sha256: expectedSha256, width: 1280, height: 720, source: 'explicit test fixture / NOT AI generated' }, parameters: { ...state.params, prompt: state.prompt }, quote, auth: { loggedIn: inspection.auth.loggedIn, region: inspection.auth.region, profile: inspection.auth.profile, scope: 'canvas only; snapshot' }, eligibility: { catalogModelDetected: true, nodeSavedAndReadBack: true, sameNodeQuoteSucceeded: quote.status === 'quoted_snapshot', generationAdmissionVerified: false, actualGenerationVerified: false, reason: 'Model catalog, saving and quote do not prove permission/admission at future run.' }, preparation: { videoStatus: binding.videoStatus, resources: binding.videoResourceCount, realGenerationSubmissions: 0, confirmations: 0 }, canSubmit: false, message: 'Archived preparation/quote only; no credit authorization or generation.' };
const roundtripReceipt = path.join(directory, 'input-download.json'), roundtripFile = path.join(directory, 'uploaded-input-roundtrip.png');
if (fs.existsSync(roundtripReceipt) && fs.existsSync(roundtripFile)) {
  const downloaded = JSON.parse(fs.readFileSync(roundtripReceipt, 'utf8').replace(/^\uFEFF/, ''));
  const actualSha256 = fileHash(roundtripFile);
  if (downloaded.ok !== true || downloaded.data.resourceId !== state.uploadedResourceId || downloaded.data.sha256 !== actualSha256 || downloaded.data.size !== fs.statSync(roundtripFile).size) throw new Error('Uploaded resource download receipt/hash mismatch.');
  evidence.input.registeredResource = { resourceId: state.uploadedResourceId, downloadSha256: actualSha256, downloadSize: downloaded.data.size, downloadRequestId: downloaded.meta?.requestId ?? null, equalsOriginalFileBytes: actualSha256 === expectedSha256, uploadReceiptHasHash: false, note: 'Upload returned resourceId/mediaType only; downloadable registered resource is separately hashed. Byte difference is observed, cause not returned. This is not proof that a generation model used the reference.' };
}
evidence.referenceEvidence = { localFileHashedBeforeUpload: true, uploadedResourceRegistered: true, imageNodeHasOneSuccessfulBoundResource: true, videoDraftReferencesImageNode: true, upstreamConnectionReadBack: true, actualGenerationToolReferenceUse: 'not_verified_no_generation_submitted', platformReferenceUseReceipt: null, nativeAudioDisableSupported: false, nativeAudioDisableEvidence: 'Actual video help/schema and model flags expose no audio switch; text request is not a native control.' };
const checkRecord = audit.write('check', evidence);
audit.pointer('check', checkRecord, { checkedAt: evidence.checkedAt });
audit.pointer('latest', checkRecord, { checkedAt: evidence.checkedAt, stage: 'quote', canSubmit: false });
if (options.has('--write-evidence')) { const destination = path.join(repository, 'docs', 'canvas-video-v08-evidence', 'check.json'); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, JSON.stringify(sanitizeCanvasReceipt(evidence), null, 2)); }
console.log(JSON.stringify({ projectId: state.projectId, nodeId: state.videoNodeId, quote: { status: quote.status, amount: quote.amount, unit: quote.unit, expiresAt: quote.expiresAt }, canSubmit: false }));
