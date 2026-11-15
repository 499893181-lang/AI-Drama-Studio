import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { ScriptService } from '../src/scripts.mjs';
import { ScriptReviewJobs, reviewCriteria } from '../src/script-review.mjs';

// Business-acceptance boundaries, entirely isolated. No real CLI, canvas or model calls.
const artifacts = path.resolve('tests/.artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const unknown = () => ({ status: 'unknown', amount: null, currency: null, label: '费用待确认', basis: '隔离测试：没有已核验的CLI费用依据', canSubmit: false });
const complete = { status: 'succeeded', threadId: 'fixture-original-thread', runId: 'fixture-original-run', body: '隔离原任务结果：父子在雨夜车站相认。', error: null, receipt: { stdout: 'isolated-original-result', exitCode: 0 } };
const report = () => ({ verdict: 'PASS', summary: '隔离报告，不是真实Codex审阅。', criteria: reviewCriteria.map(id => ({ id, verdict: 'PASS', evidence: '隔离边界验证的逐项证据。', issues: [] })), issues: [], estimatedDurationSeconds: 30, durationBasis: '隔离测试常量，非媒体实测。' });
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(artifacts, 'first-business-'));
  const store = new Store(root);
  const calls = { submit: 0, query: 0, review: 0 };
  const adapter = {
    async inspect() { return { installed: true, loggedIn: true, version: 'fixture', message: '隔离适配器，非真实认证结果。' }; },
    async submit() { calls.submit++; throw new Error('本测试禁止提交真实生成'); },
    async query(input) { calls.query++; assert.equal(input.threadId, complete.threadId); assert.equal(input.runId, complete.runId); return complete; },
  };
  const reviewer = new ScriptReviewJobs(store, { runner: async () => { calls.review++; return { exitCode: 0, completed: true, finalMessage: JSON.stringify(report()) }; } });
  const service = new ScriptService(store, { adapter, reviewer, quoteProvider: options.quoteProvider ?? unknown });
  t.after(() => {
    service.close();
    const resolved = fs.realpathSync(root);
    assert.ok(resolved.startsWith(fs.realpathSync(artifacts) + path.sep), '只清理隔离测试数据');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const project = store.create({ name: '首次业务验收边界夹具', idea: '雨夜父子相认，怀表恢复走动。', durationSeconds: 30, budgetCap: 80, creativeBrief: { synopsis: '修表师为老人修好怀表，父子相认。', background: '雨夜车站。', characters: '父子。', conflict: '身份尚未揭晓。', emotion: '从迟疑到释怀。', ending: '温暖相认。', preservedContent: ['雨夜', '怀表', '父子相认'], addedSettings: ['车站暖光。'] } });
  return { store, service, calls, project };
}
async function settled(store, id) {
  for (let i = 0; i < 100; i++) {
    const value = store.read('script-reviews', id);
    if (value.status === 'succeeded') return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('隔离审阅等待超时');
}

test('大纲与单集分别保留未知费用待提交任务，不因30秒或预算充足推断免费', async t => {
  const { service, store, calls, project } = fixture(t);
  const workspace = service.workspace.update(project.id, { revision: 0, binding: { projectId: 'fixture-cloud-project', teamId: '' } });
  const outline = await service.prepare(project.id, { revision: workspace.revision, kind: 'outline' });
  const episode = await service.prepare(project.id, { revision: workspace.revision, kind: 'script' });
  assert.notEqual(outline.requestId, episode.requestId);
  for (const task of [outline, episode]) {
    assert.equal(task.status, 'awaiting_cost');
    await assert.rejects(() => service.submit(task.id, { confirm: true }), error => error.status === 409 && /费用待确认/.test(error.message));
    const saved = store.read('script-jobs', task.id);
    assert.equal(saved.requestId, task.requestId);
    assert.equal(saved.submittedAt, null);
    assert.equal(saved.body, null);
  }
  assert.equal(calls.submit, 0); assert.equal(calls.query, 0);
});

test('费用依据过期或变未知不阻止原已接受任务查询，也不重新扣费提交', async t => {
  const { service, store, calls, project } = fixture(t);
  const workspace = service.workspace.update(project.id, { revision: 0 });
  const prepared = await service.prepare(project.id, { revision: workspace.revision, kind: 'script' });
  store.write('script-jobs', { ...prepared, status: 'interrupted', submittedAt: '2026-11-15T00:00:00.000Z', threadId: complete.threadId, runId: complete.runId, cost: { status: 'known', billingType: 'credits', amount: 10, currency: 'CREDITS', basis: '隔离历史积分价格，现已过期', expiresAt: '2026-11-14T00:00:00.000Z', canSubmit: false } });
  const result = await service.query(prepared.id);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.requestId, prepared.requestId);
  assert.equal(calls.query, 1); assert.equal(calls.submit, 0);
});

test('未知剧本费用时可单独审阅人工稿，结果不冒充即梦生成，时长改变后需复核', async t => {
  const { service, store, calls, project } = fixture(t);
  const workspace = service.workspace.addVersion(project.id, { revision: 0, kind: 'script', body: '【软件验收人工文本样例，非即梦生成】\n雨夜车站，修表师替老人修表。父子相认。' });
  const version = workspace.versions[0];
  assert.equal(version.origin, 'user'); assert.equal(version.taskId, null);
  const job = service.startReview(project.id, { revision: workspace.revision, versionId: version.id });
  const completed = await settled(store, job.id);
  assert.equal(completed.versionId, version.id);
  assert.equal(completed.inputSnapshot.scriptVersion.origin, 'user');
  assert.equal(completed.inputSnapshot.scriptVersion.taskId, null);
  assert.equal(service.workspace.view(project.id).reviews[0].needsReview, false);
  assert.equal(service.workspace.view(project.id).tasks.length, 0);
  assert.equal(calls.review, 1); assert.equal(calls.submit, 0); assert.equal(calls.query, 0);
  store.update(project.id, { revision: project.revision, durationSeconds: 45 });
  const changed = service.workspace.view(project.id);
  assert.equal(changed.upstreamStale, true);
  assert.equal(changed.versions[0].stale, true);
  assert.equal(changed.reviews[0].needsReview, true);
  assert.equal(store.read('script-reviews', job.id).report.verdict, 'PASS', '历史报告保留，当前有效性另行标记');
});
