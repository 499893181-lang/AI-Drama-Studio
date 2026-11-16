// Real Chrome + actual labelled PNG files. No model, image generator or media task.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createStudio } from '../src/server.mjs';
import { launchBrowser } from './cdp.mjs';
import { fixtureIdea, fixtureEntities, fixtureShots } from './creative-fixtures.mjs';
import { testPng } from './image-fixtures.mjs';

const artifacts=path.resolve('tests/.artifacts'),directory=path.join(artifacts,'image-browser');
fs.mkdirSync(directory,{recursive:true});
const dataDir=fs.mkdtempSync(path.join(artifacts,'image-browser-data-'));
const fixtureFiles=[['test-character.png',[35,64,95]],['test-scene.png',[55,95,65]],['test-shot-01.png',[100,65,45]],['test-shot-02.png',[90,55,110]],['test-shot-03.png',[45,100,115]],['test-shot-02-redo.png',[155,55,55]],['test-character-redo.png',[45,45,120]]].map(([name,color])=>{const file=path.join(directory,name);fs.writeFileSync(file,testPng(320,180,color));return file;});
const options={dataDir,imageGenerationOptions:{inspectCapabilities:async()=>({canSubmit:false,contractVerified:false,message:'隔离手工图片测试不探测真实账户或调用生成。'}),runner:async()=>{throw new Error('手工测试禁止自动生成');}},inspectTools:async()=>({checkedAt:new Date().toISOString(),tools:[]}),inspectImageTools:async()=>({mode:'manual_export_import',automaticSubmissionEnabled:false,codex:{installed:true,version:'isolated-browser-fixture',loggedIn:false,imageGenerationFlagDetected:true,note:'隔离能力展示夹具，非真实账号或自动产物验证。'},cost:{status:'unknown',label:'费用待确认',amount:null}}),creativeOptions:{runner:async()=>{throw new Error('图片浏览器测试禁止模型调用');}}};
let app=createStudio(options);
const project=app.store.create({name:'[隔离图片验收] 三镜头与测试图',idea:fixtureIdea,durationSeconds:30});
let creative=app.creative.view(project.id);
app.creative.update(project.id,{revision:creative.revision,stylePresetId:'jia.platform.distance',entities:structuredClone(fixtureEntities),shots:fixtureShots(),instructions:'隔离软件测试：30秒、3镜头，图片像素标注TEST FIXTURE / NOT AI；不进行生成。'});
creative=app.creative.view(project.id);
app.creative.addVersion(project.id,{revision:creative.revision,kind:'script',body:'【隔离人工剧本】老人留茶、听平安消息、拉近空椅子。每镜10秒，三镜头。'});
creative=app.creative.view(project.id);
app.creative.addVersion(project.id,{revision:creative.revision,kind:'storyboard',body:'【隔离人工分镜】只测试图片文件、稳定版本和选择历史。'});
async function listen(){await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${app.server.address().port}`;}
let base=await listen();
const browser=await launchBrowser(path.join(directory,'chrome'));
const report={startedAt:new Date().toISOString(),fixturesOnly:true,testImages:'PNG pixels explicitly say TEST FIXTURE / NOT AI',realModelOrMediaInvoked:false,checks:[]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function get(route){const response=await fetch(base+route),value=await response.json();if(!response.ok)throw new Error(`${response.status}: ${value.error}`);return value;}
const view=()=>get(`/api/projects/${project.id}/images`);
async function wait(predicate){for(let i=0;i<100;i++){const value=await view();if(predicate(value))return value;await pause(100);}throw new Error('图片工作区等待超时');}
const q=name=>`[data-testid="${name}"]`;
async function clickSelector(selector){await browser.waitFor(`!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`);await browser.evaluate(`{const node=document.querySelector(${JSON.stringify(selector)});for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;node.scrollIntoView({block:'center'});node.click();}`);}
const click=name=>clickSelector(q(name));
async function fill(name,value,event='input'){const selector=q(name);await browser.waitFor(`!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`);await browser.evaluate(`{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));}`);}
async function setFile(file){const doc=await browser.call('DOM.getDocument');const node=await browser.call('DOM.querySelector',{nodeId:doc.root.nodeId,selector:q('image-file')});await browser.call('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[file]});}
async function screenshot(filename){const result=await browser.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(directory,filename),Buffer.from(result.data,'base64'));}
async function imported(role,targetId,file,packetId=''){
  let ws=await view(),count=ws.assets.length;
  const target=ws.targets.find(target=>target.role===role&&target.targetId===targetId);
  await fill('image-target',target.key,'change');
  await fill('image-source-kind','test','change');
  await fill('image-source-description','软件隔离验收图片，像素明确标注TEST FIXTURE / NOT AI；不是实际AI生成结果。');
  if(packetId)await fill('image-packet-id',packetId,'change');
  await setFile(file);await browser.waitFor(`!!document.querySelector('#image-file-preview img')?.naturalWidth`);
  await click('image-import');
  ws=await wait(value=>value.assets.length===count+1);
  const asset=ws.assets.at(-1);
  await browser.waitFor(`!!document.querySelector('[data-asset-id="${asset.id}"]')`);
  await clickSelector('[data-action="open-image-versions"]');
  const versionsDrawer=role==='character'?'image-character-versions-details':role==='scene'?'image-scene-versions-details':'image-versions-details';
  assert.equal(await browser.evaluate(`document.getElementById(${JSON.stringify(versionsDrawer)}).open`),true);
  await browser.evaluate(`{const node=document.querySelector('[data-asset-id="${asset.id}"]');for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;node.scrollIntoView({block:'center'});}`);
  await browser.waitFor(`!!document.querySelector('[data-asset-id="${asset.id}"] img')?.naturalWidth`);
  assert.equal(asset.source.kind,'test');assert.equal(asset.width,320);assert.equal(asset.height,180);assert.equal(asset.format,'png');assert.match(asset.sha256,/^[a-f0-9]{64}$/);
  const selector=`[data-review-notes="${asset.id}"]`;
  await browser.evaluate(`{const el=document.querySelector(${JSON.stringify(selector)});el.value='人工软件测试检查：文件显示TEST FIXTURE / NOT AI，绑定目标与尺寸正确；此结论不表示作品视觉通过。';el.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await clickSelector(`[data-review-asset="${asset.id}"][data-verdict="accepted"]`);
  await wait(value=>value.assets.find(row=>row.id===asset.id)?.review?.verdict==='accepted');
  await clickSelector(`[data-select-asset="${asset.id}"]`);await click('image-confirm-submit');
  await wait(value=>value.assets.find(row=>row.id===asset.id)?.state==='selected');
  return asset;
}
try{
  await browser.call('Page.navigate',{url:`${base}/images.html?projectId=${project.id}`});
  await browser.waitFor(`document.querySelectorAll('[data-target-role="shot"]').length===3`);
  await browser.call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:path.join(directory,'downloads')});
  await browser.evaluate(`(()=>{window.__packetReads=0;window.__jsonDownloads=0;window.__copiedPrompts=[];const fetchOriginal=window.fetch;window.fetch=(...args)=>{if(/\\/images\\/packets\\/[^/]+$/.test(String(args[0])))window.__packetReads++;return fetchOriginal(...args);};const clickOriginal=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download.endsWith('.json'))window.__jsonDownloads++;return clickOriginal.call(this);};Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedPrompts.push(text);}}});})()`);
  assert.equal(await browser.evaluate(`document.querySelectorAll('[data-target-role="character"]').length`),1);
  assert.equal(await browser.evaluate(`document.querySelectorAll('[data-target-role="scene"]').length`),1);
  assert.ok(await browser.evaluate(`document.body.textContent.includes('费用待确认')`));
  report.checks.push('真实Chrome显示三镜头、人物/场景版本、画面提示词与导演规则；费用待确认、手工出图及正式阶段未接入分开说明');
  const character=await imported('character','CHAR-01',fixtureFiles[0]);
  const scene=await imported('scene','SCENE-01',fixtureFiles[1]);
  let ws=await view();
  assert.equal(ws.selectionHistory.length,2);
  report.checks.push('通过实际文件控件上传并预览带像素标记的测试PNG；人物与场景各自人工检查后选用，Hash/格式/尺寸与来源声明真实保存');
  // Only explicitly selected references enter the bundle. JSON attached remains false.
  await clickSelector(`[data-reference-id="${character.id}"]`);await clickSelector(`[data-reference-id="${scene.id}"]`);
  await fill('image-export-shot','SHOT-01','change');
  await click('image-prepare');
  ws=await wait(value=>value.packets.length===1);
  const packet=ws.packets[0];
  await browser.waitFor(`window.__jsonDownloads===1`);assert.equal(await browser.evaluate('window.__packetReads'),1,'首次JSON下载也必须重新走当前任务包门禁');
  assert.equal(packet.references.length,2);assert.ok(packet.references.every(ref=>ref.attached===false&&ref.includedInBundle===true));
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('image-download-bundle'))})`);
  const zip=await fetch(`${base}/api/projects/${project.id}/images/packets/${packet.id}/bundle`);
  assert.equal(zip.status,200);const bytes=Buffer.from(await zip.arrayBuffer());assert.equal(bytes.subarray(0,2).toString(),'PK');assert.ok(bytes.includes(Buffer.from(character.sha256)));
  await click('image-download-bundle');
  await browser.waitFor(`!document.querySelector(${JSON.stringify(q('image-download-bundle'))}).disabled`);
  report.checks.push('真实提示词任务包与ZIP包含两份选定参考及Hash，attached=false且官网未发送；仅文字实体引用不冒充图片附加');
  const shot1=await imported('shot','SHOT-01',fixtureFiles[2],packet.id);
  const shot2=await imported('shot','SHOT-02',fixtureFiles[3]);
  const shot3=await imported('shot','SHOT-03',fixtureFiles[4]);
  ws=await view();assert.equal(ws.assets.filter(a=>a.role==='shot'&&a.state==='selected').length,3);
  await browser.evaluate(`document.querySelector('[data-target-id="SHOT-01"]').scrollIntoView({block:'start'})`);await screenshot('three-shots.png');
  await clickSelector('[data-focus-target="shot:SHOT-01"]');
  for(const [width,height] of [[1366,768],[1440,900]]){
    await browser.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await browser.evaluate("document.querySelector('.studio-main').scrollTop=0");
    const bounds=await browser.evaluate("(()=>{const main=document.querySelector('.studio-main').getBoundingClientRect(),footer=document.querySelector('.studio-footer').getBoundingClientRect();return {scroll:document.documentElement.scrollWidth,mainBottom:main.bottom,footerTop:footer.top,footerBottom:footer.bottom,width:innerWidth,height:innerHeight,thumbs:document.querySelectorAll('.image-focus-strip [data-focus-target]').length};})()");
    assert.ok(bounds.scroll<=width);assert.ok(bounds.mainBottom<=bounds.footerTop+1);assert.ok(bounds.footerBottom<=height+1);assert.equal(bounds.thumbs,3);
    await screenshot(`c-images-${width}.png`);
  }
  report.checks.push('C版1366×768及1440×900中当前真实主图、右侧制作检查区与三镜缩略图可用，左侧双层结构和底部按钮不遮挡，无异常横滚');
  report.checks.push('三镜头实际图片各自绑定当前分镜版本，检查后人工选用；第一镜关联实际导出的任务包，其他手工上传明确未验证模型输入');
  const redo=await imported('shot','SHOT-02',fixtureFiles[5]);ws=await view();
  assert.equal(ws.assets.filter(a=>a.role==='shot'&&a.targetId==='SHOT-02').length,2);
  assert.ok(ws.assets.some(a=>a.id===shot2.id));assert.equal(ws.assets.find(a=>a.id===shot1.id).state,'selected');assert.equal(ws.assets.find(a=>a.id===shot3.id).state,'selected');
  assert.equal(ws.selectionHistory.at(-1).previousAssetId,shot2.id);
  assert.equal((await fetch(`${base}/api/projects/${project.id}/image-assets/${shot2.id}`)).status,200);
  report.checks.push('仅第二镜换图；前后镜选用不变，旧图可读取，两个图片版本与替换历史保留');
  const characterRedo=await imported('character','CHAR-01',fixtureFiles[6]);
  ws=await view();assert.ok(ws.assets.filter(a=>a.role==='shot').every(a=>a.stale));
  await click('image-refresh');await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('image-stale'))})`);
  assert.ok(ws.assets.some(a=>a.id===character.id));assert.equal(ws.assets.find(a=>a.id===characterRedo.id).state,'selected');
  const invalidBundle=await fetch(`${base}/api/projects/${project.id}/images/packets/${packet.id}/bundle`);assert.equal(invalidBundle.status,409);
  const invalidBundleError=await invalidBundle.json();assert.match(invalidBundleError.error,/任务包输入.*(?:参考版本|审核状态).*已改变/);
  const downloadCount=await browser.evaluate('window.__jsonDownloads'),packetReads=await browser.evaluate('window.__packetReads');
  await clickSelector('[data-action="download-packet"]');
  await browser.waitFor(`document.querySelector('#image-error').textContent.includes(${JSON.stringify(invalidBundleError.error)})`);
  assert.equal(await browser.evaluate('window.__jsonDownloads'),downloadCount,'缓存旧JSON不能继续下载');assert.equal(await browser.evaluate('window.__packetReads'),packetReads+1);
  await clickSelector('[data-action="dismiss"]');
  await click('image-copy-prompt');
  await browser.waitFor(`document.querySelector('#image-error').textContent.includes(${JSON.stringify(invalidBundleError.error)})`);
  assert.equal(await browser.evaluate('window.__copiedPrompts.length'),0,'旧提示词不能绕过当前审核门禁复制');assert.equal(await browser.evaluate('window.__packetReads'),packetReads+2);
  await clickSelector('[data-action="dismiss"]');
  await click('image-download-bundle');
  await browser.waitFor(`document.querySelector('#image-error').textContent.includes(${JSON.stringify(invalidBundleError.error)})`);
  await clickSelector('[data-action="dismiss"]');
  report.checks.push('人物参考换版使受影响分镜图需复核；旧参考、旧图及选用历史均保留，缓存JSON下载、旧提示词复制及ZIP均被当前门禁拒绝');
  // Change saved upstream without replacing pictures. The user edit survives restart.
  creative=app.creative.view(project.id);
  app.creative.update(project.id,{revision:creative.revision,instructions:creative.instructions+'\n【变更测试】第二镜改为更近的景别，须人工复核旧图。'});
  ws=await view();assert.ok(ws.assets.every(asset=>asset.stale));
  await click('image-refresh');await screenshot('needs-review.png');
  const history=JSON.stringify(ws.selectionHistory),ids=ws.assets.map(asset=>asset.id),hashes=ws.assets.map(asset=>asset.sha256);
  await app.close();app=createStudio(options);base=await listen();
  await browser.call('Page.navigate',{url:`${base}/images.html?projectId=${project.id}`});
  await browser.waitFor(`document.querySelectorAll(${JSON.stringify(q('image-asset'))}).length===7`);
  const restored=await view();assert.deepEqual(restored.assets.map(a=>a.id),ids);assert.deepEqual(restored.assets.map(a=>a.sha256),hashes);assert.equal(JSON.stringify(restored.selectionHistory),history);assert.ok(restored.assets.every(a=>a.stale));
  await screenshot('restored.png');assert.equal(browser.messages.length,0,JSON.stringify(browser.messages));
  report.checks.push('保存输入改变后旧图片全部明确需复核；重启恢复7份实际文件、Hash、旧版、人工检查与选择历史，0页面异常');
  const removedProject=app.store.create({name:'[TEST] 移除目标后的历史图片',idea:'仅测试旧资产可见性，不生成媒体。'});
  app.creative.update(removedProject.id,{revision:0,stylePresetId:'jia.platform.distance',entities:structuredClone(fixtureEntities),shots:fixtureShots()});
  const removedView=app.images.import(removedProject.id,{revision:0,role:'shot',targetId:'SHOT-01',filename:'TEST-FIXTURE-NOT-AI-orphan.png',source:{kind:'test',description:'软件验收旧目标素材，非AI生成。'}},fs.readFileSync(fixtureFiles[2]));
  const removedAsset=removedView.assets.at(-1),oldCreative=app.creative.workspace.get(removedProject.id);
  app.creative.update(removedProject.id,{revision:oldCreative.revision,shots:oldCreative.shots.filter(shot=>shot.id!=='SHOT-01')});
  await browser.call('Page.navigate',{url:`${base}/images.html?projectId=${removedProject.id}`});
  await browser.waitFor(`!!document.querySelector('[data-asset-id="${removedAsset.id}"]')`);
  assert.ok(await browser.evaluate("document.body.textContent.includes('已移除目标的历史图片')"));
  assert.equal((await fetch(`${base}/api/projects/${removedProject.id}/image-assets/${removedAsset.id}`)).status,200);
  report.checks.push('上游移除镜头目标后，旧图片仍有独立历史入口并可下载；不因目标消失丢失原版本');
  report.passed=true;report.consoleExceptions=0;report.finishedAt=new Date().toISOString();report.assetCount=restored.assets.length;report.selectionCount=restored.selectionHistory.length;
  fs.writeFileSync(path.join(directory,'image-browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await app.close();}
