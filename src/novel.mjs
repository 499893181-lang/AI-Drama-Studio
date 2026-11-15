import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { AppError } from './store.mjs';
import { redact } from './tools.mjs';

const defaultRepoRoot = fileURLToPath(new URL('../', import.meta.url));
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
const textError = value => redact(typeof value === 'string' ? value : value?.message || JSON.stringify(value || '')).slice(0, 2200);
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function isExecutable(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}
function completeDistribution(file) {
  try { return isExecutable(file) && fs.statSync(path.join(path.dirname(file), 'runtime')).isDirectory(); } catch { return false; }
}
function childEnvironment() {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = `${path.dirname(process.execPath)}${path.delimiter}${env[pathKey] || ''}`;
  return env;
}

export function resolveNovelExecutable({ repoRoot = defaultRepoRoot, bin } = {}) {
  const configured = bin || process.env.JIMENG_NOVEL_BIN;
  // Explicit configuration never falls back to a different installation.
  if (configured) return path.isAbsolute(configured) && completeDistribution(configured) ? configured : null;
  const local = path.join(repoRoot, '.local');
  if (fs.existsSync(local)) {
    const versions = fs.readdirSync(local, { withFileTypes: true }).filter(item => item.isDirectory() && item.name.startsWith('jimeng-novel')).sort((a, b) => b.name.localeCompare(a.name, 'en', { numeric: true }));
    for (const version of versions) {
      const dir = path.join(local, version.name);
      const candidates = [path.join(dir, 'jimeng-novel.exe'), path.join(dir, 'jimeng-novel')];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).filter(item => item.isDirectory())) {
        candidates.push(path.join(dir, entry.name, 'jimeng-novel.exe'), path.join(dir, entry.name, 'jimeng-novel'));
      }
      const found = candidates.find(completeDistribution);
      if (found) return found;
    }
  }
  const envPath = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  for (const dir of envPath.split(path.delimiter).filter(Boolean)) {
    const file = path.resolve(dir.replace(/^"|"$/g, ''), process.platform === 'win32' ? 'jimeng-novel.exe' : 'jimeng-novel');
    if (completeDistribution(file)) return file;
  }
  return null;
}

export function scriptCostEstimate() {
  return {
    status: 'unknown', label: '费用待确认', amount: null, currency: null,
    basis: '当前公开 script outline/episode 契约没有可核验的剧本报价接口；余额、图片/视频节点估价和项目预算均不能代替本次剧本费用。',
    canSubmit: false,
  };
}

/** This runner has no login, shell, retry, task creation or model-selection logic. */
export function runNovelCommand(binary, args, { cwd, timeout = 35000, onStdout, signal } = {}) {
  return new Promise(resolve => {
    let stdout = '', stderr = '', settled = false, timedOut = false, aborted = false, outputLimitExceeded = false;
    const stdoutDecoder = new StringDecoder('utf8'), stderrDecoder = new StringDecoder('utf8');
    let child;
    const finish = value => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); stdout += stdoutDecoder.end(); stderr += stderrDecoder.end();
      resolve({ stdout, stderr, timedOut, aborted, outputLimitExceeded, ...value });
    };
    let timer;
    const abort = () => { aborted = true; child?.kill(); };
    if (signal?.aborted) { aborted = true; finish({ exitCode: null, error: 'CLI调用在启动前已中断。' }); return; }
    try { child = spawn(binary, args, { cwd, env: childEnvironment(), windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { finish({ exitCode: null, error: error.message }); return; }
    const collect = (name, chunk) => {
      if (name === 'stdout') stdout += stdoutDecoder.write(chunk); else stderr += stderrDecoder.write(chunk);
      if (stdout.length + stderr.length > 4 * 1024 * 1024) { outputLimitExceeded = true; child.kill(); return; }
      if (name === 'stdout') onStdout?.(stdout);
    };
    child.stdout.on('data', chunk => collect('stdout', chunk));
    child.stderr.on('data', chunk => collect('stderr', chunk));
    child.on('error', error => finish({ exitCode: null, error: error.message }));
    child.on('close', (code, signal) => finish({ exitCode: code, signal }));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
  });
}

export function parseNovelJson(stdout) {
  const trimmed = String(stdout || '').replace(/^\uFEFF/, '').trim();
  try { const value = JSON.parse(trimmed); return object(value) ? value : null; } catch {}
  // Some releases emit separate JSON envelopes. Never infer data from arbitrary text.
  const values = trimmed.split(/\r?\n/).flatMap(line => { try { const value = JSON.parse(line); return object(value) ? [value] : []; } catch { return []; } });
  return values.at(-1) || null;
}

export function extractNovelIds(envelope) {
  const data = object(envelope?.data) ? envelope.data : {};
  const threadId = data.thread_id ?? data.threadId ?? null;
  const runId = data.run_id ?? data.runId ?? null;
  return { threadId: identifier(threadId) ? threadId : null, runId: identifier(runId) ? runId : null };
}

const outlineFields = ['episode_num', 'idea', 'ref_content', 'model_key', 'script_localization'];
const episodeFields = ['current_episode', 'story_engine', 'characters', 'current_episode_summary', 'world_setting', 'history_summary', 'previous_script', 'future_summary', 'plot_positioning', 'requirement', 'stage_content', 'stage_episode_range', 'stage_sequence', 'model_key', 'script_localization'];
export function validateNovelInput(kind, input) {
  if (!['outline', 'script'].includes(kind)) throw new AppError('只支持大纲或单集剧本任务。');
  if (!object(input)) throw new AppError('剧本输入须为JSON对象。');
  const allowed = kind === 'outline' ? outlineFields : episodeFields;
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key)) throw new AppError(`公开剧本Schema没有字段 ${key}。`);
    if (['episode_num', 'current_episode', 'stage_sequence'].includes(key)) {
      if (!Number.isInteger(value) || value < 1 || (key === 'episode_num' && value > 100)) throw new AppError(`剧本输入 ${key} 不是有效整数。`);
    } else if (typeof value !== 'string' || value.length > 250000) throw new AppError(`剧本输入 ${key} 须为长度受限的文本。`);
  }
  if (input.script_localization !== undefined && !['cn', 'i18n'].includes(input.script_localization)) throw new AppError('script_localization须为cn或i18n。');
  if (kind === 'outline') {
    if (!Number.isInteger(input.episode_num) || input.episode_num < 1 || input.episode_num > 100 || (!input.idea?.trim() && !input.ref_content?.trim())) throw new AppError('大纲需要1–100的episode_num，以及idea/ref_content至少一项。');
  } else {
    if (!Number.isInteger(input.current_episode) || input.current_episode < 1 || ['story_engine', 'characters', 'current_episode_summary'].some(key => typeof input[key] !== 'string' || !input[key].trim())) throw new AppError('单集剧本缺少当前集数、故事引擎、人物或本集梗概。');
  }
  if (Buffer.byteLength(JSON.stringify(input)) > 1024 * 1024) throw new AppError('剧本输入过大。');
  return structuredClone(input);
}

function validateBinding(binding) {
  if (!object(binding) || !identifier(binding.projectId)) throw new AppError('请填写真实即梦项目/画布ID。');
  if (binding.teamId !== null && binding.teamId !== undefined && binding.teamId !== '' && !identifier(binding.teamId)) throw new AppError('即梦空间ID格式不正确。');
  return { projectId: binding.projectId, teamId: binding.teamId ?? '' };
}
function resultOf(receipt, bodyFile, fallbackIds = {}) {
  const envelope = receipt.json;
  const foundIds = extractNovelIds(envelope);
  const threadId = foundIds.threadId || fallbackIds.threadId || null;
  const runId = foundIds.runId || fallbackIds.runId || null;
  const top = typeof envelope?.status === 'string' ? envelope.status.toLowerCase() : '';
  const inner = typeof envelope?.data?.status === 'string' ? envelope.data.status.toLowerCase() : '';
  let status = 'uncertain', body = null, error = null;
  if (receipt.partial) status = threadId && runId ? 'running' : 'uncertain';
  else if (receipt.aborted || receipt.timedOut || receipt.outputLimitExceeded || receipt.error || receipt.exitCode !== 0) error = receipt.aborted ? 'CLI等待已中断；请查询原任务，勿重新提交。' : receipt.timedOut ? 'CLI等待超时；提交结果未确认，请查询原任务，勿重新提交。' : textError(receipt.error || envelope?.error || receipt.stderr || 'CLI进程异常；不能据此推断远端任务未创建。');
  else if (['running', 'pending', 'queued', 'in_progress'].includes(top) || ['running', 'pending', 'queued', 'in_progress'].includes(inner)) status = 'running';
  else if (['failed', 'failure', 'cancelled', 'canceled'].includes(top) || ['failed', 'failure', 'cancelled', 'canceled'].includes(inner)) { status = 'failed'; error = textError(envelope?.error || envelope?.data?.error || '剧本任务返回失败终态。'); }
  else if (envelope?.error || envelope?.data?.error) error = textError(envelope.error || envelope.data.error);
  else if (top === 'success') {
    // --out is the public, versioned CLI contract for complete successful script text.
    // A fresh directory per invocation prevents a stale previous output proving success.
    if (!threadId || !runId) error = '成功回执缺少thread_id/run_id，不能形成可追踪候选；原回执已保留。';
    else if (envelope?.data?.truncated === true || envelope?.truncated === true) error = 'CLI返回内容被标为截断，不能认定正文完整。';
    else if (!fs.existsSync(bodyFile) || !fs.statSync(bodyFile).isFile()) error = 'CLI未产生本次成功任务的完整正文文件；保留回执，请查询原任务。';
    else if (fs.statSync(bodyFile).size > 2 * 1024 * 1024) error = 'CLI正文超过读取上限，未作为成功候选采用。';
    else {
      const output = fs.readFileSync(bodyFile, 'utf8').replace(/^\uFEFF/, '');
      if (!output.trim()) error = 'CLI返回正文为空，不能显示生成成功。';
      else { status = 'succeeded'; body = output; }
    }
  } else error = textError(envelope?.error || 'CLI未返回可识别的成功终态；原回执已保留。');
  return { status, threadId, runId, body, receipt, error };
}

export function createNovelAdapter({ repoRoot = defaultRepoRoot, rootDir = path.join(repoRoot, 'data'), bin, runner = runNovelCommand } = {}) {
  const runtimeRoot = path.join(path.resolve(rootDir), 'runtime');
  const executable = () => resolveNovelExecutable({ repoRoot, bin });
  const requireExecutable = () => { const found = executable(); if (!found) throw new AppError('待配置：未找到带配套runtime的jimeng-novel；请配置完整发行目录或JIMENG_NOVEL_BIN。', 503); return found; };
  const invokeReadOnly = async (args, { timeout = 20000 } = {}) => {
    const binary = requireExecutable();
    const result = await runner(binary, args, { cwd: path.dirname(binary), timeout });
    return { ...result, json: parseNovelJson(result.stdout) };
  };
  const invokeScript = async ({ args, input, fallbackIds, onReceipt, signal }) => {
    const binary = requireExecutable();
    fs.mkdirSync(runtimeRoot, { recursive: true });
    const dir = fs.mkdtempSync(path.join(runtimeRoot, 'novel-'));
    const bodyFile = path.join(dir, 'body.md');
    const actualArgs = [...args];
    if (input) {
      const inputFile = path.join(dir, 'input.json');
      fs.writeFileSync(inputFile, JSON.stringify(input, null, 2), { flag: 'wx', encoding: 'utf8' });
      actualArgs.push('--input-file', inputFile);
    }
    actualArgs.push('--wait', '1', '--out', bodyFile, '-j', '--full');
    const pending = [];
    let lastPartial = '', lastStdout = '', callbackError = null;
    const latestIds = { ...fallbackIds };
    let result;
    try {
      result = await runner(binary, actualArgs, { cwd: dir, timeout: 35000, signal, onStdout: stdout => {
        lastStdout = stdout;
        const json = parseNovelJson(stdout);
        const ids = extractNovelIds(json);
        if (ids.threadId) latestIds.threadId = ids.threadId;
        if (ids.runId) latestIds.runId = ids.runId;
        const key = ids.threadId && ids.runId ? `${ids.threadId}/${ids.runId}` : '';
        if (!key || key === lastPartial || !onReceipt) return;
        lastPartial = key;
        pending.push(Promise.resolve().then(() => onReceipt(resultOf({ stdout, stderr: '', exitCode: null, json, partial: true, command: actualArgs }, bodyFile, latestIds))).catch(error => { callbackError = error; }));
      } });
    } catch (error) {
      result = { stdout: result?.stdout || lastStdout, stderr: result?.stderr || '', exitCode: result?.exitCode ?? null, aborted: signal?.aborted, error: `回执读取或持久化未完成：${textError(error.message)}` };
    }
    await Promise.all(pending);
    if (callbackError) result.error = `接受回执持久化未完成：${textError(callbackError.message)}`;
    const receipt = { command: actualArgs, stdout: result.stdout || '', stderr: result.stderr || '', exitCode: result.exitCode ?? null, timedOut: !!result.timedOut, aborted: !!result.aborted || !!signal?.aborted, outputLimitExceeded: !!result.outputLimitExceeded, error: result.error || null, json: parseNovelJson(result.stdout), capturedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify(receipt, null, 2), 'utf8');
    const normalized = resultOf(receipt, bodyFile, latestIds);
    if (onReceipt) await onReceipt(normalized);
    return normalized;
  };
  return {
    async inspect() {
      const binary = executable();
      if (!binary) return { installed: false, loggedIn: false, version: null, path: null, message: '待配置：jimeng-novel完整发行目录尚未找到。' };
      const [version, status] = await Promise.all([invokeReadOnly(['--version']), invokeReadOnly(['status', '-j'])]);
      const loggedIn = status.exitCode === 0 && !status.timedOut && (status.json?.logged_in === true || status.json?.data?.logged_in === true);
      return { installed: true, loggedIn, version: String(version.stdout || '').match(/jimeng-novel\s+([^\s]+)/)?.[1] || null, path: binary, message: loggedIn ? 'jimeng-novel已报告登录成功；业务权限以实际请求为准。' : textError(status.json?.error || status.error || status.stderr || '尚未登录，请在终端完成jimeng-novel login授权。') };
    },
    async verifyBinding(value) {
      const binding = validateBinding(value);
      const args = ['canvas', 'get', '--project-id', binding.projectId];
      if (binding.teamId) args.push('--team-id', binding.teamId);
      args.push('-j', '--full');
      const receipt = await invokeReadOnly(args, { timeout: 60000 });
      fs.mkdirSync(runtimeRoot, { recursive: true });
      const readDir = fs.mkdtempSync(path.join(runtimeRoot, 'novel-binding-'));
      fs.writeFileSync(path.join(readDir, 'receipt.json'), JSON.stringify({ command: args, ...receipt }, null, 2), 'utf8');
      if (receipt.exitCode !== 0 || receipt.timedOut || receipt.json?.status !== 'success' || receipt.json?.data?.projectId !== binding.projectId) throw new AppError(`即梦画布未通过真实访问校验：${receipt.timedOut ? '本次画布读取超过60秒限时，未收到完整回执；原始记录已保留，可只读重查' : textError(receipt.json?.error || receipt.error || receipt.stderr || '没有匹配的项目ID回执')}。`, 409);
      return { verified: true, projectId: binding.projectId, teamId: binding.teamId, title: typeof receipt.json.data.name === 'string' ? receipt.json.data.name : null, verifiedAt: new Date().toISOString() };
    },
    async submit({ kind, binding: value, input, requestId, onReceipt, signal }) {
      const binding = validateBinding(value);
      const checked = validateNovelInput(kind, input);
      if (!identifier(requestId)) throw new AppError('提交前必须持久化有效的request-id。');
      const args = ['script', kind === 'outline' ? 'outline' : 'episode', '--project-id', binding.projectId, '--request-id', requestId];
      if (binding.teamId) args.push('--team-id', binding.teamId);
      return invokeScript({ args, input: checked, onReceipt, signal });
    },
    async query({ threadId, runId, teamId, onReceipt, signal }) {
      if (!identifier(threadId) || !identifier(runId)) throw new AppError('缺少有效thread_id/run_id，不能猜测远端状态或重复提交。', 409);
      if (teamId !== undefined && teamId !== null && teamId !== '' && !identifier(teamId)) throw new AppError('即梦空间ID格式不正确。');
      const args = ['script', 'result', '--thread-id', threadId, '--run-id', runId];
      if (teamId) args.push('--team-id', teamId);
      return invokeScript({ args, fallbackIds: { threadId, runId }, onReceipt, signal });
    },
  };
}
