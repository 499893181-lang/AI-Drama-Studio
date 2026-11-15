import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectImageCapabilities } from '../src/image-capabilities.mjs';

test('图像检测只读帮助/状态；图像功能flag和登录不等于已验证生成、免费或API接通', async () => {
  const calls = [];
  const result = await inspectImageCapabilities({ resolve: () => '/fixture/codex', probe: async (_binary, args) => {
    calls.push(args);
    return { exitCode: 0, output: args[0] === '--version' ? 'codex-cli fixture' : args[0] === 'login' ? 'Logged in using ChatGPT' : args[0] === 'features' ? 'image_generation stable true\nview_image stable true' : '--image Optional image(s) to attach to the initial prompt' };
  } });
  assert.deepEqual(calls, [['--version'], ['login', 'status'], ['features', 'list'], ['exec', '--help']]);
  assert.equal(result.codex.imageGenerationFlagDetected, true);
  assert.equal(result.codex.loggedIn, true);
  assert.equal(result.automaticSubmissionEnabled, false);
  assert.equal(result.cost.amount, null);
  assert.equal(result.cost.status, 'unknown');
  assert.equal(result.codex.capabilityStatus, 'command_detected_not_generation_verified');
});
test('本机工具缺失仍可手工导出导入，不创建授权或调用其他服务', async () => {
  let called = false;
  const result = await inspectImageCapabilities({ resolve: () => null, probe: () => { called = true; throw new Error('不应执行'); } });
  assert.equal(called, false);
  assert.equal(result.mode, 'manual_export_import');
  assert.equal(result.codex.installed, false);
  assert.equal(result.cost.label, '费用待确认');
});
