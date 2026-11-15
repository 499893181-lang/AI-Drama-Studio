// Explicit opt-in acceptance. This script contacts the real Codex service only with --run-codex.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const base = process.env.STUDIO_URL ?? 'http://127.0.0.1:4317';
const receiptFile = path.join(root, '.runtime', 'acceptance-receipt.json');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const call = async (route, method = 'GET', data) => {
  const response = await fetch(base + route, { method, headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${value.error}`);
  return value;
};
if (process.argv.includes('--verify-restart')) {
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  const project = await call(`/api/projects/${receipt.projectId}`);
  assert.equal(digest(project), receipt.projectHash, '重启后项目内容必须逐字段一致');
  const job = await call(`/api/jobs/${receipt.jobId}`);
  assert.equal(job.status, 'succeeded'); assert.ok(job.appliedAt);
  const reference = await fetch(`${base}/api/projects/${project.id}/references/${project.references[0].id}`);
  assert.equal(await reference.text(), receipt.referenceText);
  receipt.restartVerifiedAt = new Date().toISOString();
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ result: 'PASS', check: 'restart-restoration', projectId: project.id, revision: project.revision, name: project.name }, null, 2));
} else if (process.argv.includes('--run-codex')) {
  let project = await call('/api/projects', 'POST', { name: '验收 · 雨夜的灯', idea: '一个守着街角修鞋摊的奶奶，在下雨的夜晚帮一位赶末班车的女孩修好鞋。女孩第二天送来一盏台灯作为感谢。必须保留奶奶与女孩互不相识的关系；结局温暖，不加入死亡、穿越或反派。', durationSeconds: 30, aspectRatio: '9:16', style: '温暖的二维手绘质感，雨夜暖黄色灯光', budgetCap: 80 });
  const referenceText = '验收参考：雨夜街角的暖黄灯光。此附件仅用于本地保存验证。';
  const upload = await fetch(`${base}/api/projects/${project.id}/references`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-File-Name': encodeURIComponent('雨夜灯光参考.txt') }, body: referenceText });
  assert.equal(upload.status, 201); project = await upload.json();
  let job = await call(`/api/projects/${project.id}/expand`, 'POST', { revision: project.revision });
  console.log(JSON.stringify({ projectId: project.id, jobId: job.id, state: job.status }));
  const started = Date.now(); let previous = '';
  while (['queued', 'running'].includes(job.status)) {
    if (Date.now() - started > 330000) throw new Error('验收等待超时；任务ID已打印，请检查原任务，勿盲目重复提交。');
    await new Promise(resolve => setTimeout(resolve, 2500));
    job = await call(`/api/jobs/${job.id}`);
    if (job.message !== previous) { console.log(JSON.stringify({ state: job.status, message: job.message })); previous = job.message; }
  }
  if (job.status !== 'succeeded') throw new Error(`真实调用未成功：${job.status}: ${job.error}`);
  assert.ok(job.result.synopsis && job.result.addedSettings.length && job.result.preservedContent.length);
  project = await call(`/api/jobs/${job.id}/apply`, 'POST', { revision: project.revision });
  project.creativeBrief.ending += '\n【人工修改】台灯亮起时，奶奶与女孩相视一笑，保留温暖结局。';
  project = await call(`/api/projects/${project.id}`, 'PUT', { revision: project.revision, creativeBrief: project.creativeBrief, budgetCap: 88 });
  const receipt = { createdAt: new Date().toISOString(), projectId: project.id, jobId: job.id, projectHash: digest(project), revision: project.revision, referenceText, provider: job.provider, threadId: job.threadId, usage: job.usage, checks: ['项目创建', '附件上传', '真实Codex扩写', '六段结构校验', '保留要求与新增设定标记', '手动采用', '人工修改并保存'], restartVerifiedAt: null };
  fs.mkdirSync(path.dirname(receiptFile), { recursive: true });
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ result: 'PASS', next: '重启服务后运行 --verify-restart', projectId: project.id, jobId: job.id, revision: project.revision }, null, 2));
} else {
  console.log('用法：node scripts/verify-real.mjs --run-codex（真实调用，使用当前账号额度）\n服务重启后：node scripts/verify-real.mjs --verify-restart');
}
