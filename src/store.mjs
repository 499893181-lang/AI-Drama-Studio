import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const now = () => new Date().toISOString();
export const validId = id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(id);
export const briefKeys = ['synopsis', 'background', 'characters', 'conflict', 'emotion', 'ending'];
export function validateBrief(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw new AppError('创作说明格式不正确。');
  const out = {};
  for (const key of briefKeys) {
    if (typeof value[key] !== 'string' || value[key].length > 30000) throw new AppError(`创作说明字段 ${key} 不正确。`);
    out[key] = value[key];
  }
  for (const key of ['preservedContent', 'addedSettings']) {
    if (!Array.isArray(value[key]) || value[key].length > 100 || value[key].some(v => typeof v !== 'string' || v.length > 5000)) throw new AppError(`创作说明字段 ${key} 不正确。`);
    out[key] = [...value[key]];
  }
  return out;
}
function fields(input, previous = {}) {
  const text = (key, max, fallback = '') => {
    const value = input[key] ?? previous[key] ?? fallback;
    if (typeof value !== 'string' || value.length > max) throw new AppError(`${key} 内容过长或格式不正确。`);
    return value.trim();
  };
  const name = text('name', 120);
  if (!name) throw new AppError('请填写项目名称。');
  const durationSeconds = input.durationSeconds ?? previous.durationSeconds ?? 30;
  if (!Number.isInteger(durationSeconds) || durationSeconds < 5 || durationSeconds > 7200) throw new AppError('目标时长须为 5–7200 秒的整数。');
  const aspectRatio = input.aspectRatio ?? previous.aspectRatio ?? '9:16';
  if (!['9:16', '16:9'].includes(aspectRatio)) throw new AppError('请选择横屏或竖屏。');
  const budgetCap = Object.hasOwn(input, 'budgetCap') ? input.budgetCap : previous.budgetCap ?? null;
  if (budgetCap !== null && (typeof budgetCap !== 'number' || !Number.isFinite(budgetCap) || budgetCap < 0 || budgetCap > 100000000)) throw new AppError('预算上限须为 0–100000000 的金额，或留空。');
  const creativeBrief = Object.hasOwn(input, 'creativeBrief') ? validateBrief(input.creativeBrief) : previous.creativeBrief ?? null;
  return { name, idea: text('idea', 20000), durationSeconds, aspectRatio, style: text('style', 5000), budgetCap, creativeBrief };
}
export function generationInput(project) {
  return { name: project.name, idea: project.idea, durationSeconds: project.durationSeconds, aspectRatio: project.aspectRatio, style: project.style, budgetCap: project.budgetCap, budgetCurrency: 'CNY', references: project.references.map(({name, mimeType, size}) => ({name, mimeType, size})) };
}
export const inputHash = project => createHash('sha256').update(JSON.stringify(generationInput(project))).digest('hex');

export class Store {
  constructor(root) {
    this.root = path.resolve(root);
    this.governanceRoot = this.root;
    for (const part of ['projects', 'jobs', 'references', 'runtime']) fs.mkdirSync(path.join(this.root, part), { recursive: true });
  }
  file(kind, id) {
    if (!validId(id)) throw new AppError('无效的标识。', 400);
    if (!/^[a-z][a-z0-9-]*$/.test(kind)) throw new AppError('无效的数据类型。');
    return path.join(this.projectRoot(kind,id), kind, `${id}.json`);
  }
  // Governance, task ledgers and signing keys NEVER follow the project default.
  // Only new project production records/assets are indexed to a chosen folder.
  projectRoot(kind,id) {
    const scoped = kind==='projects'||kind==='references'||kind==='scripts'||kind.endsWith('-workspaces')||['image-files','video-files','voice-files','studio-production'].includes(kind);
    if(!scoped)return this.root;
    const index=path.join(this.root,'project-locations.json');
    if(!fs.existsSync(index))return this.root;
    let value;try{value=JSON.parse(fs.readFileSync(index,'utf8'));}catch{throw new AppError('项目位置索引损坏，停止写入以保留历史目录。',500);}
    return value.locations?.[id]?.root??this.root;
  }
  directory(kind,id) { if(!validId(id)||!/^[a-z][a-z0-9-]*$/.test(kind))throw new AppError('无效的素材位置。');return path.join(this.projectRoot(kind,id),kind,id); }
  write(kind, value) {
    const file = this.file(kind, value.id);
    const temp = `${file}.${randomUUID()}.tmp`;
    fs.mkdirSync(path.dirname(file),{recursive:true});
    let fd;
    try {
      fd = fs.openSync(temp, 'wx');
      fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n', 'utf8');
      fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
      fs.renameSync(temp, file);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
    return value;
  }
  read(kind, id) {
    const file = this.file(kind, id);
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (value.id !== id || (kind === 'projects' && (!Number.isInteger(value.revision) || !Array.isArray(value.references)))) throw new Error('结构不完整');
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') throw new AppError('项目或任务不存在。', 404);
      throw new AppError(`数据文件 ${path.basename(file)} 损坏，已保留原件；请检查 .bak 备份。`, 500);
    }
  }
  list(kind) {
    const values = [], warnings = [];
    const names=new Set(fs.readdirSync(path.join(this.root, kind)).filter(name => name.endsWith('.json')));
    if(kind==='projects'){
      const index=path.join(this.root,'project-locations.json');
      if(fs.existsSync(index)){let value;try{value=JSON.parse(fs.readFileSync(index,'utf8'));}catch{throw new AppError('项目位置索引损坏，停止枚举。',500);}for(const id of Object.keys(value.locations??{}))names.add(`${id}.json`);}
    }
    for (const name of names) {
      try { values.push(this.read(kind, name.slice(0, -5))); }
      catch (error) { warnings.push(error.message); }
    }
    values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { values, warnings };
  }
  create(input) {
    const timestamp = now();
    const value={ id: randomUUID(), ...fields(input), references: [], revision: 1, createdAt: timestamp, updatedAt: timestamp, latestJobId: null, briefProvenance: null };
    const preferences=path.join(this.root,'studio-settings','preferences.json');
    if(fs.existsSync(preferences)){
      const directory=JSON.parse(fs.readFileSync(preferences,'utf8')).defaultProjectDirectory;
      if(directory){const index=path.join(this.root,'project-locations.json');const locations=fs.existsSync(index)?JSON.parse(fs.readFileSync(index,'utf8')):{schemaVersion:1,governanceRoot:this.root,locations:{}};const root=path.join(directory,`AI-Drama-${value.id}`);fs.mkdirSync(root,{recursive:true});locations.locations[value.id]={root,createdAt:timestamp};const tmp=`${index}.${randomUUID()}.tmp`;fs.writeFileSync(tmp,JSON.stringify(locations,null,2),{flag:'wx'});if(fs.existsSync(index))fs.copyFileSync(index,index+'.bak');fs.renameSync(tmp,index);}
    }
    return this.write('projects',value);
  }
  update(id, input) {
    const previous = this.read('projects', id);
    if (input.revision !== previous.revision) throw new AppError('项目已在其他窗口更新。请刷新后核对，当前编辑内容尚未覆盖磁盘。', 409);
    const next = { ...previous, ...fields(input, previous), revision: previous.revision + 1, updatedAt: now() };
    if (JSON.stringify(next.creativeBrief) !== JSON.stringify(previous.creativeBrief)) next.briefProvenance = { ...previous.briefProvenance, userEditedAt: now() };
    return this.write('projects', next);
  }
  markJob(projectId, jobId) {
    const project = this.read('projects', projectId);
    return this.write('projects', { ...project, latestJobId: jobId });
  }
  apply(job, revision) {
    const project = this.read('projects', job.projectId);
    if (job.status !== 'succeeded' || !job.result) throw new AppError('任务尚未成功，不能采用。', 409);
    if (job.appliedAt) throw new AppError('这个候选已经采用过。', 409);
    if (inputHash(project) !== job.inputHash) throw new AppError('构思或项目设置已改变，请基于当前内容重新扩写。旧候选保留供参考。', 409);
    if (revision !== project.revision) throw new AppError('项目已在其他窗口更新。请刷新后核对，当前编辑内容尚未覆盖磁盘。', 409);
    const updated = {
      ...project,
      ...fields({ creativeBrief: job.result }, project),
      revision: project.revision + 1,
      updatedAt: now(),
      briefProvenance: { source: job.provider??'codex-cli', jobId: job.id, inputHash: job.inputHash, inputRevision: job.inputRevision, generatedAt: job.updatedAt, userEditedAt: null },
    };
    return this.write('projects', updated);
  }
  addReference(projectId, name, mimeType, bytes) {
    const project = this.read('projects', projectId);
    if (project.references.length >= 20) throw new AppError('每个项目最多保存 20 个参考素材。');
    const id = randomUUID();
    const safeName = name.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 180) || '参考素材';
    const storedName = `${id}.bin`;
    const dir = this.directory('references', projectId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, storedName), bytes, { flag: 'wx' });
    const reference = { id, name: safeName, mimeType: /^[\w.+-]+\/[\w.+-]+$/.test(mimeType) ? mimeType : 'application/octet-stream', size: bytes.length, storedName };
    return this.write('projects', { ...project, references: [...project.references, reference], revision: project.revision + 1, updatedAt: now() });
  }
  removeReference(projectId, referenceId) {
    const project = this.read('projects', projectId);
    const ref = project.references.find(ref => ref.id === referenceId);
    if (!ref) throw new AppError('参考素材不存在。', 404);
    // Retain the original binary for recovery; removing a link never deletes source media.
    return this.write('projects', { ...project, references: project.references.filter(ref => ref.id !== referenceId), revision: project.revision + 1, updatedAt: now() });
  }
}
