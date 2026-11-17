// Layout and interaction acceptance of the real application with labeled TEST
// media. Provider operations are denied; local MP4 export is the existing path.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createStudio } from '../src/server.mjs';
import { createTimelineFixture } from './timeline-fixtures.mjs';
import { launchBrowser } from './cdp.mjs';
const directory = path.resolve('tests/.artifacts/ui-c-media'); fs.mkdirSync(directory, { recursive: true });
const fixture = await createTimelineFixture({ name: '[TEST示例] 等一杯茶 · 30秒' });
const calls = { generation: 0, confirm: 0 }, deny = async () => { calls.generation++; throw new Error('C版UI验收禁止真实生成'); };
const app = createStudio({ dataDir: fixture.store.root, videoOptions: { adapter: { inspect: async () => ({ canSubmit: false, realSubmissionEnabled: false, auth: { loggedIn: false }, models: [], defaults: {}, message: '【隔离UI检查】直连认证与价格未配置。' }), submit: deny } }, canvasVideoOptions: { adapter: { inspectPlan: deny, submit: deny, query: deny, download: deny } }, inspectTools: async () => ({ checkedAt: new Date().toISOString(), tools: [], platform: 'ui-fixture' }), inspectImageTools: async () => ({ canSubmit: false, message: '自动出图保持关闭' }) });
const projectId = fixture.project.id, blank = app.store.create({ name: '[TEST] 空白项目', idea: '' });
let timeline = app.timeline.update(projectId, { revision: 0, clips: fixture.assets.map(asset => ({ assetId: asset.id })), audioMode: 'preserve' });
const prepared = app.timeline.prepareExport(projectId, { revision: timeline.revision }); assert.equal((await app.timeline.startExport(prepared.id)).status, 'succeeded');
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${app.server.address().port}`;
const browser = await launchBrowser(path.join(directory, `chrome-${Date.now()}`));
const report = { startedAt: new Date().toISOString(), explicitTestMedia: true, realGenerations: 0, realConfirmations: 0, sizes: [], checks: [] };
async function navigate(route) { const url = base + route; await browser.call('Page.navigate', { url }); await browser.waitFor(`location.href===${JSON.stringify(url)}&&document.readyState==='complete'&&!!document.querySelector('.studio-frame')&&document.querySelectorAll('[data-studio-step]').length===6`, 30000); }
async function screenshot(name) { const image = await browser.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(directory, name), Buffer.from(image.data, 'base64')); }
async function geometry(label) { const value = await browser.evaluate(`(()=>{const b=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};return{panel:b(document.querySelector('.studio-panel')),header:b(document.querySelector('.studio-header')),main:b(document.querySelector('.studio-main')),footer:b(document.querySelector('.studio-footer')),scroll:document.documentElement.scrollWidth,viewport:innerWidth,labels:[...document.querySelectorAll('[data-studio-step] .studio-step-label')].map(n=>n.textContent)}})()`); assert.ok(value.main.x >= value.panel.right - 1, label); assert.ok(value.main.y >= value.header.bottom - 1, label); assert.ok(value.main.bottom <= value.footer.y + 1, label); assert.ok(value.scroll <= value.viewport + 1, JSON.stringify({ label, value })); assert.deepEqual(value.labels, ['剧本','角色与场景','分镜拆解','提示词','配音与声音','剪辑与导出（剪映）']); return value; }
try {
  for (const [width, height] of [[1366, 768], [1440, 900]]) {
    await browser.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    for (const [name, route] of [['video', '/canvas-video.html'], ['direct', '/video.html'], ['finishing', '/timeline.html?view=finishing'], ['export', '/timeline.html?view=export'], ['entities', '/resources.html?section=entities'], ['style', '/resources.html?section=style'], ['budget', '/resources.html?section=budget'], ['settings', '/resources.html?section=settings'], ['channel', '/video-channel.html']]) {
      await navigate(route + (route.includes('?') ? '&' : '?') + `projectId=${projectId}`); await geometry(`${name}-${width}`);
      assert.equal(await browser.evaluate("document.querySelectorAll('.workflow,.creative-route,.video-route,.canvas-stage').length"), 0);
      await screenshot(`${name}-${width}x${height}.png`);
    }
    report.sizes.push({ width, height, pages: 9, noOverlap: true, noHorizontalScroll: true });
  }
  report.checks.push('视频两渠道、配音剪辑、导出及四资源/渠道记录共9页，两桌面尺寸单文字左侧/六Agent/底栏一致，无覆盖或横向滚动');
  await navigate(`/timeline.html?view=export&projectId=${projectId}`);
  await browser.waitFor("!!document.querySelector('#timeline-exports video')", 30000);
  const decode = await browser.evaluate("(async()=>{const video=document.querySelector('#timeline-exports video');if(video.readyState<1)await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=reject});video.muted=true;await video.play();video.pause();return{width:video.videoWidth,height:video.videoHeight,duration:video.duration}})()"); assert.equal(decode.width, 1280); assert.equal(decode.height, 720); assert.equal(decode.duration, 15); report.decodedTestExport = decode;
  report.checks.push('真实本地TEST导出视频在新页面实际解码播放，原下载/manifest和本地导出功能保留');
  const creative = app.creative.workspace.get(projectId), catalog = app.creative.catalog(), preset = catalog.presets.find(item => item.id === creative.stylePresetId), director = catalog.directors.find(item => item.id === preset.directorId);
  const rule = (preset.manualDerivedRules ?? director.manual_derived_rules)[0]; assert.ok(rule);
  app.creative.update(projectId, { revision: creative.revision, manualRuleIds: [rule.id] });
  await navigate(`/resources.html?section=style&projectId=${projectId}`); await browser.evaluate("document.querySelector('[data-studio-action=primary]').click()"); await browser.waitFor("document.querySelector('#toast').textContent.includes('风格已保存')");
  assert.deepEqual(app.creative.workspace.get(projectId).manualRuleIds, [rule.id]);
  assert.equal(await browser.evaluate("document.querySelector('[data-studio-action=primary]').disabled"), false, '保存后仍可继续应用风格');
  report.checks.push('风格库真实保存复用原API，同一风格保留已选手册规则，不清空用户设置');
  await navigate(`/resources.html?section=budget&projectId=${projectId}`); await browser.evaluate("{const node=document.querySelector('#resource-budget');node.value='80';node.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-studio-action=primary]').click()}");
  await browser.waitFor("document.querySelector('#toast').textContent.includes('预算计划已保存')"); assert.equal(app.store.read('projects', projectId).budgetCap, 80);
  assert.equal(await browser.evaluate("document.querySelector('[data-studio-action=primary]').disabled"), false, '保存后可继续编辑并保存预算');
  await navigate(`/canvas-video.html?projectId=${projectId}`); await browser.waitFor("[...document.querySelectorAll('[data-studio-step]')].some(n=>n.dataset.studioStep==='images'&&n.dataset.status==='needs_review')||[...document.querySelectorAll('[data-studio-step]')].some(n=>n.getAttribute('title')?.includes('复核'))");
  report.checks.push('资源预算真实保存不收费；输入变化后共享左侧按现有Hash规则显示受影响后续需复核');
  await navigate(`/canvas-video.html?projectId=${blank.id}`); assert.ok(await browser.evaluate("document.body.textContent.includes('尚无')||document.body.textContent.includes('待检查')")); assert.equal(await browser.evaluate("document.querySelector('[data-studio-action=primary]').disabled"), true);
  report.checks.push('空项目没有假预览/完成状态，无可用图片时主动作禁用并解释条件');
  assert.deepEqual(calls, { generation: 0, confirm: 0 }); assert.equal(browser.messages.length, 0, JSON.stringify(browser.messages)); report.consoleExceptions = 0; report.passed = true; report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); await app.close(); fixture.timeline.close(); }
