// All CLI responses in this file are isolated engineering fixtures. No provider
// process is started, no actual confirmation is requested, and no AI is invoked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createCanvasExecutionAdapter, buildCanvasExecutionScope } from '../src/canvas-execution.mjs';
import { canvasPlanHash } from '../src/canvas-video.mjs';

const RESOURCE = '11111111-1111-4111-8111-111111111111', SUBMIT = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'CREDIT-TOKEN-FIXTURE-NEVER-PERSIST';
const json = (value, exitCode = 0) => ({ stdout: JSON.stringify(value), stderr: '', exitCode });
const envelope = data => ({ schemaVersion: '1', ok: true, data, meta: { requestId: 'ISOLATED-NOT-OFFICIAL-RECEIPT' } });
function plan() { return { projectId: '7f2bee13-2e6f-4097-9281-b814c3a314a2', nodeId: 'node_ht5aaps7yz', sourceNodeId: 'node_agvq74dwqs', sourceResourceId: '3e74fdf2-d290-4979-a200-4968dea502be', inputSha256: 'a'.repeat(64), registeredResourceSha256: 'b'.repeat(64), localProjectId: '33333333-3333-4333-8333-333333333333', taskId: '44444444-4444-4444-8444-444444444444', localBindingHash: 'c'.repeat(64), inputSnapshotHash: 'd'.repeat(64), prompt: 'TEST FIXTURE / NOT AI，仅测试软件输入。', parameters: { mode: 'first_last_frame', model: 'seedance_2.0_vip', ratio: '16:9', resolution: '720p', durationSeconds: 5, outputCount: 1, audioMode: 'mute_derivative' } }; }
function schema() {
  const commands = JSON.parse(fs.readFileSync(new URL('../docs/video-prep-v08-evidence/cli-schema-excerpts.json', import.meta.url))).commands;
  const root = { subcommands: [] };
  for (const item of commands) { let current = root; for (const name of item.command.split(' ').slice(1)) { let next = current.subcommands?.find(child => child.name === name); if (!next) { next = { name, subcommands: [] }; (current.subcommands ??= []).push(next); } current = next; } Object.assign(current, item); }
  root.subcommands.find(child => child.name === 'node').subcommands.push({ name: 'show', flags: [{ name: 'project-id' }, { name: 'node-id' }] });
  return envelope(root);
}
function fixture(options = {}) {
  const p = plan(), receipts = [], calls = [], state = { version: 3, credits: 70, actor: 'PRIVATE-FIXTURE-ACCOUNT', queryError: false, queryState: 'succeeded', resourceState: 'succeeded', quoteUnknown: false, ...options.state };
  const show = () => envelope({ draftVersion: state.version, nodes: [
    { result: 'FOUND', node: { nodeId: p.sourceNodeId, type: 'image', status: 'success', resources: [{ resourceId: p.sourceResourceId, type: 'image', status: 'success' }] } },
    { result: 'FOUND', node: { nodeId: p.nodeId, type: 'video', status: 'empty', resources: [], upstreamNodeIds: [p.sourceNodeId], generation: { ...p.parameters, prompt: p.prompt, references: [{ kind: 'node', id: p.sourceNodeId, type: 'image', writebackSupported: true }] } } },
  ] });
  const run = async (_, args) => {
    calls.push([...args]); if (options.beforeCommand) await options.beforeCommand(args, state);
    if (args[0] === 'version') return json(envelope({ version: state.cliVersion ?? '1.2.0' }));
    if (args[0] === 'schema') return json(schema());
    if (args[0] === 'auth') return json(envelope({ loggedIn: true, region: 'cn', profile: 'default' }));
    if (args[0] === 'space') return json(envelope({ kind: 'personal' }));
    if (args[1] === 'show') return json(show());
    if (args[1] === 'quote') return json(envelope({ consumptionSubject: { kind: 'personal', userId: state.actor }, items: [{ nodeId: p.nodeId, ...(state.quoteUnknown ? {} : { maxCredits: state.credits }) }], totalMaxCredits: state.credits, draftVersion: state.version, confirmable: true, confirmationRequired: true }));
    if (args[1] === 'confirm') { if (options.confirm) return options.confirm(args, state); return json(envelope({ creditConfirmationToken: TOKEN, creditCeiling: 70, expiresAt: new Date(Date.now() + 60000).toISOString() })); }
    if (args[1] === 'run') { if (options.submit) return options.submit(args, state); return json(envelope({ items: [{ nodeId: p.nodeId, submitId: SUBMIT, state: 'ACCEPTED', resources: [] }] })); }
    if (args[0] === 'operation') { if (options.query) return options.query(args, state); if (state.queryError) return json({ ok: false, error: { code: 'fixture.network' } }, 1); return json(envelope({ operationRef: SUBMIT, state: state.queryState, resources: state.noResources ? [] : [{ resourceId: RESOURCE, state: state.resourceState }], submission: { state: state.submissionState ?? 'completed', resubmittable: false } })); }
    if (args[0] === 'resource' && args[1] === 'get') return json(envelope({ resourceId: state.metadataResourceId ?? RESOURCE, type: state.metadataType ?? 'video', status: state.metadataStatus ?? 'success' }));
    if (args[0] === 'resource') { if (options.download) return options.download(args, state); throw new Error('No fixture download configured'); }
    throw new Error('Unexpected fixture-only command ' + args.slice(0, 2).join(' '));
  };
  const adapter = createCanvasExecutionAdapter({ run, resolve: () => 'NOT-A-REAL-CLI', ...(options.noVerifier ? {} : { verifyAuthorization: options.verify ?? (async grant => grant) }) });
  const count = name => calls.filter(args => args[1] === name).length;
  const grant = async () => { const view = await adapter.inspectPlan(p); return { id: randomUUID(), taskId: p.taskId, ...view.authorizationBinding, approvedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), maxEstimatedCredits: 70, maxSubmissions: 1, approvedBy: 'local-operator' }; };
  const submit = async authorization => adapter.submit({ plan: p, authorization, submitId: SUBMIT, beforeConfirm: async () => true, beforeRun: async () => true, onReceipt: receipt => { receipts.push(receipt); } });
  return { p, state, adapter, calls, receipts, count, grant, submit };
}

test('无本人授权或无可信核验回调时，任何自报grant都不会发起CLI消费命令', async () => {
  const ctx = fixture(); await assert.rejects(ctx.submit(null), /尚未授权/); assert.equal(ctx.calls.length, 0);
  const noVerifier = fixture({ noVerifier: true }); await assert.rejects(noVerifier.submit({ approvedBy: 'local-operator', canSubmit: true }), /尚未授权/); assert.equal(noVerifier.calls.length, 0);
  const authorized = fixture(), grant = await authorized.grant(); await assert.rejects(authorized.adapter.submit({ plan: authorized.p, authorization: grant, submitId: SUBMIT, beforeConfirm: async () => true }), /复核回调/); assert.equal(authorized.count('confirm'), 0);
});

test('绑定完整scope的隔离批准才confirm/run；token只内存且每层回执无短期凭证', async () => {
  const ctx = fixture(), authorization = await ctx.grant(), result = await ctx.submit(authorization);
  assert.equal(result.status, 'querying'); assert.equal(result.submitId, SUBMIT); assert.equal(result.executionMode, 'isolated-fixture'); assert.equal(result.actualCost, null);
  assert.equal(ctx.count('confirm'), 1); assert.equal(ctx.count('run'), 1); assert.ok(ctx.calls.find(args => args[1] === 'run').includes(TOKEN));
  assert.equal(JSON.stringify(ctx.receipts).includes(TOKEN), false); assert.equal(JSON.stringify(result).includes(TOKEN), false); assert.equal(JSON.stringify(ctx.receipts).includes(ctx.state.actor), false);
  const command = result.receipt.command; assert.equal(command.includes('--credit-token'), false); assert.ok(command.includes(SUBMIT));
  assert.equal(authorization.scope.canvasProjectId, ctx.p.projectId); assert.equal(authorization.scope.localProjectId, ctx.p.localProjectId); assert.equal(authorization.scope.registeredResourceSha256, ctx.p.registeredResourceSha256); assert.equal(authorization.scope.draftVersion, 3);
});

test('报价超70、缺失完整报价或过期/错Hash授权均在confirm之前阻断', async () => {
  for (const change of [state => { state.credits = 71; }, state => { state.quoteUnknown = true; }]) { const ctx = fixture(), authorization = await ctx.grant(); change(ctx.state); await assert.rejects(ctx.submit(authorization), /70|报价/); assert.equal(ctx.count('confirm'), 0); assert.equal(ctx.count('run'), 0); }
  for (const change of [grant => { grant.expiresAt = '2000-01-01'; }, grant => { grant.scope.inputSha256 = 'f'.repeat(64); }, grant => { grant.maxEstimatedCredits = 100; }, grant => { grant.maxSubmissions = 2; }]) { const ctx = fixture(), authorization = await ctx.grant(); change(authorization); await assert.rejects(ctx.submit(authorization), /有效单次授权/); assert.equal(ctx.count('confirm'), 0); }
});

test('输入/草稿/账号变化不能复用授权，合法quote请求ID刷新不改变scope', async () => {
  for (const change of [ctx => { ctx.p.localBindingHash = 'f'.repeat(64); }, ctx => { ctx.p.inputSnapshotHash = 'f'.repeat(64); }, ctx => { ctx.p.registeredResourceSha256 = 'f'.repeat(64); }, ctx => { ctx.state.version++; }, ctx => { ctx.state.actor = 'OTHER-ACCOUNT'; }]) { const ctx = fixture(), authorization = await ctx.grant(); change(ctx); await assert.rejects(ctx.submit(authorization), /有效单次授权/); assert.equal(ctx.count('confirm'), 0); }
  const ctx = fixture(); const a = await ctx.adapter.inspectPlan(ctx.p), b = await ctx.adapter.inspectPlan(ctx.p); assert.equal(a.authorizationBinding.scopeHash, b.authorizationBinding.scopeHash); assert.deepEqual(buildCanvasExecutionScope(ctx.p, a), a.authorizationBinding.scope);
});

test('异步本地复核及消费确认期间草稿改变，原token不会用于run', async () => {
  let ctx = fixture(), authorization = await ctx.grant();
  await assert.rejects(ctx.adapter.submit({ plan: ctx.p, authorization, submitId: SUBMIT, beforeConfirm: async () => { ctx.state.version++; return true; }, beforeRun: async () => true }), /有效单次授权/); assert.equal(ctx.count('confirm'), 0);
  ctx = fixture({ confirm: async (_, state) => { state.version++; return json(envelope({ creditConfirmationToken: TOKEN, creditCeiling: 70, expiresAt: new Date(Date.now() + 60000).toISOString() })); } }); authorization = await ctx.grant();
  await assert.rejects(ctx.submit(authorization), /有效单次授权/); assert.equal(ctx.count('confirm'), 1); assert.equal(ctx.count('run'), 0); assert.equal(JSON.stringify(ctx.receipts).includes(TOKEN), false);
});

test('beforeConfirm后末次网络报价期间本地稿变化，最终真实本地回调仍阻断confirm', async () => {
  let quoteCount = 0, localCurrent = true;
  const ctx = fixture({ beforeCommand: async args => { if (args[1] === 'quote' && ++quoteCount === 3) localCurrent = false; } }), authorization = await ctx.grant();
  await assert.rejects(ctx.adapter.submit({ plan: ctx.p, authorization, submitId: SUBMIT, beforeConfirm: async () => { if (!localCurrent) throw new Error('末次报价期间人工稿变化'); return true; }, beforeRun: async () => true }), /人工稿变化/);
  assert.equal(ctx.count('confirm'), 0); assert.equal(ctx.count('run'), 0);
});

test('confirm后beforeRun末次网络报价期间本地稿变化，最终真实回调阻断run', async () => {
  let quoteCount = 0, localCurrent = true;
  const ctx = fixture({ beforeCommand: async args => { if (args[1] === 'quote' && ++quoteCount === 5) localCurrent = false; } }), authorization = await ctx.grant();
  await assert.rejects(ctx.adapter.submit({ plan: ctx.p, authorization, submitId: SUBMIT, beforeConfirm: async () => true, beforeRun: async () => { if (!localCurrent) throw new Error('末次报价期间选用变化'); return true; } }), /选用变化/);
  assert.equal(ctx.count('confirm'), 1); assert.equal(ctx.count('run'), 0);
});

test('本地最终校验拒绝、取消或CLI契约变更，不消费生成也不伪造模型资格', async () => {
  const ctx = fixture(), authorization = await ctx.grant();
  await assert.rejects(ctx.adapter.submit({ plan: ctx.p, authorization, submitId: SUBMIT, beforeConfirm: async () => true, beforeRun: async () => { throw new Error('人工稿版本变更'); } }), /人工稿/); assert.equal(ctx.count('run'), 0);
  const other = fixture({ state: { cliVersion: 'unverified-release' } }); await assert.rejects(other.adapter.inspectPlan(other.p), /版本/); assert.equal(other.count('confirm'), 0);
  const cancelled = fixture(), cancelGrant = await cancelled.grant(), controller = new AbortController(); controller.abort(); await assert.rejects(cancelled.adapter.submit({ plan: cancelled.p, authorization: cancelGrant, submitId: SUBMIT, beforeConfirm: async () => true, beforeRun: async () => true, signal: controller.signal }), /取消/); assert.equal(cancelled.count('confirm'), 0);
});

test('重复和并发submit共享同一原身份；不重复confirm/run，不因fixture自报提升官方', async () => {
  const ctx = fixture(), authorization = await ctx.grant(); const a = ctx.submit(authorization), b = ctx.submit(authorization); await Promise.all([a, b]); await ctx.submit(authorization);
  assert.equal(ctx.count('confirm'), 1); assert.equal(ctx.count('run'), 1); assert.equal(ctx.adapter.executionMode, 'isolated-fixture'); assert.equal(ctx.adapter.canSubmit, false);
});

test('run结果未知保留原submitId；重试调用不重提，stderr回显token也不进入日志或错误', async () => {
  const ctx = fixture({ submit: async () => ({ exitCode: 1, stdout: 'invalid output', stderr: 'tool echoed ' + TOKEN }) }), authorization = await ctx.grant();
  const result = await ctx.submit(authorization); assert.equal(result.status, 'unknown'); assert.equal(result.submitId, SUBMIT); assert.equal(result.resubmitAllowed, false); await ctx.submit(authorization); assert.equal(ctx.count('run'), 1); assert.equal(JSON.stringify([...ctx.receipts, result]).includes(TOKEN), false);
  const thrown = fixture({ submit: async () => { throw new Error('callback failed ' + TOKEN); } }), grant = await thrown.grant(); await assert.rejects(thrown.submit(grant), error => { assert.equal(error.message.includes(TOKEN), false); return true; }); await assert.rejects(thrown.submit(grant)); assert.equal(thrown.count('run'), 1);
});

test('官方未返回generationDiff时不补null；显式null或差异原样分层保留，不虚构实际参数回执', async () => {
  const missing = fixture(), grant = await missing.grant(), result = await missing.submit(grant);
  assert.equal(Object.hasOwn(result, 'generationDiff'), false);
  for (const generationDiff of [null, [{ fieldPath: 'durationSeconds', from: '5', to: '4' }]]) {
    const ctx = fixture({ submit: async () => json(envelope({ items: [{ nodeId: plan().nodeId, submitId: SUBMIT, state: 'ACCEPTED', resources: [], generationDiff }] })) }), approval = await ctx.grant();
    const received = await ctx.submit(approval); assert.equal(Object.hasOwn(received, 'generationDiff'), true); assert.deepEqual(received.generationDiff, generationDiff);
  }
});

test('原ID查询失败仅查原任务，官方终态与单一成功资源都必需，absent不能授权重提', async () => {
  const ctx = fixture({ state: { queryError: true } }); await assert.rejects(ctx.adapter.query({ plan: ctx.p, submitId: SUBMIT }), /原任务查询失败/);
  ctx.state.queryError = false; const result = await ctx.adapter.query({ plan: ctx.p, submitId: SUBMIT }); assert.equal(result.status, 'success'); assert.equal(result.resourceId, RESOURCE); assert.equal(ctx.count('run'), 0); assert.equal(ctx.count('confirm'), 0);
  for (const change of [state => { state.noResources = true; }, state => { state.resourceState = 'running'; }, state => { state.submissionState = 'absent'; }, state => { state.submissionState = 'in_progress'; }, state => { state.queryState = 'unknown'; }]) { const other = fixture(); change(other.state); const pending = await other.adapter.query({ plan: other.p, submitId: SUBMIT }); assert.equal(pending.status, 'unknown'); assert.equal(pending.resourceId, null); assert.equal(pending.resubmitAllowed, false); }
});

test('查询成功须资源get核原ID/type=video/status=success，图片或矛盾资源不能成为视频成功', async () => {
  for (const state of [{ metadataType: 'image' }, { metadataStatus: 'running' }, { metadataResourceId: '55555555-5555-4555-8555-555555555555' }]) { const ctx = fixture({ state }); await assert.rejects(ctx.adapter.query({ plan: ctx.p, submitId: SUBMIT }), /同ID成功视频/); assert.equal(ctx.count('confirm'), 0); assert.equal(ctx.count('run'), 0); }
  const ctx = fixture(), result = await ctx.adapter.query({ plan: ctx.p, submitId: SUBMIT }); assert.equal(result.resourceEvidence.data.type, 'video'); assert.equal(result.resourceEvidence.data.resourceId, RESOURCE);
});

test('下载失败只恢复同资源下载，实际既有TEST MP4文件/Hash必需且不重新生成', async () => {
  const root = path.resolve('tests/.artifacts'); fs.mkdirSync(root, { recursive: true }); const directory = fs.mkdtempSync(path.join(root, 'canvas-exec-download-'));
  const source = new URL('../docs/video-v07-evidence/TEST-FIXTURE-NOT-AI.mp4', import.meta.url), bytes = fs.readFileSync(source), sha256 = createHash('sha256').update(bytes).digest('hex'); let attempts = 0;
  const ctx = fixture({ download: async args => { attempts++; if (attempts === 1) return json({ ok: false, error: { code: 'fixture.download_network' } }, 1); const output = args[args.indexOf('--output') + 1]; fs.writeFileSync(output, bytes, { flag: 'wx' }); return json(envelope({ resourceId: RESOURCE, path: output, size: bytes.length, sha256 })); } });
  await assert.rejects(ctx.adapter.download({ plan: ctx.p, submitId: SUBMIT, resourceId: RESOURCE, outputPath: path.join(directory, 'attempt-1.mp4') }), /下载未返回/);
  const secondDirectory = path.join(directory, 'attempt-2'); fs.mkdirSync(secondDirectory);
  const result = await ctx.adapter.download({ plan: ctx.p, submitId: SUBMIT, resourceId: RESOURCE, cwd: secondDirectory }); assert.equal(result.status, 'success'); assert.equal(result.resourceId, RESOURCE); assert.equal(path.basename(result.path), 'original.mp4'); assert.equal(createHash('sha256').update(fs.readFileSync(result.path)).digest('hex'), sha256); assert.equal(ctx.count('run'), 0); assert.equal(ctx.count('confirm'), 0); assert.equal(attempts, 2);
  await assert.rejects(ctx.adapter.download({ plan: ctx.p, submitId: SUBMIT, resourceId: RESOURCE, outputPath: result.path }), /不能覆盖/); assert.equal(attempts, 2);
});

test('无效消费确认不泄露原始凭证、不给run，并保留可审计非敏感错误', async () => {
  const ctx = fixture({ confirm: async () => json(envelope({ creditConfirmationToken: TOKEN, creditCeiling: 100, expiresAt: TOKEN })) }), authorization = await ctx.grant();
  await assert.rejects(ctx.submit(authorization), /未返回有效短期凭证/); assert.equal(ctx.count('run'), 0); assert.equal(JSON.stringify(ctx.receipts).includes(TOKEN), false); await assert.rejects(ctx.submit(authorization)); assert.equal(ctx.count('confirm'), 1);
});
