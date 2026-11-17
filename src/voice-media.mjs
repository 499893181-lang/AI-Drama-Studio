import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {AppError,now} from './store.mjs';
import {runMedia} from './video-media.mjs';
import {resolveExecutable} from './tools.mjs';

export async function probeAudio(file,{signal,ffprobeBin=resolveExecutable('ffprobe'),ffmpegBin=resolveExecutable('ffmpeg'),run=runMedia,decode=true}={}) {
  if(typeof file!=='string'||!path.isAbsolute(file)||!fs.existsSync(file)||!fs.statSync(file).isFile()) throw new AppError('音频文件不存在。',409);
  const bytes=fs.readFileSync(file);if(bytes.length<32||bytes.length>100*1024*1024)throw new AppError('音频为空或超过100MiB。',409);
  const sha256=createHash('sha256').update(bytes).digest('hex'),args=['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',file];
  const receipt=await run(ffprobeBin,args,{signal});let raw;
  try{raw=JSON.parse(receipt.stdout);}catch{throw new AppError('FFprobe未返回有效音频检查结果。',409);}
  const audio=(raw.streams??[]).filter(s=>s.codec_type==='audio'),video=(raw.streams??[]).filter(s=>s.codec_type==='video'&&!s.disposition?.attached_pic),durationSeconds=Number(raw.format?.duration??audio[0]?.duration);
  if(audio.length!==1||video.length||!Number.isFinite(durationSeconds)||durationSeconds<=0||!audio[0].codec_name)throw new AppError('需要可解码的单音轨纯音频；未当作视频处理。',409);
  let decodeReceipt=null;if(decode)decodeReceipt=await run(ffmpegBin,['-v','error','-xerror','-nostdin','-protocol_whitelist','file,pipe','-i',file,'-map','0:a:0','-f','null','-'],{signal});
  if(createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==sha256)throw new AppError('检查期间音频文件变化。',409);
  const format=raw.format?.format_name,mimeType=format==='wav'?'audio/wav':format==='mp3'?'audio/mpeg':format==='ogg'?'audio/ogg':format==='flac'?'audio/flac':/(?:^|,)(mp4|mov)(?:,|$)/.test(format??'')?'audio/mp4':null;
  if(!mimeType)throw new AppError(`已解码但当前浏览器试听容器${format??'未知'}尚未适配，请导入WAV/MP3/OGG/FLAC/M4A。`,409);
  return {verified:true,decoded:decode,checkedAt:now(),sha256,size:bytes.length,durationSeconds,audioStreams:audio.length,videoStreams:video.length,codec:audio[0].codec_name,sampleRate:Number(audio[0].sample_rate),channels:audio[0].channels,format,mimeType,rawProbe:raw,tool:{name:'ffprobe',args,exitCode:receipt.exitCode},decodeReceipt:decodeReceipt?{exitCode:decodeReceipt.exitCode}:null};
}
