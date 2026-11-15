import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolveExecutable, redact } from './tools.mjs';
import { AppError } from './store.mjs';

const channel = 'dreamina-cli-image2video';
const auditedVersion = '1.4.22';
const nativeSubmissionEnabled = false;
const submissionBlock = '本轮仅实现和隔离验收，真实即梦视频提交保持关闭；须先核实本渠道费用并明确批准方案，不通过目录、环境变量或上限开启。';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const model = (id, min, max, resolutions = ['720p'], ratioSupported = true) => ({ id, model: id, duration: { min, max, step: 1 }, resolutions, ratioSupported });
const auditedModels = [model('seedance1.0fast', 5, 10), model('seedance1.5pro', 5, 12), model('seedance2.0', 4, 15), model('seedance2.0fast', 4, 15), model('seedance2.0_vip', 4, 15, ['720p', '1080p', '4k']), model('seedance2.0fast_vip', 4, 15), model('seedance2.0mini', 4, 15), model('seedance2.5', 4, 30, ['480p', '720p', '1080p'], false)];
const defaults = { model: 'seedance2.0_vip', durationSeconds: 5, resolution: '720p', audioMode: 'provider_default' };
const ratios = ['1:1', '3:4', '16:9', '4:3', '9:16', '21:9'];
const textOf = result => typeof result?.stdout === 'string' ? result.stdout : result?.output ?? '';
function jsonFrom(text) { try { return JSON.parse(text.trim().replace(/^\uFEFF/, '')); } catch { const start = text.indexOf('{'), end = text.lastIndexOf('}'); if (start < 0 || end < start) return null; try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; } } }
const publicEvidence = (command, result) => ({ command, exitCode: result?.exitCode ?? null, sha256: hash(textOf(result)), runtimeVerified: false });

export function runDreaminaCommand(binary, args, { cwd, timeoutMs = 30000, maxBuffer = 8 * 1024 * 1024 } = {}) {
  return new Promise(resolve => {
    if (!binary) { resolve({ exitCode: null, stdout: '', stderr: '未找到官方CLI可执行文件。', timedOut: false }); return; }
    execFile(binary, args, { cwd, windowsHide: true, shell: false, timeout: timeoutMs, maxBuffer, encoding: 'utf8' }, (error, stdout, stderr) => resolve({ exitCode: error ? typeof error.code === 'number' ? error.code : null : 0, stdout: stdout ?? '', stderr: stderr ?? '', timedOut: !!error?.killed }));
  });
}

export function validateDreaminaVideoParameters(input = {}) {
  const parameters = { ...defaults, ...input };
  const specification = auditedModels.find(item => item.id === parameters.model);
  if (!specification) throw new AppError('模型未出现在本机已核查的image2video帮助中。');
  if (!Number.isInteger(parameters.durationSeconds) || parameters.durationSeconds < specification.duration.min || parameters.durationSeconds > specification.duration.max) throw new AppError('视频时长不符合该模型的实际CLI范围。');
  if (!specification.resolutions.includes(parameters.resolution)) throw new AppError('分辨率不符合该模型的实际CLI范围。');
  if (!['provider_default', 'mute_derivative'].includes(parameters.audioMode)) throw new AppError('当前CLI没有已核实的原生关闭音频参数；只支持保留原音轨或另作去音轨派生计划。');
  if (parameters.ratio && (!specification.ratioSupported || !ratios.includes(parameters.ratio))) throw new AppError('比例不符合本机CLI帮助；seedance2.5必须省略ratio，按首帧决定。');
  return { model: parameters.model, durationSeconds: parameters.durationSeconds, resolution: parameters.resolution, audioMode: parameters.audioMode, ...(parameters.ratio ? { ratio: parameters.ratio } : {}) };
}

/** Command plan only. Calling this function never uploads or submits media. */
export function buildDreaminaVideoArgs({ imagePath, prompt, parameters = {} }) {
  if (!path.isAbsolute(imagePath ?? '') || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 20000) throw new AppError('视频输入须为本地图片绝对路径和非空运镜提示词。');
  const p = validateDreaminaVideoParameters(parameters);
  return ['image2video', '--image', imagePath, '--prompt', prompt, '--model_version', p.model, '--duration', String(p.durationSeconds), '--video_resolution', p.resolution, ...(p.ratio ? ['--ratio', p.ratio] : []), '--poll', '0'];
}

function receipt(args, result) { return { command: ['dreamina', ...args], exitCode: result?.exitCode ?? null, stdout: redact(textOf(result)), stderr: redact(result?.stderr ?? ''), timedOut: result?.timedOut === true }; }
const validExternalId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(id);

/** This parser fails closed on undocumented output; fixtures do not prove wire success. */
export function parseDreaminaVideoResult(result, expectedId, args = []) {
  const raw = receipt(args, result), json = jsonFrom(textOf(result));
  const unknown = error => ({ externalTaskId: expectedId, status: 'unknown', error, raw, runtimeVerified: false });
  if (result?.exitCode !== 0 || result?.timedOut) return unknown(redact(result?.stderr || textOf(result) || '即梦查询失败；保留原任务ID继续查询，不重新提交。'));
  if (!json || typeof json !== 'object' || Array.isArray(json)) return unknown('CLI未返回可核查的JSON任务回执，不能推断生成终态。');
  if (json.ret != null && json.ret !== 0 || json.ok === false) return unknown('官方回执返回错误，不能当作成功终态。');
  const item = [json, json.data].find(value => value && typeof value === 'object' && value.submit_id === expectedId && ['querying', 'success', 'fail'].includes(value.gen_status));
  if (!item) return unknown('回执缺少匹配原任务的submit_id与已核实gen_status；原始回执保留，尚未验证此运行时输出契约。');
  return { externalTaskId: expectedId, status: item.gen_status, error: item.gen_status === 'fail' ? redact(String(item.fail_reason ?? '即梦任务失败，官方未提供详细原因。')) : null, raw, requestId: typeof json.meta?.requestId === 'string' ? json.meta.requestId : null, estimatedRemainingSeconds: Number.isFinite(item.estimated_remaining_seconds) ? item.estimated_remaining_seconds : null, runtimeVerified: false };
}

/** Parse the first submit receipt without inventing an external/client ID. */
export function parseDreaminaVideoSubmission(result, args = []) {
  const json = jsonFrom(textOf(result)), raw = receipt(args, result);
  const item = [json, json?.data].find(value => value && typeof value === 'object' && !Array.isArray(value) && validExternalId(value.submit_id));
  if (!item) return { externalTaskId: null, status: 'unknown', error: '提交回执没有有效submit_id，无法确认受理；保留原意图和回执，不自动重提。', raw, runtimeVerified: false };
  // An observed ID is retained even if status/transport is uncertain, so only
  // the original ID can be investigated later. It is not an accepted result.
  return parseDreaminaVideoResult(result, item.submit_id, args);
}

export function createDreaminaVideoAdapter({ run = runDreaminaCommand, resolve = resolveExecutable } = {}) {
  let inspection = null, pendingInspection = null;
  async function inspectUncached() {
    const binary = resolve('dreamina'), canvasBinary = resolve('dreamina-canvas');
    const ask = (executable, args) => run(executable, args, { timeoutMs: 15000 });
    const directArgs = [['version'], ['-h'], ['image2video', '-h'], ['query_result', '-h'], ['user_credit']];
    const canvasArgs = [['version'], ['auth', 'status'], ['schema'], ['resource', 'upload', '--help'], ['node', 'create', 'video', '--help'], ['node', 'quote', '--help']];
    const [direct, canvas] = await Promise.all([Promise.all(directArgs.map(args => ask(binary, args))), Promise.all(canvasArgs.map(args => ask(canvasBinary, args)))]);
    const version = jsonFrom(textOf(direct[0]))?.version ?? null, help = textOf(direct[2]), queryHelp = textOf(direct[3]), creditText = textOf(direct[4]), credit = jsonFrom(creditText);
    const contractDetected = version === auditedVersion && direct[2]?.exitCode === 0 && ['--image', '--prompt', '--model_version', '--video_resolution', '--duration', 'seedance2.0_vip', ...auditedModels.map(item => item.id)].every(flag => help.includes(flag)) && direct[3]?.exitCode === 0 && queryHelp.includes('--submit_id') && queryHelp.includes('--download_dir');
    const loggedIn = direct[4]?.exitCode === 0 && !/未检测到有效登录态|not logged|unauthorized|login required/i.test(creditText) && credit != null && (credit.ret === 0 || credit.ok === true);
    const canvasAuth = jsonFrom(textOf(canvas[1])), schema = jsonFrom(textOf(canvas[2])), upload = textOf(canvas[3]), createVideo = textOf(canvas[4]);
    const canvasLoggedIn = canvasAuth?.ok === true && canvasAuth?.data?.loggedIn === true;
    inspection = {
      checkedAt: new Date().toISOString(), channel, version, auditedVersion, installed: !!binary, contractDetected, contractVerified: contractDetected, canSubmit: nativeSubmissionEnabled && contractDetected && loggedIn, nativeSubmissionEnabled, realSubmissionEnabled: nativeSubmissionEnabled, actualGenerationVerified: false,
      auth: { loggedIn, status: loggedIn ? 'detected' : 'needs_configuration', reason: loggedIn ? '只读user_credit账户查询成功；不代表模型权益或报价。' : 'dreamina直接生成CLI当前登录未核实或不可用；没有发起登录、退出或刷新授权。' },
      models: contractDetected ? structuredClone(auditedModels) : [], defaults: structuredClone(defaults),
      audio: { nativeDisableSupported: false, modes: ['provider_default', 'mute_derivative'], status: 'native_disable_not_supported', reason: '实际image2video帮助没有音频开关；mute_derivative是独立本地去音轨派生计划，不能称为模型原生无声。' },
      inputImage: { localFileRequired: true, supportedFormats: null, minimumDimensions: null, maximumDimensions: null, status: 'not_specified_in_help', reason: '本机image2video帮助未给出输入格式、像素和大小限制，提交前仍需核实；不从其他渠道推断。' },
      quote: { status: 'unknown', canQuote: false, channel, reason: 'direct CLI帮助没有报价命令；所有生成消耗积分，但缺本账号本模型本参数的权威报价。余额不是报价，画布报价不能套用。' },
      canvas: { version: jsonFrom(textOf(canvas[0]))?.data?.version ?? null, auth: { loggedIn: canvasLoggedIn, status: canvasLoggedIn ? 'detected' : 'needs_configuration' }, contractDetected: schema?.ok === true, mediaImport: { status: upload.includes('--file') && upload.includes('video') && createVideo.includes('--resource-id') && createVideo.includes('--import-kind') ? 'detected_not_verified' : 'not_verified', uploadCommand: 'dreamina-canvas resource upload --project-id <UUID> --file <video> --type video --import-kind external_generated --resource-id <UUID>', nodeCommand: 'dreamina-canvas node create video --project-id <UUID> --resource-id <registeredUUID> --import-kind external_generated --submit-id <UUID>', reason: '本直连适配器仅只读核对Schema与帮助；既有视频导入与独立画布草稿准备分别记录，直接视频成功不等于画布已导入。' }, pricing: { status: 'separate_channel_not_quoted', reason: 'node quote基于已保存画布节点；画布渠道实际准备与报价见独立证据页，该报价不能代替direct image2video。' } },
      evidence: [...directArgs.map((args, i) => publicEvidence(['dreamina', ...args].join(' '), direct[i])), ...canvasArgs.map((args, i) => publicEvidence(['dreamina-canvas', ...args].join(' '), canvas[i]))],
      message: submissionBlock,
    };
    return structuredClone(inspection);
  }
  async function inspect(options = {}) {
    const refresh = options === true || options?.refresh === true;
    if (!refresh && inspection && Date.now() - Date.parse(inspection.checkedAt) < 60000) return structuredClone(inspection);
    if (!pendingInspection) pendingInspection = inspectUncached().finally(() => { pendingInspection = null; });
    return structuredClone(await pendingInspection);
  }
  async function quote(parameters = {}) {
    const normalized = validateDreaminaVideoParameters(parameters);
    return { status: 'unknown', currency: 'CREDITS', unit: 'credits/task', amount: null, channel, parameters: normalized, basis: '本机dreamina 1.4.22顶层和image2video帮助未暴露本渠道报价命令；余额、文字报价和画布节点报价均不能套用。', sources: [{ type: 'actual_cli_help', command: 'dreamina -h; dreamina image2video -h', channel }], conditions: ['当前账号、模型、时长、分辨率和渠道的权威报价尚未取得。'], expiresAt: null, canSubmit: false, officialQuoteId: null, cnyAmount: null };
  }
  async function submit({ imagePath, prompt, parameters = {}, cwd, signal, beforeSubmit } = {}) {
    // This non-configurable gate is deliberately before resolution, filesystem
    // access, inspection and subprocess work. Tests never enable this branch.
    if (!nativeSubmissionEnabled) throw new AppError(submissionBlock, 409);
    if (signal?.aborted) throw new AppError('提交前已取消，未启动即梦生成。', 409);
    if (!path.isAbsolute(cwd ?? '') || !path.isAbsolute(imagePath ?? '')) throw new AppError('真实提交须使用任务目录和图片的绝对路径。');
    const capability = await inspect({ refresh: true });
    if (!capability.contractDetected || capability.auth.loggedIn !== true) throw new AppError('当前官方CLI版本、参数契约或direct登录尚未核实，未提交。', 409);
    const args = buildDreaminaVideoArgs({ imagePath, prompt, parameters });
    if (!fs.statSync(imagePath).isFile()) throw new AppError('真实分镜图文件不存在，未提交。', 409);
    const imageBytes = fs.readFileSync(imagePath);
    if (!imageBytes.length) throw new AppError('真实分镜图文件为空，未提交。', 409);
    if (signal?.aborted) throw new AppError('提交前已取消，未启动即梦生成。', 409);
    if (typeof beforeSubmit !== 'function') throw new AppError('真实提交缺少可信存储的最终同步复核，未启动即梦生成。', 409);
    // The adapter's fresh inspection above may await account/network checks.
    // Re-read the bound task/image through the service's trusted closure at the
    // last synchronous boundary, without accepting HTTP-supplied functions.
    const finalCheck = beforeSubmit();
    if (finalCheck && typeof finalCheck.then === 'function') throw new AppError('最终提交复核必须同步完成，不能在复核后再次异步等待。', 409);
    // The public command has no client request-id or credit-ceiling option.
    // Application authorization/budget checks and durable intent precede this
    // adapter call; never invent a flag or retry after an uncertain response.
    const result = await run(resolve('dreamina'), args, { cwd, timeoutMs: 120000 });
    return { ...parseDreaminaVideoSubmission(result, args), inputImage: { sha256: hash(imageBytes), size: imageBytes.length, path: imagePath }, nativeCommandAttempted: true };
  }
  async function query({ externalTaskId, cwd } = {}) {
    if (!validExternalId(externalTaskId)) throw new AppError('只允许查询已保存的有效外部任务ID，不能猜测或新提交。');
    const args = ['query_result', '--submit_id', externalTaskId];
    const result = await run(resolve('dreamina'), args, { cwd, timeoutMs: 30000 });
    return parseDreaminaVideoResult(result, externalTaskId, args);
  }
  async function download({ externalTaskId, cwd } = {}) {
    if (!validExternalId(externalTaskId) || !path.isAbsolute(cwd ?? '')) throw new AppError('下载必须使用原任务ID和本地任务目录。');
    const directory = path.join(cwd, `download-attempt-${randomUUID()}`); fs.mkdirSync(directory, { recursive: true });
    const args = ['query_result', '--submit_id', externalTaskId, '--download_dir', directory];
    const result = await run(resolve('dreamina'), args, { cwd, timeoutMs: 120000 });
    const parsed = parseDreaminaVideoResult(result, externalTaskId, args), files = [];
    const walk = folder => { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) { const file = path.join(folder, entry.name); if (entry.isSymbolicLink()) continue; if (entry.isDirectory()) walk(file); else if (entry.isFile() && /\.(mp4|mov|webm)$/i.test(entry.name)) files.push(file); } };
    walk(directory);
    const actual = parsed.status === 'success' && files.length === 1 ? files[0] : null;
    return { ...parsed, path: actual, file: actual, files, downloadDirectory: directory, error: parsed.error ?? (parsed.status === 'success' && files.length !== 1 ? '官方下载未得到恰好一个实际视频文件；预览URL不作为下载文件，不重复生成。' : null) };
  }
  return { inspect, quote, submit, query, download, channel, nativeSubmissionEnabled, realSubmissionEnabled: nativeSubmissionEnabled };
}

export async function inspectDreaminaVideo(options) { return createDreaminaVideoAdapter(options).inspect(); }
