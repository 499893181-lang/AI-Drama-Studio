import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createStudio } from '../src/server.mjs';
import { fixtureEntities, fixtureShots } from './creative-fixtures.mjs';
import { testPng } from './image-fixtures.mjs';

const artifacts=path.resolve('tests/.artifacts');fs.mkdirSync(artifacts,{recursive:true});
async function fixture(t){
  const app=createStudio({dataDir:fs.mkdtempSync(path.join(artifacts,'image-invalidation-http-'))});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const project=app.store.create({name:'[隔离测试] 参考审核撤销',idea:'仅验证旧包不能执行，不调用模型。'});
  app.creative.update(project.id,{revision:0,entities:structuredClone(fixtureEntities),shots:fixtureShots()});
  app.creative.addVersion(project.id,{revision:1,kind:'storyboard',body:'【软件测试】三镜头。'});
  const base=`http://127.0.0.1:${app.server.address().port}/api/projects/${project.id}/images`;
  const upload=(role,targetId)=>{const ws=app.images.view(project.id);return app.images.import(project.id,{revision:ws.revision,role,targetId,filename:'TEST-FIXTURE-NOT-AI.png',source:{kind:'test',description:'明确软件测试素材，非AI生成。'}},testPng()).assets.at(-1);};
  const use=asset=>{let ws=app.images.view(project.id);ws=app.images.review(project.id,{revision:ws.revision,assetId:asset.id,verdict:'accepted'});return app.images.select(project.id,{revision:ws.revision,assetId:asset.id});};
  return{app,project,base,upload,use};
}
test('HTTP改判人物参考rejected后，旧bundle返回409，下游不再显示selected',async t=>{
  const ctx=await fixture(t),ref=ctx.upload('character','CHAR-01');let ws=ctx.use(ref);
  const packet=ctx.app.images.prepare(ctx.project.id,{revision:ws.revision,shotId:'SHOT-01'}),shot=ctx.upload('shot','SHOT-01');ws=ctx.use(shot);
  let response=await fetch(`${ctx.base}/packets/${packet.id}/bundle`);assert.equal(response.status,200);
  response=await fetch(`${ctx.base}/packets/${packet.id}`);assert.equal(response.status,200);assert.equal((await response.json()).id,packet.id);
  response=await fetch(`${ctx.base}/review`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:ws.revision,assetId:ref.id,verdict:'rejected',notes:'新发现人物不符，撤回原通过。'})});assert.equal(response.status,200);ws=await response.json();
  assert.equal(ws.assets.find(asset=>asset.id===shot.id).state,'needs_review');assert.equal(ws.packets.find(row=>row.id===packet.id).executable,false);
  response=await fetch(`${ctx.base}/packets/${packet.id}/bundle`);assert.equal(response.status,409);assert.match(response.headers.get('content-type'),/application\/json/);
  response=await fetch(`${ctx.base}/packets/${packet.id}`);assert.equal(response.status,409);assert.match((await response.json()).error,/已改变|需复核/);
  assert.equal(ctx.app.images.get(ctx.project.id).selectionHistory.length,2);assert.ok(ctx.app.images.file(ctx.project.id,shot.id).bytes.length);
});
test('HTTP下载必须重新检查target.ready，不能因旧Hash仍匹配而放行',async t=>{
  const ctx=await fixture(t),ws=ctx.app.images.view(ctx.project.id),packet=ctx.app.images.prepare(ctx.project.id,{revision:ws.revision,shotId:'SHOT-01'});
  const creative=ctx.app.creative.workspace.get(ctx.project.id);ctx.app.creative.update(ctx.project.id,{revision:creative.revision,episodeId:'EP-02'});
  const response=await fetch(`${ctx.base}/packets/${packet.id}/bundle`);assert.equal(response.status,409);assert.match((await response.json()).error,/来源分镜已过期|不可执行/);
  const json=await fetch(`${ctx.base}/packets/${packet.id}`);assert.equal(json.status,409);assert.match((await json.json()).error,/来源分镜已过期|不可执行/);
  assert.equal(ctx.app.images.get(ctx.project.id).packets.length,1);
});
