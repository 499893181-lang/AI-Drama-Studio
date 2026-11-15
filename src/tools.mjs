import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';

const overrides = { codex: 'CODEX_BIN', dreamina: 'DREAMINA_BIN', 'dreamina-canvas': 'DREAMINA_CANVAS_BIN', ffmpeg: 'FFMPEG_BIN', ffprobe: 'FFPROBE_BIN' };
const allowedTools = new Set(Object.keys(overrides));
let appxCache = { expiresAt: 0, paths: [] };

function codexAppxExecutables() {
  if (process.platform !== 'win32') return [];
  if (Date.now() < appxCache.expiresAt) return appxCache.paths.filter(executable);
  // Query this user's registered packages only. Never enumerate WindowsApps or
  // guess a versioned package directory, and never require elevation at runtime.
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); ConvertTo-Json -InputObject @(Get-AppxPackage -Name 'OpenAI.Codex*' -ErrorAction Stop | Sort-Object Version -Descending | Select-Object -ExpandProperty InstallLocation) -Compress";
  let paths = [];
  try {
    const output = execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 2000, maxBuffer: 65536, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    const packages = JSON.parse(output.replace(/^\uFEFF/, '').trim());
    if (Array.isArray(packages)) paths = packages.filter(value => typeof value === 'string' && path.isAbsolute(value)).flatMap(root => [path.join(root, 'app', 'resources', 'codex.exe'), path.join(root, 'resources', 'codex.exe')]).filter(executable);
  } catch { /* Sandboxed accounts may not query Appx; explicit *_BIN still works. */ }
  appxCache = { expiresAt: Date.now() + 60000, paths };
  return paths;
}

function executable(file) {
  try { if (!statSync(file).isFile()) return false; accessSync(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return true; } catch { return false; }
}

/** Resolve native executables, never interpolate a shell command or inspect credentials. */
export function resolveExecutable(name) {
  if (!allowedTools.has(name)) return null;
  const override = process.env[overrides[name]];
  // A misspelled explicit override must not silently call a different binary.
  if (override) return path.isAbsolute(override) && executable(override) ? override : null;
  const envPath = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  const names = process.platform === 'win32' ? [`${name}.exe`, `${name}.com`] : [name];
  const dirs = envPath.split(path.delimiter).filter(Boolean).map(dir => dir.replace(/^"|"$/g, ''));
  if (process.platform === 'win32') {
    dirs.push(path.join(os.homedir(), 'bin'));
    if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'codex'), path.join(process.env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin'));
    if (['ffmpeg', 'ffprobe'].includes(name)) {
      dirs.push(path.join(process.cwd(), 'tools', 'ffmpeg', 'bin'), path.join(process.cwd(), '..', 'runtime', 'ffmpeg', 'bin'));
      dirs.push('D:\\AI视频\\runtime\\ffmpeg\\bin', 'C:\\ffmpeg\\bin');
      if (process.env.AI_DRAMA_STUDIO_TOOLS_DIR) dirs.push(process.env.AI_DRAMA_STUDIO_TOOLS_DIR);
    }
  }
  for (const dir of dirs) for (const basename of names) {
    const candidate = path.resolve(dir, basename);
    if (executable(candidate)) return candidate;
  }
  // Official npm codex.cmd is a launcher. Resolve its packaged native exe instead
  // of passing cmd/bat text to a shell. Support the optional platform package and
  // the older bundled vendor layout, including node_modules/.bin and pnpm links.
  if (process.platform === 'win32' && name === 'codex') {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    const triple = `${arch}-pc-windows-msvc`;
    const platformPackage = `@openai/codex-win32-${process.arch === 'arm64' ? 'arm64' : 'x64'}`;
    for (const dir of dirs) {
      const roots = [path.join(dir, 'node_modules', '@openai', 'codex'), path.resolve(dir, '..', '@openai', 'codex')];
      for (let packageRoot of roots) {
        if (!existsSync(packageRoot)) continue;
        try { packageRoot = realpathSync(packageRoot); } catch { continue; }
        const vendors = [path.join(packageRoot, 'vendor')];
        try {
          const require = createRequire(path.join(packageRoot, 'package.json'));
          const packageFile = require.resolve(`${platformPackage}/package.json`);
          vendors.unshift(path.join(path.dirname(packageFile), 'vendor'));
        } catch { /* Older releases bundled the binary in the main package. */ }
        for (const vendor of vendors) for (const subdir of ['bin', 'codex']) {
          const candidate = path.join(vendor, triple, subdir, 'codex.exe');
          if (executable(candidate)) return candidate;
        }
      }
    }
    const appxBinary = codexAppxExecutables()[0];
    if (appxBinary) return appxBinary;
  }
  return null;
}

export function redact(text) {
  return String(text || '')
    .replace(/\b(?:sk|sess)-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/(["']?(?:access_token|refresh_token|id_token|api_key|authorization|device_code|deviceCode|user_code|userCode)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]')
    .replace(/https?:\/\/[^\s"'<>]+\?[^\s"'<>]*/gi, '[URL WITH QUERY REDACTED]');
}

export function runProbe(binary, args, { timeout = 10000, maxBuffer = 1024 * 1024 } = {}) {
  return new Promise(resolve => {
    if (!binary) { resolve({ exitCode: null, output: '未找到可执行文件。', timedOut: false }); return; }
    execFile(binary, args, { windowsHide: true, timeout, maxBuffer, encoding: 'utf8', shell: false }, (error, stdout, stderr) => {
      resolve({ exitCode: error ? (typeof error.code === 'number' ? error.code : null) : 0, output: redact(`${stdout || ''}${stderr ? `\n${stderr}` : ''}`).trim(), timedOut: !!error?.killed });
    });
  });
}

const capability = (name, status, detail) => ({ name, status, detail });
const evidence = (name, args, result) => ({ command: [name, ...args].join(' '), exitCode: result.exitCode, output: result.output.slice(0, 14000), timedOut: result.timedOut });
const missing = (id, name, envName) => ({ id, name, status: 'needs_configuration', path: null, version: null, summary: '未检测到可直接运行的本机程序。', capabilities: [capability('本机安装', 'needs_configuration', `将程序加入 PATH，或设置 ${envName} 为原生可执行文件的绝对路径。`)], evidence: [], nextAction: `安装工具并加入 PATH，或设置 ${envName}。` });

async function codexReport() {
  const binary = resolveExecutable('codex');
  if (!binary) return missing('codex', 'Codex', 'CODEX_BIN');
  const args = [['--version'], ['exec', '--help'], ['login', 'status']];
  const results = await Promise.all(args.map(a => runProbe(binary, a)));
  const [version, help, auth] = results;
  const loggedIn = auth.exitCode === 0 && /Logged in\b/i.test(auth.output) && !/not logged in/i.test(auth.output);
  const requiredFlags = ['--json', '--sandbox', '--ephemeral', '--skip-git-repo-check', '--output-schema'];
  const missingFlags = requiredFlags.filter(flag => !help.output.includes(flag));
  const hasExec = help.exitCode === 0 && missingFlags.length === 0;
  return {
    id: 'codex', name: 'Codex', path: binary, version: version.output.match(/codex-cli\s+([^\s]+)/)?.[1] || null,
    status: loggedIn && hasExec ? 'detected' : 'needs_configuration',
    summary: loggedIn && hasExec ? '已检测到官方非交互调用接口和本机登录态。真实扩写可用性以每次任务结果为准。' : '程序已安装；登录、权限或非交互接口仍需配置。',
    capabilities: [capability('本机程序', version.exitCode === 0 ? 'detected' : 'needs_configuration', version.exitCode === 0 ? '版本命令执行成功。' : version.output), capability('非交互结构化扩写', hasExec ? 'detected' : 'needs_configuration', hasExec ? 'exec --help 已包含工作台使用的全部参数；帮助确认不等于模型调用成功。' : `已安装 CLI 缺少必要参数或帮助执行失败：${missingFlags.join('、') || help.output.slice(0, 1000)}。请升级官方 Codex CLI。`), capability('认证状态', loggedIn ? 'detected' : 'needs_configuration', loggedIn ? 'codex login status 返回 Logged in；未读取或保存认证文件。' : auth.output), capability('模型服务连接', 'not_verified', '需要实际扩写任务才能验证网络、模型权限和额度。')],
    evidence: args.map((a, i) => evidence('codex', a, results[i])),
    nextAction: !hasExec ? '升级官方 Codex CLI 后刷新检测；当前版本未确认支持工作台所需参数。' : loggedIn ? '在项目中点击「Codex 扩写」，查看真实事件和结果。' : '在终端运行 codex login，然后刷新检测；若已登录，检查错误中的文件权限或网络。',
  };
}

async function dreaminaReport() {
  const binary = resolveExecutable('dreamina');
  if (!binary) return missing('dreamina', '即梦 CLI', 'DREAMINA_BIN');
  const args = [['version'], ['-h'], ['text2video', '-h'], ['user_credit', '-h'], ['user_credit']];
  const results = await Promise.all(args.map(a => runProbe(binary, a)));
  let version = null; try { version = JSON.parse(results[0].output.slice(results[0].output.indexOf('{'), results[0].output.lastIndexOf('}') + 1)).version; } catch {}
  const helpReady = results[1].exitCode === 0;
  // Account query is read-only. No login/refresh or generation runs here.
  const loggedIn = results[4].exitCode === 0 && !/未检测到有效登录态|not logged|unauthorized|login required/i.test(results[4].output);
  return {
    id: 'dreamina', name: '即梦 CLI', path: binary, version, status: loggedIn && helpReady ? 'detected' : 'needs_configuration',
    summary: loggedIn ? '程序已安装，只读账户查询成功；本阶段未提交生成任务。' : '程序已安装；本机登录态或账户访问需要配置。',
    capabilities: [capability('本机安装与帮助', helpReady ? 'detected' : 'needs_configuration', '已实际执行版本和 -h。'), capability('账户访问', loggedIn ? 'detected' : 'needs_configuration', loggedIn ? 'user_credit 只读查询成功；余额不是人民币报价。' : results[4].output), capability('图像与视频接口', helpReady ? 'detected' : 'not_verified', '帮助公开 text2image、text2video、multimodal2video 等入口；仅确认命令存在。'), capability('实际生成、无配音输出与费用', 'not_verified', '未提交任务；未验证静音、配音控制、价格或运行时模型权限。'), capability('自动剧本与分镜文本创作', 'not_verified', '当前顶层帮助未给出独立文本创作接口，需下一阶段进一步核对官方接口。')],
    evidence: args.map((a, i) => evidence('dreamina', a, results[i])), nextAction: loggedIn ? '下一阶段核对文本创作接口、报价和明确的静音视频参数。' : '需要时在终端执行 dreamina login 完成授权，再刷新检测。',
  };
}

async function canvasReport() {
  const binary = resolveExecutable('dreamina-canvas');
  if (!binary) return missing('dreamina-canvas', '即梦画布 CLI', 'DREAMINA_CANVAS_BIN');
  const args = [['version'], ['--help'], ['auth', 'status'], ['node', 'create', '--help'], ['director', '--help'], ['schema']];
  const results = await Promise.all(args.map(a => runProbe(binary, a)));
  let version = null; let loggedIn = false; let contract = null;
  try { version = JSON.parse(results[0].output).data?.version || null; } catch {}
  try { const auth = JSON.parse(results[2].output); loggedIn = auth.ok === true && auth.data?.loggedIn === true; } catch {}
  try { const schema = JSON.parse(results[5].output); contract = schema.ok === true ? schema.data : null; } catch {}
  const evidenceResults = args.map((a, i) => evidence('dreamina-canvas', a, results[i]));
  if (contract) evidenceResults[5].output = JSON.stringify({ schemaVersion: contract.schemaVersion, edition: contract.edition, command: contract.command, subcommands: contract.subcommands?.map(c => ({ name: c.name, summary: c.summary, reads: c.reads, writes: c.writes, subcommands: c.subcommands?.map(s => ({ name: s.name, summary: s.summary })) })) }, null, 2).slice(0, 18000);
  return {
    id: 'dreamina-canvas', name: '即梦画布 CLI', path: binary, version, status: loggedIn && contract ? 'detected' : 'needs_configuration',
    summary: loggedIn ? '已检测到登录态与画布命令；本阶段未创建画布或提交生成。' : '程序与画布契约已检测；默认 profile 尚未登录或认证读取失败。',
    capabilities: [capability('命令契约 schema', contract ? 'detected' : 'not_verified', contract ? '实际读取已安装版本 schema；只确认公开接口，不推断业务成功。' : results[5].output.slice(0, 1000)), capability('认证状态', loggedIn ? 'detected' : 'needs_configuration', results[2].output), capability('画布与节点管理', contract ? 'detected' : 'not_verified', '帮助/契约包含 canvas、node create text/image/video/timeline、node quote/run；未执行写操作。'), capability('导演台与导出', results[4].exitCode === 0 ? 'detected' : 'not_verified', '帮助列出 director apply/export/preview；未进行实际导出。'), capability('自动剧本/分镜文本生成', 'not_verified', 'text 节点可保存正文；这不能证明存在自动创作剧本/分镜接口。'), capability('视频生成、配音开关和积分预算', 'not_verified', '本阶段未提交生成、报价或消费确认，也未验收媒体。')],
    evidence: evidenceResults, nextAction: loggedIn ? '下一阶段先确认创作接口和真实报价，再接入画布及静音视频。' : '需要时运行 dreamina-canvas auth login；完成授权后刷新检测。',
  };
}

async function mediaReport(name) {
  const binary = resolveExecutable(name);
  if (!binary) return missing(name, name === 'ffmpeg' ? 'FFmpeg' : 'FFprobe', overrides[name]);
  const result = await runProbe(binary, ['-version']);
  const ready = result.exitCode === 0 && result.output.includes(`${name} version`);
  return { id: name, name: name === 'ffmpeg' ? 'FFmpeg' : 'FFprobe', path: binary, version: result.output.match(/version\s+([^\s]+)/)?.[1] || null, status: ready ? 'detected' : 'needs_configuration', summary: ready ? '已找到本机程序，版本命令执行成功。' : '已找到程序但执行失败。', capabilities: [capability('本机安装', ready ? 'detected' : 'needs_configuration', ready ? '可以从本机调用，未加入 PATH 时仍可通过解析出的绝对路径使用。' : result.output), capability(name === 'ffmpeg' ? '配音、字幕与剪辑导出' : '媒体参数与时长读取', 'not_verified', '当前仅检查版本；实际媒体处理留待后期制作阶段。')], evidence: [evidence(name, ['-version'], result)], nextAction: '下一阶段使用实际媒体逐项验证；本阶段不处理媒体。' };
}

/** All probes are allowlisted, read-only and bounded; this never submits media jobs. */
export async function inspectTools() {
  const probes = [codexReport, dreaminaReport, canvasReport, () => mediaReport('ffmpeg'), () => mediaReport('ffprobe')];
  const ids = ['codex', 'dreamina', 'dreamina-canvas', 'ffmpeg', 'ffprobe'];
  const settled = await Promise.allSettled(probes.map(probe => probe()));
  return { checkedAt: new Date().toISOString(), tools: settled.map((result, i) => result.status === 'fulfilled' ? result.value : { ...missing(ids[i], ids[i], overrides[ids[i]]), summary: '检测过程失败，请检查本机权限和配置。', evidence: [{ command: 'inspect', exitCode: null, output: redact(result.reason?.message || result.reason) }] }) };
}
