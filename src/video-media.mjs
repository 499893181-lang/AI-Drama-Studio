import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { AppError, now } from './store.mjs';
import { resolveExecutable, redact } from './tools.mjs';

export function runMedia(binary, args, { signal, timeoutMs = 20000, maxBuffer = 2 * 1024 * 1024 } = {}) {
  if (!binary) return Promise.reject(new AppError('未找到现有FFmpeg/FFprobe，请配置原生可执行文件路径。', 409));
  return new Promise((resolve, reject) => execFile(binary, args, { shell: false, windowsHide: true, encoding: 'utf8', signal, timeout: timeoutMs, maxBuffer }, (error, stdout, stderr) => {
    if (error) { reject(new AppError(`媒体检查失败${error.killed ? '（超时）' : ''}：${redact(stderr || error.message).slice(0, 3000)}`, 409)); return; }
    resolve({ stdout, stderr, exitCode: 0 });
  }));
}

/** Actual bytes and FFprobe; successful download text alone is never enough. */
export async function probeVideo(file, { signal, ffprobeBin = resolveExecutable('ffprobe'), run = runMedia } = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new AppError('视频必须是实际存在的本地文件。', 409);
  let stat; try { stat = fs.statSync(file); } catch { throw new AppError('下载视频文件不存在，不能视为成功。', 409); }
  if (!stat.isFile() || stat.size < 32 || stat.size > 512 * 1024 * 1024) throw new AppError('视频文件为空、无效或超过512MiB检查上限。', 409);
  const bytes = fs.readFileSync(file), sha256 = createHash('sha256').update(bytes).digest('hex');
  const args = ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_format', '-show_streams', '-of', 'json', file];
  const result = await run(ffprobeBin, args, { signal });
  let raw; try { raw = JSON.parse(result.stdout.replace(/^\uFEFF/, '')); } catch { throw new AppError('FFprobe没有返回有效JSON，不能核实实际视频。', 409); }
  const streams = Array.isArray(raw.streams) ? raw.streams : [], video = streams.filter(item => item.codec_type === 'video' && !item.disposition?.attached_pic), audio = streams.filter(item => item.codec_type === 'audio');
  const track = video[0], durationSeconds = Number(raw.format?.duration ?? track?.duration), width = Number(track?.width), height = Number(track?.height);
  const format = raw.format?.format_name;
  if (video.length !== 1 || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || typeof track.codec_name !== 'string') throw new AppError('FFprobe未核实单视频轨、正时长及有效画面尺寸，原文件保留。', 409);
  const mp4 = typeof format === 'string' && /(?:^|,)(mp4|mov)(?:,|$)/.test(format), webm = typeof format === 'string' && /(?:^|,)webm(?:,|$)/.test(format);
  if (!mp4 && !webm) throw new AppError(`实际容器${format ?? '未知'}尚未支持网页预览，文件保留待人工检查。`, 409);
  if (Number(raw.format?.size) !== bytes.length || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== sha256) throw new AppError('视频检查期间文件变化或实际大小不符，未作为候选导入。', 409);
  return { verified: true, checkedAt: now(), sha256, size: bytes.length, format, extension: mp4 ? 'mp4' : 'webm', mimeType: mp4 ? 'video/mp4' : 'video/webm', durationSeconds, width, height, videoStreams: video.length, audioStreams: audio.length, hasAudio: audio.length > 0, videoCodec: track.codec_name, pixelFormat: track.pix_fmt ?? null, frameRate: track.avg_frame_rate ?? null, audioCodecs: audio.map(item => item.codec_name ?? null), rawProbe: raw, tool: { name: 'ffprobe', args, exitCode: result.exitCode } };
}

/** Optional explicit LOCAL derivative; never called automatically by generation. */
export async function stripVideoAudio(input, output, { confirmed = false, signal, ffmpegBin = resolveExecutable('ffmpeg'), probe = probeVideo, run = runMedia } = {}) {
  if (confirmed !== true) throw new AppError('去音轨派生须单独明确确认；不会自动修改或覆盖原片。', 409);
  if (!path.isAbsolute(output) || path.resolve(input) === path.resolve(output) || fs.existsSync(output)) throw new AppError('派生输出必须是新的绝对路径，原片和旧版不可覆盖。', 409);
  const before = await probe(input, { signal });
  const args = ['-v', 'error', '-nostdin', '-n', '-protocol_whitelist', 'file,pipe', '-i', input, '-map', '0:v:0', '-c:v', 'copy', '-an', output];
  await run(ffmpegBin, args, { signal });
  const after = await probe(output, { signal });
  if (after.audioStreams !== 0 || after.width !== before.width || after.height !== before.height || Math.abs(after.durationSeconds - before.durationSeconds) > 0.15 || createHash('sha256').update(fs.readFileSync(input)).digest('hex') !== before.sha256) throw new AppError('去音轨派生未通过实际检查；保留原片及派生文件，未自动选用。', 409);
  return { ...after, derivative: { kind: 'audio_removed_stream_copy', parentSha256: before.sha256, parentUnchanged: true, originalRetained: true, args, automaticallySelected: false } };
}
