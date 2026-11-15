// Deterministic local engineering fixture. No AI/provider generation or credits.
import fs from 'node:fs';
import path from 'node:path';
import { resolveExecutable } from '../src/tools.mjs';
import { probeVideo, runMedia } from '../src/video-media.mjs';

export async function createTestVideo(directory, { durationSeconds = 5, width = 320, height = 180, audio = false, name = 'TEST-FIXTURE-NOT-AI.mp4' } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 160 || height < 90 || width > 1920 || height > 1080 || width % 2 || height % 2 || !Number.isFinite(durationSeconds) || durationSeconds < 0.2 || durationSeconds > 15 || path.basename(name) !== name || !name.endsWith('.mp4')) throw new Error('测试视频参数超出明确范围。');
  fs.mkdirSync(directory, { recursive: true }); const file = path.resolve(directory, name);
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i', `color=c=0x273350:s=${width}x${height}:r=24`];
  if (audio) args.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000');
  args.push('-t', String(durationSeconds), '-vf', `drawtext=text='TEST FIXTURE / NOT AI':fontcolor=white:fontsize=${Math.max(14, Math.floor(width / 24))}:x=(w-tw)/2:y=(h-th)/2`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', '-threads', '1', '-movflags', '+faststart');
  if (audio) args.push('-c:a', 'aac', '-b:a', '48k'); else args.push('-an');
  args.push('-metadata', 'title=TEST FIXTURE / NOT AI', '-metadata', 'comment=Deterministic software test video. No Dreamina or AI generation.', file);
  await runMedia(resolveExecutable('ffmpeg'), args);
  const probe = await probeVideo(file); const bytes = fs.readFileSync(file);
  return { path: file, bytes, probe, sha256: probe.sha256, source: { kind: 'test', description: 'FFmpeg确定性测试视频，画面明确TEST FIXTURE / NOT AI；不是即梦或其他AI生成结果。' }, generator: { name: 'local_ffmpeg_test_fixture', args, actualProviderCalls: 0 } };
}
