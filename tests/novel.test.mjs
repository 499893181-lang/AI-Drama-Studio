import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createNovelAdapter, extractNovelIds, resolveNovelExecutable, scriptCostEstimate, validateNovelInput } from '../src/novel.mjs';

// Isolated fixtures only: these runners never invoke an executable or a real service.
const artifacts = path.resolve('tests/.artifacts');
fs.mkdirSync(artifacts, { recursive: true });
function fixture(t, behavior) {
  const root = fs.mkdtempSync(path.join(artifacts, 'novel-adapter-'));
  t.after(() => {
    const resolved = fs.realpathSync(root);
    assert.ok(resolved.startsWith(fs.realpathSync(artifacts) + path.sep));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const toolDir = path.join(root, '.local', 'jimeng-novel-1.0.6', 'jimeng-novel-1.0.6-windows-amd64');
  fs.mkdirSync(path.join(toolDir, 'runtime'), { recursive: true });
  const bin = path.join(toolDir, 'jimeng-novel.exe');
  fs.writeFileSync(bin, 'FIXTURE: must never be executed');
  const calls = [];
  const runner = async (binary, args, options) => {
    calls.push({ binary, args, options });
    return behavior(args, options);
  };
  return { root, bin, calls, adapter: createNovelAdapter({ repoRoot: root, rootDir: path.join(root, 'data'), bin, runner }) };
}
const envelope = (status, data = {}, error = null) => ({ stdout: JSON.stringify({ status, data, error, context: { command: 'fixture-only' } }), stderr: '', exitCode: 0 });
const input = { current_episode: 1, story_engine: '雨夜修表，身份揭晓。', characters: '年轻修表师与失联父亲。', current_episode_summary: '修好停摆怀表后父子相认。', requirement: '30秒；保留雨夜和温暖结局。', script_localization: 'cn' };
const submit = adapter => adapter.submit({ kind: 'script', binding: { projectId: 'cloud-project-123', teamId: '' }, input, requestId: 'request-uuid-fixture' });
const outputPath = args => args[args.indexOf('--out') + 1];

test('公开报价未知，项目预算或余额不能变成可提交价格', () => {
  const quote = scriptCostEstimate({ budgetCap: 0, creditBalance: 1000000 });
  assert.equal(quote.status, 'unknown');
  assert.equal(quote.label, '费用待确认');
  assert.equal(quote.amount, null);
  assert.equal(quote.currency, null);
  assert.equal(quote.canSubmit, false);
});

test('工具发现保留runtime且无效显式路径不回退', t => {
  const { root, bin } = fixture(t, () => {});
  assert.equal(resolveNovelExecutable({ repoRoot: root, bin }), bin);
  assert.equal(resolveNovelExecutable({ repoRoot: root, bin: path.join(root, 'missing.exe') }), null);
  assert.equal(resolveNovelExecutable({ repoRoot: root, bin: 'relative.exe' }), null);
  const bare = path.join(root, 'bare.exe'); fs.writeFileSync(bare, 'fixture without runtime');
  assert.equal(resolveNovelExecutable({ repoRoot: root, bin: bare }), null);
});

test('认证检查只调用version/status，不自动发起授权或生成', async t => {
  const f = fixture(t, args => args[0] === '--version' ? { stdout: 'jimeng-novel 1.0.6 (fixture)', stderr: '', exitCode: 0 } : { stdout: '{"logged_in":true}', stderr: '', exitCode: 0 });
  const status = await f.adapter.inspect();
  assert.equal(status.installed, true);
  assert.equal(status.loggedIn, true);
  assert.equal(status.version, '1.0.6');
  assert.deepEqual(f.calls.map(call => call.args), [['--version'], ['status', '-j']]);
});

test('绑定必须由真实访问回执中的相同projectId确认，默认空间不改成0', async t => {
  const f = fixture(t, args => envelope('success', { projectId: args[3], name: 'fixture canvas' }));
  const binding = await f.adapter.verifyBinding({ projectId: 'cloud-project-123', teamId: '' });
  assert.equal(binding.verified, true);
  assert.equal(binding.projectId, 'cloud-project-123');
  assert.equal(binding.teamId, '');
  assert.ok(!f.calls[0].args.includes('--team-id'));
  assert.equal(f.calls[0].options.timeout, 60000, '画布网络读取使用独立60秒限时，避免真实SDK接近20秒时误失败');
  const bad = fixture(t, () => envelope('success', { projectId: 'another-canvas', name: 'wrong' }));
  await assert.rejects(() => bad.adapter.verifyBinding({ projectId: 'cloud-project-123', teamId: '' }), error => error.status === 409);
  const timeout = fixture(t, () => ({ stdout: '', stderr: 'fixture informational space notice', exitCode: null, timedOut: true }));
  await assert.rejects(() => timeout.adapter.verifyBinding({ projectId: 'cloud-project-123', teamId: '' }), error => error.status === 409 && /超.*60秒|超过60秒/.test(error.message));
  assert.ok(fs.readdirSync(path.join(timeout.root, 'data/runtime')).some(name => name.startsWith('novel-binding-')), '失败访问原始回执保存在私有runtime');
});

test('单集submit使用公开参数、持久幂等键和私有UTF8输入文件', async t => {
  const f = fixture(t, args => {
    const file = args[args.indexOf('--input-file') + 1];
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), input);
    return envelope('running', { thread_id: 'thread-1', run_id: 'run-1' });
  });
  const result = await submit(f.adapter);
  assert.equal(result.status, 'running');
  assert.equal(result.body, null);
  assert.equal(result.threadId, 'thread-1');
  assert.equal(result.runId, 'run-1');
  const args = f.calls[0].args;
  assert.deepEqual(args.slice(0, 6), ['script', 'episode', '--project-id', 'cloud-project-123', '--request-id', 'request-uuid-fixture']);
  assert.equal(args[args.indexOf('--wait') + 1], '1');
  assert.ok(args.includes('-j') && args.includes('--full'));
  const receiptPath = path.join(f.calls[0].options.cwd, 'receipt.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(receiptPath, 'utf8')).json, JSON.parse(result.receipt.stdout));
});

test('只有成功终态与本次新导出的完整正文共同存在才成功', async t => {
  const f = fixture(t, args => {
    fs.writeFileSync(outputPath(args), '# 单集剧本\n雨夜车站。父子相认，怀表重新走动。', 'utf8');
    return envelope('success', { thread_id: 'thread-1', run_id: 'run-1' });
  });
  const result = await submit(f.adapter);
  assert.equal(result.status, 'succeeded');
  assert.match(result.body, /父子相认/);
  assert.equal(result.error, null);
});

test('空成功包、未落地正文、缺任务IDs或截断正文不能冒充成功', async t => {
  for (const mode of ['empty', 'json-only-body', 'missing-ids', 'truncated', 'contradictory-error']) {
    const f = fixture(t, args => {
      if (mode === 'missing-ids' || mode === 'truncated' || mode === 'contradictory-error') fs.writeFileSync(outputPath(args), '本次导出正文，但不足以独立证明任务成功。');
      if (mode === 'empty') return envelope('success');
      if (mode === 'json-only-body') return envelope('success', { thread_id: 'thread-1', run_id: 'run-1', text: '任意JSON字符串不当正文' });
      if (mode === 'missing-ids') return envelope('success', { text: 'no task identity' });
      if (mode === 'contradictory-error') return envelope('success', { thread_id: 'thread-1', run_id: 'run-1' }, { message: 'fixture: success envelope still contains an error' });
      return envelope('success', { thread_id: 'thread-1', run_id: 'run-1', truncated: true });
    });
    const result = await submit(f.adapter);
    assert.equal(result.status, 'uncertain', mode);
    assert.equal(result.body, null, mode);
    assert.ok(result.error, mode);
  }
});

test('exit0但running即使出现文件也仍在运行，不自动采用', async t => {
  const f = fixture(t, args => {
    fs.writeFileSync(outputPath(args), 'fixture-file-not-terminal');
    return envelope('running', { thread_id: 'thread-1', run_id: 'run-1' });
  });
  const result = await submit(f.adapter);
  assert.equal(result.status, 'running'); assert.equal(result.body, null);
});

test('进程超时或错误保留已知原任务ID与完整回执，不判断为未提交', async t => {
  const f = fixture(t, () => ({ ...envelope('running', { thread_id: 'thread-1', run_id: 'run-1' }), exitCode: null, timedOut: true, stderr: 'fixture timeout' }));
  const result = await submit(f.adapter);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.threadId, 'thread-1'); assert.equal(result.runId, 'run-1');
  assert.equal(result.receipt.stderr, 'fixture timeout');
  assert.match(result.error, /查询原任务/);
});

test('恢复只用原thread/run查询script result，查询不重新提交', async t => {
  const f = fixture(t, args => {
    assert.deepEqual(args.slice(0, 6), ['script', 'result', '--thread-id', 'saved-thread', '--run-id', 'saved-run']);
    assert.ok(!args.includes('--request-id') && !args.includes('--input-file'));
    fs.writeFileSync(outputPath(args), '完整查询结果：此前被接受的原任务已完成。', 'utf8');
    return envelope('success', {});
  });
  const result = await f.adapter.query({ threadId: 'saved-thread', runId: 'saved-run', teamId: 'team-7' });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.threadId, 'saved-thread'); assert.equal(result.runId, 'saved-run');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].args[f.calls[0].args.indexOf('--team-id') + 1], 'team-7');
  await assert.rejects(() => f.adapter.query({ threadId: '', runId: 'saved-run' }), error => error.status === 409);
  assert.equal(f.calls.length, 1);
});

test('回执回调可先保存接受ID，最终仍完整保存原始结果', async t => {
  const seen = [];
  const f = fixture(t, (args, options) => {
    options.onStdout(JSON.stringify({ status: 'running', data: { thread_id: 'thread-early', run_id: 'run-early' } }));
    return envelope('running', { thread_id: 'thread-early', run_id: 'run-early' });
  });
  const result = await f.adapter.submit({ kind: 'outline', binding: { projectId: 'cloud-project-123', teamId: '' }, input: { episode_num: 1, idea: '温暖重逢' }, requestId: 'persistent-key', onReceipt: value => { seen.push(value); } });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].receipt.partial, true);
  assert.equal(seen[0].threadId, 'thread-early');
  assert.deepEqual(seen[1], result);
});

test('取消信号传入runner，异常中断后仍保留此前回执IDs', async t => {
  const aborter = new AbortController();
  const f = fixture(t, (args, options) => {
    assert.equal(options.signal, aborter.signal);
    options.onStdout(JSON.stringify({ status: 'running', data: { thread_id: 'accepted-thread', run_id: 'accepted-run' } }));
    aborter.abort();
    throw new Error('fixture interrupted after remote acceptance');
  });
  const result = await f.adapter.submit({ kind: 'script', binding: { projectId: 'cloud-project', teamId: '' }, input, requestId: 'request-with-abort', signal: aborter.signal });
  assert.equal(result.status, 'uncertain');
  assert.equal(result.threadId, 'accepted-thread'); assert.equal(result.runId, 'accepted-run');
  assert.equal(result.receipt.aborted, true);
  assert.match(result.error, /中断/);
});

test('提前回执写入失败不产生未处理异常或伪成功，仍保留原任务身份', async t => {
  const f = fixture(t, (args, options) => {
    options.onStdout(JSON.stringify({ status: 'running', data: { thread_id: 'saved-thread', run_id: 'saved-run' } }));
    fs.writeFileSync(outputPath(args), '成功正文存在，但接受回执保存失败不能被跳过。');
    return envelope('success', { thread_id: 'saved-thread', run_id: 'saved-run' });
  });
  const result = await f.adapter.submit({ kind: 'script', binding: { projectId: 'cloud-project', teamId: '' }, input, requestId: 'persistent-request', onReceipt: value => { if (value.receipt.partial) throw new Error('fixture storage full'); } });
  assert.equal(result.status, 'uncertain');
  assert.equal(result.threadId, 'saved-thread'); assert.equal(result.runId, 'saved-run');
  assert.match(result.error, /回执持久化未完成/);
  assert.equal(result.body, null);
});

test('Schema、参数边界与任务ID校验在任何进程执行前拒绝', async t => {
  assert.throws(() => validateNovelInput('script', { ...input, feedback: '不存在的专用改稿参数' }));
  assert.throws(() => validateNovelInput('outline', { episode_num: 0, idea: 'invalid' }));
  assert.throws(() => validateNovelInput('outline', { episode_num: 1 }));
  assert.throws(() => validateNovelInput('script', { ...input, current_episode: 0 }));
  assert.throws(() => validateNovelInput('script', { ...input, characters: '' }));
  const f = fixture(t, () => { throw new Error('must not run'); });
  await assert.rejects(() => f.adapter.submit({ kind: 'script', binding: { projectId: '--bad-flag' }, input, requestId: 'request-id' }));
  await assert.rejects(() => f.adapter.submit({ kind: 'script', binding: { projectId: 'cloud-project' }, input, requestId: '--bad-key' }));
  assert.equal(f.calls.length, 0);
  assert.deepEqual(extractNovelIds({ data: { thread_id: '--flag', run_id: 'run-good' } }), { threadId: null, runId: 'run-good' });
});
