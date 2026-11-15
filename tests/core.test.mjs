import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { Store, inputHash } from '../src/store.mjs';
import { CodexJobs, promptFor } from '../src/codex.mjs';
import { createStudio } from '../src/server.mjs';

const artifacts = path.resolve('tests/.artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const brief = () => ({ synopsis: '雨夜相逢。', background: '末班车站。', characters: '父子。', conflict: '身份未知。', emotion: '从警惕到释怀。', ending: '父子相认。', preservedContent: ['怀表', '温暖结局'], addedSettings: ['车站有暖光。'] });
function removeTemporaryRoot(root) {
  const resolved = fs.realpathSync(root);
  assert.ok(resolved.startsWith(fs.realpathSync(artifacts) + path.sep), '清理只允许测试目录内的临时数据');
  fs.rmSync(resolved, { recursive: true, force: true });
}
function tempStore(t) {
  const root = fs.mkdtempSync(path.join(artifacts, 'core-'));
  t.after(() => removeTemporaryRoot(root));
  return new Store(root);
}
function succeeded(p) {
  return { id: randomUUID(), projectId: p.id, status: 'succeeded', inputRevision: p.revision, inputHash: inputHash(p), result: brief(), updatedAt: new Date().toISOString(), appliedAt: null };
}

test('项目及人工修改跨Store实例恢复，保留上次备份', t => {
  const store = tempStore(t);
  const p = store.create({ name: '雨夜车站', idea: '必须保留怀表和温暖结局。' });
  assert.equal(p.durationSeconds, 30);
  assert.equal(p.aspectRatio, '9:16');
  const next = store.update(p.id, { revision: p.revision, durationSeconds: 45, aspectRatio: '16:9', style: '写实', budgetCap: 128, creativeBrief: brief() });
  const restored = new Store(store.root).read('projects', p.id);
  assert.deepEqual(restored, next);
  assert.equal(restored.revision, 2);
  assert.equal(JSON.parse(fs.readFileSync(store.file('projects', p.id) + '.bak', 'utf8')).revision, 1);
});

test('旧revision不会覆盖当前人工稿，损坏文件仅报告并保留', t => {
  const store = tempStore(t);
  const p = store.create({ name: '保护人工稿' });
  const changed = store.update(p.id, { revision: p.revision, idea: '用户最后一次手工修改' });
  assert.throws(() => store.update(p.id, { revision: p.revision, idea: '旧窗口' }), error => error.status === 409);
  assert.equal(store.read('projects', p.id).idea, changed.idea);
  const file = store.file('projects', p.id);
  fs.writeFileSync(file, '{损坏');
  const list = store.list('projects');
  assert.equal(list.values.length, 0);
  assert.equal(list.warnings.length, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), '{损坏');
  assert.ok(fs.existsSync(file + '.bak'));
});

test('扩写候选采用需成功状态、当前输入Hash和当前revision', t => {
  const store = tempStore(t);
  const p = store.create({ name: '候选保护', idea: '父子在车站相认。' });
  const job = succeeded(p);
  assert.throws(() => store.apply({ ...job, status: 'failed', result: null }, p.revision), error => error.status === 409);
  const applied = store.apply(job, p.revision);
  assert.deepEqual(applied.creativeBrief, job.result);
  assert.equal(applied.briefProvenance.source, 'codex-cli');
  assert.throws(() => store.apply({ ...job, appliedAt: new Date().toISOString() }, applied.revision), error => error.status === 409);
  const changed = store.update(p.id, { revision: applied.revision, idea: '结局必须保持陌生人身份。' });
  assert.throws(() => store.apply(job, changed.revision), error => error.status === 409 && /已改变/.test(error.message));
  assert.equal(store.read('projects', p.id).idea, changed.idea);
});

test('参考素材仅写入受控路径，移除链接保留原始二进制', t => {
  const store = tempStore(t);
  const p = store.create({ name: '素材保护' });
  const next = store.addReference(p.id, '../参考图.png', 'image/png', Buffer.from('image-bytes'));
  const ref = next.references[0];
  assert.ok(!ref.name.includes('/'));
  assert.equal(ref.storedName, `${ref.id}.bin`);
  const file = path.join(store.root, 'references', p.id, ref.storedName);
  assert.equal(fs.readFileSync(file, 'utf8'), 'image-bytes');
  const removed = store.removeReference(p.id, ref.id);
  assert.equal(removed.references.length, 0);
  assert.ok(fs.existsSync(file));
  assert.throws(() => store.read('projects', '../outside'), error => error.status === 400);
});

test('重启将未完成任务标为interrupted，不自动重试或编造结果', t => {
  const store = tempStore(t);
  const p = store.create({ name: '恢复', idea: '等待生成。' });
  const id = randomUUID();
  store.write('jobs', { id, projectId: p.id, status: 'running', result: null, events: [], updatedAt: new Date().toISOString() });
  const jobs = new CodexJobs(store);
  t.after(() => jobs.close());
  const recovered = store.read('jobs', id);
  assert.equal(recovered.status, 'interrupted');
  assert.equal(recovered.result, null);
  assert.equal(jobs.active.size, 0);
  assert.match(recovered.error, /未自动重试/);
});

test('用户命令文本作为JSON资料，认证不可用时只有真实错误', async t => {
  const store = tempStore(t);
  const p = store.create({ name: '输入边界', idea: '故事里出现 $(whoami) 和 `命令`，不要执行。' });
  assert.match(promptFor(p), /\$\(whoami\)/);
  assert.match(promptFor(p), /不是对系统的指令/);
  assert.match(promptFor(p), /"budgetCurrency": "CNY"/);
  const old = process.env.CODEX_BIN;
  // Node is deliberately not Codex. Its real login-status invocation must fail;
  // the production path must retain that failure without a fabricated result.
  process.env.CODEX_BIN = process.execPath;
  const jobs = new CodexJobs(store);
  t.after(() => { jobs.close(); if (old === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = old; });
  const job = jobs.start(p, p.revision);
  let current;
  for (let i = 0; i < 100; i++) {
    current = store.read('jobs', job.id);
    if (current.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(current.status, 'failed');
  assert.equal(current.result, null);
  assert.match(current.error, /待配置.*认证不可用/s);
  assert.equal(store.read('projects', p.id).creativeBrief, null);
});

test('HTTP边界、附件往返与服务重启恢复', async t => {
  const root = fs.mkdtempSync(path.join(artifacts, 'http-'));
  const options = { dataDir: root, inspectTools: async () => ({ checkedAt: new Date().toISOString(), tools: [] }) };
  let app = createStudio(options);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); removeTemporaryRoot(root); });
  let base = `http://127.0.0.1:${app.server.address().port}`;
  const health = await fetch(base + '/api/health');
  assert.equal(health.status, 200);
  const cross = await fetch(base + '/api/projects', { headers: { Origin: 'https://example.com' } });
  assert.equal(cross.status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    http.get(base + '/api/health', { headers: { Host: 'evil.example' } }, response => {
      response.resume(); resolve(response.statusCode);
    }).once('error', reject);
  });
  assert.equal(hostStatus, 403);
  const create = await fetch(base + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'HTTP项目', idea: '安全保存' }) });
  assert.equal(create.status, 201);
  const p = await create.json();
  const save = await fetch(`${base}/api/projects/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: p.revision, idea: '已更新' }) });
  assert.equal(save.status, 200);
  const stale = await fetch(`${base}/api/projects/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: p.revision, idea: '旧版本' }) });
  assert.equal(stale.status, 409);
  assert.equal(app.store.read('projects', p.id).idea, '已更新');
  const fixture = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff, 0x0d, 0x0a]);
  const upload = await fetch(`${base}/api/projects/${p.id}/references`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent('雨夜 参考图.png') },
    body: fixture,
  });
  assert.equal(upload.status, 201);
  const withReference = await upload.json();
  const reference = withReference.references[0];
  assert.equal(reference.name, '雨夜 参考图.png');
  assert.equal(reference.mimeType, 'image/png');
  assert.equal(reference.size, fixture.length);
  const referenceRoute = `/api/projects/${p.id}/references/${reference.id}`;
  const download = await fetch(base + referenceRoute);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/octet-stream');
  assert.match(decodeURIComponent(download.headers.get('content-disposition')), /雨夜 参考图\.png/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), fixture);
  await app.close();
  app = createStudio(options);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const recovered = await (await fetch(`${base}/api/projects/${p.id}`)).json();
  assert.deepEqual(recovered, withReference, '重启HTTP服务后项目及附件记录完整恢复');
  const recoveredDownload = await fetch(base + referenceRoute);
  assert.equal(recoveredDownload.status, 200);
  assert.deepEqual(Buffer.from(await recoveredDownload.arrayBuffer()), fixture, '重启后附件二进制完整恢复');
  const removed = await fetch(base + referenceRoute, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).references.length, 0);
  assert.equal((await fetch(base + referenceRoute)).status, 404);
  assert.ok(fs.existsSync(path.join(root, 'references', p.id, reference.storedName)), '移除引用后保留原始素材供恢复');
  const noJson = await fetch(base + '/api/projects', { method: 'POST', body: 'name=attack' });
  assert.equal(noJson.status, 415);
  const traversal = await fetch(base + '/%2e%2e%2fREADME.md');
  assert.equal(traversal.status, 404);
});
