import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { TimelineService } from '../src/timeline-jobs.mjs';
import { probeVideo, runMedia } from '../src/video-media.mjs';
import { createTimelineFixture } from './timeline-fixtures.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
async function fixture(t, options) { const ctx = await createTimelineFixture(options); t.after(() => ctx.timeline.close()); return ctx; }
function save(ctx, { assets = ctx.assets, audioMode = 'preserve' } = {}) { return ctx.timeline.update(ctx.project.id, { revision: ctx.timeline.view(ctx.project.id).revision, clips: assets.map(asset => ({ assetId: asset.id })), audioMode }); }
function prepare(ctx, input = {}) { return ctx.timeline.prepareExport(ctx.project.id, { revision: ctx.timeline.view(ctx.project.id).revision, ...input }); }

test('时间轴按人工顺序绑定三镜头实际时长、视频版本/Hash/审核/选用，旧版本不可变', async t => {
  const ctx = await fixture(t), first = save(ctx), old = ctx.timeline.workspace.readVersion(ctx.project.id, first.activeVersionId);
  assert.deepEqual(first.clips.map(clip => clip.shotId), ['SHOT-01', 'SHOT-02', 'SHOT-03']); assert.equal(first.totalDurationSeconds, 15); assert.equal(first.availableAssets.filter(asset => asset.eligible).length, 3);
  assert.equal(first.clips[0].sha256, '7de983635b4b445d23d72d09ca41f0c30d255a14a0e3df25647ad6e2116800b3'); assert.ok(first.clips[0].binding.videoReviewId); assert.ok(first.clips[0].binding.videoSelectionId); assert.equal(first.formalStageStatus, 'not_checked');
  const second = save(ctx, { assets: [...ctx.assets].reverse(), audioMode: 'mute_derivative' });
  assert.equal(second.versions.length, 2); assert.equal(second.audioMode, 'mute_derivative'); assert.deepEqual(second.clips.map(clip => clip.shotId), ['SHOT-03', 'SHOT-02', 'SHOT-01']); assert.deepEqual(ctx.timeline.workspace.readVersion(ctx.project.id, old.id), old);
  assert.throws(() => ctx.timeline.update(ctx.project.id, { revision: 0, clips: [{ assetId: ctx.assets[0].id }], audioMode: 'preserve' }), /已更新/);
  assert.throws(() => ctx.timeline.update(ctx.project.id, { revision: second.revision, clips: [{ assetId: ctx.assets[0].id, trimIn: 1 }], audioMode: 'preserve' }), /暂不支持裁剪/);
  assert.throws(() => ctx.timeline.update(ctx.project.id, { revision: second.revision, clips: [{ assetId: 'C:\\secret.mp4' }], audioMode: 'preserve' }), /ID无效/);
  assert.throws(() => ctx.timeline.update(ctx.project.id, { revision: second.revision, clips: [{ assetId: ctx.assets[0].id, path: 'C:\\private.mp4' }], audioMode: 'preserve' }), /只接受.*资产ID/);
});

test('真实本地FFmpeg拼接既有TEST三片，FFprobe输出15秒720p/Hash与manifest；重启恢复不重导', async t => {
  const ctx = await fixture(t); save(ctx); const task = prepare(ctx), again = prepare(ctx); assert.equal(task.id, again.id); assert.equal(task.status, 'prepared'); assert.equal(task.submittedAt, null);
  const done = await ctx.timeline.startExport(task.id); assert.equal(done.status, 'succeeded', done.error); assert.equal(done.externalProviderCalls, 0); assert.equal(done.runAttempts, 1); assert.equal(done.testFixture, true);
  const file = ctx.timeline.file(done.id), manifest = ctx.timeline.manifest(done.id), measured = await probeVideo(file.path);
  assert.equal(measured.sha256, done.result.sha256); assert.ok(Math.abs(measured.durationSeconds - 15) < 0.1); assert.equal(measured.width, 1280); assert.equal(measured.height, 720); assert.equal(measured.audioStreams, 0);
  assert.equal(manifest.clips.length, 3); assert.ok(manifest.clips.every(clip => clip.source.kind === 'test')); assert.equal(manifest.formalStageStatus, 'not_checked'); assert.match(manifest.sourceDescription, /不是即梦真实生成/); assert.ok(manifest.command.build.includes('ffmpeg version')); assert.equal(manifest.command.overwrites, false); assert.equal(manifest.externalProviderCalls, 0);
  for (const asset of ctx.assets) assert.equal(sha(ctx.videos.file(ctx.project.id, asset.id).bytes), ctx.clip.sha256);
  const restarted = new TimelineService(ctx.store, { videos: ctx.videos }); t.after(() => restarted.close()); assert.equal(restarted.view(ctx.project.id).exports[0].status, 'succeeded'); assert.equal((await restarted.startExport(task.id)).runAttempts, 1); assert.equal(restarted.file(task.id).size, file.size);
  const redo = restarted.prepareExport(ctx.project.id, { revision: restarted.view(ctx.project.id).revision, redoOfTaskId: task.id }); assert.notEqual(redo.id, task.id); assert.equal(redo.status, 'prepared'); assert.equal(restarted.file(task.id).size, file.size);
});

test('显式mute_derivative只执行本地-an，保留原片并记录后处理静音而非模型原生', async t => {
  const ctx = await fixture(t); save(ctx, { assets: [ctx.assets[0]], audioMode: 'mute_derivative' }); const done = await ctx.timeline.startExport(prepare(ctx).id);
  assert.equal(done.status, 'succeeded', done.error); assert.ok(done.command.args.includes('-an')); const manifest = ctx.timeline.manifest(done.id); assert.match(manifest.audioDescription, /后处理.*不是模型原生无声/); assert.equal(manifest.output.probe.audioStreams, 0); assert.equal(sha(ctx.clip.bytes), ctx.clip.sha256); assert.equal(ctx.videos.file(ctx.project.id, ctx.assets[0].id).bytes.length, ctx.clip.bytes.length);
});

test('旧任务导出前重读：视频改判拒绝、源图片拒绝、旧时间轴版本均阻断；旧历史保留', async t => {
  const ctx = await fixture(t); const first = save(ctx), oldTask = prepare(ctx);
  save(ctx, { assets: [ctx.assets[0]] }); await assert.rejects(ctx.timeline.startExport(oldTask.id), /新版本/); assert.equal(ctx.timeline.read(oldTask.id).submittedAt, null); assert.throws(() => prepare(ctx, { versionId: first.activeVersionId }), /新版本/);
  const currentTask = prepare(ctx); ctx.videos.review(ctx.project.id, { revision: ctx.videos.get(ctx.project.id).revision, assetId: ctx.assets[0].id, verdict: 'rejected', notes: '撤销测试检查' });
  await assert.rejects(ctx.timeline.startExport(currentTask.id), /人工检查|过期/); assert.equal(ctx.timeline.view(ctx.project.id).stale, true); assert.equal(ctx.timeline.view(ctx.project.id).exports.find(task => task.id === currentTask.id).stale, true); assert.equal(ctx.videos.get(ctx.project.id).assets.length, 3);
  const image = ctx.images.get(ctx.project.id).assets.find(item => item.targetId === 'SHOT-02'); ctx.images.review(ctx.project.id, { revision: ctx.images.get(ctx.project.id).revision, assetId: image.id, verdict: 'rejected', notes: '撤销上游图片' }); assert.equal(ctx.timeline.view(ctx.project.id).availableAssets.find(item => item.id === ctx.assets[1].id).eligible, false);
});

test('实际源文件损坏或分镜过期不能执行原任务，原素材记录和手工时间轴不变', async t => {
  const ctx = await fixture(t); save(ctx); const task = prepare(ctx), original = ctx.videos.file(ctx.project.id, ctx.assets[0].id); fs.appendFileSync(original.path, 'FAULT');
  await assert.rejects(ctx.timeline.startExport(task.id), /人工检查|过期|Hash/); assert.equal(ctx.timeline.read(task.id).runAttempts, 0); fs.writeFileSync(original.path, original.bytes);
  const creative = ctx.creative.get(ctx.project.id); ctx.creative.update(ctx.project.id, { revision: creative.revision, episodeId: 'EP-NEW' }); await assert.rejects(ctx.timeline.startExport(task.id), /人工检查|过期/); assert.equal(ctx.timeline.view(ctx.project.id).versions.length, 1); assert.equal(ctx.videos.get(ctx.project.id).assets.length, 3);
});

test('重复及并发run持久化意图先于runner且只执行一次；取消/迟到不自动成功或重导', async t => {
  const wait = deferred(); let generationCommands = 0, ctx;
  ctx = await fixture(t, { serviceOptions: { runner: async (binary, args) => { if (args.includes('-version')) return { stdout: 'ISOLATED TEST ffmpeg version', exitCode: 0 }; generationCommands++; assert.equal(ctx.timeline.read(task.id).runAttempts, 1); return wait.promise; } } });
  save(ctx); const task = prepare(ctx), first = ctx.timeline.startExport(task.id), second = ctx.timeline.startExport(task.id); assert.equal(first, second);
  while (!generationCommands) await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(ctx.timeline.read(task.id).status, 'exporting'); const cancelled = ctx.timeline.cancel(task.id); assert.equal(cancelled.status, 'cancelled');
  assert.equal((await first).status, 'cancelled'); wait.resolve({ exitCode: 0 }); assert.equal((await ctx.timeline.startExport(task.id)).status, 'cancelled'); assert.equal(generationCommands, 1); assert.equal(ctx.timeline.read(task.id).executionMode, 'isolated-fixture');
  for (const asset of ctx.assets) assert.equal(sha(ctx.videos.file(ctx.project.id, asset.id).bytes), ctx.clip.sha256);
});

test('启动失败/超时/无效产物均保留错误、不重导、不损原片，夹具不证明真实媒体成功', async t => {
  const runners = [
    { expected: 'failed', runner: async () => { throw new Error('FAULT startup denied'); } },
    { expected: 'timed_out', runner: async () => new Promise(() => {}), timeoutMs: 40 },
    { expected: 'failed', runner: async (_, args) => { if (args.includes('-version')) return { stdout: 'ISOLATED TEST version', exitCode: 0 }; fs.writeFileSync(args.at(-1), 'text path is not a video'); return { exitCode: 0 }; } },
  ];
  for (const item of runners) {
    const ctx = await fixture(t, { serviceOptions: item }); save(ctx, { assets: [ctx.assets[0]] }); const task = prepare(ctx), done = await ctx.timeline.startExport(task.id); assert.equal(done.status, item.expected, done.error); assert.ok(done.error); assert.equal(done.result, null); assert.equal((await ctx.timeline.startExport(task.id)).runAttempts, 1); assert.equal(ctx.videos.file(ctx.project.id, ctx.assets[0].id).bytes.length, ctx.clip.bytes.length);
  }
});

test('FFprobe门槛拒绝尺寸/音轨不兼容及实测Hash变化，不静默拉伸或丢弃音轨', async t => {
  let calls = 0, mode = 'dimensions';
  const ctx = await fixture(t, { serviceOptions: { probe: async file => { const actual = await probeVideo(file); calls++;
    if (mode === 'hash') actual.sha256 = '0'.repeat(64);
    if (calls === 2 && mode === 'dimensions') { actual.rawProbe.streams[0].width = 640; actual.width = 640; }
    if (calls === 2 && mode === 'audio') { actual.rawProbe.streams.push({ codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, channel_layout: 'stereo' }); actual.audioStreams = 1; actual.hasAudio = true; }
    return actual;
  } } }); save(ctx); const first = await ctx.timeline.startExport(prepare(ctx).id); assert.equal(first.status, 'failed'); assert.match(first.error, /不兼容/); assert.equal(first.result, null);
  mode = 'audio'; calls = 0; const second = await ctx.timeline.startExport(prepare(ctx, { redoOfTaskId: first.id }).id); assert.equal(second.status, 'failed'); assert.match(second.error, /不兼容/);
  mode = 'hash'; calls = 0; const third = await ctx.timeline.startExport(prepare(ctx, { redoOfTaskId: second.id }).id); assert.equal(third.status, 'failed'); assert.match(third.error, /Hash或时长改变/);
});

test('export中来源改变使结果保留为失败，旧版本/源文件不被覆盖', async t => {
  let ctx; ctx = await fixture(t, { serviceOptions: { runner: async (binary, args, options) => { const result = await runMedia(binary, args, options); if (!args.includes('-version')) { const project = ctx.store.read('projects', ctx.project.id); ctx.store.update(project.id, { revision: project.revision, idea: project.idea + ' changed' }); } return result; } } }); save(ctx); const done = await ctx.timeline.startExport(prepare(ctx).id); assert.equal(done.status, 'failed'); assert.equal(done.result, null); assert.ok(fs.existsSync(path.join(ctx.store.root, 'runtime', 'timeline-exports', done.id, 'output.mp4'))); assert.equal(ctx.timeline.view(ctx.project.id).versions.length, 1);
});

test('模拟服务重启持久化exporting为interrupted，篡改快照或历史损坏阻止新执行', async t => {
  const ctx = await fixture(t); save(ctx); const task = prepare(ctx), interrupted = { ...ctx.timeline.read(task.id), status: 'exporting', submittedAt: new Date().toISOString(), runAttempts: 1 }; ctx.store.write('timeline-exports', interrupted);
  const service = new TimelineService(ctx.store, { videos: ctx.videos }); t.after(() => service.close()); assert.equal(service.read(task.id).status, 'interrupted'); assert.equal((await service.startExport(task.id)).runAttempts, 1);
  const version = service.workspace.readVersion(ctx.project.id, service.view(ctx.project.id).activeVersionId); fs.appendFileSync(ctx.store.file('timeline-versions', version.id), 'BROKEN'); assert.equal(service.view(ctx.project.id).versions.length, 0); assert.equal(service.view(ctx.project.id).warnings.length, 1); assert.throws(() => service.prepareExport(ctx.project.id, { revision: service.view(ctx.project.id).revision }), /损坏/);
});
