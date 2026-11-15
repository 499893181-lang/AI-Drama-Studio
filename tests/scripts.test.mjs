import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { ScriptService } from '../src/scripts.mjs';
import { ScriptWorkspace, scriptSourceHash, scriptReviewHash } from '../src/script-store.mjs';
import { createStudio } from '../src/server.mjs';

const artifacts = path.resolve('tests/.artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const brief = () => ({ synopsis: '雨夜父子在车站相认。', background: '末班车站。', characters: '失联父子。', conflict: '身份未知。', emotion: '从迟疑到释然。', ending: '温暖团圆。', preservedContent: ['保留怀表和温暖结局'], addedSettings: ['暖黄色灯光'] });
// Quote and adapter reports are isolated fixtures; no CLI or real generation runs.
const zeroQuote = () => ({ status: 'known', label: '隔离测试零报价', amount: 0, currency: 'CNY', basis: '测试夹具，不是实际官方报价', quoteId: 'fixture-zero-quote', canSubmit: true });
const rawReceipt = (status, threadId = 'fixture-thread', runId = 'fixture-run') => ({ stdout: JSON.stringify({ status, data: { thread_id: threadId, run_id: runId } }), stderr: '', exitCode: 0, json: { status, data: { thread_id: threadId, run_id: runId } }, command: ['script', status === 'running' ? 'episode' : 'result'] });
const running = () => ({ status: 'running', threadId: 'fixture-thread', runId: 'fixture-run', body: null, error: null, receipt: rawReceipt('running') });
const success = () => ({ status: 'succeeded', threadId: 'fixture-thread', runId: 'fixture-run', body: '【隔离夹具正文】雨夜车站，修表师修好怀表，与父亲相认后温暖拥抱。', error: null, receipt: rawReceipt('success') });

function mockReviewer(store) {
  const calls = [];
  return {
    calls, closed: false,
    start(input) {
      calls.push(input);
      return store.write('script-reviews', { id: randomUUID(), projectId: input.project.id, versionId: input.scriptVersion.id, sourceHash: input.scriptVersion.sourceHash, inputHash: input.inputHash, provider: 'codex-cli', status: 'succeeded', report: { verdict: 'PASS', summary: '仅为隔离路由夹具，不是真实模型审阅。' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), events: [] });
    },
    cancel() { throw new Error('隔离夹具没有运行任务'); },
    close() { this.closed = true; },
  };
}
function fixture(t, { quoteProvider, budgetCap = 0, adapterOverrides = {} } = {}) {
  const root = fs.mkdtempSync(path.join(artifacts, 'scripts-service-'));
  const store = new Store(root);
  const project = store.create({ name: '第二阶段隔离项目', idea: '雨夜修好怀表，父子相认，结局必须温暖。', creativeBrief: brief(), budgetCap });
  const calls = { inspect: 0, binding: [], submit: [], query: [] };
  const adapter = {
    async inspect() { calls.inspect++; return { installed: true, loggedIn: true, version: 'fixture', path: null, message: '仅为隔离测试' }; },
    async verifyBinding(binding) { calls.binding.push(structuredClone(binding)); return { verified: true, projectId: binding.projectId, teamId: binding.teamId, title: '隔离画布' }; },
    async submit(input) { calls.submit.push(input); return running(); },
    async query(input) { calls.query.push(input); return success(); },
    ...adapterOverrides,
  };
  const ctx = { root, store, project, calls, adapter, services: [], quoteProvider };
  ctx.newService = extra => {
    const reviewer = mockReviewer(store);
    const service = new ScriptService(store, { adapter, ...(quoteProvider ? { quoteProvider } : {}), reviewer, ...extra });
    ctx.services.push(service); ctx.reviewer = reviewer; return service;
  };
  ctx.service = ctx.newService();
  t.after(() => {
    for (const service of ctx.services) service.close();
    const resolved = fs.realpathSync(root);
    assert.ok(resolved.startsWith(fs.realpathSync(artifacts) + path.sep), '只允许删除测试目录内临时数据');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return ctx;
}
async function bind(ctx, service = ctx.service) {
  let workspace = service.workspace.get(ctx.project.id);
  workspace = service.workspace.update(ctx.project.id, { revision: workspace.revision, binding: { projectId: 'fixture-remote-project', teamId: '0' } });
  return service.verifyBinding(ctx.project.id, workspace.revision);
}
async function waitTask(store, id, statuses) {
  for (let i = 0; i < 100; i++) {
    const task = store.read('script-jobs', id);
    if (statuses.includes(task.status)) return task;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('隔离任务未达到预期状态');
}

test('默认费用未知只准备request-id，重复准备复用，确认提交仍409且外部调用为0', async t => {
  const ctx = fixture(t), projectFile = ctx.store.file('projects', ctx.project.id);
  const before = fs.readFileSync(projectFile, 'utf8');
  const workspace = ctx.service.workspace.get(ctx.project.id);
  assert.equal(workspace.revision, 0); assert.equal(workspace.input.episode_num, 1);
  assert.ok(workspace.input.requirement.includes(ctx.project.idea));
  assert.ok(workspace.input.requirement.includes('30秒')); assert.ok(workspace.input.requirement.includes('不创建图片'));
  const task = await ctx.service.prepare(ctx.project.id, { revision: 0, kind: 'script' });
  assert.match(task.requestId, /^[0-9a-f-]{36}$/); assert.equal(task.status, 'awaiting_cost');
  assert.equal(task.cost.status, 'unknown'); assert.equal(task.cost.label, '费用待确认');
  assert.equal(task.submittedAt, null); assert.equal(task.threadId, null); assert.equal(task.runId, null);
  const repeated = await ctx.service.prepare(ctx.project.id, { revision: 0, kind: 'script' });
  assert.equal(repeated.id, task.id); assert.equal(repeated.requestId, task.requestId);
  await assert.rejects(ctx.service.submit(task.id, { confirm: true }), error => error.status === 409 && /费用待确认/.test(error.message));
  assert.equal(ctx.calls.submit.length, 0); assert.equal(ctx.calls.query.length, 0); assert.equal(ctx.reviewer.calls.length, 0);
  assert.equal(fs.readFileSync(projectFile, 'utf8'), before);
});

test('已确认隔离报价：先持久化request-id，恢复只查询原IDs，成功正文才能采用', async t => {
  const ctx = fixture(t, { quoteProvider: zeroQuote });
  const projectBefore = fs.readFileSync(ctx.store.file('projects', ctx.project.id), 'utf8');
  let workspace = await bind(ctx);
  const task = await ctx.service.prepare(ctx.project.id, { revision: workspace.revision, kind: 'script' });
  const originalSubmit = ctx.adapter.submit;
  ctx.adapter.submit = async input => {
    const persisted = ctx.store.read('script-jobs', task.id);
    assert.equal(persisted.requestId, input.requestId); assert.equal(persisted.status, 'submitting'); assert.ok(persisted.submittedAt);
    const value = await originalSubmit(input); await input.onReceipt(value); return value;
  };
  await assert.rejects(ctx.service.submit(task.id, {}), error => error.status === 409);
  await ctx.service.submit(task.id, { confirm: true });
  const active = await waitTask(ctx.store, task.id, ['running']);
  assert.equal(ctx.calls.submit.length, 1); assert.equal(active.threadId, 'fixture-thread'); assert.equal(active.runId, 'fixture-run');
  assert.ok(active.receipts.some(receipt => receipt.stdout === rawReceipt('running').stdout));
  assert.equal(active.body, null);
  ctx.service.close();
  const restarted = ctx.newService();
  assert.equal(ctx.store.read('script-jobs', task.id).status, 'interrupted');
  const done = await restarted.query(task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(done.requestId, task.requestId); assert.equal(done.body, success().body);
  assert.equal(ctx.calls.submit.length, 1, '重启恢复不能再次submit');
  assert.equal(ctx.calls.query.length, 1); assert.equal(ctx.calls.query[0].threadId, 'fixture-thread'); assert.equal(ctx.calls.query[0].runId, 'fixture-run'); assert.equal(ctx.calls.query[0].teamId, '0');
  assert.ok(done.receipts.some(receipt => receipt.stdout === rawReceipt('success').stdout));
  workspace = restarted.adopt(task.id, restarted.workspace.get(ctx.project.id).revision);
  const version = workspace.versions.find(version => version.id === workspace.activeScriptId);
  assert.equal(version.origin, 'jimeng-novel'); assert.equal(version.taskId, task.id); assert.equal(version.body, success().body);
  assert.equal(ctx.reviewer.calls.length, 0, '采用不能自动触发审阅');
  assert.throws(() => restarted.adopt(task.id, workspace.revision), error => error.status === 409);
  assert.equal(fs.readFileSync(ctx.store.file('projects', ctx.project.id), 'utf8'), projectBefore);
});

test('缺原任务IDs与不完整成功只能uncertain，保留回执且不能重提或采用', async t => {
  const ctx = fixture(t, { quoteProvider: zeroQuote, adapterOverrides: { async submit(input) { ctx.calls.submit.push(input); return { status: 'succeeded', threadId: null, runId: null, body: '夹具文字不算完整可追踪结果', receipt: { stdout: '{"status":"success","data":{}}', exitCode: 0 }, error: null }; } } });
  const workspace = await bind(ctx);
  const task = await ctx.service.prepare(ctx.project.id, { revision: workspace.revision, kind: 'outline' });
  await ctx.service.submit(task.id, { confirm: true });
  const uncertain = await waitTask(ctx.store, task.id, ['uncertain']);
  assert.equal(uncertain.body, null); assert.equal(uncertain.requestId, task.requestId); assert.ok(uncertain.receipts.length);
  ctx.service.close(); const restarted = ctx.newService();
  await assert.rejects(restarted.query(task.id), error => error.status === 409 && /thread_id/.test(error.message));
  await assert.rejects(restarted.submit(task.id, { confirm: true }), error => error.status === 409);
  assert.throws(() => restarted.adopt(task.id, restarted.workspace.get(ctx.project.id).revision), error => error.status === 409);
  assert.equal(ctx.calls.submit.length, 1); assert.equal(ctx.calls.query.length, 0);
});

test('隔离报价仍必须通过预算、有效期、币种和真实绑定校验', async t => {
  const cases = [
    { label: '超预算', quote: { ...zeroQuote(), amount: 1 }, binding: true, expected: /超过项目预算/ },
    { label: '未验证绑定', quote: zeroQuote(), binding: false, expected: /验证真实即梦/ },
    { label: '未知报价', quote: { ...zeroQuote(), status: 'unknown' }, binding: true, expected: /费用待确认/ },
    { label: '积分不能冒充人民币', quote: { ...zeroQuote(), currency: 'credits' }, binding: true, expected: /费用待确认/ },
    { label: '过期依据', quote: { ...zeroQuote(), expiresAt: '2020-01-01T00:00:00Z' }, binding: true, expected: /已过期/ },
  ];
  for (const item of cases) await t.test(item.label, async t => {
    const ctx = fixture(t, { quoteProvider: () => item.quote });
    const workspace = item.binding ? await bind(ctx) : ctx.service.workspace.get(ctx.project.id);
    const task = await ctx.service.prepare(ctx.project.id, { revision: workspace.revision, kind: 'script' });
    await assert.rejects(ctx.service.submit(task.id, { confirm: true }), error => error.status === 409 && item.expected.test(error.message));
    assert.equal(ctx.calls.submit.length, 0); assert.equal(ctx.store.read('script-jobs', task.id).submittedAt, null);
  });
});

test('旧revision、输入变化或原创作说明变化拒绝旧候选，上游变化标记待复核', async t => {
  const ctx = fixture(t, { quoteProvider: zeroQuote, adapterOverrides: { async submit(input) { ctx.calls.submit.push(input); return success(); } } });
  let workspace = await bind(ctx);
  const task = await ctx.service.prepare(ctx.project.id, { revision: workspace.revision, kind: 'script' });
  await ctx.service.submit(task.id, { confirm: true }); await waitTask(ctx.store, task.id, ['succeeded']);
  const saved = ctx.service.workspace.addVersion(ctx.project.id, { revision: workspace.revision, body: '【人工稿】自己的完整结局。' });
  assert.throws(() => ctx.service.adopt(task.id, workspace.revision), error => error.status === 409 && /其他窗口/.test(error.message));
  workspace = ctx.service.workspace.update(ctx.project.id, { revision: saved.revision, input: { ...saved.input, requirement: saved.input.requirement + '\n用户新增约束' } });
  assert.throws(() => ctx.service.adopt(task.id, workspace.revision), error => error.status === 409 && /已变化/.test(error.message));
  assert.equal(ctx.service.workspace.view(ctx.project.id).tasks[0].stale, true);
  const changedProject = ctx.store.update(ctx.project.id, { revision: ctx.project.revision, creativeBrief: { ...ctx.project.creativeBrief, ending: '用户现在要求开放式温暖结尾。' } });
  const view = ctx.service.workspace.view(ctx.project.id);
  assert.equal(view.upstreamStale, true); assert.equal(view.currentSourceHash, scriptSourceHash(changedProject));
  assert.equal(view.versions[0].stale, true);
  await assert.rejects(ctx.service.prepare(ctx.project.id, { revision: workspace.revision, kind: 'script' }), error => error.status === 409);
  assert.throws(() => ctx.service.adopt(task.id, workspace.revision), error => error.status === 409);
});

test('人工稿和回滚使用不可变版本，审阅只在明确请求后独立保存并随活动稿失效', t => {
  const ctx = fixture(t);
  const projectBefore = fs.readFileSync(ctx.store.file('projects', ctx.project.id), 'utf8');
  let workspace = ctx.service.workspace.addVersion(ctx.project.id, { revision: 0, body: '【人工第一稿】雨夜修好怀表，父子相认。' });
  const first = structuredClone(workspace.versions[0]);
  workspace = ctx.service.workspace.addVersion(ctx.project.id, { revision: workspace.revision, body: '【人工第二稿】父子共同走入暖光。', parentVersionId: first.id });
  const second = structuredClone(workspace.versions[1]);
  assert.equal(ctx.reviewer.calls.length, 0);
  const review = ctx.service.startReview(ctx.project.id, { revision: workspace.revision, versionId: second.id });
  assert.equal(ctx.reviewer.calls.length, 1); assert.equal(review.inputHash, scriptReviewHash(workspace, ctx.project, second));
  assert.ok(fs.existsSync(ctx.store.file('script-reviews', review.id)));
  assert.equal(ctx.service.workspace.view(ctx.project.id).reviews[0].needsReview, false);
  workspace = ctx.service.workspace.activate(ctx.project.id, workspace.revision, first.id);
  assert.equal(workspace.activeScriptId, first.id); assert.equal(workspace.versions.length, 2);
  assert.deepEqual(workspace.versions[0], first); assert.deepEqual(workspace.versions[1], second);
  assert.equal(ctx.service.workspace.view(ctx.project.id).reviews[0].needsReview, true);
  assert.throws(() => ctx.service.startReview(ctx.project.id, { revision: workspace.revision, versionId: second.id }), error => error.status === 409);
  assert.throws(() => ctx.service.workspace.addVersion(ctx.project.id, { revision: workspace.revision - 1, body: '旧窗口不能覆盖稿' }), error => error.status === 409);
  assert.equal(fs.readFileSync(ctx.store.file('projects', ctx.project.id), 'utf8'), projectBefore);
});

test('原说明改变后旧审阅失效，显式同步保留旧输入历史且需新活动稿再审', t => {
  const ctx = fixture(t);
  let workspace = ctx.service.workspace.addVersion(ctx.project.id, { revision: 0, body: '【隔离人工稿】父子在雨夜车站重逢。' });
  const version = workspace.versions[0];
  ctx.service.startReview(ctx.project.id, { revision: workspace.revision, versionId: version.id });
  const newProject = ctx.store.update(ctx.project.id, { revision: ctx.project.revision, creativeBrief: { ...ctx.project.creativeBrief, conflict: '用户补充：末班车即将离站。' } });
  let view = ctx.service.workspace.view(ctx.project.id);
  assert.equal(view.upstreamStale, true); assert.equal(view.reviews[0].needsReview, true);
  assert.throws(() => ctx.service.startReview(ctx.project.id, { revision: workspace.revision, versionId: version.id }), error => error.status === 409);
  workspace = ctx.service.workspace.sync(ctx.project.id, workspace.revision);
  assert.equal(workspace.inputHistory.length, 1); assert.ok(workspace.inputHistory[0].input.story_engine.includes('身份未知'));
  assert.equal(workspace.sourceHash, scriptSourceHash(newProject)); assert.ok(workspace.input.story_engine.includes('末班车即将离站'));
  view = ctx.service.workspace.view(ctx.project.id); assert.equal(view.upstreamStale, false); assert.equal(view.versions[0].stale, true);
  workspace = ctx.service.workspace.addVersion(ctx.project.id, { revision: workspace.revision, body: '【隔离新人工稿】末班车即将离站，父子相认。', parentVersionId: version.id });
  ctx.service.startReview(ctx.project.id, { revision: workspace.revision, versionId: workspace.activeScriptId });
  assert.equal(ctx.reviewer.calls.length, 2); assert.equal(workspace.versions.length, 2);
});

test('同输入报价变化可以重新准备并保留旧记录，同报价仍复用原request-id', async t => {
  let quote = { status: 'unknown', label: '费用待确认', amount: null, currency: null, basis: '隔离未知价格', canSubmit: false };
  const ctx = fixture(t, { quoteProvider: () => quote });
  const workspace = await bind(ctx);
  const awaiting = await ctx.service.prepare(ctx.project.id, { revision: workspace.revision, kind: 'script' });
  const sameUnknown = await ctx.service.prepare(ctx.project.id, { revision: workspace.revision, kind: 'script' });
  assert.equal(awaiting.status, 'awaiting_cost'); assert.equal(sameUnknown.requestId, awaiting.requestId);
  quote = { ...zeroQuote(), quoteId: 'fixture-price-v1' };
  const known = await ctx.service.prepare(ctx.project.id, { revision: workspace.revision, kind: 'script' });
  assert.notEqual(known.id, awaiting.id); assert.notEqual(known.requestId, awaiting.requestId);
  assert.equal(known.cost.quoteId, 'fixture-price-v1');
  quote = { ...zeroQuote(), quoteId: 'fixture-price-v2', basis: '隔离更新后的官方依据夹具' };
  const refreshed = await ctx.service.prepare(ctx.project.id, { revision: workspace.revision, kind: 'script' });
  assert.notEqual(refreshed.id, known.id); assert.equal(refreshed.cost.quoteId, 'fixture-price-v2');
  const repeated = await ctx.service.prepare(ctx.project.id, { revision: workspace.revision, kind: 'script' });
  assert.equal(repeated.requestId, refreshed.requestId);
  assert.equal(ctx.store.read('script-jobs', awaiting.id).cost.status, 'unknown');
  assert.equal(ctx.store.read('script-jobs', known.id).cost.quoteId, 'fixture-price-v1');
  assert.equal(ctx.calls.submit.length, 0);
});

test('已提交原任务即使报价更新仍复用原引用，不另建可重复提交任务', async t => {
  let quote = zeroQuote();
  const ctx = fixture(t, { quoteProvider: () => quote });
  const workspace = await bind(ctx);
  const task = await ctx.service.prepare(ctx.project.id, { revision: workspace.revision, kind: 'script' });
  await ctx.service.submit(task.id, { confirm: true });
  await waitTask(ctx.store, task.id, ['running']);
  quote = { ...zeroQuote(), quoteId: 'fixture-price-after-submit' };
  const repeated = await ctx.service.prepare(ctx.project.id, { revision: workspace.revision, kind: 'script' });
  assert.equal(repeated.id, task.id); assert.equal(repeated.requestId, task.requestId);
  assert.equal(ctx.store.list('script-jobs').values.length, 1); assert.equal(ctx.calls.submit.length, 1);
});

test('无效报价有效期不能绕过日期比较而提交', async t => {
  const ctx = fixture(t, { quoteProvider: () => ({ ...zeroQuote(), expiresAt: 'not-a-real-date' }) });
  const workspace = await bind(ctx);
  await assert.rejects(async () => {
    const task = await ctx.service.prepare(ctx.project.id, { revision: workspace.revision, kind: 'script' });
    await ctx.service.submit(task.id, { confirm: true });
  }, error => error.status === 409 && /有效期|过期|日期|费用/.test(error.message));
  assert.equal(ctx.calls.submit.length, 0);
});

test('等待新报价期间上游、输入或绑定变化时仍拒绝提交，不使用旧快照', async t => {
  for (const change of ['source', 'input', 'binding']) await t.test(change, async t => {
    let hold = false, finishQuote;
    const ctx = fixture(t, { quoteProvider: () => hold ? new Promise(resolve => { finishQuote = resolve; }) : zeroQuote() });
    const workspace = await bind(ctx);
    const task = await ctx.service.prepare(ctx.project.id, { revision: workspace.revision, kind: 'script' });
    hold = true;
    const pending = ctx.service.submit(task.id, { confirm: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(typeof finishQuote, 'function');
    if (change === 'source') ctx.store.update(ctx.project.id, { revision: ctx.project.revision, creativeBrief: { ...ctx.project.creativeBrief, ending: '等待报价时用户改了结局。' } });
    else if (change === 'input') ctx.service.workspace.update(ctx.project.id, { revision: workspace.revision, input: { ...workspace.input, requirement: workspace.input.requirement + '\n等待报价时用户增加约束。' } });
    else ctx.service.workspace.update(ctx.project.id, { revision: workspace.revision, binding: { projectId: 'fixture-another-remote', teamId: '0' } });
    finishQuote(zeroQuote());
    await assert.rejects(pending, error => error.status === 409 && /已变化|重新整理|复核/.test(error.message));
    assert.equal(ctx.calls.submit.length, 0); assert.equal(ctx.store.read('script-jobs', task.id).submittedAt, null);
  });
});

test('HTTP剧本路由保存手稿与历史，未知费用提交返回409且不触发外部生成', async t => {
  const ctx = fixture(t);
  const app = createStudio({ dataDir: ctx.root, inspectTools: async () => ({ checkedAt: new Date().toISOString(), tools: [] }), scriptOptions: { adapter: ctx.adapter, reviewer: mockReviewer(ctx.store) } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (route, method = 'GET', input) => {
    const response = await fetch(base + route, { method, headers: input === undefined ? {} : { 'Content-Type': 'application/json' }, body: input === undefined ? undefined : JSON.stringify(input) });
    return { response, body: await response.json() };
  };
  try {
    const route = `/api/projects/${ctx.project.id}/script`;
    let result = await call(route); assert.equal(result.response.status, 200); assert.equal(result.body.costEstimate.status, 'unknown');
    result = await call(route, 'PUT', { revision: 0, binding: { projectId: 'fixture-http-project', teamId: '' }, input: result.body.input });
    assert.equal(result.response.status, 200); const revision = result.body.revision;
    result = await call(route + '/versions', 'POST', { revision, body: '【HTTP隔离人工稿】保留怀表，温暖结尾。' });
    assert.equal(result.response.status, 201); assert.equal(result.body.versions.length, 1);
    const latestRevision = result.body.revision;
    result = await call(route + '/prepare', 'POST', { revision: latestRevision, kind: 'outline' });
    assert.equal(result.response.status, 201); const taskId = result.body.id;
    result = await call(`/api/script-tasks/${taskId}/submit`, 'POST', { confirm: true });
    assert.equal(result.response.status, 409); assert.match(result.body.error, /费用待确认/);
    const task = await call(`/api/script-tasks/${taskId}`); assert.equal(task.body.status, 'awaiting_cost'); assert.equal(task.body.submittedAt, null);
    assert.equal(ctx.calls.submit.length, 0); assert.equal(ctx.calls.query.length, 0);
  } finally { await app.close(); }
});
