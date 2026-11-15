import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { resolveExecutable, runProbe } from './tools.mjs';

/** Official local CLI only. Every call creates a fresh ephemeral session. */
export async function runCreativeCodex({ prompt, schema, cwd, signal, onEvent }) {
  const binary = resolveExecutable('codex');
  if (!binary) throw new Error('待配置：未找到官方 Codex CLI。请安装或设置 CODEX_BIN。');
  const auth = await runProbe(binary, ['login', 'status'], { timeout: 15000 });
  if (auth.exitCode !== 0 || !/logged in|已登录/i.test(auth.output) || /not logged in/i.test(auth.output)) throw new Error(`待配置：Codex 认证不可用。${auth.output}`);
  if (signal.aborted) throw new Error('任务已经取消或中断。');
  fs.mkdirSync(cwd, { recursive: true });
  const schemaPath = path.join(cwd, 'response.schema.json');
  fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
  fs.writeFileSync(path.join(cwd, 'prompt.txt'), prompt);
  fs.writeFileSync(path.join(cwd, 'AGENTS.md'), '本目录仅用于当前文字候选或独立审阅。只按输入Schema返回JSON；不读取其他文件、不运行工具、不修改文件。\n');
  const args = ['exec', '--json', '--sandbox', 'read-only', '--ephemeral', '--skip-git-repo-check', '--output-schema', schemaPath, '-'];
  fs.writeFileSync(path.join(cwd, 'invocation.json'), JSON.stringify({ executable: 'codex', args: args.map(item => item === schemaPath ? '<runtime>/response.schema.json' : item), authenticated: true, freshSession: true }, null, 2));
  return new Promise(resolve => {
    let child, buffer = '', stderr = '', finalMessage = '', completed = false, threadId = null, usage = null, terminalError = '', lastWarning = '', settled = false, received = 0;
    const decoder = new StringDecoder('utf8');
    const consume = line => {
      let event; try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'thread.started') threadId = event.thread_id;
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') finalMessage = event.item.text ?? '';
      if (event.type === 'turn.completed') { completed = true; usage = event.usage ?? null; }
      if (event.type === 'turn.failed') terminalError = event.error?.message || event.message || 'Codex 回合失败。';
      if (event.type === 'error') lastWarning = event.error?.message || event.message || 'Codex 连接错误。';
      onEvent?.({ type: event.type || 'event', message: event.type === 'error' || event.type === 'turn.failed' ? terminalError || lastWarning : event.type, threadId, usage });
    };
    const finish = code => {
      if (settled) return; settled = true; clearTimeout(timer);
      buffer += decoder.end(); if (buffer.trim()) consume(buffer);
      fs.writeFileSync(path.join(cwd, 'final.txt'), finalMessage);
      resolve({ exitCode: code, completed, finalMessage, threadId, usage, error: terminalError || (code !== 0 || !completed ? lastWarning || stderr || '没有收到真实完成事件。' : null) });
    };
    let timer;
    try { child = spawn(binary, args, { cwd, windowsHide: true, shell: false, signal, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (error) { terminalError = error.message; finish(null); return; }
    fs.writeFileSync(path.join(cwd, 'stdout.jsonl'), '');
    fs.writeFileSync(path.join(cwd, 'stderr.txt'), '');
    timer = setTimeout(() => { terminalError = 'Codex 文字任务超过5分钟，已停止；未自动重试。'; child.kill(); finish(null); }, 300000);
    child.stdout.on('data', bytes => {
      fs.appendFileSync(path.join(cwd, 'stdout.jsonl'), bytes); received += bytes.length;
      if (received > 6 * 1024 * 1024) { terminalError = 'Codex 输出超过6MB限制。'; child.kill(); finish(null); return; }
      buffer += decoder.write(bytes); let end;
      while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); consume(line); }
    });
    child.stderr.on('data', bytes => { fs.appendFileSync(path.join(cwd, 'stderr.txt'), bytes); stderr = (stderr + bytes.toString('utf8')).slice(-128000); });
    child.once('error', error => { terminalError = error.message; finish(null); });
    child.once('close', finish);
    child.stdin.on('error', () => {}); child.stdin.end(prompt, 'utf8');
    onEvent?.({ type: 'process.started', message: '官方 Codex CLI 已启动；等待真实回执。' });
  });
}
