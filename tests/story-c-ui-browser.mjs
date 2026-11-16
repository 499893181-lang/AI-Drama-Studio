// C-adjusted story UX against the real app. No model or media task is started.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createStudio } from '../src/server.mjs';
import { launchBrowser } from './cdp.mjs';

const directory = path.resolve('tests/.artifacts/story-c-ui'); fs.mkdirSync(directory, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(directory, 'data-'));
const options = { dataDir, inspectTools: async () => ({ tools: [], checkedAt: new Date().toISOString() }), creativeOptions: { runner: async () => { throw new Error('This story UX test must not invoke a model.'); } } };
let app = createStudio(options);
async function listen() { await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${app.server.address().port}`; }
let base = await listen();
const browser = await launchBrowser(path.join(directory, 'chrome'));
const query = name => `[data-testid="${name}"]`;
const api = async route => { const response = await fetch(base + route); assert.equal(response.ok, true); return response.json(); };
async function click(selector) { await browser.waitFor(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`); await browser.evaluate(`{const node=document.querySelector(${JSON.stringify(selector)});for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;node.scrollIntoView({block:'center'});node.click();}`); }
async function fill(name, value) { const selector = query(name); await browser.waitFor(`!!document.querySelector(${JSON.stringify(selector)})`); await browser.evaluate(`{const node=document.querySelector(${JSON.stringify(selector)});node.value=${JSON.stringify(value)};node.dispatchEvent(new Event('input',{bubbles:true}));}`); }
async function screenshot(name) { const image = await browser.call('Page.captureScreenshot', { format:'png', captureBeyondViewport:false }); fs.writeFileSync(path.join(directory, name), Buffer.from(image.data,'base64')); }
const report = { checkedAt: new Date().toISOString(), fixturesOnly:true, realModelOrMediaInvoked:false, checks:[] };
try {
  await browser.call('Emulation.setDeviceMetricsOverride', { width:1366, height:768, deviceScaleFactor:1, mobile:false });
  await browser.call('Page.navigate', { url:base }); await browser.waitFor("!!document.querySelector('.studio-frame')");
  assert.equal(await browser.evaluate("document.querySelectorAll('.studio-steps [data-studio-step]').length"), 7);
  assert.ok(await browser.evaluate("!!document.querySelector('.studio-rail')&&!!document.querySelector('.studio-panel')&&!document.querySelector('.workflow')"));
  await screenshot('story-empty-1366.png'); report.checks.push('空项目保留窄图标栏、项目面板及七步制作流程，顶部无重复流程，主操作明确新建故事');
  await click(query('new-project')); await fill('name','[TEST] C版故事·山间来信');
  const idea='【独立软件测试】少年在山间车站收到一封迟到的信，守站人帮助他找到收信人。保留信件和温暖结局。';
  await fill('idea',idea); assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(query('duration'))}).value`),'30');
  await click(query('aspect-landscape')); await click('.story-settings>summary'); await fill('style','明确TEST输入，朴素写实；没有图片或视频生成。'); await fill('budget','120');
  await click(query('save-project')); await browser.waitFor("document.querySelector('#save-state')?.textContent.includes('已保存')");
  let projects=(await api('/api/projects')).projects; assert.equal(projects.length,1); const project=projects[0];
  assert.equal(project.aspectRatio,'16:9');assert.equal(project.style,'明确TEST输入，朴素写实；没有图片或视频生成。');assert.equal(project.budgetCap,120);
  report.checks.push('故事名称/构思突出，30秒默认值、画幅、折叠画风/预算可修改并真实保存；没有模型调用');
  const longIdea=idea+'\n'+('这是一段明确标注的软件测试长文本，用于验证换行和可编辑区域，不是模型生成。'.repeat(35));
  await fill('idea',longIdea);
  for(const [width,height] of [[1366,768],[1440,900]]){
    await browser.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await browser.evaluate("document.querySelector('.studio-main').scrollTop=0");
    const layout=await browser.evaluate("(()=>{const main=document.querySelector('.studio-main').getBoundingClientRect(),footer=document.querySelector('.studio-footer').getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,mainBottom:main.bottom,footerTop:footer.top,footerBottom:footer.bottom,height:innerHeight,projectFacts:document.querySelector('.studio-project-facts').textContent};})()");
    assert.ok(layout.scroll<=width); assert.ok(layout.mainBottom<=layout.footerTop+1);assert.ok(layout.footerBottom<=height+1);assert.ok(layout.projectFacts.includes('30秒')&&layout.projectFacts.includes('16:9'));
    await screenshot(`story-edit-${width}.png`);
  }
  report.checks.push('1366×768与1440×900长文本编辑时主区与底部操作区分离，无横向滚动或按钮遮挡');
  await click('[data-studio-action="primary"]'); await browser.waitFor("location.pathname==='/creative.html'&&new URLSearchParams(location.search).get('stage')==='script'");
  const stored=await api(`/api/projects/${project.id}`);assert.equal(stored.idea,longIdea);assert.equal(stored.revision,2);
  report.checks.push('底部“保存故事并继续”先保存未提交修改再进入真实剧本步骤，不跳转到即梦费用门槛');
  await app.close(); app=createStudio(options); base=await listen();
  await browser.call('Page.navigate',{url:`${base}/?projectId=${project.id}`});await browser.waitFor(`document.querySelector(${JSON.stringify(query('idea'))})?.value===${JSON.stringify(longIdea)}`);
  assert.equal(app.store.list('jobs').values.length,0); assert.equal(app.store.list('creative-jobs').values.length,0);
  report.checks.push('服务重启和按projectId打开恢复保存的故事及全部设置，没有新任务或伪造进度');
  assert.equal(browser.messages.length,0,JSON.stringify(browser.messages));report.consoleExceptions=0;report.passed=true;
} catch(error) { report.passed=false;report.error=error.stack;try{await screenshot('story-failure.png');}catch{};throw error; }
finally { report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));await browser.close();await app.close(); }
