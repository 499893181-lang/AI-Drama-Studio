import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { ImageTaskDiagnostics } from '../src/image-diagnostics.mjs';
import { summarizeImageEvidence } from '../src/image-evidence.mjs';
import { createStudio } from '../src/server.mjs';

const artifacts = path.resolve('tests/.artifacts'); fs.mkdirSync(artifacts, { recursive: true });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const store = new Store(fs.mkdtempSync(path.join(artifacts, 'image-diagnostics-')));
  fs.mkdirSync(path.join(store.root, 'image-generation-jobs'));
  const project = store.create({ name: '[隔离诊断测试]', idea: '只验证已失败任务，不调用生成。' });
  const timestamp = new Date().toISOString();
  const job = { id: randomUUID(), projectId: project.id, provider: 'codex-cli-built-in-image', status: 'failed', error: '原错误，禁止追改。', submittedAt: timestamp, createdAt: timestamp, updatedAt: timestamp, result: null, events: [{ type: 'failed', message: '保留错误' }], plannedReferences: [] };
  store.write('image-generation-jobs', job);
  const journal = new ImageTaskDiagnostics(store), report = summarizeImageEvidence({ job });
  return { store, project, job, journal, report, original: fs.readFileSync(store.file('image-generation-jobs', job.id)) };
}

test('追加诊断与幂等重读不改原失败任务字节、错误或回执，不新增备份', () => {
  const ctx = fixture(), first = ctx.journal.append(ctx.job.id, { report: ctx.report });
  const second = ctx.journal.append(ctx.job.id, { report: ctx.report });
  assert.equal(second.id, first.id);
  assert.equal(new ImageTaskDiagnostics(ctx.store).history(ctx.job.id).records.length, 1);
  assert.deepEqual(fs.readFileSync(ctx.store.file('image-generation-jobs', ctx.job.id)), ctx.original);
  assert.equal(fs.existsSync(ctx.store.file('image-generation-jobs', ctx.job.id) + '.bak'), false);
  assert.equal(ctx.journal.view(ctx.job).evidence.acceptance.status, 'incomplete');
});

test('证据Hash改变使旧诊断过期，历史与原任务保留，不默默复活', () => {
  const ctx = fixture(), relative = `runtime/image-generation/${ctx.job.id}/events.jsonl`, file = path.join(ctx.store.root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{"method":"fixture-original"}\n');
  ctx.journal.append(ctx.job.id, { report: ctx.report, sourceFiles: [{ relative, sha256: digest(fs.readFileSync(file)) }] });
  assert.equal(ctx.journal.view(ctx.job).current, true);
  fs.appendFileSync(file, '{"method":"fixture-changed"}\n');
  assert.equal(ctx.journal.history(ctx.job.id).records[0].current, false);
  assert.equal(ctx.journal.view(ctx.job).current, false);
  assert.equal(ctx.journal.history(ctx.job.id).records.length, 1);
  assert.deepEqual(fs.readFileSync(ctx.store.file('image-generation-jobs', ctx.job.id)), ctx.original);
});

test('拒绝错绑任务、过期原状态、伪称完整通过和跨任务/认证路径', () => {
  const ctx = fixture();
  assert.throws(() => ctx.journal.append(ctx.job.id, { report: { ...ctx.report, taskId: randomUUID() } }), /不匹配/);
  assert.throws(() => ctx.journal.append(ctx.job.id, { report: { ...ctx.report, original: { ...ctx.report.original, status: 'succeeded' } } }), /不匹配/);
  assert.throws(() => ctx.journal.append(ctx.job.id, { report: { ...ctx.report, evidence: { ...ctx.report.evidence, acceptance: { status: 'passed' } } } }), /不能宣称/);
  for (const relative of ['auth.json', '../auth.json', `runtime/image-generation/${randomUUID()}/events.jsonl`]) assert.throws(() => ctx.journal.append(ctx.job.id, { report: ctx.report, sourceFiles: [{ relative, sha256: '0'.repeat(64) }] }), /路径|本任务/);
  assert.equal(ctx.journal.history(ctx.job.id).records.length, 0);
  assert.deepEqual(fs.readFileSync(ctx.store.file('image-generation-jobs', ctx.job.id)), ctx.original);
});

test('状态不变但输入绑定或原字节已变时，不能把旧诊断重新绑定', () => {
  const ctx = fixture();
  assert.throws(() => ctx.journal.append(ctx.job.id, { report: { ...ctx.report, original: { ...ctx.report.original, inputSnapshotHash: 'old-input' } } }), /绑定已改变/);
  assert.throws(() => ctx.journal.append(ctx.job.id, { report: { ...ctx.report, original: { ...ctx.report.original, taskFileSha256: '0'.repeat(64) } } }), /字节已变化/);
  assert.equal(ctx.journal.history(ctx.job.id).records.length, 0);
});

test('损坏的新诊断不能被跳过后拿旧记录冒充当前已核实', () => {
  const ctx = fixture(); ctx.journal.append(ctx.job.id, { report: ctx.report });
  const corrupted = path.join(ctx.journal.directory, `${randomUUID()}.json`); fs.writeFileSync(corrupted, '{"invalid":');
  assert.equal(ctx.journal.view(ctx.job).current, false);
  assert.equal(ctx.journal.history(ctx.job.id).records.length, 1);
  assert.equal(ctx.journal.view(ctx.job).diagnosticWarnings.length, 1);
  assert.deepEqual(fs.readFileSync(ctx.store.file('image-generation-jobs', ctx.job.id)), ctx.original);
  assert.equal(fs.readFileSync(corrupted, 'utf8'), '{"invalid":');
  fs.writeFileSync(corrupted, JSON.stringify({ id: path.basename(corrupted, '.json'), taskId: ctx.job.id, report: {} }));
  assert.equal(ctx.journal.view(ctx.job).current, false);
  assert.equal(ctx.journal.history(ctx.job.id).warnings.length, 1);
});

test('任务内链接不能借dataRoot范围检查读取其他任务或认证', t => {
  const ctx = fixture(), directory = path.join(ctx.store.root, 'runtime', 'image-generation', ctx.job.id);
  fs.mkdirSync(directory, { recursive: true });
  const elsewhere = path.join(ctx.store.root, 'another-task'); fs.mkdirSync(elsewhere); fs.writeFileSync(path.join(elsewhere, 'events.jsonl'), '隔离越界测试');
  const link = path.join(directory, 'link');
  fs.symlinkSync(elsewhere, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => ctx.journal.sourceFile(ctx.job.id, `runtime/image-generation/${ctx.job.id}/link/events.jsonl`), /跨越本任务/);
});

test('HTTP只读诊断与服务重启保留原1/1，不提供外部补造诊断接口', async t => {
  const ctx = fixture(); ctx.journal.append(ctx.job.id, { report: ctx.report });
  const options = { dataDir: ctx.store.root, inspectImageTools: async () => ({ message: '隔离' }), imageGenerationOptions: { inspectCapabilities: async () => ({ canSubmit: false, contractVerified: false, message: '本测试不启动任何CLI' }) } };
  let app = createStudio(options); t.after(() => app.close());
  const listen = async () => { await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${app.server.address().port}`; };
  let base = await listen();
  let response = await fetch(`${base}/api/image-generation-tasks/${ctx.job.id}/diagnostics`); assert.equal(response.status, 200);
  assert.equal((await response.json()).records.length, 1);
  response = await fetch(`${base}/api/image-generation-tasks/${ctx.job.id}/diagnostics`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ctx.report) }); assert.equal(response.status, 404);
  let view = await (await fetch(`${base}/api/projects/${ctx.project.id}/images/generation`)).json();
  assert.equal(view.usageLimit.submitted, 1); assert.equal(view.usageLimit.remaining, 0); assert.equal(view.tasks[0].diagnostic.current, true); assert.equal(view.tasks[0].status, 'failed');
  await app.close(); app = createStudio(options); base = await listen();
  view = await (await fetch(`${base}/api/projects/${ctx.project.id}/images/generation`)).json();
  assert.equal(view.usageLimit.submitted, 1); assert.equal(view.usageLimit.remaining, 0); assert.equal(view.capability.canSubmit, false);
  assert.deepEqual(fs.readFileSync(ctx.store.file('image-generation-jobs', ctx.job.id)), ctx.original);
});
