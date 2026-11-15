import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const sha = value => createHash('sha256').update(value).digest('hex');
const quoteCommandPath = value => {
  if (!path.isAbsolute(value) || /["%!\r\n]/.test(value)) throw new Error('私有hook路径包含不支持的shell字符，拒绝执行。');
  return `"${value}"`;
};
export function buildImageGuardCommand(scriptPath) {
  if(process.platform!=='win32')return `${quoteCommandPath(process.execPath)} ${quoteCommandPath(scriptPath)}`;
  // Native hooks inherit the session shell, which can be PowerShell even when
  // COMSPEC is cmd. A bare quoted executable is only a string expression in PS.
  // This unquoted, validated native launcher works from both shells; its body is
  // encoded after proper PowerShell literal quoting, never JSON shell escaping.
  const launcher=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  if(!path.isAbsolute(launcher)||/[\s"';&|<>%!\r\n]/.test(launcher)||!fs.existsSync(launcher))throw new Error('无法确认无歧义的官方Windows PowerShell启动器，拒绝执行hook。');
  const literal=value=>{if(!path.isAbsolute(value)||/[\r\n]/.test(value))throw new Error('私有hook路径格式不正确。');return `'${value.replace(/'/g,"''")}'`;};
  const body=`$ErrorActionPreference='Stop';[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$OutputEncoding=[System.Text.UTF8Encoding]::new($false);& ${literal(process.execPath)} ${literal(scriptPath)};exit $LASTEXITCODE`;
  return `${launcher} -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(body,'utf16le').toString('base64')}`;
}

/** A host-owned, per-attempt ledger. The model thread uses read-only sandbox. */
export function createImageGuard({ directory, prompt, references = [], policy = null }) {
  fs.mkdirSync(directory, { recursive: true });
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = { prompt, references: references.map(({ path, sha256 }) => ({ path, sha256 })), policy };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  fs.writeFileSync(manifestPath, manifestBytes, { flag: 'wx' });
  const markerPath = path.join(directory, 'image-call.accepted.json');
  const logPath = path.join(directory, 'hook-events.jsonl');
  const scriptPath = path.join(directory, 'single-image-guard.mjs');
  const script = `import fs from 'node:fs';import{createHash}from'node:crypto';
const sha=v=>createHash('sha256').update(v).digest('hex');
const manifestPath=${JSON.stringify(manifestPath)}, markerPath=${JSON.stringify(markerPath)}, logPath=${JSON.stringify(logPath)};
function deny(reason,input){try{fs.appendFileSync(logPath,JSON.stringify({at:new Date().toISOString(),allowed:false,toolName:input?.tool_name??null,toolUseId:input?.tool_use_id??null,reason})+'\\n');}catch{}process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:reason}}));}
try{let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>1000000)throw new Error('hook input too large');}const input=JSON.parse(raw);
if(input.hook_event_name!=='PreToolUse'||input.tool_name!=='image_genimagegen')deny('本次只允许受控的单次内置image_gen.imagegen；其他工具均禁止。',input);
else{const bytes=fs.readFileSync(manifestPath);if(sha(bytes)!==${JSON.stringify(sha(manifestBytes))})throw new Error('trusted manifest changed');const manifest=JSON.parse(bytes);
for(const ref of manifest.references)if(sha(fs.readFileSync(ref.path))!==ref.sha256)throw new Error('reference image hash changed');
if(manifest.policy){const {Store}=await import(${JSON.stringify(pathToFileURL(path.join(import.meta.dirname,'store.mjs')).href)});const {ImageWorkspace}=await import(${JSON.stringify(pathToFileURL(path.join(import.meta.dirname,'image-store.mjs')).href)});const {creativeHash}=await import(${JSON.stringify(pathToFileURL(path.join(import.meta.dirname,'creative-store.mjs')).href)});const policy=manifest.policy;const current=new ImageWorkspace(new Store(policy.dataRoot)).assertExecutablePacket(policy.projectId,policy.packetId);if(creativeHash(current.packet.binding)!==policy.expectedBindingHash||creativeHash(current.packet.sourceSnapshot)!==policy.expectedInputSnapshotHash||current.packet.prompt!==manifest.prompt)throw new Error('current input, storyboard or reference approval changed before actual generation');const expected=current.references.map(ref=>ref.sha256).sort(),actual=manifest.references.map(ref=>ref.sha256).sort();if(JSON.stringify(expected)!==JSON.stringify(actual))throw new Error('current attachment list does not match trusted runtime copies');}
try{fs.writeFileSync(markerPath,JSON.stringify({at:new Date().toISOString(),toolName:input.tool_name,toolUseId:input.tool_use_id,manifestHash:sha(bytes),references:manifest.references}),{flag:'wx'});}catch(error){if(error.code==='EEXIST'){deny('本次图像调用额度已使用，禁止再次调用、重试、细化或生成第二张。',input);process.exit(0);}throw error;}
const updatedInput={prompt:manifest.prompt,transparent_background:false,...(manifest.references.length?{referenced_image_paths:manifest.references.map(ref=>ref.path)}:{})};
fs.appendFileSync(logPath,JSON.stringify({at:new Date().toISOString(),allowed:true,toolName:input.tool_name,toolUseId:input.tool_use_id,manifestHash:sha(bytes),references:manifest.references})+'\\n');
process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow',updatedInput}}));}}
catch(error){deny('私有单图校验失败：'+error.message,null);}
`;
  fs.writeFileSync(scriptPath, script, { flag: 'wx' });
  const command = buildImageGuardCommand(scriptPath);
  return { directory, scriptPath, manifestPath, markerPath, logPath, scriptHash: sha(script), manifestHash: sha(manifestBytes), command,
    config: { hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command, timeout: 10, async: false, statusMessage: '核对单次图像调用与真实参考图' }] }] } } };
}

export function verifyImageGuard(guard) {
  return sha(fs.readFileSync(guard.scriptPath)) === guard.scriptHash && sha(fs.readFileSync(guard.manifestPath)) === guard.manifestHash;
}
