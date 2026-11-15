import fs from 'node:fs';
import { verifyImageGuard } from './codex-image-guard.mjs';
import { redact } from './tools.mjs';

const clone = value => structuredClone(value);
const errorText = value => redact(String(value?.message ?? value ?? '执行保护故障')).slice(0, 4000);

/**
 * Observes the official event stream and requests interruption on the first
 * protection fault. This is an asynchronous damage-limitation mechanism, NOT
 * an atomic authorization boundary or a guarantee of one provider request.
 * It never opens an RPC connection and cannot enable the disabled connector.
 */
export function createImageWatchdog({ rpc, threadId, guard, hookTimeoutMs = 11000, interruptTimeoutMs = 3000, onDiagnostic = () => {}, onBoundEvent = () => {}, verifyGuard = verifyImageGuard } = {}) {
  if (!rpc?.request || typeof threadId !== 'string' || !threadId) throw new Error('执行观察器必须绑定已核实会话。');
  let turnId = null, turnRequest = null, failed = null, interrupt = null, disposed = false, finished = false;
  const hooks = new Map(), imageStarts = new Set(), imageCompletions = new Set(), startedTurns = new Set();
  const diagnostics = [], completedImages = [], awaitingTurnAck = [];
  let turnRequests = 0, terminalResolve, terminalReject, failureReject;
  const terminal = new Promise((resolve, reject) => { terminalResolve = resolve; terminalReject = reject; });
  const failure = new Promise((_, reject) => { failureReject = reject; });
  terminal.catch(() => {}); failure.catch(() => {});
  const record = (type, detail = {}) => {
    const entry = { at: new Date().toISOString(), type, ...clone(detail) };
    diagnostics.push(entry);
    try { onDiagnostic(clone(entry)); } catch { /* Diagnostics must not suppress interruption. */ }
    return entry;
  };
  const clearHooks = () => { for (const hook of hooks.values()) clearTimeout(hook.timer); };
  const requestInterrupt = () => {
    if (!failed || !turnId || interrupt || disposed) return;
    record('interrupt.requested', { threadId, turnId, asynchronous: true, cannotGuaranteeAlreadyStartedCallStopped: true });
    // Mark synchronously before invoking RPC, preventing duplicate/concurrent requests.
    const state = { status: 'requested', threadId, turnId, startedAt: new Date().toISOString() };
    interrupt = { state, promise: null };
    let request;
    try { request = rpc.request('turn/interrupt', { threadId, turnId }, interruptTimeoutMs); }
    catch (error) { request = Promise.reject(error); }
    interrupt.promise = Promise.resolve(request).then(() => {
      state.status = 'acknowledged';
      record('interrupt.acknowledged', { threadId, turnId, doesNotProveToolCancellation: true });
    }, error => {
      state.status = 'failed'; state.error = errorText(error);
      record('interrupt.failed', { threadId, turnId, error: state.error, serverExecutionUnknown: true });
    });
  };
  const fail = (code, reason, detail = {}) => {
    if (disposed) return;
    if (!failed) {
      failed = { code, reason: errorText(reason), at: new Date().toISOString(), ...clone(detail) };
      record('protection.failed', failed); clearHooks();
      const error = Object.assign(new Error(failed.reason), { code: failed.code });
      failureReject(error); terminalReject(error);
    } else record('protection.additional_fault', { code, reason: errorText(reason), ...detail });
    requestInterrupt();
  };
  const setTurn = id => {
    if (typeof id !== 'string' || !id) return;
    if (turnId && turnId !== id) { fail('turn_mismatch', '执行事件与本次turn不一致。'); return; }
    turnId = id; startedTurns.add(id); requestInterrupt();
  };
  const validateGuard = () => {
    try { if (!guard || !verifyGuard(guard)) throw new Error('私有hook脚本或manifest缺失、改变或不可读。'); }
    catch (error) { fail('guard_unavailable', error); return false; }
    return true;
  };
  const readAllowEvidence = () => {
    if (!validateGuard()) return null;
    try {
      const marker = JSON.parse(fs.readFileSync(guard.markerPath, 'utf8'));
      const log = fs.readFileSync(guard.logPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
      const allow = log.filter(entry => entry.allowed === true);
      if (marker.toolName !== 'image_genimagegen' || !marker.toolUseId || marker.manifestHash !== guard.manifestHash || allow.length !== 1 || allow[0].toolUseId !== marker.toolUseId || allow[0].manifestHash !== marker.manifestHash) throw new Error('私有hook准许证据不完整或与实际工具引用不一致。');
      return marker;
    } catch (error) { fail('allow_evidence_missing', error); return null; }
  };
  const event = value => {
    if (disposed || !value || typeof value !== 'object') return;
    const p = value.params ?? {};
    if (p.threadId && p.threadId !== threadId) return;
    if (value.method === 'connector/protocolError') { fail('rpc_invalid_output', p.error ?? '官方RPC输出无效，不能继续验收。'); return; }
    if (value.method === 'connector/requestWriteStatus' && p.status === 'failed') { fail('rpc_write_failed', p.error ?? '官方RPC写入失败，发送状态未知。'); return; }
    if (value.method === 'connector/processClosed') {
      if (!finished) fail('process_closed', `官方进程结束，退出码${p.exitCode ?? '未知'}；服务端是否仍执行未知。`);
      return;
    }
    const relevant = ['hook/started', 'hook/completed', 'turn/started', 'turn/completed', 'item/started', 'item/completed', 'thread/tokenUsage/updated'].includes(value.method);
    if (!relevant) return;
    if (p.threadId !== threadId) { fail('event_thread_missing', '执行事件缺少本次会话引用，无法核实关联。'); return; }
    const eventTurnId = p.turn?.id ?? p.turnId;
    // Thread-level token totals have no authoritative per-turn attribution.
    if (value.method === 'thread/tokenUsage/updated' && !eventTurnId) { record('usage.thread_scoped_not_attributed', { threadId }); return; }
    if (turnId && eventTurnId && eventTurnId !== turnId) return;
    if (!eventTurnId) { fail('event_turn_missing', '执行事件缺少turn引用，不能补造关联。'); return; }
    if (!turnId) {
      if (awaitingTurnAck.length >= 512) { fail('unbound_events_overflow', 'turn/start未返回可核实ID前执行事件过多，停止本地验收。'); return; }
      awaitingTurnAck.push(value); record('event.awaiting_turn_ack', { method: value.method, claimedTurnId: eventTurnId ?? null }); return;
    }
    try { onBoundEvent(value); } catch (error) { fail('bound_event_callback_failed', error); return; }
    if (value.method === 'thread/tokenUsage/updated') return;
    if (value.method === 'turn/started') return;
    if (value.method === 'hook/started' || value.method === 'hook/completed') {
      const run = p.run;
      if (run?.eventName !== 'preToolUse') return;
      if (!run.id || run.handlerType !== 'command' || run.executionMode !== 'sync') { fail('invalid_hook_event', 'PreToolUse事件缺少唯一同步命令引用。'); return; }
      if (value.method === 'hook/started') {
        if (hooks.has(run.id)) { record('hook.duplicate_notification', { runId: run.id }); return; }
        if (hooks.size) { fail('repeated_hook_attempt', '观察到第二个或并发PreToolUse尝试；请求中断，不能保证已开始调用被拦下。', { runId: run.id }); return; }
        if (run.status !== 'running') { fail('invalid_hook_event', 'PreToolUse开始事件没有running状态。'); return; }
        if (!validateGuard()) return;
        const hook = { id: run.id, status: 'running', timer: null };
        hooks.set(run.id, hook);
        hook.timer = setTimeout(() => fail('hook_timeout', '等待PreToolUse完成超时；请求异步中断，不自动重提。', { runId: run.id }), hookTimeoutMs);
        record('hook.started', { runId: run.id }); return;
      }
      const hook = hooks.get(run.id);
      if (hook) clearTimeout(hook.timer);
      if (!hook || !['completed', 'failed', 'blocked', 'stopped'].includes(run.status) || !Array.isArray(run.entries)) { fail('invalid_hook_event', 'PreToolUse完成事件缺失、无效或未关联已开始的hook。'); return; }
      hook.status = run.status;
      record('hook.completed', { runId: run.id, status: run.status, entries: run.entries.map(entry => ({ kind: entry.kind, text: errorText(entry.text) })) });
      if (run.status !== 'completed' || run.entries.some(entry => entry.kind === 'error')) { fail('hook_failed', `PreToolUse未通过：${run.entries.map(entry => errorText(entry.text)).join('；') || run.status}`, { runId: run.id, status: run.status }); return; }
      if (!failed) readAllowEvidence();
      return;
    }
    if (p.item?.type === 'imageGeneration') {
      const id = p.item.id;
      if (typeof id !== 'string' || !id) { fail('image_id_missing', '图像事件缺少工具项ID。'); return; }
      const set = value.method === 'item/started' ? imageStarts : imageCompletions;
      const duplicate = set.has(id); set.add(id);
      if (value.method === 'item/completed' && !duplicate) completedImages.push(clone(p));
      record(duplicate ? 'image.duplicate_notification' : value.method === 'item/started' ? 'image.started' : 'image.completed', { itemId: id, status: p.item.status, afterProtectionFailure: !!failed });
      if (imageStarts.size > 1 || imageCompletions.size > 1) { fail('multiple_image_calls_observed', '已观察到多个图像工具项；异步中断不能撤销已发生调用。'); return; }
      if (!failed) {
        const hook = [...hooks.values()][0], marker = hook?.status === 'completed' ? readAllowEvidence() : null;
        if (!marker || marker.toolUseId !== id) fail('image_without_allow_evidence', '图像工具已出现，但此前未核实同一工具的私有hook准许证据。');
      }
      return;
    }
    if (value.method === 'turn/completed') {
      finished = true; clearHooks();
      record('turn.completed', { turnId, status: p.turn?.status, afterProtectionFailure: !!failed });
      if (p.turn?.status !== 'completed') fail('turn_not_completed', `官方turn终态：${p.turn?.status ?? '未知'}`);
      else if (!failed) terminalResolve(clone(p.turn));
    }
  };
  const startTurn = params => {
    if (failed || disposed) return Promise.reject(Object.assign(new Error(failed?.reason ?? '执行观察器已关闭。'), { code: failed?.code }));
    if (turnRequest) return turnRequest;
    if (!validateGuard()) return Promise.reject(Object.assign(new Error(failed?.reason ?? '执行观察器已关闭。'), { code: failed?.code }));
    turnRequests++;
    record('turn.requested', { threadId });
    let pending;
    try { pending = rpc.request('turn/start', { ...params, threadId }, 30000); }
    catch (error) { pending = Promise.reject(error); }
    const observed = Promise.resolve(pending).then(reply => {
      setTurn(reply?.turn?.id);
      if (!turnId) fail('turn_start_missing_id', 'turn/start没有返回可核实ID，不自动重提。');
      if (turnId) { const queued = awaitingTurnAck.splice(0); for (const pendingEvent of queued) event(pendingEvent); }
      if (failed) throw Object.assign(new Error(failed.reason), { code: failed.code });
      return reply;
    }, error => { fail('turn_start_failed', error); throw error; });
    observed.catch(() => {});
    turnRequest = Promise.race([observed, failure]); return turnRequest;
  };
  return {
    event, startTurn, fail, boundTurnId: () => turnId, waitForTurn: () => terminal,
    throwIfFailed() { if (failed) throw Object.assign(new Error(failed.reason), { code: failed.code }); },
    async settleInterrupt() { await interrupt?.promise; },
    snapshot() { return { protectionVerified: false, strictSingleCallGuaranteed: false, asynchronousInterruptionOnly: true, firstFailure: clone(failed), interrupt: clone(interrupt?.state ?? (failed ? { status: 'not_sent', reason: turnId ? '连接已关闭' : '缺少可核实turnId' } : null)), counts: { modelTurnRequests: turnRequests, modelTurnsStarted: startedTurns.size, observedImageToolStarts: imageStarts.size, observedImageToolCompletions: imageCompletions.size, imageToolCallsStarted: imageStarts.size || null, imageToolCallsCompleted: imageCompletions.size || null, exactActualToolCountKnown: false, actualImageToolCalls: null }, diagnostics: clone(diagnostics), completedImages: completedImages.map(p => ({ threadId: p.threadId, turnId: p.turnId, item: { id: p.item.id, type: p.item.type, status: p.item.status, generationId: p.item.generationId ?? null, savedPath: p.item.savedPath ?? null, hasResult: typeof p.item.result === 'string' } })) }; },
    dispose() { disposed = true; clearHooks(); },
  };
}
