// Fault injection only. No Codex process, model turn or image generator is run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createImageGuard } from '../src/codex-image-guard.mjs';
import { createImageWatchdog } from '../src/codex-image-watchdog.mjs';
import { failedImageReceipt } from '../src/codex-image-runner.mjs';
import { testPng } from './image-fixtures.mjs';

const base = path.resolve('tests/.artifacts'); fs.mkdirSync(base, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(base, 'watchdog-no-generation-'));
  const guard = createImageGuard({ directory: path.join(directory, 'fixture-guard'), prompt: '隔离故障注入，不调用图像工具。' });
  const calls = [], rpc = { request(method, params) { calls.push({ method, params }); return method === 'turn/start' ? options.start?.() ?? Promise.resolve({ turn: { id: 'fixture-turn' } }) : options.interrupt?.() ?? Promise.resolve({}); } };
  const watcher = createImageWatchdog({ rpc, threadId: 'fixture-thread', guard, hookTimeoutMs: options.hookTimeoutMs ?? 10000, onBoundEvent: options.onBoundEvent });
  t.after(() => watcher.dispose()); return { directory, guard, calls, watcher };
}
const hook = (method, { id = 'fixture-hook', status = method === 'hook/started' ? 'running' : 'completed', text = null, turnId = 'fixture-turn', threadId = 'fixture-thread' } = {}) => ({ method, params: { threadId, ...(turnId === undefined ? {} : { turnId }), run: { id, eventName: 'preToolUse', handlerType: 'command', executionMode: 'sync', status, entries: text ? [{ kind: 'error', text }] : [] } } });
const image = (method, file = null, id = 'fixture-image') => ({ method, params: { threadId: 'fixture-thread', turnId: 'fixture-turn', item: { type: 'imageGeneration', id, status: method === 'item/completed' ? 'completed' : 'inProgress', ...(file ? { savedPath: file } : {}) } } });
const complete = () => ({ method: 'turn/completed', params: { threadId: 'fixture-thread', turn: { id: 'fixture-turn', status: 'completed' } } });
async function processFault(directory, mode) {
  const script = path.join(directory, 'fixture-command.mjs');
  if (mode === 'timeout') fs.writeFileSync(script, 'setTimeout(()=>{},60000);');
  if (mode === 'invalid_output') fs.writeFileSync(script, 'process.stdout.write("NOT_VALID_HOOK_JSON");');
  const executable = mode === 'startup_failure' ? path.join(directory, 'missing-program.exe') : process.execPath;
  return new Promise(resolve => {
    const child = spawn(executable, [script], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', resolved = false, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, mode === 'timeout' ? 70 : 5000);
    const finish = result => { if (resolved) return; resolved = true; clearTimeout(timer); resolve(result); };
    child.stdout.on('data', value => out += value); child.stderr.on('data', value => err += value);
    child.on('error', error => finish({ failure: `hook startup failed: ${error.code}`, exitCode: null }));
    child.on('close', code => finish({ failure: timedOut ? 'hook timed out' : mode === 'invalid_output' ? 'hook output invalid JSON' : `hook script missing: exit ${code}`, exitCode: code, output: out, stderr: err }));
  });
}

for (const mode of ['startup_failure', 'timeout', 'invalid_output', 'script_missing']) {
  test(`无生成的真实本地进程故障 ${mode}：hook失败事件立即请求中断，保留错误和迟到原图`, async t => {
    const f = fixture(t); await f.watcher.startTurn({ input: [{ type: 'text', text: 'FAKE RPC ONLY' }] });
    f.watcher.event(hook('hook/started'));
    const fault = await processFault(f.directory, mode);
    f.watcher.event(hook('hook/completed', { status: 'failed', text: fault.failure }));
    // No turn/completed has been emitted yet: interruption cannot wait for it.
    assert.equal(f.calls.filter(call => call.method === 'turn/interrupt').length, 1);
    await assert.rejects(f.watcher.waitForTurn(), /PreToolUse未通过/);
    assert.throws(() => f.watcher.throwIfFailed());
    const before = f.watcher.snapshot(); assert.equal(before.counts.actualImageToolCalls, null); assert.equal(before.counts.observedImageToolStarts, 0);
    assert.equal(before.strictSingleCallGuaranteed, false); assert.equal(before.counts.modelTurnRequests, 1);
    const file = path.join(f.directory, 'LATE-TEST-FIXTURE-NOT-AI.png'); fs.writeFileSync(file, testPng());
    f.watcher.event(image('item/started')); f.watcher.event(image('item/completed', file)); f.watcher.event(complete());
    await f.watcher.settleInterrupt(); const after = f.watcher.snapshot();
    assert.equal(after.firstFailure.code, 'hook_failed'); assert.equal(after.counts.observedImageToolCompletions, 1); assert.equal(after.interrupt.status, 'acknowledged');
    assert.equal(after.protectionVerified, false); assert.equal(f.calls.filter(call => call.method === 'turn/start').length, 1);
    const receipt = failedImageReceipt({ error: after.firstFailure.reason, imageGeneration: image('item/completed', file).params.item, threadId: 'fixture-thread', turnId: 'fixture-turn', turnCompleted: true, executionDiagnostics: after });
    assert.equal(receipt.completed, false); assert.equal(receipt.turnCompleted, true); assert.equal(receipt.images[0].path, file); assert.equal(receipt.images[0].verified, false);
    assert.equal(receipt.executionDiagnostics.firstFailure.code, 'hook_failed');
  });
}

test('hook不发完成事件时观察器本地超时，不等turn结束、不自动重提', async t => {
  const f = fixture(t, { hookTimeoutMs: 15 }); await f.watcher.startTurn({ input: [] });
  f.watcher.event(hook('hook/started')); await assert.rejects(f.watcher.waitForTurn(), /PreToolUse完成超时/);
  await f.watcher.settleInterrupt(); assert.equal(f.watcher.snapshot().firstFailure.code, 'hook_timeout');
  assert.equal(f.calls.filter(call => call.method === 'turn/interrupt').length, 1);
  await assert.rejects(f.watcher.startTurn({ input: [] }), /PreToolUse完成超时/);
  assert.equal(f.calls.filter(call => call.method === 'turn/start').length, 1);
});

test('脚本在提交前缺失：本地拒绝turn/start，缺少实际工具事件保持未知', async t => {
  const f = fixture(t); fs.unlinkSync(f.guard.scriptPath);
  await assert.rejects(f.watcher.startTurn({ input: [] }), /ENOENT|缺失/);
  assert.equal(f.calls.length, 0); assert.equal(f.watcher.snapshot().counts.modelTurnRequests, 0);
  assert.equal(f.watcher.snapshot().counts.actualImageToolCalls, null);
});

test('hook开始后脚本丢失或准许输出缺失：及时中断，不等图片或turn终态', async t => {
  const a = fixture(t); await a.watcher.startTurn({ input: [] }); fs.unlinkSync(a.guard.scriptPath);
  a.watcher.event(hook('hook/started')); assert.equal(a.calls.at(-1).method, 'turn/interrupt');
  const b = fixture(t); await b.watcher.startTurn({ input: [] }); b.watcher.event(hook('hook/started'));
  b.watcher.event(hook('hook/completed')); assert.equal(b.calls.at(-1).method, 'turn/interrupt');
  assert.equal(b.watcher.snapshot().firstFailure.code, 'allow_evidence_missing');
});

test('重复/并发start请求复用一次假RPC意图，不给应用提交次数伪造工具次数', async t => {
  let finish; const f = fixture(t, { start: () => new Promise(resolve => { finish = resolve; }) });
  const a = f.watcher.startTurn({ input: [] }), b = f.watcher.startTurn({ input: [] }); assert.equal(a, b);
  finish({ turn: { id: 'fixture-turn' } }); await Promise.all([a, b]);
  assert.equal(f.calls.filter(call => call.method === 'turn/start').length, 1);
  assert.equal(f.watcher.snapshot().counts.modelTurnsStarted, 1); assert.equal(f.watcher.snapshot().counts.actualImageToolCalls, null);
});

test('重复同ID通知不当作第二次调用；不同hook并发尝试立即中断一次', async t => {
  const f = fixture(t); await f.watcher.startTurn({ input: [] });
  f.watcher.event(hook('hook/started')); f.watcher.event(hook('hook/started'));
  assert.equal(f.watcher.snapshot().firstFailure, null);
  f.watcher.event(hook('hook/started', { id: 'second-hook' }));
  f.watcher.event(hook('hook/completed', { id: 'second-hook', status: 'failed', text: 'repeat denied' }));
  await f.watcher.settleInterrupt(); assert.equal(f.calls.filter(call => call.method === 'turn/interrupt').length, 1);
  assert.equal(f.watcher.snapshot().firstFailure.code, 'repeated_hook_attempt');
});

test('外部thread/turn不归给本次任务；缺turnId时不补造，收到真实ack后再中断', async t => {
  let finish; const f = fixture(t, { start: () => new Promise(resolve => { finish = resolve; }) });
  const starting = f.watcher.startTurn({ input: [] });
  f.watcher.event(hook('hook/completed', { threadId: 'other-thread', status: 'failed', text: 'irrelevant' }));
  assert.equal(f.watcher.snapshot().firstFailure, null);
  const missing = hook('hook/completed', { status: 'failed', text: 'known fault' }); delete missing.params.turnId;
  f.watcher.event(missing); await assert.rejects(starting, /缺少turn引用/);
  assert.equal(f.calls.filter(call => call.method === 'turn/interrupt').length, 0);
  finish({ turn: { id: 'fixture-turn' } }); await sleep(0); await f.watcher.settleInterrupt();
  assert.deepEqual(f.calls.at(-1), { method: 'turn/interrupt', params: { threadId: 'fixture-thread', turnId: 'fixture-turn' } });
  f.watcher.event(hook('hook/completed', { turnId: 'foreign-turn', status: 'failed', text: 'irrelevant' }));
  assert.equal(f.calls.filter(call => call.method === 'turn/interrupt').length, 1);
});

test('中断失败不改保护错误、不宣称已取消，图像事件可在失败后继续记录', async t => {
  const f = fixture(t, { interrupt: () => Promise.reject(new Error('interrupt request timed out')) });
  await f.watcher.startTurn({ input: [] }); f.watcher.event(hook('hook/started'));
  f.watcher.event(hook('hook/completed', { status: 'failed', text: 'invalid hook output' }));
  await f.watcher.settleInterrupt(); const state = f.watcher.snapshot();
  assert.equal(state.firstFailure.code, 'hook_failed'); assert.equal(state.interrupt.status, 'failed');
  assert.match(state.interrupt.error, /timed out/); assert.equal(state.strictSingleCallGuaranteed, false);
  f.watcher.event(image('item/started')); f.watcher.event(image('item/started', null, 'second-image'));
  assert.equal(f.watcher.snapshot().counts.observedImageToolStarts, 2);
});

test('未知RPC输出及图像先于准许证据会及时请求中断，状态不升级', async t => {
  const a = fixture(t); await a.watcher.startTurn({ input: [] });
  a.watcher.event({ method: 'connector/protocolError', params: { error: 'fixture malformed JSON' } });
  assert.equal(a.calls.at(-1).method, 'turn/interrupt'); assert.equal(a.watcher.snapshot().firstFailure.code, 'rpc_invalid_output');
  const b = fixture(t); await b.watcher.startTurn({ input: [] }); b.watcher.event(image('item/started'));
  assert.equal(b.calls.at(-1).method, 'turn/interrupt'); assert.equal(b.watcher.snapshot().firstFailure.code, 'image_without_allow_evidence');
});

test('有效本地无生成hook和伪工具项可完成观察；仍不宣称严格次数保护已验证', async t => {
  const f = fixture(t); await f.watcher.startTurn({ input: [] }); f.watcher.event(hook('hook/started'));
  const decision = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [f.guard.scriptPath], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', value => stdout += value); child.stderr.on('data', value => stderr += value);
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
    child.stdin.end(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'image_genimagegen', tool_use_id: 'fixture-image', tool_input: {} }));
  });
  assert.equal(decision.hookSpecificOutput.permissionDecision, 'allow');
  f.watcher.event(hook('hook/completed'));
  f.watcher.event(image('item/started')); f.watcher.event(image('item/started'));
  f.watcher.event(image('item/completed')); f.watcher.event(image('item/completed')); f.watcher.event(complete());
  await f.watcher.waitForTurn(); const state = f.watcher.snapshot();
  assert.equal(state.firstFailure, null); assert.equal(state.counts.observedImageToolStarts, 1); assert.equal(state.counts.observedImageToolCompletions, 1);
  assert.equal(state.strictSingleCallGuaranteed, false); assert.equal(state.protectionVerified, false);
  assert.equal(f.calls.filter(call => call.method === 'turn/interrupt').length, 0);
});

test('turn/start超时或回执缺ID不补造模型启动成功，不重提且实际工具次数未知', async t => {
  for (const start of [() => Promise.reject(new Error('turn/start fixture timeout')), () => Promise.resolve({ turn: {} })]) {
    const f = fixture(t, { start }); await assert.rejects(f.watcher.startTurn({ input: [] }), /timeout|ID/);
    const state = f.watcher.snapshot(); assert.equal(state.counts.modelTurnRequests, 1); assert.equal(state.counts.modelTurnsStarted, 0);
    assert.equal(state.counts.actualImageToolCalls, null); assert.equal(state.interrupt.status, 'not_sent');
    await assert.rejects(f.watcher.startTurn({ input: [] })); assert.equal(f.calls.length, 1);
  }
});

test('ACK前后同thread的foreign-turn只留原流，不污染本次图片/终态/usage或turn计数', async t => {
  let finish; const collected = [], f = fixture(t, { start: () => new Promise(resolve => { finish = resolve; }), onBoundEvent: value => collected.push(value) });
  const starting = f.watcher.startTurn({ input: [] });
  const foreign = value => { const other = structuredClone(value); if (other.params.turn) other.params.turn.id = 'foreign-turn'; else other.params.turnId = 'foreign-turn'; return other; };
  const usage = turnId => ({ method: 'thread/tokenUsage/updated', params: { threadId: 'fixture-thread', ...(turnId ? { turnId } : {}), tokenUsage: { total: { totalTokens: 123 } } } });
  for (const value of [foreign(image('item/completed')), foreign(complete()), usage('foreign-turn')]) f.watcher.event(value);
  assert.equal(f.watcher.snapshot().counts.modelTurnsStarted, 0); assert.equal(f.watcher.snapshot().counts.observedImageToolCompletions, 0); assert.equal(collected.length, 0);
  finish({ turn: { id: 'fixture-turn' } }); await starting;
  assert.equal(f.watcher.boundTurnId(), 'fixture-turn'); assert.equal(f.watcher.snapshot().firstFailure, null); assert.equal(collected.length, 0);
  for (const value of [foreign(image('item/completed')), foreign(complete()), usage('foreign-turn'), usage(null)]) f.watcher.event(value);
  assert.equal(collected.length, 0); assert.equal(f.watcher.snapshot().counts.observedImageToolCompletions, 0);
  // Matching events remain available to the runner callback, including late
  // originals after a protection fault; no foreign image becomes its receipt.
  f.watcher.fail('fixture_fault', 'intentional local fault'); f.watcher.event(image('item/completed')); f.watcher.event(usage('fixture-turn')); f.watcher.event(complete());
  assert.equal(collected.length, 3); assert.equal(collected[0].params.item.id, 'fixture-image'); assert.equal(collected[2].params.turn.id, 'fixture-turn');
  assert.equal(f.watcher.snapshot().counts.modelTurnsStarted, 1); assert.equal(f.watcher.snapshot().counts.observedImageToolCompletions, 1); assert.equal(f.watcher.snapshot().firstFailure.code, 'fixture_fault');
});
