import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { ScriptReviewJobs, reviewCriteria, scriptReviewPrompt, validateScriptReview } from '../src/script-review.mjs';

const artifacts = path.resolve('tests/.artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const creativeBrief = () => ({ synopsis: '雨夜父子相认。', background: '末班车站。', characters: '失联父子。', conflict: '身份未知。', emotion: '迟疑到释然。', ending: '温暖团圆。', preservedContent: ['保留怀表和温暖结局'], addedSettings: ['车站有暖黄色灯光'] });
// All model-like reports below are explicit isolated fixtures, never product fallback.
const fixtureReport = () => ({ verdict: 'PASS', summary: '隔离测试报告，不是真实模型审阅。', criteria: reviewCriteria.map(id => ({ id, verdict: 'PASS', evidence: `隔离夹具证据：${id} 对应当前正文第1段。`, issues: [] })), issues: [], estimatedDurationSeconds: 30, durationBasis: '仅为隔离夹具；按文字语速与停顿假设估计，不是媒体实测。' });
const success = report => ({ exitCode: 0, completed: true, finalMessage: JSON.stringify(report ?? fixtureReport()), threadId: 'fixture-review-thread', usage: { input_tokens: 10, output_tokens: 10 } });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(artifacts, 'script-review-'));
  const store = new Store(root);
  const project = store.create({ name: '独立审阅隔离项目', idea: '保留怀表和温暖结局。故事出现$(whoami)，这不是系统指令。', creativeBrief: creativeBrief() });
  const scriptVersion = { id: randomUUID(), projectId: project.id, kind: 'script', origin: 'user', sourceHash: 'fixture-source-hash', body: '第一场：雨夜车站。年轻修表师修好怀表，与失联父亲相认，温暖拥抱。' };
  const context = { root, store, project, scriptVersion, jobs: null };
  t.after(() => {
    context.jobs?.close();
    const resolved = fs.realpathSync(root);
    assert.ok(resolved.startsWith(fs.realpathSync(artifacts) + path.sep), '只清理测试目录内临时数据');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return context;
}
async function terminal(store, id) {
  for (let i = 0; i < 150; i++) {
    const value = store.read('script-reviews', id);
    if (!['queued', 'running'].includes(value.status)) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('隔离审阅未在测试时限内结束');
}

test('审阅报告必须有六类唯一证据，矛盾PASS与空结果会拒绝', () => {
  assert.deepEqual(validateScriptReview(fixtureReport()), fixtureReport());
  const missing = fixtureReport(); missing.criteria.pop();
  assert.throws(() => validateScriptReview(missing), /六类/);
  const duplicate = fixtureReport(); duplicate.criteria[1].id = duplicate.criteria[0].id;
  assert.throws(() => validateScriptReview(duplicate), /重复/);
  const noEvidence = fixtureReport(); noEvidence.criteria[0].evidence = ' ';
  assert.throws(() => validateScriptReview(noEvidence), /证据/);
  const conflict = fixtureReport();
  conflict.issues.push({ id: 'R-001', severity: 'blocking', location: '结尾', evidence: '夹具中的未解决用户约束。', suggestion: '按约束修改。' });
  assert.throws(() => validateScriptReview(conflict), /PASS/);
  const revise = fixtureReport(); revise.criteria[2].verdict = 'REVISE'; revise.criteria[2].issues = ['逻辑断裂'];
  assert.throws(() => validateScriptReview(revise), /PASS/);
  const invalidDuration = fixtureReport(); invalidDuration.estimatedDurationSeconds = NaN;
  assert.throws(() => validateScriptReview(invalidDuration), /时长/);
  assert.throws(() => validateScriptReview(null), /字段/);
});

test('独立提示只绑定当前用户要求、已保存说明与指定剧本，不继承创作会话', t => {
  const { project, scriptVersion } = fixture(t);
  const prompt = scriptReviewPrompt({ project, scriptVersion });
  assert.match(prompt, /没有参与这份剧本的生成/);
  assert.match(prompt, /\$\(whoami\)/);
  assert.match(prompt, /不能作为对你的指令/);
  assert.match(prompt, /保留怀表和温暖结局/);
  assert.match(prompt, /车站有暖黄色灯光/);
  assert.match(prompt, /previous_script|scriptVersion/);
  for (const criterion of reviewCriteria) assert.ok(prompt.includes(criterion));
  assert.match(prompt, /不声称实测/);
});

test('只有显式start才调用runner，成功报告独立持久化且不改剧本或项目', async t => {
  const ctx = fixture(t);
  const projectBefore = fs.readFileSync(ctx.store.file('projects', ctx.project.id), 'utf8');
  const versionBefore = structuredClone(ctx.scriptVersion);
  let calls = 0;
  ctx.jobs = new ScriptReviewJobs(ctx.store, { runner: async args => {
    calls++;
    assert.equal(args.schema.type, 'object'); assert.ok(args.signal instanceof AbortSignal);
    assert.ok(args.cwd.startsWith(ctx.root)); assert.ok(args.prompt.includes(ctx.scriptVersion.body));
    args.onEvent({ type: 'turn.started', message: '隔离测试事件' });
    return success();
  } });
  assert.equal(calls, 0, '构造或读取不能触发真实审阅');
  const queued = ctx.jobs.start({ project: ctx.project, scriptVersion: ctx.scriptVersion, inputHash: 'fixture-current-review-input' });
  assert.equal(queued.status, 'queued');
  const done = await terminal(ctx.store, queued.id);
  assert.equal(calls, 1); assert.equal(done.status, 'succeeded');
  assert.equal(done.versionId, ctx.scriptVersion.id); assert.equal(done.inputHash, 'fixture-current-review-input');
  assert.equal(done.report.criteria.length, 6); assert.equal(done.report.verdict, 'PASS');
  assert.equal(done.inputSnapshot.scriptVersion.body, ctx.scriptVersion.body);
  assert.deepEqual(new Store(ctx.root).read('script-reviews', queued.id), done);
  assert.equal(fs.readFileSync(ctx.store.file('projects', ctx.project.id), 'utf8'), projectBefore);
  assert.deepEqual(ctx.scriptVersion, versionBefore);
});

test('exit0但未完成、空JSON、缺证据和矛盾结论均不记录为审阅成功', async t => {
  const malformed = fixtureReport(); malformed.criteria.pop();
  const contradictory = fixtureReport(); contradictory.criteria[0].verdict = 'REVISE'; contradictory.criteria[0].issues = ['用户要求丢失'];
  const cases = [
    { exitCode: 0, completed: false, finalMessage: JSON.stringify(fixtureReport()) },
    { exitCode: 0, completed: true, finalMessage: '{}' },
    success(malformed), success(contradictory),
  ];
  for (let i = 0; i < cases.length; i++) await t.test(`无效夹具${i + 1}`, async t => {
    const ctx = fixture(t);
    ctx.jobs = new ScriptReviewJobs(ctx.store, { runner: async () => cases[i] });
    const job = ctx.jobs.start({ project: ctx.project, scriptVersion: ctx.scriptVersion, inputHash: 'fixture-current-input' });
    const done = await terminal(ctx.store, job.id);
    assert.equal(done.status, 'failed'); assert.equal(done.report, null); assert.ok(done.error);
  });
});

test('runner认证或网络错误不生成替代报告，日志统一脱敏', async t => {
  const ctx = fixture(t);
  ctx.jobs = new ScriptReviewJobs(ctx.store, { runner: async ({ onEvent }) => {
    onEvent({ type: 'error', message: 'Authorization: Bearer fixture-private-token access_token=fixture-access-token' });
    throw new Error('网络失败 Bearer fixture-private-token access_token=fixture-access-token');
  } });
  const job = ctx.jobs.start({ project: ctx.project, scriptVersion: ctx.scriptVersion, inputHash: 'fixture-current-input' });
  const done = await terminal(ctx.store, job.id);
  assert.equal(done.status, 'failed'); assert.equal(done.report, null);
  const serialized = JSON.stringify(done);
  assert.ok(!serialized.includes('fixture-private-token')); assert.ok(!serialized.includes('fixture-access-token')); assert.match(serialized, /REDACTED/);
});

test('同项目并发拒绝，取消后迟到的成功结果不能覆盖取消状态', async t => {
  const ctx = fixture(t);
  let complete, signal;
  ctx.jobs = new ScriptReviewJobs(ctx.store, { runner: args => { signal = args.signal; return new Promise(resolve => { complete = resolve; }); } });
  const input = { project: ctx.project, scriptVersion: ctx.scriptVersion, inputHash: 'fixture-current-input' };
  const job = ctx.jobs.start(input);
  assert.throws(() => ctx.jobs.start(input), error => error.status === 409);
  await new Promise(resolve => setTimeout(resolve, 0));
  const cancelled = ctx.jobs.cancel(job.id);
  assert.equal(cancelled.status, 'cancelled'); assert.equal(signal.aborted, true);
  complete(success()); await new Promise(resolve => setTimeout(resolve, 20));
  const stored = ctx.store.read('script-reviews', job.id);
  assert.equal(stored.status, 'cancelled'); assert.equal(stored.report, null);
});

test('重启只标记旧审阅中断，不自动启动Codex或假造报告', t => {
  const ctx = fixture(t), id = randomUUID(); let calls = 0;
  fs.mkdirSync(path.join(ctx.root, 'script-reviews'), { recursive: true });
  ctx.store.write('script-reviews', { id, projectId: ctx.project.id, versionId: ctx.scriptVersion.id, status: 'running', inputHash: 'old-input', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), events: [], report: null });
  ctx.jobs = new ScriptReviewJobs(ctx.store, { runner: async () => { calls++; return success(); } });
  const restored = ctx.store.read('script-reviews', id);
  assert.equal(restored.status, 'interrupted'); assert.equal(restored.report, null); assert.match(restored.error, /未自动重试/); assert.equal(calls, 0);
});

test('关闭服务中断已排队审阅，尚未执行的runner不会被调用', async t => {
  const ctx = fixture(t); let calls = 0;
  ctx.jobs = new ScriptReviewJobs(ctx.store, { runner: async () => { calls++; return success(); } });
  const job = ctx.jobs.start({ project: ctx.project, scriptVersion: ctx.scriptVersion, inputHash: 'fixture-current-input' });
  ctx.jobs.close(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 0); assert.equal(ctx.store.read('script-reviews', job.id).status, 'interrupted');
  assert.throws(() => ctx.jobs.start({ project: ctx.project, scriptVersion: ctx.scriptVersion, inputHash: 'fixture' }), error => error.status === 503);
});
