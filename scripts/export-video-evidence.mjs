// Public allowlist export; no original auth, personal projects or signed URLs.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveExecutable, runProbe } from '../src/tools.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8')), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = path.resolve('tests/.artifacts/video-v07'), before = read(path.join(root, 'preservation-before.json'));
for (const original of before.records) assert.equal(hash(fs.readFileSync(path.join(before.root, original.relative))), original.sha256, '必须保留原数据字节');
const prepared = read(path.join(root, 'local-preparation.json')), task = read(path.join(before.root, 'video-jobs', `${prepared.task.id}.json`));
assert.equal(task.status, 'prepared'); assert.equal(task.submittedAt, null); assert.equal(task.externalTaskId, null);
const imageJobs = fs.readdirSync(path.join(before.root, 'image-generation-jobs')).filter(name => name.endsWith('.json')).map(name => read(path.join(before.root, 'image-generation-jobs', name)));
assert.equal(imageJobs.filter(job => job.submittedAt).length, 1); assert.equal(imageJobs.find(job => job.submittedAt).status, 'failed');
const videoJobs = fs.readdirSync(path.join(before.root, 'video-jobs')).filter(name => name.endsWith('.json')).map(name => read(path.join(before.root, 'video-jobs', name)));
assert.equal(videoJobs.filter(job => job.submittedAt).length, 0);
const cli = read('tests/.artifacts/video-cli/public-contract-check.json'), video = read('tests/.artifacts/video-browser/report.json'), local = read(path.join(root, 'prepared-browser-report.json'));
const manual = read('tests/.artifacts/image-browser/image-browser-report.json'), creative = read('tests/.artifacts/creative-browser/creative-browser-report.json'), script = read('tests/.artifacts/stage2-browser/script-browser-report.json');
for (const result of [video, local, manual, creative, script]) assert.equal(result.passed, true);
const regression = fs.readFileSync(path.join(root, 'full-regression.txt'), 'utf8'), count = key => Number(regression.match(new RegExp(`(?:ℹ|#) ${key} (\\d+)`))?.[1]); assert.equal(count('fail'), 0); assert.ok(count('pass') >= 252);
const probeVersion = await runProbe(resolveExecutable('ffprobe'), ['-version']); assert.equal(probeVersion.exitCode, 0);
const destination = path.resolve('docs/video-v07-evidence'); fs.mkdirSync(destination, { recursive: true });
const sourceImage = fs.readFileSync(path.join(root, 'TEST-FIXTURE-NOT-AI-input.png')); assert.equal(hash(sourceImage), prepared.image.sha256); fs.writeFileSync(path.join(destination, 'TEST-FIXTURE-NOT-AI-input.png'), sourceImage);
const browserRoot = path.resolve('tests/.artifacts/video-browser');
const sample = fs.readdirSync(browserRoot).filter(name => name.startsWith('media-')).map(name => path.join(browserRoot, name, 'TEST-FIXTURE-NOT-AI.mp4')).find(file => fs.existsSync(file) && hash(fs.readFileSync(file)) === video.testVideo.sha256); assert.ok(sample, '测试视频应实际存在，不能以文字路径代替');
fs.copyFileSync(sample, path.join(destination, 'TEST-FIXTURE-NOT-AI.mp4'));
for (const name of ['fixture-unknown-fee.png', 'fixture-candidate-selected.png', 'fixture-restored-stale.png']) fs.copyFileSync(path.join(browserRoot, name), path.join(destination, name));
for (const name of ['prepared-input.png', 'prepared-unknown-fee.png']) fs.copyFileSync(path.join(root, name), path.join(destination, name));
const report = {
  schemaVersion: 1, checkedAt: new Date().toISOString(), baseCommit: 'c488d1cf78d450777d13e243bc1678483d465902', implementationBranch: 'codex/jimeng-video-workbench-v07-20261115',
  scope: 'implementation_and_isolated_acceptance_only', realVideoSubmissions: 0, newImageGenerationCalls: 0, newModelTurns: 0, canvasWrites: 0, voiceOrEditingTasks: 0,
  cli, actualCliVideoOutputVerified: false,
  preservation: { originalFiles: before.records.length, byteIdentical: before.records.length, excludedServiceLock: 'studio.lock', originalDataDirectoryReused: true, authenticationConfigurationModified: false, originalImageApplicationSubmissions: 1, originalImageBudgetRemaining: 0, originalFailedTaskUnchanged: true, autoImageConnectorChanged: false, autoImageEntryEnabled: false },
  tests: { command: 'node --test tests/*.test.mjs', tests: count('tests'), passed: count('pass'), failed: count('fail'), baseline: 215, adapterCases: 10, backendCases: 22, mediaCases: 3, httpCases: 2, realProviderCalls: 0 },
  videoBrowser: { passed: true, consoleExceptions: video.consoleExceptions, fixtureOnly: true, testVideo: video.testVideo, fixtureCalls: video.fixtureCalls, checks: video.checks },
  existingPages: { images: { passed: true, checks: manual.checks }, creative: { passed: true, checks: creative.checks }, script: { passed: true, checks: script.checks } },
  localPreparedBrowser: { passed: true, checks: local.checks, realVideoSubmissions: 0 },
  preparedProposal: { projectId: prepared.projectId, image: prepared.image, task: prepared.task, page: prepared.page, budgetMeaning: prepared.budgetMeaning, currentCapability: prepared.capability },
  ffprobeVersion: probeVersion.output.split(/\r?\n/)[0],
  audio: { nativeDisableSupported: false, originalRetained: true, derivativePlanOnly: true, productionDerivativeExecuted: false, deterministicFixtureDerivativeTested: true },
  canvas: { status: 'not_synced', importContract: 'detected_not_verified', actualImportExecuted: false },
  formalStages: { guard: 'not_checked', ledger: 'not_integrated', productionPackagePass: false },
  blockersForRealAcceptance: ['direct dreamina CLI当前未登录；canvas登录不能替代。', '缺本账号、本模型、5秒、720p、direct image2video渠道可核实费用或可靠上限；预算100只是提议。', '输入图片格式/像素限制及实际任务JSON/下载契约尚未以真实任务验收。', '没有原生音频关闭参数；若要求无音轨，需要另行明确本地派生并保留原片。'],
};
const serialized = JSON.stringify(report, null, 2) + '\n'; assert.doesNotMatch(serialized, /C:\\|D:\\|C:\/Users|DYX|WindowsApps|access_token|refresh_token|Bearer /i);
fs.writeFileSync(path.join(destination, 'check.json'), serialized);
console.log(JSON.stringify({ exported: true, tests: report.tests.tests, preserved: before.records.length, realVideos: 0, oldImageSubmissions: 1, proposalTaskId: task.id, testVideoBytes: fs.statSync(sample).size }));
