import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { buildCanvasResourceDownloadArgs, runCanvasResourceDownload, parseCanvasResourceDownload, verifyCanvasDownloadedVideo, downloadCanvasVideoResource } from '../src/canvas-video-download.mjs';

const projectId = '5a79568c-c830-48c5-b697-53066890d4ec', resourceId = '76eab309-20f1-4e81-ba3b-96d372a25b5d';
const root = path.resolve('tests/.artifacts/canvas-download-tests'); fs.mkdirSync(root, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t, { bytes = fs.readFileSync('docs/video-v07-evidence/TEST-FIXTURE-NOT-AI.mp4') } = {}) {
  const directory = fs.mkdtempSync(path.join(root, 'download-')), outputPath = path.join(directory, 'TEST-FIXTURE-NOT-AI.mp4'); fs.writeFileSync(outputPath, bytes);
  const data = { resourceId, path: outputPath, size: bytes.length, sha256: hash(bytes) };
  return { outputPath, bytes, data, binding: { projectId, resourceId, outputPath }, result: { exitCode: 0, timedOut: false, stdout: JSON.stringify({ schemaVersion: '1', ok: true, data, meta: { requestId: 'ISOLATED-RECEIPT-NOT-REAL-CALL' } }), stderr: '' } };
}

test('官方视频下载argv显式画布和资源，只允许新目标，不覆盖原片或猜生成命令', () => {
  const outputPath = path.join(root, `NEW-${randomUUID()}.mp4`);
  assert.deepEqual(buildCanvasResourceDownloadArgs({ projectId, resourceId, outputPath }), ['resource', 'download', resourceId, '--project-id', projectId, '--output', outputPath, '--non-interactive']);
  for (const input of [{ projectId: 'invalid', resourceId, outputPath }, { projectId, resourceId: 'node_fake', outputPath }, { projectId, resourceId, outputPath: './relative.mp4' }]) assert.throws(() => buildCanvasResourceDownloadArgs(input));
  assert.throws(() => buildCanvasResourceDownloadArgs({ projectId, resourceId, outputPath: path.resolve('docs/video-v07-evidence/TEST-FIXTURE-NOT-AI.mp4') }), /已有文件/);
});

test('下载runner在进子进程前拒confirm/run/yes或缺画布参数，没有二次生成旁路', async () => {
  const outputPath = path.join(root, `NEW-${randomUUID()}.mp4`), good = buildCanvasResourceDownloadArgs({ projectId, resourceId, outputPath });
  for (const args of [['node', 'run', '--node-id', 'node_fake'], ['node', 'confirm'], [...good, '--yes'], ['resource', 'download', resourceId], [...good, '--run']]) assert.throws(() => runCanvasResourceDownload('must-never-execute.exe', args), /只读下载/);
  assert.throws(() => runCanvasResourceDownload('must-never-execute.exe', ['resource', 'download', resourceId, '--project-id', projectId, '--output', path.resolve('docs/video-v07-evidence/TEST-FIXTURE-NOT-AI.mp4'), '--non-interactive']), /保留原片/);
  assert.equal((await runCanvasResourceDownload(null, good)).exitCode, null);
});

test('实际既有TEST MP4文件与Schema回执一致才可下载核验，不能作为AI生成成功证明', async t => {
  const ctx = fixture(t), downloaded = parseCanvasResourceDownload(ctx.result, ctx.binding), verified = await verifyCanvasDownloadedVideo(downloaded);
  assert.equal(downloaded.sha256, '7de983635b4b445d23d72d09ca41f0c30d255a14a0e3df25647ad6e2116800b3'); assert.equal(downloaded.size, 17750); assert.equal(downloaded.projectId, projectId); assert.equal(Object.hasOwn(downloaded.receipt.data, 'projectId'), false);
  assert.equal(verified.videoFileVerified, true); assert.equal(verified.actualGenerationVerified, false); assert.equal(verified.probe.width, 1280); assert.equal(verified.probe.height, 720); assert.equal(verified.probe.audioStreams, 0); assert.equal(verified.probe.durationSeconds, 5);
});

test('缺文件、错资源、不同目标、字节数或Hash不符不得凭路径/文字导入候选', t => {
  const ctx = fixture(t);
  for (const patch of [{ resourceId: randomUUID() }, { path: path.join(root, 'missing.mp4') }, { size: ctx.data.size + 1 }, { sha256: 'a'.repeat(64) }, { sha256: null }, { path: 'relative.mp4' }]) {
    const result = { ...ctx.result, stdout: JSON.stringify({ ok: true, data: { ...ctx.data, ...patch } }) };
    assert.throws(() => parseCanvasResourceDownload(result, ctx.binding));
  }
  fs.unlinkSync(ctx.outputPath); assert.throws(() => parseCanvasResourceDownload(ctx.result, ctx.binding), /实际文件/);
});

test('非成功退出、超时、损坏JSON、空成功或只有下载URL均不能提升成功', t => {
  const ctx = fixture(t);
  for (const result of [{ ...ctx.result, exitCode: 1 }, { ...ctx.result, timedOut: true }, { ...ctx.result, stdout: 'download succeeded' }, { ...ctx.result, stdout: '{"ok":true}' }, { ...ctx.result, stdout: '{"ok":true,"data":{"url":"https://example.invalid/test.mp4"}}' }]) assert.throws(() => parseCanvasResourceDownload(result, ctx.binding), /未返回完整成功/);
});

test('Hash正确但文字伪装MP4仍需真实FFprobe拒绝，不认定媒体完成', async t => {
  const ctx = fixture(t, { bytes: Buffer.from('NOT A VIDEO, only a test pretending to have an mp4 path '.repeat(3)) });
  const downloaded = parseCanvasResourceDownload(ctx.result, ctx.binding);
  await assert.rejects(verifyCanvasDownloadedVideo(downloaded), /媒体检查失败|FFprobe/);
});

test('下载恢复只用原资源和新的输出路径，隔离helper不调用任何生成命令', async () => {
  const outputPath = path.join(root, `NEW-${randomUUID()}.mp4`), bytes = fs.readFileSync('docs/video-v07-evidence/TEST-FIXTURE-NOT-AI.mp4'), calls = [];
  const verified = await downloadCanvasVideoResource({ projectId, resourceId, outputPath }, { resolve: () => 'ISOLATED', run: async (_, args) => { calls.push(args); fs.writeFileSync(outputPath, bytes); return { exitCode: 0, stdout: JSON.stringify({ ok: true, data: { resourceId, path: outputPath, size: bytes.length, sha256: hash(bytes) } }), stderr: '' }; } });
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'resource'); assert.equal(calls[0][1], 'download'); assert.equal(calls[0][2], resourceId); assert.equal(verified.videoFileVerified, true); assert.equal(verified.actualGenerationVerified, false); assert.equal(verified.raw.data.resourceId, resourceId);
});
