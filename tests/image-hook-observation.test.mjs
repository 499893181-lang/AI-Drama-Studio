import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createImageGuard } from '../src/codex-image-guard.mjs';
import { summarizeImageEvidence } from '../src/image-evidence.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const directory = path.resolve('tests/.artifacts'); fs.mkdirSync(directory, { recursive: true });
function execute(guard, raw) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [guard.scriptPath], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => errors += chunk); child.once('error', reject);
    child.once('close', code => { try { assert.equal(code, 0, errors); resolve(JSON.parse(output)); } catch (error) { reject(error); } });
    child.stdin.on('error', () => {}); child.stdin.end(raw);
  });
}

test('无生成的真实stdin观察绑定Hash和manifest；请求改写不冒充工具执行，非法及过大输入拒绝', async () => {
  const root = fs.mkdtempSync(path.join(directory, 'hook-observation-'));
  const guard = createImageGuard({ directory: path.join(root, 'valid'), prompt: 'HOST PINNED FIXTURE PROMPT' });
  const input = { hook_event_name: 'PreToolUse', tool_name: 'image_genimagegen', tool_use_id: 'local-fixture-only', tool_input: { prompt: 'ACTUAL STDIN MODEL INPUT' + '中文'.repeat(14000), referenced_image_paths: ['MODEL-DECLARED.png'], n: 3 } }, raw = JSON.stringify(input);
  const result = await execute(guard, raw); assert.equal(result.hookSpecificOutput.permissionDecision, 'allow');
  const records = fs.readFileSync(guard.inputLogPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(records.length, 2); const [observed, rewrite] = records;
  assert.equal(observed.kind, 'pre_tool_observation'); assert.deepEqual(observed.tool_input, input.tool_input); assert.equal(observed.stdinSha256, sha(raw)); assert.equal(observed.inputSha256, sha(JSON.stringify(input.tool_input)));
  assert.equal(observed.manifestHash, guard.manifestHash); assert.equal(observed.expectedManifestHash, guard.manifestHash); assert.equal(observed.finalToolExecutionVerified, false); assert.equal(observed.backendReferenceUsageVerified, false);
  assert.equal(rewrite.kind, 'requested_rewrite'); assert.deepEqual(rewrite.requestedUpdatedInput, result.hookSpecificOutput.updatedInput); assert.equal(rewrite.requestedUpdatedInput.prompt, 'HOST PINNED FIXTURE PROMPT'); assert.equal(rewrite.finalToolExecutionVerified, false);
  const report = summarizeImageEvidence({ job: { id: 'fixture-only', status: 'prepared' }, hookInputRecord: observed });
  assert.equal(report.attachments.toolArguments.preToolRecordObserved, true); assert.equal(report.attachments.toolArguments.nativeToolParametersObserved, false); assert.equal(report.attachments.toolArguments.status, 'unverified'); assert.equal(report.attachments.serverReceipt.status, 'not_returned'); assert.equal(report.evidence.acceptance.status, 'incomplete');
  for (const [name, invalid] of [['invalid', '{'], ['missing', JSON.stringify({ ...input, tool_input: null })], ['too-large', JSON.stringify({ ...input, tool_input: { prompt: '中'.repeat(400000) } })]]) {
    const other = createImageGuard({ directory: path.join(root, name), prompt: 'fixture' });
    const denied = await execute(other, invalid); assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny'); assert.equal(fs.existsSync(other.markerPath), false); assert.equal(fs.existsSync(other.inputLogPath), false);
  }
});
