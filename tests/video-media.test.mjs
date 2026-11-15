import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { probeVideo, stripVideoAudio } from '../src/video-media.mjs';
import { createTestVideo } from './video-fixtures.mjs';

const artifacts = path.resolve('tests/.artifacts'); fs.mkdirSync(artifacts, { recursive: true });
test('真实FFprobe检查明确非AI测试MP4的时长尺寸格式及有无音轨', async () => {
  const directory = fs.mkdtempSync(path.join(artifacts, 'video-probe-'));
  const silent = await createTestVideo(directory, { durationSeconds: 1, name: 'TEST-silent.mp4' });
  const sound = await createTestVideo(directory, { durationSeconds: 1, audio: true, name: 'TEST-sound.mp4' });
  assert.equal(silent.probe.verified, true); assert.equal(silent.probe.width, 320); assert.equal(silent.probe.height, 180); assert.ok(Math.abs(silent.probe.durationSeconds - 1) < 0.05); assert.equal(silent.probe.audioStreams, 0);
  assert.equal(sound.probe.audioStreams, 1); assert.equal(sound.source.kind, 'test'); assert.equal(sound.generator.actualProviderCalls, 0);
});
test('任意路径、缺文件、文本冒充MP4及无效probe JSON不算实际视频成功', async () => {
  const directory = fs.mkdtempSync(path.join(artifacts, 'video-invalid-')), file = path.join(directory, 'fake.mp4'); fs.writeFileSync(file, 'TEST FIXTURE / NOT AI text only. This is not a video file.');
  await assert.rejects(probeVideo('relative.mp4'), /本地文件/);
  await assert.rejects(probeVideo(path.join(directory, 'missing.mp4')), /不存在/);
  await assert.rejects(probeVideo(file), /媒体检查失败/);
  await assert.rejects(probeVideo(file, { run: async () => ({ stdout: 'not json' }) }), /有效JSON/);
});
test('去音轨只做显式新派生，原片Hash保留；静音来自FFprobe而非生成参数宣称', async () => {
  const directory = fs.mkdtempSync(path.join(artifacts, 'video-derivative-')), original = await createTestVideo(directory, { durationSeconds: 1, audio: true });
  const output = path.join(directory, 'TEST-silent-derivative.mp4');
  await assert.rejects(stripVideoAudio(original.path, output), /明确确认/);
  await assert.rejects(stripVideoAudio(original.path, original.path, { confirmed: true }), /不可覆盖/);
  const result = await stripVideoAudio(original.path, output, { confirmed: true });
  assert.equal(result.audioStreams, 0); assert.equal(result.derivative.parentSha256, original.sha256); assert.equal(result.derivative.automaticallySelected, false);
  assert.equal((await probeVideo(original.path)).sha256, original.sha256);
});
