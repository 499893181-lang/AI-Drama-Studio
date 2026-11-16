// Local operator entry only. Never invoked to issue a grant without the user's
// explicit approval of the displayed task/scope. No HTTP issue endpoint exists.
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { CreativeWorkspace } from '../src/creative-store.mjs';
import { ImageWorkspace } from '../src/image-store.mjs';
import { VideoWorkspace } from '../src/video-store.mjs';
import { CanvasVideoService } from '../src/canvas-video-jobs.mjs';

const args = process.argv.slice(2), values = new Map();
for (let index = 0; index < args.length; index += 2) { if (!['--task', '--scope-hash', '--max-estimate', '--record-user-approval'].includes(args[index]) || !args[index + 1] || values.has(args[index])) throw new Error('只支持显式--task/--scope-hash/--max-estimate/--record-user-approval参数。'); values.set(args[index], args[index + 1]); }
if (!process.env.DATA_DIR || !values.get('--task')) throw new Error('请设置原DATA_DIR并指定现有--task，不创建新数据目录或重复任务。');
const store = new Store(path.resolve(process.env.DATA_DIR)), creative = new CreativeWorkspace(store), images = new ImageWorkspace(store, { creativeWorkspace: creative }), videos = new VideoWorkspace(store, { images });
// This local utility never changes recovery states in the live data directory.
const service = new CanvasVideoService(store, { videos, recoverPending: false });
const id = values.get('--task'), task = service.read(id);
if (task.status !== 'prepared' || task.submittedAt) throw new Error('该任务已取消、已尝试或已有终态；不能重复发放批准。');
const { inspection } = await service.preflight(id);
const scopeHash = inspection.authorizationBinding.scopeHash;
if (!values.has('--record-user-approval')) {
  console.log(JSON.stringify({ taskId: id, scopeHash, scope: inspection.authorizationBinding.scope, quote: inspection.quote, threshold: 70, status: 'not_granted', instruction: '仅本人明确批准当前范围后，另行调用带准确scope-hash、max-estimate=70及本人声明的本机录入。此命令未确认消费或生成。' }, null, 2));
} else {
  if (values.get('--scope-hash') !== scopeHash || values.get('--max-estimate') !== '70') throw new Error('必须明确提供最新完整范围Hash和70积分预估批准阈值。');
  const grant = service.authority.issue({ taskId: id, ...inspection.authorizationBinding, maxEstimatedCredits: 70, approvalText: values.get('--record-user-approval'), expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  console.log(JSON.stringify({ taskId: id, approvalId: grant.id, scopeHash, status: 'approved_locally_only', expiresAt: grant.expiresAt, noCreditConfirmation: true, noGeneration: true }, null, 2));
}
