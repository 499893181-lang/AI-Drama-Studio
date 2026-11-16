import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { AppError } from './store.mjs';
import { resolveExecutable } from './tools.mjs';
import { sanitizeCanvasReceipt } from './canvas-video.mjs';
import { probeVideo } from './video-media.mjs';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const normalized = file => process.platform === 'win32' ? fs.realpathSync.native(file).toLowerCase() : fs.realpathSync(file);
export function buildCanvasResourceDownloadArgs({ projectId, resourceId, outputPath }) {
  if (!uuid(projectId) || !uuid(resourceId) || typeof outputPath !== 'string' || !path.isAbsolute(outputPath)) throw new AppError('下载须绑定真实画布/资源ID和新的绝对文件路径。');
  if (fs.existsSync(outputPath)) throw new AppError('下载目标已有文件，保留旧文件；请使用新的恢复目录。', 409);
  return ['resource', 'download', resourceId, '--project-id', projectId, '--output', outputPath, '--non-interactive'];
}

/** Only the already documented read-only resource download command is accepted. */
export function runCanvasResourceDownload(binary, args, { signal, timeoutMs = 60000 } = {}) {
  const valid = Array.isArray(args) && args.length === 8 && args[0] === 'resource' && args[1] === 'download' && uuid(args[2]) && args[3] === '--project-id' && uuid(args[4]) && args[5] === '--output' && path.isAbsolute(args[6]) && args[7] === '--non-interactive';
  if (!valid) throw new AppError('下载器只接受绑定画布/资源的官方只读下载命令。', 409);
  if (fs.existsSync(args[6])) throw new AppError('下载目标已有文件，保留原片；仅可使用新输出路径恢复。', 409);
  return new Promise(resolve => {
    if (!binary) { resolve({ exitCode: null, stdout: '', stderr: '未找到dreamina-canvas。', timedOut: false }); return; }
    execFile(binary, args, { shell: false, windowsHide: true, encoding: 'utf8', signal, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ exitCode: error ? typeof error.code === 'number' ? error.code : null : 0, stdout: stdout ?? '', stderr: stderr ?? '', timedOut: !!error?.killed }));
  });
}

/** An envelope/path alone does not prove a downloaded file. Verify bytes first. */
export function parseCanvasResourceDownload(result, { projectId, resourceId, outputPath }) {
  if (!uuid(projectId) || !uuid(resourceId) || !path.isAbsolute(outputPath)) throw new AppError('下载绑定不完整。');
  let response;
  for (const text of [result?.stdout, result?.stderr]) { if (typeof text !== 'string') continue; try { response = JSON.parse(text.trim().replace(/^\uFEFF/, '')); break; } catch {} }
  const data = response?.data;
  if (result?.exitCode !== 0 || result?.timedOut || response?.ok !== true || data?.resourceId !== resourceId || !Number.isInteger(data?.size) || data.size < 32 || !/^[0-9a-f]{64}$/.test(data?.sha256 ?? '') || typeof data?.path !== 'string' || !path.isAbsolute(data.path)) throw new AppError('官方资源下载未返回完整成功回执和相同资源身份；原任务保留，只恢复下载。', 409);
  let bytes;
  try {
    if (normalized(data.path) !== normalized(outputPath) || !fs.statSync(outputPath).isFile()) throw new Error();
    bytes = fs.readFileSync(outputPath);
  } catch { throw new AppError('下载回执路径与目标实际文件不一致；不能只凭路径声称完成。', 409); }
  if (bytes.length !== data.size || sha(bytes) !== data.sha256) throw new AppError('下载实际文件与官方字节数或SHA256不符，停止候选导入，旧文件保留。', 409);
  return { projectId, resourceId, path: outputPath, size: bytes.length, sha256: data.sha256, requestId: response.meta?.requestId ?? null, receipt: sanitizeCanvasReceipt(response), verificationScope: 'resource_file_download_only_not_generation_success' };
}

export async function verifyCanvasDownloadedVideo(download, { probe = probeVideo, signal } = {}) {
  const actual = await probe(download.path, { signal });
  if (actual.sha256 !== download.sha256 || actual.size !== download.size || actual.videoStreams !== 1 || actual.verified !== true) throw new AppError('下载资源未通过实际视频FFprobe/Hash核验；不作为视频候选。', 409);
  return { ...download, probe: actual, mediaType: 'video', videoFileVerified: true, actualGenerationVerified: false };
}

export async function downloadCanvasVideoResource(input, { resolve = resolveExecutable, run = runCanvasResourceDownload, probe = probeVideo, signal } = {}) {
  const args = buildCanvasResourceDownloadArgs(input);
  const result = await run(resolve('dreamina-canvas'), args, { signal });
  const download = parseCanvasResourceDownload(result, input);
  return { ...await verifyCanvasDownloadedVideo(download, { probe, signal }), raw: download.receipt };
}
