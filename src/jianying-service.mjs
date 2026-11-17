import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {AppError,now} from './store.mjs';
import {creativeHash} from './creative-store.mjs';
import {runMedia} from './video-media.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');

function inspectJianying(){
  const candidates=[process.env.JIANYING_BIN,process.env.LOCALAPPDATA?path.join(process.env.LOCALAPPDATA,'JianyingPro','Apps','JianyingPro.exe'):null,'E:\\LenovoSoftstore\\Install\\jianyangzhuanyeban\\JianyingPro.exe'].filter(Boolean),executable=candidates.find(file=>path.isAbsolute(file)&&fs.existsSync(file)&&fs.statSync(file).isFile()),checkedAt=now();
  if(!executable)return {installation:'not_detected',executable:null,installedAppVersion:null,checkedAt};
  let installedAppVersion=null;
  if(process.platform==='win32')try{
    const script="$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); (Get-Item -LiteralPath $env:AI_DRAMA_JIANYING_LAUNCHER).VersionInfo.FileVersion",powershell=path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const value=execFileSync(powershell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{shell:false,windowsHide:true,encoding:'utf8',timeout:3000,env:{...process.env,AI_DRAMA_JIANYING_LAUNCHER:executable},stdio:['ignore','pipe','ignore']}).trim();if(/^\d+(?:\.\d+){2,3}$/.test(value))installedAppVersion=value;
  }catch{/* File presence alone does not prove the version or rendering compatibility. */}
  return {installation:'detected',executable,installedAppVersion,checkedAt};
}

export class JianyingService {
  constructor(store,{edit,pythonBin=path.join(root,'.local','jianying-venv','Scripts','python.exe'),runner=runMedia,draftRoot}={}){this.store=store;this.edit=edit;this.pythonBin=pythonBin;this.runner=runner;this.draftRoot=draftRoot??path.join(store.root,'runtime','jianying-drafts');this.appEvidence=inspectJianying();fs.mkdirSync(path.join(store.root,'jianying-exports'),{recursive:true});}
  status(){return {library:'pyjianyingdraft',pinnedVersion:'0.3.1',pythonConfigured:fs.existsSync(this.pythonBin),...this.appEvidence,draftCreation:'adapter-ready-needs-validation',draftOpen:'not_verified',automaticExport:false,automaticExportReason:'当前剪映的自动打开与导出契约未验证；未调用随包补丁CLI写入。',source:'https://github.com/GuanYixuan/pyJianYingDraft',draftRoot:this.draftRoot};}
  async create(id,input){const value=this.edit.workspace.get(id);this.edit.workspace.check(value,input.revision);if(!value.activeVersionId)throw new AppError('请先保存剪辑计划。',409);if(!fs.existsSync(this.pythonBin))throw new AppError('剪映草稿隔离Python环境未配置；请按文档安装锁定依赖。',409);const {version,sources}=this.edit.workspace.assertVersion(id,value.activeVersionId),fingerprint=creativeHash({versionId:version.id,hash:version.contentHash});const old=this.store.list('jianying-exports').values.find(t=>t.fingerprint===fingerprint);if(old)return old;
    const exportId=randomUUID(),name=`${version.testFixture?'TEST-NOT-AI-':''}AI-Drama-${exportId}`,directory=path.join(this.store.root,'runtime','jianying-exports',exportId);fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(this.draftRoot,{recursive:true});
    const task={id:exportId,projectId:id,versionId:version.id,fingerprint,status:'creating',draftCreated:false,openedInJianying:false,automaticallyExported:false,testFixture:version.testFixture,createdAt:now(),updatedAt:now(),externalGenerationCalls:0,error:null};this.store.write('jianying-exports',task);
    try{const files=sources.map((source,index)=>{const bytes=fs.readFileSync(source.path);if(sha(bytes)!==source.sha256)throw new AppError('草稿源素材Hash变化。',409);const file=path.join(directory,`material-${index}${source.kind==='video'?'.mp4':'.audio'}`);fs.writeFileSync(file,bytes,{flag:'wx'});return {path:file,sha256:source.sha256,kind:source.kind};});
      const manifest={name,draftRoot:this.draftRoot,plan:version,files};const manifestPath=path.join(directory,'input.json');fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2),'utf8');const script=path.join(root,'scripts','create-jianying-draft.py'),receipt=await this.runner(this.pythonBin,[script,manifestPath],{timeoutMs:60000});let result;try{result=JSON.parse(receipt.stdout.trim().split(/\r?\n/).at(-1));}catch{throw new AppError('草稿工具未返回有效创建结果。',409);}if(receipt.exitCode!==0||result.version!=='0.3.1'||result.name!==name)throw new AppError('草稿依赖版本或返回契约不符。',409);
      const draftPath=path.join(this.draftRoot,name),content=path.join(draftPath,'draft_content.json'),bytes=fs.readFileSync(content);const parsed=JSON.parse(bytes);if(!Array.isArray(parsed.tracks)||!parsed.tracks.length)throw new AppError('草稿没有可读轨道。',409);for(const file of files)if(sha(fs.readFileSync(file.path))!==file.sha256)throw new AppError('草稿素材检查失败。',409);
      task.status='created';task.draftCreated=true;task.draftPath=draftPath;task.contentSha256=sha(bytes);task.materials=files;task.receipt={exitCode:receipt.exitCode,result};task.limitations=result.limitations??[];task.openInstructions='使用剪映打开新草稿；创建JSON及素材引用检查不等于已在剪映11.8打开或导出。';
    }catch(error){task.status='failed';task.error=error.message;}task.updatedAt=now();this.store.write('jianying-exports',task);return task;
  }
}
