import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError, now, validId } from './store.mjs';
import { creativeHash, seedToShot } from './creative-store.mjs';
import { validateCreativeScript } from './creative-jobs.mjs';
import { entityFactsHash, provenanceBase, assessEntityProvenance, mergeEntityProvenance } from './entity-provenance.mjs';
import { redact } from './tools.mjs';

const clone = value => structuredClone(value);
const busy = new Set(['queued','generating','checking']);
const terminal = new Set(['succeeded','failed','cancelled','interrupted']);
const requireBody = body => { if(typeof body!=='string'||body.length>100000)throw new AppError('剧本须为不超过100000字的完整正文。');return body; };

// A proposal may correct an entity only as a new, explicitly AI-sourced
// revision. Original IDs, types, facts, evidence and all old versions survive.
export function validateAssistantScript(value, context) {
  const originals=context.workspace.entities??[],changed=[];
  for(const next of value?.entities??[]){
    const historical=(context.workspace.versions??[]).flatMap(version=>version.data?.entities??[]).find(entity=>entity.id===next.id&&entity.version===next.version&&entityFactsHash(entity)!==entityFactsHash(next));
    if(historical)throw new AppError(`实体${next.id}的${next.version}已绑定不同历史事实，请使用新的版本标识，不能重写旧版本。`);
  }
  for(const original of originals){
    const next=value?.entities?.find(item=>item.id===original.id);
    if(!next||next.type!==original.type)throw new AppError(`不能删除或改变实体${original.id}的稳定ID及类型。`);
    if(entityFactsHash(next)!==entityFactsHash(original)){
      if(next.version===original.version||next.source!=='ai'||!value.addedSettings?.some(text=>text.includes(next.description)))throw new AppError(`实体${original.id}修订须升版本、明确AI建议及补充说明，不能冒充原用户事实。`);
      changed.push({id:original.id,before:clone(original),after:clone(next),origin:'ai-proposal',requiresHumanApplication:true});
    }
  }
  const result=validateCreativeScript(value,{...context,workspace:{...context.workspace,entities:originals.filter(item=>!changed.some(change=>change.id===item.id))}});
  return {...result,entityChanges:changed};
}

export class ScriptWorkbench {
  constructor(store,{creative,pollIntervalMs=300}={}){
    this.store=store;this.creative=creative;this.workspace=creative.workspace;this.closed=false;this.timers=new Map();this.pollIntervalMs=pollIntervalMs;
    fs.mkdirSync(path.join(store.root,'script-generations'),{recursive:true});
    for(const generation of store.list('script-generations').values)if(busy.has(generation.status)){generation.status='interrupted';generation.error='服务已重启，原文字任务保留；未自动重新创作或检查。';this.record(generation);}
  }
  guard(id,workspace=this.workspace.get(id)){
    const context=this.workspace.context(id,'script',{},workspace);
    return creativeHash({source:context.sourceHash,knowledge:context.knowledge.hash,episodeId:workspace.episodeId,instructions:workspace.instructions,shotCount:workspace.shotCount,locks:workspace.locks,entities:workspace.entities,entityInputEvidence:workspace.entityInputEvidence??{},stylePresetId:workspace.stylePresetId,manualRuleIds:workspace.manualRuleIds,shots:workspace.shots});
  }
  editor(id,workspace=this.workspace.get(id)){
    const active=workspace.versions.find(item=>item.id===workspace.activeScriptId),selected=workspace.selectedScriptTaskId?this.workspace.scriptTask(id,workspace.selectedScriptTaskId):null;
    const awaitingPublication=this.store.list('script-generations').values.some(item=>item.projectId===id&&busy.has(item.status)&&!item.publishedEditor);
    const newest=!active&&!workspace.scriptDraft&&!selected&&!awaitingPublication?this.store.list('creative-jobs').values.find(job=>job.projectId===id&&job.kind==='script'&&job.status==='succeeded'&&this.workspace.fresh(job)):null;
    const fallback={revision:0,body:workspace.scriptDraft||active?.body||selected?.result?.body||newest?.result?.body||'',sourceTaskId:selected?.id??newest?.id??null,baseVersionId:active?.id??null,updatedAt:workspace.updatedAt,requirementsHash:this.guard(id,workspace)};
    const editor=clone(workspace.scriptEditor??fallback),stale=editor.requirementsHash!==this.guard(id,workspace)||!workspace.scriptEditor&&editor.sourceTaskId&&!this.workspace.fresh(this.workspace.scriptTask(id,editor.sourceTaskId));
    return {...editor,workspaceRevision:workspace.revision,bodyHash:creativeHash(editor.body),stale,staleReason:stale?'创作要求、项目或分镜输入已变化，请检查旧稿后明确确认；原文与来源保留。':null};
  }
  view(id){
    const workspace=this.creative.view(id),editor=this.editor(id),generation=this.store.list('script-generations').values.find(item=>item.projectId===id)??null;
    return {workspace,editor,generation,usageNote:'生成剧本包含至多一次新会话独立检查，最多两次Codex文字任务；使用已有账号用量，人民币和积分费用未返回，不代表免费。'};
  }
  check(id,input,workspace=this.workspace.get(id)){
    this.workspace.check(workspace,input.workspaceRevision);
    const project=this.store.read('projects',id);if(project.revision!==input.projectRevision)throw new AppError('故事立项已改变，请刷新核对；当前文字没有覆盖磁盘稿。',409);
    const editor=this.editor(id,workspace);if(input.editorRevision!==editor.revision)throw new AppError('剧本已在另一窗口编辑，请核对版本；本页文字仍保留。',409);
    return {workspace,project,editor};
  }
  archive(workspace,editor){
    const history=workspace.scriptEditorHistory??[];
    if(history.length>=500)throw new AppError('已有500条草稿快照，请先备份整理；不会删除旧稿。');
    return editor.body?[...history,{...clone(editor),archivedAt:now()}]:history;
  }
  source(id,editor,workspace){
    if(editor.sourceTaskId){
      const job=this.workspace.scriptTask(id,editor.sourceTaskId);
      if(creativeHash(job.inputSnapshot)!==job.inputHash)throw new AppError('候选原输入损坏，禁止采用或重建来源。',409);
      const provenance=this.workspace.taskEntityProvenance(job);if(provenance.entries.some(row=>row.bindingValid===false))throw new AppError('候选来源证据绑定损坏，不能采用。',409);
      if(editor.sourceResultHash&&creativeHash(job.result)!==editor.sourceResultHash)throw new AppError('原候选正文或结构已改变，禁止采用。',409);
      return {data:clone(job.result),bases:job.entityProvenance?[provenanceBase(job.result,job.inputSnapshot,provenance,job.inputHash)]:[],taskId:job.id};
    }
    const editorVersion=workspace.versions.find(item=>item.id===editor.baseVersionId&&item.kind==='script');
    if(editorVersion&&editor.baseVersionHash&&creativeHash(editorVersion)!==editor.baseVersionHash)throw new AppError('原版本内容已改变，请检查历史记录，禁止覆盖当前稿。',409);
    if(editorVersion)return {data:clone(editorVersion.data??{body:editorVersion.body,entities:workspace.entities,shotSeeds:[],addedSettings:[]}),bases:clone(editorVersion.entityProvenanceBases??[]),taskId:editorVersion.sourceTaskId??null};
    const parent=this.workspace.parentScript(id,workspace);
    if(parent)return {data:clone(parent.data??{body:parent.body,entities:workspace.entities,shotSeeds:[],addedSettings:[]}),bases:clone(this.workspace.parentSourceBases(id,parent)),taskId:null};
    return {data:{body:editor.body,entities:clone(workspace.entities),shotSeeds:clone(workspace.shots),addedSettings:[]},bases:[this.workspace.manualSourceBase(workspace)],taskId:null};
  }
  saveEditor(id,input){
    const {workspace,editor}=this.check(id,input),body=requireBody(input.body);
    if(body===editor.body&&workspace.scriptDraft===body)return this.view(id);
    const nextEditor={...editor,revision:editor.revision+1,body,updatedAt:now()};delete nextEditor.stale;delete nextEditor.staleReason;delete nextEditor.workspaceRevision;
    this.workspace.save({...workspace,scriptDraft:body,scriptEditor:nextEditor,scriptEditorHistory:this.archive(workspace,editor)});
    return this.view(id);
  }
  confirm(id,input){return this.commit(id,input,{activate:true,origin:'user'});}
  checkScript(id,input){
    const saved=this.commit(id,input,{activate:false,origin:'user'});
    const review=this.creative.start(id,{kind:'review',revision:saved.workspace.revision,projectRevision:saved.workspace.project.revision,targetVersionId:saved.version.id,bindEditorBody:true});
    return {...this.view(id),version:saved.version,reviewTaskId:review.id};
  }
  applyAssistant(id,input){
    const workspace=this.workspace.get(id),existing=workspace.versions.find(item=>item.assistantTurnId===input.assistantTurnId);
    if(existing)return {...this.view(id),version:clone(existing),alreadyApplied:true};
    if(!validId(input.assistantTurnId))throw new AppError('助手修改标识无效。');
    const editor=this.editor(id,workspace);if(input.beforeBody!==editor.body)throw new AppError('建议针对的原正文已改变，请重新讨论；旧建议保留。',409);
    return this.commit(id,input,{activate:false,origin:'ai-assistant',assistantTurnId:input.assistantTurnId,structuredCandidate:input.structuredCandidate});
  }
  validateAssistantData(id,value,context=null){
    if(context)return validateAssistantScript(value,context);
    const current=this.workspace.context(id,'script'),editor=this.editor(id,current.workspace),source=this.source(id,editor,current.workspace);
    const entities=[...new Map([...(source.data.entities??[]),...current.workspace.entities].map(entity=>[entity.id,entity])).values()];
    return validateAssistantScript(value,{...current,workspace:{...current.workspace,entities}});
  }
  commit(id,input,{activate,origin,assistantTurnId=null,structuredCandidate=null}){
    const {workspace,project,editor}=this.check(id,input),body=requireBody(input.body);if(!body.trim())throw new AppError('请先生成或填写剧本正文。');
    if(editor.stale&&input.acknowledgeStale!==true)throw new AppError('上游输入已改变。请先复核旧稿，再明确确认当前人工版本。',409);
    if(workspace.versions.length>=500)throw new AppError('已有500个不可变版本，请先备份整理。');
    const source=this.source(id,editor,workspace);let data={...source.data,body},bases=source.bases,entityChanges=[];
    if(structuredCandidate){
      if(structuredCandidate.body!==body)throw new AppError('结构化建议与应用后的完整正文不一致。',409);
      const context=this.workspace.context(id,'script');data=this.validateAssistantData(id,structuredCandidate);entityChanges=data.entityChanges??[];
      bases=[...bases,provenanceBase(data,context.snapshot,assessEntityProvenance(data,context.snapshot))];
    }
    const current=workspace.versions.find(item=>item.id===workspace.activeScriptId);
    if(activate&&current&&current.body===body&&!this.creative.view(id).versions.find(item=>item.id===current.id)?.stale&&editor.sourceTaskId===null&&creativeHash(current.data?.entities??[])===creativeHash(data.entities??[]))return {...this.view(id),version:clone(current),reusedVersion:true};
    const next={...workspace,scriptDraft:body,selectedScriptTaskId:activate?null:workspace.selectedScriptTaskId};
    // Candidate structure is internal, but old unversioned shot edits must not
    // disappear when the user explicitly confirms a new narrative source.
    const pendingVersion=workspace.versions.find(item=>item.id===editor.baseVersionId&&item.awaitingConfirmation&&item.id!==workspace.activeScriptId);
    if(activate&&(editor.sourceTaskId||pendingVersion)&&data.shotSeeds?.length){next.scriptTransitions=[...(workspace.scriptTransitions??[]),{at:now(),activeScriptId:workspace.activeScriptId,activeStoryboardId:workspace.activeStoryboardId,shots:clone(workspace.shots),scriptDraft:workspace.scriptDraft}];next.shots=data.shotSeeds.map(seedToShot);}
    if(entityChanges.length)next.entities=next.entities.map(entity=>clone(entityChanges.find(change=>change.id===entity.id)?.after??entity));
    const context=this.workspace.context(id,'script',{},next),provenance=mergeEntityProvenance(data.entities??[],[...bases,this.workspace.manualSourceBase(next)]);
    if(activate&&provenance.pendingCount&&input.confirmPendingSources!==true)throw new AppError('部分设定来源待确认；请明确确认保留待确认状态，不提升为用户事实。',409);
    const version={id:randomUUID(),kind:'script',body,data:clone(data),origin,taskId:null,sourceTaskId:source.taskId,assistantTurnId,parentVersionId:workspace.activeScriptId,parentSource:editor.sourceTaskId?{id:editor.sourceTaskId,type:'task'}:editor.baseVersionId?{id:editor.baseVersionId,type:'version'}:null,entityProvenanceBases:bases,entityChanges,references:{},createdAt:now(),sourceHash:context.sourceHash,inputHash:context.inputHash,knowledgeHash:context.knowledge.hash,pendingSourcesAcknowledged:provenance.pendingCount?{at:now(),remainsPending:true}:null,awaitingConfirmation:!activate};
    next.versions=[...workspace.versions,version];if(activate)next.activeScriptId=version.id;
    next.scriptEditor={revision:editor.revision+1,body,sourceTaskId:null,baseVersionId:version.id,baseVersionHash:creativeHash(version),updatedAt:now(),requirementsHash:this.guard(id,next),awaitingConfirmation:!activate};
    next.scriptEditorHistory=this.archive(workspace,editor);
    // Exactly one workspace write: complete body + origin + immutable version
    // and source pointer. Its .bak remains the pre-confirm manual document.
    this.workspace.save(next);return {...this.view(id),version:clone(version)};
  }
  record(generation){generation.updatedAt=now();this.store.write('script-generations',generation);return generation;}
  start(id,input){
    if(this.closed)throw new AppError('服务正在关闭。',503);
    if(!validId(input.requestId))throw new AppError('缺少稳定requestId，请刷新后重试。');
    const requestHash=creativeHash({revision:input.revision,projectRevision:input.projectRevision,includeReview:input.includeReview!==false,retry:input.retry===true});
    const existing=this.store.list('script-generations').values.find(item=>item.projectId===id&&item.requestId===input.requestId);if(existing){if(existing.requestHash!==requestHash)throw new AppError('同一requestId不能绑定不同输入，请核对原任务。',409);return clone(existing);}
    const workspace=this.workspace.get(id),editor=this.editor(id,workspace),project=this.store.read('projects',id);this.workspace.check(workspace,input.revision);if(project.revision!==input.projectRevision)throw new AppError('故事立项已改变，请刷新。',409);
    if(this.store.list('script-generations').values.some(item=>item.projectId===id&&busy.has(item.status)))throw new AppError('本项目剧本创作或检查仍在进行，请等待原任务。',409);
    const generation={id:randomUUID(),requestId:input.requestId,requestHash,projectId:id,status:'queued',createdAt:now(),updatedAt:now(),workspaceRevision:workspace.revision,projectRevision:project.revision,editorRevision:editor.revision,requirementsHash:this.guard(id,workspace),includeReview:input.includeReview!==false,scriptTaskId:null,reviewTaskId:null,reviewAttempted:false,publishedEditor:false,error:null,formalStageStatus:'not_checked',accountUsageNote:'一次创作，至多一次独立检查；现有Codex账号用量，人民币和积分未知。'};
    this.record(generation);
    try{const job=this.creative.start(id,{kind:'script',revision:workspace.revision,projectRevision:project.revision,retry:input.retry===true});generation.scriptTaskId=job.id;generation.status='generating';this.record(generation);this.schedule(generation.id);return clone(generation);}catch(error){generation.status='failed';generation.error=redact(error.message);this.record(generation);throw error;}
  }
  schedule(id){if(this.closed)return;this.timers.set(id,setTimeout(()=>{this.timers.delete(id);try{this.advance(id);}catch(error){const generation=this.store.read('script-generations',id);generation.status=generation.publishedEditor?'review_failed':'failed';generation.error=redact(error.message);this.record(generation);}},this.pollIntervalMs));}
  advance(id){
    if(this.closed)return;const generation=this.store.read('script-generations',id);if(!busy.has(generation.status))return;
    const task=this.store.read('creative-jobs',generation.scriptTaskId);
    if(!terminal.has(task.status)){this.schedule(id);return;}
    if(task.status!=='succeeded'){generation.status=task.status;generation.error=task.error??'剧本未完成，原稿保留。';this.record(generation);return;}
    if(!generation.publishedEditor){
      const workspace=this.workspace.get(generation.projectId),editor=this.editor(generation.projectId,workspace);
      if(workspace.revision!==generation.workspaceRevision||editor.revision!==generation.editorRevision||this.guard(generation.projectId,workspace)!==generation.requirementsHash)throw new AppError('生成期间输入或人工稿已改变。候选原文保留在历史，未覆盖当前稿。',409);
      this.workspace.validateCurrent(task,this.workspace.context(generation.projectId,'script',task.references));
      this.workspace.save({...workspace,scriptEditorHistory:this.archive(workspace,editor),scriptEditor:{revision:editor.revision+1,body:task.result.body,sourceTaskId:task.id,sourceResultHash:creativeHash(task.result),baseVersionId:workspace.activeScriptId,requirementsHash:generation.requirementsHash,updatedAt:now(),awaitingConfirmation:true}});
      generation.publishedEditor=true;this.record(generation);
    }
    if(generation.includeReview&&!generation.reviewAttempted){
      generation.reviewAttempted=true;generation.status='checking';this.record(generation);
      const workspace=this.workspace.get(generation.projectId),review=this.creative.start(generation.projectId,{kind:'review',revision:workspace.revision,projectRevision:this.store.read('projects',generation.projectId).revision,targetTaskId:task.id,bindEditorBody:true});generation.reviewTaskId=review.id;this.record(generation);
    }
    if(generation.reviewTaskId){const review=this.store.read('creative-jobs',generation.reviewTaskId);if(!terminal.has(review.status)){this.schedule(id);return;}if(review.status!=='succeeded'){generation.status='review_failed';generation.error=review.error??'独立检查未完成，候选正文保留，可人工检查。';this.record(generation);return;}}
    generation.status='succeeded';this.record(generation);
  }
  close(){this.closed=true;for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();for(const generation of this.store.list('script-generations').values)if(busy.has(generation.status)){generation.status='interrupted';generation.error='服务关闭，未自动重试；候选、旧稿和原检查保留。';this.record(generation);}}
}
