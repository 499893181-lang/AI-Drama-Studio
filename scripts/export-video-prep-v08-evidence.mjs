import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sanitizeCanvasReceipt } from '../src/canvas-video.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const target = path.resolve('docs/video-prep-v08-evidence'); fs.mkdirSync(target, { recursive: true });
const regression = fs.readFileSync('.runtime/full-regression-final.txt', 'utf8');
const tests = Number(/ℹ tests (\d+)/.exec(regression)?.[1]), passed = Number(/ℹ pass (\d+)/.exec(regression)?.[1]), failed = Number(/ℹ fail (\d+)/.exec(regression)?.[1]);
assert.ok(tests >= 279 && tests === passed && failed === 0, 'Final complete regression must pass before exporting evidence.');
const main = read('tests/.artifacts/video-prep-v08/report.json'), timeline = read('tests/.artifacts/timeline-browser/report.json');
assert.equal(main.passed, true); assert.equal(timeline.passed, true);
const browsers = [
  ['timeline', 'tests/.artifacts/timeline-browser/report.json'],
  ['video', 'tests/.artifacts/video-browser/report.json'],
  ['creative', 'tests/.artifacts/creative-browser/creative-browser-report.json'],
  ['images', 'tests/.artifacts/image-browser/image-browser-report.json'],
  ['script', 'tests/.artifacts/stage2-browser/script-browser-report.json'],
];
const browserChecks = browsers.map(([name, file]) => { const value = read(file); assert.equal(value.passed, true); return { name, checks: value.checks.length, passed: true, realProviderGeneration: false }; });
const report = { checkedAt: new Date().toISOString(), baseline: '96b95e5418606586820ea4f9cec0f5603d153df3', implementationBranch: 'codex/canvas-video-prep-timeline-v08-20261116', regression: { tests, passed, failed, skipped: Number(/ℹ skipped (\d+)/.exec(regression)?.[1]) }, browserChecks, mainServiceChecks: main, actualVideoSubmissions: 0, newAIImages: 0, creditConfirmations: 0, productionCanvasSynchronization: false, formalStageStatus: 'not_checked', quoteEvidence: '../canvas-video-v08-evidence/check.json', remaining: ['Canvas实际生成准入、视频资源下载、参考符合性和最终扣费未验收。', 'Direct独立未登录且无可靠同渠道报价，未发起授权。', '本地时间轴仅完整镜头兼容MP4拼接，未提供转场/裁切/配音/字幕。', '本轮既有测试源无音轨；静音路径不冒充有声转无声素材验收。'] };
fs.writeFileSync(path.join(target, 'check.json'), JSON.stringify(sanitizeCanvasReceipt(report), null, 2) + '\n');
fs.writeFileSync(path.join(target, 'timeline-browser.json'), JSON.stringify(timeline, null, 2) + '\n');
for (const [source, name] of [
  ['tests/.artifacts/video-prep-v08/actual-canvas-quote-readonly.png', 'actual-canvas-quote-readonly.png'],
  ['tests/.artifacts/video-prep-v08/actual-main-timeline-test-only.png', 'actual-main-timeline-test-only.png'],
  ['tests/.artifacts/timeline-browser/timeline-mobile-fixture.png', 'timeline-mobile-fixture.png'],
  ['tests/.artifacts/timeline-browser/timeline-export-playback-fixture.png', 'timeline-export-playback-fixture.png'],
  ['tests/.artifacts/timeline-browser/timeline-restored-stale-fixture.png', 'timeline-restored-stale-fixture.png'],
]) fs.copyFileSync(source, path.join(target, name));
const schemaFile = 'tests/.artifacts/canvas-v08/schema.json', schemaBytes = fs.readFileSync(schemaFile), schema = JSON.parse(schemaBytes.toString('utf8'));
const select = names => { let command = schema.data; for (const name of names) command = command?.subcommands?.find(item => item.name === name); assert.ok(command, names.join(' ')); return { command: ['dreamina-canvas', ...names].join(' '), summary: command.summary, reads: command.reads, writes: command.writes, confirmation: command.confirmation, arguments: command.arguments, flags: command.flags, successFields: command.successData?.fields?.map(field => ({ name: field.name, type: field.type, optional: field.optional })) }; };
const excerpt = { source: 'Actual locally executed dreamina-canvas 1.2.0 schema; selected exact command fields only.', sourceSha256: createHash('sha256').update(schemaBytes).digest('hex'), schemaVersion: schema.schemaVersion, commands: [['node', 'create', 'video'], ['node', 'edit', 'video'], ['node', 'quote'], ['node', 'confirm'], ['node', 'run'], ['operation', 'status'], ['operation', 'wait'], ['resource', 'get'], ['resource', 'download']].map(select), videoDownloadVerified: false, generationInvoked: false };
fs.writeFileSync(path.join(target, 'cli-schema-excerpts.json'), JSON.stringify(excerpt, null, 2) + '\n');
fs.copyFileSync('tests/.artifacts/canvas-v08/downloadHelp.json', path.join(target, 'resource-download-help.txt'));
console.log(JSON.stringify({ regression: report.regression, browserChecks, mainChecks: main.checks.length, originalFilesUnchanged: main.preservation.originalFiles, publicEvidenceFiles: fs.readdirSync(target).length }, null, 2));
