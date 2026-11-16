// Entirely isolated TEST setup: no real auth, confirm, run or new generated media.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createTimelineFixture } from './timeline-fixtures.mjs';
import { CanvasVideoService } from '../src/canvas-video-jobs.mjs';
import { CanvasVideoAuthority } from '../src/canvas-authorization.mjs';
import { buildCanvasExecutionScope } from '../src/canvas-execution.mjs';
import { creativeHash } from '../src/creative-store.mjs';
import { probeVideo } from '../src/video-media.mjs';

export const canvasFixtureIds = { projectId: '7f2bee13-2e6f-4097-9281-b814c3a314a2', nodeId: 'node_ht5aaps7yz', sourceNodeId: 'node_agvq74dwqs', sourceResourceId: '3e74fdf2-d290-4979-a200-4968dea502be', resultResourceId: '76eab309-20f1-4e81-ba3b-96d372a25b5d' };
export const canvasDeferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
export async function createCanvasFixture(t, { serviceOptions = {}, faults: initial = {} } = {}) {
  const base = await createTimelineFixture({ name: '[TEST] 画布待授权流程 · 隔离无真实生成' });
  const calls = { inspect: 0, submit: 0, confirm: 0, run: 0, query: 0, download: 0, strip: 0, submitIds: [], queryIds: [], downloadIds: [], downloads: [] }, faults = { quoteAmount: 70, draftVersion: 3, queryFailures: 0, downloadFailures: 0, ...initial };
  const image = base.images.view(base.project.id).assets.find(asset => asset.role === 'shot' && asset.targetId === 'SHOT-01');
  const evidence = { canvas: { projectId: canvasFixtureIds.projectId, nodeId: canvasFixtureIds.nodeId, sourceNodeId: canvasFixtureIds.sourceNodeId, sourceResourceId: canvasFixtureIds.sourceResourceId }, input: { sha256: image.sha256, registeredResource: { downloadSha256: '679b92bc271603e46dd9eb2650d678129cf0d9bd279375159e1b2da012697e16' } }, parameters: { model: 'seedance_2.0_vip', mode: 'first_last_frame', durationSeconds: 5, resolution: '720p', ratio: '16:9', outputCount: 1, audioMode: 'mute_derivative', prompt: '【隔离TEST】固定机位，测试卡微亮。未提交真实生成。' } };
  const adapter = {
    executionMode: 'isolated-fixture',
    inspectPlan: async plan => {
      calls.inspect++;
      const readback = { draftVersion: faults.draftVersion }, context = { region: 'cn', profile: 'ISOLATED-TEST', consumptionSubject: { kind: 'personal' }, consumptionSubjectHash: 'a'.repeat(64) }, scope = buildCanvasExecutionScope(plan, { readback, context });
      return { readback, context, authorizationBinding: { scope, scopeHash: creativeHash(scope) }, executionMode: 'isolated-fixture', quote: { status: 'quoted_snapshot', currency: 'CREDITS', amount: faults.quoteAmount, totalMaxCredits: faults.quoteAmount, requestId: 'ISOLATED-QUOTE-NOT-OFFICIAL', confirmable: true, conditions: ['仅软件测试夹具，非当前官方价格'], canSubmit: false } };
    },
    submit: async input => {
      calls.submit++; calls.submitIds.push(input.submitId);
      if (faults.onSubmit) await faults.onSubmit(input);
      await input.beforeConfirm(); calls.confirm++;
      await input.beforeRun(); calls.run++;
      if (faults.pendingSubmit) return faults.pendingSubmit.promise;
      return { submitId: input.submitId, status: 'querying', raw: { testFixture: true, state: 'ACCEPTED' }, executionMode: 'isolated-fixture' };
    },
    query: async input => { calls.query++; calls.queryIds.push(input.submitId); if (faults.queryFailures-- > 0) throw new Error('ISOLATED query network failure'); return { submitId: input.submitId, status: 'success', resourceId: canvasFixtureIds.resultResourceId, raw: { testFixture: true, operationRef: input.submitId, state: 'succeeded' }, executionMode: 'isolated-fixture' }; },
    download: async input => { calls.download++; calls.downloadIds.push(input.submitId); calls.downloads.push(input); if (faults.downloadFailures-- > 0) throw new Error('ISOLATED download network failure'); if (!path.isAbsolute(input.outputPath ?? '')) throw new Error('Native adapter requires outputPath, not only cwd'); fs.writeFileSync(input.outputPath, base.clip.bytes, { flag: 'wx' }); if (faults.onDownload) await faults.onDownload(input); return { submitId: input.submitId, resourceId: input.resourceId, status: 'success', path: input.outputPath, raw: { testFixture: true, downloadOnly: true }, executionMode: 'isolated-fixture' }; },
  };
  const authority = new CanvasVideoAuthority(base.store), service = new CanvasVideoService(base.store, { videos: base.videos, adapter, authority, evidence, ...serviceOptions });
  t?.after(() => { service.close(); base.timeline.close(); });
  const ctx = { ...base, image, evidence, calls, faults, adapter, authority, service, options: { videos: base.videos, adapter, authority, evidence, ...serviceOptions } };
  ctx.prepare = () => service.prepare(base.project.id, { revision: base.videos.get(base.project.id).revision, shotId: 'SHOT-01', imageAssetId: image.id });
  ctx.approve = task => authority.issue({ taskId: task.id, scope: task.authorizationBinding.scope, scopeHash: task.authorizationBinding.scopeHash, maxEstimatedCredits: 70, approvalText: '【ISOLATED TEST ONLY】本人模拟批准本任务，不是实际消费授权。', expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  ctx.ready = async () => { const task = await ctx.prepare(); ctx.approve(task); await service.submit(task.id); await service.query(task.id); return service.read(task.id); };
  ctx.hash = bytes => createHash('sha256').update(bytes).digest('hex');
  ctx.probe = probeVideo;
  return ctx;
}
