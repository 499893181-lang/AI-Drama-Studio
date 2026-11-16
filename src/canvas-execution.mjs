import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { AppError } from './store.mjs';
import { resolveExecutable } from './tools.mjs';
import { canvasPlanHash, canvasVideoChannel, verifyCanvasVideoReadback, parseCanvasVideoQuote, sanitizeCanvasReceipt, sanitizeCanvasDiagnostic } from './canvas-video.mjs';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const node = value => typeof value === 'string' && /^node_[0-9abcdefghjkmnpqrstvwxyz]{10}$/.test(value);
const clone = value => structuredClone(value);
export const canvasVideoApprovalThreshold = 70;

function validatePlan(plan) {
  if (!uuid(plan?.projectId) || !uuid(plan.localProjectId) || !uuid(plan.taskId) || !node(plan.nodeId) || !node(plan.sourceNodeId) || !uuid(plan.sourceResourceId) || !hash(plan.inputSha256) || !hash(plan.registeredResourceSha256) || !hash(plan.localBindingHash) || !hash(plan.inputSnapshotHash)) throw new AppError('待授权计划缺少项目、节点、输入或版本Hash绑定。', 409);
  const p = plan.parameters;
  if (!p || p.model !== 'seedance_2.0_vip' || p.mode !== 'first_last_frame' || p.durationSeconds !== 5 || p.resolution !== '720p' || p.outputCount !== 1 || p.ratio !== '16:9' || !['provider_default', 'mute_derivative'].includes(p.audioMode) || typeof plan.prompt !== 'string' || !plan.prompt.trim()) throw new AppError('首次验收只准备同一首帧、指定模型、5秒720p和1个结果；不自动改参。', 409);
}
function decode(result) {
  for (const value of [result?.stdout, result?.stderr, result?.output]) if (typeof value === 'string') { try { return JSON.parse(value.replace(/^\uFEFF/, '').trim()); } catch { /* No prose guesses. */ } }
  return null;
}
function clean(value, secrets = []) {
  const redactStrings = item => typeof item === 'string' ? secrets.reduce((text, secret) => secret ? text.split(secret).join('[REDACTED]') : text, sanitizeCanvasDiagnostic(item)) : Array.isArray(item) ? item.map(redactStrings) : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).map(([key, child]) => [key, redactStrings(child)])) : item;
  return redactStrings(sanitizeCanvasReceipt(value));
}
function nativeRun(binary, args, { signal, timeoutMs = 30000 } = {}) {
  return new Promise(resolve => {
    if (!binary) { resolve({ exitCode: null, stdout: '', stderr: '未找到dreamina-canvas。' }); return; }
    execFile(binary, args, { shell: false, windowsHide: true, encoding: 'utf8', signal, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ exitCode: error ? typeof error.code === 'number' ? error.code : null : 0, stdout: stdout ?? '', stderr: stderr ?? '', timedOut: !!error?.killed }));
  });
}
const aborted = signal => { if (signal?.aborted) throw new AppError('当前等待已取消；只保留原身份，不自动提交或重试。', 409); };
const schemaCommand = (schema, names) => names.reduce((entry, name) => entry?.subcommands?.find(item => item.name === name), schema?.data);

export function buildCanvasExecutionScope(plan, { readback, context }) {
  validatePlan(plan);
  if (!Number.isInteger(readback?.draftVersion) || readback.draftVersion < 1 || context?.consumptionSubject?.kind !== 'personal' || !hash(context.consumptionSubjectHash) || !context.region || !context.profile) throw new AppError('草稿版本或当前账号上下文尚未核实。', 409);
  return { channel: canvasVideoChannel, localProjectId: plan.localProjectId, taskId: plan.taskId, localBindingHash: plan.localBindingHash, inputSnapshotHash: plan.inputSnapshotHash, canvasProjectId: plan.projectId, nodeId: plan.nodeId, sourceNodeId: plan.sourceNodeId, sourceResourceId: plan.sourceResourceId, inputSha256: plan.inputSha256, registeredResourceSha256: plan.registeredResourceSha256, draftVersion: readback.draftVersion, parameters: clone(plan.parameters), prompt: plan.prompt, context: clone(context) };
}

/** Official CLI adapter. No HTTP object or environment variable can grant authority.
 * verifyAuthorization and both fresh-store callbacks are mandatory for paid work.
 * Injecting any runner always labels returned evidence as an isolated fixture.
 */
export function createCanvasExecutionAdapter({ run = nativeRun, resolve = resolveExecutable, verifyAuthorization } = {}) {
  const executionMode = run === nativeRun && resolve === resolveExecutable ? 'official-dreamina-canvas' : 'isolated-fixture';
  const submitted = new Map();
  let contract = null;
  async function call(args, { signal, secret, confirmation = false, onReceipt } = {}) {
    aborted(signal);
    let result;
    try { result = await run(resolve('dreamina-canvas'), [...args, '--format', 'json', '--non-interactive'], { signal, timeoutMs: 30000 }); }
    catch (error) { throw new AppError(confirmation ? '消费确认调用失败；短期凭证未持久化，未自动继续生成。' : clean(String(error?.message ?? error), secret ? [secret] : []).slice(0, 3000), 409); }
    const response = decode(result);
    // Confirmation output is never returned or logged. Only known non-secret
    // facts are retained, even if malformed output might contain opaque material.
    const receipt = confirmation ? { command: 'dreamina-canvas node confirm', exitCode: result.exitCode, timedOut: !!result.timedOut, requestId: response?.meta?.requestId ?? null, ok: response?.ok === true, creditCeiling: response?.data?.creditCeiling ?? null, expiresAt: response?.data?.expiresAt ?? null, errorCode: response?.error?.code ?? null, executionMode } : { command: ['dreamina-canvas', ...args.filter((_, index) => index === 0 || args[index - 1] !== '--credit-token').filter(value => value !== '--credit-token')], exitCode: result.exitCode, timedOut: !!result.timedOut, response: clean(response, secret ? [secret] : []), stdout: response ? undefined : clean(result.stdout, secret ? [secret] : []), stderr: clean(result.stderr, secret ? [secret] : []), executionMode };
    const secrets = [secret, confirmation ? response?.data?.creditConfirmationToken : null].filter(value => typeof value === 'string' && value);
    const retained = clean(receipt, secrets);
    if (onReceipt) await onReceipt(retained);
    return { result, response, receipt: retained };
  }
  async function requireContract(signal) {
    if (!contract) contract = (async () => {
      const version = await call(['version'], { signal }), schema = await call(['schema'], { signal });
      if (version.result.exitCode !== 0 || version.response?.ok !== true || version.response?.data?.version !== '1.2.0' || schema.result.exitCode !== 0 || schema.response?.ok !== true) throw new AppError('执行CLI版本/Schema与已核查契约不符，未确认或生成。', 409);
      for (const [names, flags] of [[['node', 'confirm'], ['project-id', 'node-id', 'credit-ceiling']], [['node', 'run'], ['project-id', 'node-id', 'submit-id', 'credit-token']], [['node', 'show'], ['project-id', 'node-id']], [['node', 'quote'], ['project-id', 'node-id']], [['operation', 'status'], ['project-id']], [['resource', 'get'], ['project-id']], [['resource', 'download'], ['project-id', 'output']]]) {
        const entry = schemaCommand(schema.response, names);
        if (!entry || flags.some(flag => !entry.flags?.some(item => item.name === flag))) throw new AppError('实际Schema缺少所需执行或恢复参数，停止。', 409);
      }
      const status = schemaCommand(schema.response, ['operation', 'status']);
      if (status.reads !== true || status.writes !== false) throw new AppError('未核实只读原任务查询契约。', 409);
      return true;
    })().catch(error => { contract = null; throw error; });
    return contract;
  }
  async function inspectPlan(plan, { signal, onReceipt } = {}) {
    validatePlan(plan); await requireContract(signal);
    const auth = await call(['auth', 'status'], { signal, onReceipt }), space = await call(['space', 'current'], { signal, onReceipt });
    if (auth.result.exitCode !== 0 || auth.response?.ok !== true || auth.response.data?.loggedIn !== true || space.result.exitCode !== 0 || space.response?.ok !== true || space.response?.data?.kind !== 'personal') throw new AppError('当前画布认证或个人空间不可用，未批准消费。', 409);
    const shown = await call(['node', 'show', '--project-id', plan.projectId, '--node-id', plan.sourceNodeId, '--node-id', plan.nodeId], { signal, onReceipt });
    if (shown.result.exitCode !== 0 || shown.result.timedOut) throw new AppError('当前草稿回读失败，未报价或执行。', 409);
    const readback = verifyCanvasVideoReadback(plan, shown.response);
    const quoted = await call(['node', 'quote', '--project-id', plan.projectId, '--node-id', plan.nodeId], { signal, onReceipt });
    const quote = parseCanvasVideoQuote(plan, quoted.result, readback);
    if (quote.status !== 'quoted_snapshot' || !Number.isInteger(quote.amount) || quote.amount < 0 || quote.amount > canvasVideoApprovalThreshold || quote.confirmable !== true) throw new AppError(quote.amount > canvasVideoApprovalThreshold ? '最新最大预估超过70积分批准阈值，停止，未消费确认或生成。' : '没有当前同节点完整可批准报价，未知不是免费。', 409);
    const subject = quoted.response.data.consumptionSubject;
    if (typeof subject.userId !== 'string' || !subject.userId) throw new AppError('报价未返回当前个人消费身份，不能为未知账号签发绑定授权。', 409);
    const context = { region: auth.response.data.region, profile: auth.response.data.profile, consumptionSubject: { kind: 'personal' }, consumptionSubjectHash: canvasPlanHash({ kind: subject.kind, userId: subject.userId ?? null, teamId: subject.teamId ?? null }) };
    const scope = buildCanvasExecutionScope(plan, { readback, context }), authorizationBinding = { scope, scopeHash: canvasPlanHash(scope) };
    return { readback, quote, context, authorizationBinding, executionMode, actualGenerationVerified: false };
  }
  async function assertAuthority(plan, authorization, inspected, submitId, phase, callback) {
    const binding = inspected.authorizationBinding;
    if (!uuid(submitId) || !authorization || authorization.taskId !== plan.taskId || authorization.scopeHash !== binding.scopeHash || canvasPlanHash(authorization.scope) !== binding.scopeHash || authorization.approvedBy !== 'local-operator' || authorization.maxSubmissions !== 1 || !Number.isInteger(authorization.maxEstimatedCredits) || authorization.maxEstimatedCredits < inspected.quote.amount || authorization.maxEstimatedCredits > canvasVideoApprovalThreshold || !Number.isFinite(Date.parse(authorization.approvedAt)) || Date.parse(authorization.approvedAt) > Date.now() || !Number.isFinite(Date.parse(authorization.expiresAt)) || Date.parse(authorization.expiresAt) <= Date.now()) throw new AppError('缺少本人对当前完整计划的有效单次授权；本轮不消费。', 409);
    const facts = { plan: clone(plan), authorizationBinding: clone(binding), quote: clone(inspected.quote), submitId, phase, executionMode };
    if (typeof verifyAuthorization !== 'function' || !await verifyAuthorization(authorization, clone(binding), { submitId, phase, ...facts })) throw new AppError('本机可信授权校验未通过，不能凭界面请求或自报授权消费。', 409);
    if (typeof callback !== 'function' || !await callback(facts)) throw new AppError('执行前当前本地版本校验未通过，未继续消费。', 409);
  }
  async function execute({ plan, authorization, submitId, beforeConfirm, beforeRun, signal, onReceipt, markConfirmation } = {}) {
    plan = clone(plan); authorization = clone(authorization);
    validatePlan(plan);
    if (!authorization || typeof verifyAuthorization !== 'function') throw new AppError('本人尚未授权，本轮不调用消费确认或生成。', 409);
    if (typeof beforeConfirm !== 'function' || typeof beforeRun !== 'function') throw new AppError('缺少完整的当前存储复核回调，不能消费确认或生成。', 409);
    let inspected = await inspectPlan(plan, { signal, onReceipt });
    await assertAuthority(plan, authorization, inspected, submitId, 'before_confirm', beforeConfirm);
    // Re-read after an async host check; a previous snapshot cannot approve a
    // concurrently edited canvas. There is no native expected-draft flag.
    inspected = await inspectPlan(plan, { signal, onReceipt });
    await assertAuthority(plan, authorization, inspected, submitId, 'confirm', beforeConfirm);
    markConfirmation();
    const confirmed = await call(['node', 'confirm', '--project-id', plan.projectId, '--node-id', plan.nodeId, '--credit-ceiling', String(authorization.maxEstimatedCredits)], { signal, confirmation: true, onReceipt });
    let token = confirmed.response?.data?.creditConfirmationToken;
    try {
      if (confirmed.result.exitCode !== 0 || confirmed.result.timedOut || confirmed.response?.ok !== true || typeof token !== 'string' || !token || confirmed.response.data.creditCeiling !== authorization.maxEstimatedCredits || !Number.isFinite(Date.parse(confirmed.response.data.expiresAt)) || Date.parse(confirmed.response.data.expiresAt) <= Date.now()) throw new AppError('消费确认未返回有效短期凭证；未生成，原回执保留，不自动重新确认。', 409);
      inspected = await inspectPlan(plan, { signal, onReceipt });
      await assertAuthority(plan, authorization, inspected, submitId, 'before_run', beforeRun);
      inspected = await inspectPlan(plan, { signal, onReceipt });
      await assertAuthority(plan, authorization, inspected, submitId, 'run', beforeRun);
      const called = await call(['node', 'run', '--project-id', plan.projectId, '--node-id', plan.nodeId, '--submit-id', submitId, '--credit-token', token], { signal, secret: token, onReceipt });
      const raw = clean(called.response, [token]), items = called.response?.data?.items ?? called.response?.partialData?.items;
      const item = Array.isArray(items) && items.length === 1 ? items[0] : null;
      const matching = item?.nodeId === plan.nodeId && item?.submitId === submitId;
      const state = matching ? String(item.state ?? '').toUpperCase() : '';
      const status = state === 'ACCEPTED' ? 'querying' : state === 'REJECTED' ? 'fail' : 'unknown';
      return { submitId, status, resourceId: null, raw, receipt: clean(called.receipt, [token]), executionMode, ...(matching && Object.hasOwn(item, 'generationDiff') ? { generationDiff: clean(item.generationDiff, [token]) } : {}), resubmitAllowed: false, actualCost: null };
    } catch (error) { throw new AppError(clean(String(error?.message ?? error), [token]).slice(0, 3000), error?.status ?? 409); }
    finally { token = null; confirmed.response = null; confirmed.result = null; }
  }
  async function query({ plan, submitId, signal, onReceipt } = {}) {
    validatePlan(plan); if (!uuid(submitId)) throw new AppError('查询须使用已持久化的原submitId。', 409);
    await requireContract(signal);
    const called = await call(['operation', 'status', submitId, '--project-id', plan.projectId], { signal, onReceipt }), data = called.response?.data;
    if (called.result.exitCode !== 0 || called.result.timedOut || called.response?.ok !== true || data?.operationRef !== submitId) throw new AppError('原任务查询失败或身份不符；保留原submitId，不重新生成。', 409);
    const resources = data.resources, validResources = Array.isArray(resources) && resources.length === 1 && uuid(resources[0].resourceId) && resources[0].state === 'succeeded';
    const submissionConsistent = data.submission === undefined || data.submission?.state === 'completed';
    const status = data.state === 'succeeded' && validResources && submissionConsistent ? 'success' : data.state === 'failed' ? 'fail' : ['pending', 'running'].includes(data.state) ? 'querying' : 'unknown';
    let resourceEvidence = null;
    if (status === 'success') {
      const metadata = await call(['resource', 'get', resources[0].resourceId, '--project-id', plan.projectId], { signal, onReceipt });
      const resource = metadata.response?.data;
      if (metadata.result.exitCode !== 0 || metadata.result.timedOut || metadata.response?.ok !== true || resource?.resourceId !== resources[0].resourceId || resource.type !== 'video' || resource.status !== 'success') throw new AppError('原任务资源未核实为同ID成功视频，不能认定视频任务成功；保留原身份。', 409);
      resourceEvidence = clean(metadata.response);
    }
    return { submitId, status, resourceId: status === 'success' ? resources[0].resourceId : null, raw: clean(called.response), resourceEvidence, executionMode, resubmitAllowed: false, actualCost: null };
  }
  async function download({ plan, submitId, resourceId, outputPath, cwd, signal, onReceipt } = {}) {
    outputPath ??= typeof cwd === 'string' ? path.join(cwd, 'original.mp4') : null;
    if (!uuid(resourceId) || typeof outputPath !== 'string' || !path.isAbsolute(outputPath) || fs.existsSync(outputPath)) throw new AppError('下载须绑定原资源和新的绝对目标路径，不能覆盖原片。', 409);
    const current = await query({ plan, submitId, signal, onReceipt });
    if (current.status !== 'success' || current.resourceId !== resourceId) throw new AppError('原操作尚未成功或资源身份不符，只能继续查询原任务。', 409);
    const called = await call(['resource', 'download', resourceId, '--project-id', plan.projectId, '--output', outputPath], { signal, onReceipt });
    const { parseCanvasResourceDownload } = await import('./canvas-video-download.mjs');
    const file = await parseCanvasResourceDownload(called.result, { projectId: plan.projectId, resourceId, outputPath });
    return { submitId, resourceId, status: 'success', path: file.path ?? outputPath, raw: clean(called.response), executionMode, resubmitAllowed: false, actualCost: null };
  }
  function submit(input = {}) {
    if (!uuid(input.submitId)) return Promise.reject(new AppError('执行前须持久化稳定submitId。', 409));
    if (submitted.has(input.submitId)) return submitted.get(input.submitId).promise;
    // A rejection after an uncertain run may already have consumed the external
    // identity. Keep the promise; retries must query, never replay this method.
    const entry = { attempted: false, promise: null };
    entry.promise = execute({ ...input, markConfirmation: () => { entry.attempted = true; } }).catch(error => { if (!entry.attempted) submitted.delete(input.submitId); throw error; });
    submitted.set(input.submitId, entry); return entry.promise;
  }
  return { inspectPlan, submit, query, download, executionMode, canSubmit: false, authorizationRequired: true, nativeAudioDisableSupported: false };
}
