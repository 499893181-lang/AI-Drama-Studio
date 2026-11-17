import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {AppError,now,validId} from './store.mjs';
import {creativeHash} from './creative-store.mjs';
import {probeAudio} from './voice-media.mjs';
import {compileVoiceParameters,runVoiceProvider,voiceContracts} from './voice-provider.mjs';

const clone=value=>structuredClone(value), hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const str=(value,max=5000)=>{if(typeof value!=='string'||value.length>max)throw new AppError('声音字段格式或长度无效。');return value;};
export class VoiceWorkspace {
  constructor(store,{creative,probe=probeAudio}={}){this.store=store;this.creative=creative?.workspace??creative;this.probe=probe;for(const kind of ['voice-workspaces','voice-versions','voice-tasks','voice-files'])fs.mkdirSync(path.join(store.root,kind),{recursive:true});}
  get(id){this.store.read('projects',id);return fs.existsSync(this.store.file('voice-workspaces',id))?this.store.read('voice-workspaces',id):{id,revision:0,cards:[],utterances:[],assets:[],reviews:[],selections:[],versionIds:[],activeVersionId:null,createdAt:now(),updatedAt:now()};}
  check(value,revision){if(value.revision!==revision)throw new AppError('声音设置已更新，请刷新核对；旧稿保留。',409);}
  source(id){
    const workspace=this.creative?.get(id)??(fs.existsSync(this.store.file('creative-workspaces',id))?this.store.read('creative-workspaces',id):null), script=workspace?.versions?.find(v=>v.id===workspace.activeScriptId&&v.kind==='script');
    if(!script)throw new AppError('请先确认剧本，再建立角色声音和逐句台词。',409);
    const current=this.creative?.view?.(id),currentVersion=current?.versions?.find(v=>v.id===script.id);
    if(current&&(!currentVersion||currentVersion.stale))throw new AppError('已确认剧本的上游要求已改变，请先复核并重新确认剧本；旧声音与文件保留。',409);
    return {projectId:id,scriptVersionId:script.id,scriptHash:creativeHash({body:script.body,data:script.data}),entities:clone(current?.effectiveEntities??script.data?.entities??workspace.entities??[]),body:script.body};
  }
  update(id,input,{assistantTurnId=null}={}){
    if(assistantTurnId!==null&&!validId(assistantTurnId))throw new AppError('助手应用标识无效。');
    const value=this.get(id);this.check(value,input.revision);const source=this.source(id);
    if(!Array.isArray(input.cards)||!Array.isArray(input.utterances)||input.cards.length>100||input.utterances.length>1000)throw new AppError('声音卡或台词列表无效。');
    const cards=input.cards.map(card=>{
      if(!validId(card.id)||!source.entities.some(e=>e.id===card.entityId&&e.type==='character'))throw new AppError('声音卡须引用当前剧本的稳定人物ID。');
      const ageVariant=str(card.ageVariant??'',200),old=value.cards.find(c=>c.id===card.id);
      const content={id:card.id,entityId:card.entityId,ageVariant,label:str(card.label??card.entityId,200),description:str(card.description??''),voiceId:str(card.voiceId??'',200),referenceAudioId:card.referenceAudioId??null};
      if(content.referenceAudioId&&!value.assets.some(a=>a.id===content.referenceAudioId))throw new AppError('声音参考音频不存在；不能只填路径。');
      return {...content,version:(old?.version??0)+(creativeHash(content)!==old?.contentHash?1:0),contentHash:creativeHash(content)};
    });
    const utterances=input.utterances.map(line=>{
      if(!validId(line.id)||!cards.some(c=>c.id===line.cardId))throw new AppError('每句台词须绑定现有人物声音卡。');
      const content={id:line.id,cardId:line.cardId,text:str(line.text,10000),performance:str(line.performance??''),emotion:str(line.emotion??'',200),stress:str(line.stress??'',200),pause:str(line.pause??'',200),targetDurationUs:line.targetDurationUs??null,parameters:clone(line.parameters??{})};
      if(content.targetDurationUs!==null&&(!Number.isSafeInteger(content.targetDurationUs)||content.targetDurationUs<=0))throw new AppError('目标时间须为正整数微秒。');
      const old=value.utterances.find(u=>u.id===line.id);return {...content,version:(old?.version??0)+(creativeHash(content)!==old?.contentHash?1:0),contentHash:creativeHash(content)};
    });
    if(new Set(cards.map(c=>c.id)).size!==cards.length||new Set(utterances.map(u=>u.id)).size!==utterances.length)throw new AppError('声音卡或台词ID重复。');
    const version={id:randomUUID(),projectId:id,revision:value.revision+1,cards,utterances,source,sourceHash:creativeHash(source),createdAt:now(),origin:assistantTurnId?'ai_assisted_human_applied':'human-editor',assistantTurnId,formalStageStatus:'not_checked'};version.contentHash=creativeHash(version);
    fs.writeFileSync(this.store.file('voice-versions',version.id),JSON.stringify(version,null,2)+'\n',{flag:'wx'});
    this.store.write('voice-workspaces',{...value,revision:value.revision+1,cards,utterances,source,sourceHash:version.sourceHash,activeVersionId:version.id,versionIds:[...value.versionIds,version.id],updatedAt:now()});return this.view(id);
  }
  binding(id,lineId){const value=this.get(id),line=value.utterances.find(u=>u.id===lineId),card=value.cards.find(c=>c.id===line?.cardId);if(!line||!card)throw new AppError('请先保存角色声音卡和这句台词。',409);const source=this.source(id);if(creativeHash(source)!==value.sourceHash)throw new AppError('剧本或人物版本已改变，声音稿需复核并保存。',409);return {projectId:id,scriptVersionId:source.scriptVersionId,sourceHash:value.sourceHash,card:clone(card),utterance:clone(line)};}
  async import(id,input,bytes,{task=null}={}){
    let value=this.get(id);this.check(value,input.revision);if(!Buffer.isBuffer(bytes)||bytes.length>100*1024*1024)throw new AppError('音频上传超过100MiB。');
    if(!input.source||!['manual','test','provider'].includes(input.source.kind)||!str(input.source.description??'').trim())throw new AppError('须声明音频实际来源。');
    if(input.source.kind==='provider'&&!task)throw new AppError('手工导入不能声明为已验证服务生成。');
    const binding=task?.inputSnapshot??this.binding(id,input.utteranceId),bindingHash=creativeHash(binding),assetId=randomUUID(),directory=this.store.directory?.('voice-files',id)??path.join(this.store.root,'voice-files',id);fs.mkdirSync(directory,{recursive:true});
    const file=path.join(directory,`${assetId}.bin`);fs.writeFileSync(file,bytes,{flag:'wx'});const probe=await this.probe(file);
    value=this.get(id);if(!task)this.check(value,input.revision);
    const asset={id:assetId,projectId:id,utteranceId:binding.utterance.id,cardId:binding.card.id,version:value.assets.filter(a=>a.utteranceId===binding.utterance.id).length+1,filename:str(input.filename??'voice.mp3',200),relativePath:path.join('voice-files',id,`${assetId}.bin`),mimeType:probe.mimeType??(probe.codec==='pcm_s16le'?'audio/wav':'audio/mpeg'),sha256:probe.sha256,probe,source:clone(input.source),binding,bindingHash,taskId:task?.id??null,testFixture:input.source.kind==='test'||task?.executionMode==='isolated-fixture',createdAt:now(),automaticallySelected:false};
    this.store.write('voice-workspaces',{...value,revision:value.revision+1,assets:[...value.assets,asset],updatedAt:now()});return asset;
  }
  assetState(id,asset,value=this.get(id)){
    let stale=false,reason=null;try{if(creativeHash(this.binding(id,asset.utteranceId))!==asset.bindingHash)throw new Error('剧本、声音卡或台词已改变。');if(creativeHash(asset.binding)!==asset.bindingHash)throw new Error('绑定Hash异常。');this.file(id,asset.id);}catch(error){stale=true;reason=error.message;}
    const review=[...value.reviews].reverse().find(r=>r.assetId===asset.id),reviewCurrent=!!review&&review.sha256===asset.sha256&&review.bindingHash===asset.bindingHash&&!stale,selection=[...value.selections].reverse().find(s=>s.utteranceId===asset.utteranceId),selected=selection?.assetId===asset.id&&reviewCurrent&&review.verdict==='accepted';
    return {...asset,stale,staleReason:reason,review:review??null,reviewCurrent,selected,state:stale?'needs_review':selected?'selected':review?.verdict==='rejected'?'rejected':reviewCurrent?'checked':'needs_check',url:`/api/projects/${id}/voice/assets/${asset.id}/file`};
  }
  review(id,input){const value=this.get(id);this.check(value,input.revision);const asset=value.assets.find(a=>a.id===input.assetId);if(!asset)throw new AppError('音频候选不存在。',404);const state=this.assetState(id,asset,value);if(state.stale)throw new AppError('旧音频输入已过期，保留原稿；先核对当前版本。',409);if(!['accepted','rejected'].includes(input.verdict))throw new AppError('请选择通过或拒绝。');const review={id:randomUUID(),assetId:asset.id,bindingHash:asset.bindingHash,sha256:asset.sha256,verdict:input.verdict,notes:str(input.notes??''),createdAt:now()};this.store.write('voice-workspaces',{...value,revision:value.revision+1,reviews:[...value.reviews,review],updatedAt:now()});return this.view(id);}
  select(id,input){const value=this.get(id);this.check(value,input.revision);const asset=value.assets.find(a=>a.id===input.assetId);if(!asset)throw new AppError('音频候选不存在。',404);const state=this.assetState(id,asset,value);if(state.stale||!state.reviewCurrent||state.review.verdict!=='accepted')throw new AppError('请先人工检查当前音频并通过，再选用。',409);this.store.write('voice-workspaces',{...value,revision:value.revision+1,selections:[...value.selections,{id:randomUUID(),assetId:asset.id,utteranceId:asset.utteranceId,reviewId:state.review.id,createdAt:now()}],updatedAt:now()});return this.view(id);}
  file(id,assetId){const value=this.get(id),asset=value.assets.find(a=>a.id===assetId);if(!asset)throw new AppError('音频不存在。',404);const expected=path.join('voice-files',id,`${asset.id}.bin`);if(asset.relativePath!==expected)throw new AppError('音频路径绑定异常。',409);const directory=this.store.directory?.('voice-files',id)??path.join(this.store.root,'voice-files',id),file=path.join(directory,`${asset.id}.bin`),bytes=fs.readFileSync(file);if(hash(bytes)!==asset.sha256)throw new AppError('音频Hash变化。',409);return {path:file,bytes,mimeType:asset.mimeType,name:asset.filename};}
  readVersion(id,versionId){const version=this.store.read('voice-versions',versionId),{contentHash,...content}=version;if(version.projectId!==id||creativeHash(content)!==contentHash)throw new AppError('声音历史版本Hash不一致；原件保留。',409);return version;}
  view(id){const value=this.get(id);let source=null,blocker=null;try{source=this.source(id);}catch(error){blocker=error.message;}const suggestedCards=value.cards.length?value.cards:(source?.entities??[]).filter(e=>e.type==='character').map(e=>({id:`VOICE-${creativeHash(e.id).slice(0,16)}`,entityId:e.id,ageVariant:'',label:e.name??e.description?.split(/[，,；;。]/)[0]??e.id,description:e.description??'',voiceId:'',referenceAudioId:null,version:0,origin:'confirmed-script-summary',sourceStatus:e.source??'pending',requiresSave:true}));return {...value,cards:suggestedCards,source,stale:!!value.sourceHash&&creativeHash(source)!==value.sourceHash,blocker,assets:value.assets.map(a=>this.assetState(id,a,value)),versions:value.versionIds.map(versionId=>this.readVersion(id,versionId)),tasks:this.store.list('voice-tasks').values.filter(t=>t.projectId===id),capabilities:{contracts:voiceContracts,lipSyncVerified:false,automaticTimeStretch:false,localRuntimeVerified:false,realGenerationVerified:false},formalStageStatus:'not_checked'};}
}

export class VoiceService {
  constructor(store,{creative,probe,resolve,secretFor,assertSnapshotCurrent,runner=runVoiceProvider,allowGeneration=false,executionMode='official-adapter',timeoutMs=60000}={}){this.store=store;this.workspace=new VoiceWorkspace(store,{creative,probe});this.resolve=resolve;this.secretFor=secretFor;this.assertSnapshotCurrent=assertSnapshotCurrent;this.runner=runner;this.allowGeneration=allowGeneration;this.executionMode=executionMode;this.timeoutMs=timeoutMs;this.active=new Map();this.controllers=new Map();for(const task of store.list('voice-tasks').values)if(task.status==='submitting'||task.status==='prepared'&&fs.existsSync(path.join(store.root,'voice-tasks',`${task.id}.submit-intent`))){task.status='outcome_unknown';task.error='重启时同步语音提交意图或结果未知；无查询任务ID，不自动重发。';store.write('voice-tasks',task);}}
  view(id){return {...this.workspace.view(id),generationEnabled:this.allowGeneration,disabledReason:this.allowGeneration?null:'本轮不发起真实语音生成；可配置、编辑、导入TEST音频及本地试听。'};}
  async prepare(id,input){const value=this.workspace.get(id);this.workspace.check(value,input.revision);const snapshot=this.workspace.binding(id,input.utteranceId),service=await this.resolve?.('voice',id);if(!service)throw new AppError('请先配置项目语音服务。',409);const compiled=compileVoiceParameters(service.provider,service.model,snapshot.card,snapshot.utterance),fingerprint=creativeHash({snapshot,service,redoOfTaskId:input.redoOfTaskId??null});const existing=this.store.list('voice-tasks').values.find(t=>t.fingerprint===fingerprint);if(existing)return existing;const task={id:randomUUID(),projectId:id,status:'prepared',fingerprint,inputSnapshot:snapshot,inputHash:creativeHash(snapshot),serviceSnapshot:service,compiled,redoOfTaskId:input.redoOfTaskId??null,externalTaskId:null,queryable:false,executionMode:this.executionMode,submittedAt:null,submitAttempts:0,result:null,error:null,createdAt:now(),updatedAt:now()};this.store.write('voice-tasks',task);return task;}
  quote(id,input){
    const task=this.store.read('voice-tasks',id),cost=input.costBasis;
    if(task.status!=='prepared'||task.submittedAt||input.inputHash!==task.inputHash||input.serviceHash!==creativeHash(task.serviceSnapshot))throw new AppError('声音报价须绑定未提交的同一句及服务配置。',409);
    if(!cost||!['documented','account_quote'].includes(cost.status)||typeof cost.amount!=='number'||!Number.isFinite(cost.amount)||cost.amount<0||typeof cost.unit!=='string'||!cost.unit||typeof cost.source!=='string'||!cost.source.trim()||!Number.isFinite(Date.parse(cost.validUntil))||Date.parse(cost.validUntil)<=Date.now())throw new AppError('费用待确认：缺少可核实金额、单位、来源或有效期；计划预算不是报价。',409);
    task.costQuote={status:cost.status,amount:cost.amount,unit:cost.unit,source:cost.source,conditions:cost.conditions??null,validUntil:cost.validUntil,inputHash:task.inputHash,serviceHash:creativeHash(task.serviceSnapshot),requestHash:creativeHash(task.compiled),recordedAt:now(),sourceDeclaration:'用户登记的本句费用依据；未经官方报价回执不称官方实时quote。'};task.updatedAt=now();this.store.write('voice-tasks',task);return task;
  }
  async run(id,input={}){
    if(this.active.has(id))return this.active.get(id);
    const task=this.store.read('voice-tasks',id);
    if(task.status!=='prepared'||task.submittedAt)return task;
    if(!this.allowGeneration)throw new AppError('本轮真实语音生成关闭；未发出外部请求。',409);
    const authorization=input.authorization,cost=task.costQuote;
    if(authorization?.inputHash!==task.inputHash||authorization?.serviceHash!==creativeHash(task.serviceSnapshot)||authorization?.confirmed!==true||!cost?.source||cost.inputHash!==task.inputHash||cost.serviceHash!==creativeHash(task.serviceSnapshot)||cost.requestHash!==creativeHash(task.compiled)||authorization.costHash!==creativeHash(cost)||authorization.unit!==cost.unit||typeof authorization.maximum!=='number'||!Number.isFinite(authorization.maximum)||authorization.maximum<cost.amount||Date.parse(cost.validUntil)<=Date.now())throw new AppError('缺少绑定本句、服务配置、有效费用依据及预算的本人授权。',409);
    if(creativeHash(this.workspace.binding(task.projectId,task.inputSnapshot.utterance.id))!==task.inputHash)throw new AppError('台词或声音版本变化，请准备新任务。',409);
    // Exclusive durable intent also protects concurrent service instances. Never delete/recreate it to retry.
    const marker=path.join(this.store.root,'voice-tasks',`${id}.submit-intent`);
    try{fs.writeFileSync(marker,JSON.stringify({taskId:id,inputHash:task.inputHash,at:now()}),{flag:'wx'});}catch(error){if(error.code==='EEXIST'){const current=this.store.read('voice-tasks',id);if(current.status==='prepared'){current.status='outcome_unknown';current.error='已有持久提交意图但回执不完整；不重发。';this.store.write('voice-tasks',current);}return current;}throw error;}
    task.status='submitting';task.submittedAt=now();task.submitAttempts=1;task.externalPostAttempts=0;this.store.write('voice-tasks',task);
    const controller=new AbortController(),timer=setTimeout(()=>{controller.abort();const current=this.store.read('voice-tasks',id);if(current.status==='submitting'){current.status='outcome_unknown';current.error='同步语音等待超时，服务端是否完成未知；不自动重发。';current.updatedAt=now();this.store.write('voice-tasks',current);}},this.timeoutMs);this.controllers.set(id,controller);
    const promise=(async()=>{
      try{
        await this.assertSnapshotCurrent?.(task.serviceSnapshot,task.projectId);
        const secret=await this.secretFor?.(task.serviceSnapshot);
        if(controller.signal.aborted)throw new AppError('声音请求在提交前已中断。',409);
        task.externalPostAttempts=['indextts','qwen3-tts'].includes(task.serviceSnapshot.provider)?0:1;task.localRunAttempts=task.externalPostAttempts?0:1;this.store.write('voice-tasks',task);
        const receipt=await this.runner(task.compiled,{secret,signal:controller.signal});
        if(!receipt.terminalEvidence||!Buffer.isBuffer(receipt.bytes))throw new AppError('未收到明确完成证据和实际音频字节。',409);
        const diagnosticDirectory=path.join(this.store.root,'runtime','voice-responses',task.id);fs.mkdirSync(diagnosticDirectory,{recursive:true});const diagnosticFile=path.join(diagnosticDirectory,'response.bin');fs.writeFileSync(diagnosticFile,receipt.bytes,{flag:'wx'});task.diagnosticAudio={relativePath:path.relative(this.store.root,diagnosticFile),sha256:hash(receipt.bytes),size:receipt.bytes.length};task.rawReceipt=receipt.rawReceipt;task.terminalEvidence=receipt.terminalEvidence;task.usage=receipt.usage??null;task.diagnosticTraceId=receipt.diagnosticTraceId??null;const currentStatus=this.store.read('voice-tasks',id).status;if(currentStatus!=='submitting')task.status=currentStatus;this.store.write('voice-tasks',task);
        const asset=await this.workspace.import(task.projectId,{revision:this.workspace.get(task.projectId).revision,filename:`voice-${task.id}.${receipt.extension??'mp3'}`,source:{kind:'provider',description:`${task.serviceSnapshot.provider}/${task.serviceSnapshot.model}，终态和解码分别检查`}},receipt.bytes,{task});
        if(controller.signal.aborted||this.store.read('voice-tasks',id).status!=='submitting')throw new AppError('迟到音频已保留，原中断状态不改为成功。',409);
        task.status='succeeded';task.result={assetId:asset.id,sha256:asset.sha256,probe:asset.probe,automaticallySelected:false};
      }catch(error){task.status=error.outcomeUnknown||controller.signal.aborted?'outcome_unknown':'failed';task.error=error.message;if(error.rawReceipt)task.rawReceipt=error.rawReceipt;}
      finally{task.updatedAt=now();this.store.write('voice-tasks',task);clearTimeout(timer);this.active.delete(id);this.controllers.delete(id);}return task;
    })();this.active.set(id,promise);return promise;
  }
  close(){for(const controller of this.controllers.values())controller.abort();for(const task of this.store.list('voice-tasks').values)if(task.status==='submitting'){task.status='outcome_unknown';task.error='服务关闭，同步任务不自动重提。';this.store.write('voice-tasks',task);}}
}
