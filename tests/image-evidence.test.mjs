import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectImageInputSchema, summarizeImageEvidence } from '../src/image-evidence.mjs';

const job = () => ({ id: 'task', requestId: 'request', packetId: 'packet', submittedAt: '2026-11-15T10:34:48.587Z', inputSnapshotHash: 'input-hash', threadId: 'thread', turnId: 'turn', status: 'failed', error: 'original failure', plannedReferences: [{ id: 'ref', sha256: 'a'.repeat(64) }], executionMode: 'official-codex-account' });
const request = () => ({ id: 10, method: 'turn/start', params: { threadId: 'thread', input: [{ type: 'text', text: 'fixture' }, { type: 'localImage', path: 'C:/local/ref.png' }] } });
const event = (method, item) => ({ method, params: { threadId: 'thread', turnId: 'turn', item } });
const completed = () => [event('item/started', { id: 'image-1', type: 'imageGeneration', status: 'inProgress' }), event('item/completed', { id: 'image-1', type: 'imageGeneration', status: 'completed', result: 'not used as proof' }), { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } }];
const physicalArtifact = () => ({ fileHashVerified: true, decoded: { decoded: true }, sha256: 'b'.repeat(64), width: 320, height: 180 });

test('Schema可选inputImages不补default；元素path/sha256语义独立记录', () => {
  const schema = { definitions: { ThreadItem: { oneOf: [{ required: ['id', 'status', 'type'], properties: { type: { enum: ['imageGeneration'] }, inputImages: { type: 'array', description: 'Observed local inputs for a completed generation, absent on older items.' } } }] }, ImageGenerationInputImage: { required: ['path', 'sha256'], description: 'A local image file successfully read for this exact image-generation request.', properties: { sha256: { description: 'Lowercase SHA-256 of the file bytes read before image normalization.' } } } } };
  const result = inspectImageInputSchema(schema);
  assert.equal(result.inputImages.required, false); assert.equal(result.inputImages.hasDefault, false); assert.equal(Object.hasOwn(result.inputImages, 'default'), false);
  assert.deepEqual(result.inputImage.required, ['path', 'sha256']); assert.match(result.inputImage.sha256Description, /before image normalization/);
  assert.throws(() => inspectImageInputSchema({}), /没有可核查/);
});

test('缺日志或只有计划时计数和使用证据未知，不能推断为零', () => {
  const result = summarizeImageEvidence({ job: job() });
  assert.equal(result.counts.applicationSubmissions, 1); assert.equal(result.counts.modelTurnRequests, null); assert.equal(result.counts.imageToolStarts, null);
  assert.equal(result.attachments.planned.count, 1); assert.equal(result.attachments.sessionSent.status, 'unverified');
  assert.equal(result.attachments.serverReceipt.count, null); assert.equal(result.attachments.serverReceipt.value, null); assert.equal(result.evidence.references.status, 'unverified');
  const partial = summarizeImageEvidence({ job: job(), requests: [], events: [] }); assert.equal(partial.counts.imageToolStarts, null);
  const empty = summarizeImageEvidence({ job: { status: 'prepared' }, requests: [], events: [], logsComplete: true }); assert.equal(empty.counts.applicationSubmissions, 0); assert.equal(empty.counts.imageToolStarts, 0);
});

test('请求日志在实际write前，只有请求或turn ack不能证明附件已接收', () => {
  const original = job(), before = structuredClone(original);
  const result = summarizeImageEvidence({ job: original, requests: [request()], events: [{ id: 10, result: { turn: { id: 'turn', status: 'inProgress' } } }], logsComplete: true });
  assert.equal(result.counts.modelTurnRequests, 1); assert.equal(result.counts.modelTurnsAcknowledged, 1); assert.equal(result.attachments.sessionSent.status, 'unverified');
  assert.equal(result.attachments.sessionSent.count, null); assert.equal(result.attachments.sessionSent.requestLoggedCount, 1); assert.equal(result.attachments.sessionSent.sendConfirmedCount, null); assert.equal(result.attachments.sessionReceived.status, 'not_returned');
  assert.match(result.attachments.sessionSent.reason, /stdin发送之前/); assert.deepEqual(original, before);
});

test('实际管道写入回调与服务端会话接收仍分开', () => {
  const result = summarizeImageEvidence({ job: job(), requests: [request()], events: [], transport: [{ method: 'turn/start', rpcId: 10, status: 'written_to_pipe', provesServerReceived: false }] });
  assert.equal(result.attachments.sessionSent.status, 'observed'); assert.equal(result.attachments.sessionSent.count, 1); assert.equal(result.attachments.sessionSent.pipeWrittenCount, 1);
  assert.equal(result.attachments.sessionReceived.status, 'not_returned'); assert.equal(result.attachments.sessionSent.sendConfirmedCount, null); assert.equal(result.attachments.toolArguments.status, 'unverified');
});

test('实际产物、官方终态和会话回显分别成立，原失败和缺参考回执保持', () => {
  const original = job(), before = structuredClone(original), events = completed();
  const message = { id: 'message', type: 'userMessage', content: [{ type: 'localImage', path: 'C:\\local\\ref.png' }] };
  events.push(event('item/started', message), event('item/completed', message), { method: 'hook/completed', params: { threadId: 'thread', turnId: 'turn', run: { status: 'failed', eventName: 'preToolUse' } } });
  const result = summarizeImageEvidence({ job: original, requests: [request()], events, artifact: physicalArtifact(), logsComplete: true });
  assert.equal(result.evidence.artifact.status, 'produced'); assert.equal(result.evidence.protection.status, 'failed'); assert.equal(result.evidence.protection.strictSingleCallGuaranteed, false);
  assert.equal(result.attachments.sessionSent.status, 'observed'); assert.equal(result.attachments.sessionReceived.count, 1); assert.equal(result.attachments.toolArguments.count, null);
  assert.equal(result.attachments.toolReadReceipt.fieldPresent, false); assert.equal(result.attachments.toolReadReceipt.value, null); assert.equal(result.evidence.acceptance.status, 'incomplete');
  assert.deepEqual(original, before); assert.equal(result.original.error, 'original failure'); assert.equal(result.counts.imageToolCompletions, 1);
});

test('元数据或模型文字不能变成新的真实文件与解码证据', () => {
  const result = summarizeImageEvidence({ job: { ...job(), artifact: { sha256: 'a', decoded: { decoded: true } }, result: { assetId: 'asset' } }, events: completed(), logsComplete: true });
  assert.equal(result.evidence.artifact.status, 'unverified'); assert.equal(result.evidence.artifact.fileHashVerified, false); assert.equal(result.evidence.artifact.decoded, false);
  const withoutTurn = summarizeImageEvidence({ job: job(), events: completed().slice(0, 2), artifact: physicalArtifact() }); assert.equal(withoutTurn.evidence.artifact.status, 'unverified');
});

test('inputImages存在仅证明本地读取范围，不能冒充后端使用或视觉检查', () => {
  const events = completed(); events[1].params.item.inputImages = [{ path: 'C:/local/ref.png', sha256: 'a'.repeat(64) }];
  const result = summarizeImageEvidence({ job: job(), events, artifact: physicalArtifact(), referenceFiles: [{ path: 'C:\\local\\ref.png', sha256: 'a'.repeat(64), actualSha256: 'a'.repeat(64), fileHashVerified: true }], logsComplete: true });
  assert.equal(result.attachments.toolReadReceipt.status, 'observed'); assert.equal(result.attachments.toolReadReceipt.localFileHashMatches, true); assert.equal(result.evidence.references.localReadReceiptMatches, true);
  assert.equal(result.attachments.serverReceipt.status, 'not_returned'); assert.equal(result.attachments.serverReceipt.count, null);
  assert.equal(result.attachments.serverReceipt.backendReferenceUsageVerified, false); assert.equal(result.attachments.visualCheck.status, 'unverified'); assert.equal(result.evidence.acceptance.status, 'incomplete');
  const mismatch = summarizeImageEvidence({ job: job(), events, referenceFiles: [], logsComplete: true }); assert.equal(mismatch.attachments.toolReadReceipt.localFileHashMatches, false);
});

test('缺省、合法空数组与非法null分别保留，不能把缺省补空数组', () => {
  const events = completed();
  const absent = summarizeImageEvidence({ job: job(), events }); assert.equal(absent.attachments.toolReadReceipt.fieldPresent, false); assert.equal(absent.attachments.toolReadReceipt.value, null);
  events[1].params.item.inputImages = [];
  const empty = summarizeImageEvidence({ job: job(), events }); assert.equal(empty.attachments.toolReadReceipt.fieldPresent, true); assert.deepEqual(empty.attachments.toolReadReceipt.value, []); assert.equal(empty.attachments.toolReadReceipt.plannedHashMatches, false);
  events[1].params.item.inputImages = null;
  const invalid = summarizeImageEvidence({ job: job(), events }); assert.equal(invalid.attachments.toolReadReceipt.fieldPresent, true); assert.equal(invalid.attachments.toolReadReceipt.status, 'unverified'); assert.equal(invalid.attachments.toolReadReceipt.value, null);
});

test('inputImages非法元素保留原值但不能升级为成功本地读取回执', () => {
  for (const value of [[{}], [{ path: 'C:/ref.png', sha256: null }], [{ path: 'relative.png', sha256: 'a'.repeat(64) }], [{ path: 'C:/ref.png', sha256: 'A'.repeat(64) }]]) {
    const events = completed(); events[1].params.item.inputImages = value;
    const result = summarizeImageEvidence({ job: job(), events });
    assert.equal(result.attachments.toolReadReceipt.status, 'unverified'); assert.equal(result.attachments.toolReadReceipt.count, null); assert.deepEqual(result.attachments.toolReadReceipt.value, value);
    assert.equal(result.evidence.references.localReadReceiptMatches, null); assert.equal(result.attachments.serverReceipt.status, 'not_returned');
  }
});

test('应用一次不等于工具一次；重复生命周期去重，外来会话不计入本任务', () => {
  const events = completed(); events.push(structuredClone(events[0]), event('item/started', { id: 'image-2', type: 'imageGeneration', status: 'inProgress' }));
  const foreign = structuredClone(events[0]); foreign.params.threadId = 'other-thread'; foreign.params.item.id = 'foreign-image'; events.push(foreign);
  const result = summarizeImageEvidence({ job: job(), requests: [request()], events, logsComplete: true });
  assert.equal(result.counts.applicationSubmissions, 1); assert.equal(result.counts.modelTurnRequests, 1); assert.equal(result.counts.imageToolStarts, 2); assert.equal(result.counts.imageToolCompletions, 1); assert.equal(result.evidence.protection.status, 'failed');
});

test('隔离fixture标志不能提升真实生成证据；hook输入只证明调用前观察', () => {
  for (const fields of [{ executionMode: 'isolated-fixture' }, { provider: 'isolated-image-fixture' }, { result: { completionEvidenceMode: 'isolated-fixture' } }]) {
    const result = summarizeImageEvidence({ job: { ...job(), ...fields }, events: completed(), artifact: physicalArtifact(), hookInputRecord: { source: 'fixture-hook' } });
    assert.equal(result.isolatedFixtureOnly, true); assert.equal(result.evidence.artifact.status, 'fixture_produced'); assert.equal(result.evidence.acceptance.status, 'isolated_fixture'); assert.equal(result.attachments.toolArguments.nativeToolParametersObserved, false);
  }
});
