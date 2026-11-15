import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { inspectImage } from './image-files.mjs';

/** Decode pixels with an isolated local browser; no account/profile or remote page. */
export async function decodeActualImage({ bytes, cwd, signal }) {
  const info = inspectImage(bytes);
  if (signal?.aborted) throw new Error('图片解码已取消。');
  const binary = [process.env.CHROME_BIN,
    path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
  ].filter(Boolean).find(file => fs.existsSync(file));
  if (!binary) throw new Error('待配置：未找到Chrome/Edge，无法完成真实像素解码；原图已保留，未记为生成成功。');
  fs.mkdirSync(cwd, { recursive: true });
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  // Chrome profile files hit Windows MAX_PATH in deeply nested task directories.
  const profile = path.join(os.tmpdir(), `AI-Drama-image-decode-${randomUUID()}`);
  const child = spawn(binary, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let browserError = ''; child.stderr.on('data', bytes => { browserError = (browserError + bytes.toString()).slice(-3000); });
  let spawnError; child.on('error', error => { spawnError = error; });
  let socket, counter = 0; const pending = new Map();
  const aborted = () => { child.kill(); };
  signal?.addEventListener('abort', aborted, { once: true });
  try {
    let page;
    for (let n = 0; n < 100; n++) {
      if (spawnError) throw spawnError;
      if (signal?.aborted) throw new Error('图片解码已取消。');
      if (child.exitCode !== null) throw new Error(`图片解码浏览器提前退出：${browserError.slice(-500)}`);
      try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json()).find(row => row.type === 'page'); } catch {}
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!page) throw new Error('图片解码浏览器未就绪。');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('图片解码连接超时。')), 10000); socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true }); socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('图片解码连接失败。')); }, { once: true }); });
    socket.addEventListener('message', ({ data }) => { const event = JSON.parse(data.toString()); const waiter = pending.get(event.id); if (waiter) { pending.delete(event.id); clearTimeout(waiter.timer); if (event.error) waiter.reject(new Error('浏览器拒绝图片解码。')); else waiter.resolve(event.result); } });
    const call = (method, params) => new Promise((resolve, reject) => { const id = ++counter; const timer = setTimeout(() => { pending.delete(id); reject(new Error('实际图片解码超时。')); }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
    const result = await call('Runtime.evaluate', { expression: `(async()=>{const image=new Image();image.src=${JSON.stringify(`data:${info.mimeType};base64,${bytes.toString('base64')}`)};await image.decode();return {width:image.naturalWidth,height:image.naturalHeight};})()`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails || result.result?.value?.width !== info.width || result.result?.value?.height !== info.height) throw new Error('实际图片像素无法解码或与文件尺寸不一致。');
    const decoded = { decoded: true, width: info.width, height: info.height, decoder: 'isolated-local-chromium-img.decode', checkedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(cwd, 'decode.json'), JSON.stringify(decoded, null, 2));
    return decoded;
  } finally {
    signal?.removeEventListener('abort', aborted);
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('图片解码已结束。')); }
    pending.clear(); socket?.close(); if (child.exitCode === null) child.kill();
    const tempRoot = path.resolve(os.tmpdir()), target = path.resolve(profile);
    if (target.startsWith(tempRoot + path.sep) && path.basename(target).startsWith('AI-Drama-image-decode-')) {
      try { if (fs.existsSync(target) && !fs.lstatSync(target).isSymbolicLink()) fs.rmSync(target, { recursive: true, force: true }); } catch { /* Browser locks may release after process exit; no personal profile is used. */ }
    }
  }
}
