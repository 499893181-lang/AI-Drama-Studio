import { randomUUID } from 'node:crypto';
import { AppError, now } from './store.mjs';
import { ScriptWorkspace, scriptSourceHash, scriptInputHash, scriptReviewHash, novelInput } from './script-store.mjs';
import { createNovelAdapter, scriptCostEstimate } from './novel.mjs';
import { ScriptReviewJobs } from './script-review.mjs';
import { redact } from './tools.mjs';

const terminal = new Set(['succeeded', 'failed']);
const pending = new Set(['prepared', 'awaiting_cost', 'submitting', 'running', 'interrupted', 'uncertain']);
const safeMessage = value => redact(String(value ?? '')).slice(0, 2500);
const quoteFingerprint = value => JSON.stringify({ status: value?.status, amount: value?.amount, currency: value?.currency, basis: value?.basis, quoteId: value?.quoteId, expiresAt: value?.expiresAt, canSubmit: value?.canSubmit });

export class ScriptService {
  constructor(store, options = {}) {
    this.store = store; this.workspace = new ScriptWorkspace(store);
    this.adapter = options.adapter ?? createNovelAdapter({ rootDir: store.root });
    this.quoteProvider = options.quoteProvider ?? scriptCostEstimate;
    this.reviewer = options.reviewer ?? new ScriptReviewJobs(store, options.reviewOptions);
    this.active = new Map(); this.timers = new Map(); this.closed = false; this.toolCache = null;
    for (const task of store.list('script-jobs').values) {
      if (['submitting', 'running'].includes(task.status)) {
        task.status = task.threadId && task.runId ? 'interrupted' : 'uncertain';
        task.message = task.threadId && task.runId ? '上次等待中断。请查询原thread/run任务，工作台不会重新提交。' : '上次提交结果不确定，已保留request-id；缺少原任务引用，禁止盲目重复提交。';
        task.updatedAt = now(); store.write('script-jobs', task);
      }
    }
  }
  async inspect(refresh = false) {
    if (!refresh && this.toolCache && Date.now() - this.toolCache.at < 15000) return this.toolCache.value;
    let value;
    try { value = await this.adapter.inspect(); }
    catch (error) { value = { installed: false, loggedIn: false, version: null, path: null, message: safeMessage(error.message) }; }
    this.toolCache = { at: Date.now(), value }; return value;
  }
  async view(id) {
    const project = this.workspace.project(id);
    return { ...this.workspace.view(id), costEstimate: await this.quoteProvider(project), tool: await this.inspect() };
  }
  assertCurrent(task) {
    const workspace = this.workspace.get(task.projectId), project = this.workspace.project(task.projectId);
    if (workspace.sourceHash !== scriptSourceHash(project) || task.sourceHash !== scriptSourceHash(project) || task.inputHash !== scriptInputHash(workspace, project)) throw new AppError('上游创作说明、剧本输入或绑定已变化，旧候选需要复核，请重新整理后准备任务。', 409);
    return { workspace, project };
  }
  async verifyBinding(id, revision) {
    const workspace = this.workspace.get(id); this.workspace.check(workspace, revision);
    if (!workspace.binding.projectId) throw new AppError('请填写真实即梦画布ID，并先保存输入。');
    const result = await this.adapter.verifyBinding(workspace.binding);
    return this.workspace.verifyBinding(id, revision, result);
  }
  async prepare(id, { revision, kind }) {
    if (this.closed) throw new AppError('服务正在关闭。', 503);
    const workspace = this.workspace.get(id), project = this.workspace.project(id);
    this.workspace.check(workspace, revision);
    if (!project.creativeBrief || workspace.sourceHash !== scriptSourceHash(project)) throw new AppError('请先保存创作说明，再重新整理剧本输入。', 409);
    const input = novelInput(workspace, kind), inputHash = scriptInputHash(workspace, project);
    const cost = await this.quoteProvider(project);
    this.workspace.check(this.workspace.get(id), revision);
    if (scriptSourceHash(this.workspace.project(id)) !== scriptSourceHash(project)) throw new AppError('准备费用期间上游已改变，请重新整理输入。', 409);
    const existing = this.store.list('script-jobs').values.find(task => task.projectId === id && task.kind === kind && task.inputHash === inputHash && pending.has(task.status));
    const validExpiry = !cost.expiresAt || (Number.isFinite(new Date(cost.expiresAt).getTime()) && new Date(cost.expiresAt).getTime() > Date.now());
    if (existing && (existing.submittedAt || (quoteFingerprint(existing.cost) === quoteFingerprint(cost) && validExpiry))) return existing;
    const task = { id: randomUUID(), projectId: id, kind, provider: 'jimeng-novel', requestId: randomUUID(), threadId: null, runId: null, status: cost.canSubmit ? 'prepared' : 'awaiting_cost', sourceHash: scriptSourceHash(project), inputHash, sourceRevision: project.revision, workspaceRevision: workspace.revision, binding: { ...workspace.binding }, input, cost, body: null, error: null, message: cost.canSubmit ? '输入与费用依据已准备，尚未提交；请审阅费用后明确确认。' : '费用待确认，未提交任何生成任务。', receipts: [], events: [], createdAt: now(), updatedAt: now(), submittedAt: null, adoptedAt: null, queryCount: 0 };
    return this.store.write('script-jobs', task);
  }
  event(task, type, message) {
    task.message = safeMessage(message); task.updatedAt = now();
    task.events.push({ at: now(), type, message: task.message });
    return this.store.write('script-jobs', task);
  }
  async submit(id, { confirm } = {}) {
    if (this.closed) throw new AppError('服务正在关闭。', 503);
    let task = this.store.read('script-jobs', id);
    if (confirm !== true) throw new AppError('提交前必须明确确认本次费用。', 409);
    if (!['prepared', 'awaiting_cost'].includes(task.status) || task.submittedAt) throw new AppError('此任务已提交或结果不确定。请查询原任务，不要重新提交。', 409);
    const initial = this.assertCurrent(task);
    const freshCost = await this.quoteProvider(initial.project);
    // An earlier submit may have finished while the quote provider was awaited.
    task = this.store.read('script-jobs', id);
    if (!['prepared', 'awaiting_cost'].includes(task.status) || task.submittedAt) throw new AppError('此任务已提交或结果不确定。请查询原任务，不要重新提交。', 409);
    const { workspace, project } = this.assertCurrent(task);
    if (freshCost.status !== 'known' || freshCost.canSubmit !== true || typeof freshCost.amount !== 'number' || !Number.isFinite(freshCost.amount) || freshCost.amount < 0 || freshCost.currency !== 'CNY' || !freshCost.basis || !freshCost.quoteId) throw new AppError('费用待确认：未取得适用于剧本任务的可核验人民币报价，工作台不会提交。', 409);
    if (quoteFingerprint(task.cost) !== quoteFingerprint(freshCost)) throw new AppError('费用依据已变化，请重新准备任务并确认。', 409);
    if (freshCost.expiresAt && (!Number.isFinite(new Date(freshCost.expiresAt).getTime()) || new Date(freshCost.expiresAt).getTime() <= Date.now())) throw new AppError('本次费用依据已过期或有效期不正确，请重新核对。', 409);
    if (project.budgetCap === null) throw new AppError('请先在立项页面设置预算上限，并重新整理剧本输入。', 409);
    const reserved = this.store.list('script-jobs').values.filter(item => item.projectId === project.id && item.submittedAt).reduce((sum, item) => sum + (item.cost?.amount ?? 0), 0);
    if (reserved + freshCost.amount > project.budgetCap) throw new AppError('本次费用与已预留费用合计超过项目预算，未提交。', 409);
    if (!workspace.binding.verified || !workspace.binding.projectId || task.binding.projectId !== workspace.binding.projectId || task.binding.teamId !== workspace.binding.teamId) throw new AppError('请先验证真实即梦画布与空间绑定。', 409);
    if ([...this.active.values()].some(run => run.task.projectId === task.projectId) || this.store.list('script-jobs').values.some(other => other.id !== id && other.projectId === task.projectId && other.submittedAt && !terminal.has(other.status))) throw new AppError('本项目存在运行中或结果不确定的任务，请先查询原任务。', 409);
    // Persist the idempotency key and submission intent before any external command.
    task.status = 'submitting'; task.submittedAt = now();
    this.event(task, 'submit.intent', '本次费用已明确确认，准备调用真实即梦剧本工具。');
    const run = { task, controller: new AbortController(), queries: 0 };
    this.active.set(id, run);
    this.executeSubmit(run).catch(error => this.uncertain(run, error));
    return task;
  }
  receipt(task, value) {
    // Late receipts may identify an accepted task after local shutdown. Merge only
    // references/evidence into the latest record; never revive its execution state.
    const target = this.closed ? this.store.read('script-jobs', task.id) : task;
    const mismatch = (target.threadId && value.threadId && target.threadId !== String(value.threadId)) || (target.runId && value.runId && target.runId !== String(value.runId));
    if (!mismatch) {
      if (value.threadId) target.threadId = String(value.threadId);
      if (value.runId) target.runId = String(value.runId);
    } else if (!this.closed) { target.status = 'uncertain'; target.error = '回执任务引用与原thread/run不一致，保留原引用，未采用新结果。'; }
    if (value.receipt) target.receipts.push({ at: now(), ...value.receipt });
    target.updatedAt = now(); this.store.write('script-jobs', target);
    return !mismatch;
  }
  async executeSubmit(run) {
    const result = await this.adapter.submit({ kind: run.task.kind, binding: run.task.binding, input: run.task.input, requestId: run.task.requestId, signal: run.controller.signal, onReceipt: value => this.receipt(run.task, value) });
    if (!this.closed) this.accept(run.task, result);
    else this.receipt(run.task, result);
    this.active.delete(run.task.id);
    if (!this.closed && run.task.status === 'running') this.schedule(run.task.id);
  }
  accept(task, value) {
    if (!this.receipt(task, value)) return this.event(task, 'task.uncertain', task.error);
    task.error = value.error ? safeMessage(value.error) : null;
    if (value.status === 'succeeded' && typeof value.body === 'string' && value.body.trim() && value.body.length <= 100000 && task.threadId && task.runId) {
      task.status = 'succeeded'; task.body = value.body;
      return this.event(task, 'task.succeeded', '真实剧本任务已成功，完整正文与回执已保存；请审阅后采用。');
    }
    if (value.status === 'failed') { task.status = 'failed'; task.body = null; return this.event(task, 'task.failed', task.error || '服务端返回真实失败状态。'); }
    task.status = value.status === 'running' && task.threadId && task.runId ? 'running' : 'uncertain'; task.body = null;
    return this.event(task, task.status, task.status === 'running' ? '原任务仍在处理；已保存thread/run，将查询原任务。' : '结果尚不完整或任务引用缺失，未标记成功，禁止盲目重复提交。');
  }
  uncertain(run, error) {
    this.active.delete(run.task.id);
    if (this.closed) return;
    run.task.status = 'uncertain'; run.task.error = safeMessage(error.message ?? error);
    this.event(run.task, 'task.uncertain', `调用结果不确定，已保留原request-id和回执。${run.task.error}`);
  }
  schedule(id) {
    clearTimeout(this.timers.get(id));
    const timer = setTimeout(() => { this.timers.delete(id); this.query(id).catch(() => {}); }, 15000);
    timer.unref?.(); this.timers.set(id, timer);
  }
  async query(id) {
    if (this.closed) throw new AppError('服务正在关闭。', 503);
    if (this.active.has(id)) throw new AppError('正在等待该原任务的回执。', 409);
    const task = this.store.read('script-jobs', id);
    if (!task.threadId || !task.runId) throw new AppError('缺少原thread_id/run_id。请先核对原始回执；不会新建任务或更换request-id。', 409);
    if (terminal.has(task.status)) return task;
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
    const run = { task, controller: new AbortController() }; this.active.set(id, run);
    try {
      const value = await this.adapter.query({ threadId: task.threadId, runId: task.runId, teamId: task.binding.teamId, signal: run.controller.signal, onReceipt: value => this.receipt(task, value) });
      if (this.closed) { this.receipt(task, value); return task; }
      task.queryCount += 1; this.accept(task, value);
      if (task.status === 'running' && task.queryCount < 120) this.schedule(id);
      else if (task.status === 'running') this.event(task, 'query.paused', '自动查询已暂停，原任务保留。可稍后点击查询继续，切勿重复提交。');
      return task;
    } catch (error) { this.uncertain(run, error); return task; }
    finally { this.active.delete(id); }
  }
  adopt(id, revision) {
    const task = this.store.read('script-jobs', id), { workspace } = this.assertCurrent(task);
    if (task.status !== 'succeeded' || !task.body?.trim()) throw new AppError('只有真实成功且完整的正文才能采用。', 409);
    if (task.adoptedAt || workspace.versions.some(version => version.taskId === task.id)) throw new AppError('此候选已采用过。', 409);
    const next = this.workspace.addVersion(task.projectId, { revision, kind: task.kind, body: task.body, parentVersionId: task.kind === 'outline' ? workspace.activeOutlineId : workspace.activeScriptId }, { taskId: task.id });
    task.adoptedAt = now(); this.store.write('script-jobs', task); return next;
  }
  startReview(id, { revision, versionId }) {
    const workspace = this.workspace.get(id), project = this.workspace.project(id); this.workspace.check(workspace, revision);
    const version = workspace.versions.find(version => version.id === versionId && version.kind === 'script');
    if (!version) throw new AppError('请先保存或采用一个完整剧本版本。', 409);
    if (version.id !== workspace.activeScriptId || this.workspace.versionStale(version, workspace, project)) throw new AppError('该剧本版本需要复核，请先同步当前输入并保存新的活动稿，再启动独立审阅。', 409);
    return this.reviewer.start({ project, scriptVersion: version, inputHash: scriptReviewHash(workspace, project, version) });
  }
  close() {
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const run of this.active.values()) {
      run.controller.abort(); run.task.status = run.task.threadId && run.task.runId ? 'interrupted' : 'uncertain';
      run.task.message = '本地等待已停止，原任务可能仍在服务端运行。恢复后只查询原任务，不自动重新提交。';
      run.task.updatedAt = now(); this.store.write('script-jobs', run.task);
    }
    this.active.clear(); this.reviewer.close();
  }
}
