// Read-only remote inspection + local pending task only. No approval/submit mode.
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { CreativeWorkspace } from '../src/creative-store.mjs';
import { ImageWorkspace } from '../src/image-store.mjs';
import { VideoWorkspace } from '../src/video-store.mjs';
import { CanvasVideoService } from '../src/canvas-video-jobs.mjs';
if (process.argv.slice(2).join(' ') !== '--prepare-only' || !process.env.DATA_DIR) throw new Error('Only --prepare-only with the original DATA_DIR is supported. No spending mode exists.');
const store = new Store(path.resolve(process.env.DATA_DIR)), creative = new CreativeWorkspace(store), images = new ImageWorkspace(store, { creativeWorkspace: creative }), videos = new VideoWorkspace(store, { images });
const service = new CanvasVideoService(store, { videos, recoverPending: false });
try {
  const projectId = '76e18591-47fc-48cf-992d-112d183a3036', workspace = videos.get(projectId);
  let task = await service.prepare(projectId, { revision: workspace.revision, shotId: 'SHOT-01', imageAssetId: '7910017a-b01d-4dca-9ab2-1309c374aeca' });
  task = await service.refresh(task.id);
  if (task.authorization.status !== 'not_granted' || task.submittedAt || task.result || task.stale) throw new Error('Expected an unchanged unapproved pending task; original record retained, do not reset.');
  const report = { checkedAt: new Date().toISOString(), projectId, taskId: task.id, stableSubmitId: task.submitId, status: task.status, submittedAt: task.submittedAt, authorization: task.authorization, plan: task.plan, binding: task.binding, authorizationScopeHash: task.authorizationBinding.scopeHash, draftVersion: task.draftVersion, quote: task.quote, actualCost: null, threshold: 70, generationCalls: 0, creditConfirmations: 0, formalStageStatus: 'not_checked', url: `http://127.0.0.1:4320/canvas-video.html?projectId=${projectId}` };
  fs.mkdirSync('tests/.artifacts/canvas-v09', { recursive: true }); fs.writeFileSync('tests/.artifacts/canvas-v09/pending-preparation.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ taskId: task.id, submitId: task.submitId, status: task.status, draftVersion: task.draftVersion, scopeHash: task.authorizationBinding.scopeHash, quote: { amount: task.quote.amount, totalMaxCredits: task.quote.totalMaxCredits, requestId: task.quote.requestId, checkedAt: task.quote.checkedAt, expiresAt: task.quote.expiresAt }, authorization: task.authorization, generationCalls: 0, creditConfirmations: 0, url: report.url }, null, 2));
} finally { service.close(); }
