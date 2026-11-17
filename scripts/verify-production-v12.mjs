// Independent, labelled software acceptance. No model, provider or canvas calls.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Store} from '../src/store.mjs';
import {CreativeWorkspace} from '../src/creative-store.mjs';
import {ImageWorkspace} from '../src/image-store.mjs';
import {VideoWorkspace} from '../src/video-store.mjs';
import {VoiceWorkspace} from '../src/voice-store.mjs';
import {EditService} from '../src/edit-media.mjs';
import {JianyingService} from '../src/jianying-service.mjs';
import {probeVideo,runMedia,stripVideoAudio} from '../src/video-media.mjs';
import {resolveExecutable} from '../src/tools.mjs';
import {fixtureEntities,fixtureShots,fixtureScript} from '../tests/creative-fixtures.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),data=path.join(root,'tests','.artifacts','production-v12-'+randomUUID()),store=new Store(data);
const project=store.create({name:'TEST / NOT AI · 声音与剪辑验收',idea:'TEST FIXTURE / NOT AI。完全虚构的工程验收故事；不调用任何模型或收费服务。',durationSeconds:30,aspectRatio:'16:9'}),creative=new CreativeWorkspace(store);
creative.update(project.id,{revision:0,entities:structuredClone(fixtureEntities),shots:fixtureShots()});
creative.addVersion(project.id,{revision:1,kind:'script',body:fixtureScript().body});
creative.addVersion(project.id,{revision:2,kind:'storyboard',body:'TEST / NOT AI：仅本地视频/声音/剪辑技术验收。'});
const images=new ImageWorkspace(store,{creativeWorkspace:creative}),videos=new VideoWorkspace(store,{images}),image=fs.readFileSync(path.join(root,'docs','video-v07-evidence','TEST-FIXTURE-NOT-AI-input.png')),movie=path.join(root,'docs','video-v07-evidence','TEST-FIXTURE-NOT-AI.mp4'),probe=await probeVideo(movie),videoBytes=fs.readFileSync(movie),assets=[];
for(const shot of fixtureShots()){
 let imageView=images.import(project.id,{revision:images.get(project.id).revision,role:'shot',targetId:shot.id,filename:'TEST-FIXTURE-NOT-AI.png',source:{kind:'test',description:'Repository engineering fixture. NOT AI.'}},image),asset=imageView.assets.at(-1);imageView=images.review(project.id,{revision:imageView.revision,assetId:asset.id,verdict:'accepted',notes:'TEST technical fixture only.'});images.select(project.id,{revision:imageView.revision,assetId:asset.id});
 const source=videos.source(project.id,shot.id),task={id:randomUUID(),externalTaskId:'TEST-LOCAL-IMPORT-'+randomUUID(),shotId:shot.id,providerStatus:'success',executionMode:'isolated-fixture',binding:source.binding,bindingHash:source.bindingHash,inputSnapshot:source.snapshot,parameters:{audioMode:'provider_default',durationSeconds:probe.durationSeconds,model:'TEST-LOCAL-EXISTING-VIDEO',resolution:'720p'}},candidate=videos.importCandidate(project.id,{task,bytes:videoBytes,probe});videos.review(project.id,{revision:videos.get(project.id).revision,assetId:candidate.id,verdict:'accepted',notes:'TEST local import, not AI generation.'});videos.select(project.id,{revision:videos.get(project.id).revision,assetId:candidate.id});assets.push(candidate);
}
const voice=new VoiceWorkspace(store,{creative}),cards=voice.view(project.id).cards,card=cards[0],utterance={id:'LINE-01',cardId:card.id,text:'TEST / NOT AI：你呀，要按时吃饭。',performance:'克制，句尾轻收；当前试听为测试正弦音，不是配音。',targetDurationUs:2000000,parameters:{speed:1}};voice.update(project.id,{revision:0,cards,utterances:[utterance]});
const tone=path.join(data,'TEST-NOT-AI-tone.wav');await runMedia(resolveExecutable('ffmpeg'),['-v','error','-nostdin','-n','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-c:a','pcm_s16le','-metadata','title=TEST FIXTURE / NOT AI',tone]);const audio=await voice.import(project.id,{revision:1,utteranceId:'LINE-01',filename:'TEST-NOT-AI-tone.wav',source:{kind:'test',description:'Local FFmpeg sine wave. NOT AI; not spoken dialogue.'}},fs.readFileSync(tone));voice.review(project.id,{revision:2,assetId:audio.id,verdict:'accepted',notes:'TEST pure audio decode; no TTS quality claim.'});voice.select(project.id,{revision:3,assetId:audio.id});
const edit=new EditService(store,{videos,voice});const plan=edit.workspace.update(project.id,{revision:0,width:640,height:360,fps:25,muteOriginal:true,clips:[{id:'CLIP-01',assetId:assets[0].id,trimInUs:500000,trimOutUs:4000000,startUs:0},{id:'CLIP-02',assetId:assets[1].id,trimInUs:1000000,trimOutUs:4500000,startUs:3000000}],transitions:[{afterClipId:'CLIP-01',type:'fade',durationUs:500000}],audioTracks:[{id:'AUDIO-01',assetId:audio.id,kind:'dialogue',startUs:1000000,trimInUs:0,trimOutUs:2000000,volume:.4,fadeInUs:100000,fadeOutUs:300000}],subtitles:[{startUs:1000000,endUs:3000000,text:'TEST / NOT AI · 字幕与混音验收'}]});const task=edit.prepare(project.id,{revision:plan.revision}),result=await edit.run(task.id);if(result.status!=='succeeded')throw new Error(result.error);
const muted=await stripVideoAudio(edit.file(result.id).path,path.join(path.dirname(edit.file(result.id).path),'TEST-NOT-AI-muted.mp4'),{confirmed:true});
const jianying=new JianyingService(store,{edit}),draft=await jianying.create(project.id,{revision:plan.revision});
const evidence={schemaVersion:1,label:'TEST FIXTURE / NOT AI',dataDir:data,projectId:project.id,voiceAssetId:audio.id,voiceProbe:audio.probe,editTaskId:result.id,output:result.result,muted,draft,externalGenerationCalls:0,formalStageStatus:'not_checked',modelGeneration:'not_executed',openedInJianying:false,automaticJianyingExport:false};fs.writeFileSync(path.join(data,'acceptance.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({dataDir:data,projectId:project.id,editTaskId:result.id,mp4:edit.file(result.id).path,draftPath:draft.draftPath??null,draftStatus:draft.status,draftError:draft.error,externalGenerationCalls:0},null,2));
