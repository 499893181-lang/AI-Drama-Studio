import fs from 'node:fs';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import {lookup} from 'node:dns';
import {isIP} from 'node:net';
import { AppError,now } from './store.mjs';
import { inspectImage } from './image-files.mjs';
import { probeVideo,runMedia } from './video-media.mjs';
import { resolveExecutable } from './tools.mjs';
import { buildProviderRequest,parseMediaResponse,providerQueryRequest,parseProviderTaskResult } from './provider-adapters.mjs';
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const clone=value=>structuredClone(value);
const terminal=['succeeded','failed','cancelled'];
function publicAddress(address){if(isIP(address)===4){const[a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19));}return isIP(address)===6&&/^[23]/i.test(address);}
function publicHttpsBytes(url){return new Promise((resolve,reject)=>{const request=httpsRequest(url,{method:'GET',lookup(hostname,options,callback){lookup(hostname,{all:true},(error,addresses)=>{if(error)return callback(error);if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))return callback(new AppError('媒体域名解析到非公共地址，已阻断下载。',409));if(options.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family);});}},response=>{if(response.statusCode!==200){response.resume();reject(new AppError(`媒体下载 HTTP ${response.statusCode}；不跟随重定向。`,409));return;}let size=0;const chunks=[];response.on('data',chunk=>{size+=chunk.length;if(size>512*1024*1024){response.destroy(new AppError('下载媒体超过512MiB上限。',409));return;}chunks.push(chunk);});response.once('error',reject);response.once('end',()=>resolve(Buffer.concat(chunks)));});request.setTimeout(120000,()=>request.destroy(new AppError('媒体下载超时。',409)));request.once('error',reject);request.end();});}
/** One durable submit intent, independent query/download retries, immutable input binding. */
export class ServiceMediaTasks {
  constructor(registry,{validateInput=null,importCandidate=null,probe=probeVideo}={}){this.registry=registry;this.store=registry.store;this.validateInput=validateInput;this.importCandidate=importCandidate;this.probe=probe;this.active=new Set();for(const task of this.store.list('service-tasks').values)if(task.status==='submitting'){task.status=task.externalTaskId?'interrupted':'submission_unknown';task.message='上次提交等待中断，保留稳定 submitId；只查询原任务，不自动重提。';this.write(task);}}
  read(id){return this.store.read('service-tasks',id);}
  write(task){task.updatedAt=now();return this.store.write('service-tasks',task);}
  assertInput(task,{current=true}={}){if(hash(task.input)!==task.inputHash)throw new AppError('任务输入快照已损坏。',409);if(current)this.registry.assertSnapshotCurrent(task.serviceSnapshot,task.projectId);this.references(task);if(this.validateInput)this.validateInput(task,{current});}
  references(task){
    for(const ref of task.input.references??[]){
      if(typeof ref.path!=='string'||!path.isAbsolute(ref.path))throw new AppError('参考素材缺少实际本地文件，不能将计划或 URL 当成附件证明。',409);
      const file=fs.realpathSync(ref.path),root=fs.realpathSync(this.store.root),projectRoot=this.store.projectRoot?.('projects',task.projectId);
      const roots=[root,projectRoot].filter(Boolean).map(value=>fs.realpathSync(value).toLowerCase()+path.sep);
      if(!roots.some(root=>file.toLowerCase().startsWith(root)))throw new AppError('参考素材不在当前治理或项目目录内。',403);
      const bytes=fs.readFileSync(file);if(hash(bytes)!==ref.hash)throw new AppError('实际参考素材 Hash 已改变，禁止使用旧授权。',409);
      if(!ref.type||ref.type==='image_url'){
        const info=inspectImage(bytes),provider=task.serviceSnapshot.provider;
        if(['seedance','minimax-h3'].includes(provider)){
          const min=provider==='seedance'?300:256,max=provider==='seedance'?6000:5760,ratio=info.width/info.height;
          if(info.width<min||info.height<min||info.width>max||info.height>max||ratio<0.4||ratio>2.5||bytes.length>=30*1024*1024)throw new AppError(`${provider} 输入参考图要求宽高 ${min}–${max}px、画幅比 0.4–2.5、单图小于30MB；当前为 ${info.width}×${info.height}，请另存合规派生图，不自动拉伸或替换。`,409);
        }
      }
    }
  }
  prepare(projectId,category,input){
    if(!['image','video'].includes(category))throw new AppError('媒体任务类别无效。');this.store.read('projects',projectId);
    if(input.requestId!==undefined&&(typeof input.requestId!=='string'||!/^[A-Za-z0-9-]{1,80}$/.test(input.requestId)))throw new AppError('媒体请求 ID 格式无效。');
    const serviceSnapshot=this.registry.resolve(category,projectId),inputHash=hash(input),prior=this.store.list('service-tasks').values.find(task=>task.projectId===projectId&&task.category===category&&(input.requestId?task.requestId===input.requestId:task.inputHash===inputHash&&task.serviceSnapshot.hash===serviceSnapshot.hash&&!terminal.includes(task.status)));
    if(prior){if(prior.inputHash!==inputHash||prior.serviceSnapshot.hash!==serviceSnapshot.hash)throw new AppError('同一媒体请求 ID 已绑定不同输入或服务配置，禁止重复提交。',409);return prior;}
    const task={id:randomUUID(),projectId,category,status:'prepared',serviceSnapshot,input:clone(input),inputHash,receipts:[],externalTaskId:null,createdAt:now(),updatedAt:now(),applicationSubmitCount:0,actualToolCalls:null,realGeneration:'not_verified',message:'尚未提交；费用、参考绑定及本人批准须逐任务核对。'};
    task.requestId=input.requestId??randomUUID();
    this.assertInput(task);task.request=buildProviderRequest(serviceSnapshot,input);task.bindingHash=hash({projectId,serviceSnapshot,inputHash:task.inputHash});return this.write(task);
  }
  quote(id,body){const task=this.read(id);this.assertInput(task);if(!['prepared','authorized'].includes(task.status)||body.bindingHash!==task.bindingHash)throw new AppError('报价必须绑定当前尚未提交的同一任务。',409);const basis=this.registry.validateCost(body.costBasis);task.costQuote={...basis,scopeInputHash:task.inputHash,scopeRequestHash:hash(task.request),provider:task.serviceSnapshot.provider,model:task.serviceSnapshot.model,recordedAt:now(),sourceDeclaration:'用户提供的可核查依据，未经平台 quote 接口回执则不称官方实时查询'};task.authorization=null;task.status='prepared';return this.write(task);}
  authorize(id,body){const task=this.read(id);this.assertInput(task);if(!['prepared','authorized'].includes(task.status))throw new AppError('任务已经提交或结束，不能重新授权生成。',409);const cost=task.costQuote??task.serviceSnapshot.costBasis;
    if(!['documented','account_quote'].includes(cost.status)||!Number.isFinite(cost.amount)||cost.amount<0||!cost.source||!cost.validUntil||Date.parse(cost.validUntil)<=Date.now())throw new AppError('费用待确认：需要适用本渠道、模型、参数的有效报价依据；计划预算不是报价。',409);
    if(cost.scopeInputHash!==task.inputHash||cost.scopeRequestHash!==hash(task.request)||cost.provider!==task.serviceSnapshot.provider||cost.model!==task.serviceSnapshot.model)throw new AppError('连接通用价格不能套用到本次任务；请记录同渠道、模型、实际参数及输入的费用依据。',409);
    if(body.confirmed!==true||body.bindingHash!==task.bindingHash||body.inputHash!==task.inputHash||body.costHash!==hash(cost)||body.unit!==cost.unit||!Number.isFinite(body.budgetCap)||body.budgetCap<cost.amount)throw new AppError('本人批准必须绑定同一任务输入、服务、费用单位及足够预算。',409);
    task.authorization={id:task.authorization?.id??randomUUID(),bindingHash:task.bindingHash,inputHash:task.inputHash,costHash:hash(cost),unit:cost.unit,budgetCap:body.budgetCap,approvedAt:now(),consumedAt:null};task.status='authorized';return this.write(task);
  }
  async submit(id,body){
    let task=this.read(id);if(task.submitId)return task;if(this.active.has(id))return task;
    this.assertInput(task);if(!this.registry.allowGeneration)throw new AppError('本轮真实媒体生成关闭。',403);
    const cost=task.costQuote??task.serviceSnapshot.costBasis;
    if(!task.authorization||task.status!=='authorized'||body.authorizationId!==task.authorization.id||body.bindingHash!==task.bindingHash||task.authorization.costHash!==hash(cost)||Date.parse(cost.validUntil)<=Date.now())throw new AppError('缺少当前逐任务本人批准或报价已经失效。',409);
    this.active.add(id);
    try{
      const secret=await this.registry.secretFor(task.serviceSnapshot);
      const remoteEvidence=[];for(const ref of task.input.references??[]){if(task.request.multipart)continue;const actual=await this.bytes(ref.url);if(hash(actual)!==ref.hash)throw new AppError('参考 URL 返回的实际字节 Hash 不等于已选用原图，禁止提交；没有图像任务发生。',409);remoteEvidence.push({url:ref.url,sha256:hash(actual),checkedAt:now(),evidenceScope:'client_downloaded_url_bytes_match_local_asset_not_server_usage_receipt'});}
      task=this.read(id);if(task.submitId||task.status==='cancelled')return task;this.assertInput(task);
      const intentDirectory=path.join(this.store.root,'runtime','service-submit-intents');fs.mkdirSync(intentDirectory,{recursive:true});const intentFile=path.join(intentDirectory,`${id}.json`);const submitId=randomUUID();
      try{fs.writeFileSync(intentFile,JSON.stringify({taskId:id,submitId,bindingHash:task.bindingHash,inputHash:task.inputHash,at:now()}),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;const claim=JSON.parse(fs.readFileSync(intentFile,'utf8'));task=this.read(id);task.submitId=task.submitId??claim.submitId;if(!['succeeded','failed','cancelled'].includes(task.status))task.status=task.externalTaskId?'running':'submission_unknown';task.message='已经存在稳定提交意图，只恢复查询，不再次生成。';return this.write(task);}
      task.submitId=submitId;task.status='submitting';task.applicationSubmitCount=1;task.transportPostAttemptCount=0;task.submittedAt=now();task.authorization.consumedAt=now();task.referenceFetchEvidence=remoteEvidence;this.write(task);
      const request=buildProviderRequest(task.serviceSnapshot,task.input),headers={...request.headers,Authorization:`Bearer ${secret}`};let data;
      if(request.multipart){data=new FormData();for(const[k,v]of Object.entries(request.multipart.fields))data.append(k,String(v));for(const file of request.multipart.files){const bytes=fs.readFileSync(file.path);if(hash(bytes)!==file.sha256)throw new AppError('提交前参考附件已改变。',409);data.append(file.field,new Blob([bytes],{type:file.mimeType}),file.filename);}}
      else data=JSON.stringify(request.body);
      task.sentAttachments=(task.input.references??[]).map(ref=>({hash:ref.hash,role:ref.role??null,transport:request.multipart?'multipart_binary':'provider_remote_url',url:request.multipart?null:ref.url,serverUsageReceipt:null}));this.write(task);
      task.transportPostAttemptCount=1;this.write(task);const response=await this.registry.fetch(request.url,{method:'POST',headers,body:data,signal:AbortSignal.timeout(300000),redirect:'error'});const rawText=await response.text();let raw;try{raw=JSON.parse(rawText);}catch{raw={unparsedBody:rawText};}
      task=this.read(id);task.receipts.push({type:'submit',httpStatus:response.status,at:now(),raw});
      if(task.status==='cancelled'){const parsed=parseMediaResponse(task.serviceSnapshot,raw);task.externalTaskId=parsed.externalTaskId??task.externalTaskId;task.lateResult={httpStatus:response.status,raw,at:now(),boundToInputHash:task.inputHash};return this.write(task);}
      if(!response.ok){task.status=response.status>=500?'submission_unknown':'failed';task.error=`服务返回 HTTP ${response.status}；原回执保留，未切换或重试。`;return this.write(task);}
      const parsed=parseMediaResponse(task.serviceSnapshot,raw);task.externalTaskId=parsed.externalTaskId??null;
      if(task.category==='image'&&parsed.status==='artifact_returned'){task.status='remote_succeeded';task.artifact=clone(parsed.artifacts[0]);task.completionEvidence={type:'image_api_result',httpStatus:response.status,created:raw.created??null};task.usage=raw.usage??null;}
      else{task.status=parsed.status==='submitted'?'running':'submission_unknown';}
      return this.write(task);
    }catch(error){task=this.read(id);if(task.status!=='cancelled')task.status=task.submitId?'submission_unknown':'prepared';task.error=task.submitId?'提交后结果未知，只查询原任务，不重新 POST。':error.message;return this.write(task);}finally{this.active.delete(id);}
  }
  async query(id){let task=this.read(id);if(['succeeded','failed'].includes(task.status))return task;if(!task.externalTaskId)throw new AppError('没有原外部任务 ID；同步或未知结果不能假装可查询，也不重新提交。',409);const request=providerQueryRequest(task.serviceSnapshot,task.externalTaskId);try{const secret=await this.registry.secretFor(task.serviceSnapshot),response=await this.registry.fetch(request.url,{method:'GET',headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(30000),redirect:'error'});const raw=await response.json();task=this.read(id);task.receipts.push({type:'query',httpStatus:response.status,at:now(),raw});this.write(task);if(!response.ok)throw new AppError(`原任务查询 HTTP ${response.status}。`);const result=parseProviderTaskResult(task.serviceSnapshot,raw);if(result.completionEvidence?.externalTaskId&&result.completionEvidence.externalTaskId!==task.externalTaskId)throw new AppError('原查询回执返回了不同外部任务 ID，保留原回执但不接受成功。',409);if(task.status==='cancelled')task.lateResult={...result,at:now(),boundToInputHash:task.inputHash};else Object.assign(task,result);task.queryError=null;return this.write(task);}catch(error){task=this.read(id);task.queryError=error.message;return this.write(task);}}
  async bytes(url){const value=new URL(url),host=value.hostname.replace(/^\[|\]$/g,'');if(value.protocol!=='https:'||value.username||value.password||/^localhost\.?$/i.test(host)||isIP(host)&&!publicAddress(host))throw new AppError('媒体下载地址不是受支持的公共 HTTPS 地址。',409);if(this.registry.fetch===globalThis.fetch)return publicHttpsBytes(value); // Production DNS is validated inside the actual connection lookup (no rebind gap).
    const response=await this.registry.fetch(url,{method:'GET',signal:AbortSignal.timeout(120000),redirect:'error'});if(!response.ok)throw new AppError(`下载 HTTP ${response.status}。`);const chunks=[];let length=0;for await(const chunk of response.body){length+=chunk.length;if(length>512*1024*1024)throw new AppError('下载媒体超过512MiB上限。');chunks.push(chunk);}return Buffer.concat(chunks);}
  async download(id){let task=this.read(id);if(task.result)return task;if(this.active.has(id))return task;if(!['remote_succeeded','download_failed'].includes(task.status)||!task.completionEvidence)throw new AppError('缺少官方成功终态，不能下载并报告生成成功。',409);this.active.add(id);try{
      this.assertInput(task,{current:false});const dir=path.join(this.store.root,'runtime','service-media',id);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,task.category==='image'?'original-image.bin':'original-video.mp4');
      let bytes;if(fs.existsSync(file))bytes=fs.readFileSync(file);else{bytes=task.category==='image'&&task.artifact?.b64_json?Buffer.from(task.artifact.b64_json,'base64'):await this.bytes(task.category==='image'?task.artifact?.url:task.artifactUrl);fs.writeFileSync(file,bytes,{flag:'wx'});}
      let probe;if(task.category==='image'){const info=inspectImage(bytes),args=['-v','error','-nostdin','-protocol_whitelist','file,pipe','-i',file,'-frames:v','1','-f','null','-'];await runMedia(resolveExecutable('ffmpeg'),args);probe={...info,verified:true,sha256:hash(bytes),decodeEvidence:{tool:'ffmpeg',args,exitCode:0,framesRequested:1}};}else probe=await this.probe(file);if(probe.sha256!==hash(bytes))throw new AppError('实际下载文件 Hash 与解码检查不符。');
      const evidence={provider:task.serviceSnapshot.provider,model:task.serviceSnapshot.model,taskId:task.id,externalTaskId:task.externalTaskId,submitId:task.submitId,serviceSnapshot:clone(task.serviceSnapshot),inputHash:task.inputHash,bindingHash:task.bindingHash,completionEvidence:clone(task.completionEvidence),sentAttachments:clone(task.sentAttachments??[]),referenceFetchEvidence:clone(task.referenceFetchEvidence??[]),referenceUsageReceipt:null,visualAcceptance:'not_checked',testFixture:task.input.testFixture===true};
      const candidate=this.importCandidate?await this.importCandidate({task,bytes,probe,evidence,file}):null;
      task=this.read(id);task.result={path:file,sha256:hash(bytes),size:bytes.length,probe,candidate,automaticallySelected:false,evidence};task.realGeneration=task.input.testFixture?'isolated_fixture_not_real':'artifact_decoded_pending_human_review';if(task.status!=='cancelled')task.status='succeeded';task.downloadError=null;return this.write(task);
    }catch(error){task=this.read(id);if(task.status!=='cancelled')task.status='download_failed';task.downloadError=error.message;return this.write(task);}finally{this.active.delete(id);}}
  cancel(id){const task=this.read(id);if(terminal.includes(task.status))return task;task.status='cancelled';task.cancelledAt=now();task.message='仅取消本地等待；保留原任务，不代表服务端取消或退款，不自动重提。';return this.write(task);}
}
