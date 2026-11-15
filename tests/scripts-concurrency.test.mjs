import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { ScriptService } from '../src/scripts.mjs';

// All adapters and quotes in this file are isolated test fixtures. No CLI or service is called.
const artifacts = path.resolve('tests/.artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const quote = { status: 'known', amount: 1, currency: 'CNY', basis: 'TEST FIXTURE ONLY: no real price', quoteId: 'fixture-quote', canSubmit: true };
const complete = () => ({ status: 'succeeded', threadId: 'fixture-thread', runId: 'fixture-run', body: '【测试夹具】雨夜车站，父子相认，怀表重新走动。', error: null, receipt: { stdout: 'fixture-only-complete', stderr: '', exitCode: 0 } });
const reviewStub = () => ({ close() {}, start() { throw new Error('No real review in fixture'); } });
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Fixture state did not settle');
}
async function fixture(t, adapter, quoteProvider) {
  const root = fs.mkdtempSync(path.join(artifacts, 'script-concurrency-'));
  const store = new Store(root);
  const service = new ScriptService(store, { adapter, quoteProvider, reviewer: reviewStub() });
  t.after(() => {
    service.close();
    const resolved = fs.realpathSync(root);
    assert.ok(resolved.startsWith(fs.realpathSync(artifacts) + path.sep));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const project = store.create({ name: '并发回执隔离夹具', idea: '雨夜父子相认。', budgetCap: 100, creativeBrief: { synopsis: '父子重逢。', background: '雨夜车站。', characters: '父子。', conflict: '身份未知。', emotion: '从迟疑到释怀。', ending: '父子相认。', preservedContent: ['父子相认'], addedSettings: ['暖光'] } });
  let workspace = service.workspace.update(project.id, { revision: 0, binding: { projectId: 'fixture-cloud', teamId: '' } });
  workspace = service.workspace.verifyBinding(project.id, workspace.revision, { verified: true, projectId: 'fixture-cloud', teamId: '' });
  const task = await service.prepare(project.id, { revision: workspace.revision, kind: 'script' });
  return { root, store, service, project, task };
}

test('同task两次异步报价第二笔迟到时只提交一次且不覆盖已完成回执', async t => {
  let quotePhase = 'prepare', submitQuoteCount = 0, releaseSecond;
  let submitCalls = 0;
  const adapter = { async submit() { submitCalls += 1; return complete(); }, async query() { throw new Error('must not query'); } };
  const quoteProvider = () => {
    if (quotePhase === 'prepare') return quote;
    submitQuoteCount += 1;
    return submitQuoteCount === 1 ? quote : new Promise(resolve => { releaseSecond = resolve; });
  };
  const f = await fixture(t, adapter, quoteProvider);
  quotePhase = 'submit';
  const first = f.service.submit(f.task.id, { confirm: true });
  const second = f.service.submit(f.task.id, { confirm: true });
  await first;
  await until(() => f.store.read('script-jobs', f.task.id).status === 'succeeded');
  const before = fs.readFileSync(f.store.file('script-jobs', f.task.id), 'utf8');
  releaseSecond(quote);
  await assert.rejects(second, error => error.status === 409);
  assert.equal(submitCalls, 1);
  assert.equal(fs.readFileSync(f.store.file('script-jobs', f.task.id), 'utf8'), before);
});

test('关闭后迟到的接受ID与原回执仍保存，重开只查询原任务', async t => {
  let submitCalls = 0, queryCalls = 0, received, settle;
  const adapter = {
    submit(args) { submitCalls += 1; received = args; return new Promise(resolve => { settle = resolve; }); },
    async query(args) { queryCalls += 1; assert.equal(args.threadId, 'fixture-thread'); assert.equal(args.runId, 'fixture-run'); return complete(); },
  };
  const f = await fixture(t, adapter, () => quote);
  await f.service.submit(f.task.id, { confirm: true });
  await until(() => !!received);
  f.service.close();
  const accepted = { status: 'running', threadId: 'fixture-thread', runId: 'fixture-run', body: null, error: null, receipt: { stdout: 'fixture-only-late-acceptance', stderr: '', exitCode: null, partial: true } };
  await received.onReceipt(accepted);
  settle(accepted);
  await new Promise(resolve => setTimeout(resolve, 10));
  const stored = f.store.read('script-jobs', f.task.id);
  assert.equal(stored.threadId, 'fixture-thread');
  assert.equal(stored.runId, 'fixture-run');
  assert.ok(['interrupted', 'uncertain'].includes(stored.status));
  assert.ok(stored.receipts.some(receipt => receipt.stdout === 'fixture-only-late-acceptance'));
  const reopened = new ScriptService(f.store, { adapter, quoteProvider: () => quote, reviewer: reviewStub() });
  t.after(() => reopened.close());
  const result = await reopened.query(f.task.id);
  assert.equal(result.status, 'succeeded');
  assert.equal(queryCalls, 1);
  assert.equal(submitCalls, 1);
});

test('查询返回另一个thread/run时保留原引用和原始回执，不接受错任务正文', async t => {
  let submitCalls = 0, queryCalls = 0;
  const adapter = {
    async submit() { submitCalls += 1; throw new Error('must not resubmit'); },
    async query(args) {
      queryCalls += 1;
      assert.equal(args.threadId, 'original-thread'); assert.equal(args.runId, 'original-run');
      return { ...complete(), threadId: 'wrong-thread', runId: 'wrong-run', receipt: { stdout: 'fixture-only-wrong-task', stderr: '', exitCode: 0 } };
    },
  };
  const f = await fixture(t, adapter, () => quote);
  f.store.write('script-jobs', { ...f.task, status: 'interrupted', submittedAt: new Date().toISOString(), threadId: 'original-thread', runId: 'original-run' });
  const result = await f.service.query(f.task.id);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.threadId, 'original-thread'); assert.equal(result.runId, 'original-run');
  assert.equal(result.body, null);
  assert.match(result.error, /不一致/);
  assert.ok(result.receipts.some(receipt => receipt.stdout === 'fixture-only-wrong-task'));
  assert.equal(queryCalls, 1); assert.equal(submitCalls, 0);
});
