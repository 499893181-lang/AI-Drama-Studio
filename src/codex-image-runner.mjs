import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { resolveExecutable, runProbe, redact } from './tools.mjs';
import { createImageGuard, verifyImageGuard } from './codex-image-guard.mjs';
import { openImageRpc } from './codex-image-rpc.mjs';
import { inspectImage } from './image-files.mjs';
import { createImageWatchdog } from './codex-image-watchdog.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const canonicalFile = file => { const resolved=fs.realpathSync.native(file).replace(/^\\\\\?\\/, '');return process.platform==='win32'?resolved.toLowerCase():resolved; };
// This release's Function adapter, canonical hook name and single-image request
// have been inspected. A different binary requires a fresh contract audit.
const auditedVersion = '0.167.0-alpha.4.1';
const realAcceptanceGap='本轮真实验收未通过：原生PreToolUse命令失败后工具仍继续，且图像事件未证明实际参考附件。Windows启动器仅完成非生成修复验证；未重新真实验收，自动提交保持关闭。';
const realSubmissionEnabled=false;
const initialize = { clientInfo: { name: 'ai_drama_single_image', title: 'AI Drama single-image connector', version: '0.6.0' }, capabilities: { experimentalApi: true, explicitGatewayOauth: true } };
const accountSummary = value => ({ loggedIn: value?.account?.type === 'chatgpt', type: value?.account?.type ?? null, planType: value?.account?.planType ?? null });
const usageSummary = value => { const { accountId, ...summary } = value ?? {}; return summary; };
export function verifyPrivateHook(reply, guard, trusted = false) {
  const entries = reply?.data ?? [], hooks = entries.flatMap(entry => entry.hooks ?? []);
  if (entries.some(entry => entry.errors?.length || entry.warnings?.length) || hooks.length !== 1) throw new Error('私有会话须恰好包含一个已审核hook，不能忽略其他hook或配置错误。');
  const hook = hooks[0];
  if (hook.eventName !== 'preToolUse' || hook.handlerType !== 'command' || hook.command !== guard.command || hook.matcher !== '.*' || hook.async !== false || hook.enabled !== true || !hook.key || !/^sha256:[a-f0-9]{64}$/.test(hook.currentHash) || trusted && hook.trustStatus !== 'trusted') throw new Error('私有单图hook命令、启用状态或精确Hash信任未核实。');
  if (!verifyImageGuard(guard)) throw new Error('私有单图校验文件发生变化。');
  return hook;
}
export function verifyImageSchema(schema) {
  const defs = schema.definitions, image = (defs?.ThreadItem?.oneOf ?? []).find(item => item.properties?.type?.enum?.includes('imageGeneration'));
  const fields = image?.properties ?? {}, inputs = JSON.stringify(defs?.UserInput ?? {});
  if (!image || !['id','status','inputImages','savedPath'].every(key => key in fields) || !JSON.stringify(image.anyOf).includes('result') || !JSON.stringify(image.anyOf).includes('fileId') || !inputs.includes('localImage') || !defs?.TurnCompletedNotification || !defs?.HooksListResponse || !defs?.ModelProviderCapabilitiesReadResponse) throw new Error('当前安装版Schema缺少已核实的真实图像产物、附件或终态契约。');
  return true;
}
export function verifyImageSession(response) {
  if (response.modelProvider !== 'openai' || response.sandbox?.type !== 'readOnly' || response.approvalPolicy !== 'never') throw new Error('真实会话未确认使用官方OpenAI提供方、只读沙箱和禁止额外授权，停止提交。');
}
/** Retain actual failed output without upgrading it to a validated candidate. */
export function failedImageReceipt({error,events=[],imageGeneration=null,threadId=null,turnId=null,turnCompleted=false,usage=null,accountUsage=null,processExitCode=null,cwd=null,executionDiagnostics=null}) {
  const envelope=[...events].reverse().find(event=>event.method==='item/completed'&&event.params?.item?.type==='imageGeneration')?.params;
  const generation=imageGeneration??envelope?.item??null,images=[];
  let artifactError=null;
  try{
    if(generation?.savedPath&&path.isAbsolute(generation.savedPath)&&fs.statSync(generation.savedPath).isFile())images.push({path:generation.savedPath,sha256:sha(fs.readFileSync(generation.savedPath)),verified:false});
    else if(cwd&&typeof generation?.result==='string'){
      const encoded=generation.result.replace(/^data:image\/(png|jpeg|webp);base64,/,'');
      if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)||encoded.length%4!==0)throw new Error('原始base64产物无法解码。');
      const bytes=Buffer.from(encoded,'base64'),info=inspectImage(bytes),file=path.join(cwd,`unverified-native-result.${info.extension}`);
      if(fs.existsSync(file)){if(sha(fs.readFileSync(file))!==sha(bytes))throw new Error('同名保留产物已存在且Hash不同，禁止覆盖。');}else fs.writeFileSync(file,bytes,{flag:'wx'});
      images.push({path:file,sha256:sha(bytes),verified:false});
    }
  }catch(cause){artifactError=redact(cause.message);}
  return {exitCode:null,processExitCode,completed:false,turnCompleted,error:redact(error?.message??error??'真实图像完成条件未通过。'),threadId:threadId??envelope?.threadId??null,turnId:turnId??envelope?.turnId??null,imageGeneration:generation,images,usage,accountUsage,artifactError,executionDiagnostics,runnerMode:'official-codex-account',verificationStatus:'unverified_actual_output',automaticallySelected:false};
}
async function prepareSession({ binary, directory, cwd, prompt, references = [], policy, onEvent, signal, rawDirectory }) {
  const guard = createImageGuard({ directory, prompt, references, policy });
  const rpc = openImageRpc(binary, { cwd, signal, rawDirectory, onEvent });
  try {
    await rpc.request('initialize', initialize); rpc.notify('initialized');
    const provider = await rpc.request('modelProvider/capabilities/read');
    const account = accountSummary(await rpc.request('account/read', { refreshToken: false }));
    const accountUsage = usageSummary(await rpc.request('account/rateLimits/read', { supportsLunaReserve: false, excludeResetCreditDetails: true }));
    if (provider.imageGeneration !== true || !account.loggedIn || accountUsage.ordinaryUsageAllowed === false) throw new Error('当前官方账号图像功能、ChatGPT登录或普通额度不可用；不切换API或购买额度。');
    const config = { ...guard.config, features: { hooks: true, image_generation: true } };
    const params = { cwd, ephemeral: true, sandbox: 'read-only', approvalPolicy: 'never', config };
    const first = await rpc.request('thread/start', params);
    verifyImageSession(first);
    const hook = verifyPrivateHook(await rpc.request('hooks/list', { threadId: first.thread.id }), guard);
    const trustedConfig = { ...config, hooks: { ...config.hooks, state: { [hook.key]: { enabled: true, trusted_hash: hook.currentHash } } } };
    const thread = await rpc.request('thread/start', { ...params, config: trustedConfig });
    verifyImageSession(thread);
    const trustedHook = verifyPrivateHook(await rpc.request('hooks/list', { threadId: thread.thread.id }), guard, true);
    if (trustedHook.key !== hook.key || trustedHook.currentHash !== hook.currentHash) throw new Error('私有hook在信任配置后改变，停止提交。');
    return { rpc, guard, threadId: thread.thread.id, model:thread.model,modelProvider:thread.modelProvider, provider, account, accountUsage, hook: trustedHook };
  } catch (error) { rpc.close(); throw error; }
}
async function checkBinary(binary, directory) {
  const version = await runProbe(binary, ['--version']);
  if (version.exitCode !== 0 || version.output.match(/codex-cli\s+(\S+)/)?.[1] !== auditedVersion) throw new Error(`当前Codex版本未完成单图工具及hook实现审查；已审核版本${auditedVersion}，当前${version.output || '未知'}。`);
  const schemaDir = path.join(directory, 'schema');
  const result = await runProbe(binary, ['app-server','generate-json-schema','--experimental','--out',schemaDir], { timeout: 30000, maxBuffer: 1024 * 1024 });
  if (result.exitCode !== 0) throw new Error(`无法读取本机官方Schema：${result.output}`);
  const file = path.join(schemaDir, 'codex_app_server_protocol.v2.schemas.json'), bytes = fs.readFileSync(file);
  verifyImageSchema(JSON.parse(bytes)); return { version: auditedVersion, schemaSha256: sha(bytes) };
}
/** Read-only account/schema/empty-thread probe. Never starts a model turn. */
export async function inspectCodexImageCapability() {
  const base = { checkedAt: new Date().toISOString(), canSubmit: false, contractVerified: false,schemaContractDetected:false, actualGenerationVerified: false, noModelTurnSubmitted: true, auth: { loggedIn: false }, accountUsage: null, cost: { cny: null, credits: null, status: 'unknown' }, limitations: [] };
  const binary = resolveExecutable('codex'); if (!binary) return { ...base, message: '未找到本机官方Codex可执行文件。' };
  // Private probe records are retained, never put under a model-writable sandbox.
  const directory = path.join(os.tmpdir(), 'ai-drama-image-contract', randomUUID()), cwd = path.join(directory, 'model-read-only'); fs.mkdirSync(cwd, { recursive: true });
  let session;
  try {
    const contract = await checkBinary(binary, directory);
    session = await prepareSession({ binary, directory: path.join(directory, 'host-control'), cwd, prompt: '只核对配置，不发起生成。' });
    return { ...base, ...contract, canSubmit: false, contractVerified: false, schemaContractDetected:true, auth: session.account, accountUsage: session.accountUsage, imageGenerationFlagDetected: session.provider.imageGeneration === true, privateHook: { count: 1, enabled: true, trustStatus: session.hook.trustStatus, currentHash: session.hook.currentHash, configuredCallLimit: 1, runtimeEnforcementVerified:false }, acceptanceStatus:'blocked_after_real_attempt',limitations: [realAcceptanceGap,'本轮唯一真实调用预算已使用，不自动再试。','人民币及积分费用未返回，保持未知。'], message:realAcceptanceGap };
  } catch (error) { return { ...base, message: redact(error.message), limitations: [redact(error.message)] }; }
  finally { session?.rpc.close(); }
}
/** Native path remains disabled: asynchronous observation is not a strict cap. */
export async function runCodexImage({ prompt, references = [], cwd, signal, onEvent, policy, timeoutMs = 600000 }) {
  // The one authorized real acceptance attempt exposed an enforcement gap.
  // Reopening the connector requires a separately authorized acceptance change;
  // flags, fixture success or a fresh data directory cannot silently reopen it.
  if(!realSubmissionEnabled)throw new Error(realAcceptanceGap);
  if (!policy?.dataRoot || !policy.projectId || !policy.packetId || !policy.expectedBindingHash || !policy.expectedInputSnapshotHash) throw new Error('真实图像执行须绑定可信存储、原任务包和输入Hash。');
  if (!path.isAbsolute(cwd) || typeof prompt !== 'string' || !prompt.trim() || references.length > 5) throw new Error('图像输入或参考数量不符合当前官方契约。');
  for (const ref of references) if (!path.isAbsolute(ref.path) || sha(fs.readFileSync(ref.path)) !== ref.sha256) throw new Error('实际参考附件缺失或Hash不匹配。');
  const binary = resolveExecutable('codex'); if (!binary) throw new Error('未找到本机官方Codex。');
  const hostDirectory = path.join(path.dirname(cwd), `${path.basename(cwd)}-host-control`);
  // An existing host ledger is never reset, including cancellation/restart.
  fs.mkdirSync(hostDirectory, { recursive: true });
  fs.writeFileSync(path.join(hostDirectory, 'connector.intent.json'), JSON.stringify({ at: new Date().toISOString(), policy, references, promptHash: sha(prompt) }), { flag: 'wx' });
  const contract = await checkBinary(binary, hostDirectory);
  let session, watchdog, timer, completed = false, turnId = null, completedThreadId = null, usage = null;
  const generations = [];
  const abort=()=>watchdog?.fail('local_cancelled','本地等待已取消；异步中断不保证服务端已停，原提交保留，不自动重试。');signal?.addEventListener('abort',abort,{once:true});
  try {
    session = await prepareSession({ binary, directory: path.join(hostDirectory, 'guard'), cwd, prompt, references, policy, signal, rawDirectory: path.join(cwd, 'official-rpc'), onEvent: event => {
      watchdog?.event(event);
    } });
    verifyPrivateHook(await session.rpc.request('hooks/list',{threadId:session.threadId}),session.guard,true);
    if (signal?.aborted) throw new Error('提交前已取消。');
    watchdog=createImageWatchdog({rpc:session.rpc,threadId:session.threadId,guard:session.guard,onDiagnostic:entry=>onEvent?.({type:`execution.${entry.type}`,threadId:session.threadId,turnId,message:entry.reason??entry.error??entry.type,diagnostic:entry}),onBoundEvent:event=>{
      const p=event.params;
      if(event.method==='item/completed'&&p.item?.type==='imageGeneration'){if(!generations.some(previous=>previous.item.id===p.item.id))generations.push(p);onEvent?.({type:'image.item.completed',threadId:p.threadId,turnId:p.turnId,message:`真实图像工具状态：${p.item.status}`});}
      if(event.method==='thread/tokenUsage/updated'){usage=p.tokenUsage;onEvent?.({type:'usage.updated',threadId:p.threadId,turnId:p.turnId,usage});}
      if(event.method==='turn/completed'){turnId=p.turn.id;completedThreadId=p.threadId;completed=p.turn.status==='completed';}
    }});
    // The script's wx ledger only arbitrates successfully executing scripts.
    // A failed hook can fail open in native execution; observation and async
    // interrupt below cannot guarantee a strict number of provider calls.
    const input = [{type:'text',text:`请直接调用一次原生 image_gen.imagegen，生成一张图片。不得调用其他工具、再次生成、细化、执行命令或API。实际提示词和附件由受信hook锁定。完成后结束。\n\n${prompt}`}, ...references.map(ref=>({type:'localImage',path:ref.path}))];
    timer=setTimeout(()=>watchdog.fail('turn_timeout','等待图像终态超时；请求异步中断，原提交保留，不会自动重试。'),timeoutMs);
    const started=await watchdog.startTurn({input});const submittedTurnId=started.turn?.id??null;if(!turnId)turnId=submittedTurnId;
    onEvent?.({type:'turn.started',threadId:session.threadId,turnId,message:'官方单次图像turn已提交。'});
    await watchdog.waitForTurn(); clearTimeout(timer);watchdog.throwIfFailed();
    if (generations.length !== 1 || generations[0].item.status !== 'completed') throw new Error('未收到恰好一个真实完成的imageGeneration事件。');
    if(!submittedTurnId||turnId!==submittedTurnId||completedThreadId!==session.threadId||generations[0].threadId!==session.threadId||generations[0].turnId!==submittedTurnId)throw new Error('图像和终态事件不属于本次提交的会话与turn。');
    const imageGeneration=generations[0].item;
    // inputImages is optional in this Schema. Its presence describes observed
    // local inputs successfully read for the request, not server-side usage or
    // semantic adherence. Absence is unknown, never an invented empty receipt.
    if(references.length&&!Object.hasOwn(imageGeneration,'inputImages'))throw new Error('完成事件未返回本地图像工具入参证据（Schema允许缺省）；参考使用仍未验证，不能通过完整验收。');
    const expected=references.map(ref=>`${canonicalFile(ref.path)}:${ref.sha256}`).sort(),actual=Array.isArray(imageGeneration.inputImages)?imageGeneration.inputImages.map(ref=>`${canonicalFile(ref.path)}:${ref.sha256}`).sort():null;
    if(actual&&JSON.stringify(expected)!==JSON.stringify(actual))throw new Error('本地图像工具入参的参考文件及Hash与原请求不一致。');
    let imagePath=imageGeneration.savedPath;
    if (imagePath && (!path.isAbsolute(imagePath)||!fs.statSync(imagePath).isFile())) throw new Error('官方savedPath不是实际存在的绝对图片文件。');
    if (!imagePath && typeof imageGeneration.result === 'string') {
      const encoded=imageGeneration.result.replace(/^data:image\/(png|jpeg|webp);base64,/, '');
      if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)||encoded.length%4!==0)throw new Error('官方图像结果不是有效base64。');
      const bytes=Buffer.from(encoded,'base64'),info=inspectImage(bytes);imagePath=path.join(cwd,`native-result.${info.extension}`);fs.writeFileSync(imagePath,bytes,{flag:'wx'});
    }
    if (!imagePath) throw new Error('仅有fileId而没有已核实的取回契约，不能声称真实图片成功。');
    const bytes=fs.readFileSync(imagePath);inspectImage(bytes);
    let accountUsageAfter;try{accountUsageAfter=usageSummary(await session.rpc.request('account/rateLimits/read',{supportsLunaReserve:false,excludeResetCreditDetails:true}));}catch(error){accountUsageAfter={status:'unknown',error:redact(error.message)};}
    const exitCode=await session.rpc.shutdown();
    if(exitCode!==0)throw new Error(`图像turn完成但官方进程未干净结束（${exitCode}）；原始产物保留待核对。`);
    return {exitCode,completed:true,threadId:session.threadId,turnId,imageGeneration,images:[{path:imagePath,sha256:sha(bytes)}],usage,accountUsage:{before:session.accountUsage,after:accountUsageAfter},error:null,contract,executionDiagnostics:watchdog.snapshot(),referenceEvidence:{toolLocalInputs:actual?'observed':'not_returned',serverUsageReceipt:null,visualCheckRequired:true},guard:{markerPath:session.guard.markerPath,logPath:session.guard.logPath,trustedHash:session.hook.currentHash},runnerMode:'official-codex-account'};
  } catch(error) {
    watchdog?.fail(error.code??'connector_failed',error);
    // Keep consuming the original stream during the interrupt acknowledgement
    // and bounded shutdown so already-started/late image events are retained.
    // Neither acknowledgement nor process exit proves provider cancellation.
    let processExitCode=null;try{await watchdog?.settleInterrupt();if(session)processExitCode=await session.rpc.shutdown();}catch{session?.rpc.close();}
    return failedImageReceipt({error,imageGeneration:generations.at(-1)?.item??null,threadId:session?.threadId??null,turnId:turnId??watchdog?.boundTurnId()??null,turnCompleted:completed,usage,accountUsage:session?{before:session.accountUsage,after:{status:'unknown'}}:null,processExitCode,cwd,executionDiagnostics:watchdog?.snapshot()??null});
  }
  finally { clearTimeout(timer);watchdog?.dispose();signal?.removeEventListener('abort',abort); }
}
