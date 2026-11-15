import { createHash } from 'node:crypto';

const own = (value, key) => value != null && Object.hasOwn(value, key);
const array = value => Array.isArray(value) ? value : null;
const hash = value => createHash('sha256').update(value).digest('hex');
const pathKey = value => {
  if (typeof value !== 'string') return null;
  const normalized = value.replaceAll('\\', '/').replace(/^\/\/\?\//, '');
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized;
};
const countObserved = (items, complete) => items.length || (complete ? 0 : null);
const unique = items => [...new Set(items.filter(Boolean))];
const envelopeKey = event => `${event.params?.threadId ?? ''}:${event.params?.turnId ?? ''}:${event.params?.item?.id ?? ''}`;
const localImages = items => (array(items) ?? []).filter(item => item?.type === 'localImage' && typeof item.path === 'string');
const evidenceFile = item => ({ pathHash: hash(item.path), sha256: typeof item.sha256 === 'string' ? item.sha256 : null });
const validInputImage = item => item != null && typeof item.path === 'string' && (/^[a-z]:[\\/]/i.test(item.path) || /^[\\/]/.test(item.path)) && typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256);

/** Describe the installed wire contract without turning optional fields into defaults. */
export function inspectImageInputSchema(schema) {
  const variants = schema?.definitions?.ThreadItem?.oneOf ?? [];
  const item = variants.find(candidate => candidate.properties?.type?.enum?.includes('imageGeneration'));
  if (!item?.properties?.inputImages) throw new Error('本机Schema没有可核查的imageGeneration.inputImages定义。');
  const input = item.properties.inputImages, element = schema.definitions.ImageGenerationInputImage;
  return {
    imageGenerationRequired: [...(item.required ?? [])],
    inputImages: { required: (item.required ?? []).includes('inputImages'), hasDefault: own(input, 'default'), ...(own(input, 'default') ? { default: structuredClone(input.default) } : {}), type: input.type, description: input.description ?? null },
    inputImage: { required: [...(element?.required ?? [])], description: element?.description ?? null, sha256Description: element?.properties?.sha256?.description ?? null },
    semantics: '若返回，描述本次图像请求成功读取的本地输入及归一化前Hash；不是视觉符合要求的证明。缺失保持未知，不填补为空数组。',
  };
}

/**
 * Pure evidence projection. Filesystem/hash/decoder checks belong to the trusted
 * caller. Logs are observations, never an executable capability or a new job.
 * An absent log/field stays unknown even when a plan or fixture claims success.
 */
export function summarizeImageEvidence({ job = {}, requests = null, events = null, transport = null, artifact = null, logsComplete = false, schemaContract = null, referenceFiles = [], hookInputRecord = null } = {}) {
  const fixture = job.executionMode === 'isolated-fixture' || job.provider === 'isolated-image-fixture' || job.result?.completionEvidenceMode === 'isolated-fixture';
  const scoped = (array(events) ?? []).filter(event => {
    const p = event.params;
    return !p || ((!job.threadId || !p.threadId || p.threadId === job.threadId) && (!job.turnId || !p.turnId || p.turnId === job.turnId));
  });
  const turns = (array(requests) ?? []).filter(request => request.method === 'turn/start' && (!job.threadId || request.params?.threadId === job.threadId));
  const turnIds = unique(turns.map(request => scoped.find(event => event.id === request.id && event.result?.turn)?.result.turn.id));
  const starts = scoped.filter(event => event.method === 'item/started' && event.params?.item?.type === 'imageGeneration');
  const completions = scoped.filter(event => event.method === 'item/completed' && event.params?.item?.type === 'imageGeneration');
  const completedImages = completions.filter(event => event.params.item.status === 'completed');
  const originalImages = unique(starts.map(envelopeKey)), finalImages = unique(completions.map(envelopeKey));
  const turnCompleted = scoped.some(event => event.method === 'turn/completed' && event.params?.turn?.status === 'completed' && (!job.turnId || event.params.turn.id === job.turnId));
  const lastImage = completedImages.at(-1)?.params.item ?? null;
  const hookFailures = scoped.filter(event => event.method === 'hook/completed' && event.params?.run?.status === 'failed');
  const planned = array(job.plannedReferences);
  const requestImages = turns.flatMap(request => localImages(request.params?.input));
  const echoed = scoped.filter(event => ['item/started', 'item/completed'].includes(event.method) && event.params?.item?.type === 'userMessage').flatMap(event => localImages(event.params.item.content));
  const echoedPaths = unique(echoed.map(item => pathKey(item.path)));
  const expectedPaths = unique(requestImages.map(item => pathKey(item.path)));
  const matchedEchoes = expectedPaths.filter(file => echoedPaths.includes(file));
  const writtenRequestIds = new Set((array(transport) ?? []).filter(record => record.method === 'turn/start' && record.status === 'written_to_pipe').map(record => record.rpcId));
  const pipeWrittenPaths = unique(turns.filter(request => writtenRequestIds.has(request.id)).flatMap(request => localImages(request.params?.input)).map(item => pathKey(item.path)));
  const receiptPresent = own(lastImage, 'inputImages');
  const receiptArray = receiptPresent ? array(lastImage.inputImages) : null;
  const receipt = receiptArray?.every(validInputImage) ? receiptArray : null;
  const localReferenceHashes = (array(referenceFiles) ?? []).filter(item => item.fileHashVerified === true && item.actualSha256 === item.sha256);
  const receiptMatchesLocalFiles = receipt !== null && receipt.every(item => localReferenceHashes.some(file => pathKey(file.path) === pathKey(item.path) && file.sha256 === item.sha256));
  const expectedHashes = (planned ?? []).map(item => item.sha256).sort();
  const receiptMatchesExpected = receipt !== null && JSON.stringify(receipt.map(item => item.sha256).sort()) === JSON.stringify(expectedHashes);
  const decoded = artifact?.decoded === true || artifact?.decoded?.decoded === true;
  const artifactVerified = artifact?.fileHashVerified === true && decoded && typeof artifact.sha256 === 'string';
  const hasRecordedArtifact = Boolean(artifact || job.artifact || job.retainedArtifacts?.length || job.result?.assetId);
  const productionComplete = completedImages.length > 0 && turnCompleted;
  const protectionFailure = hookFailures.length > 0 || originalImages.length > 1;
  const sourceBound = Boolean(job.id && job.inputSnapshotHash);
  const observedHookInput = hookInputRecord?.kind === 'pre_tool_observation' && hookInputRecord.hook_event_name === 'PreToolUse' && hookInputRecord.tool_name === 'image_genimagegen' && typeof hookInputRecord.tool_use_id === 'string' && hookInputRecord.tool_input != null && hookInputRecord.inputSha256 === hash(JSON.stringify(hookInputRecord.tool_input)) && /^[a-f0-9]{64}$/.test(hookInputRecord.manifestHash ?? '') && hookInputRecord.manifestHash === hookInputRecord.expectedManifestHash;
  const counts = {
    applicationSubmissions: job.submittedAt ? 1 : job.status === 'prepared' ? 0 : null,
    modelTurnRequests: array(requests) ? countObserved(turns, logsComplete) : null,
    modelTurnsAcknowledged: array(events) ? countObserved(turnIds, logsComplete) : null,
    imageToolStarts: array(events) ? countObserved(originalImages, logsComplete) : null,
    imageToolCompletions: array(events) ? countObserved(finalImages, logsComplete) : null,
    observationComplete: logsComplete === true,
    note: '应用提交意图、turn请求和图像item分别计数；日志不完整时未观测数量为未知，不推定为零或严格额度保证。',
  };
  const attachments = {
    planned: { status: planned ? 'planned_only' : 'unverified', count: planned?.length ?? null, reason: '原任务计划与本地副本清单；不等于已发送或使用。', files: (planned ?? []).map(item => ({ assetId: item.id ?? item.assetId ?? null, sha256: item.sha256 ?? null })) },
    sessionSent: { status: matchedEchoes.length || pipeWrittenPaths.length ? 'observed' : 'unverified', count: matchedEchoes.length || pipeWrittenPaths.length || null, reason: matchedEchoes.length ? 'turn/start日志与同会话userMessage回显共同证明这些会话附件传递；不证明图像工具使用。' : pipeWrittenPaths.length ? '写入回调证明已把localImage参数写入CLI stdin管道；尚不证明服务端会话收到或图像工具使用。' : requestImages.length ? '仅有turn/start请求日志；该日志写在stdin发送之前，单独不能证明发送或接收成功。' : '没有可核对的实际localImage传输证据，不能以计划清单代替。', requestLoggedCount: array(requests) ? requestImages.length : null, pipeWrittenCount: array(transport) ? pipeWrittenPaths.length : null, sendConfirmedCount: matchedEchoes.length || null, files: requestImages.map(evidenceFile) },
    sessionReceived: { status: echoedPaths.length ? 'observed' : 'not_returned', count: echoedPaths.length || null, reason: echoedPaths.length ? '官方userMessage事件回显localImage路径；只证明会话接收，不是图像工具参数或文件Hash回执。' : '没有官方会话附件回显；turn/start成功本身不能证明特定附件已被工具使用。', matchingRequestCount: matchedEchoes.length || null },
    toolArguments: { status: 'unverified', count: null, reason: observedHookInput ? 'Hash与manifest绑定的hook输入记录可观察调用前参数；它不证明原生工具最终执行了改写后的输入。' : '现有原生事件没有实际工具参数，失败hook也没有可信参数记录；计划、会话附件及revisedPrompt不能补造工具参数。', preToolRecordObserved: observedHookInput, nativeToolParametersObserved: false },
    toolReadReceipt: { status: receipt !== null ? 'observed' : receiptPresent ? 'unverified' : 'not_returned', count: receipt?.length ?? null, reason: receipt !== null ? 'inputImages描述图像工具请求成功读取的本地文件及归一化前Hash；不是远端服务使用回执或视觉符合要求的证明。' : receiptPresent ? 'inputImages字段存在但不符合数组元素、绝对路径或小写SHA256要求，保留原值，不能作为有效本地读取回执。' : 'inputImages是允许缺省且没有default的字段；本次未返回，保留null，不能解释成零参考或已使用。', fieldPresent: receiptPresent, value: receiptPresent ? structuredClone(lastImage.inputImages) : null, localFileHashMatches: receipt === null ? null : receiptMatchesLocalFiles, plannedHashMatches: receipt === null ? null : receiptMatchesExpected },
    serverReceipt: { status: 'not_returned', count: null, reason: '当前已核实的官方事件没有独立远端参考使用回执；本地inputImages读取证明不能替代后端使用证明。', fieldPresent: false, value: null, backendReferenceUsageVerified: false },
    visualCheck: { status: 'unverified', count: null, reason: '参考画面是否符合要求仍需独立视觉检查；协议、文件Hash和解码均不能替代。' },
  };
  return {
    schemaVersion: 1, taskId: job.id ?? null, isolatedFixtureOnly: fixture,
    original: { status: job.status ?? null, error: job.error ?? null, submittedAt: job.submittedAt ?? null, requestId: job.requestId ?? null, packetId: job.packetId ?? null, inputSnapshotHash: job.inputSnapshotHash ?? null },
    counts, attachments,
    evidence: {
      artifact: { status: artifactVerified && productionComplete ? fixture ? 'fixture_produced' : 'produced' : hasRecordedArtifact ? 'unverified' : 'not_observed', reason: artifactVerified && productionComplete ? '实际文件Hash和像素解码已核对，官方图像与turn终态完成；这只证明产物，不代表完整候选验收。' : hasRecordedArtifact ? '已保留产物元数据或文件声明；当前投影未完成新的实际文件、Hash、解码及官方终态核对。' : '当前没有可验证的图片产物证据。', officialImageCompleted: completedImages.length > 0, officialTurnCompleted: turnCompleted, fileHashVerified: artifact?.fileHashVerified === true, decoded, sha256: artifact?.sha256 ?? job.artifact?.sha256 ?? job.retainedArtifacts?.[0]?.sha256 ?? null, width: artifact?.width ?? null, height: artifact?.height ?? null, sourceBound },
      protection: { status: protectionFailure ? 'failed' : 'unverified', reason: protectionFailure ? '已观测hook失败或多次图像调用。应用可发起异步中断，但不能保证阻止已开始的调用；严格单次执行保护未验证。' : '未发现故障不等于严格单次保护成立。hook为辅助防护，异步中断不能保证阻止已开始调用，自动入口保持关闭。', strictSingleCallGuaranteed: false, hookFailures: hookFailures.length || (logsComplete ? 0 : null) },
      references: { status: 'unverified', reason: receipt !== null ? '已观察的inputImages只证明本地图像请求读取；仍须区分工具参数、后端使用以及视觉检查。' : '会话附件与图像工具使用分开；实际工具参数和有效参考读取回执缺失，参考使用未验证。', localReadReceiptMatches: receipt === null ? null : receiptMatchesLocalFiles && receiptMatchesExpected, backendUsageVerified: false },
      acceptance: { status: fixture ? 'isolated_fixture' : 'incomplete', reason: fixture ? '这是隔离夹具证据，不是正式账号生成成功或完整验收。' : '产物、执行保护、参考使用和视觉检查独立判断；本记录不追改原失败任务，也不作为已通过完整验收的候选。', automaticallySelected: false },
    },
    schemaContract,
  };
}
