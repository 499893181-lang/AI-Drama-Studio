// Public allowlist export. Existing image/RPC/authentication files are not copied.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = path.resolve('tests/.artifacts/contract-v061'), destination = path.resolve('docs/image-contract-v061-evidence');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const before = read(path.join(root, 'original-data-before.json'));
for (const source of before.records) assert.equal(hash(fs.readFileSync(path.join(before.root, source.relative))), source.sha256, '原有data文件字节必须保持不变');
const newFiles = [];
const originalNames = new Set(before.records.map(item => item.relative));
function walk(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) walk(file);
    else if (item.isFile() && item.name !== 'studio.lock') { const relative = path.relative(before.root, file); if (!originalNames.has(relative)) newFiles.push(relative); }
  }
}
walk(before.root);
assert.ok(newFiles.length > 0 && newFiles.every(file => file.replaceAll('\\', '/').startsWith('image-generation-diagnostics/')), '只允许新增独立诊断，不能改原task/runtime/图片');
const regression = fs.readFileSync(path.join(root, 'full-regression.txt'), 'utf8');
const count = key => Number(regression.match(new RegExp(`(?:ℹ|#) ${key} (\\d+)`))?.[1]);
assert.equal(count('fail'), 0); assert.ok(count('pass') >= 215);
const audit = read(path.join(root, 'audit/diagnostic-report.json')), manifest = read(path.join(root, 'audit/audit-manifest.json'));
const ui = read('tests/.artifacts/image-diagnostics-browser/report.json'), actual = read(path.join(root, 'browser/report.json'));
const automatic = read('tests/.artifacts/auto-image-browser/report.json');
const manual = read('tests/.artifacts/image-browser/image-browser-report.json'), failure = read('tests/.artifacts/auto-image-failure-browser/report.json');
assert.equal(ui.passed, true); assert.equal(actual.passed, true); assert.equal(automatic.passed, true);
assert.equal(manual.passed, true); assert.equal(failure.passed, true);
assert.equal(audit.newModelTurns, 0); assert.equal(audit.newImageCalls, 0); assert.equal(audit.marker.existedBefore, false); assert.equal(audit.marker.existsAfter, false);
assert.equal(audit.schemaContract.inputImages.required, false); assert.equal(audit.schemaContract.inputImages.hasDefault, false);
const check = {
  schemaVersion: 1, checkedAt: new Date().toISOString(), baseCommit: '7a19ac93aa6d9538dddefccffbe7dd70423411c7', implementationBranch: 'codex/image-contract-fix-v061-20261115',
  scope: 'contract_repair_without_new_generation', newApplicationSubmissions: 0, newModelTurns: 0, newImageGenerations: 0,
  originalCounts: audit.counts, originalTask: audit.original, originalMarker: audit.marker,
  evidence: audit.evidence, attachmentLayers: audit.attachments, actualSchema: audit.schemaContract, artifactVerification: audit.artifactVerification,
  originalEvidenceFiles: manifest.files,
  preservation: { originalDataFiles: before.records.length, byteIdentical: before.records.length, additionalDiagnosticRecords: newFiles.length, changedOriginalFiles: 0, excludedServiceLock: 'studio.lock (service PID changes on restart)', originalDataDirectoryReused: true, maximumApplicationSubmissions: 1, submittedBefore: 1, submittedAfter: 1, remaining: 0, authenticationConfigurationModified: false, authenticationFilesInspected: false },
  protection: { strictSingleCallGuaranteed: false, automaticEntryEnabled: false, asynchronousInterruptOnly: true, previousHookFailureToImageStartMs: 1, unknownActualCallsAreNull: true },
  tests: { command: 'node --test tests/*.test.mjs', tests: count('tests'), passed: count('pass'), failed: count('fail'), isolatedOnly: true, watchdogFaultCases: 15, rpcFaultCases: 10, evidenceCases: 11, diagnosticCases: 7, hookObservationCases: 1 },
  browser: { isolatedStatuses: { passed: true, checks: ui.checks, count: ui.checks.length, consoleExceptions: ui.consoleExceptions }, actualExistingImage: { passed: true, checks: actual.checks, count: actual.checks.length, consoleExceptions: actual.consoleExceptions }, existingIsolatedWorkflow: { passed: true, checks: automatic.checks, count: automatic.checks.length, consoleExceptions: automatic.consoleExceptions }, manualWorkflow: { passed: true, checks: manual.checks, count: manual.checks.length, consoleExceptions: manual.consoleExceptions }, failureFixture: { passed: true, checks: failure.checks, count: failure.checks.length, consoleExceptions: failure.consoleExceptions } },
  cost: { extraPurchase: false, paidApiConfigured: false, cny: null, credits: null, status: 'unknown_not_free' },
  formalStages: { guard: 'not_checked', ledger: 'not_integrated', productionPackagePass: false },
  unsubmitted: ['new_image_generation', 'jimeng_canvas', 'video', 'voice', 'editing'],
};
const serialized = JSON.stringify(check, null, 2) + '\n';
assert.doesNotMatch(serialized, /C:\\|D:\\|C:\/Users|DYX|WindowsApps|access_token|refresh_token|Bearer /i);
fs.mkdirSync(destination, { recursive: true }); fs.writeFileSync(path.join(destination, 'check.json'), serialized);
for (const name of ['real-four-states.png', 'real-attachment-layers.png']) fs.copyFileSync(path.join(root, 'browser', name), path.join(destination, name));
fs.copyFileSync('tests/.artifacts/image-diagnostics-browser/layered-diagnostics.png', path.join(destination, 'isolated-fixture-statuses.png'));
console.log(JSON.stringify({ exported: true, tests: check.tests, preservedOriginalFiles: before.records.length, appendedOnly: newFiles.length, newModelTurns: 0, newImageGenerations: 0 }));
