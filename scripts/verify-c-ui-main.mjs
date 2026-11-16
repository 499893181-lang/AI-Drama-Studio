// Explicit read-only browser acceptance of the existing local service. Does
// not click save, model, preparation, quote, approval or generation controls.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { launchBrowser } from '../tests/cdp.mjs';
const base = process.env.STUDIO_URL ?? 'http://127.0.0.1:4320';
const projectId = process.env.UI_TEST_PROJECT_ID ?? '437306c6-d0b8-4b1b-86b4-6c259c89b006';
const directory = path.resolve('tests/.artifacts/ui-c-main'); fs.mkdirSync(directory, { recursive: true });
const get = async route => { const response = await fetch(base + route); assert.equal(response.status, 200, route); return response.json(); };
const health = await get('/api/health'), project = await get(`/api/projects/${projectId}`);
assert.equal(health.version, '0.9.0'); assert.equal((await get(`/api/projects/${projectId}/workflow`)).testFixture, true, '验收必须使用已有明确标注TEST媒体');
const report = { checkedAt: new Date().toISOString(), serviceVersion: health.version, existingProjectReadOnly: true, usesLabeledTestMedia: true, screenshotsPrivateUntilReviewed: true, readOnly: true, newModelCalls: 0, newMediaCalls: 0, newConfirmations: 0, pages: [] };
const browser = await launchBrowser(path.join(directory, `chrome-${Date.now()}`));
try {
  for (const [width, height] of [[1366,768],[1440,900]]) {
    await browser.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    for (const [name, route] of [['story','/'],['script','/creative.html?stage=script'],['storyboard','/creative.html?stage=storyboard'],['images','/images.html'],['video','/canvas-video.html'],['finishing','/timeline.html?view=finishing'],['export','/timeline.html?view=export'],['entities','/resources.html?section=entities'],['style','/resources.html?section=style'],['budget','/resources.html?section=budget'],['settings','/resources.html?section=settings']]) {
      await browser.evaluate("document.documentElement.dataset.leaving='true'");
      await browser.call('Page.navigate', { url: base + route + (route.includes('?') ? '&' : '?') + `projectId=${projectId}` });
      await browser.waitFor(`!document.documentElement.dataset.leaving&&document.readyState==='complete'&&document.querySelector('.studio-breadcrumb-project')?.textContent===${JSON.stringify(project.name)}&&document.querySelectorAll('[data-studio-step][data-status]').length===7`, 90000);
      const geometry = await browser.evaluate(`(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom}};return{panel:box('.studio-panel'),main:box('.studio-main'),header:box('.studio-header'),footer:box('.studio-footer'),width:innerWidth,scrollWidth:document.documentElement.scrollWidth,steps:[...document.querySelectorAll('[data-studio-step]')].map(n=>({label:n.querySelector('.studio-step-label').textContent,status:n.dataset.status})),duplicate:document.querySelectorAll('.workflow,.creative-route,.video-route,.canvas-stage,.timeline-route').length}})()`);
      assert.equal(geometry.duplicate,0); assert.equal(geometry.steps.length,7); assert.ok(geometry.main.x>=geometry.panel.right-1); assert.ok(geometry.main.y>=geometry.header.bottom-1); assert.ok(geometry.main.bottom<=geometry.footer.y+1); assert.ok(geometry.scrollWidth<=width+1);
      if (name === 'storyboard' || name === 'images') await browser.waitFor("[...document.querySelectorAll('.studio-main img')].some(image=>image.complete&&image.naturalWidth>0)", 30000);
      if (name === 'export') { await browser.waitFor("!!document.querySelector('[data-testid=timeline-export-preview]')"); const decoded = await browser.evaluate("(async()=>{const video=document.querySelector('[data-testid=timeline-export-preview]');if(video.readyState<1)await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=reject});video.muted=true;await video.play();video.pause();return{width:video.videoWidth,height:video.videoHeight,duration:video.duration}})()"); assert.equal(decoded.duration,15); report.actualTestExport=decoded; }
      const shot=await browser.call('Page.captureScreenshot',{format:'png'}); const file=`after-${name}-${width}x${height}.png`; fs.writeFileSync(path.join(directory,file),Buffer.from(shot.data,'base64'));
      report.pages.push({name,width,height,noOverlap:true,noHorizontalScroll:true,steps:geometry.steps,screenshot:file});
    }
  }
  const generations=await get(`/api/projects/${projectId}/images/generation`); assert.equal(generations.usageLimit.maxSubmissions,1); assert.equal(generations.usageLimit.submitted,1); assert.equal(generations.usageLimit.remaining,0); report.originalImageUsage=generations.usageLimit;
  const original=await get('/api/image-generation-tasks/8eb1182e-5a89-47fe-9220-2e1ea08c1f00'); assert.equal(original.status,'failed'); assert.equal(original.result,null); report.originalFailurePreserved=true;
  if (process.env.UI_ORIGINAL_DATA_DIR && process.env.UI_PRESERVATION_MANIFEST) {
    const before=JSON.parse(fs.readFileSync(process.env.UI_PRESERVATION_MANIFEST,'utf8'));
    for(const item of before){ const bytes=fs.readFileSync(path.join(process.env.UI_ORIGINAL_DATA_DIR,item.path));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),item.sha256,item.path);assert.equal(bytes.length,item.bytes,item.path); }
    report.originalData={sameDirectory:true,existingFilesVerified:before.length,allHashesUnchanged:true,lockFileExcluded:true};
  }
  assert.equal(browser.messages.length,0,JSON.stringify(browser.messages)); report.consoleExceptions=0; report.passed=true; report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
} finally { await browser.close(); }
