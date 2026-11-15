import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createDreaminaVideoAdapter, validateDreaminaVideoParameters, buildDreaminaVideoArgs, parseDreaminaVideoResult, parseDreaminaVideoSubmission } from '../src/dreamina-video.mjs';

const artifacts = path.resolve('tests/.artifacts'); fs.mkdirSync(artifacts, { recursive: true });
const ids = ['seedance1.0fast', 'seedance1.5pro', 'seedance2.0', 'seedance2.0fast', 'seedance2.0_vip', 'seedance2.0fast_vip', 'seedance2.0mini', 'seedance2.5'];
const help = '--image --prompt --model_version --video_resolution --duration --ratio ' + ids.join(' ');
const result = value => ({ exitCode: 0, stdout: JSON.stringify(value), stderr: '' });

test('只读检测区分direct未登录与canvas已登录，能力和报价不提升真实成功', async () => {
  const calls = [];
  const adapter = createDreaminaVideoAdapter({ resolve: name => name, run: async (binary, args) => {
    calls.push({ binary, args });
    if (binary === 'dreamina') {
      if (args[0] === 'version') return result({ version: '1.4.22' });
      if (args[0] === 'image2video') return { exitCode: 0, stdout: help };
      if (args[0] === 'query_result') return { exitCode: 0, stdout: '--submit_id --download_dir' };
      if (args[0] === 'user_credit') return { exitCode: 1, stdout: '未检测到有效登录态，请先执行 dreamina login' };
      return { exitCode: 0, stdout: 'All generation operations consume credits.' };
    }
    if (args[0] === 'version') return result({ ok: true, data: { version: '1.2.0' } });
    if (args[0] === 'auth') return result({ ok: true, data: { loggedIn: true, accountId: 'DO-NOT-EXPOSE', email: 'private@example.invalid' } });
    if (args[0] === 'schema') return result({ ok: true, data: { subcommands: [] } });
    return { exitCode: 0, stdout: '--file video --resource-id --import-kind' };
  } });
  const inspected = await adapter.inspect();
  assert.equal(inspected.contractDetected, true); assert.equal(inspected.auth.loggedIn, false); assert.equal(inspected.canvas.auth.loggedIn, true);
  assert.equal(inspected.canSubmit, false); assert.equal(inspected.actualGenerationVerified, false);
  assert.equal(inspected.defaults.model, 'seedance2.0_vip'); assert.equal(inspected.models.length, 8);
  assert.equal(inspected.audio.nativeDisableSupported, false); assert.equal(inspected.inputImage.supportedFormats, null);
  assert.equal(inspected.canvas.mediaImport.status, 'detected_not_verified');
  assert.ok(!JSON.stringify(inspected).includes('DO-NOT-EXPOSE')); assert.ok(!JSON.stringify(inspected).includes('private@example.invalid'));
  assert.ok(calls.every(({ args }) => args.includes('-h') || args.includes('--help') || ['version', '-h', 'user_credit', 'schema', 'auth'].includes(args[0])));
  const quote = await adapter.quote({ model: 'seedance2.0_vip', durationSeconds: 5, resolution: '720p' });
  assert.equal(quote.amount, null); assert.equal(quote.status, 'unknown'); assert.equal(quote.currency, 'CREDITS'); assert.equal(quote.canSubmit, false); assert.equal(quote.officialQuoteId, null);
});

test('命令计划使用实际公开参数，静音仅派生计划，不猜音频flag', () => {
  const imagePath = path.resolve('TEST-FIXTURE-NOT-AI.png');
  const args = buildDreaminaVideoArgs({ imagePath, prompt: '测试单镜固定机位', parameters: { audioMode: 'mute_derivative' } });
  assert.deepEqual(args, ['image2video', '--image', imagePath, '--prompt', '测试单镜固定机位', '--model_version', 'seedance2.0_vip', '--duration', '5', '--video_resolution', '720p', '--poll', '0']);
  const seed25 = buildDreaminaVideoArgs({ imagePath, prompt: '测试', parameters: { model: 'seedance2.5', durationSeconds: 4, resolution: '480p' } });
  assert.ok(!seed25.includes('--ratio')); assert.ok(!args.includes('--audio')); assert.ok(!args.includes('--mute'));
});

test('模型与时长/分辨率/比例组合保守校验，不静默降级', () => {
  for (const input of [{ model: 'invented' }, { durationSeconds: 3 }, { durationSeconds: 16 }, { model: 'seedance1.0fast', resolution: '1080p' }, { model: 'seedance2.5', ratio: '16:9' }, { audioMode: 'audio_off' }]) assert.throws(() => validateDreaminaVideoParameters(input));
  assert.equal(validateDreaminaVideoParameters({ model: 'seedance2.0_vip', resolution: '4k', durationSeconds: 15 }).resolution, '4k');
});

test('真实提交硬关闭，注入runner或伪造开关也不会执行生成命令', async () => {
  const calls = []; let finalChecks = 0;
  const adapter = createDreaminaVideoAdapter({ nativeSubmissionEnabled: true, allowPaidCalls: true, resolve: () => { throw new Error('门禁前不应解析CLI或访问文件'); }, run: async (...args) => { calls.push(args); return result({ submit_id: 'wrong', gen_status: 'success' }); } });
  await assert.rejects(adapter.submit({ confirm: true, approvedCredits: 100 }), /真实即梦视频提交保持关闭/);
  await assert.rejects(adapter.submit({ imagePath: 'invalid', cwd: 'invalid', prompt: '', parameters: { model: 'invalid' } }), /真实即梦视频提交保持关闭/);
  await assert.rejects(adapter.submit({ beforeSubmit: () => { finalChecks++; } }), /真实即梦视频提交保持关闭/);
  assert.equal(calls.length, 0);
  assert.equal(finalChecks, 0);
  assert.equal(adapter.realSubmissionEnabled, false); assert.equal(adapter.nativeSubmissionEnabled, false);
});

test('提交回执只采用实际外部ID与明确状态，缺ID或未知状态保留unknown不重试', () => {
  const args = ['image2video', '--poll', '0'];
  const accepted = parseDreaminaVideoSubmission(result({ submit_id: 'new-task', gen_status: 'querying' }), args);
  assert.equal(accepted.externalTaskId, 'new-task'); assert.equal(accepted.status, 'querying');
  const completed = parseDreaminaVideoSubmission(result({ data: { submit_id: 'new-task', gen_status: 'success' } }), args);
  assert.equal(completed.externalTaskId, 'new-task'); assert.equal(completed.status, 'success');
  const noId = parseDreaminaVideoSubmission(result({ gen_status: 'success' }), args);
  assert.equal(noId.externalTaskId, null); assert.equal(noId.status, 'unknown'); assert.match(noId.error, /不自动重提/);
  const uncertain = parseDreaminaVideoSubmission(result({ submit_id: 'observed-task', gen_status: 'undocumented' }), args);
  assert.equal(uncertain.externalTaskId, 'observed-task'); assert.equal(uncertain.status, 'unknown');
  const failed = parseDreaminaVideoSubmission({ exitCode: 1, stdout: JSON.stringify({ submit_id: 'observed-task', gen_status: 'querying' }), stderr: 'fixture transport failure' }, args);
  assert.equal(failed.externalTaskId, 'observed-task'); assert.equal(failed.status, 'unknown');
});

test('查询按原ID保存真实状态语义，错误/缺ID/错ID/未知状态都不能成功', () => {
  for (const payload of [{ submit_id: 'other', gen_status: 'success' }, { gen_status: 'success' }, { submit_id: 'original', gen_status: 'done' }, { ret: 99, data: { submit_id: 'original', gen_status: 'success' } }]) assert.equal(parseDreaminaVideoResult(result(payload), 'original').status, 'unknown');
  assert.equal(parseDreaminaVideoResult(result({ submit_id: 'original', gen_status: 'querying' }), 'original').status, 'querying');
  assert.equal(parseDreaminaVideoResult(result({ data: { submit_id: 'original', gen_status: 'fail', fail_reason: 'fixture failure' } }), 'original').status, 'fail');
  const parsed = parseDreaminaVideoResult(result({ submit_id: 'original', gen_status: 'success', video_url: 'https://example.invalid/preview?token=PRIVATE' }), 'original');
  assert.equal(parsed.status, 'success'); assert.ok(!parsed.raw.stdout.includes('PRIVATE')); assert.equal(parsed.runtimeVerified, false);
});

test('query只读取同一外部任务，不提交、不跟随预览URL', async () => {
  const calls = [];
  const adapter = createDreaminaVideoAdapter({ resolve: () => 'official-exe', run: async (_binary, args) => { calls.push(args); return result({ submit_id: 'task-original', gen_status: 'querying' }); } });
  const first = await adapter.query({ externalTaskId: 'task-original' }); const second = await adapter.query({ externalTaskId: 'task-original' });
  assert.equal(first.externalTaskId, second.externalTaskId); assert.deepEqual(calls, [['query_result', '--submit_id', 'task-original'], ['query_result', '--submit_id', 'task-original']]);
  await assert.rejects(adapter.query({ externalTaskId: '--image2video' }));
});

test('下载失败重试只query_result原ID，每次用独立目录保留旧文件', async () => {
  const directory = fs.mkdtempSync(path.join(artifacts, 'dreamina-download-')), calls = [];
  const adapter = createDreaminaVideoAdapter({ resolve: () => 'official-exe', run: async (_binary, args) => {
    calls.push(args); const target = args[args.indexOf('--download_dir') + 1];
    if (calls.length === 1) return { exitCode: 1, stdout: '', stderr: 'fixture download failed' };
    fs.writeFileSync(path.join(target, 'TEST-FIXTURE-NOT-AI.mp4'), 'not a real video; service FFprobe must reject this');
    return result({ submit_id: 'task-original', gen_status: 'success' });
  } });
  const failed = await adapter.download({ externalTaskId: 'task-original', cwd: directory });
  const downloaded = await adapter.download({ externalTaskId: 'task-original', cwd: directory });
  assert.equal(failed.status, 'unknown'); assert.equal(failed.path, null); assert.equal(downloaded.status, 'success'); assert.ok(fs.existsSync(downloaded.path));
  assert.notEqual(failed.downloadDirectory, downloaded.downloadDirectory); assert.ok(calls.every(args => args[0] === 'query_result' && args[2] === 'task-original'));
  assert.equal(downloaded.runtimeVerified, false);
});

test('只有成功文字或预览URL，没有实际文件时不提供下载候选路径', async () => {
  const adapter = createDreaminaVideoAdapter({ resolve: () => 'official-exe', run: async () => result({ submit_id: 'task-original', gen_status: 'success', video_url: 'https://example.invalid/preview.mp4' }) });
  const downloaded = await adapter.download({ externalTaskId: 'task-original', cwd: fs.mkdtempSync(path.join(artifacts, 'dreamina-no-file-')) });
  assert.equal(downloaded.path, null); assert.match(downloaded.error, /实际视频文件/);
});

test('轮询复用60秒只读检测缓存，并发检测共用一笔命令组，显式刷新才重查', async () => {
  let calls = 0;
  const adapter = createDreaminaVideoAdapter({ resolve: () => 'fake-only', run: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 3)); return { exitCode: 1, stdout: '', stderr: '明确隔离检测夹具' }; } });
  await Promise.all([adapter.inspect(), adapter.inspect(), adapter.inspect()]);
  assert.equal(calls, 11); await adapter.inspect(); assert.equal(calls, 11);
  await adapter.inspect({ refresh: true }); assert.equal(calls, 22);
});
