import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { redact } from './tools.mjs';

export function openImageRpc(binary, { cwd, onEvent, signal, rawDirectory } = {}) {
  const child = spawn(binary, ['app-server'], { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let counter = 0, buffer = '', stderr = '', closed = false;
  let resolveExit; const exited = new Promise(resolve => { resolveExit = resolve; });
  const pending = new Map(), decoder = new StringDecoder('utf8');
  if (rawDirectory) fs.mkdirSync(rawDirectory, { recursive: true });
  const append = (name, value) => { if (rawDirectory) fs.appendFileSync(path.join(rawDirectory, name), value); };
  const send = value => { append('requests.jsonl', JSON.stringify(value) + '\n'); child.stdin.write(JSON.stringify(value) + '\n'); };
  const consume = line => {
    let event; try { event = JSON.parse(line); } catch { return; }
    if (event.id != null && pending.has(event.id)) { const waiter = pending.get(event.id); pending.delete(event.id); clearTimeout(waiter.timer); event.error ? waiter.reject(new Error(redact(JSON.stringify(event.error)))) : waiter.resolve(event.result); }
    else if (event.id != null) send({ id: event.id, error: { code: -32601, message: 'This connector authorizes no client-executed tools, authorization changes or approvals.' } });
    onEvent?.(event);
  };
  child.stdout.on('data', bytes => { append('events.jsonl', bytes); buffer += decoder.write(bytes); if (buffer.length > 64 * 1024 * 1024) { child.kill(); return; } let end; while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); consume(line); } });
  child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-128000); append('stderr.txt', bytes); });
  const fail = error => { if (closed) return; closed = true; for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); } pending.clear(); };
  child.on('error', error => fail(error)); child.on('close', code => { buffer += decoder.end(); if (buffer.trim()) consume(buffer); onEvent?.({ method: 'connector/processClosed', params: { exitCode: code, error: redact(stderr) } }); resolveExit(code); fail(new Error(`Codex app-server已结束，退出码${code}。`)); });
  child.on('exit', code => resolveExit(code));
  child.stdin.on('error', () => {});
  const abort = () => { child.kill();child.stdout.destroy();child.stderr.destroy();child.stdin.destroy();fail(new Error('Codex连接已取消；不自动重试。')); }; signal?.addEventListener('abort', abort, { once: true });
  return { child, notify: (method, params = {}) => send({ method, params }),
    request(method, params = {}, timeout = 30000) { return new Promise((resolve, reject) => { if (closed || signal?.aborted) { reject(new Error('Codex连接已关闭或取消。')); return; } const id = ++counter, timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}超时。`)); }, timeout); pending.set(id, { resolve, reject, timer }); send({ id, method, params }); }); },
    close() { signal?.removeEventListener('abort', abort); child.stdin.end(); child.kill(); child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy(); fail(new Error('Codex连接已关闭。')); },
    async shutdown() { signal?.removeEventListener('abort', abort); child.stdin.end(); let timer; const result = await Promise.race([exited, new Promise(resolve => { timer=setTimeout(()=>resolve(null),5000); })]); clearTimeout(timer); if(result===null)child.kill(); child.stdout.destroy();child.stderr.destroy();child.stdin.destroy();return result; },
  };
}
