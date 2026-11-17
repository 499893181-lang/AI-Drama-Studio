import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { AppError } from './store.mjs';

/** CurrentUser DPAPI. Plaintext is sent through stdin, never argv or logs. */
export class CredentialVault {
  constructor(root, { crypt } = {}) { this.root = path.resolve(root); this.crypt = crypt ?? dpapi; fs.mkdirSync(this.root,{recursive:true}); }
  file(ref) { if (!/^[a-f0-9-]{36}$/.test(ref ?? '')) throw new AppError('无效的凭据引用。'); return path.join(this.root,`${ref}.dpapi`); }
  async put(secret, priorRef = null) { if (typeof secret !== 'string' || !secret.trim() || secret.length > 64000) throw new AppError('请输入有效密钥。'); const ref = priorRef ?? randomUUID(); const encrypted = await this.crypt('protect',secret); fs.writeFileSync(this.file(ref), encrypted, {mode:0o600}); return ref; }
  async get(ref) { try { return await this.crypt('unprotect',fs.readFileSync(this.file(ref),'utf8')); } catch { throw new AppError('当前 Windows 用户无法解密凭据，请在服务配置重新保存密钥。',409); } }
  has(ref) { try { return fs.existsSync(this.file(ref)); } catch { return false; } }
}
function dpapi(action, text) {
  if (process.platform !== 'win32') throw new AppError('凭据保险库需要 Windows CurrentUser DPAPI；没有启用明文回退。',409);
  const operation = action === 'protect' ? '[Security.Cryptography.ProtectedData]::Protect($raw,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)' : '[Security.Cryptography.ProtectedData]::Unprotect($raw,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)';
  const script = `Add-Type -AssemblyName System.Security; $inputValue=[Console]::In.ReadToEnd(); $raw=[Convert]::FromBase64String($inputValue); $result=${operation}; [Console]::Out.Write([Convert]::ToBase64String($result))`;
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';const timer=setTimeout(()=>{child.kill();reject(new AppError('DPAPI 操作超时。',500));},15000);
    child.stdout.on('data',chunk=>out+=chunk.toString());child.stderr.resume();child.once('error',()=>{clearTimeout(timer);reject(new AppError('无法启动 Windows DPAPI。',500));});child.once('close',code=>{clearTimeout(timer);if(code!==0)return reject(new AppError('Windows DPAPI 操作失败，未保存明文。',500));resolve(action==='protect'?out:Buffer.from(out,'base64').toString('utf8'));});
    child.stdin.end(action==='protect'?Buffer.from(text,'utf8').toString('base64'):text);
  });
}
