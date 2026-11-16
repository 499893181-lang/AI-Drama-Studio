import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { AppError, now, validId } from './store.mjs';
import { creativeHash } from './creative-store.mjs';

/** Only the local operator CLI can issue approvals. HTTP has no issue route. */
export class CanvasVideoAuthority {
  constructor(store) { this.store = store; this.directory = path.join(store.root, 'canvas-video-approvals'); fs.mkdirSync(this.directory, { recursive: true }); this.keyFile = path.join(this.directory, 'local-signing.key'); }
  key({ create = false } = {}) {
    if (!fs.existsSync(this.keyFile)) { if (!create) return null; fs.writeFileSync(this.keyFile, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    const key = fs.readFileSync(this.keyFile); if (key.length !== 32) throw new AppError('本机批准签名材料损坏，保留原件并停止执行。', 409); return key;
  }
  file(id) { if (!validId(id)) throw new AppError('批准标识无效。'); return path.join(this.directory, `${id}.json`); }
  sign(value, key = this.key()) { return key ? createHmac('sha256', key).update(creativeHash(value)).digest('hex') : null; }
  read(id) {
    let envelope; try { envelope = JSON.parse(fs.readFileSync(this.file(id), 'utf8')); } catch { return null; }
    if (!envelope || typeof envelope.value !== 'object' || !envelope.value) return null;
    const signature = this.sign(envelope.value);
    if (!signature || typeof envelope.signature !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(envelope.signature))) return null;
    return envelope.value;
  }
  write(value) {
    const target = this.file(value.id), temporary = target + `.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ value, signature: this.sign(value) }, null, 2), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, target); return value;
  }
  issue({ taskId, scope, scopeHash, maxEstimatedCredits, approvalText, expiresAt }) {
    if (!validId(taskId) || scope?.taskId !== taskId || creativeHash(scope) !== scopeHash || maxEstimatedCredits !== 70 || typeof approvalText !== 'string' || approvalText.trim().length < 8 || approvalText.length > 2000) throw new AppError('批准须明确本人声明、当前任务范围Hash和70积分预估阈值。', 409);
    const expiration = Date.parse(expiresAt); if (!Number.isFinite(expiration) || expiration <= Date.now() || expiration > Date.now() + 24 * 60 * 60 * 1000) throw new AppError('本机批准有效期须在未来24小时以内；不是平台报价有效期。', 409);
    if (this.find(taskId)) throw new AppError('本任务已有本机批准记录，保留原件；不自动重签或重置次数。', 409);
    this.key({ create: true });
    const grant = { id: randomUUID(), taskId, scope: structuredClone(scope), scopeHash, approvedAt: now(), expiresAt, maxEstimatedCredits: 70, maxSubmissions: 1, approvedBy: 'local-operator', approvalText: approvalText.trim(), claimedSubmitId: null, claimedAt: null };
    fs.writeFileSync(this.file(grant.id), JSON.stringify({ value: grant, signature: this.sign(grant) }, null, 2), { flag: 'wx', mode: 0o600 }); return grant;
  }
  find(taskId) {
    const records = fs.readdirSync(this.directory).filter(name => name.endsWith('.json')).map(name => this.read(name.slice(0, -5)));
    if (records.some(value => !value)) throw new AppError('本机批准记录损坏或签名无效，旧记录保留；不能忽略历史重新发放批准。', 409);
    const values = records.filter(value => value.taskId === taskId);
    if (values.length > 1) throw new AppError('同一任务存在多份批准，不能猜测或重置次数。', 409); return values[0] ?? null;
  }
  verify(grant, binding, { submitId, allowClaimed = false } = {}) {
    const current = grant?.id ? this.read(grant.id) : null;
    if (!current || current.taskId !== binding?.scope?.taskId || current.scopeHash !== binding?.scopeHash || creativeHash(current.scope) !== binding.scopeHash || current.maxEstimatedCredits !== 70 || current.maxSubmissions !== 1 || Date.parse(current.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(current.expiresAt))) throw new AppError('待本人批准：没有覆盖当前项目、节点、草稿、输入和参数的有效本机签名授权。', 409);
    if (current.claimedSubmitId && (!allowClaimed || current.claimedSubmitId !== submitId)) throw new AppError('本次批准已绑定原submitId，不能重复提交或重新分配。', 409);
    return current;
  }
  claim(grant, binding, submitId) {
    if (!validId(submitId)) throw new AppError('提交身份无效。');
    const current = this.verify(grant, binding, { submitId });
    current.claimedSubmitId = submitId; current.claimedAt = now(); return this.write(current);
  }
  publicStatus(taskId, binding) {
    try { const grant = this.find(taskId); if (!grant) return { status: 'not_granted', reason: '待本人明确批准；页面和请求参数不能发放授权。' }; this.verify(grant, binding, { submitId: grant.claimedSubmitId, allowClaimed: true }); return { status: grant.claimedSubmitId ? 'claimed' : 'approved', id: grant.id, approvedAt: grant.approvedAt, expiresAt: grant.expiresAt, maxEstimatedCredits: grant.maxEstimatedCredits, claimedSubmitId: grant.claimedSubmitId }; }
    catch (error) { return { status: 'invalid', reason: error.message }; }
  }
}
