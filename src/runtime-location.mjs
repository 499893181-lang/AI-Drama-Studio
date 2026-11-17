import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const file=repo=>path.join(repo,'.local','studio-runtime.json');
function saved(repo){if(!fs.existsSync(file(repo)))return null;try{const value=JSON.parse(fs.readFileSync(file(repo),'utf8'));if(typeof value.governanceRoot!=='string'||!path.isAbsolute(value.governanceRoot))throw new Error();return value.governanceRoot;}catch{throw new Error('本机治理目录记录损坏。停止启动，避免另建账本或丢失旧项目入口；请恢复 .local/studio-runtime.json。');}}
const canonical=value=>{const absolute=path.resolve(value);return(fs.existsSync(absolute)?fs.realpathSync.native(absolute):absolute).toLowerCase();};
export function runtimeRoot(repo,environment=process.env){const previous=saved(repo),requested=environment.DATA_DIR;if(previous&&!fs.existsSync(previous))throw new Error('原治理目录不存在，停止启动；不会新建空账本或重置原调用计数，请恢复原目录。');if(previous&&requested&&canonical(previous)!==canonical(requested))throw new Error('此工程已绑定原治理目录。不能通过 DATA_DIR 切换重建任务/调用账本；新项目位置请在软件的“存储位置”设置。');return path.resolve(requested??previous??path.join(repo,'data'));}
export function rememberRuntimeRoot(repo,root){const previous=saved(repo);if(previous&&canonical(previous)!==canonical(root))throw new Error('原治理目录绑定不可被静默替换。');const target=file(repo);fs.mkdirSync(path.dirname(target),{recursive:true});if(previous)return;const temp=target+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify({schemaVersion:1,governanceRoot:path.resolve(root)},null,2),{flag:'wx'});fs.renameSync(temp,target);}
