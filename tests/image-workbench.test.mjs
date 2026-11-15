import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { CreativeWorkspace } from '../src/creative-store.mjs';
import { ImageWorkspace } from '../src/image-store.mjs';
import { inspectImage,MAX_IMAGE_BYTES } from '../src/image-files.mjs';
import { fixtureEntities,fixtureShots } from './creative-fixtures.mjs';
import { testPng } from './image-fixtures.mjs';
import { imageCodecFixtures } from './image-codec-fixtures.mjs';
const artifacts=path.resolve('tests/.artifacts');fs.mkdirSync(artifacts,{recursive:true});
function fixture(){
 const root=fs.mkdtempSync(path.join(artifacts,'image-workbench-')),store=new Store(root),creative=new CreativeWorkspace(store);
 const project=store.create({name:'[测试] 图片绑定三镜头',idea:'阴天傍晚灰蓝长衫老人等茶，温暖结尾',durationSeconds:30});
 creative.update(project.id,{revision:0,entities:structuredClone(fixtureEntities),shots:fixtureShots(),stylePresetId:'jia.platform.distance'});
 creative.addVersion(project.id,{revision:1,kind:'storyboard',body:'[人工测试分镜] 三镜头30秒。'});
 const images=new ImageWorkspace(store,{creativeWorkspace:creative});return{root,store,creative,project,images};
}
function upload(ctx,role,targetId,color=[44,64,98]){return ctx.images.import(ctx.project.id,{revision:ctx.images.view(ctx.project.id).revision,role,targetId,filename:'TEST-FIXTURE-NOT-AI.png',source:{kind:'test',description:'像素标明TEST FIXTURE / NOT AI；非AI生成。'}},testPng(320,180,color));}
function use(ctx,asset){let ws=ctx.images.view(ctx.project.id);ctx.images.review(ctx.project.id,{revision:ws.revision,assetId:asset.id,verdict:'accepted',notes:'人工软件测试检查，非审美验收。'});ws=ctx.images.view(ctx.project.id);return ctx.images.select(ctx.project.id,{revision:ws.revision,assetId:asset.id});}
test('实际PNG校验尺寸、像素压缩和Hash；伪图、截断、CRC错误、超限及SVG被拒绝',()=>{
 const bytes=testPng();assert.deepEqual({...inspectImage(bytes),verification:undefined},{width:320,height:180,format:'png',mimeType:'image/png',extension:'png',verification:undefined});
 for(const invalid of [Buffer.from('<svg/>'),Buffer.from('fake.png'),bytes.subarray(0,bytes.length-4),Buffer.alloc(MAX_IMAGE_BYTES+1)])assert.throws(()=>inspectImage(invalid));
 const corrupt=Buffer.from(bytes);corrupt[45]^=1;assert.throws(()=>inspectImage(corrupt),/校验和/);
});
test('真实Chrome编码的JPEG/WebP测试图片可导入，保存实际格式尺寸，截断文件被拒绝',()=>{
 const ctx=fixture();for(const [format,base64]of Object.entries(imageCodecFixtures)){
  const bytes=Buffer.from(base64,'base64'),info=inspectImage(bytes);assert.equal(info.format,format);assert.equal(info.width,160);assert.equal(info.height,90);assert.throws(()=>inspectImage(bytes.subarray(0,bytes.length-4)));
  const ws=ctx.images.view(ctx.project.id),next=ctx.images.import(ctx.project.id,{revision:ws.revision,role:'shot',targetId:'SHOT-01',filename:'TEST-FIXTURE-NOT-AI.'+format,source:{kind:'test',description:'明确测试像素由Chrome Canvas编码，非AI生成。'}},bytes);assert.equal(next.assets.at(-1).format,format);assert.equal(next.assets.at(-1).size,bytes.length);
 }
});
test('三个镜头绑定实际测试图片，人工检查与选用分离，重启恢复相同文件和版本',()=>{
 const ctx=fixture();assert.equal(ctx.images.view(ctx.project.id).targets.filter(target=>target.role==='shot').length,3);
 for(const id of ['SHOT-01','SHOT-02','SHOT-03']){let ws=upload(ctx,'shot',id);const asset=ws.assets.at(-1);assert.equal(asset.state,'pending_check');assert.equal(asset.source.kind,'test');assert.throws(()=>ctx.images.select(ctx.project.id,{revision:ws.revision,assetId:asset.id}),/人工检查/);use(ctx,asset);}
 const restored=new ImageWorkspace(new Store(ctx.root)).view(ctx.project.id);assert.equal(restored.assets.length,3);assert.equal(restored.activeSelections.length,3);assert.ok(restored.assets.every(asset=>asset.state==='selected'));
 assert.equal(restored.formalStageStatus,'not_checked');assert.equal(restored.capability.costStatus,'unknown');
});
test('重做仅替换单镜头选用，旧图片和两次选用历史逐字保留',()=>{
 const ctx=fixture();for(const id of ['SHOT-01','SHOT-02','SHOT-03']){const ws=upload(ctx,'shot',id);use(ctx,ws.assets.at(-1));}
 const before=ctx.images.view(ctx.project.id),old=before.assets.find(asset=>asset.targetId==='SHOT-02'),file=ctx.images.file(ctx.project.id,old.id);
 const ws=upload(ctx,'shot','SHOT-02',[90,45,80]),newAsset=ws.assets.at(-1);const after=use(ctx,newAsset);
 assert.equal(after.assets.length,4);assert.equal(after.assets.find(asset=>asset.id===newAsset.id).version,2);assert.equal(after.selectionHistory.length,4);
 assert.equal(after.activeSelections.find(row=>row.key==='shot:SHOT-02').asset.id,newAsset.id);assert.ok(after.assets.some(asset=>asset.id===old.id));assert.deepEqual(fs.readFileSync(file.path),file.bytes);
 for(const targetId of ['SHOT-01','SHOT-03'])assert.equal(after.activeSelections.find(row=>row.targetId===targetId).asset.id,before.activeSelections.find(row=>row.targetId===targetId).asset.id);
});
test('项目/分镜/参考素材变化后图片需复核，旧图不能用旧revision或客户端Hash冒充当前',()=>{
 const ctx=fixture();let ws=upload(ctx,'shot','SHOT-01');const asset=ws.assets.at(-1);use(ctx,asset);
 const project=ctx.store.read('projects',ctx.project.id);ctx.store.update(project.id,{revision:project.revision,idea:project.idea+'新增要求：茶杯改为白瓷。'});
 ws=ctx.images.view(project.id);assert.equal(ws.assets[0].stale,true);assert.equal(ws.assets[0].state,'needs_review');assert.throws(()=>ctx.images.select(project.id,{revision:ws.revision,assetId:asset.id}),/当前输入/);assert.ok(ctx.images.file(project.id,asset.id).bytes.length);
});
test('参考图换版仅使引用它的镜头图需复核；本人定妆图不因选用自己而过期',()=>{
 const ctx=fixture();let ws=upload(ctx,'character','CHAR-01');const ref=ws.assets.at(-1);ws=use(ctx,ref);assert.equal(ws.assets.find(asset=>asset.id===ref.id).stale,false);
 ws=upload(ctx,'shot','SHOT-01');const shot=ws.assets.at(-1);use(ctx,shot);
 ws=upload(ctx,'character','CHAR-01',[80,90,90]);ws=use(ctx,ws.assets.at(-1));assert.equal(ws.assets.find(asset=>asset.id===shot.id).stale,true);assert.equal(ws.assets.find(asset=>asset.id===ref.id).stale,false);
});
test('出图包包含实际提示词和ZIP内参考图，JSON不冒称已发送；旧包在参考更换后拒绝下载',()=>{
 const ctx=fixture();let ws=upload(ctx,'character','CHAR-01');ws=use(ctx,ws.assets.at(-1));
 const packet=ctx.images.prepare(ctx.project.id,{revision:ws.revision,shotId:'SHOT-01'});assert.match(packet.prompt,/静态/);assert.equal(packet.references.length,1);assert.equal(packet.references[0].attached,false);assert.equal(packet.references[0].includedInBundle,true);assert.equal(packet.submitted,false);assert.equal(packet.costStatus,'unknown');
 const bundle=ctx.images.bundle(ctx.project.id,packet.id);assert.equal(bundle.bytes.readUInt32LE(0),0x04034b50);assert.ok(bundle.bytes.includes(Buffer.from(packet.references[0].filename)));assert.ok(bundle.bytes.includes(testPng()));
 ws=upload(ctx,'character','CHAR-01',[70,70,70]);use(ctx,ws.assets.at(-1));assert.throws(()=>ctx.images.bundle(ctx.project.id,packet.id),/已改变/);
});
test('损坏磁盘文件或越界ID不能预览和选用，原元数据及历史仍保留',()=>{
 const ctx=fixture();const ws=upload(ctx,'shot','SHOT-01'),asset=ws.assets.at(-1),file=ctx.images.file(ctx.project.id,asset.id);fs.appendFileSync(file.path,'bad');assert.throws(()=>ctx.images.file(ctx.project.id,asset.id),/Hash/);assert.throws(()=>ctx.images.file(ctx.project.id,'../outside'));assert.equal(ctx.images.get(ctx.project.id).assets.length,1);
});
test('无来源声明、旧revision和未知目标上传被拒绝，不按扩展名相信内容',()=>{
 const ctx=fixture();const args={revision:0,role:'shot',targetId:'SHOT-01',filename:'x.png',source:{kind:'test',description:'明确测试素材'}};
 assert.throws(()=>ctx.images.import(ctx.project.id,{...args,source:{kind:'chatgpt-web',description:''}},testPng()),/来源/);
 assert.throws(()=>ctx.images.import(ctx.project.id,{...args,targetId:'SHOT-99'},testPng()),/真实/);
 upload(ctx,'shot','SHOT-01');assert.throws(()=>ctx.images.import(ctx.project.id,args,testPng()),/其他窗口/);
});
test('当前要求或预设改变使旧采用分镜停止新导出；旧包回图沿旧快照保留而不盖成当前输入',()=>{
 const ctx=fixture();let ws=ctx.images.view(ctx.project.id);const packet=ctx.images.prepare(ctx.project.id,{revision:ws.revision,shotId:'SHOT-01'});
 const creative=ctx.creative.get(ctx.project.id);ctx.creative.update(ctx.project.id,{revision:creative.revision,instructions:'新要求：结尾不能看手机。'});
 ws=ctx.images.view(ctx.project.id);assert.equal(ws.targets.find(target=>target.key==='shot:SHOT-01').ready,false);assert.throws(()=>ctx.images.prepare(ctx.project.id,{revision:ws.revision,shotId:'SHOT-01'}),/输入有冲突/);
 ws=ctx.images.import(ctx.project.id,{revision:ws.revision,role:'shot',targetId:'SHOT-01',packetId:packet.id,filename:'old-packet-result.png',source:{kind:'test',description:'旧任务回图的明确测试素材，非AI生成。'}},testPng());
 const asset=ws.assets.at(-1);assert.equal(asset.targetHash,packet.binding.targetHash);assert.equal(asset.packetId,packet.id);assert.deepEqual(asset.inputSnapshot,packet.sourceSnapshot);assert.equal(asset.inputSnapshot.project.idea,ctx.project.idea);assert.equal(asset.inputSnapshot.requirements,'');assert.equal(asset.stale,true);assert.equal(asset.modelInputVerification,'bound_to_exported_packet_user_declared');assert.throws(()=>ctx.images.review(ctx.project.id,{revision:ws.revision,assetId:asset.id,verdict:'accepted'}),/旧图片/);
});
test('镜头引用已失效实体版本时不能准备；出图包中实体来源保持单独状态',()=>{
 const ctx=fixture();const workspace=ctx.creative.get(ctx.project.id),entities=structuredClone(workspace.entities);entities[0].version='v2';
 ctx.creative.update(ctx.project.id,{revision:workspace.revision,entities});const ws=ctx.images.view(ctx.project.id),target=ws.targets.find(target=>target.key==='shot:SHOT-01');assert.equal(target.ready,false);assert.match(target.error,/准确ID及版本/);assert.throws(()=>ctx.images.prepare(ctx.project.id,{revision:ws.revision,shotId:'SHOT-01'}),/输入有冲突/);
});
test('所引用原图磁盘Hash被改后，图片本身及已绑定镜头都需复核且旧包停止下载',()=>{
 const ctx=fixture();let ws=upload(ctx,'character','CHAR-01');const reference=ws.assets.at(-1);ws=use(ctx,reference);const packet=ctx.images.prepare(ctx.project.id,{revision:ws.revision,shotId:'SHOT-01'});
 ws=upload(ctx,'shot','SHOT-01');const shot=ws.assets.at(-1);ws=use(ctx,shot);const file=ctx.images.file(ctx.project.id,reference.id);fs.writeFileSync(file.path,testPng(320,180,[10,20,30]));
 ws=ctx.images.view(ctx.project.id);assert.equal(ws.assets.find(asset=>asset.id===reference.id).fileChanged,true);assert.equal(ws.assets.find(asset=>asset.id===reference.id).state,'needs_review');assert.equal(ws.assets.find(asset=>asset.id===shot.id).stale,true);assert.throws(()=>ctx.images.bundle(ctx.project.id,packet.id),/已改变/);
});
test('仅引用清单不能声称附件已包含，素材与任务包不能跨项目绑定',()=>{
 const ctx=fixture();let ws=upload(ctx,'scene','SCENE-01');const asset=ws.assets.at(-1);ws=use(ctx,asset);const packet=ctx.images.prepare(ctx.project.id,{revision:ws.revision,shotId:'SHOT-01',referenceAssetIds:[]});
 assert.equal(packet.references.length,0);assert.equal(packet.referenceManifest.find(ref=>ref.assetId===asset.id).status,'reference_only');assert.equal(packet.referenceManifest.find(ref=>ref.assetId===asset.id).attached,false);
 const other=ctx.store.create({name:'[测试] 另一个项目',idea:'另一部故事。'});assert.throws(()=>ctx.images.file(other.id,asset.id),/不存在/);assert.throws(()=>ctx.images.bundle(other.id,packet.id),/不存在/);
});
