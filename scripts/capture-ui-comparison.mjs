// Capture both real application versions against the same isolated TEST story.
// BASELINE_REPO points to the preserved v09 worktree; no personal data is used.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createStudio } from '../src/server.mjs';
import { launchBrowser } from '../tests/cdp.mjs';
import { fixtureIdea, fixtureEntities, fixtureShots, fixtureScript } from '../tests/creative-fixtures.mjs';
assert.ok(process.env.BASELINE_REPO, '请指定保留的v09基线worktree');
const baseline = await import(pathToFileURL(path.join(process.env.BASELINE_REPO,'src/server.mjs')));
const directory=path.resolve('tests/.artifacts/ui-c-comparison');fs.mkdirSync(directory,{recursive:true});
const options={dataDir:fs.mkdtempSync(path.join(directory,'data-')),inspectTools:async()=>({tools:[]}),inspectImageTools:async()=>({canSubmit:false,message:'【TEST】自动出图关闭'})};
let app=baseline.createStudio(options);
const project=app.store.create({name:'[TEST示例] 留茶 · 三镜头',idea:fixtureIdea,durationSeconds:30,aspectRatio:'16:9',description:'【人工软件测试稿，非AI产物】老人留下一杯茶，等待归来的家人。只检查软件交互，不是正式作品。'});
app.creative.update(project.id,{revision:0,entities:fixtureEntities,shots:fixtureShots(),scriptDraft:fixtureScript().body});
app.creative.addVersion(project.id,{revision:1,kind:'script',body:fixtureScript().body});app.creative.addVersion(project.id,{revision:2,kind:'storyboard',body:'【TEST人工分镜】三镜头软件布局检查，非模型生成。'});
const bytes=fs.readFileSync('docs/video-v07-evidence/TEST-FIXTURE-NOT-AI-input.png');
for(const shot of fixtureShots()){let ws=app.images.import(project.id,{revision:app.images.get(project.id).revision,role:'shot',targetId:shot.id,filename:'TEST-FIXTURE-NOT-AI.png',source:{kind:'test',description:'已有TEST图片，仅软件布局验收，非AI生成。'}},bytes);const asset=ws.assets.at(-1);ws=app.images.review(project.id,{revision:ws.revision,assetId:asset.id,verdict:'accepted',notes:'仅核对TEST软件夹具'});app.images.select(project.id,{revision:ws.revision,assetId:asset.id});}
const browser=await launchBrowser(path.join(directory,`chrome-${Date.now()}`));
try {
  await browser.call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  for(const version of ['before','after']){
    if(version==='after'){await app.close();app=createStudio(options);}
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.server.address().port}`;
    for(const [name,route,selector]of[['story','/','#project-name'],['script','/creative.html?stage=script','[data-testid=creative-script-draft]'],['storyboard','/creative.html?stage=storyboard','[data-testid=creative-shots]'],['images','/images.html','[data-testid=image-target]']]){
      await browser.evaluate("document.documentElement.dataset.leaving='true'");await browser.call('Page.navigate',{url:base+route+(route.includes('?')?'&':'?')+`projectId=${project.id}`});
      const ready=name==='story'?"!!document.querySelector('#project-name')||!!document.querySelector('#name')":name==='images'?"!!document.querySelector('[data-testid=image-target]')":name==='storyboard'?"!!document.querySelector('[data-testid=creative-preset]')":`!!document.querySelector(${JSON.stringify(selector)})`;
      await browser.waitFor(`!document.documentElement.dataset.leaving&&document.readyState==='complete'&&(${ready})`,60000);
      if(version==='after')await browser.waitFor("document.querySelectorAll('[data-studio-step][data-status]').length===7");
      if(name==='images'||name==='storyboard'&&version==='after')await browser.waitFor("[...document.images].some(image=>image.complete&&image.naturalWidth>0)");
      const screenshot=await browser.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(directory,`${version}-${name}.png`),Buffer.from(screenshot.data,'base64'));
    }
  }
  assert.equal(browser.messages.length,0,JSON.stringify(browser.messages));fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({baseline:'1900352f1ff4fd6142906d4a89e437bd700b932f',sameIsolatedStory:true,testMediaOnly:true,width:1440,height:900,newModelOrMediaCalls:0,consoleExceptions:0,passed:true},null,2)+'\n');console.log('同一独立TEST项目的真实基线/新版故事、剧本、分镜、画面截图完成。');
} finally {await browser.close();await app.close();}
