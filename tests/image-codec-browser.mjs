// Real Chrome HTTP upload/download/decode for explicit non-AI codec fixtures.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createStudio} from '../src/server.mjs';
import {launchBrowser} from './cdp.mjs';
import {fixtureEntities,fixtureShots} from './creative-fixtures.mjs';
import {imageCodecFixtures} from './image-codec-fixtures.mjs';
const directory=path.resolve('tests/.artifacts/image-codecs');fs.mkdirSync(directory,{recursive:true});
const root=fs.mkdtempSync(path.join(directory,'data-'));
const app=createStudio({dataDir:root,inspectTools:async()=>({checkedAt:new Date().toISOString(),tools:[]}),inspectImageTools:async()=>({mode:'manual',automaticImageGeneration:'not_verified',costStatus:'unknown'})});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${app.server.address().port}`;
const project=app.store.create({name:'[TEST FIXTURE / NOT AI] JPEG/WebP',idea:'明确软件验收故事，阴天老人等茶。'});
app.creative.update(project.id,{revision:0,entities:structuredClone(fixtureEntities),shots:fixtureShots(),stylePresetId:'jia.platform.distance'});
app.creative.addVersion(project.id,{revision:1,kind:'storyboard',body:'【软件测试人工稿】三镜头30秒。'});
const browser=await launchBrowser(path.join(directory,'browser'));
const report={at:new Date().toISOString(),isolatedTestFixtures:true,modelOrMediaGenerationCalls:0,codecs:[]};
try{
 await browser.call('Page.navigate',{url:base+'/api/health'});
 await browser.waitFor("document.body.textContent.includes('AI-Drama-Studio')");
 for(const [format,base64]of Object.entries(imageCodecFixtures)){
  const result=await browser.evaluate(`(async()=>{const route='/api/projects/${project.id}/images';const view=await(await fetch(route)).json();const metadata={revision:view.revision,role:'shot',targetId:'SHOT-01',filename:'TEST-FIXTURE-NOT-AI.${format}',source:{kind:'test',description:'明确TEST FIXTURE / NOT AI像素，真实Chrome Canvas编码，仅软件验收。'}};const response=await fetch(route+'/import',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Image-Metadata':encodeURIComponent(JSON.stringify(metadata))},body:Uint8Array.from(atob(${JSON.stringify(base64)}),c=>c.charCodeAt(0))});const imported=await response.json();if(!response.ok)throw new Error(JSON.stringify(imported));const asset=imported.assets.at(-1);const img=new Image();img.src=asset.url;await img.decode();document.body.append(img);const bytes=await(await fetch(asset.url)).arrayBuffer();return{status:response.status,asset:{id:asset.id,format:asset.format,width:asset.width,height:asset.height,mimeType:asset.mimeType,source:asset.source},decodedWidth:img.naturalWidth,decodedHeight:img.naturalHeight,downloadedSize:bytes.byteLength};})()`);
  assert.equal(result.asset.format,format);assert.equal(result.decodedWidth,160);assert.equal(result.decodedHeight,90);assert.equal(result.downloadedSize,Buffer.from(base64,'base64').length);report.codecs.push(result);
 }
 assert.equal(browser.messages.length,0,JSON.stringify(browser.messages));report.consoleExceptions=0;report.passed=true;fs.writeFileSync(path.join(directory,'http-browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await app.close();}
