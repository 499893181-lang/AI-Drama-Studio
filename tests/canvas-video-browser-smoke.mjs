// Real Chrome and the real local service with an explicitly isolated provider.
// Reuses existing marked MP4/PNG; zero official confirmation/generation calls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createStudio } from '../src/server.mjs';
import { buildCanvasExecutionScope } from '../src/canvas-execution.mjs';
import { creativeHash } from '../src/creative-store.mjs';
import { probeVideo } from '../src/video-media.mjs';
import { fixtureEntities, fixtureShots } from './creative-fixtures.mjs';
import { launchBrowser } from './cdp.mjs';

const directory=path.resolve('tests/.artifacts/canvas-video-browser');fs.mkdirSync(directory,{recursive:true});
const sourcePath=path.resolve('docs/video-v07-evidence/TEST-FIXTURE-NOT-AI.mp4'),sourceBytes=fs.readFileSync(sourcePath),sourceProbe=await probeVideo(sourcePath);
const png=fs.readFileSync('docs/video-v07-evidence/TEST-FIXTURE-NOT-AI-input.png'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const dataDir=fs.mkdtempSync(path.join(directory,'data-')),calls={inspect:0,submit:0,simulatedConfirm:0,query:0,download:0};
let credits=70,draftVersion=3,queryFailure=true,downloadFailure=true,inspectionFailure=null;
const resourceId=randomUUID();
const evidence={canvas:{projectId:'7f2bee13-2e6f-4097-9281-b814c3a314a2',nodeId:'node_ht5aaps7yz',sourceNodeId:'node_agvq74dwqs',sourceResourceId:'3e74fdf2-d290-4979-a200-4968dea502be'},input:{sha256:hash(png),registeredResource:{downloadSha256:'b'.repeat(64)}},parameters:{model:'seedance_2.0_vip',mode:'first_last_frame',ratio:'16:9',durationSeconds:5,resolution:'720p',outputCount:1,audioMode:'mute_derivative',prompt:'TEST FIXTURE / NOT AI，保持测试首帧，软件验收。'}};
const adapter={
  async inspectPlan(plan){calls.inspect++;if(inspectionFailure)throw new Error(inspectionFailure);const scope=buildCanvasExecutionScope(plan,{readback:{draftVersion},context:{region:'cn',profile:'ISOLATED-TEST',consumptionSubject:{kind:'personal'},consumptionSubjectHash:'a'.repeat(64)}});return {authorizationBinding:{scope,scopeHash:creativeHash(scope)},readback:{draftVersion},quote:{status:'quoted_snapshot',currency:'CREDITS',amount:credits,totalMaxCredits:credits,requestId:'TEST-QUOTE-NOT-OFFICIAL',draftVersion,checkedAt:new Date().toISOString(),expiresAt:null},executionMode:'isolated-fixture'};},
  async submit({submitId,beforeConfirm,beforeRun}){calls.submit++;await beforeConfirm();calls.simulatedConfirm++;await beforeRun();return {submitId,status:'querying',receipt:{testFixture:true,description:'Only isolated software acceptance, not official generation.'}};},
  async query({submitId}){calls.query++;if(queryFailure){queryFailure=false;throw new Error('TEST查询网络失败；保留原submitId。');}return {submitId,status:'success',resourceId,receipt:{testFixture:true}};},
  async download({submitId,resourceId:original,cwd,outputPath}){calls.download++;assert.equal(original,resourceId);if(downloadFailure){downloadFailure=false;throw new Error('TEST下载失败；只能恢复原资源。');}const file=outputPath??path.join(cwd,'original.mp4');fs.writeFileSync(file,sourceBytes,{flag:'wx'});return {submitId,resourceId:original,status:'success',path:file,testFixture:true};},
};
const options={dataDir,canvasVideoOptions:{adapter,evidence},videoOptions:{adapter:{inspect:async()=>({canSubmit:false,realSubmissionEnabled:false,auth:{loggedIn:false},message:'隔离UI验收：人工检查不调用外部直连CLI。'}),submit:async()=>{throw new Error('禁止使用直连生成');}}},inspectImageTools:async()=>({canSubmit:false,message:'隔离UI验收不运行图像工具。'}),imageGenerationOptions:{inspectCapabilities:async()=>({canSubmit:false,message:'自动出图关闭。'})}};
let app=createStudio(options);
async function listen(){await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${app.server.address().port}`;}
let base=await listen();
const project=app.store.create({name:'[画布UI验收] TEST卡，非AI素材',idea:'独立非个人软件测试，仅使用已存在TEST视频。',durationSeconds:5,aspectRatio:'16:9'});
app.creative.update(project.id,{revision:0,entities:structuredClone(fixtureEntities),shots:fixtureShots()});app.creative.addVersion(project.id,{revision:1,kind:'storyboard',body:'人工TEST分镜，不是模型或正式岗位PASS。'});
let images=app.images.import(project.id,{revision:0,role:'shot',targetId:'SHOT-01',filename:'TEST-FIXTURE-NOT-AI-input.png',source:{kind:'test',description:'复用既有TEST PNG，未生成。'}},png);
const image=images.assets[0];images=app.images.review(project.id,{revision:images.revision,assetId:image.id,verdict:'accepted',notes:'TEST软件输入检查，不是正式画面验收。'});app.images.select(project.id,{revision:images.revision,assetId:image.id});
const original=app.videos.workspace.source(project.id,'SHOT-01');
const old=app.videos.workspace.importCandidate(project.id,{task:{id:randomUUID(),externalTaskId:'TEST-OLD-LOCAL-IMPORT',shotId:'SHOT-01',providerStatus:'success',executionMode:'isolated-fixture',binding:original.binding,bindingHash:original.bindingHash,inputSnapshot:original.snapshot,parameters:{audioMode:'provider_default',model:'TEST-EXISTING-CLIP'}},bytes:sourceBytes,probe:sourceProbe});
app.videos.workspace.review(project.id,{revision:app.videos.workspace.get(project.id).revision,assetId:old.id,verdict:'accepted',notes:'旧TEST视频的软件检查。'});app.videos.workspace.select(project.id,{revision:app.videos.workspace.get(project.id).revision,assetId:old.id});
const route=`/api/projects/${project.id}/canvas-video`;
async function api(url,body){const response=await fetch(base+url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();assert.ok(response.ok,`${response.status}: ${value.error}`);return value;}
const browser=await launchBrowser(path.join(directory,`chrome-${Date.now()}`)),q=id=>`[data-testid="${id}"]`;
async function click(selector){await browser.waitFor(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`);await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await browser.waitFor(`!!document.querySelector('dialog[open]')||!document.querySelector(${JSON.stringify(selector)})||!document.querySelector(${JSON.stringify(selector)}).dataset.canvasBusy`);}
async function screenshot(name){const result=await browser.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(directory,name),Buffer.from(result.data,'base64'));}
async function waitFor(check){const end=Date.now()+15000;while(Date.now()<end){const view=await api(route);if(check(view))return view;await new Promise(resolve=>setTimeout(resolve,80));}throw new Error('等待隔离UI任务超时');}
const report={at:new Date().toISOString(),testFixture:true,sourceSha256:hash(sourceBytes),realConfirmationCalls:0,realVideoGenerationCalls:0,newImageGenerations:0,formalStageStatus:'not_checked',checks:[]};
try{
  await browser.call('Page.navigate',{url:`${base}/canvas-video.html?projectId=${project.id}`});await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('canvas-prepare'))})`);
  assert.ok(await browser.evaluate("document.body.textContent.includes('待本人批准，本轮执行关闭')&&document.body.textContent.includes('TEST FIXTURE')&&!document.querySelector('input[type=checkbox]')"));
  await click(q('canvas-prepare'));let view=await waitFor(value=>value.tasks.length===1),first=view.tasks[0];
  assert.ok(await browser.evaluate(`document.querySelector(${JSON.stringify(q('canvas-submit'))}).disabled`));
  const spoof=await fetch(base+`/api/canvas-video-tasks/${first.id}/submit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({approved:true,authorization:{approvedBy:'local-operator'},creditCeiling:70})});assert.equal(spoof.status,409);assert.equal(calls.submit,0);
  report.checks.push('真实服务+Chrome显示待本人批准，页面无发放授权控件；HTTP伪造批准仍409，隔离provider未被提交');
  inspectionFailure='TEST最新报价网络失败，旧报价不可授权';await click(q('canvas-quote-refresh'));await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('canvas-quote-error'))})`);assert.ok(await browser.evaluate(`document.querySelector(${JSON.stringify(q('canvas-quote'))}).textContent.includes('历史预估')&&document.querySelector(${JSON.stringify(q('canvas-submit'))}).disabled`));inspectionFailure=null;report.checks.push('新报价读取失败时旧70仅显示历史预估，持久quoteError与禁执行状态被重新读取，未把旧估价当最新授权');
  credits=71;await click(q('canvas-quote-refresh'));await browser.waitFor(`document.querySelector(${JSON.stringify(q('canvas-quote'))}).textContent.includes('71')`);assert.ok(await browser.evaluate(`document.querySelector(${JSON.stringify(q('canvas-submit'))}).disabled`));assert.equal(calls.submit,0);
  await screenshot('canvas-test-over-threshold.png');report.checks.push('最新最大预估超过70时UI停止批准流程；70标为预估批准阈值，100为未授权计划，实际扣费未返回');
  credits=70;draftVersion=4;await click(q('canvas-quote-refresh'));await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('canvas-task-stale'))})`);assert.equal(app.canvasVideo.read(first.id).draftVersion,3);
  await click(q('canvas-redo'));view=await waitFor(value=>value.tasks.length===2);const task=view.tasks.find(item=>item.id!==first.id);assert.ok(task);assert.equal(task.draftVersion,4);assert.ok(view.tasks.find(item=>item.id===first.id).stale);
  report.checks.push('草稿变化使旧任务过期，另备任务追加新scope和稳定submitId，旧草稿/原结果不被重绑或覆盖');
  app.canvasVideo.authority.issue({taskId:task.id,scope:task.authorizationBinding.scope,scopeHash:task.authorizationBinding.scopeHash,maxEstimatedCredits:70,approvalText:'本人明确批准仅此隔离软件测试夹具',expiresAt:new Date(Date.now()+60*60*1000).toISOString()});
  await click(q('canvas-refresh'));await browser.waitFor(`!document.querySelector(${JSON.stringify(q('canvas-submit'))}).disabled`);await click(q('canvas-submit'));await click(q('canvas-confirm-fixture'));
  view=await waitFor(value=>value.tasks.find(item=>item.id===task.id)?.submittedAt);assert.equal(calls.submit,1);await api(`/api/canvas-video-tasks/${task.id}/submit`,{});assert.equal(calls.submit,1);
  assert.equal(app.canvasVideo.read(task.id).submitId,task.submitId);report.checks.push('仅temp DATA_DIR可信签名夹具可模拟批准；一次提交意图/原submitId持久化，重复HTTP提交不重复confirm或run夹具');
  await click(q('canvas-query'));await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('canvas-query-error'))})`);await click(q('canvas-query'));await waitFor(value=>value.tasks.find(item=>item.id===task.id)?.status==='download_ready');
  await click(q('canvas-download'));await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('canvas-download-error'))})`);await click(q('canvas-download'));view=await waitFor(value=>value.tasks.find(item=>item.id===task.id)?.status==='succeeded');
  const candidate=view.assets.find(asset=>asset.taskId===task.id);assert.ok(candidate);assert.equal(candidate.state,'pending_check');assert.equal(candidate.testFixture,true);assert.equal(view.selectionHistory.at(-1).assetId,old.id);assert.deepEqual({submit:calls.submit,query:calls.query,download:calls.download},{submit:1,query:2,download:2});
  await browser.waitFor(`!!document.querySelector('[data-asset-id="${candidate.id}"] video')`);
  const decoded=await browser.evaluate(`(async()=>{const video=document.querySelector('[data-asset-id="${candidate.id}"] video');if(video.readyState<1)await new Promise((resolve,reject)=>{video.addEventListener('loadedmetadata',resolve,{once:true});video.addEventListener('error',()=>reject(new Error('TEST MP4 decode failed')),{once:true});});video.muted=true;await video.play();await new Promise(resolve=>setTimeout(resolve,250));video.pause();return {width:video.videoWidth,height:video.videoHeight,duration:video.duration,currentTime:video.currentTime};})()`);
  assert.equal(decoded.width,1280);assert.equal(decoded.height,720);assert.ok(Math.abs(decoded.duration-5)<0.1);assert.ok(decoded.currentTime>0);report.decoded=decoded;
  const originalFile=await fetch(base+`/api/canvas-video-tasks/${task.id}/original`);assert.equal(originalFile.status,200);assert.equal(hash(Buffer.from(await originalFile.arrayBuffer())),hash(sourceBytes));
  assert.equal((await fetch(base+`/api/projects/${project.id}/video-assets/${old.id}`)).status,200);assert.equal(hash(app.videos.file(project.id,old.id).bytes),hash(sourceBytes));
  await browser.evaluate(`document.querySelector('[data-asset-id="${candidate.id}"]').scrollIntoView({block:'start'})`);await screenshot('canvas-test-candidate-playback.png');report.checks.push('查询故障继续原ID，下载故障仅恢复原资源；实际TEST文件FFprobe与Chrome播放成功，旧已选视频与原片保留，新候选不自动检查或选用');
  const notes='人工软件检查：TEST素材非AI生成，实播通过，画面仅作工程验收。';
  await browser.evaluate(`{const node=document.querySelector('[data-review-notes="${candidate.id}"]');node.value=${JSON.stringify(notes)};node.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await click('[data-studio-step="images"]');await browser.waitFor("!!document.querySelector('#canvas-confirm[open] [data-testid=canvas-leave-stay]')");
  assert.ok(await browser.evaluate("document.querySelector('#canvas-confirm').textContent.includes('有未保存的检查说明')"));
  await click(q('canvas-leave-stay'));assert.equal(await browser.evaluate('location.pathname'),'/canvas-video.html');
  assert.equal(await browser.evaluate(`document.querySelector('[data-review-notes="${candidate.id}"]').value`),notes);
  await click('[data-studio-step="video"]');await browser.waitFor("!!document.querySelector('#canvas-confirm[open] [data-testid=canvas-leave-discard]')");await click(q('canvas-leave-discard'));
  await browser.waitFor(`!!document.querySelector('[data-review-notes="${candidate.id}"]')&&document.querySelector('[data-review-notes="${candidate.id}"]').value===''`);
  assert.equal(calls.submit,1);assert.equal((await api(route)).assets.find(asset=>asset.id===candidate.id).state,'pending_check');
  await browser.evaluate(`{const node=document.querySelector('[data-review-notes="${candidate.id}"]');node.value=${JSON.stringify(notes)};node.dispatchEvent(new Event('input',{bubbles:true}));}`);
  report.checks.push('左侧步骤导航明确确认未保存检查说明：取消保留原输入，明确放弃后才离开；原任务/候选未写入或重新生成');
  await click(`[data-review="${candidate.id}"][data-verdict=accepted]`);await click(`[data-select="${candidate.id}"]`);view=await api(route);assert.equal(view.selectionHistory.at(-1).assetId,candidate.id);assert.equal(view.selectionHistory.length,2);
  report.checks.push('人工检查与人工选用分别写历史，选择新版本后旧原片仍可读，不把媒体技术核验当正式内容PASS');
  images=app.images.view(project.id);app.images.review(project.id,{revision:images.revision,assetId:image.id,verdict:'rejected',notes:'TEST撤销输入审核，验证旧候选需复核。'});await click(q('canvas-refresh'));await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('canvas-stale'))})`);view=await api(route);assert.ok(view.assets.every(asset=>asset.stale));assert.equal(calls.submit,1);
  await app.close();app=createStudio(options);base=await listen();await browser.call('Page.navigate',{url:`${base}/canvas-video.html?projectId=${project.id}`});await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('canvas-stale'))})`);view=await api(route);assert.equal(view.tasks.length,2);assert.equal(view.assets.length,2);assert.equal(view.selectionHistory.length,2);assert.equal(app.canvasVideo.read(task.id).submitId,task.submitId);assert.equal(calls.submit,1);
  await screenshot('canvas-test-restored-stale.png');report.checks.push('上游审核撤销后旧任务/候选需复核；服务重启恢复scope、submitId、原片、两候选和选择历史，0自动重提');
  await browser.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await browser.evaluate('window.scrollTo(0,0)');const viewport=await browser.evaluate('({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})');assert.ok(viewport.scroll<=viewport.client+1,JSON.stringify(viewport));report.mobile=viewport;await screenshot('canvas-test-mobile.png');
  assert.equal(browser.messages.length,0,JSON.stringify(browser.messages));report.checks.push('390px页面无横向溢出，真实Chrome无未处理异常');report.passed=true;report.fixtureCalls=calls;report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await app.close();}
