import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createImageGuard, verifyImageGuard } from '../src/codex-image-guard.mjs';
import { verifyPrivateHook, verifyImageSchema, verifyImageSession,failedImageReceipt,runCodexImage } from '../src/codex-image-runner.mjs';
import { Store } from '../src/store.mjs';
import { CreativeWorkspace, creativeHash } from '../src/creative-store.mjs';
import { ImageWorkspace } from '../src/image-store.mjs';
import { fixtureEntities, fixtureShots } from './creative-fixtures.mjs';
import { testPng } from './image-fixtures.mjs';

const artifacts=path.resolve('tests/.artifacts');fs.mkdirSync(artifacts,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fixture=()=>fs.mkdtempSync(path.join(artifacts,'单图 hook 空格-'));
// Match the native Windows command_runner: COMSPEC /C with raw surrounding
// quotes, rather than proving only Node execFile works for paths with spaces.
function invoke(guard,tool='image_genimagegen',shell='cmd') {
  return new Promise((resolve,reject)=>{
    const child=process.platform==='win32'?(shell==='powershell'?spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',guard.command],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']}):spawn(process.env.COMSPEC||'cmd.exe',['/C',`"${guard.command}"`],{shell:false,windowsHide:true,windowsVerbatimArguments:true,stdio:['pipe','pipe','pipe']})):spawn(process.execPath,[guard.scriptPath],{shell:false,stdio:['pipe','pipe','pipe']});
    let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('close',code=>{if(code!==0)return reject(new Error(`hook exited ${code}: ${err}`));try{resolve(JSON.parse(out));}catch(error){reject(new Error(`${error.message}: ${out} ${err}`));}});
    child.stdin.end(JSON.stringify({hook_event_name:'PreToolUse',tool_name:tool,tool_use_id:'fixture-only',tool_input:{prompt:'MODEL MUST NOT OVERRIDE',n:99}}));
  });
}
const decision=value=>value.hookSpecificOutput.permissionDecision;
test('本地cmd与实际PowerShell分支夹具：中文路径、并发只准一次、剔除模型n和prompt；无模型调用',async()=>{
  const directory=fixture(),ref=path.join(directory,'真实附件 测试.png'),bytes=testPng();fs.writeFileSync(ref,bytes);
  const guard=createImageGuard({directory:path.join(directory,'host control'),prompt:'受信单张提示词',references:[{path:ref,sha256:hash(bytes)}]});
  assert.equal(verifyImageGuard(guard),true);
  const results=await Promise.all([invoke(guard),invoke(guard,'image_genimagegen','powershell')]);
  assert.deepEqual(results.map(decision).sort(),['allow','deny']);
  const allowed=results.find(x=>decision(x)==='allow').hookSpecificOutput.updatedInput;
  assert.deepEqual(allowed,{prompt:'受信单张提示词',transparent_background:false,referenced_image_paths:[ref]});
  assert.equal(decision(await invoke(guard)), 'deny');assert.ok(fs.existsSync(guard.markerPath));
});
test('真实出图验收失败后入口关闭，不因功能开关或测试通过启动任何新turn',async()=>{
  await assert.rejects(()=>runCodexImage({prompt:'此测试绝不允许模型调用',cwd:fixture()}),/本轮真实验收未通过/);
});
test('失败回执保留实际事件、图像和终态，不能把缺hook或附件的输出升级成成功',()=>{
  const directory=fixture(),file=path.join(directory,'ACTUAL-OUTPUT-FIXTURE-NOT-AI.png'),bytes=testPng();fs.writeFileSync(file,bytes);
  const event={method:'item/completed',params:{threadId:'fixture-thread',turnId:'fixture-turn',item:{id:'fixture-tool',type:'imageGeneration',status:'completed',savedPath:file,inputImages:[]}}};
  const receipt=failedImageReceipt({events:[event],error:'未找到私有hook准许',turnCompleted:true,processExitCode:0});
  assert.equal(receipt.completed,false);assert.equal(receipt.exitCode,null);assert.equal(receipt.processExitCode,0);assert.equal(receipt.turnCompleted,true);assert.equal(receipt.verificationStatus,'unverified_actual_output');assert.equal(receipt.imageGeneration,event.params.item);assert.equal(receipt.images[0].path,file);assert.equal(receipt.images[0].sha256,hash(bytes));assert.equal(receipt.images[0].verified,false);assert.equal(receipt.automaticallySelected,false);assert.deepEqual(fs.readFileSync(file),bytes);
  const base64={id:'fixture-b64',type:'imageGeneration',status:'completed',result:bytes.toString('base64')};
  const other=failedImageReceipt({imageGeneration:base64,error:'附件不匹配',cwd:directory});assert.equal(other.completed,false);assert.equal(other.imageGeneration.savedPath,undefined);assert.deepEqual(fs.readFileSync(other.images[0].path),bytes);assert.equal(failedImageReceipt({imageGeneration:{...base64,result:'NOT BASE64'},cwd:directory,error:'error'}).images.length,0);
});
test('私有hook拒绝shell/API/其他工具且不预占图片调用，manifest或附件变化拒绝',async()=>{
  const directory=fixture(),ref=path.join(directory,'ref.png');fs.writeFileSync(ref,testPng());
  const guard=createImageGuard({directory:path.join(directory,'guard'),prompt:'测试',references:[{path:ref,sha256:hash(fs.readFileSync(ref))}]});
  for(const tool of ['Bash','exec_command','functions.exec','web.run','mcp__image_generate'])assert.equal(decision(await invoke(guard,tool)),'deny');
  assert.equal(fs.existsSync(guard.markerPath),false);
  fs.appendFileSync(ref,'changed');assert.equal(decision(await invoke(guard)),'deny');assert.equal(fs.existsSync(guard.markerPath),false);
  fs.appendFileSync(guard.manifestPath,' ');assert.equal(verifyImageGuard(guard),false);assert.equal(decision(await invoke(guard)),'deny');
});
test('实际PreToolUse重新检查工作台：等待期间参考审核拒绝或输入改变均不准生成',async()=>{
  const directory=fixture(),store=new Store(path.join(directory,'data')),creative=new CreativeWorkspace(store),project=store.create({name:'[隔离测试] hook再次核对',idea:'等茶',durationSeconds:30});
  creative.update(project.id,{revision:0,entities:structuredClone(fixtureEntities),shots:fixtureShots(),stylePresetId:'jia.platform.distance'});creative.addVersion(project.id,{revision:1,kind:'storyboard',body:'测试人工分镜，非AI'});
  const images=new ImageWorkspace(store);let ws=images.import(project.id,{revision:0,role:'character',targetId:'CHAR-01',filename:'TEST-NOT-AI.png',source:{kind:'test',description:'软件隔离测试图片，非生成。'}},testPng());
  const asset=ws.assets[0];ws=images.review(project.id,{revision:ws.revision,assetId:asset.id,verdict:'accepted'});ws=images.select(project.id,{revision:ws.revision,assetId:asset.id});
  const packet=images.prepare(project.id,{revision:ws.revision,shotId:'SHOT-01'}),file=images.file(project.id,asset.id),copy=path.join(directory,'runtime-ref.png');fs.writeFileSync(copy,file.bytes);
  const policy={dataRoot:store.root,projectId:project.id,packetId:packet.id,expectedBindingHash:creativeHash(packet.binding),expectedInputSnapshotHash:packet.sourceSnapshotHash};
  const guard=createImageGuard({directory:path.join(directory,'guard'),prompt:packet.prompt,references:[{path:copy,sha256:asset.sha256}],policy});
  images.review(project.id,{revision:images.get(project.id).revision,assetId:asset.id,verdict:'rejected'});
  assert.equal(decision(await invoke(guard)),'deny');assert.equal(fs.existsSync(guard.markerPath),false);
  const current=store.read('projects',project.id);store.update(project.id,{revision:current.revision,idea:'需求已变更'});
  assert.equal(decision(await invoke(guard)),'deny');assert.equal(fs.existsSync(guard.markerPath),false);
});
test('hook精确信任只接受唯一启用且Hash匹配的私有命令；可选generationId不伪造',()=>{
  const guard=createImageGuard({directory:fixture(),prompt:'测试'}),hook={key:'fixture-key',eventName:'preToolUse',handlerType:'command',command:guard.command,matcher:'.*',async:false,enabled:true,currentHash:'sha256:'+'a'.repeat(64),trustStatus:'trusted'};
  assert.equal(verifyPrivateHook({data:[{hooks:[hook],errors:[],warnings:[]}]},guard,true).key,'fixture-key');
  for(const hooks of [[hook,hook],[{...hook,enabled:false}],[{...hook,trustStatus:'untrusted'}],[{...hook,command:'arbitrary'}]])assert.throws(()=>verifyPrivateHook({data:[{hooks}]},guard,true));
  const image={properties:{type:{enum:['imageGeneration']},id:{},status:{},inputImages:{},savedPath:{}},anyOf:[{properties:{result:{}}},{properties:{fileId:{}}}]};
  assert.equal(verifyImageSchema({definitions:{ThreadItem:{oneOf:[image]},UserInput:{localImage:{}},TurnCompletedNotification:{},HooksListResponse:{},ModelProviderCapabilitiesReadResponse:{}}}),true);
  assert.throws(()=>verifyImageSchema({definitions:{}}));
  verifyImageSession({modelProvider:'openai',sandbox:{type:'readOnly'},approvalPolicy:'never'});
  for(const wrong of [{modelProvider:'custom'},{sandbox:{type:'workspaceWrite'}},{approvalPolicy:'on-request'}])assert.throws(()=>verifyImageSession({modelProvider:'openai',sandbox:{type:'readOnly'},approvalPolicy:'never',...wrong}));
});
