import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { creativeHash } from '../src/creative-store.mjs';
import { CanvasVideoAuthority } from '../src/canvas-authorization.mjs';

const directory = path.resolve('tests/.artifacts/canvas-authority'); fs.mkdirSync(directory, { recursive: true });
function context() {
  const store = new Store(fs.mkdtempSync(path.join(directory, 'isolated-'))), authority = new CanvasVideoAuthority(store), taskId = randomUUID();
  const scope = { taskId, localProjectId: randomUUID(), canvasProjectId: randomUUID(), nodeId: 'node_ht5aaps7yz', draftVersion: 3, inputSha256: 'a'.repeat(64), parameters: { model: 'seedance_2.0_vip', durationSeconds: 5, resolution: '720p', outputCount: 1 } }, binding = { scope, scopeHash: creativeHash(scope) };
  const input = { taskId, ...binding, maxEstimatedCredits: 70, approvalText: '【ISOLATED TEST ONLY】模拟本人明确批准，不构成任何真实任务授权。', expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
  return { store, authority, taskId, scope, binding, input };
}

test('本机签名批准覆盖具体项目/节点/草稿/输入/参数，无批准及伪造请求不能自证', () => {
  const ctx = context(); assert.equal(ctx.authority.publicStatus(ctx.taskId, ctx.binding).status, 'not_granted'); assert.equal(fs.existsSync(ctx.authority.keyFile), false);
  assert.throws(() => ctx.authority.verify({ ...ctx.input, id: randomUUID() }, ctx.binding), /待本人批准/);
  const grant = ctx.authority.issue(ctx.input); assert.equal(grant.maxEstimatedCredits, 70); assert.equal(grant.maxSubmissions, 1); assert.equal(ctx.authority.publicStatus(ctx.taskId, ctx.binding).status, 'approved');
  assert.equal(ctx.authority.verify(grant, ctx.binding).id, grant.id); assert.ok(fs.statSync(ctx.authority.keyFile).size === 32);
  for (const changed of [{ ...ctx.scope, draftVersion: 4 }, { ...ctx.scope, inputSha256: 'b'.repeat(64) }, { ...ctx.scope, canvasProjectId: randomUUID() }, { ...ctx.scope, parameters: { ...ctx.scope.parameters, outputCount: 2 } }]) assert.throws(() => ctx.authority.verify(grant, { scope: changed, scopeHash: creativeHash(changed) }), /待本人批准/);
});

test('批准只认70积分预估阈值及有限本地有效期，不把100计划、无效日期或短文字当授权', () => {
  for (const patch of [{ maxEstimatedCredits: 100 }, { expiresAt: 'invalid' }, { expiresAt: new Date(Date.now() - 1000).toISOString() }, { expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() }, { approvalText: 'yes' }, { scopeHash: 'c'.repeat(64) }]) { const ctx = context(); assert.throws(() => ctx.authority.issue({ ...ctx.input, ...patch })); assert.equal(fs.existsSync(ctx.authority.keyFile), false); }
});

test('批准claim先持久化原submitId，重启不能换ID或重签以重置一次额度', () => {
  const ctx = context(), grant = ctx.authority.issue(ctx.input), submitId = randomUUID();
  const claimed = ctx.authority.claim(grant, ctx.binding, submitId); assert.equal(claimed.claimedSubmitId, submitId);
  const recovered = new CanvasVideoAuthority(ctx.store); assert.equal(recovered.publicStatus(ctx.taskId, ctx.binding).status, 'claimed');
  assert.equal(recovered.verify(grant, ctx.binding, { submitId, allowClaimed: true }).claimedSubmitId, submitId);
  assert.throws(() => recovered.claim(grant, ctx.binding, randomUUID()), /已绑定/); assert.throws(() => recovered.issue(ctx.input), /已有本机批准/);
});

test('签名损坏、记录损坏均停止批准，原件保留，不能忽略历史而重新签发', () => {
  const ctx = context(), grant = ctx.authority.issue(ctx.input), file = ctx.authority.file(grant.id), envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  envelope.value.maxSubmissions = 999; fs.writeFileSync(file, JSON.stringify(envelope)); const corrupt = fs.readFileSync(file);
  assert.equal(ctx.authority.publicStatus(ctx.taskId, ctx.binding).status, 'invalid'); assert.throws(() => ctx.authority.issue(ctx.input)); assert.deepEqual(fs.readFileSync(file), corrupt);
  fs.writeFileSync(file, 'BROKEN JSON'); assert.equal(ctx.authority.publicStatus(ctx.taskId, ctx.binding).status, 'invalid'); assert.throws(() => ctx.authority.issue(ctx.input)); assert.equal(fs.readFileSync(file, 'utf8'), 'BROKEN JSON');
});
