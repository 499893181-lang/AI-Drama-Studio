import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForNewAssistantTurn } from './assistant-turn-wait.mjs';
test('真实验收等待只认本次新消息，不将上一轮成功误判为本轮完成',async()=>{let reads=0;const second=await waitForNewAssistantTurn(()=>{reads++;return[{id:'first',status:'succeeded'},...(reads>=2?[{id:'second',status:reads>=4?'succeeded':'running'}]:[])];},['first'],{timeoutMs:1000,pollMs:2});assert.equal(second.id,'second');assert.equal(second.status,'succeeded');assert.ok(reads>=4);});
test('等待中断或超时原样报告，不自行重新发送或把旧成功当恢复结果',async()=>{let reads=0;const failed=await waitForNewAssistantTurn(()=>{reads++;return[{id:'old',status:'succeeded'},{id:'new',status:'interrupted',error:'原样保留'}];},['old'],{timeoutMs:100,pollMs:1});assert.equal(failed.status,'interrupted');assert.equal(reads,1);await assert.rejects(waitForNewAssistantTurn(()=>[{id:'old',status:'succeeded'}],['old'],{timeoutMs:10,pollMs:2}),/不自动重发/);});
