import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AppError } from './store.mjs';

const officialHosts = new Set(['jimeng.jianying.com', 'bytedance.larkoffice.com', 'bytedance.feishu.cn']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && !!value.trim();
const timestamp = value => typeof value === 'string' ? Date.parse(value) : NaN;
const localId = value => `local-evidence:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

export function unknownScriptPrice(kind = 'script', basis) {
  const action = kind === 'outline' ? 'script outline' : 'script episode';
  return {
    status: 'unknown', kind, channel: 'jimeng-novel-cli', label: '费用待确认', billingType: null, amount: null, currency: null, unit: null,
    basis: basis ?? `官方指南说明剧本按产出字数计费且不支持总价预检；尚未明确${action}在当前账号CLI渠道的每字单价、计费币种及免费权益，不能计算本次总价。网页免费、余额或媒体节点估价不能代替该依据。`,
    metering: { basis: 'output_characters', unit: '字', unitRate: null, prequoteAvailable: false },
    sources: [{ type: 'official_policy', url: 'https://bytedance.larkoffice.com/wiki/M9ejwOcQwizqezkUhJEc4hc7nxf', title: '即梦短剧CLI官方指南，第6节及第8节', summary: '剧本按产出字数计费且不支持总价预检；未知报价不代表免费。', observedDate: '2026-11-15' }],
    conditions: [`仅针对jimeng-novel CLI的${action}，不推广网页权益或另一剧本动作。`, '当前仍缺每字单价、计费币种与账号适用条件，不能据计量规则推算人民币、积分或免费。'],
    checkedAt: null, validity: { kind: 'not_stated', expiresAt: null }, evidenceId: null, officialQuoteId: null, canSubmit: false,
  };
}

function validSource(source) {
  if (!object(source) || !text(source.title) || !text(source.excerpt)) return false;
  if (source.type === 'official_policy') {
    try {
      const url = new URL(source.url);
      const privateQuery = [...url.searchParams.keys()].some(key => /token|cookie|authorization|device.?code|user.?code|verification.?uri|password|secret/i.test(key));
      return url.protocol === 'https:' && officialHosts.has(url.hostname) && !url.username && !url.password && !privateQuery && !/token|device.?code|user.?code|verification.?uri/i.test(url.hash);
    } catch { return false; }
  }
  if (!['official_account_receipt', 'official_cli_help'].includes(source.type)) return false;
  if (!text(source.command) || !source.command.startsWith('jimeng-novel ') || !/^[a-f0-9]{64}$/i.test(source.sha256 ?? '')) return false;
  return source.type !== 'official_account_receipt' || text(source.fieldPath);
}

/** Validates evidence structure/applicability. A human must verify the quoted price claim. */
export function priceFromEvidence(record, { kind, verifiedAccountScope, now = Date.now(), maxEvidenceAgeMs = 30 * 60 * 1000 } = {}) {
  const fail = reason => unknownScriptPrice(kind, reason);
  if (!['outline', 'script'].includes(kind)) return fail('没有明确选择大纲或单集剧本动作，不能套用另一动作的价格。');
  if (!object(record) || record.channel !== 'jimeng-novel-cli' || !Array.isArray(record.actions) || !record.actions.includes(kind) || record.actions.some(action => !['outline', 'script'].includes(action))) return fail('费用依据未明确适用于本次CLI渠道和动作。');
  if (record.verification?.verified !== true || record.verification?.conditionsMet !== true || !text(record.verification?.basis)) return fail('费用依据尚未完成来源与适用条件核验。');
  const checkedAt = timestamp(record.verification.checkedAt);
  if (!Number.isFinite(checkedAt) || checkedAt > now + 60000 || now - checkedAt > maxEvidenceAgeMs) return fail('费用依据未记录有效检查时间，或已超过本地复核窗口；这不代表官方有效期。');
  const accountScope = record.verification.accountScope;
  if (accountScope !== undefined && accountScope !== null && (!text(accountScope) || !text(verifiedAccountScope) || accountScope !== verifiedAccountScope)) return fail('账户专属权益尚未与当前已验证账户范围匹配。');
  if (!Array.isArray(record.sources) || !record.sources.length || !record.sources.every(validSource)) return fail('费用依据缺少可追溯的官方来源或实际回执证据。');
  if (!Array.isArray(record.conditions) || !record.conditions.length || record.conditions.some(condition => !text(condition) || condition.length > 4000)) return fail('费用依据未明确记录适用条件。');
  const validity = record.validity;
  if (!object(validity) || !['until', 'not_stated'].includes(validity.kind)) return fail('费用依据的官方有效期尚未明确记录。');
  let expiresAt = null;
  if (validity.kind === 'until') {
    const expiry = timestamp(validity.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now || expiry < checkedAt) return fail('官方费用依据已过期或有效期格式不正确。');
    expiresAt = validity.expiresAt;
  } else if (validity.expiresAt !== null && validity.expiresAt !== undefined) return fail('官方未注明有效期时不能填写推算的官方到期时间。');
  const definitions = { free: { currency: 'FREE', unit: '次' }, credits: { currency: 'CREDITS', unit: '积分' }, money: { currency: 'CNY', unit: '人民币元' } };
  const definition = definitions[record.billingType];
  if (!definition || typeof record.amount !== 'number' || !Number.isFinite(record.amount) || record.amount < 0 || (record.billingType === 'free' && record.amount !== 0) || record.unit !== definition.unit || (record.currency !== undefined && record.currency !== definition.currency)) return fail('费用类型、金额或计费单位无效；不推算币种或汇率。');
  if (record.officialQuoteId !== null && record.officialQuoteId !== undefined && !text(record.officialQuoteId)) return fail('官方报价编号格式不正确；没有官方编号时必须留空。');
  const label = record.billingType === 'free' ? '已核实本次CLI调用免费' : `${record.amount} ${definition.unit} / 本次${kind === 'outline' ? '大纲' : '单集剧本'}`;
  return {
    status: 'known', kind, channel: record.channel, label, billingType: record.billingType,
    amount: record.amount, currency: definition.currency, unit: definition.unit,
    basis: record.verification.basis, sources: structuredClone(record.sources), conditions: [...record.conditions],
    checkedAt: record.verification.checkedAt, validity: { kind: validity.kind, expiresAt }, expiresAt,
    evidenceId: localId(record), evidenceKind: 'locally-recorded-official-evidence',
    officialQuoteId: record.officialQuoteId ?? null, canSubmit: true,
  };
}

export function createScriptPricing({ rootDir, now = () => Date.now(), maxEvidenceAgeMs = 30 * 60 * 1000, getContext } = {}) {
  if (!text(rootDir)) throw new AppError('费用证据数据目录未配置。');
  const file = path.join(path.resolve(rootDir), 'pricing', 'script-evidence.json');
  return async (project, context = {}) => {
    const kind = context.kind ?? 'script';
    let document;
    try { document = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { return unknownScriptPrice(kind, error.code === 'ENOENT' ? undefined : '本地费用证据损坏或不可读，保留原件并停止提交。'); }
    if (!object(document) || !Array.isArray(document.records)) return unknownScriptPrice(kind, '费用证据结构无效，不能形成可提交价格。');
    if (document.records.some(record => !object(record) || (record.channel === 'jimeng-novel-cli' && !Array.isArray(record.actions)))) return unknownScriptPrice(kind, '费用证据中存在损坏记录，不能回退到旧价格。');
    let extra = {};
    try { extra = getContext ? await getContext(project, context) : {}; }
    catch { return unknownScriptPrice(kind, '当前账户或渠道适用条件未能再次核验，停止提交。'); }
    const current = { ...context, ...extra, kind, now: now(), maxEvidenceAgeMs };
    for (const record of [...document.records].reverse()) {
      if (!object(record) || record.channel !== 'jimeng-novel-cli' || !Array.isArray(record.actions) || !record.actions.includes(kind)) continue;
      // The newest applicable record wins, including revocation/expiry; never
      // fall back to an older cheaper/free policy after a newer one is invalid.
      return priceFromEvidence(record, current);
    }
    return unknownScriptPrice(kind);
  };
}

export const scriptQuoteFingerprint = value => JSON.stringify({
  status: value?.status, billingType: value?.billingType, amount: value?.amount, currency: value?.currency,
  unit: value?.unit, basis: value?.basis, evidenceId: value?.evidenceId, officialQuoteId: value?.officialQuoteId,
  // quoteId is recognized only for existing explicitly injected test/provider contracts.
  quoteId: value?.quoteId, expiresAt: value?.expiresAt, checkedAt: value?.checkedAt,
  channel: value?.channel, kind: value?.kind, sources: value?.sources, conditions: value?.conditions, validity: value?.validity, canSubmit: value?.canSubmit,
});

export function assertScriptSpending({ quote, project, workspace, tasks = [], now = Date.now() }) {
  if (quote?.status !== 'known' || quote.canSubmit !== true || typeof quote.amount !== 'number' || !Number.isFinite(quote.amount) || quote.amount < 0 || !text(quote.basis) || !(text(quote.evidenceId) || text(quote.officialQuoteId) || text(quote.quoteId))) throw new AppError('费用待确认：未取得适用于本次CLI剧本动作的可核验费用依据，工作台不会提交。', 409);
  if (quote.expiresAt && (!Number.isFinite(timestamp(quote.expiresAt)) || timestamp(quote.expiresAt) <= now)) throw new AppError('本次费用依据已过期或有效期不正确，请重新核对。', 409);
  if (quote.currency === 'FREE') {
    if (quote.billingType !== 'free' || quote.amount !== 0) throw new AppError('免费依据与计费金额不一致，未提交。', 409);
    return { unit: 'FREE', cap: null, reserved: 0, amount: 0 };
  }
  let cap;
  if (quote.currency === 'CNY') cap = project.budgetCap;
  else if (quote.currency === 'CREDITS') cap = workspace.spendingLimits?.credits;
  else throw new AppError('费用待确认：计费单位无法确认，禁止推算人民币或积分兑换率。', 409);
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap < 0) throw new AppError(quote.currency === 'CREDITS' ? '请先明确本项目的积分预算上限；人民币预算不能替代积分上限。' : '请先在立项页面设置人民币预算上限，并重新整理剧本输入。', 409);
  const reserved = tasks.filter(task => task.projectId === project.id && task.submittedAt && task.cost?.currency === quote.currency).reduce((sum, task) => sum + (typeof task.cost.amount === 'number' && Number.isFinite(task.cost.amount) ? task.cost.amount : 0), 0);
  if (reserved + quote.amount > cap) throw new AppError(`本次费用与已预留费用合计${quote.currency === 'CREDITS' ? '超过积分预算' : '超过项目预算（人民币）'}，未提交。`, 409);
  return { unit: quote.currency, cap, reserved, amount: quote.amount };
}
