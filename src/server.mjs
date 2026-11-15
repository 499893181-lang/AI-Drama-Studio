import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, AppError, validId, now } from './store.mjs';
import { CodexJobs } from './codex.mjs';
import { inspectTools } from './tools.mjs';
import { ScriptService } from './scripts.mjs';
import { CreativeService } from './creative-jobs.mjs';
import { ImageWorkspace } from './image-store.mjs';
import { inspectImageCapabilities } from './image-capabilities.mjs';
import { ImageGenerationJobs } from './image-jobs.mjs';
import { VideoService } from './video-jobs.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function json(response, value, status = 200) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); }
async function body(request, limit = 2 * 1024 * 1024) {
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new AppError(`内容过大，最大允许 ${Math.round(limit / 1024 / 1024)} MB。`, 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new AppError('请求须使用 JSON。', 415);
  try { const value = JSON.parse((await body(request)).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError('请求不是有效的 JSON 对象。'); }
}
function sendVideo(request, response, file) {
  const bytes = file.bytes ?? fs.readFileSync(file.path), size = bytes.length;
  const headers = { 'Content-Type': file.mimeType, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name ?? 'video.mp4')}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  let start = 0, end = size - 1, status = 200;
  if (request.headers.range) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if (!range || !range[1] && !range[2]) { response.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 }); response.end(); return; }
    if (range[1]) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1; }
    else { const suffix = Number(range[2]); start = Math.max(0, size - suffix); end = size - 1; if (suffix < 1) start = size; }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) { response.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 }); response.end(); return; }
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  response.writeHead(status, { ...headers, 'Content-Length': end - start + 1 });
  response.end(request.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1));
}
export function createStudio(options = {}) {
  const store = new Store(options.dataDir ?? process.env.DATA_DIR ?? path.join(repoRoot, 'data'));
  const jobs = new CodexJobs(store);
  const scripts = new ScriptService(store, options.scriptOptions);
  const creative = new CreativeService(store, options.creativeOptions);
  const images = new ImageWorkspace(store, { creativeWorkspace: creative.workspace, ...options.imageOptions });
  const imageGeneration = new ImageGenerationJobs(store, { images, ...options.imageGenerationOptions });
  const videos = new VideoService(store, { images, ...options.videoOptions });
  let imageReport = null, imageInspection = null;
  const getImageCapabilities = () => {
    if (imageReport && Date.now() - Date.parse(imageReport.checkedAt) < 60000) return Promise.resolve(imageReport);
    if (!imageInspection) imageInspection = (options.inspectImageTools ?? inspectImageCapabilities)().then(value => { imageReport = value; return value; }).finally(() => { imageInspection = null; });
    return imageInspection;
  };
  let report = null, inspection = null;
  const withRuntimeEvidence = value => {
    const result = structuredClone(value);
    const codex = result.tools.find(tool => tool.id === 'codex');
    const latest = store.list('jobs').values.find(job => job.provider === 'codex-cli' && ['succeeded', 'failed'].includes(job.status));
    if (codex && latest) {
      const capability = codex.capabilities.find(item => item.name === '模型服务连接');
      if (capability) {
        capability.status = latest.status === 'succeeded' ? 'detected' : 'needs_configuration';
        capability.detail = latest.status === 'succeeded' ? `最近一次真实扩写于 ${latest.updatedAt} 完成；当前连接以每次任务终态为准。` : `最近一次真实扩写失败：${latest.error}。认证状态与模型连接分别记录。`;
      }
      codex.evidence.push({ command: '本地已保存的真实 codex exec 任务', exitCode: latest.status === 'succeeded' ? 0 : null, output: `任务 ${latest.id}\n状态 ${latest.status}\n时间 ${latest.updatedAt}` });
    }
    return result;
  };
  const getTools = (refresh = false) => {
    if (!refresh && report && Date.now() - new Date(report.checkedAt).getTime() < 60000) return Promise.resolve(withRuntimeEvidence(report));
    if (!inspection) inspection = (options.inspectTools ?? inspectTools)().then(value => { report = value; return value; }).finally(() => { inspection = null; });
    return inspection.then(withRuntimeEvidence);
  };
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const port = server.address()?.port;
      const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!allowedHosts.includes(request.headers.host)) throw new AppError('仅允许本机访问。', 403);
      if (request.headers.origin && !allowedHosts.some(host => request.headers.origin === `http://${host}`)) throw new AppError('已拒绝跨站请求。', 403);
      if (request.headers['sec-fetch-site'] === 'cross-site') throw new AppError('已拒绝跨站请求。', 403);
      const url = new URL(request.url, 'http://127.0.0.1');
      const segments = url.pathname.split('/').filter(Boolean).map(value => decodeURIComponent(value));
      const method = request.method;
      if (url.pathname === '/api/health' && method === 'GET') { json(response, { ok: true, app: 'AI-Drama-Studio', version: '0.6.0', phase: 'jimeng-single-shot-video', supportedPhases: ['story-initiation', 'script', 'creative', 'images', 'videos'], now: now() }); return; }
      if (url.pathname === '/api/images/capabilities' && method === 'GET') { json(response, await getImageCapabilities()); return; }
      if (url.pathname === '/api/creative/knowledge' && method === 'GET') { json(response, creative.catalog()); return; }
      if (url.pathname === '/api/novel/status' && method === 'GET') { json(response, await scripts.inspect(true)); return; }
      if (url.pathname === '/api/tools' && method === 'GET') { json(response, await getTools()); return; }
      if (url.pathname === '/api/tools/refresh' && method === 'POST') { json(response, await getTools(true)); return; }
      if (segments[0] === 'api' && segments[1] === 'projects') {
        if (segments.length === 2) {
          if (method === 'GET') { const list = store.list('projects'); json(response, { projects: list.values, warnings: list.warnings }); return; }
          if (method === 'POST') { json(response, store.create(await readJson(request)), 201); return; }
        }
        const id = segments[2];
        if (!validId(id)) throw new AppError('项目标识不正确。');
        if (segments[3] === 'videos') {
          if (segments.length === 4 && method === 'GET') { json(response, await videos.view(id)); return; }
          if (segments.length === 5 && method === 'POST') {
            const input = await readJson(request);
            if (segments[4] === 'prepare') { json(response, await videos.prepare(id, input), 201); return; }
            if (segments[4] === 'review') { json(response, await videos.review(id, input)); return; }
            if (segments[4] === 'select') { json(response, await videos.select(id, input)); return; }
          }
        }
        if (segments[3] === 'video-assets' && segments.length === 5 && ['GET', 'HEAD'].includes(method)) {
          if (!validId(segments[4])) throw new AppError('视频标识不正确。');
          sendVideo(request, response, await videos.file(id, segments[4])); return;
        }
        if (segments[3] === 'images') {
          if (segments.length === 4 && method === 'GET') { json(response, images.view(id)); return; }
          if (segments.length === 5 && segments[4] === 'generation' && method === 'GET') { json(response, await imageGeneration.view(id)); return; }
          if (segments.length === 6 && segments[4] === 'packets' && method === 'GET') {
            if (!validId(segments[5])) throw new AppError('图片任务包标识不正确。');
            json(response, images.assertExecutablePacket(id, segments[5]).packet); return;
          }
          if (segments.length === 7 && segments[4] === 'packets' && segments[6] === 'bundle' && method === 'GET') {
            if (!validId(segments[5])) throw new AppError('图片任务包标识不正确。');
            const bundle = images.bundle(id, segments[5]);
            response.writeHead(200, { 'Content-Type': bundle.mimeType, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(bundle.name)}`, 'Content-Length': bundle.bytes.length, 'Cache-Control': 'no-store' });
            response.end(bundle.bytes); return;
          }
          if (segments.length === 5 && method === 'POST') {
            if (segments[4] === 'import') {
              let metadata;
              try {
                metadata = JSON.parse(decodeURIComponent(request.headers['x-image-metadata'] ?? ''));
                if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error();
              } catch { throw new AppError('图片上传元信息不是有效JSON对象。'); }
              json(response, images.import(id, metadata, await body(request, 20 * 1024 * 1024)), 201); return;
            }
            const input = await readJson(request);
            if (segments[4] === 'generation-prepare') { json(response, await imageGeneration.prepare(id, input), 201); return; }
            if (segments[4] === 'review') { json(response, images.review(id, input)); return; }
            if (segments[4] === 'select') { json(response, images.select(id, input)); return; }
            if (segments[4] === 'prepare') { json(response, images.prepare(id, input), 201); return; }
          }
        }
        if (segments[3] === 'image-assets' && segments.length === 5 && method === 'GET') {
          if (!validId(segments[4])) throw new AppError('图片标识不正确。');
          const file = images.file(id, segments[4]);
          response.writeHead(200, { 'Content-Type': file.mimeType, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'Content-Length': fs.statSync(file.path).size, 'Cache-Control': 'no-store' });
          fs.createReadStream(file.path).pipe(response); return;
        }
        if (segments[3] === 'creative') {
          if (segments.length === 4 && method === 'GET') { json(response, creative.view(id)); return; }
          if (segments.length === 4 && method === 'PUT') { json(response, creative.update(id, await readJson(request))); return; }
          if (segments.length === 5 && segments[4] === 'export' && method === 'GET') { json(response, creative.export(id)); return; }
          if (segments.length === 5 && method === 'POST') {
            const input = await readJson(request);
            if (segments[4] === 'tasks') { json(response, creative.start(id, input), 202); return; }
            if (segments[4] === 'adopt') { json(response, creative.adopt(id, input)); return; }
            if (segments[4] === 'versions') { json(response, creative.addVersion(id, input), 201); return; }
          }
        }
        if (segments[3] === 'script') {
          if (segments.length === 4 && method === 'GET') { json(response, await scripts.view(id)); return; }
          if (segments.length === 4 && method === 'PUT') { scripts.workspace.update(id, await readJson(request)); json(response, await scripts.view(id)); return; }
          if (segments.length === 5 && method === 'POST') {
            const input = await readJson(request);
            if (segments[4] === 'sync') { scripts.workspace.sync(id, input.revision); json(response, await scripts.view(id)); return; }
            if (segments[4] === 'verify-binding') { await scripts.verifyBinding(id, input.revision); json(response, await scripts.view(id)); return; }
            if (segments[4] === 'versions') { scripts.workspace.addVersion(id, input); json(response, await scripts.view(id), 201); return; }
            if (segments[4] === 'activate') { scripts.workspace.activate(id, input.revision, input.versionId); json(response, await scripts.view(id)); return; }
            if (segments[4] === 'prepare') { json(response, await scripts.prepare(id, input), 201); return; }
            if (segments[4] === 'reviews') { json(response, scripts.startReview(id, input), 202); return; }
          }
        }
        if (segments.length === 3) {
          if (method === 'GET') { json(response, store.read('projects', id)); return; }
          if (method === 'PUT') { json(response, store.update(id, await readJson(request))); return; }
        }
        if (segments.length === 4 && segments[3] === 'expand' && method === 'POST') {
          const data = await readJson(request);
          json(response, jobs.start(store.read('projects', id), data.revision), 202); return;
        }
        if (segments[3] === 'references') {
          if (segments.length === 4 && method === 'POST') {
            const filename = decodeURIComponent(request.headers['x-file-name'] ?? '参考素材');
            json(response, store.addReference(id, filename, request.headers['content-type'] ?? 'application/octet-stream', await body(request, 25 * 1024 * 1024)), 201); return;
          }
          if (segments.length === 5 && method === 'DELETE') { json(response, store.removeReference(id, segments[4])); return; }
          if (segments.length === 5 && method === 'GET') {
            const project = store.read('projects', id), ref = project.references.find(ref => ref.id === segments[4]);
            if (!ref || !validId(ref.id) || ref.storedName !== `${ref.id}.bin`) throw new AppError('参考素材不存在。', 404);
            const file = path.join(store.root, 'references', id, ref.storedName);
            if (!fs.existsSync(file)) throw new AppError('参考素材文件丢失，项目记录已保留。', 404);
            response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(ref.name)}`, 'Content-Length': fs.statSync(file).size, 'Cache-Control': 'no-store' });
            fs.createReadStream(file).pipe(response); return;
          }
        }
      }
      if (segments[0] === 'api' && segments[1] === 'jobs' && validId(segments[2])) {
        const id = segments[2];
        if (segments.length === 3 && method === 'GET') { json(response, store.read('jobs', id)); return; }
        if (segments.length === 4 && segments[3] === 'cancel' && method === 'POST') { json(response, jobs.cancel(id)); return; }
        if (segments.length === 4 && segments[3] === 'apply' && method === 'POST') {
          const input = await readJson(request), job = store.read('jobs', id);
          const project = store.apply(job, input.revision);
          job.appliedAt = now(); store.write('jobs', job); json(response, project); return;
        }
      }
      if (segments[0] === 'api' && segments[1] === 'script-tasks' && validId(segments[2])) {
        const id = segments[2];
        if (segments.length === 3 && method === 'GET') { json(response, store.read('script-jobs', id)); return; }
        if (segments.length === 4 && method === 'POST') {
          const input = await readJson(request);
          if (segments[3] === 'submit') { json(response, await scripts.submit(id, input), 202); return; }
          if (segments[3] === 'query') { json(response, await scripts.query(id)); return; }
          if (segments[3] === 'adopt') { const task = store.read('script-jobs', id); scripts.adopt(id, input.revision); json(response, await scripts.view(task.projectId)); return; }
        }
      }
      if (segments[0] === 'api' && segments[1] === 'script-reviews' && validId(segments[2])) {
        const id = segments[2];
        if (segments.length === 3 && method === 'GET') { json(response, store.read('script-reviews', id)); return; }
        if (segments.length === 4 && segments[3] === 'cancel' && method === 'POST') { await readJson(request); json(response, scripts.reviewer.cancel(id)); return; }
      }
      if (segments[0] === 'api' && segments[1] === 'creative-tasks' && validId(segments[2])) {
        const id = segments[2];
        if (segments.length === 3 && method === 'GET') { json(response, store.read('creative-jobs', id)); return; }
        if (segments.length === 4 && segments[3] === 'cancel' && method === 'POST') { await readJson(request); json(response, creative.cancel(id)); return; }
      }
      if (segments[0] === 'api' && segments[1] === 'image-generation-tasks' && validId(segments[2])) {
        const id = segments[2];
        if (segments.length === 3 && method === 'GET') { json(response, imageGeneration.read(id)); return; }
        if (segments.length === 4 && segments[3] === 'diagnostics' && method === 'GET') { json(response, imageGeneration.diagnostics.history(id)); return; }
        if (segments.length === 5 && segments[3] === 'artifacts' && /^\d{1,3}$/.test(segments[4]) && method === 'GET') {
          const file = imageGeneration.artifactFile(id, Number(segments[4]));
          response.writeHead(200, { 'Content-Type': file.mimeType, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'Content-Length': file.bytes.length, 'Cache-Control': 'no-store' });
          response.end(file.bytes); return;
        }
        if (segments.length === 4 && method === 'POST') {
          const input = await readJson(request);
          if (segments[3] === 'submit') { json(response, await imageGeneration.submit(id, input), 202); return; }
          if (segments[3] === 'cancel') { json(response, imageGeneration.cancel(id)); return; }
        }
      }
      if (segments[0] === 'api' && segments[1] === 'video-tasks' && validId(segments[2])) {
        const id = segments[2];
        if (segments.length === 3 && method === 'GET') { json(response, videos.read(id)); return; }
        if (segments.length === 4 && method === 'POST') {
          const input = await readJson(request);
          if (segments[3] === 'submit') { json(response, await videos.submit(id, input), 202); return; }
          if (segments[3] === 'query') { json(response, await videos.query(id)); return; }
          if (segments[3] === 'download') { json(response, await videos.download(id)); return; }
          if (segments[3] === 'cancel') { json(response, await videos.cancel(id)); return; }
        }
      }
      if (segments[0] === 'api') throw new AppError('接口不存在。', 404);
      if (method !== 'GET' && method !== 'HEAD') throw new AppError('不支持的请求方法。', 405);
      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const publicRoot = path.join(repoRoot, 'public');
      const file = path.resolve(publicRoot, relative);
      if (!file.startsWith(publicRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new AppError('页面不存在。', 404);
      response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      if (method === 'HEAD') response.end(); else fs.createReadStream(file).pipe(response);
    } catch (error) {
      if (!response.headersSent) json(response, { error: error.status ? error.message : '操作失败，请检查数据目录权限或服务终端日志。' }, error.status ?? 500);
      else response.end();
      if (!error.status) console.error(error);
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return { server, store, jobs, scripts, creative, images, imageGeneration, videos, getTools, getImageCapabilities, close: () => { videos.close(); imageGeneration.close(); creative.close(); scripts.close(); jobs.close(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}

function acquireLock(dataRoot) {
  fs.mkdirSync(dataRoot, { recursive: true });
  const lockfile = path.join(dataRoot, 'studio.lock');
  if (fs.existsSync(lockfile)) {
    let old;
    try { old = JSON.parse(fs.readFileSync(lockfile, 'utf8')); }
    catch { throw new Error('数据目录有无法识别的锁文件，请确认其他工作台已关闭后检查 studio.lock。'); }
    let alive = true;
    try { process.kill(old.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    if (alive) throw new Error(`同一数据目录已有服务运行（PID ${old.pid}）。请打开原服务，或用 DATA_DIR 指定独立目录。`);
    fs.unlinkSync(lockfile);
  }
  fs.writeFileSync(lockfile, JSON.stringify({ pid: process.pid, createdAt: now() }), { flag: 'wx' });
  return () => { try { const value = JSON.parse(fs.readFileSync(lockfile, 'utf8')); if (value.pid === process.pid) fs.unlinkSync(lockfile); } catch {} };
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const dataRoot = path.resolve(process.env.DATA_DIR ?? path.join(repoRoot, 'data'));
  let unlock;
  try {
    const port = Number(process.env.PORT ?? 4317);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 须为 1–65535 的整数。');
    unlock = acquireLock(dataRoot);
    const app = createStudio({ dataDir: dataRoot });
    app.server.on('error', error => { unlock(); console.error(`启动失败：${error.message}`); process.exitCode = 1; });
    app.server.listen(port, '127.0.0.1', () => console.log(`AI-Drama-Studio 已启动：http://127.0.0.1:${port}\n项目数据：${dataRoot}\n按 Ctrl+C 关闭服务。`));
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await app.close(); unlock(); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('exit', unlock);
  } catch (error) { unlock?.(); console.error(`启动失败：${error.message}`); process.exitCode = 1; }
}
