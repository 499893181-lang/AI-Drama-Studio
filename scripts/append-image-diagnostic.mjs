// Explicit trusted LOCAL append; no HTTP endpoint accepts evidence from clients.
// It requires an existing original task and never changes its submit budget.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { ImageTaskDiagnostics } from '../src/image-diagnostics.mjs';

const args = new Map();
for (let n = 2; n < process.argv.length; n += 2) {
  assert.ok(['--source-data', '--task-id', '--report'].includes(process.argv[n]) && process.argv[n + 1], '使用--source-data <原data> --task-id <原任务ID> --report <已审计报告>');
  args.set(process.argv[n], process.argv[n + 1]);
}
assert.ok(args.get('--source-data') && args.get('--report'));
const root = path.resolve(args.get('--source-data')), id = args.get('--task-id');
assert.match(id ?? '', /^[a-zA-Z0-9-]{1,80}$/);
const jobFile = path.join(root, 'image-generation-jobs', `${id}.json`);
assert.ok(fs.existsSync(jobFile), '必须复用原data与原任务，不创建新目录重置次数。');
const original = fs.readFileSync(jobFile), job = JSON.parse(original), report = JSON.parse(fs.readFileSync(path.resolve(args.get('--report')), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(report.source, 'existing_official_task_readonly_audit'); assert.equal(report.original.taskFileSha256, hash(original));
assert.equal(report.newModelTurns, 0); assert.equal(report.newImageCalls, 0);
assert.equal(report.evidence.acceptance.status, 'incomplete'); assert.equal(report.evidence.protection.strictSingleCallGuaranteed, false);
const runtime = path.join(root, 'runtime', 'image-generation', id), control = path.join(root, 'runtime', 'image-generation', `${id}-host-control`, 'guard');
const marker = path.join(control, 'image-call.accepted.json'), markerBefore = fs.existsSync(marker);
const files = [jobFile, jobFile + '.bak', ...['packet.json', 'prompt.txt', 'attachments.json', 'official-rpc/requests.jsonl', 'official-rpc/events.jsonl'].map(name => path.join(runtime, name)), ...['manifest.json', 'single-image-guard.mjs'].map(name => path.join(control, name)), ...(job.retainedArtifacts ?? []).map(item => path.resolve(root, item.path)), ...(job.attachments ?? []).map(item => item.path)].filter(file => fs.existsSync(file));
const sourceFiles = [...new Set(files)].map(file => ({ relative: path.relative(root, file), sha256: hash(fs.readFileSync(file)) }));
const store = new Store(root), journal = new ImageTaskDiagnostics(store);
const record = journal.append(id, { report, sourceFiles });
assert.deepEqual(fs.readFileSync(jobFile), original); assert.equal(fs.existsSync(marker), markerBefore);
const submitted = store.list('image-generation-jobs').values.filter(item => item.submittedAt).length;
console.log(JSON.stringify({ appendedDiagnosticId: record.id, originalJobSha256: hash(original), originalStatus: job.status, applicationSubmissionsStill: submitted, markerBefore, markerAfter: fs.existsSync(marker), newModelTurns: 0, newImageCalls: 0 }));
