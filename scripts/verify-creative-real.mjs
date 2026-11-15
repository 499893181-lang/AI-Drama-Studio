// Explicitly opt-in real local Codex acceptance. Never invokes Jimeng or media.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const base = process.env.STUDIO_URL || 'http://127.0.0.1:4318';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('验收只连接本机工作台。');
const directory = path.resolve('tests/.artifacts/creative-real');
fs.mkdirSync(directory, { recursive: true });
const receiptPath = path.join(directory, 'receipt.json');
const receipt = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : { createdAt: new Date().toISOString(), base, tasks: {} };
const persist = () => fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(route, method = 'GET', body) {
  const response = await fetch(base + route, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const value = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${value.error}`);
  return value;
}
const projectPath = () => `/api/projects/${receipt.projectId}`;
const view = () => api(projectPath() + '/creative');
async function update(fields) { const ws = await view(); return api(projectPath() + '/creative', 'PUT', { revision: ws.revision, ...fields }); }
async function run(kind, references = {}) {
  let task;
  if (receipt.tasks[kind]) task = await api(`/api/creative-tasks/${receipt.tasks[kind]}`);
  else {
    const ws = await view();
    task = await api(projectPath() + '/creative/tasks', 'POST', { revision: ws.revision, projectRevision: ws.project.revision, kind, ...references });
    receipt.tasks[kind] = task.id; persist();
  }
  for (let n = 0; n < 190; n++) {
    task = await api(`/api/creative-tasks/${task.id}`);
    if (!['queued', 'running'].includes(task.status)) break;
    if (n % 15 === 0) console.log(`${kind}: ${task.status} — ${task.message}`);
    await pause(2000);
  }
  fs.writeFileSync(path.join(directory, `${kind}.json`), JSON.stringify(task, null, 2));
  receipt.results ??= {};
  receipt.results[kind] = { id: task.id, status: task.status, error: task.error, threadId: task.threadId, inputHash: task.inputHash, knowledgeHash: task.knowledgeHash, rawHash: hash(task.rawText), verdict: task.result?.verdict ?? null, usage: task.usage, updatedAt: task.updatedAt };
  persist();
  assert.equal(task.status, 'succeeded', `${kind}真实任务失败；原始结果已保留：${task.error}`);
  return task;
}

if (!process.argv.includes('--run-codex') && !process.argv.includes('--restore')) throw new Error('显式使用 --run-codex 才允许真实文字调用；--restore 仅核对已保存任务。');
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try { await api('/api/health'); ready = true; break; } catch { await pause(200); }
}
if (!ready) throw new Error('本机验收服务尚未就绪；未提交任务。');
if (process.argv.includes('--restore')) {
  assert.ok(receipt.projectId, '缺少本机验收记录');
  const ws = await view();
  for (const [kind, id] of Object.entries(receipt.tasks)) {
    const task = await api(`/api/creative-tasks/${id}`);
    assert.equal(task.status, receipt.results[kind].status);
    assert.equal(task.threadId, receipt.results[kind].threadId);
    assert.equal(hash(task.rawText), receipt.results[kind].rawHash);
  }
  const uiPath = path.join(directory, 'live-ui.json');
  if (fs.existsSync(uiPath)) {
    const ui = JSON.parse(fs.readFileSync(uiPath, 'utf8'));
    if (ui.savedVersionId) {
      const version = ws.versions.find(item => item.id === ui.savedVersionId);
      assert.ok(version?.body.includes('【软件验收人工备注】'));
      assert.ok(ws.storyboardDraft.includes('【软件验收人工备注】'));
      receipt.restoredManualVersionId = version.id;
    }
  }
  receipt.restoredAt = new Date().toISOString(); receipt.restoredVersions = ws.versions.length; persist();
  console.log(JSON.stringify({ restored: true, projectId: receipt.projectId, versions: ws.versions.length, tasks: receipt.tasks }));
  process.exit(0);
}

try {
  if (!receipt.projectId) {
    const project = await api('/api/projects', 'POST', { name: '[独立真实验收] 等一杯茶', idea: '阴天傍晚，穿灰蓝长衫的独居老人给离家的女儿留一杯茶。收到她报平安的语音后，他把空椅子拉近桌边，温暖结尾。只有老人出镜。', durationSeconds: 30, aspectRatio: '16:9', budgetCap: 0, style: '生活观察，朴素可制作；本轮仅文字。' });
    receipt.projectId = project.id; persist();
    await update({ shotCount: 3, stylePresetId: 'jia.platform.distance', instructions: '总时长严格30秒，恰好3个镜头，每镜10秒。保持CHAR-01、SCENE-01、PROP-01的ID和v1版本；shot.subject逐字使用“CHAR-01，老人，灰蓝长衫”。仅老人出镜，女儿声音列入后期计划；当前不制作声音。不得新增雨夜、服装、角色、场景或反转结局。', locks: [{ path: 'shot.subject', value: 'CHAR-01，老人，灰蓝长衫' }, { path: 'shot.weather', value: '阴天' }, { path: 'shot.timeOfDay', value: '傍晚' }], entities: [
      { id: 'CHAR-01', type: 'character', version: 'v1', description: '独居老人，灰蓝长衫。只有他出镜。', source: 'user' },
      { id: 'SCENE-01', type: 'scene', version: 'v1', description: '家中桌边，阴天傍晚。', source: 'user' },
      { id: 'PROP-01', type: 'prop', version: 'v1', description: '茶杯与空椅子。', source: 'user' },
    ] });
  }
  const script = await run('script');
  if (!receipt.designPrepared) {
    await update({ selectedScriptTaskId: script.id });
    const first = await api(projectPath() + '/creative/export');
    await update({ stylePresetId: 'anderson.budapest.order' });
    const second = await api(projectPath() + '/creative/export');
    assert.equal(first.packets.length, 3); assert.equal(second.packets.length, 3);
    assert.notEqual(first.prompts[0].imagePrompt, second.prompts[0].imagePrompt);
    receipt.styleComparison = { presets: ['jia.platform.distance', 'anderson.budapest.order'], firstHash: hash(first.prompts), secondHash: hash(second.prompts), shots: 3, locksPreserved: second.packets.every(packet => packet.sourceSnapshot.shot.weather === '阴天' && packet.sourceSnapshot.shot.subject === 'CHAR-01，老人，灰蓝长衫') };
    fs.writeFileSync(path.join(directory, 'two-presets.json'), JSON.stringify({ first, second }, null, 2));
    receipt.designPrepared = true; persist();
  }
  const storyboard = await run('storyboard', { scriptTaskId: script.id });
  const review = await run('review', { targetTaskId: storyboard.id });
  assert.notEqual(script.threadId, storyboard.threadId); assert.notEqual(storyboard.threadId, review.threadId);
  assert.equal(storyboard.result.shots.length, 3);
  assert.equal(storyboard.result.shots.reduce((n, shot) => n + shot.durationSeconds, 0), 30);
  delete receipt.failure;
  receipt.completedAt = new Date().toISOString(); receipt.page = `${base}/creative.html?projectId=${receipt.projectId}`; persist();
  console.log(JSON.stringify({ real: true, projectId: receipt.projectId, results: receipt.results, page: receipt.page }));
} catch (error) { receipt.failure = { at: new Date().toISOString(), message: error.message }; persist(); throw error; }
