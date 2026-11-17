import fs from 'node:fs';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { AppError,now,validId } from './store.mjs';
import { resolveExecutable,runProbe } from './tools.mjs';
import { runCreativeCodex } from './creative-runner.mjs';
import { CATEGORIES,MODEL_CATALOG,SERVICE_PROVIDERS,CAPABILITY_REVISION } from './service-catalog.mjs';
import { CredentialVault } from './service-vault.mjs';
import { buildProviderRequest,parseTextResponse,parseMediaResponse,providerQueryRequest } from './provider-adapters.mjs';
import { ServiceMediaTasks } from './service-media-tasks.mjs';
import { SiwcManager } from './service-siwc.mjs';
const hash = value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value=>structuredClone(value);
const initial = ()=>({id:'registry',schemaVersion:1,revision:0,connections:[],defaults:{text:null,image:null,video:null,voice:null},updatedAt:now()});
const unknownCost = ()=>({status:'unknown',amount:null,unit:null,source:null,conditions:null,validUntil:null});
const notVerified = ()=>({installation:'not_verified',authentication:'not_verified',permission:'not_verified',serviceConnection:'not_verified',adapter:'contract_implemented',realGeneration:'not_verified'});
function cleanObject(value){if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError('配置应为对象。');if(JSON.stringify(value).length>50000)throw new AppError('配置过长。');return clone(value);}
function containsSecretField(value){return value&&typeof value==='object'&&Object.entries(value).some(([key,child])=>/key|token|secret|cookie|password|authorization/i.test(key)||containsSecretField(child));}
export class ServiceRegistry {
  constructor(store,{vault,fetchImpl=fetch,localRunner=runCreativeCodex,allowGeneration=false,mediaOptions={}}={}){
    this.store=store;this.root=store.root;this.fetch=fetchImpl;this.localRunner=localRunner;this.allowGeneration=allowGeneration;
    for(const kind of ['service-settings','project-services','service-tasks'])fs.mkdirSync(path.join(this.root,kind),{recursive:true});
    this.vault=vault??new CredentialVault(path.join(this.root,'credential-vault'));
    this.runText=this.runText.bind(this);this.runText.snapshot=projectId=>this.resolve('text',projectId);
    this.media=new ServiceMediaTasks(this,mediaOptions);
    this.siwc=new SiwcManager(this);
  }
  config(){try{return this.store.read('service-settings','registry');}catch(error){if(error.status===404)return initial();throw error;}}
  save(config){config.revision++;config.updatedAt=now();this.store.write('service-settings',config);return config;}
  check(config,revision){if(config.revision!==revision)throw new AppError('服务配置已改变，请刷新核对。',409);}
  projectSelection(id){this.store.read('projects',id);try{return this.store.read('project-services',id);}catch(error){if(error.status===404)return {id,revision:0,selections:{text:null,image:null,video:null,voice:null},updatedAt:now()};throw error;}}
  publicConnection(connection){const result=clone(connection);result.hasCredential=!!connection.credentialRef&&this.vault.has(connection.credentialRef);delete result.credentialRef;return result;}
  view(projectId){const config=this.config(),selection=projectId?this.projectSelection(projectId):null,resolved={};for(const category of CATEGORIES){try{resolved[category]=this.resolve(category,projectId);}catch(error){resolved[category]={blockedReason:error.message};}}return {schemaVersion:1,revision:config.revision,categories:CATEGORIES,providers:clone(SERVICE_PROVIDERS),catalog:clone(MODEL_CATALOG),connections:config.connections.map(c=>this.publicConnection(c)),defaults:config.defaults,projectSelection:selection,resolved,execution:{enabled:this.allowGeneration,reason:this.allowGeneration?null:'本轮真实模型生成关闭；可保存配置、核查连接和进行隔离验收。'},legacyJimeng:{newTasks:false,recoveryOnly:true},fallback:{enabled:false,reason:'未配置自动备用；未知结果禁止跨渠道补发。'}};}
  saveConnection(body){
    const config=this.config();this.check(config,body.revision);const provider=SERVICE_PROVIDERS.find(p=>p.id===body.provider);if(!provider||!provider.categories.includes(body.category))throw new AppError('渠道不支持所选服务类别。');
    if(typeof body.name!=='string'||!body.name.trim()||body.name.length>120||typeof body.model!=='string'||!body.model.trim()||body.model.length>160)throw new AppError('请填写服务名称及实际模型 ID。');
    const id=body.id??randomUUID();if(!validId(id))throw new AppError('无效服务连接 ID。');const prior=config.connections.find(c=>c.id===id);
    if(body.id&&!prior)throw new AppError('服务连接不存在。',404);
    const parameters=cleanObject(body.parameters??{});if(containsSecretField(parameters))throw new AppError('密钥须通过独立凭据入口保存，不能写进模型参数。');
    const connection={id,name:body.name.trim(),provider:body.provider,category:body.category,model:body.model.trim(),parameters,costBasis:body.costBasis?this.validateCost(body.costBasis):unknownCost(),revision:(prior?.revision??0)+1,credentialRef:prior?.provider===body.provider?prior.credentialRef??null:null,statuses:notVerified(),accountModels:[],createdAt:prior?.createdAt??now(),updatedAt:now()};
    if(provider.blocker)connection.blockedReason=provider.blocker;
    if(body.provider==='chatgpt-siwc'){connection.oauth=prior?.oauth??null;if(!connection.oauth)connection.blockedReason='待配置：需要本人完成此应用独立 OAuth 注册与 ChatGPT 文字用量批准；不复用 Codex 凭据。';}
    config.connections=prior?config.connections.map(c=>c.id===id?connection:c):[...config.connections,connection];this.save(config);return this.publicConnection(connection);
  }
  validateCost(cost){const value=cleanObject(cost);if(!['unknown','documented','account_quote','user_budget'].includes(value.status))throw new AppError('请选择费用依据状态。');if(value.status==='unknown')return unknownCost();if(!['CNY','USD','credits','subscription_usage','local_compute','gift_quota'].includes(value.unit)||typeof value.source!=='string'||!value.source.trim())throw new AppError('已知费用须记录单位和来源。');if(value.amount!==null&&(!Number.isFinite(value.amount)||value.amount<0))throw new AppError('费用数值无效。');if(value.status==='user_budget')value.isQuote=false;return value;}
  choice(config,category,value){if(value===null)return null;if(!value||typeof value!=='object')throw new AppError('服务选择格式无效。');const c=config.connections.find(c=>c.id===value.connectionId);if(!c||c.category!==category)throw new AppError('所选连接不属于当前服务类别。');const model=value.model??c.model;if(typeof model!=='string'||!model.trim()||model.length>160)throw new AppError('请填写实际模型 ID。');return {connectionId:c.id,model};}
  setDefaults(body){const config=this.config();this.check(config,body.revision);for(const [category,value]of Object.entries(body.defaults??{})){if(!CATEGORIES.includes(category))throw new AppError('未知服务类别。');config.defaults[category]=this.choice(config,category,value);}this.save(config);return this.view();}
  setProjectSelection(id,body){const project=this.projectSelection(id),config=this.config();if(project.revision!==body.revision)throw new AppError('项目服务选择已改变，请刷新。',409);for(const [category,value]of Object.entries(body.selections??{})){if(!CATEGORIES.includes(category))throw new AppError('未知服务类别。');project.selections[category]=this.choice(config,category,value);}project.revision++;project.updatedAt=now();this.store.write('project-services',project);return this.view(id);}
  resolve(category,projectId){if(!CATEGORIES.includes(category))throw new AppError('未知服务类别。');const config=this.config(),project=projectId?this.projectSelection(projectId):null,choice=project?.selections[category]??config.defaults[category];if(!choice)throw new AppError(`待配置：请在 AI 服务配置中选择${category}服务；不会自动采用即梦或其他收费渠道。`,409);const connection=config.connections.find(c=>c.id===choice.connectionId);if(!connection)throw new AppError('服务连接已不存在，请重新选择。',409);const snapshot={connectionId:connection.id,connectionRevision:connection.revision,provider:connection.provider,category,model:choice.model,parameters:clone(connection.parameters),credentialRef:connection.credentialRef,costBasis:clone(connection.costBasis),usageKind:connection.provider==='codex-cli'||connection.provider==='chatgpt-siwc'?'subscription_usage':connection.provider==='indextts'||connection.provider==='qwen3-tts'?'local_compute':'api_unknown',capabilityRevision:CAPABILITY_REVISION,selectionMode:project?.selections[category]?'override':'inherit'};return {...snapshot,hash:hash(snapshot)};}
  assertSnapshotCurrent(snapshot,projectId){if(!snapshot||snapshot.hash!==hash(Object.fromEntries(Object.entries(snapshot).filter(([key])=>key!=='hash')))||this.resolve(snapshot.category,projectId).hash!==snapshot.hash)throw new AppError('本次服务、模型、参数或费用依据已改变，请重新准备；不会使用旧授权提交。',409);}
  async putCredential(id,secret){const config=this.config(),connection=config.connections.find(c=>c.id===id);if(!connection)throw new AppError('服务连接不存在。',404);if(!['api-key'].includes(SERVICE_PROVIDERS.find(p=>p.id===connection.provider).auth))throw new AppError('此服务不能粘贴凭据；请使用其官方授权流程。',409);const ref=await this.vault.put(secret);this.check(this.config(),config.revision);connection.credentialRef=ref;connection.revision++;connection.statuses={...notVerified(),authentication:'credential_saved_not_verified'};connection.updatedAt=now();this.save(config);return this.publicConnection(connection);}
  async secretFor(snapshot){if(snapshot.provider==='chatgpt-siwc')return this.siwc.accessToken(snapshot.connectionId);if(!snapshot.credentialRef)throw new AppError('待配置：请在服务配置保存此渠道的凭据。',409);return this.vault.get(snapshot.credentialRef);}
  async inspectConnection(id){
    const config=this.config(),connection=config.connections.find(c=>c.id===id);if(!connection)throw new AppError('服务连接不存在。',404);const statuses=notVerified();let detail='没有提交生成任务。';
    if(connection.provider==='chatgpt-siwc')return this.siwc.inspect(id);
    if(connection.provider==='codex-cli'){const binary=resolveExecutable('codex');statuses.installation=binary?'detected':'missing';if(binary){const result=await runProbe(binary,['login','status'],{timeout:15000});statuses.authentication=result.exitCode===0&&/logged in|已登录/i.test(result.output)&&!/not logged in/i.test(result.output)?'authenticated':'needs_configuration';detail='只运行官方 codex login status；模型连接和真实生成尚未验证。';}}
    else if(['deepseek','openai','elevenlabs'].includes(connection.provider)&&connection.credentialRef){const key=await this.vault.get(connection.credentialRef),url=connection.provider==='deepseek'?'https://api.deepseek.com/models':connection.provider==='openai'?'https://api.openai.com/v1/models':'https://api.elevenlabs.io/v1/models';const response=await this.fetch(url,{method:'GET',headers:connection.provider==='elevenlabs'?{'xi-api-key':key}:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000),redirect:'error'});if(response.ok){const raw=await response.json();connection.accountModels=(Array.isArray(raw)?raw:raw.data??[]).map(m=>({id:m.id??m.model_id,name:m.name??m.id??m.model_id})).filter(m=>typeof m.id==='string');statuses.authentication='authenticated';statuses.serviceConnection='catalog_connected';statuses.permission=connection.accountModels.some(m=>m.id===connection.model)?'listed_not_generation_verified':'model_not_listed';detail='账号目录 GET 成功，不等于生成权限或生成验收通过。';}else{statuses.authentication=response.status===401?'rejected':'not_verified';detail=`账号目录返回 HTTP ${response.status}；没有生成。`;}}
    else if(SERVICE_PROVIDERS.find(p=>p.id===connection.provider)?.auth==='local-runtime'){
      const p=connection.parameters,runtimeEvidence={executablePresent:typeof p.executable==='string'&&fs.existsSync(p.executable),modelPresent:typeof p.modelPath==='string'&&fs.existsSync(p.modelPath),workflowPresent:typeof p.workflowPath==='string'&&fs.existsSync(p.workflowPath),endpointReachable:false,workflowVerified:false};
      statuses.installation=runtimeEvidence.executablePresent?'detected':'not_detected';statuses.authentication='local_no_credential';statuses.adapter='local_workflow_not_verified';
      if(p.endpoint){const endpoint=new URL(p.endpoint);if(!['http:','https:'].includes(endpoint.protocol)||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))throw new AppError('本地运行后台仅核查明确的回环地址，不猜测远程服务。');if(connection.provider==='comfyui'){try{const res=await this.fetch(new URL('/system_stats',endpoint),{method:'GET',signal:AbortSignal.timeout(5000),redirect:'error'});const raw=await res.json();runtimeEvidence.endpointReachable=res.ok&&!!raw.system;statuses.serviceConnection=runtimeEvidence.endpointReachable?'detected':'not_verified';}catch{statuses.serviceConnection='not_reachable';}}}
      connection.runtimeEvidence=runtimeEvidence;detail='仅检查实际文件及 ComfyUI 只读 system_stats；未启动服务、下载模型或生成。文件存在不等于工作流可执行。';
    }
    else detail=connection.blockedReason??'凭据已保存状态与模型资格分别核查；此渠道没有本轮核验的无消费权限探针，未调用生成来试连接。';
    this.check(this.config(),config.revision);connection.statuses=statuses;connection.lastInspection={at:now(),detail,generationSubmitted:false};this.save(config);return this.publicConnection(connection);
  }
  async runText(options){
    const {projectId,prompt,schema,cwd,signal,onEvent}=options;const snapshot=options.serviceSnapshot??this.resolve('text',projectId);this.assertSnapshotCurrent(snapshot,projectId);
    if(!this.allowGeneration)throw new AppError('本轮真实文字及媒体生成关闭；没有发出模型请求。',403);
    if(snapshot.provider==='codex-cli')return {...await this.localRunner(options),provider:'codex-cli',serviceSnapshot:snapshot};
    const provider=SERVICE_PROVIDERS.find(p=>p.id===snapshot.provider);if(provider?.blocker)throw new AppError(provider.blocker,409);
    if(snapshot.provider==='chatgpt-siwc'&&!this.config().connections.find(c=>c.id===snapshot.connectionId)?.accountModels.some(m=>m.id===snapshot.model))throw new AppError('请读取此 ChatGPT 账号实际可见模型目录并选择模型；不能使用预置目录假装账号有权限。',409);
    const request=buildProviderRequest(snapshot,{prompt,schema}),credential=await this.secretFor(snapshot);this.assertSnapshotCurrent(snapshot,projectId);fs.mkdirSync(cwd,{recursive:true});
    const intentFile=path.join(cwd,'provider-intent.json');if(fs.existsSync(intentFile))throw new AppError('此模型请求已有持久化提交意图，结果未知也不会再次 POST。',409);
    const intent={requestId:options.requestId??randomUUID(),createdAt:now(),status:'submitting',queryable:false,serviceSnapshot:snapshot,promptHash:hash(prompt),input:request.body,endpoint:request.url};fs.writeFileSync(intentFile,JSON.stringify(intent,null,2),{flag:'wx'});onEvent?.({type:'request.intent',message:'提交意图已保存；同步请求结果未知时不自动重发。'});
    let response;try{response=await this.fetch(request.url,{method:'POST',headers:{...request.headers,Authorization:`Bearer ${credential}`},body:JSON.stringify(request.body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(300000)]):AbortSignal.timeout(300000),redirect:'error'});}catch{const receipt={transport:'http',provider:snapshot.provider,serviceSnapshot:snapshot,completed:false,httpStatus:null,finalMessage:'',error:'模型请求结果未知或等待中断；同步渠道无外部任务 ID，禁止自动重复提交。',status:'uncertain',queryable:false};fs.writeFileSync(path.join(cwd,'provider-receipt.json'),JSON.stringify(receipt,null,2));return receipt;}
    const rawText=await response.text();let raw,streamCompletion=false;
    if(snapshot.provider==='chatgpt-siwc'&&response.ok){const events=[];for(const block of rawText.split(/\r?\n\r?\n/)){const data=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');if(!data)continue;try{events.push(JSON.parse(data));}catch{}}
      raw=events.findLast(event=>['response.completed','response.failed','response.incomplete'].includes(event.type))?.response;streamCompletion=events.some(event=>event.type==='response.completed')&&raw?.status==='completed';if(!streamCompletion)raw={...raw,status:raw?.status??'interrupted_stream',error:raw?.error??{message:'SSE 流未收到真实 response.completed 终态。'}};fs.writeFileSync(path.join(cwd,'provider-stream.sse'),rawText);
    }else{try{raw=JSON.parse(rawText);}catch{raw={status:'invalid_response',error:{message:'HTTP 返回不是有效 JSON；原文保留。'},rawText};}}
    const receipt={...parseTextResponse(raw,{provider:snapshot.provider,httpStatus:response.status,requestId:response.headers.get('x-request-id')}),serviceSnapshot:snapshot};if(!response.ok)receipt.error=`HTTP ${response.status}：${raw.error?.message??'服务拒绝请求。'}`;
    if(streamCompletion)receipt.completionEvidence={type:'response.completed',status:'completed',responseId:raw.id??null,transport:'official_sse_event'};
    fs.writeFileSync(path.join(cwd,'provider-receipt.json'),JSON.stringify(receipt,null,2));onEvent?.({type:receipt.completed?'response.status.completed':'response.failed',message:receipt.completed?'同步 HTTP 正文返回 completed 状态及完整文字；没有伪造流事件。':receipt.error,usage:receipt.usage});return receipt;
  }
  prepareTask(projectId,category,input){return this.media.prepare(projectId,category,input);}
  task(id){return this.store.read('service-tasks',id);}
  async submitTask(id,body){return this.media.submit(id,body);}
  async queryTask(id){return this.media.query(id);}
  close(){this.siwc.close();}
}

export async function handleServiceRoutes({request,response,segments,method,readJson,json,registry,url}){
  if(segments[0]!=='api')return false;
  if(segments[1]==='projects'&&segments[3]==='service-tasks'&&segments.length===4){if(method==='GET')json(response,{tasks:registry.store.list('service-tasks').values.filter(task=>task.projectId===segments[2])});else if(method==='POST'){const input=await readJson(request);json(response,registry.prepareTask(segments[2],input.category,input.input),201);}else throw new AppError('媒体任务支持 GET/POST。',405);return true;}
  if(segments[1]==='service-tasks'&&segments.length>=3){const id=segments[2];if(method==='GET'&&segments.length===3)json(response,registry.task(id));else if(method==='POST'&&segments.length===4){const input=await readJson(request);const action=segments[3];if(action==='quote')json(response,registry.media.quote(id,input));else if(action==='authorize')json(response,registry.media.authorize(id,input));else if(action==='submit')json(response,await registry.submitTask(id,input));else if(action==='query')json(response,await registry.queryTask(id));else if(action==='download')json(response,await registry.media.download(id));else if(action==='cancel')json(response,registry.media.cancel(id));else throw new AppError('媒体操作不存在。',404);}else throw new AppError('媒体任务接口不存在。',404);return true;}
  if(segments[1]==='projects'&&segments[3]==='services'&&segments.length===4){if(method==='GET')json(response,registry.view(segments[2]));else if(method==='PUT')json(response,registry.setProjectSelection(segments[2],await readJson(request)));else throw new AppError('服务选择仅支持 GET/PUT。',405);return true;}
  if(segments[1]!=='services')return false;
  if(segments.length===2&&method==='GET'){json(response,registry.view(url?.searchParams.get('projectId')??undefined));return true;}
  if(segments[2]==='connections'&&segments.length===3&&method==='POST'){json(response,registry.saveConnection(await readJson(request)),201);return true;}
  if(segments[2]==='defaults'&&method==='PUT'){json(response,registry.setDefaults(await readJson(request)));return true;}
  if(segments[2]==='connections'&&segments.length===5&&method==='POST'){const id=segments[3];if(segments[4]==='credential')json(response,await registry.putCredential(id,(await readJson(request)).secret));else if(segments[4]==='inspect')json(response,await registry.inspectConnection(id));else if(segments[4]==='authorize')json(response,await registry.siwc.start(id));else throw new AppError('服务操作不存在。',404);return true;}
  throw new AppError('服务接口不存在。',404);
}
