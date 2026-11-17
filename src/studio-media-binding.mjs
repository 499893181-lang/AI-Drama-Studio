import fs from 'node:fs';
import path from 'node:path';
import {AppError} from './store.mjs';
import {creativeHash} from './creative-store.mjs';

/** Registry adapters own transport; this bridge owns app versions and actual asset eligibility. */
export function bindStudioMedia({services,images,videos,visuals,store}){
  const snapshot=(projectId,category,input)=>{
    if(category==='video'){
      const source=videos.workspace.source(projectId,input.shotId);
      // Persist the actual semantic input and image metadata, never Buffer bytes
      // or the mutable whole workspace. structuredClone(Buffer) is Uint8Array,
      // whose JSON differs from Buffer.toJSON and would invalidate inputHash.
      const inputSnapshot={image:source.image,target:source.target,sourceVersion:source.source.sourceVersion,sourceHash:source.source.sourceHash,knowledgeHash:source.source.knowledge.hash,designSnapshot:source.snapshot,motionPrompt:source.motionPrompt};
      return{kind:'video',shotId:input.shotId,binding:source.binding,bindingHash:source.bindingHash,inputSnapshot,parameters:input.parameters??{},promptDependencyHash:visuals.prompts(projectId).inputHash};
    }
    const source=images.source(projectId),target=source.targets.find(t=>t.role===input.role&&t.targetId===input.targetId);
    if(!target?.ready)throw new AppError('请先确认当前剧本或分镜并保存视觉设定，选择可用图片目标。',409);
    return{kind:'image',role:target.role,targetId:target.targetId,targetVersion:target.targetVersion,binding:images.binding(images.get(projectId),target,source),inputSnapshot:images.snapshot(source,target),entityRefs:target.entityRefs,assetPurpose:target.assetPurpose??'shot_frame',prompt:target.prompt};
  };
  services.media.validateInput=(task,{current=true}={})=>{
    if(!task.input.appBinding||!task.input.appBindingHash||creativeHash(task.input.appBinding)!==task.input.appBindingHash)throw new AppError('缺少受当前项目核验的版本绑定，请从当前镜头或参考板准备任务。',409);
    if(current&&creativeHash(snapshot(task.projectId,task.category,task.input))!==task.input.appBindingHash)throw new AppError('剧本、分镜、图片、视觉设定或当前人工审核已变化，旧任务需复核。',409);
    if(task.category==='video'&&!(task.input.references??[]).some(ref=>ref.role==='first_frame'&&ref.assetId===task.input.appBinding.inputSnapshot.image.id))throw new AppError('实际附件必须包含本次绑定且已人工选用的首帧，不能仅记录绑定或改成纯文生视频。',409);
    for(const ref of task.input.references??[]){
      if(!ref.assetId)throw new AppError('参考须绑定本项目真实图片资产，不能上传任意文件路径。',409);
      const file=images.file(task.projectId,ref.assetId);
      if(fs.realpathSync.native(file.path).toLowerCase()!==fs.realpathSync.native(ref.path).toLowerCase())throw new AppError('附件路径与绑定资产不一致。',409);
      if(current){const state=images.view(task.projectId).assets.find(a=>a.id===ref.assetId);if(state.stale||!state.reviewCurrent||!state.selected||state.review?.verdict!=='accepted'||state.sha256!==ref.hash)throw new AppError('实际参考图未检查选用、已拒绝或版本Hash改变。',409);}
    }
  };
  services.media.importCandidate=async({task,bytes,probe,evidence})=>{
    const binding=task.input.appBinding;
    if(task.category==='image')return images.importServiceCandidate(task.projectId,{binding,task,bytes,probe,evidence});
    const adapted={...task,provider:task.serviceSnapshot.provider,providerStatus:'success',shotId:binding.shotId,binding:binding.binding,bindingHash:binding.bindingHash,inputSnapshot:binding.inputSnapshot,parameters:{...binding.parameters,audioMode:binding.parameters.audioMode??'retain_original'},executionMode:task.input.testFixture?'isolated-fixture':'official-service-api'};
    return videos.workspace.importCandidate(task.projectId,{task:adapted,bytes,probe,provenance:{...evidence,provider:task.serviceSnapshot.provider,model:task.serviceSnapshot.model}});
  };
  return{prepare(projectId,category,input){
    const appBinding=snapshot(projectId,category,input);
    if(category==='video'&&!(input.references??[]).some(ref=>ref.role==='first_frame'&&ref.assetId===appBinding.inputSnapshot.image.id))throw new AppError('请实际附加当前选用首帧，不能仅记录计划。',409);
    const references=(input.references??[]).map(ref=>{const file=images.file(projectId,ref.assetId),asset=images.get(projectId).assets.find(a=>a.id===ref.assetId);return{assetId:asset.id,path:file.path,hash:asset.sha256,role:ref.role,type:'image_url',url:ref.url??null,mimeType:asset.mimeType};});
    return services.media.prepare(projectId,category,{...input,appBinding,appBindingHash:creativeHash(appBinding),references});
  }};
}
