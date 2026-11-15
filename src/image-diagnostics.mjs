import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, now, validId } from './store.mjs';
import { creativeHash } from './creative-store.mjs';
import { summarizeImageEvidence } from './image-evidence.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);
const canonical = value => { const resolved = fs.realpathSync.native(value).replace(/^\\\\\?\\/, ''); return process.platform === 'win32' ? resolved.toLowerCase() : resolved; };

// Trusted local audit journal. There is deliberately no HTTP append endpoint.
// Original tasks, errors, RPC receipts, guard markers and images are read-only.
export class ImageTaskDiagnostics {
  constructor(store) {
    this.store = store;
    this.directory = path.join(store.root, 'image-generation-diagnostics');
    fs.mkdirSync(this.directory, { recursive: true });
  }
  sourceFile(taskId, relative) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..')) throw new AppError('诊断证据路径不正确。');
    const portable = relative.replaceAll('\\', '/');
    const jobRelative = `image-generation-jobs/${taskId}.json`;
    const allowed = portable === jobRelative || portable === jobRelative + '.bak' || portable.startsWith(`runtime/image-generation/${taskId}/`) || portable.startsWith(`runtime/image-generation/${taskId}-host-control/`);
    if (!allowed) throw new AppError('诊断只能绑定本任务已有文件，不能读取其他项目或认证。');
    const file = path.resolve(this.store.root, relative), root = canonical(this.store.root);
    const actual = canonical(file), expectedJob = path.join(root, 'image-generation-jobs', `${taskId}.json`);
    const taskRuntime = path.join(root, 'runtime', 'image-generation', taskId), taskControl = path.join(root, 'runtime', 'image-generation', `${taskId}-host-control`);
    if (!(actual === expectedJob || actual === expectedJob + '.bak' || actual.startsWith(taskRuntime + path.sep) || actual.startsWith(taskControl + path.sep))) throw new AppError('诊断证据实际路径跨越本任务目录，禁止链接到其他任务或认证。');
    return file;
  }
  append(taskId, { report, sourceFiles = [] }) {
    if (!validId(taskId)) throw new AppError('诊断任务ID不正确。');
    const job = this.store.read('image-generation-jobs', taskId);
    if (!report || report.taskId !== taskId || report.original?.status !== job.status || report.original?.error !== (job.error ?? null) || report.original?.submittedAt !== (job.submittedAt ?? null)) throw new AppError('诊断不匹配原任务，不能改写或补造原终态。', 409);
    for (const key of ['requestId', 'packetId', 'inputSnapshotHash']) if ((report.original[key] ?? null) !== (job[key] ?? null)) throw new AppError('诊断输入或任务绑定已改变，不能将旧报告重绑到新要求。', 409);
    if (job.status !== 'succeeded' && report.evidence?.acceptance?.status === 'passed') throw new AppError('原任务未成功，诊断不能宣称完整候选验收通过。', 409);
    if (JSON.stringify(report).length > 512000) throw new AppError('诊断过大；原始事件和图片字节应留在原文件中。');
    const jobFile = this.store.file('image-generation-jobs', taskId), originalJobSha256 = digest(fs.readFileSync(jobFile));
    if (report.original.taskFileSha256 && report.original.taskFileSha256 !== originalJobSha256) throw new AppError('诊断读取后的原任务字节已变化，请重新读取；未追加旧报告。', 409);
    const verifiedFiles = sourceFiles.map(source => {
      if (!source || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new AppError('诊断证据缺少实际Hash。');
      const file = this.sourceFile(taskId, source.relative);
      if (digest(fs.readFileSync(file)) !== source.sha256) throw new AppError('诊断期间证据文件改变，原文件保留，请重新读取。', 409);
      return { relative: source.relative.replaceAll('\\', '/'), sha256: source.sha256 };
    });
    const reportHash = creativeHash(report), previous = this.history(taskId).records.find(record => record.current && record.reportHash === reportHash && record.originalJobSha256 === originalJobSha256 && creativeHash(record.sourceFiles) === creativeHash(verifiedFiles));
    if (previous) return previous;
    const timestamp = now(), record = { id: randomUUID(), taskId, projectId: job.projectId, createdAt: timestamp, updatedAt: timestamp, schemaVersion: 1, originalJobSha256, reportHash, sourceFiles: verifiedFiles, report: clone(report), originalTaskModified: false };
    const file = path.join(this.directory, `${record.id}.json`), fd = fs.openSync(file, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify(record, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return record;
  }
  history(taskId) {
    const job = this.store.read('image-generation-jobs', taskId), originalJobSha256 = digest(fs.readFileSync(this.store.file('image-generation-jobs', taskId)));
    const values = [], warnings = [];
    for (const name of fs.readdirSync(this.directory).filter(name => name.endsWith('.json'))) {
      try {
        const record = this.store.read('image-generation-diagnostics', name.slice(0, -5));
        if (!validId(record.taskId) || typeof record.updatedAt !== 'string' || !record.report || !Array.isArray(record.sourceFiles)) throw new Error('诊断结构不完整');
        values.push(record);
      } catch { warnings.push(`诊断记录 ${name} 损坏，原件保留，诊断历史尚未完整核实。`); }
    }
    values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const records = values.filter(record => record.taskId === taskId).map(record => {
      let current = false;
      try { current = record.originalJobSha256 === originalJobSha256 && record.reportHash === creativeHash(record.report) && Array.isArray(record.sourceFiles) && record.sourceFiles.every(source => digest(fs.readFileSync(this.sourceFile(taskId, source.relative))) === source.sha256); } catch { current = false; }
      return { ...record, current };
    });
    return { taskId, original: { status: job.status, error: job.error ?? null, submittedAt: job.submittedAt ?? null }, records, warnings };
  }
  view(job) {
    const history = this.history(job.id), latest = history.records[0];
    const fallback = () => summarizeImageEvidence({ job });
    if (!latest?.current || history.warnings.length) return { ...fallback(), diagnosticRecordId: latest?.id ?? null, current: false, diagnosticWarnings: [...history.warnings, ...(latest && !latest.current ? ['已有诊断的证据或任务字节改变；该诊断过期，原记录保留。'] : [])] };
    return { ...clone(latest.report), diagnosticRecordId: latest.id, diagnosedAt: latest.createdAt, current: true, diagnosticWarnings: history.warnings };
  }
}
