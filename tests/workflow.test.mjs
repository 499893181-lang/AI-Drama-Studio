import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createStudio } from '../src/server.mjs';
import { createTimelineFixture } from './timeline-fixtures.mjs';
import { inspectWorkflow } from '../src/workflow.mjs';
const artifacts = path.resolve('tests/.artifacts'); fs.mkdirSync(artifacts, { recursive: true });
const denied = { inspect: async () => { throw new Error('工作流导航不得检查外部CLI'); }, submit: async () => { throw new Error('禁止生成'); } };
test('空项目导航只读且诚实，不把默认字段、空素材或未接通配音伪作已完成', async t => {
  const app = createStudio({ dataDir: fs.mkdtempSync(path.join(artifacts, 'workflow-empty-')), videoOptions: { adapter: denied } }); t.after(() => app.close());
  const project = app.store.create({ name: '[TEST] 空项目', idea: '' });
  const before = fs.readFileSync(app.store.file('projects', project.id)); const report = inspectWorkflow(app, project.id);
  assert.equal(report.steps.length, 7); assert.ok(report.steps.every(step => step.status === 'pending')); assert.equal(report.thumbnailUrl, null); assert.equal(report.formalStageStatus, 'not_checked'); assert.deepEqual(fs.readFileSync(app.store.file('projects', project.id)), before);
});
test('导航读取当前选用及Hash，参考或输入变更后图片、视频、时间轴和导出标需复核', async t => {
  const fixture = await createTimelineFixture(); t.after(() => fixture.timeline.close());
  const app = createStudio({ dataDir: fixture.store.root, videoOptions: { adapter: denied } }); t.after(() => app.close());
  let view = app.timeline.update(fixture.project.id, { revision: 0, clips: fixture.assets.map(asset => ({ assetId: asset.id })), audioMode: 'preserve' });
  const task = app.timeline.prepareExport(fixture.project.id, { revision: view.revision }); assert.equal((await app.timeline.startExport(task.id)).status, 'succeeded');
  let workflow = inspectWorkflow(app, fixture.project.id), step = id => workflow.steps.find(step => step.id === id);
  assert.equal(step('images').status, 'completed'); assert.equal(step('video').status, 'completed'); assert.equal(step('finishing').status, 'in_progress'); assert.equal(step('export').status, 'completed'); assert.equal(workflow.testFixture, true); assert.ok(workflow.thumbnailUrl);
  const project = app.store.read('projects', fixture.project.id); app.store.update(project.id, { revision: project.revision, idea: project.idea + ' 用户增加新要求' });
  workflow = inspectWorkflow(app, fixture.project.id);
  for (const id of ['images', 'video', 'finishing', 'export']) assert.equal(step(id).status, 'needs_review', id);
  assert.equal(step('story').status, 'completed'); assert.equal(workflow.formalStageStatus, 'not_checked');
});
test('workflow HTTP仅GET，本地状态派生不触发外部inspect或提交', async t => {
  const app = createStudio({ dataDir: fs.mkdtempSync(path.join(artifacts, 'workflow-http-')), videoOptions: { adapter: denied } }); t.after(() => app.close());
  const project = app.store.create({ name: '[TEST] 已有故事', idea: '原始用户故事' }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`, response = await fetch(`${base}/api/projects/${project.id}/workflow`), value = await response.json();
  assert.equal(response.status, 200); assert.equal(value.steps[0].status, 'completed'); assert.equal(value.nextStep, 'script'); assert.equal(value.steps.find(step => step.id === 'export').status, 'pending');
  assert.equal((await fetch(`${base}/api/projects/${project.id}/workflow`, { method: 'POST' })).status, 404);
});
