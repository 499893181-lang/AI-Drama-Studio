import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from './cdp.mjs';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4317';
const artifacts = path.resolve('tests/.artifacts');
const recordFile = path.join(artifacts, 'browser-project.json');
const restoreOnly = process.argv.includes('--restore');
const expand = process.argv.includes('--expand');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
await mkdir(artifacts, { recursive: true });
const browser = await launchBrowser(artifacts);
const report = { startedAt: new Date().toISOString(), base, restoreOnly, expand, checks: [] };
const q = testId => `[data-testid="${testId}"]`;
const click = async testId => {
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q(testId))})`);
  await browser.evaluate(`document.querySelector(${JSON.stringify(q(testId))}).click()`);
};
const fill = async (testId, value) => {
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q(testId))})`);
  await browser.evaluate(`(() => { const e=document.querySelector(${JSON.stringify(q(testId))}); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
};
const api = async route => {
  const response = await fetch(`${base}${route}`);
  assert.equal(response.ok, true, `HTTP ${response.status}: ${route}`);
  return response.json();
};
const waitProject = async (id, predicate, timeout = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const p = await api(`/api/projects/${id}`);
    if (predicate(p)) return p;
    await pause(250);
  }
  throw new Error('项目状态等待超时');
};
try {
  await browser.call('Page.navigate', { url: base });
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(q('new-project'))})`);
  if (restoreOnly) {
    const expected = JSON.parse(await readFile(recordFile, 'utf8'));
    const p = await api(`/api/projects/${expected.id}`);
    for (const key of ['name', 'idea', 'durationSeconds', 'aspectRatio', 'style', 'budgetCap']) {
      assert.deepEqual(p[key], expected[key], `重启恢复字段 ${key}`);
    }
    assert.deepEqual(p.creativeBrief, expected.creativeBrief, '重启恢复创作说明');
    await browser.waitFor(`!!document.querySelector('[data-project-id="${expected.id}"]')`);
    await browser.evaluate(`document.querySelector('[data-project-id="${expected.id}"]').click()`);
    await browser.waitFor(`document.querySelector(${JSON.stringify(q('name'))})?.value === ${JSON.stringify(expected.name)}`);
    if (expected.creativeBrief) {
      await browser.waitFor(`document.querySelector(${JSON.stringify(q('brief-ending'))})?.value === ${JSON.stringify(expected.creativeBrief.ending)}`);
    }
    report.projectId = expected.id;
    report.checks.push('服务重启后磁盘项目与创作说明恢复', '浏览器列表与编辑字段恢复');
  } else {
    const name = `浏览器验收·雨夜车站·${Date.now()}`;
    await click('new-project');
    await fill('name', name);
    await fill('idea', '雨夜的末班车站，年轻修表师为陌生老人修好一块停了二十年的怀表。老人是他失联的父亲，最后父子相认。必须保留怀表、雨夜和温暖结局。');
    assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(q('duration'))}).value`), '30', '默认时长为30秒');
    await fill('duration', '45');
    await click('aspect-landscape');
    await fill('style', '温暖写实，雨夜冷蓝色与车站暖光形成层次。');
    await fill('budget', '128');
    await click('save-project');
    let p;
    for (let i = 0; i < 80; i++) {
      const list = await api('/api/projects');
      p = list.projects.find(item => item.name === name);
      if (p) break;
      await pause(150);
    }
    assert.ok(p, '新项目已从浏览器表单写入磁盘');
    assert.equal(p.durationSeconds, 45);
    assert.equal(p.aspectRatio, '16:9');
    assert.equal(p.budgetCap, 128);
    report.projectId = p.id;
    report.checks.push('浏览器新建项目并保存', '默认30秒，修改为45秒并设置横屏/画风/预算');
    if (expand) {
      await click('expand-story');
      p = await waitProject(p.id, item => !!item.latestJobId, 30000);
      report.jobId = p.latestJobId;
      let job;
      const start = Date.now();
      while (Date.now() - start < 600000) {
        job = await api(`/api/jobs/${report.jobId}`);
        if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(job.status)) break;
        await pause(1000);
      }
      report.jobStatus = job?.status;
      if (job?.status !== 'succeeded') throw new Error(`真实 Codex 扩写未成功：${job?.error || job?.message || job?.status}`);
      assert.ok(job.result?.synopsis && job.result?.ending, '真实Codex返回结构化六项内容');
      await click('apply-expansion');
      p = await waitProject(p.id, item => !!item.creativeBrief);
      await browser.waitFor(`document.querySelector(${JSON.stringify(q('brief-ending'))})?.readOnly === false`);
      const ending = `${p.creativeBrief.ending}\n【用户修改】父子一起走进车站暖光中，怀表重新走动。`;
      await fill('brief-ending', ending);
      await click('save-project');
      p = await waitProject(p.id, item => item.creativeBrief?.ending === ending);
      report.checks.push('浏览器触发真实Codex，收到成功状态和结果', '采用候选，人工修改结局并保存');
    } else {
      await fill('style', `${p.style} 用户修改已保存。`);
      await click('save-project');
      p = await waitProject(p.id, item => item.style.includes('用户修改已保存'));
      report.checks.push('人工修改后保存');
    }
    await writeFile(recordFile, JSON.stringify(p, null, 2));
    await browser.waitFor(`!document.querySelector('[data-testid="save-project"]')?.disabled && document.querySelector('#save-state')?.innerText.includes('已保存')`);
    const previousOrigin = await browser.evaluate('performance.timeOrigin');
    await browser.call('Page.reload');
    await browser.waitFor(`performance.timeOrigin !== ${previousOrigin} && document.readyState === 'complete' && !!document.querySelector('[data-project-id="${p.id}"]')`);
    await browser.evaluate(`document.querySelector('[data-project-id="${p.id}"]').click()`);
    await browser.waitFor(`document.querySelector(${JSON.stringify(q('name'))})?.value === ${JSON.stringify(p.name)}`);
    report.checks.push('浏览器刷新后恢复');
  }
  const shot = await browser.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(artifacts, restoreOnly ? 'restored.png' : 'workbench.png'), Buffer.from(shot.data, 'base64'));
  assert.equal(browser.messages.length, 0, '页面没有未处理的JavaScript异常');
  report.checks.push('无未处理的浏览器脚本异常');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.stack;
  try {
    const shot = await browser.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(artifacts, 'failure.png'), Buffer.from(shot.data, 'base64'));
  } catch {}
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(artifacts, restoreOnly ? 'restore-report.json' : 'browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
