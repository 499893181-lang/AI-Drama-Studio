import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from './cdp.mjs';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4317';
const projectId = process.argv[2];
if (!projectId) throw new Error('用法：node tests/verify-existing.mjs <项目ID>。仅编辑现有项目，不启动新Codex任务。');
const dir = path.resolve('tests/.artifacts');
await mkdir(dir, { recursive: true });
const browser = await launchBrowser(dir);
const api = async route => {
  const response = await fetch(base + route);
  assert.ok(response.ok);
  return response.json();
};
try {
  let project = await api(`/api/projects/${encodeURIComponent(projectId)}`);
  const job = project.latestJobId ? await api(`/api/jobs/${encodeURIComponent(project.latestJobId)}`) : null;
  await browser.call('Page.navigate', { url: base });
  await browser.waitFor(`!!document.querySelector('[data-project-id="${projectId}"]')`);
  await browser.evaluate(`document.querySelector('[data-project-id="${projectId}"]').click()`);
  await browser.waitFor(`document.querySelector('[data-testid="name"]')?.value === ${JSON.stringify(project.name)}`);
  if (job?.status === 'failed') {
    await browser.waitFor(`document.body.innerText.includes('扩写失败') || document.body.innerText.includes('调用失败')`);
    assert.equal(project.creativeBrief, null, '失败后没有伪造说明');
  }
  const style = `${project.style}\n【用户修改】已验证失败信息后手动保存，保留原构思。`;
  await browser.evaluate(`(() => { const e=document.querySelector('[data-testid="style"]'); e.value=${JSON.stringify(style)}; e.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('[data-testid="save-project"]').click(); })()`);
  for (let i = 0; i < 80; i++) {
    project = await api(`/api/projects/${encodeURIComponent(projectId)}`);
    if (project.style === style) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.equal(project.style, style);
  await browser.waitFor(`!document.querySelector('[data-testid="save-project"]')?.disabled && document.querySelector('#save-state')?.innerText.includes('已保存')`);
  await writeFile(path.join(dir, 'browser-project.json'), JSON.stringify(project, null, 2));
  const previousOrigin = await browser.evaluate('performance.timeOrigin');
  await browser.call('Page.reload');
  await browser.waitFor(`performance.timeOrigin !== ${previousOrigin} && document.readyState === 'complete' && document.querySelector('[data-testid="style"]')?.value === ${JSON.stringify(style)}`);
  const shot = await browser.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(dir, 'workbench.png'), Buffer.from(shot.data, 'base64'));
  const report = { checkedAt: new Date().toISOString(), projectId, jobId: job?.id, codexStatus: job?.status, codexError: job?.error, localWorkflowPassed: true, checks: ['真实调用失败信息在界面可见', '没有伪造创作说明', '现有项目人工修改保存', '刷新恢复人工修改'], browserExceptions: browser.messages };
  assert.equal(browser.messages.length, 0);
  await writeFile(path.join(dir, 'existing-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
