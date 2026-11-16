import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store, AppError } from '../src/store.mjs';
import { CreativeService, validateCreativeScript } from '../src/creative-jobs.mjs';
import { CreativeAssistantService, creativeAssistantSchema, validateAssistantResult } from '../src/creative-assistant.mjs';
import { ScriptWorkbench } from '../src/script-workbench.mjs';
import { fixtureIdea, fixtureEntities, fixtureScript, fixtureShots, isolatedRunner } from './creative-fixtures.mjs';

const artifacts=path.resolve('tests/.artifacts');fs.mkdirSync(artifacts,{recursive:true});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const discussion=(reply='【隔离软件测试】可以先保留结尾，再缩短铺垫；未实际核验史实。')=>({reply,proposal:{kind:'none',before:'',after:'',reason:'普通讨论不改正文',scriptData:null},cautions:['史实依据不足时应待核实；来源检查不是史实核验。']});
function fixture(t,options={}){
  const root=fs.mkdtempSync(path.join(artifacts,'assistant-')),store=new Store(root),creative=new CreativeService(store,{runner:isolatedRunner()}),calls=[];
  const project=store.create({name:'[TEST] 创作助手A',idea:fixtureIdea,durationSeconds:30});
  const second=store.create({name:'[TEST] 完全独立的项目B',idea:'B项目：月球守望者等待信号。',durationSeconds:30});
  creative.update(project.id,{revision:0,instructions:'保留温暖结尾，所有内容为非模型测试稿。',entities:fixtureEntities,scriptDraft:fixtureScript().body});
  creative.update(second.id,{revision:0,scriptDraft:'【TEST B独立正文】月球守望者等待信号。'});
  const editors=new Map([project,second].map(item=>[item.id,{revision:0,body:creative.workspace.get(item.id).scriptDraft,sourceTaskId:null,baseVersionId:null,stale:false}]));
  const applied=[];
  const scriptWorkbench={
    view(id){return{workspace:creative.view(id),editor:{...structuredClone(editors.get(id)),workspaceRevision:creative.workspace.get(id).revision}};},
    validateAssistantData(id,value,context){return validateCreativeScript(value,context);},
    applyAssistant(id,input){
      const ws=creative.workspace.get(id),editor=editors.get(id),p=store.read('projects',id);
      if(input.editorRevision!==editor.revision||input.workspaceRevision!==ws.revision||input.projectRevision!==p.revision||input.beforeBody!==editor.body)throw new AppError('测试CAS冲突',409);
      const previous=ws.versions.find(v=>v.assistantTurnId===input.assistantTurnId);if(previous)return{workspace:creative.view(id),editor:scriptWorkbench.view(id).editor,version:previous};
      const version={id:randomUUID(),kind:'script',body:input.body,origin:'ai-assistant',assistantTurnId:input.assistantTurnId,createdAt:new Date().toISOString(),references:{assistantTurnId:input.assistantTurnId}};
      creative.workspace.save({...ws,scriptDraft:input.body,versions:[...ws.versions,version],activeScriptId:version.id});
      editors.set(id,{...editor,revision:editor.revision+1,body:input.body,baseVersionId:version.id});applied.push(input);
      return{workspace:creative.view(id),editor:scriptWorkbench.view(id).editor,version};
    },
  };
  const runner=options.runner??(async input=>{calls.push(input);const threadId=`isolated-assistant-${calls.length}`;input.onEvent?.({type:'thread.started',threadId});input.onEvent?.({type:'turn.completed',usage:{input_tokens:0,output_tokens:0}});const result=options.result?options.result(input):discussion();return{exitCode:0,completed:true,threadId,usage:{input_tokens:0,output_tokens:0},finalMessage:JSON.stringify(result)};});
  const service=new CreativeAssistantService(store,{creative,scriptWorkbench,runner});
  t.after(()=>{service.close();creative.close();});
  return{root,store,creative,scriptWorkbench,service,project,second,calls,applied,editors,runner};
}
function input(ctx,id=ctx.project.id,extra={}){const p=ctx.store.read('projects',id),view=ctx.scriptWorkbench.view(id);return{requestId:randomUUID(),message:'保留结尾，调整前面的节奏。',stage:'script',workspaceRevision:view.workspace.revision,projectRevision:p.revision,editorRevision:view.editor.revision,editorBody:view.editor.body,selectedText:'',selectionStart:0,selectionEnd:0,...extra};}
async function finished(ctx,job){for(let n=0;n<150;n++){const value=ctx.service.read(job.projectId,job.id);if(!['queued','running'].includes(value.status))return value;await wait(5);}throw new Error('隔离助手任务未结束');}
function selectedProposal(snapshot,after='老人缓缓托起茶杯，让等待更有分量。'){return{reply:'【隔离测试建议】这里只修改所选段落，保留末尾。',proposal:{kind:'replace_selection',before:snapshot.selectedText,after,reason:'让动作更有气势，结尾保持原文。',scriptData:null},cautions:['此修改由AI提出，不改变原用户事实来源。']};}

test('助手用官方文字Schema，真实完成前不显示成功；普通讨论不写正文，项目历史隔离并可恢复',async t=>{
  const ctx=fixture(t),before=fs.readFileSync(ctx.store.file('creative-workspaces',ctx.project.id));
  assert.equal(creativeAssistantSchema.properties.proposal.properties.kind.enum.includes('replace_selection'),true);
  const first=await finished(ctx,ctx.service.start(ctx.project.id,input(ctx)));assert.equal(first.status,'succeeded',first.error);assert.equal(first.configurationStatus,'authenticated_call_completed');assert.equal(first.proposal.kind,'none');
  assert.deepEqual(fs.readFileSync(ctx.store.file('creative-workspaces',ctx.project.id)),before);assert.equal(ctx.applied.length,0);
  const second=await finished(ctx,ctx.service.start(ctx.project.id,input(ctx,ctx.project.id,{message:'请根据上一条继续解释。'})));assert.equal(second.conversationHistory.length,1);assert.equal(second.conversationHistory[0].reply,first.reply);assert.notEqual(second.threadId,first.threadId);
  assert.ok(ctx.calls[1].prompt.includes(first.reply));assert.ok(ctx.calls[1].prompt.includes(ctx.project.id));assert.ok(!ctx.calls[1].prompt.includes('月球守望者'));
  const other=await finished(ctx,ctx.service.start(ctx.second.id,input(ctx,ctx.second.id,{message:'请讨论B项目。'})));assert.equal(other.conversationHistory.length,0);assert.ok(!ctx.calls[2].prompt.includes(first.reply));assert.equal(other.snapshot.project.name,ctx.second.name);
  assert.throws(()=>ctx.service.read(ctx.second.id,first.id),error=>error.status===404);
  ctx.service.close();const restored=new CreativeAssistantService(ctx.store,{creative:ctx.creative,scriptWorkbench:ctx.scriptWorkbench,runner:ctx.runner});t.after(()=>restored.close());assert.equal(restored.view(ctx.project.id).messages.length,2);assert.equal(restored.view(ctx.second.id).messages.length,1);assert.equal(restored.view(ctx.project.id).messages[0].reply,first.reply);
});

test('上下文含当前项目/步骤/要求/版本/实际选择，仅显式应用所选修改并保存完整新版本',async t=>{
  const ctx=fixture(t,{result:options=>selectedProposal(JSON.parse(options.prompt.slice(options.prompt.indexOf('{\n'))).snapshot)});
  const original=ctx.editors.get(ctx.project.id).body,start=original.indexOf('0–10秒'),end=original.indexOf('\n10–20秒');
  const body=input(ctx,ctx.project.id,{stage:'script',selectedText:original.slice(start,end),selectionStart:start,selectionEnd:end,message:'把这一段写得更有气势。'});
  const job=await finished(ctx,ctx.service.start(ctx.project.id,body));assert.equal(job.status,'succeeded',job.error);assert.equal(job.snapshot.selectedText,body.selectedText);assert.equal(job.snapshot.instructions,'保留温暖结尾，所有内容为非模型测试稿。');assert.deepEqual(job.snapshot.entities,fixtureEntities);assert.equal(job.canApply,true);
  assert.equal(ctx.editors.get(ctx.project.id).body,original);assert.equal(ctx.applied.length,0);
  const applied=ctx.service.apply(ctx.project.id,job.id,body);assert.ok(applied.version.id);assert.equal(ctx.applied.length,1);assert.equal(applied.editor.body,original.slice(0,start)+job.proposal.after+original.slice(end));assert.ok(applied.editor.body.endsWith('只有老人出镜，温暖结尾。'));
  assert.equal(applied.turn.appliedVersionId,applied.version.id);assert.equal(ctx.service.apply(ctx.project.id,job.id,body).version.id,applied.version.id);assert.equal(ctx.applied.length,1);
  const saved=ctx.store.read('creative-assistant-turns',job.id);saved.appliedVersionId=null;saved.appliedAt=null;ctx.store.write('creative-assistant-turns',saved);
  assert.equal(ctx.service.apply(ctx.project.id,job.id,body).version.id,applied.version.id);assert.equal(ctx.applied.length,1,'工作台写入后marker丢失时只恢复原版本');
});

test('伪造选文、未保存正文、跨项目revision及非当前版本不能发送，不产生模型任务',t=>{
  const ctx=fixture(t),body=input(ctx);
  assert.throws(()=>ctx.service.start(ctx.project.id,{...body,selectedText:'伪造片段',selectionStart:0,selectionEnd:4}),error=>error.status===409);
  assert.throws(()=>ctx.service.start(ctx.project.id,{...body,editorBody:body.editorBody+'未保存'}),error=>error.status===409);
  assert.throws(()=>ctx.service.start(ctx.project.id,{...body,workspaceRevision:0}),error=>error.status===409);
  assert.throws(()=>ctx.service.start(ctx.second.id,body),error=>error.status===409);
  assert.equal(ctx.service.list(ctx.project.id).values.length,0);assert.equal(ctx.calls.length,0);
});

test('同一requestId去重，重复或并发消息不能隐式重试；参数变化不复用旧意图',async t=>{
  let release;const receipt=new Promise(resolve=>{release=resolve;});let calls=0;
  const ctx=fixture(t,{runner:async()=>{calls++;return receipt;}}),body=input(ctx);
  const first=ctx.service.start(ctx.project.id,body);assert.equal(ctx.service.start(ctx.project.id,body).id,first.id);
  assert.throws(()=>ctx.service.start(ctx.project.id,{...body,message:'改了要求'}),error=>error.status===409);
  assert.throws(()=>ctx.service.start(ctx.project.id,input(ctx)),error=>error.status===409);
  await wait(10);assert.equal(calls,1);release({exitCode:0,completed:true,threadId:'test-dedupe',finalMessage:JSON.stringify(discussion())});await finished(ctx,first);assert.equal(ctx.service.start(ctx.project.id,body).id,first.id);assert.equal(calls,1);
});

test('输入、知识绑定、正文或版本变化令建议需复核，旧结果与原稿保留',async t=>{
  const ctx=fixture(t,{result:options=>{const snapshot=JSON.parse(options.prompt.slice(options.prompt.indexOf('{\n'))).snapshot;return{reply:'【TEST】缩短铺垫。',proposal:{kind:'replace_script',before:snapshot.editorBody,after:snapshot.editorBody+'\n【TEST建议】节奏简化。',reason:'隔离改稿测试',scriptData:null},cautions:[]};}}),body=input(ctx),job=await finished(ctx,ctx.service.start(ctx.project.id,body));
  const original=ctx.editors.get(ctx.project.id).body,ws=ctx.creative.workspace.get(ctx.project.id);ctx.creative.update(ctx.project.id,{revision:ws.revision,instructions:'改为保留另一处锁定要求。'});
  const shown=ctx.service.read(ctx.project.id,job.id);assert.equal(shown.stale,true);assert.equal(shown.canApply,false);assert.throws(()=>ctx.service.apply(ctx.project.id,job.id,body),error=>error.status===409);assert.equal(ctx.editors.get(ctx.project.id).body,original);assert.equal(ctx.store.read('creative-assistant-turns',job.id).status,'succeeded');assert.equal(ctx.applied.length,0);
});

test('成功提案采用前重新核对快照与结果Hash，普通讨论不能伪造应用',async t=>{
  const ctx=fixture(t),body=input(ctx),discussionJob=await finished(ctx,ctx.service.start(ctx.project.id,body));assert.throws(()=>ctx.service.apply(ctx.project.id,discussionJob.id,body),error=>error.status===409);
  const saved=ctx.store.read('creative-assistant-turns',discussionJob.id);saved.snapshot.editorBody+='被改快照';ctx.store.write('creative-assistant-turns',saved);assert.equal(ctx.service.read(ctx.project.id,saved.id).stale,true);assert.equal(ctx.applied.length,0);
  const context={editorBody:'原文',selectedText:'原',selectionStart:0,selectionEnd:1};
  assert.throws(()=>validateAssistantResult({reply:'X',proposal:{kind:'replace_selection',before:'另一段',after:'新',reason:'改',scriptData:null},cautions:[]},context),/不一致/);
  assert.throws(()=>validateAssistantResult({reply:'X',proposal:{kind:'none',before:'',after:'偷偷替换',reason:'',scriptData:null},cautions:[]},context),/普通讨论/);
});

test('缺真实完成、无效输出及认证失败保留错误和raw，不显示成功或改动正文',async t=>{
  for(const receipt of [{exitCode:0,completed:false,finalMessage:JSON.stringify(discussion())},{exitCode:0,completed:true,finalMessage:'不是JSON'},{exitCode:1,completed:false,error:'待配置：Codex认证不可用。',finalMessage:''}]){
    const ctx=fixture(t,{runner:async()=>receipt}),original=ctx.editors.get(ctx.project.id).body,job=await finished(ctx,ctx.service.start(ctx.project.id,input(ctx)));
    assert.equal(job.status,'failed');assert.equal(job.reply,null);assert.equal(ctx.editors.get(ctx.project.id).body,original);assert.equal(fs.existsSync(path.join(ctx.root,job.rawResultPath,'receipt.json')),true);
    if(receipt.error)assert.equal(job.configurationStatus,'needs_configuration');
  }
});

test('取消、服务退出与迟到回执不重发、不提升成功，启动恢复保留中断状态',async t=>{
  let release;const receipt=new Promise(resolve=>{release=resolve;});let calls=0;const ctx=fixture(t,{runner:async()=>{calls++;return receipt;}}),body=input(ctx),job=ctx.service.start(ctx.project.id,body);await wait(10);
  const cancelled=ctx.service.cancel(ctx.project.id,job.id);assert.equal(cancelled.status,'cancelled');release({exitCode:0,completed:true,threadId:'late-isolated',finalMessage:JSON.stringify(discussion())});await wait(20);assert.equal(ctx.service.read(ctx.project.id,job.id).status,'cancelled');assert.equal(ctx.service.read(ctx.project.id,job.id).reply,null);assert.equal(fs.existsSync(path.join(ctx.root,'runtime','creative-assistant',job.id,'receipt.json')),true);assert.equal(calls,1);
  const stale={...ctx.store.read('creative-assistant-turns',job.id),id:randomUUID(),requestId:randomUUID(),status:'running',message:'服务退出前消息'};ctx.store.write('creative-assistant-turns',stale);ctx.service.close();
  const restored=new CreativeAssistantService(ctx.store,{creative:ctx.creative,scriptWorkbench:ctx.scriptWorkbench,runner:ctx.runner});t.after(()=>restored.close());assert.equal(restored.read(ctx.project.id,stale.id).status,'interrupted');assert.equal(calls,1);
});

test('结构化建议保留AI来源，正文和结构不一致或改动旧用户事实不得作为成功提案',async t=>{
  const ctx=fixture(t,{result:options=>{const snapshot=JSON.parse(options.prompt.slice(options.prompt.indexOf('{\n'))).snapshot,data={...fixtureScript(),entityEvidence:[]};data.body=snapshot.editorBody+'\n【AI补充】窗外余晖。';data.entities.push({id:'PROP-NEW',type:'prop',version:'v1',description:'墙边新添一只旧木箱。',source:'ai'});data.addedSettings.push('【AI补充】墙边新添一只旧木箱。');return{reply:'仅提出明确AI补充。',proposal:{kind:'replace_script',before:snapshot.editorBody,after:data.body,reason:'增加未锁定视觉道具',scriptData:data},cautions:['新增木箱是AI补充，非用户事实。']};}}),body=input(ctx),job=await finished(ctx,ctx.service.start(ctx.project.id,body));assert.equal(job.status,'succeeded',job.error);ctx.service.apply(ctx.project.id,job.id,body);assert.equal(ctx.applied[0].structuredCandidate.entities.at(-1).source,'ai');
  const data={...fixtureScript(),entityEvidence:[]},snapshot={editorBody:data.body,selectedText:'',selectionStart:0,selectionEnd:0};assert.throws(()=>validateAssistantResult({reply:'x',proposal:{kind:'replace_script',before:data.body,after:data.body+'新',reason:'x',scriptData:data},cautions:[]},snapshot),/完整正文不一致/);
});

test('接入真实ScriptWorkbench时助手显式应用形成待确认新版本，原采用指针与来源不被提前替换',async t=>{
  const root=fs.mkdtempSync(path.join(artifacts,'assistant-integration-')),store=new Store(root),creative=new CreativeService(store,{runner:isolatedRunner()}),scriptWorkbench=new ScriptWorkbench(store,{creative});
  const project=store.create({name:'[TEST] 真实存储助手集成',idea:fixtureIdea,durationSeconds:30});
  creative.update(project.id,{revision:0,entities:fixtureEntities,scriptDraft:fixtureScript().body});
  creative.addVersion(project.id,{revision:1,kind:'script',body:fixtureScript().body});
  const previous=creative.workspace.get(project.id),editor=scriptWorkbench.view(project.id).editor;
  const runner=async options=>{const json=JSON.parse(options.prompt.slice(options.prompt.indexOf('{\n'))),snapshot=json.snapshot,data={...fixtureScript(),entityEvidence:[]};data.body=snapshot.editorBody+'\n【AI建议】杯边一缕余温，结尾不改。';return{exitCode:0,completed:true,threadId:'isolated-real-workbench',finalMessage:JSON.stringify({reply:'【TEST】增加动作余韵，保持用户结尾。',proposal:{kind:'replace_script',before:snapshot.editorBody,after:data.body,reason:'保留锁定结尾，仅增强动作。',scriptData:data},cautions:['动作表述是AI建议，不提升为用户事实。']})};};
  const service=new CreativeAssistantService(store,{creative,scriptWorkbench,runner});t.after(()=>{service.close();scriptWorkbench.close();creative.close();});
  const body={requestId:randomUUID(),message:'保留结尾，调整前面的节奏。',stage:'script',workspaceRevision:previous.revision,projectRevision:project.revision,editorRevision:editor.revision,editorBody:editor.body,selectedText:'',selectionStart:0,selectionEnd:0};
  const job=await finished({service},service.start(project.id,body));assert.equal(job.status,'succeeded',job.error);assert.equal(job.snapshot.activeScriptVersionId,previous.activeScriptId);assert.equal(job.snapshot.editorBody,editor.body);
  const result=service.apply(project.id,job.id,body),after=creative.workspace.get(project.id);assert.equal(after.activeScriptId,previous.activeScriptId);assert.equal(after.versions.length,previous.versions.length+1);assert.equal(result.version.awaitingConfirmation,true);assert.equal(result.version.assistantTurnId,job.id);assert.equal(result.version.origin,'ai-assistant');assert.equal(result.editor.body,result.version.body);assert.equal(after.versions.find(v=>v.id===previous.activeScriptId).body,editor.body);
  assert.equal(service.read(project.id,job.id).canApply,false);assert.equal(service.apply(project.id,job.id,body).version.id,result.version.id);assert.equal(creative.workspace.get(project.id).versions.length,after.versions.length);
  const followBody={...body,requestId:randomUUID(),message:'请接着说明这次修改。',workspaceRevision:after.revision,editorRevision:result.editor.revision,editorBody:result.editor.body};const follow=await finished({service},service.start(project.id,followBody));assert.equal(follow.snapshot.editorVersion.id,result.version.id);assert.equal(follow.snapshot.currentScriptData.body,result.editor.body);assert.equal(follow.snapshot.activeScriptVersionId,previous.activeScriptId);
});

test('未采用候选中的新增实体也进入助手上下文和稳定ID保护，不能因未在workspace.entities中而被丢弃',async t=>{
  const ctx=fixture(t,{result:options=>{const snapshot=JSON.parse(options.prompt.slice(options.prompt.indexOf('{\n'))).snapshot,data={...fixtureScript(),entityEvidence:[]};data.body=snapshot.editorBody+'\n【TEST】微调动作。';return{reply:'【TEST】不应遗漏候选新增角色。',proposal:{kind:'replace_script',before:snapshot.editorBody,after:data.body,reason:'测试丢失实体被拒绝',scriptData:data},cautions:[]};}});
  const extra={id:'CHAR-CANDIDATE',type:'character',version:'v1',description:'候选增加的门外邻居，仅AI方案。',source:'ai'};
  ctx.scriptWorkbench.source=()=>({data:{...fixtureScript(),entities:[...fixtureEntities,extra],addedSettings:[extra.description]},bases:[]});
  const job=await finished(ctx,ctx.service.start(ctx.project.id,input(ctx)));assert.equal(job.snapshot.entities.some(entity=>entity.id===extra.id),true);assert.equal(job.snapshot.sourceSnapshot.entities.some(entity=>entity.id===extra.id),false,'没有把候选新增设定补造成用户输入');assert.equal(job.status,'failed');assert.match(job.error,/CHAR-CANDIDATE/);assert.equal(ctx.applied.length,0);
});

test('实体纠正应用后明确确认继承当前AI版本镜头种子，旧人物/分镜/来源保留且旧下游需复核',async t=>{
  const root=fs.mkdtempSync(path.join(artifacts,'assistant-entity-confirm-')),store=new Store(root),creative=new CreativeService(store,{runner:isolatedRunner()}),scriptWorkbench=new ScriptWorkbench(store,{creative});
  const project=store.create({name:'[TEST] AI实体纠正到分镜来源',idea:fixtureIdea,durationSeconds:30});
  creative.update(project.id,{revision:0,entities:fixtureEntities,shots:fixtureShots(),scriptDraft:fixtureScript().body});
  creative.addVersion(project.id,{revision:1,kind:'script',body:fixtureScript().body});creative.addVersion(project.id,{revision:2,kind:'storyboard',body:'【TEST旧分镜】保留CHAR-01 v1原版本。'});
  const previous=creative.workspace.get(project.id),editor=scriptWorkbench.view(project.id).editor;
  const runner=async options=>{const snapshot=JSON.parse(options.prompt.slice(options.prompt.indexOf('{\n'))).snapshot,data={...fixtureScript(),entityEvidence:[]};data.body=snapshot.editorBody+'\n【AI建议】老人头发花白，增加动作余韵。';data.entities[0]={...data.entities[0],version:'v2',description:'独居老人，灰蓝长衫，头发花白；AI建议细节。',source:'ai'};data.addedSettings.push('【AI建议纠正】'+data.entities[0].description);for(const seed of data.shotSeeds)for(const ref of seed.entityRefs)if(ref.id==='CHAR-01')ref.version='v2';return{exitCode:0,completed:true,threadId:'isolated-entity-correction',finalMessage:JSON.stringify({reply:'【TEST】保留原人物ID，以新版本加入发色建议。',proposal:{kind:'replace_script',before:snapshot.editorBody,after:data.body,reason:'人物版本升级，原稿保留。',scriptData:data},cautions:['CHAR-01 v2是AI建议，原v1用户来源和旧分镜保留。']})};};
  const service=new CreativeAssistantService(store,{creative,scriptWorkbench,runner});t.after(()=>{service.close();scriptWorkbench.close();creative.close();});
  const body={requestId:randomUUID(),message:'人物增加花白头发，保留原结尾。',stage:'script',workspaceRevision:previous.revision,projectRevision:project.revision,editorRevision:editor.revision,editorBody:editor.body,selectedText:'',selectionStart:0,selectionEnd:0};
  const job=await finished({service},service.start(project.id,body));assert.equal(job.status,'succeeded',job.error);const applied=service.apply(project.id,job.id,body);assert.equal(applied.workspace.activeScriptId,previous.activeScriptId);assert.equal(applied.version.entityChanges[0].after.version,'v2');
  assert.equal(creative.view(project.id).versions.find(version=>version.id===previous.activeStoryboardId).stale,true);
  const confirmed=scriptWorkbench.confirm(project.id,{workspaceRevision:applied.workspace.revision,projectRevision:project.revision,editorRevision:applied.editor.revision,body:applied.editor.body,confirmPendingSources:true});
  assert.equal(confirmed.workspace.activeScriptId,confirmed.version.id);assert.ok(confirmed.workspace.effectiveShots.every(shot=>shot.entityRefs.find(ref=>ref.id==='CHAR-01').version==='v2'),'确认后的分镜输入必须引用当前新人物版本');
  assert.equal(confirmed.workspace.entityProvenance.entries.find(row=>row.entityId==='CHAR-01').resolvedSource,'ai');
  const old=confirmed.workspace.versions.find(version=>version.id===previous.activeScriptId);assert.equal(old.data.entities[0].version,'v1');assert.equal(old.data.entities[0].source,'user');assert.equal(old.body,editor.body);assert.ok(confirmed.workspace.versions.some(version=>version.id===previous.activeStoryboardId));
  const repeated=scriptWorkbench.confirm(project.id,{workspaceRevision:confirmed.workspace.revision,projectRevision:project.revision,editorRevision:confirmed.editor.revision,body:confirmed.editor.body,confirmPendingSources:true});assert.equal(repeated.version.id,confirmed.version.id);assert.equal(repeated.workspace.versions.length,confirmed.workspace.versions.length);
  const raw={body:confirmed.version.body,entities:structuredClone(confirmed.version.data.entities),addedSettings:structuredClone(confirmed.version.data.addedSettings),shotSeeds:structuredClone(confirmed.version.data.shotSeeds),entityEvidence:[]};
  raw.entities[0]={...raw.entities[0],version:'v1',description:'改成全新人物事实，试图复用历史v1标签。',source:'ai'};raw.addedSettings.push(raw.entities[0].description);for(const seed of raw.shotSeeds)for(const ref of seed.entityRefs)if(ref.id==='CHAR-01')ref.version='v1';
  assert.throws(()=>scriptWorkbench.validateAssistantData(project.id,raw),/已绑定不同历史事实/,'不同事实不能重用历史实体版本标签');
  raw.entities[0].version='v3';for(const seed of raw.shotSeeds)for(const ref of seed.entityRefs)if(ref.id==='CHAR-01')ref.version='v3';const valid=scriptWorkbench.validateAssistantData(project.id,raw);assert.equal(valid.entityChanges[0].after.version,'v3');assert.equal(valid.entityProvenance.entries.find(row=>row.entityId==='CHAR-01').resolvedSource,'ai','允许新的建议版本，不提升为用户事实');
});
