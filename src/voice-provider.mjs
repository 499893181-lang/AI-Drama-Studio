import { AppError } from './store.mjs';

export const voiceContracts = Object.freeze({
  'minimax-speech': { source: 'https://platform.minimax.io/docs/api-reference/speech-t2a-http.md', kind: 'synchronous-audio', queryable: false, models: ['speech-2.8-hd','speech-2.8-turbo','speech-2.6-hd','speech-2.6-turbo'], verified: 'contract-only' },
  elevenlabs: { source: 'https://elevenlabs.io/docs/api-reference/text-to-speech/convert', kind: 'synchronous-audio', queryable: false, models: ['eleven_multilingual_v2','eleven_v3'], verified: 'contract-only' },
  indextts: { source: 'https://github.com/index-tts/index-tts', kind: 'local-workflow', queryable: false, verified: 'runtime-not-verified' },
  'qwen3-tts': { source: 'https://github.com/QwenLM/Qwen3-TTS', kind: 'local-workflow', queryable: false, verified: 'runtime-not-verified' },
});
const number = (value, min, max, fallback) => { if(value === undefined || value === null || value === '') return fallback; if(typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new AppError(`声音参数须在${min}至${max}之间。`); return value; };

/** Intent is retained separately. Unsupported directions never become a claim that the model performed them. */
export function compileVoiceParameters(provider, model, card, utterance) {
  if(!voiceContracts[provider]) throw new AppError('未适配的语音服务。',409);
  const intent = { performance: utterance.performance ?? '', emotion: utterance.emotion ?? '', stress: utterance.stress ?? '', pause: utterance.pause ?? '', voiceDescription: card.description ?? '' }, unsupported = [];
  if(typeof utterance.text !== 'string' || !utterance.text.trim() || utterance.text.length>10000) throw new AppError('单句台词须为1至10000字。');
  const settings = utterance.parameters ?? {};
  if(provider === 'minimax-speech') {
    if(!voiceContracts[provider].models.includes(model)) throw new AppError('该MiniMax声音型号尚未建立参数契约；请先验证具体型号。',409);
    if(!card.voiceId) throw new AppError('请先选择本账号有权使用的音色ID。',409);
    const supportedEmotions = new Set(['happy','sad','angry','fearful','disgusted','surprised','calm']);
    if(model.startsWith('speech-2.6-')) { supportedEmotions.add('fluent'); supportedEmotions.add('whisper'); }
    const voice_setting = { voice_id: card.voiceId, speed: number(settings.speed,.5,2,1), vol: number(settings.volume,0,10,1), pitch: number(settings.pitch,-12,12,0) };
    if(settings.emotion) { if(supportedEmotions.has(settings.emotion)) voice_setting.emotion=settings.emotion; else unsupported.push(`emotion=${settings.emotion}：${model}未支持该枚举，未发送。`); }
    for(const key of ['performance','stress','pause']) if(intent[key]) unsupported.push(`${key}为自然语言意图，未自动改写原台词或保证表演效果。`);
    return { provider, model, intent, unsupported, actual: { model, text: utterance.text, stream:false, output_format:'hex', voice_setting, audio_setting:{sample_rate:32000,bitrate:128000,format:'mp3',channel:1} }, source:voiceContracts[provider].source };
  }
  if(provider === 'elevenlabs') {
    if(!card.voiceId || !/^[A-Za-z0-9_-]{1,120}$/.test(card.voiceId)) throw new AppError('请先选择可用的ElevenLabs音色ID。',409);
    const voice_settings = { stability:number(settings.stability,0,1,.5), similarity_boost:number(settings.similarity,0,1,.75), style:number(settings.style,0,1,0), speed:number(settings.speed,.7,1.2,1), use_speaker_boost:settings.speakerBoost!==false };
    if(model === 'eleven_v3') delete voice_settings.use_speaker_boost;
    for(const key of ['performance','emotion','stress','pause']) if(intent[key]) unsupported.push(`${key}保留为表演意图；未将未验证的标签或SSML添加到台词。`);
    return {provider,model,intent,unsupported,voiceId:card.voiceId,actual:{text:utterance.text,model_id:model,voice_settings},source:voiceContracts[provider].source};
  }
  return {provider,model,intent,unsupported:['本地运行后台、模型权重、参考音频权限与实际工作流尚需分别验证；未启动或下载模型。'],actual:null,source:voiceContracts[provider].source,blocked:'local_workflow_not_verified'};
}

/** A single POST; network uncertainty is never retried or represented as a queryable task. */
export async function runVoiceProvider(compiled, { secret, signal, fetchImpl=fetch, localRunner }={}) {
  if(compiled.blocked) {
    if(!localRunner?.verified || typeof localRunner.run!=='function') throw new AppError('本地TTS工作流未验证，不能把安装技能显示为服务就绪。',409);
    return localRunner.run(compiled,{signal});
  }
  if(!secret) throw new AppError('语音服务密钥尚未配置。',409);
  const minimax=compiled.provider==='minimax-speech', url=minimax?'https://api.minimax.io/v1/t2a_v2':`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(compiled.voiceId)}?output_format=mp3_44100_128`;
  let response;
  try { response=await fetchImpl(url,{method:'POST',headers:minimax?{'Authorization':`Bearer ${secret}`,'Content-Type':'application/json'}:{'xi-api-key':secret,'Content-Type':'application/json'},body:JSON.stringify(compiled.actual),signal}); }
  catch(error) { const uncertain=new AppError('语音POST结果未知；同步接口没有已验证的任务查询ID，不自动重试。',409); uncertain.outcomeUnknown=true; throw uncertain; }
  if(!response.ok) { const error=new AppError(`语音服务返回HTTP ${response.status}；未重试。`,409); error.definitelyRejected=response.status>=400&&response.status<500&&![408,429].includes(response.status); error.outcomeUnknown=!error.definitelyRejected;error.rawReceipt={httpStatus:response.status,body:await response.text()};throw error; }
  if(minimax) {
    const rawText=await response.text();let raw;try{raw=JSON.parse(rawText);}catch{const error=new AppError('MiniMax响应不是有效JSON，原文保留；未重试。',409);error.rawReceipt={httpStatus:response.status,body:rawText};throw error;}
    if(raw.base_resp?.status_code!==0 || raw.data?.status!==2 || typeof raw.data?.audio!=='string' || !/^(?:[a-fA-F0-9]{2})+$/.test(raw.data.audio)) {const error=new AppError('MiniMax没有返回完整音频及明确成功终态；原回执保留供诊断。',409);error.rawReceipt=raw;throw error;}
    const {audio,...data}=raw.data;
    return {bytes:Buffer.from(audio,'hex'),mimeType:'audio/mpeg',extension:'mp3',terminalEvidence:{kind:'minimax-sync-completion',status:raw.data.status,baseResponse:raw.base_resp},rawReceipt:{...raw,data:{...data,audioOmitted:true,audioHexLength:audio.length}},diagnosticTraceId:raw.trace_id??null,externalTaskId:null,queryable:false,usage:raw.extra_info??null};
  }
  const bytes=Buffer.from(await response.arrayBuffer());
  if(!bytes.length) throw new AppError('ElevenLabs返回空音频，不能标记生成成功。',409);
  return {bytes,mimeType:response.headers.get('content-type')??'audio/mpeg',extension:'mp3',terminalEvidence:{kind:'elevenlabs-sync-response',httpStatus:response.status,audioBytes:bytes.length},rawReceipt:{httpStatus:response.status,contentType:response.headers.get('content-type'),requestId:response.headers.get('request-id')},externalTaskId:null,queryable:false,usage:null};
}
