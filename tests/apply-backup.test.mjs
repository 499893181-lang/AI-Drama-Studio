import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store, inputHash } from '../src/store.mjs';

const artifacts = path.resolve('tests/.artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const brief = ending => ({ synopsis: '雨夜相逢。', background: '末班车站。', characters: '父子。', conflict: '身份未知。', emotion: '从迟疑到释怀。', ending, preservedContent: ['怀表', '温暖结局'], addedSettings: ['车站有暖光。'] });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(artifacts, 'apply-backup-'));
  t.after(() => {
    const resolved = fs.realpathSync(root);
    assert.ok(resolved.startsWith(fs.realpathSync(artifacts) + path.sep), '只清理测试目录内的临时数据');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const store = new Store(root);
  const initial = store.create({ name: '候选采用备份回归', idea: '雨夜父子在车站相认，保留怀表。' });
  const job = (project, ending) => ({ id: randomUUID(), projectId: project.id, status: 'succeeded', result: brief(ending), inputHash: inputHash(project), inputRevision: project.revision, updatedAt: '2026-11-15T04:00:00.000Z', appliedAt: null });
  const firstJob = job(initial, '第一版模型结局。');
  const first = store.apply(firstJob, initial.revision);
  const manual = store.update(first.id, { revision: first.revision, creativeBrief: { ...first.creativeBrief, ending: '【人工稿】父子一起守候末班车，必须保留我的这次修改。' } });
  assert.ok(manual.briefProvenance.userEditedAt);
  return { store, manual, job: job(manual, '新候选结局，等用户采用。'), file: store.file('projects', manual.id) };
}

test('采用候选一次写入完整新稿，备份逐字保留采用前人工稿、旧revision与旧来源', t => {
  const { store, manual, job, file } = fixture(t);
  const before = fs.readFileSync(file, 'utf8');
  const adopted = store.apply(job, manual.revision);
  assert.equal(fs.readFileSync(file + '.bak', 'utf8'), before, '备份必须与采用前完整人工稿字节一致');
  const backup = JSON.parse(fs.readFileSync(file + '.bak', 'utf8'));
  assert.equal(backup.creativeBrief.ending, manual.creativeBrief.ending);
  assert.equal(backup.revision, manual.revision);
  assert.deepEqual(backup.briefProvenance, manual.briefProvenance);
  assert.equal(adopted.revision, manual.revision + 1);
  assert.deepEqual(adopted.creativeBrief, job.result);
  assert.deepEqual(adopted.briefProvenance, { source: 'codex-cli', jobId: job.id, inputHash: job.inputHash, inputRevision: job.inputRevision, generatedAt: job.updatedAt, userEditedAt: null });
  assert.deepEqual(new Store(store.root).read('projects', manual.id), adopted, '重读磁盘时新稿及完整来源已经同时存在');
});

test('候选状态、重复采用、Hash、revision或格式无效时不改变主文件及备份', t => {
  const { store, manual, job, file } = fixture(t);
  const before = fs.readFileSync(file, 'utf8');
  const backupBefore = fs.readFileSync(file + '.bak', 'utf8');
  const cases = [
    [{ ...job, status: 'failed', result: null }, manual.revision, 409],
    [{ ...job, appliedAt: '2026-11-15T04:01:00.000Z' }, manual.revision, 409],
    [{ ...job, inputHash: 'outdated-input-hash' }, manual.revision, 409],
    [job, manual.revision - 1, 409],
    [{ ...job, result: { ...job.result, ending: 123 } }, manual.revision, 400],
  ];
  for (const [candidate, revision, status] of cases) {
    assert.throws(() => store.apply(candidate, revision), error => error.status === status);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.equal(fs.readFileSync(file + '.bak', 'utf8'), backupBefore);
  }
});
