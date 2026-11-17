import {AppError,validId} from './store.mjs';
import {VoiceService} from './voice-store.mjs';
import {EditService} from './edit-media.mjs';
import {JianyingService} from './jianying-service.mjs';

async function readMediaJson(request){
  if(!request.headers['content-type']?.startsWith('application/json'))throw new AppError('请求须为JSON。',415);
  const chunks=[];let length=0;for await(const chunk of request){length+=chunk.length;if(length>140*1024*1024)throw new AppError('音频请求超过140MiB。',413);chunks.push(chunk);}let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError('音频请求JSON无效。');}if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError('音频请求须为对象。');return value;
}

export function createProductionServices(store,{creative,videos,registry,voiceOptions={},editOptions={},jianyingOptions={}}={}) {
  const voice=new VoiceService(store,{creative,resolve:registry?.resolve?.bind(registry),secretFor:registry?.secretFor?.bind(registry),assertSnapshotCurrent:registry?.assertSnapshotCurrent?.bind(registry),...voiceOptions}),edit=new EditService(store,{videos,voice,...editOptions}),jianying=new JianyingService(store,{edit,...jianyingOptions});
  return {voice,edit,jianying,close(){voice.close();edit.close();}};
}
/** Mount after the host's same-origin checks. Uses host body limits/security and Range media response. */
export async function handleProductionRoute(request,response,{url,readJson,json,sendVideo,production}={}) {
  const {voice,edit,jianying}=production,parts=url.pathname.split('/').filter(Boolean),method=request.method;
  if(parts[0]!=='api')return false;
  if(parts[1]==='projects'&&validId(parts[2])) {
    const id=parts[2],section=parts[3],action=parts[4];
    if(section==='voice') {
      if(!action&&method==='GET'){json(response,voice.view(id));return true;}
      if(!action&&method==='PUT'){json(response,voice.workspace.update(id,await readJson(request)));return true;}
      if(action==='import'&&method==='POST'){const input=await readMediaJson(request);if(typeof input.base64!=='string'||input.base64.length>140000000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64))throw new AppError('音频Base64无效。');const asset=await voice.workspace.import(id,input,Buffer.from(input.base64,'base64'));json(response,{...voice.view(id),importedAssetId:asset.id},201);return true;}
      if(action==='review'&&method==='POST'){json(response,voice.workspace.review(id,await readJson(request)));return true;}
      if(action==='select'&&method==='POST'){json(response,voice.workspace.select(id,await readJson(request)));return true;}
      if(action==='prepare'&&method==='POST'){json(response,await voice.prepare(id,await readJson(request)),201);return true;}
      if(action==='assets'&&parts[6]==='file'&&['GET','HEAD'].includes(method)){sendVideo(request,response,voice.workspace.file(id,parts[5]));return true;}
      throw new AppError('声音操作不存在。',405);
    }
    if(section==='edit-plan') {
      if(!action&&method==='GET'){json(response,{...edit.view(id),jianying:{...jianying.status(),tasks:jianying.store.list('jianying-exports').values.filter(task=>task.projectId===id)}});return true;}
      if(!action&&method==='PUT'){json(response,edit.workspace.update(id,await readJson(request)));return true;}
      if(action==='audio-import'&&method==='POST'){const input=await readMediaJson(request);if(typeof input.base64!=='string'||input.base64.length>140000000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64))throw new AppError('声音素材Base64无效。');json(response,await edit.workspace.importAudio(id,input,Buffer.from(input.base64,'base64')),201);return true;}
      if(action==='audio-review'&&method==='POST'){json(response,edit.workspace.reviewAudio(id,await readJson(request)));return true;}
      if(action==='audio-select'&&method==='POST'){json(response,edit.workspace.selectAudio(id,await readJson(request)));return true;}
      if(action==='audio-assets'&&parts[6]==='file'&&['GET','HEAD'].includes(method)){sendVideo(request,response,edit.workspace.audioFile(id,parts[5]));return true;}
      if(action==='export'&&method==='POST'){const task=edit.prepare(id,await readJson(request));edit.run(task.id).catch(()=>{});json(response,task,202);return true;}
      if(action==='jianying'&&method==='POST'){json(response,await jianying.create(id,await readJson(request)),201);return true;}
      throw new AppError('剪辑操作不存在。',405);
    }
  }
  if(parts[1]==='voice-tasks'&&validId(parts[2])){if(parts[3]==='quote'&&method==='POST'){json(response,voice.quote(parts[2],await readJson(request)));return true;}if(parts[3]==='run'&&method==='POST'){json(response,await voice.run(parts[2],await readJson(request)));return true;}if(parts.length===3&&method==='GET'){json(response,voice.store.read('voice-tasks',parts[2]));return true;}}
  if(parts[1]==='edit-exports'&&validId(parts[2])){if(parts[3]==='file'&&['GET','HEAD'].includes(method)){sendVideo(request,response,edit.file(parts[2]));return true;}if(parts[3]==='manifest'&&method==='GET'){json(response,edit.manifest(parts[2]));return true;}if(parts.length===3&&method==='GET'){json(response,edit.store.read('edit-exports',parts[2]));return true;}}
  return false;
}
