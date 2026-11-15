// Allowlist export of this independent, non-personal acceptance only.
// Never exports authentication, account identity, raw protocol logs or base64.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const lines = file => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const state = read('tests/.artifacts/auto-image-real/receipt.json');
const data = path.resolve('data/auto-image-acceptance');
const job = read(path.join(data, 'image-generation-jobs', `${state.taskId}.json`));
const runtime = path.join(data, 'runtime/image-generation', job.id);
const eventFile = path.join(runtime, 'official-rpc/events.jsonl');
const requestFile = path.join(runtime, 'official-rpc/requests.jsonl');
const events = lines(eventFile), requests = lines(requestFile);
const images = events.filter(event => event.method === 'item/completed' && event.params?.item?.type === 'imageGeneration');
assert.equal(images.length, 1); assert.equal(requests.filter(event => event.method === 'turn/start').length, 1);
const event = images[0], image = event.params.item;
const outputBytes = fs.readFileSync(path.resolve(state.retainedImage.path));
assert.equal(hash(outputBytes), state.retainedImage.sha256);
assert.equal(hash(Buffer.from(image.result, 'base64')), hash(outputBytes));
assert.equal(job.status, 'failed'); assert.equal(job.result, null);
assert.equal(fs.existsSync(path.join(data, 'runtime/image-generation', `${job.id}-host-control/guard/image-call.accepted.json`)), false);
const rate = value => value ? { primary: value.primary ? { usedPercent: value.primary.usedPercent, windowDurationMins: value.primary.windowDurationMins, resetsAt: value.primary.resetsAt } : null, credits: value.credits ? { hasCredits: value.credits.hasCredits, unlimited: value.credits.unlimited, balance: value.credits.balance } : null, planType: value.planType ?? null } : null;
const after = state.failureEvidence.accountUsageNotifications.at(-1)?.rateLimits;
const regression = fs.readFileSync('tests/.artifacts/auto-image-v06/full-regression-final.txt', 'utf8');
const count = name => Number(regression.match(new RegExp(`(?:ℹ|#) ${name} (\\d+)`))?.[1]);
assert.equal(count('fail'), 0); assert.ok(count('pass') >= 171);
const report = (file, fixture = true) => { const value = read(file); assert.equal(value.passed ?? value.browserChecksPassed, true); return { isolatedFixtureOnly: fixture, at: value.finishedAt ?? value.at, passed: true, consoleExceptions: value.consoleExceptions ?? 0, newRealCalls: 0, checks: value.checks }; };
const beforeFiles = read('tests/.artifacts/auto-image-v06/preservation-before.json');
for (const original of beforeFiles) {
  const file = path.resolve(original.root, original.relative.replace(/^[\\/]+/, ''));
  assert.equal(hash(fs.readFileSync(file)).toUpperCase(), original.hash, '原有数据必须保持原字节');
}
const browser = read('tests/.artifacts/auto-image-real/retained-browser.json');
const evidence = {
  schemaVersion: 1, checkedAt: new Date().toISOString(), baseCommit: '218772af36166705958e42a31a31e6ac171ebfd1', implementationBranch: 'codex/auto-image-v06-20261115',
  overall: 'partial_real_acceptance_blocked', automaticAcceptancePassed: false, automaticSubmitEnabled: false,
  regression: { command: 'node --test tests/*.test.mjs', tests: count('tests'), passed: count('pass'), failed: count('fail'), actualModelOrImageCalls: 0 },
  preservation: { existingWorktrees: 3, preexistingDataFiles: beforeFiles.length, unchanged: beforeFiles.length, authenticationReadOrChanged: false, originalServicesPreserved: true },
  real: { projectId: job.projectId, taskId: job.id, packetId: job.packetId, requestId: job.requestId, submittedAt: job.submittedAt, status: job.status, error: job.error, threadId: event.params.threadId, turnId: event.params.turnId,
    actualModelTurns: 1, imageToolStarted: events.filter(item => item.method === 'item/started' && item.params?.item?.type === 'imageGeneration').length, imageToolCompleted: images.length, actualImages: 1,
    officialImageEvent: { type: image.type, id: image.id, generationId: image.generationId, status: image.status, hasSavedPath: !!image.savedPath, hasBase64Result: !!image.result, hasInputImagesField: Object.hasOwn(image, 'inputImages'), inputImages: image.inputImages ?? null },
    officialTurnCompleted: events.some(item => item.method === 'turn/completed' && item.params?.turn?.status === 'completed'),
    hook: { status: 'failed', exitCode: 1, markerPresent: false, originalGuardUnchanged: true, runtimeContinuedAfterHookFailure: true },
    image: { filename: 'real-image.png', sha256: hash(outputBytes), bytes: outputBytes.length, width: state.retainedImage.width, height: state.retainedImage.height, format: 'png', actualBrowserDecoded: true, bytesMatchOfficialBase64: true, source: 'official_codex_account_real_output_not_accepted' },
    sourceBinding: { shotId: job.shotId, inputSnapshotHash: job.inputSnapshotHash, bindingHash: hash(JSON.stringify(job.binding)), plannedLocalReferenceFilesCount: job.plannedReferences.length, references: job.plannedReferences.map(ref => ({ assetId: ref.id, sha256: ref.sha256, entityId: ref.entityId, entityVersion: ref.entityVersion, sourceKind: ref.source.kind, testFixture: ref.source.kind === 'test' })), attachmentsVerified: false },
    automaticCandidateImported: false, automaticallySelected: false, manualInspection: { assetId: browser.manualAssetId, sourceKind: browser.manualSourceKind, verdict: 'rejected', userSignoff: false, originalInputBinding: true, inputChangedNeedsReview: true, restoredAfterRestart: true },
    rawEvidence: { exported: false, eventsSha256: hash(fs.readFileSync(eventFile)), requestsSha256: hash(fs.readFileSync(requestFile)), note: '原始RPC事件、请求、回执和失败guard仅本机保留，未补造marker。' } },
  accountUsage: { channel: 'existing_chatgpt_codex_account', accountType: 'chatgpt', ordinaryUsageAllowedBefore: state.beforeUsage.ordinaryUsageAllowed, before: rate(state.beforeUsage.rateLimits), afterNotification: rate(after), costCny: null, costCredits: null, perImageUsage: null, purchasedCredits: false, switchedToPaidApi: false, note: '窗口用量百分比和credits余额不是本次费用，也不能推算单图消耗。' },
  browsers: { manualImages: report('tests/.artifacts/image-browser/image-browser-report.json'), automaticFixture: report('tests/.artifacts/auto-image-browser/report.json'), failureFixture: report('tests/.artifacts/auto-image-failure-browser/report.json'), creative: report('tests/.artifacts/creative-browser/creative-browser-report.json'), scripts: report('tests/.artifacts/stage2-browser/script-browser-report.json'), actualRetainedImage: report('tests/.artifacts/auto-image-real/retained-browser.json', false) },
  formalStages: { guard: 'not_checked', ledger: 'not_integrated', productionPackagePass: false },
  unsubmitted: ['jimeng_canvas', 'video', 'voice', 'editing'],
  blockers: ['实际PreToolUse首次启动失败且runtime继续工具调用；修正启动方式只经过无模型验证，尚未完成真实单次拦截验收。', '实际imageGeneration完成事件未提供inputImages，无法核实图像工具实际附加了参考。', '本轮最多1次/1张已用完，不再真实重试；人民币、积分和单图用量未返回，保持未知。'],
};
const destination = path.resolve('docs/auto-image-evidence'); fs.mkdirSync(destination, { recursive: true });
fs.writeFileSync(path.join(destination, 'check.json'), JSON.stringify(evidence, null, 2) + '\n');
fs.writeFileSync(path.join(destination, 'real-image.png'), outputBytes);
for (const name of ['real-failed-artifact.png', 'real-manual-rejected.png', 'real-input-stale.png']) fs.copyFileSync(path.join('tests/.artifacts/auto-image-real', name), path.join(destination, name));
console.log(JSON.stringify({ exported: true, realImages: 1, automaticAcceptancePassed: false, tests: evidence.regression, preservedFiles: beforeFiles.length }));
