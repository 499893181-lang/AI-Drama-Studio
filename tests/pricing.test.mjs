import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { priceFromEvidence, createScriptPricing, unknownScriptPrice, assertScriptSpending, scriptQuoteFingerprint } from '../src/pricing.mjs';
import { Store } from '../src/store.mjs';
import { ScriptService } from '../src/scripts.mjs';

const fixedNow = Date.parse('2026-11-15T06:00:00.000Z');
const context = { kind: 'script', now: fixedNow };
// These are explicit offline policy fixtures, never claims about actual prices.
const record = (overrides = {}) => ({
  id: 'isolated-fixture-policy-not-real', channel: 'jimeng-novel-cli', actions: ['script'], billingType: 'free', amount: 0, currency: 'FREE', unit: '次',
  sources: [{ type: 'official_policy', url: 'https://jimeng.jianying.com/novel-cli', title: '[隔离夹具] 非真实官方价格', excerpt: '仅为隔离测试模拟CLI单集免费声明，不代表当前服务权益。' }],
  conditions: ['[隔离夹具] 只适用于指定CLI动作，不推论网页权益。'],
  verification: { verified: true, conditionsMet: true, checkedAt: new Date(fixedNow).toISOString(), basis: '[隔离夹具] 不是真实费用依据。' },
  validity: { kind: 'not_stated', expiresAt: null }, officialQuoteId: null,
  ...overrides,
});
const artifacts = path.resolve('tests/.artifacts');
fs.mkdirSync(artifacts, { recursive: true });
function temporary(t) {
  const root = fs.mkdtempSync(path.join(artifacts, 'pricing-'));
  t.after(() => { const resolved = fs.realpathSync(root); assert.ok(resolved.startsWith(fs.realpathSync(artifacts) + path.sep)); fs.rmSync(resolved, { recursive: true, force: true }); });
  return root;
}
function writeEvidence(root, records) { fs.mkdirSync(path.join(root, 'pricing'), { recursive: true }); fs.writeFileSync(path.join(root, 'pricing/script-evidence.json'), JSON.stringify({ records })); }

test('无官方费用记录时默认unknown，预算和余额不构成价格', async t => {
  const provider = createScriptPricing({ rootDir: temporary(t), now: () => fixedNow });
  const quote = await provider({ budgetCap: 999999, creditBalance: 999999 }, { kind: 'script' });
  assert.equal(quote.status, 'unknown'); assert.equal(quote.canSubmit, false); assert.equal(quote.amount, null); assert.equal(quote.officialQuoteId, null);
  assert.equal(quote.metering.basis, 'output_characters'); assert.equal(quote.metering.unitRate, null); assert.equal(quote.metering.prequoteAvailable, false);
  assert.equal(quote.validity.kind, 'not_stated'); assert.match(quote.sources[0].url, /M9ejwOcQwizqezkUhJEc4hc7nxf/);
});

test('明确CLI免费依据保留单位来源条件和未注明有效期，不生成官方quoteId', () => {
  const quote = priceFromEvidence(record(), context);
  assert.equal(quote.status, 'known'); assert.equal(quote.billingType, 'free'); assert.equal(quote.amount, 0); assert.equal(quote.currency, 'FREE');
  assert.equal(quote.unit, '次'); assert.ok(quote.sources.length); assert.ok(quote.conditions.length); assert.equal(quote.validity.kind, 'not_stated'); assert.equal(quote.expiresAt, null);
  assert.match(quote.evidenceId, /^local-evidence:[a-f0-9]{64}$/); assert.equal(quote.officialQuoteId, null); assert.equal(Object.hasOwn(quote, 'quoteId'), false);
});

test('网页权益、另一动作和未核验条件都不能推成当前CLI免费', () => {
  for (const candidate of [record({ channel: 'jimeng-web' }), record({ actions: ['outline'] }), record({ verification: { ...record().verification, verified: false } }), record({ verification: { ...record().verification, conditionsMet: false } })]) {
    assert.equal(priceFromEvidence(candidate, context).status, 'unknown');
  }
  assert.equal(priceFromEvidence(record(), { ...context, kind: 'outline' }).status, 'unknown');
});

test('账户专属权益必须和当前已核验scope一致，不能凭record自称匹配', () => {
  const candidate = record({ verification: { ...record().verification, accountScope: 'fixture-account-scope-hash' } });
  assert.equal(priceFromEvidence(candidate, context).status, 'unknown');
  assert.equal(priceFromEvidence(candidate, { ...context, verifiedAccountScope: 'another-account' }).status, 'unknown');
  assert.equal(priceFromEvidence(candidate, { ...context, verifiedAccountScope: 'fixture-account-scope-hash' }).status, 'known');
});

test('来源和有效期缺失、陈旧、未来或过期时阻断，官方未声明时不造到期时间', () => {
  const invalid = [
    record({ sources: [] }), record({ sources: [{ ...record().sources[0], url: 'https://example.com/free' }] }),
    record({ sources: [{ ...record().sources[0], url: 'https://jimeng.jianying.com/ai-tool/cli-auth?user_code=private-reference' }] }),
    record({ verification: { ...record().verification, checkedAt: new Date(fixedNow - 31 * 60000).toISOString() } }),
    record({ verification: { ...record().verification, checkedAt: new Date(fixedNow + 120000).toISOString() } }),
    record({ validity: { kind: 'until', expiresAt: 'bad-date' } }), record({ validity: { kind: 'until', expiresAt: new Date(fixedNow - 1).toISOString() } }),
    record({ validity: { kind: 'not_stated', expiresAt: new Date(fixedNow + 100000).toISOString() } }),
  ];
  for (const candidate of invalid) assert.equal(priceFromEvidence(candidate, context).status, 'unknown');
  const valid = priceFromEvidence(record({ validity: { kind: 'until', expiresAt: new Date(fixedNow + 60000).toISOString() } }), context);
  assert.equal(valid.status, 'known'); assert.equal(valid.expiresAt, new Date(fixedNow + 60000).toISOString());
});

test('积分与人民币依据明确保留各自金额和单位，不推币种或汇率', () => {
  const points = priceFromEvidence(record({ billingType: 'credits', amount: 4, currency: 'CREDITS', unit: '积分' }), context);
  const money = priceFromEvidence(record({ billingType: 'money', amount: 2.5, currency: 'CNY', unit: '人民币元' }), context);
  assert.equal(points.status, 'known'); assert.equal(points.currency, 'CREDITS'); assert.equal(points.amount, 4);
  assert.equal(money.status, 'known'); assert.equal(money.currency, 'CNY'); assert.equal(money.amount, 2.5);
  for (const candidate of [record({ billingType: 'money', amount: 2.5, currency: 'USD', unit: '人民币元' }), record({ billingType: 'credits', amount: 4, currency: 'CNY', unit: '积分' }), record({ billingType: 'money', amount: 2.5, currency: 'CNY', unit: undefined })]) assert.equal(priceFromEvidence(candidate, context).status, 'unknown');
});

test('官方回执来源必须有实际字段路径和回执摘要，不推会员等级为脚本权益', () => {
  const source = { type: 'official_account_receipt', command: 'jimeng-novel account get -j', title: '隔离回执', fieldPath: 'fixture.explicit_script_billing', sha256: 'a'.repeat(64), excerpt: '隔离字段示例，不是真实账号权益。' };
  assert.equal(priceFromEvidence(record({ sources: [source] }), context).status, 'known');
  assert.equal(priceFromEvidence(record({ sources: [{ ...source, fieldPath: undefined }] }), context).status, 'unknown');
  assert.equal(priceFromEvidence(record({ sources: [{ ...source, sha256: undefined }] }), context).status, 'unknown');
});

test('最新适用记录撤销或损坏时不能回退旧免费价格，大纲和单集分别定价', async t => {
  const root = temporary(t), provider = createScriptPricing({ rootDir: root, now: () => fixedNow });
  writeEvidence(root, [record(), record({ verification: { ...record().verification, verified: false } })]);
  assert.equal((await provider({}, { kind: 'script' })).status, 'unknown');
  writeEvidence(root, [record(), null]); assert.equal((await provider({}, { kind: 'script' })).status, 'unknown');
  writeEvidence(root, [record({ actions: ['outline'] })]);
  assert.equal((await provider({}, { kind: 'outline' })).status, 'known'); assert.equal((await provider({}, { kind: 'script' })).status, 'unknown');
});

test('免费无需货币预算；积分上限不能被人民币替代，预留分别按单位累计', () => {
  const project = { id: 'fixture-project', budgetCap: 5 }, workspace = { spendingLimits: { credits: 10 } };
  const free = priceFromEvidence(record(), context);
  assert.doesNotThrow(() => assertScriptSpending({ quote: free, project: { ...project, budgetCap: null }, workspace: {} }));
  const credits = priceFromEvidence(record({ billingType: 'credits', amount: 4, currency: 'CREDITS', unit: '积分' }), context);
  const money = priceFromEvidence(record({ billingType: 'money', amount: 2, currency: 'CNY', unit: '人民币元' }), context);
  const tasks = [{ projectId: project.id, submittedAt: 'fixture', cost: { amount: 1000, currency: 'CNY' } }, { projectId: project.id, submittedAt: 'fixture', cost: { amount: 5, currency: 'CREDITS' } }];
  assert.equal(assertScriptSpending({ quote: credits, project, workspace, tasks }).reserved, 5);
  assert.throws(() => assertScriptSpending({ quote: credits, project, workspace: {}, tasks }), /积分预算/);
  assert.throws(() => assertScriptSpending({ quote: credits, project, workspace: { spendingLimits: { credits: 8 } }, tasks }), /超过积分/);
  assert.equal(assertScriptSpending({ quote: money, project, workspace, tasks: tasks.slice(1) }).reserved, 0);
  assert.throws(() => assertScriptSpending({ quote: money, project, workspace, tasks }), /超过项目预算/);
});

test('指纹包含动作、单位、来源与适用条件，本地标识不冒充官方编号', () => {
  const quote = priceFromEvidence(record(), context);
  assert.notEqual(scriptQuoteFingerprint(quote), scriptQuoteFingerprint({ ...quote, kind: 'outline' }));
  assert.notEqual(scriptQuoteFingerprint(quote), scriptQuoteFingerprint({ ...quote, conditions: ['changed'] }));
  assert.notEqual(scriptQuoteFingerprint(quote), scriptQuoteFingerprint({ ...quote, unit: '积分' }));
});

test('服务默认provider读取私有证据且分别展示动作价格，不接受HTTP内容作为报价', async t => {
  const root = temporary(t), store = new Store(root);
  const project = store.create({ name: '隔离报价集成', idea: '仅为测试。', budgetCap: null, creativeBrief: { synopsis: '测试梗概', background: '测试背景', characters: '测试人物', conflict: '测试冲突', emotion: '测试情绪', ending: '测试结局', preservedContent: ['测试锁定'], addedSettings: [] } });
  writeEvidence(root, [record({ actions: ['outline'], verification: { ...record().verification, checkedAt: new Date().toISOString() } })]);
  let calls = 0;
  const adapter = { async inspect() { return { installed: true, loggedIn: true }; }, async verifyBinding(binding) { return { ...binding, verified: true }; }, async submit() { calls++; return { status: 'running', threadId: 'fixture-thread', runId: 'fixture-run', body: null, receipt: {}, error: null }; } };
  const service = new ScriptService(store, { adapter, reviewer: { close() {} } }); t.after(() => service.close());
  const view = await service.view(project.id);
  assert.equal(view.costEstimates.outline.currency, 'FREE'); assert.equal(view.costEstimates.script.status, 'unknown');
  let workspace = service.workspace.update(project.id, { revision: 0, binding: { projectId: 'fixture-canvas', teamId: '' } });
  workspace = await service.verifyBinding(project.id, workspace.revision);
  workspace = service.workspace.update(project.id, { revision: workspace.revision, spendingLimits: { credits: 42 } });
  assert.equal(new Store(root).read('scripts', project.id).spendingLimits.credits, 42);
  assert.throws(() => service.workspace.update(project.id, { revision: workspace.revision, spendingLimits: { credits: -1 } }), /积分预算/);
  const script = await service.prepare(project.id, { revision: workspace.revision, kind: 'script', cost: { status: 'known', canSubmit: true, amount: 0 } });
  await assert.rejects(service.submit(script.id, { confirm: true, cost: { status: 'known', amount: 0, currency: 'FREE' } }), /费用待确认/);
  assert.equal(calls, 0);
  const outline = await service.prepare(project.id, { revision: workspace.revision, kind: 'outline' });
  assert.equal(outline.cost.currency, 'FREE');
  await service.submit(outline.id, { confirm: true });
  for (let i = 0; i < 30 && !calls; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(calls, 1); // A fixture adapter only; never runs a real command.
});
