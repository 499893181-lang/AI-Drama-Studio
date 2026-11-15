import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { resolveExecutable, redact } from './tools.mjs';
import { AppError } from './store.mjs';

export const canvasVideoChannel = 'dreamina-canvas-node-video';
export const canvasVideoSubmissionEnabled = false;
const disabled = '本轮画布视频仅准备草稿与只读报价；尚未获准消费积分，confirm/run保持硬关闭。';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const nodeId = value => typeof value === 'string' && /^node_[0-9abcdefghjkmnpqrstvwxyz]{10}$/.test(value);
const sha = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const canvasPlanHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/** Strip credentials, personal identities and temporary/provider access material before persistence. */
export function sanitizeCanvasReceipt(value) {
  if (Array.isArray(value)) return value.map(sanitizeCanvasReceipt);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/token|secret|authorization|signed.?url|provider|payload|^(?:userId|displayName|teamId|teamName|availableCredits|credits|currentCanvas)$/i.test(key)).map(([key, item]) => [key, sanitizeCanvasReceipt(item)]));
  if (typeof value === 'string' && /^https?:/i.test(value) && value.includes('?')) return '[temporary URL omitted]';
  return value;
}

/** Non-JSON failures remain diagnosable without retaining access material. */
export function sanitizeCanvasDiagnostic(value) {
  const text = typeof value === 'string' ? value : '';
  try { return JSON.stringify(sanitizeCanvasReceipt(JSON.parse(text.trim().replace(/^\uFEFF/, '')))); } catch { /* Preserve redacted prose rather than an invented JSON response. */ }
  return redact(text).replace(/((?:creditConfirmationToken|credit-token|accessToken|refreshToken|signedUrl|providerPayload)[\s"'=:]+)[^\s,"'}]+/gi, '$1[REDACTED]');
}

/** Every run/receipt is immutable; top-level JSON files only point to latest records. */
export function createCanvasAuditRecorder(directory) {
  const root = path.resolve(directory), runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const runDirectory = path.join(root, 'runs', runId);
  fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
  fs.mkdirSync(runDirectory);
  const legacyDirectory = path.join(runDirectory, 'previous-top-level-json');
  fs.mkdirSync(legacyDirectory);
  // Preserve exact old receipts/pointers before any latest pointer is changed.
  // These are private ignored files; only sanitized new records may be exported.
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith('.json')) fs.copyFileSync(path.join(root, entry.name), path.join(legacyDirectory, entry.name), fs.constants.COPYFILE_EXCL);
  const counters = new Map();
  function write(name, value) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new AppError('审计收据名不合法。');
    const count = (counters.get(name) ?? 0) + 1; counters.set(name, count);
    const file = path.join(runDirectory, `${name}${count === 1 ? '' : `-${String(count).padStart(3, '0')}`}.json`);
    fs.writeFileSync(file, JSON.stringify(sanitizeCanvasReceipt(value), null, 2), { flag: 'wx' });
    return path.relative(root, file).split(path.sep).join('/');
  }
  function pointer(name, recordFile, summary = {}) {
    if (!['latest', 'inspection', 'check'].includes(name)) throw new AppError('只能更新审计汇总指针。');
    fs.writeFileSync(path.join(root, `${name}.json`), JSON.stringify({ runId, recordFile, ...sanitizeCanvasReceipt(summary) }, null, 2));
  }
  write('run', { runId, createdAt: new Date().toISOString(), generationEndpointsEnabled: false });
  return { runId, runDirectory, write, pointer };
}

export function assertCanvasPreparationArgs(args) {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw new AppError('CLI参数必须是字符串数组。');
  if (args.some(arg => /^--(?:run|yes|credit-token|credit-ceiling)(?:=|$)/.test(arg)) || args[0] === 'node' && ['run', 'confirm', 'promote', 'upscale', 'interpolate'].includes(args[1])) throw new AppError(disabled, 409);
  const command = args.slice(0, 3).join(' ');
  const allowed = args[0] === 'schema' || args[0] === 'version' || args[0] === 'auth' && ['status', 'account'].includes(args[1]) || args[0] === 'space' && args[1] === 'current' || args[0] === 'model' && args[1] === 'list' || args[0] === 'canvas' && ['ls', 'create'].includes(args[1]) || args[0] === 'resource' && ['get', 'upload'].includes(args[1]) || args[0] === 'node' && ['show', 'quote'].includes(args[1]) || ['node create image', 'node create video', 'node edit video'].includes(command);
  if (!allowed) throw new AppError('本轮只允许已核查的纯准备和只读命令。', 409);
  if (args[0] === 'canvas' && args[1] === 'create' && args.some(arg => /^--use(?:=|$)/.test(arg))) throw new AppError('测试画布不得改为当前生产画布。', 409);
  if (['node', 'resource'].includes(args[0]) && !args.includes('--project-id')) throw new AppError('必须显式绑定目标画布。');
  return args;
}

export function runCanvasPreparationCommand(binary, args, { timeoutMs = 30000 } = {}) {
  assertCanvasPreparationArgs(args);
  return new Promise(resolve => {
    if (!binary) { resolve({ exitCode: null, stdout: '', stderr: '未检测到dreamina-canvas。', timedOut: false }); return; }
    execFile(binary, args, { windowsHide: true, shell: false, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => resolve({ exitCode: error ? typeof error.code === 'number' ? error.code : null : 0, stdout: stdout ?? '', stderr: stderr ?? '', timedOut: !!error?.killed }));
  });
}

function envelope(result) {
  for (const text of [result?.stdout, result?.stderr, result?.output]) {
    if (typeof text !== 'string') continue;
    try { return JSON.parse(text.trim().replace(/^\uFEFF/, '')); } catch { /* Do not guess fields from prose. */ }
  }
  return null;
}

export function validateCanvasVideoPlan(plan, models) {
  if (!uuid(plan?.projectId) || !nodeId(plan?.nodeId) || !nodeId(plan?.sourceNodeId) || !uuid(plan?.sourceResourceId) || !sha(plan?.inputSha256)) throw new AppError('画布、节点、来源资源和本地文件Hash绑定不完整。');
  if (typeof plan.prompt !== 'string' || !plan.prompt.trim()) throw new AppError('运镜提示词不能为空。');
  const p = plan.parameters;
  if (!p || p.mode !== 'first_last_frame' || p.outputCount !== 1 || !['provider_default', 'mute_derivative'].includes(p.audioMode)) throw new AppError('本轮仅准备一个首帧视频候选；音频不声明原生静音。');
  const model = models?.find(item => item.type === 'video' && item.model === p.model);
  const mode = model?.modes?.find(item => item.name === p.mode && item.references?.min <= 1 && item.references?.max >= 1);
  if (!mode) throw new AppError('本次实际模型目录没有匹配的一张首帧模式。');
  for (const [flag, value] of [['--ratio', p.ratio], ['--resolution', p.resolution], ['--duration', p.durationSeconds], ['--count', p.outputCount], ['--prompt', plan.prompt]]) {
    const spec = mode.flags?.find(item => item.flag === flag);
    if (!spec || spec.values && !spec.values.includes(value) || spec.min != null && value < spec.min || spec.max != null && value > spec.max || spec.step != null && Math.abs((value - (spec.min ?? 0)) / spec.step - Math.round((value - (spec.min ?? 0)) / spec.step)) > 1e-8 || spec.maxLength != null && value.length > spec.maxLength) throw new AppError(`参数${flag}不符合本次实际模型目录。`);
  }
  return structuredClone(plan);
}

/** Pure save command. --resource-id would import an existing video and is intentionally absent. */
export function buildCanvasVideoDraftArgs(plan, updateId, { edit = false } = {}) {
  if (!uuid(updateId)) throw new AppError('保存前须持久化稳定updateId。');
  const p = plan.parameters;
  return assertCanvasPreparationArgs(['node', edit ? 'edit' : 'create', 'video', '--project-id', plan.projectId, '--node-id', plan.nodeId, '--update-id', updateId, '--title', 'AI-Drama-Studio TEST - pending video / NOT GENERATED', '--mode', p.mode, '--model', p.model, '--prompt', plan.prompt, '--ratio', p.ratio, '--resolution', p.resolution, '--duration', String(p.durationSeconds), '--count', String(p.outputCount), '--ref', `node:${plan.sourceNodeId}`, '--non-interactive']);
}

export function verifyCanvasVideoReadback(plan, response) {
  const nodes = response?.data?.nodes;
  const video = nodes?.find(item => item.result === 'FOUND' && item.node?.nodeId === plan.nodeId)?.node;
  const image = nodes?.find(item => item.result === 'FOUND' && item.node?.nodeId === plan.sourceNodeId)?.node;
  const p = plan.parameters, g = video?.generation;
  if (response?.ok !== true || video?.type !== 'video' || image?.type !== 'image' || image.status !== 'success' || image.resources?.length !== 1 || image.resources[0].resourceId !== plan.sourceResourceId || image.resources[0].status !== 'success' || image.resources[0].type !== 'image') throw new AppError('当前来源图片未就绪、资源版本不匹配或选片关系不明确，未报价。', 409);
  if (video.status !== 'empty' || !Array.isArray(video.resources) || video.resources.length !== 0) throw new AppError('本轮仅为明确未生成、无既有产物的empty草稿报价，其他状态须先核查原任务。', 409);
  if (!g || g.mode !== p.mode || g.model !== p.model || g.prompt !== plan.prompt || g.ratio !== p.ratio || g.resolution !== p.resolution || g.durationSeconds !== p.durationSeconds || g.outputCount !== p.outputCount || g.references?.length !== 1 || g.references[0].kind !== 'node' || g.references[0].id !== plan.sourceNodeId || g.references[0].type !== 'image' || g.references[0].writebackSupported !== true || !video.upstreamNodeIds?.includes(plan.sourceNodeId)) throw new AppError('保存后的节点、参数或引用已改变，不能将报价用于旧计划。', 409);
  return { draftVersion: response.data.draftVersion, planHash: canvasPlanHash(plan), videoStatus: video.status, videoResourceCount: video.resources?.length ?? 0 };
}

export function parseCanvasVideoQuote(plan, result, readback, checkedAt = new Date().toISOString()) {
  const response = envelope(result), data = response?.data, items = data?.items;
  const common = { channel: canvasVideoChannel, status: 'unknown', amount: null, currency: 'CREDITS', unit: 'maximum credits / this saved node run', expiresAt: null, officialQuoteId: null, cnyAmount: null, checkedAt, source: 'actual dreamina-canvas node quote', projectId: plan.projectId, nodeId: plan.nodeId, planHash: canvasPlanHash(plan), canSubmit: false, raw: sanitizeCanvasReceipt(response), requestId: response?.meta?.requestId ?? null };
  if (result?.exitCode !== 0 || result?.timedOut || response?.ok !== true || !Array.isArray(items) || items.length !== 1 || items[0].nodeId !== plan.nodeId || items[0].error || !Number.isInteger(items[0].maxCredits) || items[0].maxCredits < 0 || data.totalMaxCredits !== items[0].maxCredits || data.draftVersion !== readback?.draftVersion || readback.planHash !== common.planHash || readback.videoResourceCount !== 0) return { ...common, reason: '未得到同画布、同草稿版本、同单节点的完整权威报价；未知不是免费。' };
  if (data.consumptionSubject?.kind !== 'personal') return { ...common, reason: '本验收未核实团队消费主体，未报价授权。' };
  return { ...common, status: 'quoted_snapshot', amount: data.totalMaxCredits, itemMaxCredits: items[0].maxCredits, totalMaxCredits: data.totalMaxCredits, draftVersion: data.draftVersion, confirmable: data.confirmable ?? null, confirmationRequired: data.confirmationRequired ?? null, consumptionSubject: { kind: 'personal' }, conditions: ['只适用于此画布、此节点、此已保存草稿及当前账号上下文。', '报价不是授权或最终结算；运行前须重新读取输入与节点并取得最新报价。', '未返回有效期，不推算有效期；未验证实际运行准入。'], reason: '同节点运行前最大积分预估；不是实际扣费、人民币价格或direct渠道报价。' };
}

export function createCanvasVideoPreparationAdapter({ run = runCanvasPreparationCommand, resolve = resolveExecutable } = {}) {
  async function call(args) { assertCanvasPreparationArgs(args); return run(resolve('dreamina-canvas'), args); }
  async function inspect() {
    const commands = [['version'], ['schema'], ['auth', 'status'], ['auth', 'account'], ['space', 'current'], ['model', 'list', '--type', 'video']];
    const results = await Promise.all(commands.map(call));
    const [version, schema, auth, account, space, models] = results.map(envelope);
    const create = schema?.data?.subcommands?.find(c => c.name === 'node')?.subcommands?.find(c => c.name === 'create')?.subcommands?.find(c => c.name === 'video');
    const quote = schema?.data?.subcommands?.find(c => c.name === 'node')?.subcommands?.find(c => c.name === 'quote');
    const savingOnly = create?.summary === '创建视频节点，不触发生成' && create.flags?.some(flag => flag.name === 'run' && flag.default === 'false' && flag.constraints?.includes('when false, only save the draft'));
    return { checkedAt: new Date().toISOString(), channel: canvasVideoChannel, version: version?.data?.version ?? null, contractDetected: savingOnly && quote?.reads === true && quote?.writes === false, auth: { loggedIn: auth?.data?.loggedIn === true && account?.ok === true, region: auth?.data?.region ?? null, profile: auth?.data?.profile ?? null }, space: { kind: space?.data?.kind ?? null, hasTeamSpace: account?.data?.teamSpaceDiscovery?.hasTeamSpace ?? null }, models: models?.ok === true ? models.data?.items ?? [] : [], canSubmit: false, message: disabled };
  }
  async function saveDraft({ plan, updateId }) {
    const current = await inspect();
    if (!current.contractDetected || !current.auth.loggedIn || current.space.kind !== 'personal' || current.space.hasTeamSpace !== false) throw new AppError('实际Schema、认证或个人空间尚未核实，未保存草稿。', 409);
    validateCanvasVideoPlan(plan, current.models);
    const result = await call(buildCanvasVideoDraftArgs(plan, updateId));
    return { result: sanitizeCanvasReceipt(envelope(result)), exitCode: result.exitCode, timedOut: result.timedOut, canSubmit: false };
  }
  async function quote({ plan }) {
    const show = await call(['node', 'show', '--project-id', plan.projectId, '--node-id', plan.sourceNodeId, '--node-id', plan.nodeId]);
    if (show.exitCode !== 0 || show.timedOut) throw new AppError('回读失败，未请求新报价。', 409);
    const binding = verifyCanvasVideoReadback(plan, envelope(show));
    const result = await call(['node', 'quote', '--project-id', plan.projectId, '--node-id', plan.nodeId]);
    return parseCanvasVideoQuote(plan, result, binding);
  }
  async function submit() { throw new AppError(disabled, 409); }
  async function confirm() { throw new AppError(disabled, 409); }
  return { inspect, saveDraft, quote, submit, confirm, channel: canvasVideoChannel, canSubmit: false };
}

const defaultEvidenceFile = fileURLToPath(new URL('../docs/canvas-video-v08-evidence/check.json', import.meta.url));
/** Local archived DTO only. This function never invokes the CLI or treats a snapshot as authorization. */
export function readCanvasVideoEvidence({ evidenceFile = defaultEvidenceFile } = {}) {
  let record;
  try { record = JSON.parse(fs.readFileSync(path.resolve(evidenceFile), 'utf8')); } catch { return { checkedAt: null, channel: canvasVideoChannel, quote: { status: 'unknown', amount: null, currency: 'CREDITS', expiresAt: null }, canSubmit: false, message: '未找到可核查的画布渠道存档。' }; }
  const clean = sanitizeCanvasReceipt(record);
  return { ...clean, channel: canvasVideoChannel, archivedEvidence: true, canSubmit: false, quote: { ...(clean.quote ?? {}), canSubmit: false, authorization: 'not_granted' }, message: disabled };
}
