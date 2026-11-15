// Read-only audit of an EXISTING task. No Codex RPC/model/generation calls.
// The optional Schema input must have been generated separately by the CLI.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inspectImage } from '../src/image-files.mjs';
import { decodeActualImage } from '../src/image-decoder.mjs';
import { inspectImageInputSchema, summarizeImageEvidence } from '../src/image-evidence.mjs';

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  if (!/^--(source-data|task-id|schema|out)$/.test(process.argv[index]) || !process.argv[index + 1]) throw new Error('使用--source-data <旧data绝对路径> --task-id <UUID> --schema <实际Schema路径> --out <新诊断目录>');
  options.set(process.argv[index], process.argv[index + 1]);
}
const dataRoot = path.resolve(options.get('--source-data') ?? '');
const taskId = options.get('--task-id');
assert.match(taskId ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const output = path.resolve(options.get('--out') ?? 'tests/.artifacts/contract-v061/audit');
const canonical = value => fs.realpathSync.native(value).replace(/^\\\\\?\\/, '').toLowerCase();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.ok(!output.toLowerCase().startsWith(dataRoot.toLowerCase() + path.sep), '审计输出必须位于原data之外。');
assert.ok(!fs.existsSync(output) || !canonical(output).startsWith(canonical(dataRoot) + path.sep), '审计输出不能通过junction进入原data。');
fs.mkdirSync(output, { recursive: true });
const taskFile = path.join(dataRoot, 'image-generation-jobs', `${taskId}.json`);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const job = read(taskFile), runtime = path.join(dataRoot, 'runtime/image-generation', taskId);
const requestsFile = path.join(runtime, 'official-rpc/requests.jsonl'), eventsFile = path.join(runtime, 'official-rpc/events.jsonl');
const log = file => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const requests = log(requestsFile), events = log(eventsFile);
const generation = events.findLast(event => event.method === 'item/completed' && event.params?.item?.type === 'imageGeneration')?.params?.item;
assert.ok(generation, '没有既有官方图片完成事件，不能补造。');
const retained = job.retainedArtifacts?.[0];
const imageFile = retained ? path.resolve(dataRoot, retained.path) : generation.savedPath;
const referenceFiles = (job.attachments ?? []).map(ref => ({ ...ref, actualSha256: hash(fs.readFileSync(ref.path)), fileHashVerified: hash(fs.readFileSync(ref.path)) === ref.sha256 }));
const guardRoot = path.join(dataRoot, 'runtime/image-generation', `${taskId}-host-control/guard`), marker = path.join(guardRoot, 'image-call.accepted.json');
const sources = [
  ['task', taskFile], ['task_backup', taskFile + '.bak'], ['requests', requestsFile], ['events', eventsFile], ['retained_image', imageFile], ['native_image', generation.savedPath],
  ['guard_manifest', path.join(guardRoot, 'manifest.json')], ['guard_script', path.join(guardRoot, 'single-image-guard.mjs')],
  ...referenceFiles.map((ref, index) => [`reference_${index + 1}`, ref.path]),
].filter(([, file]) => file && fs.existsSync(file));
const before = sources.map(([label, file]) => ({ label, sha256: hash(fs.readFileSync(file)), file }));
const markerBefore = fs.existsSync(marker);
const bytes = fs.readFileSync(imageFile), info = inspectImage(bytes);
assert.equal(hash(bytes), retained?.sha256 ?? hash(bytes));
const encoded = generation.result;
const resultMatches = typeof encoded === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ? hash(Buffer.from(encoded, 'base64')) === hash(bytes) : null;
assert.notEqual(resultMatches, false, '既有文件与官方base64不符。');
const decoded = await decodeActualImage({ bytes, cwd: path.join(output, 'pixel-decode') });
assert.equal(decoded.decoded, true); assert.equal(decoded.width, info.width); assert.equal(decoded.height, info.height);
const schemaFile = options.get('--schema');
const schemaBytes = schemaFile ? fs.readFileSync(path.resolve(schemaFile)) : null;
const schemaContract = schemaBytes ? { ...inspectImageInputSchema(JSON.parse(schemaBytes)), schemaSha256: hash(schemaBytes) } : null;
const report = summarizeImageEvidence({ job, requests, events, artifact: { ...info, sha256: hash(bytes), fileHashVerified: true, decoded }, referenceFiles, schemaContract, logsComplete: true });
report.createdAt = new Date().toISOString(); report.source = 'existing_official_task_readonly_audit'; report.newModelTurns = 0; report.newImageCalls = 0;
report.original.taskFileSha256 = before.find(item => item.label === 'task').sha256;
report.artifactVerification = { ...info, sha256: hash(bytes), decoded, officialBase64Matches: resultMatches, outputCount: 1, fileHashVerified: true };
report.originalEvidenceFiles = before.map(({ label, sha256 }) => ({ label, sha256 }));
report.marker = { existedBefore: markerBefore, existsAfter: fs.existsSync(marker), modified: false };
for (const original of before) assert.equal(hash(fs.readFileSync(original.file)), original.sha256, `${original.label}不能改变`);
assert.equal(fs.existsSync(marker), markerBefore); assert.equal(read(taskFile).status, job.status); assert.equal(read(taskFile).error, job.error);
report.preservationVerified = true;
fs.writeFileSync(path.join(output, 'diagnostic-report.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'audit-manifest.json'), JSON.stringify({ taskId, newModelTurns: 0, newImageCalls: 0, sourceFilesUnchanged: before.length, markerBefore, markerAfter: fs.existsSync(marker), files: report.originalEvidenceFiles, reportSha256: hash(fs.readFileSync(path.join(output, 'diagnostic-report.json'))) }, null, 2) + '\n');
console.log(JSON.stringify({ report: path.join(output, 'diagnostic-report.json'), manifest: path.join(output, 'audit-manifest.json'), counts: report.counts, states: Object.fromEntries(Object.entries(report.evidence).map(([key, value]) => [key, value.status])), preservedFiles: before.length, newImageCalls: 0 }));
