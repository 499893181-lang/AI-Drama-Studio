// Browser-only evidence presentation fixture. No model turn or image generation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createStudio } from '../src/server.mjs';
import { launchBrowser } from './cdp.mjs';
import { fixtureEntities, fixtureShots } from './creative-fixtures.mjs';
import { testPng } from './image-fixtures.mjs';

const artifacts=path.resolve('tests/.artifacts/image-diagnostics-browser');
fs.mkdirSync(artifacts,{recursive:true});
let generatorCalls=0;
const app=createStudio({
  dataDir:fs.mkdtempSync(path.join(artifacts,'data-')),
  inspectImageTools:async()=>({message:'UI隔离夹具，不检测真实账号。'}),
  imageGenerationOptions:{
    inspectCapabilities:async()=>({canSubmit:false,contractVerified:false,actualGenerationVerified:false,message:'执行边界不能保证严格一次；自动入口保持关闭。'}),
    runner:async()=>{generatorCalls++;throw new Error('本测试禁止调用任何生成器');},
  },
});
const project=app.store.create({name:'[隔离状态验收] 原图与未验证证据',idea:'明确软件显示夹具；没有真实生成。'});
app.creative.update(project.id,{revision:0,entities:structuredClone(fixtureEntities),shots:fixtureShots()});
app.creative.addVersion(project.id,{revision:1,kind:'storyboard',body:'隔离人工测试分镜'});
const prepared=app.imageGeneration.prepare(project.id,{revision:0,shotId:'SHOT-01'});
const job={...prepared,status:'failed',executionMode:'isolated-fixture',submittedAt:new Date().toISOString(),threadId:'UI-FIXTURE-THREAD',turnId:'UI-FIXTURE-TURN',error:'保留原文：隔离模拟hook启动失败，不是真实调用错误。',result:null};
app.store.write('image-generation-jobs',job);
const originalBytes=fs.readFileSync(app.store.file('image-generation-jobs',job.id));
let unknown=false;
const layer=(status,reason,count=null)=>({status,reason,count});
const diagnostic=()=>({
  isolatedFixtureOnly:true,
  evidence:{
    artifact:{status:'produced',reason:'隔离测试PNG已存在并解码；不是本轮真实生成。'},
    protection:{status:'unverified',reason:'启动故障后只能请求异步中断，无法证明已开始调用被阻止。'},
    references:{status:'unverified',reason:'仅会话请求可见，未返回图像工具参数或服务端使用回执。'},
    acceptance:{status:'incomplete',reason:'原候选没有通过完整验收，保留原失败状态。'},
  },
  counts:{applicationSubmissions:1,modelTurnRequests:unknown?null:2,imageToolStarts:unknown?null:1,imageToolCompletions:unknown?null:1,observationComplete:false},
  attachments:{
    planned:layer('planned_only','只是任务包计划，不是实际发送证明。',1),
    sessionSent:layer('observed','仅表示transport请求中的localImage附件。',1),
    sessionReceived:layer('unverified','没有会话接收回执，不补造。'),
    toolArguments:layer('not_returned','未观测到实际工具参数，不能用计划路径充当。'),
    toolReadReceipt:layer('observed','inputImages只说明图像请求在本地读取文件，不是服务端使用证明。',1),
    serverReceipt:layer('not_returned','没有服务端参考使用回执；inputImages不能替代。'),
    visualCheck:layer('not_checked','尚未进行参考画面符合性检查。'),
  },
});
const nativeView=app.imageGeneration.view.bind(app.imageGeneration);
app.imageGeneration.view=async id=>{const view=await nativeView(id);return{...view,tasks:view.tasks.map(task=>task.id===job.id?{...task,diagnostic:diagnostic()}:task)};};
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${app.server.address().port}`,browser=await launchBrowser(path.join(artifacts,'browser'));
const q=id=>`[data-testid="${id}"]`;
const click=async selector=>{await browser.waitFor(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`);await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);};
const content=async selector=>browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
const report={at:new Date().toISOString(),isolatedFixtureOnly:true,newModelTurns:0,newImageGenerations:0,checks:[]};
try{
  await browser.call('Page.navigate',{url:`${base}/images.html?projectId=${project.id}`});
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('image-diagnostics'))})`);
  assert.match(await content(q('image-diagnostic-artifact')),/隔离测试图片已保留（非真实生成）/);
  for(const [id,text]of[['protection','执行保护未验证'],['references','参考使用未验证'],['acceptance','候选未通过完整验收']])assert.match(await content(q('image-diagnostic-'+id)),new RegExp(text));
  assert.equal(await browser.evaluate("document.querySelector('[data-testid=\"image-diagnostics\"]').textContent.includes('真实图片已产出')"),false);
  assert.ok(await content(q('image-diagnostic-fixture')));report.checks.push('产物、执行保护、参考和完整验收分开显示；隔离图片不冒充真实生成');
  assert.equal((await content(q('image-count-application'))).trim(),'1');
  assert.equal((await content(q('image-count-turn'))).trim(),'2');
  assert.equal((await content(q('image-count-image-start'))).trim(),'1');
  assert.equal((await content(q('image-count-image-complete'))).trim(),'1');
  report.checks.push('应用1次、模型turn请求2次、图像工具事件1次分别显示，不能互相替代');
  const layers=['planned','sessionSent','sessionReceived','toolArguments','toolReadReceipt','serverReceipt','visualCheck'];
  for(const key of layers)assert.ok(await browser.evaluate(`!!document.querySelector(${JSON.stringify(q('image-attachment-'+key))})`));
  assert.match(await content(q('image-attachment-toolReadReceipt')),/已观测.*不是服务端使用证明/);
  assert.match(await content(q('image-attachment-serverReceipt')),/未返回.*没有服务端参考使用回执/);
  assert.match(await content(q('image-attachment-visualCheck')),/未检查/);
  report.checks.push('计划、会话请求和接收、工具入参、本地读取、服务端回执、视觉检查七层证据分别显示；inputImages不冒充服务端使用');
  unknown=true;await click(q('image-refresh'));
  await browser.waitFor(`document.querySelector(${JSON.stringify(q('image-count-turn'))}).textContent.trim()==='未核实'`);
  assert.equal((await content(q('image-count-image-start'))).trim(),'未核实');
  assert.equal((await content(q('image-count-image-complete'))).trim(),'未核实');
  assert.match(await content(q('image-diagnostic-counts')),/应用提交次数1/);
  report.checks.push('缺失的turn和工具事件计数显示未核实，不推断为0；已知应用意图仍保留1');
  await click(q('image-prepare'));await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('image-packet'))})`);
  report.checks.push('自动入口关闭时手工任务包仍可准备，没有调用生成器');
  await browser.evaluate("document.querySelector('[data-testid=\"image-auto-shot\"]').value='SHOT-02'");
  await click(q('image-auto-prepare'));await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('image-auto-submit'))})`);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(q('image-auto-submit'))}).disabled`),true);
  assert.equal(generatorCalls,0);report.checks.push('新准备任务也不能开启自动入口，0模型turn、0生成器调用');
  assert.deepEqual(fs.readFileSync(app.store.file('image-generation-jobs',job.id)),originalBytes);
  await click(`[data-auto-view="${job.id}"]`);
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('image-diagnostics'))})`);
  await browser.evaluate(`document.querySelector(${JSON.stringify(q('image-diagnostics'))}).scrollIntoView()`);
  const shot=await browser.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,'layered-diagnostics.png'),Buffer.from(shot.data,'base64'));
  assert.equal(browser.messages.length,0,JSON.stringify(browser.messages));
  report.checks.push('刷新和诊断显示不改原失败任务字节、错误或回执；无未处理页面异常');
  report.passed=true;report.consoleExceptions=0;report.originalJobSha256=createHash('sha256').update(originalBytes).digest('hex');
  fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await app.close();}
