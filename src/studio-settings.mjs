import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { AppError, now } from './store.mjs';

export const VISUAL_STYLES = [
  ['realistic','时代写实','Realism','真实材质、自然光、可信空间'], ['3d','3D 漫剧','3D animation','统一模型比例、材质与角色轮廓'],
  ['watercolor','水彩','Watercolor','纸张颗粒、透明叠色、柔和边缘'], ['storybook','绘本','Picture book','清晰形状、手绘笔触、叙事性构图'],
  ['comic','美式漫画','American comics','墨线、块面阴影与受控网点'], ['chinese','国风','Chinese art','中式造型与空间，明确具体时代'],
  ['2.5d','2.5D','2.5D','分层空间、平面造型与立体光照'], ['custom','自定义','Custom','由项目文字说明定义'],
].map(([id,name,nameEn,description])=>({id,name,nameEn,description,version:1,source:'docs/research/2026-11-15-douyin-study/01-image-prompt-handbook.md',status:'creative_preset_not_model_validation'}));

export class StudioSettings {
  constructor(store,{pickDirectory}={}) { this.store=store; this.pickDirectory=pickDirectory??windowsFolderPicker; fs.mkdirSync(path.join(store.root,'studio-settings'),{recursive:true}); }
  get() { try{return this.store.read('studio-settings','preferences');}catch(e){if(e.status!==404)throw e;return{id:'preferences',revision:0,language:'zh-CN',theme:'light',defaultProjectDirectory:null,updatedAt:null};} }
  preferences() { const {language,theme,revision}=this.get();return{language,theme,revision,appName:'AI DRAMA STUDIO'}; }
  update(body,{assistantTurnId=null}={}) { const prev=this.get();if(body.revision!==prev.revision)throw new AppError('设置已改变，请刷新后保存。',409);const next={...prev};if(Object.hasOwn(body,'language')){if(!['zh-CN','en'].includes(body.language))throw new AppError('请选择中文或英文。');next.language=body.language;}if(Object.hasOwn(body,'theme')){if(!['light','dark'].includes(body.theme))throw new AppError('请选择浅色或深色。');next.theme=body.theme;}next.history=[...(prev.history??[]),{id:`preferences-${prev.revision+1}`,assistantTurnId,before:{language:prev.language,theme:prev.theme},after:{language:next.language,theme:next.theme},createdAt:now()}];this.store.write('studio-settings',{...next,revision:prev.revision+1,updatedAt:now()});return this.preferences(); }
  storage() { const value=this.get();return{revision:value.revision,defaultProjectDirectory:value.defaultProjectDirectory,governanceRoot:this.store.root,existingProjectsMoved:false,appliesTo:'new_projects_only',ledgerPolicy:'stable_governance_root',message:'默认位置仅影响新项目。历史素材、任务、签名及原图片调用计数继续使用原治理根。'}; }
  async pick() { const selected=await this.pickDirectory();return selected?{cancelled:false,path:selected}:{cancelled:true,path:null}; }
  saveStorage(body) {const prev=this.get();if(body.revision!==prev.revision)throw new AppError('存储设置已改变，请刷新。',409);if(body.cancelled)return this.storage();if(typeof body.path!=='string'||!body.path.trim()||!path.isAbsolute(body.path))throw new AppError('请选择实际绝对目录。');const resolved=fs.realpathSync.native(body.path);if(!fs.statSync(resolved).isDirectory())throw new AppError('保存位置不是文件夹。');const probe=path.join(resolved,`.ai-drama-write-${randomUUID()}.tmp`);try{fs.writeFileSync(probe,'write-probe',{flag:'wx'});}catch{throw new AppError('所选目录不可写，请选择有写入权限的位置。');}finally{if(fs.existsSync(probe))fs.unlinkSync(probe);}this.store.write('studio-settings',{...prev,defaultProjectDirectory:resolved,revision:prev.revision+1,updatedAt:now()});return this.storage();}
}
function windowsFolderPicker(){if(process.platform!=='win32')throw new AppError('当前系统没有原生 Windows 文件夹选择器，请输入绝对目录。',409);return new Promise((resolve,reject)=>{const code="Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'AI Drama Studio'; if ($dialog.ShowDialog() -eq 'OK') { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::Write($dialog.SelectedPath) }";const child=spawn('powershell.exe',['-NoProfile','-STA','-Command',code],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',x=>out+=x);child.on('error',()=>reject(new AppError('无法启动本机目录选择器，请输入实际目录。',409)));child.on('close',code=>code===0?resolve(out.trim()||null):reject(new AppError('目录选择器未正常结束，设置未改变。',409)));});}
