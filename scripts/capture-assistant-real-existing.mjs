// Read-only recovery of the TWO existing real text attempts; no new model call.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createStudio } from '../src/server.mjs';
import { launchBrowser } from '../tests/cdp.mjs';
const directory=path.resolve('tests/.artifacts/assistant-real-v11'),dataDir=path.join(directory,'data'),hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const calls=JSON.parse(fs.readFileSync(path.join(directory,'invocations.json')));assert.equal(calls.length,2);
const turnDirectory=path.join(dataDir,'creative-assistant-turns'),before=fs.readdirSync(turnDirectory).filter(file=>file.endsWith('.json')).map(file=>({file,hash:hash(fs.readFileSync(path.join(turnDirectory,file)))}));
const turns=before.map(item=>JSON.parse(fs.readFileSync(path.join(turnDirectory,item.file)))).sort((a,b)=>a.sequence-b.sequence),projectId=turns[0].projectId;
let denied=0;const deny=async()=>{denied++;throw new Error('此恢复检查禁止新模型或媒体调用。');};
const app=createStudio({dataDir,assistantOptions:{runner:deny},creativeOptions:{runner:deny},inspectTools:async()=>({tools:[]}),inspectImageTools:async()=>({canSubmit:false})});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const browser=await launchBrowser(path.join(directory,`recovery-${Date.now()}`)),base=`http://127.0.0.1:${app.server.address().port}`;
async function capture(name){const image=await browser.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(directory,name),Buffer.from(image.data,'base64'));}
try{
  await browser.call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await browser.call('Page.navigate',{url:`${base}/creative.html?projectId=${projectId}&stage=script`});await browser.waitFor("document.querySelector('[data-testid=assistant-turn-count]')?.textContent.includes('/ 2')");
  await browser.waitFor("document.querySelector('[data-testid=assistant-status]')?.textContent.includes('中断')");await capture('real-interrupted-recovered.png');
  await browser.evaluate("document.querySelector('[data-assistant-turn-prev]').click()");await browser.waitFor("document.querySelector('[data-testid=assistant-reply]')?.textContent.includes('温暖收束')");await capture('real-first-recovered.png');
  assert.equal(app.assistant.view(projectId).messages.length,2);assert.equal(app.assistant.view(projectId).messages[0].status,'succeeded');assert.equal(app.assistant.view(projectId).messages[1].status,'interrupted');
  const other=app.store.list('projects').values.find(project=>project.id!==projectId);assert.ok(other);await browser.call('Page.navigate',{url:`${base}/creative.html?projectId=${other.id}&stage=script`});await browser.waitFor("document.querySelector('[data-testid=assistant-turn-count]')?.textContent.trim()==='0 / 0'");assert.equal(app.assistant.view(other.id).messages.length,0);
  for(const item of before)assert.equal(hash(fs.readFileSync(path.join(turnDirectory,item.file))),item.hash);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'invocations.json'))).length,2);assert.equal(denied,0);assert.equal(browser.messages.length,0);
  const result={checkedAt:new Date().toISOString(),readOnlyRecovery:true,existingSuccessfulTurns:1,existingInterruptedTurns:1,recordsHashesUnchanged:true,refreshRecovery:true,projectIsolation:true,newCalls:0,totalRecordedCliInvocations:2,realRewriteApplyPassed:false,consoleExceptions:0,passed:true};fs.writeFileSync(path.join(directory,'recovery.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await browser.close();await app.close();}
