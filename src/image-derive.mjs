import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {AppError} from './store.mjs';
import {runMedia} from './video-media.mjs';
import {resolveExecutable} from './tools.mjs';
import {inspectImage} from './image-files.mjs';

export async function cropReference(images,projectId,input){
  const workspace=images.get(projectId);images.check(workspace,input.revision);
  const asset=images.view(projectId).assets.find(a=>a.id===input.assetId);
  if(!asset||asset.stale||!asset.reviewCurrent||asset.review?.verdict!=='accepted'||!asset.selected)throw new AppError('裁切来源须是当前人工检查通过并选用的图片。',409);
  const rect=input.rect;
  if(!rect||['x','y','width','height'].some(k=>!Number.isSafeInteger(rect[k]))||rect.x<0||rect.y<0||rect.width<1||rect.height<1||rect.x+rect.width>asset.width||rect.y+rect.height>asset.height)throw new AppError('裁切范围须位于原图像素尺寸内。');
  const source=images.file(projectId,asset.id),dir=path.join(images.store.root,'runtime','image-derivatives',randomUUID());fs.mkdirSync(dir,{recursive:true});
  const output=path.join(dir,'crop.png'),args=['-v','error','-nostdin','-n','-protocol_whitelist','file,pipe','-i',source.path,'-vf',`crop=${rect.width}:${rect.height}:${rect.x}:${rect.y}`,'-frames:v','1',output];await runMedia(resolveExecutable('ffmpeg'),args);const bytes=fs.readFileSync(output),info=inspectImage(bytes);
  if(info.width!==rect.width||info.height!==rect.height||createHash('sha256').update(fs.readFileSync(source.path)).digest('hex')!==asset.sha256)throw new AppError('裁切检查未通过，保留原图及派生文件。',409);
  if(images.get(projectId).revision!==input.revision)throw new AppError('裁切期间图片版本变化，结果留在运行记录，未重绑当前稿。',409);
  const currentSource=images.view(projectId).assets.find(a=>a.id===asset.id);if(currentSource.stale||!currentSource.reviewCurrent||!currentSource.selected||currentSource.review?.verdict!=='accepted')throw new AppError('裁切期间来源审核失效，派生文件保留但不重绑当前稿。',409);
  return images.import(projectId,{revision:input.revision,role:input.role??'shot',targetId:input.targetId,filename:`${asset.source.kind==='test'?'TEST-NOT-AI-':''}crop-${asset.id}.png`,source:{kind:asset.source.kind==='test'?'test':'other',description:`本地裁切派生，原图 ${asset.id} / ${asset.sha256}，范围 ${JSON.stringify(rect)}。不代表新AI生成。`}},bytes,null,{kind:'crop',parentAssetId:asset.id,parentSha256:asset.sha256,rect,outputSha256:createHash('sha256').update(bytes).digest('hex'),args,originalRetained:true,referencePurpose:'single_frame_crop_pending_human_review'});
}
