// Interface inventory only. Uses labeled TEST data; never invokes a model.
import fs from 'node:fs';import path from 'node:path';
import {createStudio} from '../src/server.mjs';import {launchBrowser} from './cdp.mjs';
import {fixtureIdea,fixtureEntities,fixtureShots,fixtureScript} from './creative-fixtures.mjs';
const dir=path.resolve('tests/.artifacts/i18n-v12');fs.mkdirSync(dir,{recursive:true});
const app=createStudio({dataDir:fs.mkdtempSync(path.join(dir,'data-')),inspectTools:async()=>({tools:[]}),inspectImageTools:async()=>({canSubmit:false,message:'TEST / NOT AI'}),creativeOptions:{runner:async()=>{throw new Error('NO MODEL CALLS');}}});
const project=app.store.create({name:'TEST PROJECT',idea:fixtureIdea,durationSeconds:30,aspectRatio:'16:9'});app.creative.update(project.id,{revision:0,entities:fixtureEntities,shots:fixtureShots(),scriptDraft:fixtureScript().body});app.creative.addVersion(project.id,{revision:1,kind:'script',body:fixtureScript().body});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.server.address().port}`;let pref=await(await fetch(base+'/api/studio/preferences')).json();await fetch(base+'/api/studio/preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:pref.revision,language:'en',theme:'light'})});
const browser=await launchBrowser(path.join(dir,'chrome'));
const report={pages:{},realModelCalls:0};
try{
 for(const route of ['/','/creative.html?stage=script','/creative.html?stage=storyboard','/images.html','/script.html','/video.html','/canvas-video.html','/timeline.html','/resources.html?section=entities','/resources.html?section=style','/resources.html?section=budget','/resources.html?section=settings','/video-channel.html',...['services','general','style','directors','entities','prompts','video','voice','editing','storage'].map(page=>'/studio.html?page='+page)]){
  await browser.evaluate("document.documentElement.dataset.departing='1'");await browser.call('Page.navigate',{url:base+route+(route.includes('?')?'&':'?')+'projectId='+project.id});await browser.waitFor("!document.documentElement.dataset.departing && !!document.querySelector('.studio-frame') && document.documentElement.lang==='en'");await new Promise(resolve=>setTimeout(resolve,150));
  const values=await browser.evaluate("(()=>{const excluded='pre,code,textarea,option,[data-user-content],[data-project-id],.studio-top-projects,.studio-breadcrumb-project,.assistant-reader-copy,.script-history-page,.creative-current-body,.creative-version-body,.creative-preset-info,.creative-rule-list,.resource-rules,.resource-item p,.v12-object-description';const all=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const p=node.parentElement;if(!p||p.closest(excluded)||!/[\\u3400-\\u9fff]/.test(node.textContent)||!p.getClientRects().length)continue;all.push({text:node.textContent.trim(),tag:p.tagName,classes:p.className})}return all.filter(row=>row.text)})()");report.pages[route]=values;
 }
 fs.writeFileSync(path.join(dir,'inventory.json'),JSON.stringify(report,null,2));console.log(JSON.stringify([...new Set(Object.values(report.pages).flat().map(row=>row.text))],null,2));
}finally{await browser.close();await app.close();}
