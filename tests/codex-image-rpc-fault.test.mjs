// Actual local Node pipes, fake app-server protocol. No Codex/model/image calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createImageGuard } from '../src/codex-image-guard.mjs';
import { createImageWatchdog } from '../src/codex-image-watchdog.mjs';
import { openImageRpc } from '../src/codex-image-rpc.mjs';
import { testPng } from './image-fixtures.mjs';

const base = path.resolve('tests/.artifacts'); fs.mkdirSync(base, { recursive: true });
const invalidFrames = { json_null: 'null', json_array: '[]', json_number: '42', missing_rpc_shape: '{}', invalid_method: '{"method":false}', invalid_id: '{"id":[],"result":{}}', missing_response_payload: '{"id":1}', ambiguous_response: '{"id":1,"result":{},"error":{"code":-1,"message":"fixture"}}' };
for (const fault of ['failed_hook', 'malformed_rpc', ...Object.keys(invalidFrames)]) test(`本地假RPC管道 ${fault}：失败期中断、发送层证据及迟到回执原样保留`, async t => {
  const directory = fs.mkdtempSync(path.join(base, 'fake-image-rpc-'));
  const guard = createImageGuard({ directory: path.join(directory, 'guard'), prompt: 'FAKE PIPE ONLY' });
  const raw = path.join(directory, 'raw'), image = path.join(directory, 'LATE-FIXTURE-NOT-AI.png'); fs.writeFileSync(image, testPng());
  const started = { method: 'hook/started', params: { threadId: 'fixture-thread', turnId: 'fixture-turn', run: { id: 'fake-hook', eventName: 'preToolUse', handlerType: 'command', executionMode: 'sync', status: 'running', entries: [] } } };
  const failed = { method: 'hook/completed', params: { ...started.params, run: { ...started.params.run, status: 'failed', entries: [{ kind: 'error', text: 'injected startup failure' }] } } };
  fs.writeFileSync(path.join(directory, 'app-server'), `import readline from 'node:readline';
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const message=JSON.parse(line);
 if(message.method==='turn/start'){
  send({id:message.id,result:{turn:{id:'fixture-turn'}}});send(${JSON.stringify(started)});
  ${fault === 'failed_hook' ? `send(${JSON.stringify(failed)});` : `process.stdout.write(${JSON.stringify((invalidFrames[fault] ?? 'INVALID_JSON_FIXTURE') + '\n')});`}
 }else if(message.method==='turn/interrupt'){
  send({id:message.id,result:{}});
  send({method:'item/completed',params:{threadId:'fixture-thread',turnId:'fixture-turn',item:{id:'fixture-image',type:'imageGeneration',status:'completed',savedPath:${JSON.stringify(image)}}}});
  send({method:'turn/completed',params:{threadId:'fixture-thread',turn:{id:'fixture-turn',status:'completed'}}});
 }
});`);
  let watcher;
  const events = [], rpc = openImageRpc(process.execPath, { cwd: directory, rawDirectory: raw, onEvent: event => { events.push(event); watcher?.event(event); } });
  watcher = createImageWatchdog({ rpc, threadId: 'fixture-thread', guard });
  t.after(() => { watcher.dispose(); rpc.close(); });
  try { await watcher.startTurn({ input: [{ type: 'text', text: 'FAKE RPC NO GENERATION' }] }); } catch {}
  await assert.rejects(watcher.waitForTurn(), fault === 'failed_hook' ? /injected startup failure/ : /有效JSON|有效RPC帧/);
  await watcher.settleInterrupt(); await rpc.shutdown();
  const state = watcher.snapshot(); assert.equal(state.interrupt.status, 'acknowledged'); assert.equal(state.strictSingleCallGuaranteed, false);
  assert.equal(state.counts.modelTurnRequests, 1); assert.equal(state.counts.observedImageToolCompletions, 1);
  assert.equal(state.completedImages[0].item.savedPath, image);
  const requests = fs.readFileSync(path.join(raw, 'requests.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(requests.filter(value => value.method === 'turn/start').length, 1); assert.equal(requests.filter(value => value.method === 'turn/interrupt').length, 1);
  const transport = fs.readFileSync(path.join(raw, 'transport.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(transport.find(value => value.method === 'turn/start').status, 'written_to_pipe'); assert.equal(transport[0].provesServerReceived, false);
  assert.equal(events.some(value => value.method === 'item/completed'), true);
  const rawOutput = fs.readFileSync(path.join(raw, 'events.jsonl'), 'utf8');
  assert.ok(rawOutput.includes(fault === 'failed_hook' ? 'injected startup failure' : invalidFrames[fault] ?? 'INVALID_JSON_FIXTURE'));
  assert.equal(fs.existsSync(guard.markerPath), false); assert.deepEqual(fs.readFileSync(image), testPng());
});
