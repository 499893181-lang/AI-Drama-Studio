// Isolated UI fixtures only. Never invokes a model, media generator or real account.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStudio } from '../src/server.mjs';
import { launchBrowser } from './cdp.mjs';

const artifacts = path.resolve('tests/.artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(artifacts, 'script-browser-data-'));
const browserArtifacts = path.join(artifacts, 'stage2-browser');
let fixtureStore;
const calls = { submit: 0, query: 0, review: 0, verify: 0 };
const fixtureAdapter = {
  async inspect() { return { installed: true, loggedIn: true, version: 'UI-fixture', path: null, message: '隔离界面测试夹具，不是真实账号状态。' }; },
  async verifyBinding(binding) { calls.verify++; return { ...binding, verified: true, title: '隔离测试画布' }; },
  async submit() { calls.submit++; throw new Error('隔离UI测试禁止提交生成'); },
  async query() { calls.query++; throw new Error('隔离UI测试没有远端任务'); },
};
const fixtureReviewer = {
  start({ project, scriptVersion, inputHash }) {
    calls.review++;
    const report = { verdict: 'PASS', summary: '隔离报告显示夹具，不是Codex运行结果。', criteria: ['user_requirements', 'motivation', 'logic', 'duration', 'continuity', 'production'].map(id => ({ id, verdict: 'PASS', evidence: '仅用于验证界面逐项证据展示。', issues: [] })), issues: [], estimatedDurationSeconds: 30, durationBasis: '隔离测试常量，不是真实测量。' };
    return fixtureStore.write('script-reviews', { id: randomUUID(), projectId: project.id, versionId: scriptVersion.id, inputHash, sourceHash: scriptVersion.sourceHash, provider: 'isolated-ui-fixture', status: 'succeeded', report, events: [], error: null, message: '隔离夹具报告', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  },
  close() {}, cancel() { throw new Error('没有运行中的夹具审阅'); },
};
const options = { dataDir, scriptOptions: { adapter: fixtureAdapter, reviewer: fixtureReviewer }, inspectTools: async () => ({ checkedAt: new Date().toISOString(), tools: [] }) };
let app = createStudio(options);
fixtureStore = app.store;
const project = app.store.create({ name: '[隔离测试] 剧本版本与费用保护', idea: '雨夜父子在车站相认，保留怀表和温暖结局。', creativeBrief: { synopsis: '修表师在雨夜与父亲相逢。', background: '末班车站檐下。', characters: '父子先以陌生人的身份相遇。', conflict: '身份尚未确认。', emotion: '迟疑到释怀。', ending: '父子温暖相认。', preservedContent: ['怀表', '雨夜', '温暖结局'], addedSettings: ['檐下暖光。'] }, budgetCap: 80 });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
let base = `http://127.0.0.1:${app.server.address().port}`;
const browser = await launchBrowser(browserArtifacts);
const report = { startedAt: new Date().toISOString(), isolatedFixturesOnly: true, realGenerationOrReviewInvoked: false, checks: [] };
const q = name => `[data-testid="${name}"]`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function click(name) {
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q(name))}) && !document.querySelector(${JSON.stringify(q(name))}).disabled`);
  await browser.evaluate(`document.querySelector(${JSON.stringify(q(name))}).click()`);
}
async function fill(name, value) {
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q(name))}) && !document.querySelector(${JSON.stringify(q(name))}).disabled`);
  await browser.evaluate(`(() => { const e=document.querySelector(${JSON.stringify(q(name))}); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
}
async function get(route, method = 'GET', data) {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${value.error}`);
  return value;
}
async function waitWorkspace(predicate) {
  for (let i = 0; i < 100; i++) { const value = await get(`/api/projects/${project.id}/script`); if (predicate(value)) return value; await pause(100); }
  throw new Error('隔离工作区状态超时');
}
try {
  await browser.call('Page.navigate', { url: `${base}/script.html?projectId=${project.id}` });
  await browser.waitFor(`document.querySelector(${JSON.stringify(q('script-input-engine'))})?.value.includes('修表师')`);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(q('script-cost-status'))}).textContent`), '费用待确认');
  report.checks.push('从已保存创作说明整理输入并显示未知费用');
  await fill('remote-project-id', 'fixture-real-shape-canvas');
  await fill('remote-team-id', '0');
  await click('verify-binding');
  await waitWorkspace(ws => ws.binding.verified === true);
  assert.equal(calls.verify, 1);
  report.checks.push('通过显式按钮保存并核对画布绑定（隔离适配器）');
  await click('prepare-script');
  let workspace = await waitWorkspace(ws => ws.tasks.length === 1);
  await browser.waitFor(`!!document.querySelector('[data-submit-task]')`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-submit-task]').disabled`), true);
  assert.equal(workspace.tasks[0].status, 'awaiting_cost');
  const preparedId = workspace.tasks[0].requestId;
  await click('prepare-script');
  workspace = await waitWorkspace(ws => ws.tasks.length === 1);
  assert.equal(workspace.tasks[0].requestId, preparedId);
  const denied = await fetch(`${base}/api/script-tasks/${workspace.tasks[0].id}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
  assert.equal(denied.status, 409); assert.equal(calls.submit, 0);
  report.checks.push('费用未知时按钮禁用、后端拒绝、重复准备复用原request-id，零生成调用');
  const firstText = '【人工剧本一】\n雨夜，车站檐下。修表师修好怀表后认出父亲，两人温暖相拥。';
  await fill('script-draft-body', firstText);
  await click('script-save-version');
  workspace = await waitWorkspace(ws => ws.versions.length === 1);
  await browser.waitFor(`document.querySelector(${JSON.stringify(q('script-version-body'))})?.textContent === ${JSON.stringify(firstText)}`);
  const secondText = `${firstText}\n【人工修改二】父子一起走进车站暖光，怀表重新走动。`;
  await fill('script-draft-body', secondText);
  await fill('script-input-requirement', workspace.input.requirement + '\n【未保存输入】这一行不能被轮询丢弃。');
  await pause(6000);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(q('script-draft-body'))}).value`), secondText);
  assert.ok(await browser.evaluate(`document.querySelector(${JSON.stringify(q('script-input-requirement'))}).value.includes('不能被轮询丢弃')`));
  report.checks.push('轮询保留未保存剧本与未保存输入');
  await click('script-save-version');
  workspace = await waitWorkspace(ws => ws.versions.length === 2);
  assert.equal(workspace.versions[0].body, firstText);
  assert.equal(workspace.versions[1].body, secondText);
  await browser.waitFor(`document.querySelector(${JSON.stringify(q('script-review-start'))})?.disabled === false`);
  await click('script-review-start');
  workspace = await waitWorkspace(ws => ws.reviews.length === 1);
  await browser.waitFor(`document.body.textContent.includes('隔离报告显示夹具')`);
  assert.equal(workspace.reviews[0].needsReview, false);
  assert.equal(calls.review, 1);
  report.checks.push('人工修改另存新版本，历史稿完整保留；独立报告与稿件分开显示（隔离报告）');
  const currentProject = await get(`/api/projects/${project.id}`);
  await get(`/api/projects/${project.id}`, 'PUT', { revision: currentProject.revision, creativeBrief: { ...currentProject.creativeBrief, ending: '新要求：相认后一起等末班车。' } });
  await click('script-refresh');
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('script-upstream-stale'))}) && document.body.textContent.includes('旧报告 · 需要复核')`);
  workspace = await get(`/api/projects/${project.id}/script`);
  assert.equal(workspace.upstreamStale, true);
  assert.ok(workspace.versions.every(version => version.stale));
  assert.equal(workspace.reviews[0].needsReview, true);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(q('script-review-start'))}).disabled`), true);
  report.checks.push('上游改变后旧剧本和独立报告均标记需要复核，不冒充有效审阅');
  await app.close();
  app = createStudio(options); fixtureStore = app.store;
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
  await browser.call('Page.navigate', { url: `${base}/script.html?projectId=${project.id}` });
  await browser.waitFor(`document.querySelector(${JSON.stringify(q('script-version-body'))})?.textContent === ${JSON.stringify(secondText)}`);
  workspace = await get(`/api/projects/${project.id}/script`);
  assert.equal(workspace.versions.length, 2); assert.equal(workspace.reviews.length, 1);
  assert.equal(workspace.tasks[0].requestId, preparedId);
  assert.equal(calls.submit, 0); assert.equal(calls.query, 0);
  report.checks.push('独立服务重启后稿件、报告、原request-id与过期状态恢复');
  const shot = await browser.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(browserArtifacts, 'script-workbench-isolated.png'), Buffer.from(shot.data, 'base64'));
  assert.equal(browser.messages.length, 0);
  report.checks.push('真实Chrome无未处理页面异常');
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.stack; process.exitCode = 1;
  try { const shot = await browser.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(browserArtifacts, 'script-failure-isolated.png'), Buffer.from(shot.data, 'base64')); } catch {}
} finally {
  report.finishedAt = new Date().toISOString(); report.calls = calls;
  fs.writeFileSync(path.join(browserArtifacts, 'script-browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close(); await app.close();
}
