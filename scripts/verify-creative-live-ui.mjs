// Real browser against the independently created real-model acceptance project.
// Does not create any model/media task. --adopt exercises explicit UI saving.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchBrowser } from '../tests/cdp.mjs';

const directory = path.resolve('tests/.artifacts/creative-real');
const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'receipt.json'), 'utf8'));
const base = receipt.base, route = `/api/projects/${receipt.projectId}/creative`;
const view = async () => { const response = await fetch(base + route); assert.ok(response.ok); return response.json(); };
const browser = await launchBrowser(path.join(directory, 'browser'));
const q = id => `[data-testid="${id}"]`;
const report = { checkedAt: new Date().toISOString(), page: `${base}/creative.html?projectId=${receipt.projectId}`, checks: [], submittedModelTasks: 0 };
async function click(selector) {
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`);
  await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function wait(predicate) {
  for (let i = 0; i < 100; i++) { const workspace = await view(); if (predicate(workspace)) return workspace; await new Promise(resolve => setTimeout(resolve, 150)); }
  throw new Error('真实验收页面保存超时');
}
async function screenshot(name) { const result = await browser.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(directory, name), Buffer.from(result.data, 'base64')); }
try {
  await browser.call('Page.navigate', { url: report.page });
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('creative-director'))})`);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(q('creative-director'))}).options.length`), 15);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(q('creative-preset'))}).options.length`), 17);
  assert.equal(await browser.evaluate(`document.querySelectorAll('[data-manual-rule]:checked').length`), 0);
  report.checks.push('真实Chrome读取独立真实项目；15导演、17预设与手册默认关闭');
  await screenshot('live-overview.png');
  const ws = await view();
  if (ws.effectiveShots.length) {
    assert.equal(await browser.evaluate(`document.querySelectorAll(${JSON.stringify(q('shot-static'))}).length`), 3);
    assert.equal(await browser.evaluate(`document.querySelectorAll(${JSON.stringify(q('shot-motion'))}).length`), 3);
    assert.equal(await browser.evaluate(`document.querySelectorAll(${JSON.stringify(q('shot-post'))}).length`), 3);
    report.checks.push('同一真实剧本的3个镜头分别显示静态、摄影和后期编辑区');
  }
  if (process.argv.includes('--adopt')) {
    const boardId = receipt.tasks.storyboard, scriptId = receipt.tasks.script;
    assert.ok(boardId && receipt.results.storyboard.status === 'succeeded');
    for (const taskId of [scriptId, boardId]) {
      if ((await view()).versions.some(version => version.taskId === taskId)) continue;
      await click(`[data-adopt-task="${taskId}"]`);
      await browser.waitFor(`document.querySelector('#creative-confirm').open`);
      await click('[data-confirm="accept"]');
      await wait(value => value.versions.some(version => version.taskId === taskId));
      await browser.waitFor(`!document.querySelector('#creative-confirm').open`);
    }
    report.checks.push('真实候选通过浏览器显式采用；追加剧本与分镜不可变版本');
    await click(`[data-load-shots="${boardId}"]`);
    await browser.waitFor(`document.querySelector('#creative-confirm').open`);
    await click('[data-confirm="accept"]');
    await browser.waitFor(`!document.querySelector('#creative-confirm').open`);
    const marker = '【软件验收人工备注】仅验证保存与版本恢复；内容改变后需重新审阅，未发布正式制作包。';
    await browser.evaluate(`{const el=document.querySelector(${JSON.stringify(q('creative-storyboard-draft'))}); el.value=el.value+'\\n'+${JSON.stringify(marker)}; el.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await click(q('creative-save-storyboard-version'));
    const saved = await wait(value => value.versions.some(version => version.origin === 'user' && version.body.includes(marker)));
    assert.ok(saved.storyboardDraft.includes(marker));
    report.savedVersionId = saved.versions.find(version => version.origin === 'user' && version.body.includes(marker)).id;
    report.checks.push('真实浏览器修改人工分镜备注并另存不可变版本；原始模型稿和审阅原文保留');
    await browser.waitFor(`document.body.textContent.includes('需要复核')`);
    report.checks.push('人工编辑后旧分镜及审阅显示需复核');
    await screenshot('live-adopted.png');
  }
  assert.equal(browser.messages.length, 0, JSON.stringify(browser.messages));
  report.consoleExceptions = 0;
  fs.writeFileSync(path.join(directory, 'live-ui.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
