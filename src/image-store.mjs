import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, now, validId, generationInput } from './store.mjs';
import { CreativeWorkspace, creativeHash, validateEntityRefs } from './creative-store.mjs';
import { compileShotDesign } from './creative-design.mjs';
import { inspectImage, buildImageZip } from './image-files.mjs';

const copy = value => structuredClone(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const safeText = (value, label, max=8000) => { if (typeof value !== 'string' || value.length > max) throw new AppError(`${label}格式或长度不正确。`); return value; };
const keyFor = (role,id) => `${role}:${id}`;
export class ImageWorkspace {
  constructor(store, { creativeWorkspace, knowledgeRoot } = {}) {
    this.store=store; this.creative=creativeWorkspace ?? new CreativeWorkspace(store,{knowledgeRoot});
    for (const name of ['image-workspaces','image-files']) fs.mkdirSync(path.join(store.root,name),{recursive:true});
  }
  get(id) {
    this.store.read('projects',id);
    if (fs.existsSync(this.store.file('image-workspaces',id))) return this.store.read('image-workspaces',id);
    return { id,revision:0,assets:[],reviews:[],selectionHistory:[],packets:[],createdAt:now(),updatedAt:now() };
  }
  check(value,revision) { if (value.revision !== revision) throw new AppError('图片工作台已在其他窗口更新，请刷新核对，原图片及选用历史未覆盖。',409); }
  save(value) { return this.store.write('image-workspaces',{...value,revision:value.revision+1,updatedAt:now()}); }
  source(id) {
    const workspace=this.creative.get(id), project=this.store.read('projects',id), knowledge=this.creative.knowledge();
    const current=this.creative.context(id,'storyboard'), creativeView=this.creative.view(id);
    const active=workspace.versions.find(version=>version.id===workspace.activeStoryboardId && version.kind==='storyboard');
    const shots=active?.data?.shots?.length ? active.data.shots : workspace.shots;
    const saved=Boolean(active || workspace.revision>0 && shots.length);
    const sourceVersion=active?.id ?? `saved-input-r${workspace.revision}`;
    const sourceHash=creativeHash({project:generationInput(project),brief:project.creativeBrief,sourceVersion,script:current.parent,requirements:workspace.instructions,stylePresetId:workspace.stylePresetId,manualRuleIds:workspace.manualRuleIds,locks:workspace.locks,knowledgeHash:knowledge.hash});
    const entities=current.effective.entities;
    const sourceStale=Boolean(active && creativeView.versions.find(version=>version.id===active.id)?.stale);
    const targets=[];
    for (const entity of entities.filter(entity=>['character','scene'].includes(entity.type))) {
      const role=entity.type;
      const base={role,targetId:entity.id,targetVersion:entity.version,entity,sourceHash,sourceVersion,sourceStale};
      targets.push({...base,key:keyFor(role,entity.id),label:`${role==='character'?'人物定妆':'场景'} ${entity.id}@${entity.version}`,description:entity.description,entityRefs:[{id:entity.id,version:entity.version}],prompt:`创作${role==='character'?'人物定妆参考图':'场景参考图'}。保持稳定身份 ${entity.id}@${entity.version}：${entity.description}。仅按已提供的事实设计；来源待确认的内容不升级为用户锁定。未给出的视觉细节需声明为候选，不改变人物、天气与故事。`,rules:[],ready:saved&&!sourceStale,targetHash:creativeHash(base)});
    }
    for (const shot of saved ? shots : []) {
      const input={projectId:id,episodeId:workspace.episodeId,sourceRevision:project.revision,inputHashes:{source:sourceHash},stylePresetId:workspace.stylePresetId,manualRuleIds:workspace.manualRuleIds,shot,entities,locks:workspace.locks,references:[]};
      let design=null,error=null; try { validateEntityRefs(shot,entities);design=compileShotDesign(input,knowledge); } catch(cause) { error=cause.message; }
      const currentShot=current.effective.shots.find(item=>item.id===shot.id) ?? null;
      const binding={role:'shot',targetId:shot.id,targetVersion:sourceVersion,shot,currentShot,sourceHash,entities:entities.filter(entity=>shot.entityRefs?.some(ref=>ref.id===entity.id&&ref.version===entity.version))};
      targets.push({...binding,key:keyFor('shot',shot.id),label:`分镜 ${shot.id}`,sourceVersion,description:shot.purpose,prompt:design?.imagePrompt??'',rules:design?.appliedRules.filter(rule=>rule.target==='imagePrompt')??[],style:design?.style??null,entityRefs:copy(shot.entityRefs??[]),ready:Boolean(design?.structuralStatus==='valid_draft'&&!sourceStale),targetHash:creativeHash(binding),findings:design?.findings??[],error,design});
    }
    return {workspace,project,knowledge,entities,parent:current.parent,sourceVersion,sourceHash,sourceStale,saved,targets,entityProvenance:creativeView.entityProvenance??null};
  }
  active(workspace) { const selected=new Map(); for(const entry of workspace.selectionHistory) selected.set(entry.key,entry); return selected; }
  references(workspace,target,source) {
    if(target.role!=='shot') return [];
    const selected=this.active(workspace);
    return source.targets.filter(row=>['character','scene'].includes(row.role)&&target.entityRefs.some(ref=>ref.id===row.targetId&&ref.version===row.targetVersion)).map(row=>{
      const selection=selected.get(row.key),asset=workspace.assets.find(asset=>asset.id===selection?.assetId);
      // Character/scene references have no image dependencies of their own, so
      // this state check cannot recurse through the shot dependency graph.
      const state=asset&&['character','scene'].includes(asset.role)?this.assetState(asset,workspace,source):null;
      return asset ? {role:row.role,targetId:row.targetId,targetVersion:row.targetVersion,assetId:asset.id,sha256:asset.sha256,targetHash:asset.targetHash,currentTargetHash:row.targetHash,fileStatus:state?.fileStatus??'invalid_record',actualSha256:state?.actualSha256??null,reviewId:state?.review?.id??null,reviewVerdict:state?.review?.verdict??null,reviewCurrent:state?.reviewCurrent??false,eligible:Boolean(asset.role===row.role&&asset.targetId===row.targetId&&asset.targetVersion===row.targetVersion&&state?.selected&&!state.stale&&state.reviewCurrent&&state.review?.verdict==='accepted')} : {role:row.role,targetId:row.targetId,targetVersion:row.targetVersion,assetId:null};
    });
  }
  binding(workspace,target,source) { const references=this.references(workspace,target,source); return {sourceVersion:source.sourceVersion,sourceHash:source.sourceHash,targetHash:target.targetHash,references,referenceHash:creativeHash(references),knowledgeHash:source.knowledge.hash}; }
  snapshot(source,target) { return copy({project:generationInput(source.project),creativeBrief:source.project.creativeBrief,sourceVersion:source.sourceVersion,sourceHash:source.sourceHash,role:target.role,targetId:target.targetId,targetVersion:target.targetVersion,shot:target.shot??null,entity:target.entity??null,entityRefs:target.entityRefs,entities:source.entities.filter(entity=>target.entityRefs.some(ref=>ref.id===entity.id&&ref.version===entity.version)),parentScript:source.parent,requirements:source.workspace.instructions,stylePresetId:source.workspace.stylePresetId,manualRuleIds:source.workspace.manualRuleIds,locks:source.workspace.locks,knowledgeHash:source.knowledge.hash,entityProvenance:source.entityProvenance}); }
  integrity(id,asset) {
    if(!validId(asset.id)||!['png','jpg','webp'].includes(asset.extension)||asset.storedName!==`${asset.id}.${asset.extension}`)return{status:'invalid_record',actualSha256:null};
    const file=path.join(this.store.root,'image-files',id,asset.storedName);
    try{const actualSha256=digest(fs.readFileSync(file));return{status:actualSha256===asset.sha256?'intact':'hash_changed',actualSha256};}
    catch{return{status:'missing',actualSha256:null};}
  }
  assetState(asset,workspace,source) {
    const target=source.targets.find(target=>target.key===asset.key),binding=target?this.binding(workspace,target,source):null;
    const integrity=this.integrity(source.project.id,asset);
    const stale=!target || !target.ready || asset.targetVersion!==target.targetVersion || asset.targetHash!==binding.targetHash || asset.referenceHash!==binding.referenceHash;
    const fileMissing=integrity.status==='missing',fileChanged=!['intact','missing'].includes(integrity.status);
    const review=[...workspace.reviews].reverse().find(review=>review.assetId===asset.id);
    const currentReview=review&&review.targetHash===binding?.targetHash&&review.referenceHash===binding?.referenceHash;
    const selected=this.active(workspace).get(asset.key)?.assetId===asset.id;
    const state=stale||fileMissing||fileChanged?'needs_review':review?.verdict==='rejected'&&currentReview?'rejected':selected&&currentReview&&review.verdict==='accepted'?'selected':currentReview&&review.verdict==='accepted'?'checked':'pending_check';
    return {...asset,stale:stale||fileMissing||fileChanged,fileMissing,fileChanged,fileStatus:integrity.status,actualSha256:integrity.actualSha256,state,selected,review:review??null,reviewCurrent:Boolean(currentReview),url:`/api/projects/${source.project.id}/image-assets/${asset.id}`,sourceDeclarationStatus:asset.generation?(asset.generation.testFixture?'isolated_fixture':'service_receipt'):'user_declared',visualStatus:currentReview?review.verdict:'not_checked'};
  }
  view(id) {
    const workspace=this.get(id); let source,error=null;
    try{source=this.source(id);}catch(cause){error=cause.message;source={project:this.store.read('projects',id),targets:[],saved:false,sourceVersion:null,sourceHash:null,knowledge:{hash:null},entityProvenance:null};}
    const assets=workspace.assets.map(asset=>this.assetState(asset,workspace,source));
    const activeSelections=[...this.active(workspace).values()].map(selection=>({...selection,asset:assets.find(asset=>asset.id===selection.assetId)??null}));
    const packets=workspace.packets.map(packet=>{try{this.validatePacket(id,workspace,source,packet,false);return{...packet,stale:false,executable:true,packetStatus:'ready',validationError:null};}catch(cause){return{...packet,stale:true,executable:false,packetStatus:'needs_review',validationError:cause.message};}});
    return {...workspace,packets,project:source.project,targets:source.targets.map(target=>({...target,state:activeSelections.find(row=>row.key===target.key)?.asset?.state??(assets.some(asset=>asset.key===target.key)?'imported':'pending_production'),references:this.references(workspace,target,source)})),assets,activeSelections,sourceVersion:source.sourceVersion,sourceHash:source.sourceHash,entityProvenance:source.entityProvenance,sourceError:error,hasSavedStoryboard:source.saved,capability:{mode:'manual',automaticImageGeneration:'not_connected',costStatus:'unknown',costLabel:'费用待确认',message:'手工导出并在ChatGPT官网出图，再导入实际文件；订阅或登录不代表自动图像API已接通。'},formalStageStatus:'not_checked',mediaStatus:assets.length?'imported_not_formally_verified':'not_generated'};
  }
  import(id,metadata,bytes,generatedEvidence=null) {
    const workspace=this.get(id);this.check(workspace,metadata.revision);
    if(workspace.assets.length>=1000)throw new AppError('本项目已保存1000张图片，请先备份整理。');
    const packet=metadata.packetId?workspace.packets.find(packet=>packet.id===metadata.packetId):null;
    let source;try{source=this.source(id);}catch(cause){if(!generatedEvidence||!packet)throw cause;source=null;}
    const target=source?.targets.find(target=>target.role===metadata.role&&target.targetId===metadata.targetId)??(generatedEvidence&&packet?{role:'shot',targetId:packet.shotId,targetVersion:packet.targetVersion,key:keyFor('shot',packet.shotId),entityRefs:packet.entityRefs}:null);
    if(!target)throw new AppError('请先保存分镜并选择真实人物、场景或镜头目标。',409);
    const declaration=metadata.source;
    if(!declaration||!['test','user-upload','chatgpt-web','other',...(generatedEvidence?['codex-cli']:[])].includes(declaration.kind)||!safeText(declaration.description,'来源说明').trim())throw new AppError('请提供实际来源说明，并明确测试素材或用户声明平台。');
    const filename=safeText(metadata.filename??'图片','文件名',240).replace(/[\\/\x00-\x1f]/g,'_');
    const info=inspectImage(bytes),idAsset=randomUUID(),storedName=`${idAsset}.${info.extension}`,directory=path.join(this.store.root,'image-files',id);
    fs.mkdirSync(directory,{recursive:true});
    if(metadata.packetId&&(!packet||target.role!=='shot'||packet.shotId!==target.targetId))throw new AppError('所选出图任务包不属于当前项目与镜头。',409);
    const binding=packet?copy(packet.binding):this.binding(workspace,target,source),inputSnapshot=packet?copy(packet.sourceSnapshot):this.snapshot(source,target),asset={id:idAsset,key:target.key,role:target.role,targetId:target.targetId,targetVersion:packet?.targetVersion??target.targetVersion,version:workspace.assets.filter(asset=>asset.key===target.key).length+1,filename,storedName,...info,size:bytes.length,sha256:digest(bytes),source:{kind:declaration.kind,description:declaration.description},...binding,packetId:packet?.id??null,modelInputVerification:generatedEvidence?(generatedEvidence.testFixture?'isolated_fixture_not_real_generation':'official_cli_attachments_and_completion_evidence'):packet?'bound_to_exported_packet_user_declared':'not_verified_manual_current_binding',generation:generatedEvidence?copy(generatedEvidence):null,inputSnapshot,inputSnapshotHash:creativeHash(inputSnapshot),entityRefs:copy(packet?.entityRefs??target.entityRefs),entityProvenance:copy(packet?.entityProvenance??source?.entityProvenance??null),createdAt:now()};
    fs.writeFileSync(path.join(directory,storedName),bytes,{flag:'wx'});
    // Binary written once; failed metadata saves leave a recoverable orphan, never delete originals.
    this.save({...workspace,assets:[...workspace.assets,asset]});return this.view(id);
  }
  file(id,assetId) {
    if(!validId(assetId))throw new AppError('图片ID不正确。');
    const asset=this.get(id).assets.find(asset=>asset.id===assetId);
    if(!asset||asset.storedName!==`${asset.id}.${asset.extension}`||!['png','jpg','webp'].includes(asset.extension))throw new AppError('图片不存在。',404);
    const file=path.join(this.store.root,'image-files',id,asset.storedName);
    if(!fs.existsSync(file))throw new AppError('原图文件丢失，元数据和选用历史已保留。',404);
    const bytes=fs.readFileSync(file);
    if(digest(bytes)!==asset.sha256)throw new AppError('原图文件Hash已改变，停止预览/选用；元数据和原记录已保留。',409);
    return {path:file,mimeType:asset.mimeType,name:asset.filename,size:asset.size,bytes};
  }
  review(id,{revision,assetId,verdict,notes=''}) {
    const workspace=this.get(id);this.check(workspace,revision);
    if(!['accepted','rejected'].includes(verdict))throw new AppError('人工检查结论不正确。');
    const source=this.source(id),asset=workspace.assets.find(asset=>asset.id===assetId);
    if(!asset)throw new AppError('图片不存在。',404);
    const state=this.assetState(asset,workspace,source);
    if(state.stale)throw new AppError('输入或参考素材已变化，旧图片保留供参考；请基于当前版本重新导入。',409);
    this.file(id,assetId);
    const target=source.targets.find(target=>target.key===asset.key),binding=this.binding(workspace,target,source);
    const record={id:randomUUID(),assetId,verdict,notes:safeText(notes,'人工检查说明'),targetHash:binding.targetHash,referenceHash:binding.referenceHash,createdAt:now()};
    this.save({...workspace,reviews:[...workspace.reviews,record]});return this.view(id);
  }
  select(id,{revision,assetId}) {
    const workspace=this.get(id);this.check(workspace,revision);
    const source=this.source(id),asset=workspace.assets.find(asset=>asset.id===assetId);
    if(!asset)throw new AppError('图片不存在。',404);
    const state=this.assetState(asset,workspace,source);
    if(state.stale||!state.reviewCurrent||state.review?.verdict!=='accepted')throw new AppError('需先核对当前输入并人工检查通过，才可选用图片。旧图和历史仍保留。',409);
    this.file(id,assetId);
    const previous=this.active(workspace).get(asset.key);
    if(previous?.assetId===assetId)return this.view(id);
    const record={id:randomUUID(),key:asset.key,role:asset.role,targetId:asset.targetId,targetVersion:asset.targetVersion,assetId,previousAssetId:previous?.assetId??null,targetHash:asset.targetHash,referenceHash:asset.referenceHash,createdAt:now()};
    this.save({...workspace,selectionHistory:[...workspace.selectionHistory,record]});return this.view(id);
  }
  importGenerated(id,{packetId,bytes,filename='codex-generated.png',provenance}) {
    const workspace=this.get(id),packet=workspace.packets.find(packet=>packet.id===packetId);
    if(!packet)throw new AppError('原出图任务包不存在，不能给回图补造当前绑定。',404);
    if(!packet.sourceSnapshotHash||creativeHash(packet.sourceSnapshot)!==packet.sourceSnapshotHash)throw new AppError('原任务包输入快照绑定损坏，回图文件须留在任务回执中，不能重绑当前输入。',409);
    if(!provenance||!validId(provenance.taskId)||typeof provenance.provider!=='string'||!provenance.provider.trim()||typeof provenance.threadId!=='string'||!provenance.threadId.trim()||typeof provenance.callId!=='string'||!provenance.callId.trim()||!provenance.completionEvidence||typeof provenance.completionEvidence!=='object'||Array.isArray(provenance.completionEvidence)||JSON.stringify(provenance).length>100000)throw new AppError('自动回图缺少可追溯的任务、会话、工具调用或完成证据。',409);
    const proof=provenance.completionEvidence,event=proof.officialImageEvent,info=inspectImage(bytes);
    const expectedImages=(packet.references??[]).map(ref=>ref.sha256).sort(),actualImages=(Array.isArray(event?.inputImages)?event.inputImages:[]).map(image=>image?.sha256).sort();
    if(proof.completedTurn!==true||proof.exitCode!==0||proof.decoded?.decoded!==true||proof.decoded.width!==info.width||proof.decoded.height!==info.height||event?.status!=='completed'||proof.threadId!==provenance.threadId||(event.generationId||event.id)!==provenance.callId||proof.sha256!==digest(bytes)||proof.attachmentsVerified!==true||proof.runnerMode!==(provenance.testFixture?'isolated-fixture':'official-codex-account')||JSON.stringify(expectedImages)!==JSON.stringify(actualImages))throw new AppError('自动回图的真实完成、解码、附件或产物Hash证据不完整，未作为生成成功候选导入。',409);
    const existing=workspace.assets.find(asset=>asset.generation?.taskId===provenance.taskId);
    if(existing){if(existing.packetId!==packetId||existing.sha256!==digest(bytes))throw new AppError('此执行尝试已有不同产物，原候选保留，禁止重复导入覆盖。',409);this.file(id,existing.id);return this.view(id);}
    return this.import(id,{revision:workspace.revision,role:'shot',targetId:packet.shotId,packetId,filename,source:{kind:provenance.testFixture?'test':'codex-cli',description:provenance.testFixture?'隔离自动出图软件夹具；不是实际模型产物。':'本机官方Codex账号图像工具完成，实际附件、图片文件与原始调用证据由服务端保存；尚待人工检查。'}},bytes,provenance);
  }
  validatePacket(id,workspace,source,packet,withFiles=true) {
    if(!packet||packet.projectId!==id)throw new AppError('出图任务包不存在或不属于当前项目。',404);
    const target=source.targets.find(target=>target.role==='shot'&&target.targetId===packet.shotId);
    if(!target?.ready||source.sourceStale)throw new AppError('来源分镜已过期或当前目标不可执行，旧任务包需复核；请重新保存有效分镜并准备任务。',409);
    const binding=this.binding(workspace,target,source);
    if(packet.targetVersion!==target.targetVersion||packet.prompt!==target.prompt||creativeHash(packet.binding)!==creativeHash(binding))throw new AppError('任务包输入、参考版本或审核状态已改变，旧记录保留；请重新导出当前任务包。',409);
    if(!packet.sourceSnapshotHash||creativeHash(packet.sourceSnapshot)!==packet.sourceSnapshotHash)throw new AppError('任务包原输入快照缺少有效Hash，不能作为可执行包；原记录已保留。',409);
    for(const ref of binding.references.filter(ref=>ref.assetId))if(!ref.eligible||ref.reviewVerdict!=='accepted'||!ref.reviewCurrent||ref.fileStatus!=='intact'||ref.sha256!==ref.actualSha256)throw new AppError('所选参考图审核被拒绝、已失效或文件Hash改变，任务包需复核。',409);
    const references=(packet.references??[]).map(ref=>{
      const current=binding.references.find(item=>item.assetId===ref.id&&item.targetId===ref.entityId&&item.targetVersion===ref.entityVersion);
      if(!current?.eligible||current.reviewId!==ref.reviewId||current.sha256!==ref.sha256)throw new AppError('实际附件的当前审核或版本与原任务包不一致。',409);
      const file=this.file(id,ref.id);
      if(digest(file.bytes)!==ref.sha256)throw new AppError('实际参考图Hash不匹配。',409);
      return withFiles?{...copy(ref),file}:copy(ref);
    });
    return {workspace,source,target,packet,references};
  }
  assertExecutablePacket(id,packetId) {
    const workspace=this.get(id),packet=workspace.packets.find(packet=>packet.id===packetId);
    if(!packet)throw new AppError('出图任务包不存在。',404);
    let source;try{source=this.source(id);}catch{throw new AppError('当前来源分镜无法编译，旧任务包需复核。',409);}
    return this.validatePacket(id,workspace,source,packet);
  }
  prepare(id,{revision,shotId,referenceAssetIds}) {
    const workspace=this.get(id);this.check(workspace,revision);
    const source=this.source(id),target=source.targets.find(target=>target.role==='shot'&&target.targetId===shotId);
    if(!target?.ready)throw new AppError('当前镜头未保存或输入有冲突，不能准备出图任务。',409);
    const refs=this.references(workspace,target,source),ids=referenceAssetIds??refs.filter(ref=>ref.assetId).map(ref=>ref.assetId);
    if(refs.some(ref=>ref.assetId&&!ref.eligible))throw new AppError('当前选用参考图审核被拒绝、审核失效或文件/版本改变，请先重新检查并选用有效参考。',409);
    if(!Array.isArray(ids)||ids.length>30||new Set(ids).size!==ids.length)throw new AppError('参考图片ID列表不正确。');
    const materials=ids.map(idAsset=>{
      const asset=workspace.assets.find(asset=>asset.id===idAsset);
      if(!asset||!refs.some(ref=>ref.assetId===asset.id))throw new AppError('参考图必须是当前镜头所引用人物或场景的已选用图片。',409);
      const state=this.assetState(asset,workspace,source);
      if(state.stale||state.review?.verdict!=='accepted'||!state.reviewCurrent)throw new AppError('参考图已过期或尚未人工检查通过。',409);
      this.file(id,asset.id);return {id:asset.id,entityId:asset.targetId,entityVersion:asset.targetVersion,sha256:asset.sha256,reviewId:state.review.id,filename:`references/${asset.id}.${asset.extension}`,mimeType:asset.mimeType,width:asset.width,height:asset.height,source:copy(asset.source),includedInBundle:true,attached:false,attachmentState:'included_in_export_not_sent',downloadUrl:`/api/projects/${id}/image-assets/${asset.id}`};
    });
    if(materials.reduce((total,material)=>total+workspace.assets.find(asset=>asset.id===material.id).size,0)>64*1024*1024)throw new AppError('单个出图包的实际参考图片总大小须不超过64MB，请减少本次附件。');
    const packet={id:randomUUID(),projectId:id,shotId,targetVersion:target.targetVersion,mode:'chatgpt_manual',prompt:target.prompt,rules:copy(target.rules),entityRefs:copy(target.entityRefs),entityProvenance:copy(source.entityProvenance),binding:this.binding(workspace,target,source),sourceSnapshot:this.snapshot(source,target),references:materials,referenceManifest:refs.map(ref=>({...ref,attached:false,includedInBundle:materials.some(material=>material.id===ref.assetId),status:materials.some(material=>material.id===ref.assetId)?'included_in_export_not_sent':'reference_only'})),costStatus:'unknown',costLabel:'费用待确认',submitted:false,formalStageStatus:'not_checked',mediaStatus:'not_generated',createdAt:now(),instructions:'下载ZIP并在ChatGPT官网手工上传其中references内实际图片与prompt.txt。JSON或ZIP导出不表示已发送给模型；仅引用的素材不在包内。检查官网费用及额度后再决定生成；返回工作台导入真实图片。'};
    packet.sourceSnapshotHash=creativeHash(packet.sourceSnapshot);
    this.save({...workspace,packets:[...workspace.packets,packet]});return packet;
  }
  bundle(id,packetId) {
    const {packet,references}=this.assertExecutablePacket(id,packetId);
    const files=[{name:'manifest.json',bytes:Buffer.from(JSON.stringify(packet,null,2))},{name:'prompt.txt',bytes:Buffer.from(packet.prompt+'\n\n'+packet.instructions)}];
    for(const ref of references)files.push({name:ref.filename,bytes:ref.file.bytes});
    return {bytes:buildImageZip(files),name:`AI-Drama-Studio-${packet.shotId}-${packet.id}.zip`,mimeType:'application/zip'};
  }
}
