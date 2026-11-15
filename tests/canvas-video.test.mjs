import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertCanvasPreparationArgs, buildCanvasVideoDraftArgs, canvasPlanHash, createCanvasAuditRecorder, createCanvasVideoPreparationAdapter, parseCanvasVideoQuote, readCanvasVideoEvidence, sanitizeCanvasReceipt, sanitizeCanvasDiagnostic, validateCanvasVideoPlan, verifyCanvasVideoReadback } from '../src/canvas-video.mjs';

// ISOLATED FIXTURES: no external canvas or generation task is created by this file.
const plan = { projectId: '11111111-1111-4111-8111-111111111111', nodeId: 'node_0123456789', sourceNodeId: 'node_abcdefghjk', sourceResourceId: '22222222-2222-4222-8222-222222222222', inputSha256: 'a'.repeat(64), prompt: 'ISOLATED TEST ONLY', parameters: { mode: 'first_last_frame', model: 'fixture_model', ratio: '16:9', resolution: '720p', durationSeconds: 5, outputCount: 1, audioMode: 'mute_derivative' } };
const models = [{ type: 'video', model: 'fixture_model', modes: [{ name: 'first_last_frame', references: { min: 1, max: 1 }, flags: [{ flag: '--ratio', values: ['16:9'] }, { flag: '--resolution', values: ['720p'] }, { flag: '--duration', min: 4, max: 15, step: 1 }, { flag: '--count', min: 1, max: 1 }, { flag: '--prompt', maxLength: 5000 }] }] }];
const node = () => ({ ok: true, data: { draftVersion: 2, nodes: [{ result: 'FOUND', node: { nodeId: plan.sourceNodeId, type: 'image', status: 'success', resources: [{ resourceId: plan.sourceResourceId, status: 'success', type: 'image' }] } }, { result: 'FOUND', node: { nodeId: plan.nodeId, type: 'video', status: 'empty', resources: [], upstreamNodeIds: [plan.sourceNodeId], generation: { ...plan.parameters, prompt: plan.prompt, references: [{ kind: 'node', id: plan.sourceNodeId, type: 'image', writebackSupported: true }] } } }] } });
const quoteResponse = () => ({ ok: true, data: { consumptionSubject: { kind: 'personal', userId: 'PRIVATE' }, items: [{ nodeId: plan.nodeId, maxCredits: 70 }], totalMaxCredits: 70, draftVersion: 2, confirmable: true, confirmationRequired: true }, meta: { requestId: 'fixture-only' } });
const result = value => ({ exitCode: 0, stdout: JSON.stringify(value) });

test('preparation allowlist refuses every generation/approval route before subprocess work', () => {
  for (const args of [['node', 'run'], ['node', 'confirm'], ['node', 'create', 'video', '--run'], ['node', 'create', 'video', '--run=true'], ['canvas', 'create', 'test', '--use'], ['node', 'quote'], ['node', 'create', 'video', '--credit-ceiling=100'], ['resource', 'download'], ['node', 'show', '--yes']]) assert.throws(() => assertCanvasPreparationArgs(args));
  assert.doesNotThrow(() => assertCanvasPreparationArgs(['node', 'quote', '--project-id', plan.projectId, '--node-id', plan.nodeId]));
});
test('native submission and confirmation remain non-configurably closed', async () => {
  let calls = 0;
  const adapter = createCanvasVideoPreparationAdapter({ run: () => { calls++; }, resolve: () => { calls++; } });
  await assert.rejects(adapter.submit({ creditCeiling: 100 }), /硬关闭/);
  await assert.rejects(adapter.confirm({ creditCeiling: 100 }), /硬关闭/);
  assert.equal(calls, 0);
});
test('dynamic model directory validates single first-frame dimensions, range and audio semantics', () => {
  assert.deepEqual(validateCanvasVideoPlan(plan, models), plan);
  for (const change of [{ resolution: '1080p' }, { durationSeconds: 4.5 }, { model: 'unverified' }, { audioMode: 'native_off' }, { outputCount: 2 }]) assert.throws(() => validateCanvasVideoPlan({ ...plan, parameters: { ...plan.parameters, ...change } }, models));
  assert.throws(() => validateCanvasVideoPlan({ ...plan, inputSha256: null }, models));
});
test('draft command prepares generation rather than importing an existing video', () => {
  const args = buildCanvasVideoDraftArgs(plan, '33333333-3333-4333-8333-333333333333');
  assert.deepEqual(args.slice(0, 3), ['node', 'create', 'video']);
  assert.ok(args.includes(`node:${plan.sourceNodeId}`));
  for (const flag of ['--run', '--resource-id', '--import-kind', '--credit-token', '--credit-ceiling', '--yes']) assert.equal(args.includes(flag), false);
});
test('readback checks real reference identity, source resource, readiness, upstream and full generation', () => {
  assert.equal(verifyCanvasVideoReadback(plan, node()).draftVersion, 2);
  for (const mutate of [r => r.data.nodes[0].node.status = 'failed', r => r.data.nodes[0].node.resources[0].resourceId = 'changed', r => r.data.nodes[1].node.generation.prompt = 'edited', r => r.data.nodes[1].node.generation.references[0].id = 'changed', r => r.data.nodes[1].node.upstreamNodeIds = [], r => r.data.nodes[1].node.generation.references[0].writebackSupported = false]) { const r = node(); mutate(r); assert.throws(() => verifyCanvasVideoReadback(plan, r)); }
});
test('preparation quote refuses running/failed/unknown video state or absent/existing products', () => {
  for (const status of ['running', 'failed', 'success', undefined]) { const r = node(); r.data.nodes[1].node.status = status; assert.throws(() => verifyCanvasVideoReadback(plan, r), /empty/); }
  for (const resources of [undefined, null, [{ resourceId: 'old' }]]) { const r = node(); r.data.nodes[1].node.resources = resources; assert.throws(() => verifyCanvasVideoReadback(plan, r), /empty/); }
  const r = node(); r.data.nodes[0].node.resources.unshift({ resourceId: 'new-selected', status: 'success', type: 'image' }); assert.throws(() => verifyCanvasVideoReadback(plan, r), /选片关系不明确/);
});
test('quote is same-node saved-version maximum credit snapshot; no invented expiry, quoteId or qualification', () => {
  const q = parseCanvasVideoQuote(plan, result(quoteResponse()), verifyCanvasVideoReadback(plan, node()), '2026-11-16T00:00:00Z');
  assert.equal(q.status, 'quoted_snapshot'); assert.equal(q.amount, 70); assert.equal(q.totalMaxCredits, 70); assert.equal(q.canSubmit, false); assert.equal(q.expiresAt, null); assert.equal(q.officialQuoteId, null); assert.equal(q.cnyAmount, null);
  assert.equal(q.raw.data.consumptionSubject.userId, undefined);
});
test('partial quote, wrong node/version, unknown, timeout, team and already generated record fail closed', () => {
  for (const mutate of [r => r.data.items[0].nodeId = 'wrong', r => r.data.draftVersion++, r => r.data.totalMaxCredits++, r => r.data.items.push(r.data.items[0]), r => r.data.items[0].error = { serviceCode: 2 }, r => delete r.data.items[0].maxCredits, r => r.data.consumptionSubject.kind = 'team']) { const r = quoteResponse(); mutate(r); assert.equal(parseCanvasVideoQuote(plan, result(r), verifyCanvasVideoReadback(plan, node())).status, 'unknown'); }
  assert.equal(parseCanvasVideoQuote(plan, { exitCode: 0, stdout: 'success' }, verifyCanvasVideoReadback(plan, node())).amount, null);
  assert.equal(parseCanvasVideoQuote(plan, { ...result(quoteResponse()), timedOut: true }, verifyCanvasVideoReadback(plan, node())).status, 'unknown');
  assert.equal(parseCanvasVideoQuote(plan, result(quoteResponse()), { ...verifyCanvasVideoReadback(plan, node()), videoResourceCount: 1 }).status, 'unknown');
});
test('quote adapter re-reads both nodes and never requests quote if binding changed', async () => {
  const calls = [];
  const adapter = createCanvasVideoPreparationAdapter({ resolve: () => 'fixture-executable', run: async (_, args) => { calls.push(args); const r = node(); r.data.nodes[1].node.generation.prompt = 'new requirement'; return result(r); } });
  await assert.rejects(adapter.quote({ plan }), /已改变/);
  assert.equal(calls.length, 1); assert.equal(calls[0][1], 'show');
});
test('receipt sanitizer preserves fee units while excluding identities, tokens, payload and signedURL', () => {
  const r = sanitizeCanvasReceipt({ totalMaxCredits: 70, itemMaxCredits: 70, userId: 'private', providerPayload: 'secret', creditConfirmationToken: 'secret', credits: { available: 636 }, webUrl: 'https://example.test/canvas/id', downloadUrl: 'https://example.test/file?token=secret' });
  assert.equal(r.totalMaxCredits, 70); assert.equal(r.itemMaxCredits, 70); assert.equal(r.userId, undefined); assert.equal(r.providerPayload, undefined); assert.equal(r.creditConfirmationToken, undefined); assert.equal(r.credits, undefined); assert.equal(r.downloadUrl, '[temporary URL omitted]');
});
test('archived evidence DTO never enables submission or accepts archived authorization', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-evidence-')), file = path.join(directory, 'check.json');
  try { fs.writeFileSync(file, JSON.stringify({ canSubmit: true, quote: { amount: 70, authorization: 'granted', creditConfirmationToken: 'secret' }, auth: { loggedIn: true, userId: 'private' } })); const dto = readCanvasVideoEvidence({ evidenceFile: file }); assert.equal(dto.canSubmit, false); assert.equal(dto.quote.authorization, 'not_granted'); assert.equal(dto.quote.creditConfirmationToken, undefined); assert.equal(dto.auth.userId, undefined); assert.equal(dto.archivedEvidence, true); assert.equal(readCanvasVideoEvidence({ evidenceFile: path.join(directory, 'absent') }).quote.amount, null); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('plan hash binds input, source, prompt and channel parameters deterministically', () => {
  assert.equal(canvasPlanHash(plan), canvasPlanHash({ parameters: plan.parameters, ...plan }));
  assert.notEqual(canvasPlanHash(plan), canvasPlanHash({ ...plan, inputSha256: 'b'.repeat(64) }));
});
test('audit runs append receipts with exclusive creation and archive legacy JSON before pointer changes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-audit-'));
  try {
    const legacy = '{"oldReceipt":"must remain byte-for-byte"}';
    fs.writeFileSync(path.join(directory, 'check.json'), legacy);
    fs.writeFileSync(path.join(directory, 'state.json'), '{"projectId":"stable"}');
    const first = createCanvasAuditRecorder(directory);
    const a = first.write('quote', { amount: 70 }), b = first.write('quote', { amount: 71 });
    assert.notEqual(a, b);
    assert.equal(fs.readFileSync(path.join(first.runDirectory, 'previous-top-level-json', 'check.json'), 'utf8'), legacy);
    first.pointer('check', a);
    const second = createCanvasAuditRecorder(directory);
    const c = second.write('quote', { amount: 72 }); second.pointer('check', c);
    assert.notEqual(first.runId, second.runId);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, a))).amount, 70);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, b))).amount, 71);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, c))).amount, 72);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'state.json'))).projectId, 'stable');
    assert.throws(() => second.write('../escape', {}));
    assert.throws(() => second.pointer('quote', c));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('non-JSON startup/timeout diagnostics retain error evidence with secrets redacted', () => {
  const text = sanitizeCanvasDiagnostic('spawn ENOENT; timeout; Bearer SECRET; creditConfirmationToken=PRIVATE; https://example.test/file?signature=PRIVATE');
  assert.ok(text.includes('spawn ENOENT')); assert.ok(text.includes('timeout'));
  assert.equal(text.includes('SECRET'), false); assert.equal(text.includes('PRIVATE'), false);
  const json = JSON.parse(sanitizeCanvasDiagnostic('{"ok":false,"creditConfirmationToken":"PRIVATE","error":{"code":"timeout"}}'));
  assert.equal(json.error.code, 'timeout'); assert.equal(json.creditConfirmationToken, undefined);
});
