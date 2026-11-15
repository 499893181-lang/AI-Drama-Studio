import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

export async function launchBrowser(artifactDir) {
  artifactDir = path.resolve(artifactDir);
  const candidates = [
    process.env.CHROME_BIN,
    path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
  ].filter(Boolean);
  const executable = candidates.find(candidate => existsSync(candidate));
  if (!executable) throw new Error('未找到 Chrome / Edge；可设置 CHROME_BIN 后执行浏览器验收。');
  await mkdir(artifactDir, { recursive: true });
  const port = await freePort();
  const profile = path.join(artifactDir, `browser-profile-${Date.now()}`);
  const browser = spawn(executable, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update',
    `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let browserError = '';
  browser.on('error', error => { browserError += error.message; });
  browser.stderr.on('data', chunk => { browserError = (browserError + chunk.toString()).slice(-2000); });
  let page;
  for (let i = 0; i < 100; i++) {
    if (browser.exitCode !== null) throw new Error(`浏览器启动失败（${browser.exitCode}）：${browserError}`);
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = pages.find(item => item.type === 'page');
      if (page) break;
    } catch {}
    await pause(100);
  }
  if (!page) {
    browser.kill();
    throw new Error(`浏览器调试接口未就绪：${browserError}`);
  }
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let counter = 0;
  const pending = new Map();
  const messages = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data.toString());
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      clearTimeout(waiter.timeout);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      messages.push(message.params.exceptionDetails);
    }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++counter;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP 超时：${method}`));
    }, 15000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await call('Runtime.enable');
  await call('Page.enable');
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        if (await evaluate(expression)) return;
      } catch (error) {
        if (!/context.*destroyed|Cannot find context|Inspected target navigated/i.test(error.message)) throw error;
      }
      await pause(150);
    }
    throw new Error(`页面等待超时：${expression}`);
  };
  return {
    executable, browser, messages, call, evaluate, waitFor,
    async close() {
      try { await call('Browser.close'); } catch {}
      socket.close();
      if (browser.exitCode === null) browser.kill();
    },
  };
}
