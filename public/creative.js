import { mountStudio, invalidateStudioWorkflow } from './studio-shell.js';

const $ = selector => document.querySelector(selector);
const app = $('#creative-app');
const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const copy = value => structuredClone(value);
const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚无记录';
const state = { projects: [], project: null, ws: null, catalog: null, tool: null, input: null, dirty: false, busy: false, selectedVersionId: null, selectedTaskId: null, selectedShotId: null, images: null, imageError: '', error: '', poll: null };
let requestedSection = new URLSearchParams(location.search).get('section');
const stage = () => new URLSearchParams(location.search).get('stage') === 'storyboard' ? 'storyboard' : 'script';
const projectHref = (file, extra = '') => `${file}?projectId=${encodeURIComponent(state.project.id)}${extra}`;
const statuses = { queued: '等待启动', running: '真实运行中', succeeded: '已收到真实终态', failed: '运行失败', interrupted: '运行中断', cancelled: '已取消' };
const kinds = { script: '剧本', storyboard: '分镜', review: '独立审阅' };
const criteria = { user_requirements: '用户指定内容', motivation: '人物动机', logic: '剧情逻辑', duration: '目标时长', continuity: '场景连续性', production: '制作难度' };
const fields = ['episodeId', 'instructions', 'shotCount', 'stylePresetId', 'manualRuleIds', 'locks', 'entities', 'shots', 'scriptDraft', 'storyboardDraft', 'selectedScriptTaskId'];
const base = () => `/api/projects/${encodeURIComponent(state.project.id)}/creative`;
const badge = (text, type = '') => `<span class="creative-badge ${esc(type)}">${esc(text)}</span>`;
const taskList = () => state.ws?.tasks || [];
const isStale = value => Boolean(value?.stale || value?.needsReview || value?.freshnessStatus === 'stale');
const selectedTask = () => taskList().find(task => task.id === state.selectedTaskId);
const selectedVersion = () => state.ws?.versions?.find(version => version.id === state.selectedVersionId);
const preset = () => (state.catalog?.presets || []).find(p => p.id === state.input?.stylePresetId);
const shotList = () => state.input?.shots || [];
function plain(value) { return typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value, null, 2); }
function showRequestedSection() {
  if (requestedSection !== 'entities') return;
  const editor = app.querySelector('[data-testid="creative-entities"]');
  if (!editor) return;
  requestedSection = null;
  for (let parent = editor.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
  editor.scrollIntoView({ block: 'center' });
  editor.focus({ preventScroll: true });
}
function provenanceMarkup(report) {
  if (!report?.entries?.length) return '';
  return '<details class="creative-expand" data-testid="entity-provenance"><summary>实体来源核验 · '+report.entries.length+' 项 / '+(report.pendingCount || 0)+' 项待确认</summary><p class="creative-note">原始 source 是来源声明。只有绑定输入证据的用户内容才显示已核实；待确认不会因采用或引用变成事实锁。</p>'+report.entries.map(row => '<section class="creative-criterion"><strong>'+esc(row.entityId)+'@'+esc(row.version)+' · '+esc(({user:'用户输入证据有效',ai:'AI补充',pending:'待人工确认'})[row.resolvedSource] || '待人工确认')+'</strong><p>原声明：'+esc(row.declaredSource)+'；'+esc(row.reason)+'</p>'+((row.evidence || []).map(proof=>'<p><code>'+esc(proof.path)+' ['+proof.start+','+proof.end+')</code> '+esc(proof.quote)+'</p>').join(''))+'</section>').join('')+'</details>';
}
function redacted(value) { return JSON.stringify(value, (key, val) => /token|cookie|authorization|device.?code|user.?code/i.test(key) ? '[已隐藏]' : val, 2).replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]').replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[已隐藏]'); }
async function api(url, data, method) {
  const response = await fetch(url, { method: method || (data === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(45000) });
  let value; try { value = await response.json(); } catch { throw new Error(`服务响应异常（${response.status}），请检查本机服务。`); }
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : value.error?.message || `请求失败（${response.status}）`);
  if (data !== undefined && state.project) invalidateStudioWorkflow(state.project.id);
  return value;
}
function toast(message, error = false) { const el = $('#toast'); el.textContent = message; el.className = `visible${error ? ' error' : ''}`; clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.className = ''; }, error ? 9000 : 4000); }
function failure(error) { state.error = error.message || String(error); renderError(); toast(state.error, true); }
function renderError() { const el = $('#creative-error'); if (el) el.innerHTML = state.error ? `<div class="creative-error" role="alert"><button data-action="dismiss-error" aria-label="关闭错误">×</button>${esc(state.error)}</div>` : ''; }
async function confirmAction(title, message, accept = '继续') {
  const dialog = $('#creative-confirm');
  dialog.innerHTML = `<div class="creative-dialog-content"><h2 id="creative-confirm-heading">${esc(title)}</h2><p>${esc(message)}</p><div class="creative-dialog-actions"><button class="secondary-button" data-confirm="cancel">返回编辑</button><button class="primary-button" data-confirm="accept" data-testid="creative-confirm-submit">${esc(accept)}</button></div></div>`;
  dialog.showModal();
  return new Promise(resolve => {
    const finish = value => { dialog.removeEventListener('click', click); dialog.removeEventListener('cancel', cancel); dialog.close(); resolve(value); };
    const click = event => { const action = event.target.closest('[data-confirm]')?.dataset.confirm; if (action) finish(action === 'accept'); };
    const cancel = event => { event.preventDefault(); finish(false); };
    dialog.addEventListener('click', click); dialog.addEventListener('cancel', cancel);
  });
}
async function canLeave() { return !state.dirty || await confirmAction('有尚未保存的人工修改', '切换项目或离开页面会丢弃本页未保存内容。已经保存的稿件、任务与原始结果始终保留。', '放弃未保存并离开'); }
function setWorkspace(ws, preserve = false) {
  const editingRevision = state.ws?.revision;
  state.conflict = preserve && editingRevision !== undefined && editingRevision !== ws.revision;
  state.ws = preserve && editingRevision !== undefined ? { ...ws, revision: editingRevision } : ws;
  state.project = ws.project || state.project;
  if (!preserve) {
    state.input = Object.fromEntries(fields.map(key => [key, copy(ws[key] ?? ({ manualRuleIds: [], locks: [], entities: [], shots: ws.effectiveShots || [], scriptDraft: '', storyboardDraft: '', instructions: '', shotCount: 3, episodeId: 'EP-01', selectedScriptTaskId: null }[key] ?? ''))]));
    state.input.selectedScriptTaskId = ws.selectedScriptTaskId ?? null;
    if (!state.input.shots.length && ws.effectiveShots?.length) state.input.shots = copy(ws.effectiveShots);
    state.dirty = false;
  }
  if (!state.selectedVersionId || !ws.versions?.some(v => v.id === state.selectedVersionId)) state.selectedVersionId = (stage() === 'script' ? ws.activeScriptId : ws.activeStoryboardId) || ws.activeStoryboardId || ws.activeScriptId || ws.versions?.at(-1)?.id || null;
  if (!state.selectedTaskId || !ws.tasks?.some(t => t.id === state.selectedTaskId)) state.selectedTaskId = ws.tasks?.findLast(t => t.kind === stage() && t.status === 'succeeded')?.id || ws.tasks?.findLast(t => t.kind !== 'review' && t.status === 'succeeded')?.id || null;
}
function render() {
  const board = stage() === 'storyboard';
  app.innerHTML = `<div class="layout"><main class="main"><header class="topbar"><div class="top-actions"><button class="secondary-button" data-action="refresh" data-testid="creative-refresh">刷新状态</button>${state.ws ? '<button class="secondary-button" data-action="save" data-testid="creative-save">保存当前修改</button>' : ''}</div></header><div class="content creative-c-content"><div class="page-heading"><div><h1>${board ? '确认分镜' : '创作剧本'}</h1><p>${board ? '检查每个镜头的画面与衔接，确认后开始制作图片。' : '补充创作要求，生成剧本候选，审阅后修改并保存。'}</p></div></div><div id="creative-error"></div>${state.ws && state.project ? workspace() : '<section class="panel creative-no-project"><h2>选择一个故事，开始创作</h2><p>在项目面板选择已有项目，或先新建故事。</p><a class="primary-button" href="/">新建故事</a></section>'}</div></main></div>`;
  const canContinueScript = Boolean(state.input?.scriptDraft?.trim() || state.ws?.activeScriptId || state.input?.selectedScriptTaskId);
  mountStudio(app, { step: board ? 'storyboard' : 'script', project: state.project, projects: state.projects,
    primary: !state.ws ? { label: '新建故事', href: '/' } : board ? { label: shotList().length ? '确认分镜并继续' : '生成分镜', selector: shotList().length ? '[data-action="confirm-board"]' : '[data-action="generate-storyboard"]' } : canContinueScript ? { label: '保存剧本并继续', selector: '[data-action="continue-script"]' } : { label: '生成剧本', selector: '[data-action="generate-script"]' },
    secondary: state.ws ? { label: board ? '保存分镜修改' : '保存当前修改', selector: '[data-testid="creative-save"]' } : undefined,
    nextText: board ? '下一步：制作分镜图片；只保存分镜，不启动出图。' : '下一步：确认分镜；生成前会说明账号用量并请你确认。' });
  renderError(); renderRuntime(); setBusy(state.busy);
}
function requirementsPanel() {
  const p = state.project;
  return `<section class="panel creative-requirements"><div class="panel-heading"><h2>创作要求</h2><span class="creative-save-state" data-dirty-state></span></div><div class="panel-body"><details class="creative-source"><summary>故事构思与创作说明</summary><p>${esc(p.idea || '尚未填写故事构思')}</p>${p.creativeBrief ? `<dl>${[['synopsis','故事梗概'],['background','背景'],['characters','人物关系'],['conflict','核心冲突'],['emotion','情绪发展'],['ending','结局']].map(([key,label]) => `<dt>${label}</dt><dd>${esc(p.creativeBrief[key])}</dd>`).join('')}</dl>` : ''}</details><div class="form-group"><label for="creative-instructions">希望保留的设定、情节和结局</label><textarea id="creative-instructions" data-input="instructions" data-testid="creative-instructions" maxlength="30000" placeholder="补充人物、核心冲突、结局，或写下需要保留的内容。">${esc(state.input.instructions)}</textarea></div><details class="creative-expand"><summary>锁定设定、角色与高级输入</summary><div class="form-row"><div class="form-group"><label for="creative-episode">分集ID</label><input id="creative-episode" data-input="episodeId" value="${esc(state.input.episodeId)}" maxlength="80"></div><div class="form-group"><label>镜头目标</label><input id="creative-shot-count" data-input="shotCount" data-testid="creative-shot-count" type="number" min="1" max="30" value="${esc(state.input.shotCount)}"></div></div><label for="creative-locks">用户锁定设定 · JSON</label><textarea id="creative-locks" data-json="locks" data-testid="creative-locks" spellcheck="false">${esc(JSON.stringify(state.input.locks, null, 2))}</textarea><p class="creative-note">锁定内容优先于风格；冲突会阻止采用。语义问题仍需独立审阅。</p><label>人物 / 场景 / 道具的稳定ID与版本</label><textarea data-json="entities" data-testid="creative-entities" spellcheck="false">${esc(JSON.stringify(state.input.entities, null, 2))}</textarea><details><summary>当前有效实体输入</summary><pre>${esc(JSON.stringify(state.ws.effectiveEntities || [], null, 2))}</pre></details></details></div><div class="form-footer"><button class="secondary-button" data-action="generate-script" data-testid="creative-generate-script">生成剧本</button><span class="creative-note">使用本机Codex账号用量，候选不会自动采用。</span></div></section>`;
}
function collaborationPanels() {
  const running = taskList().some(task => ['queued','running'].includes(task.status));
  return `<details class="creative-disclosure creative-candidates" ${running || taskList().some(task => task.kind !== 'review' && task.status === 'succeeded' && !state.ws.versions.some(version => version.taskId === task.id)) ? 'open' : ''}><summary>候选与任务 <span id="creative-task-count"></span></summary><div class="creative-task-list" id="creative-tasks"></div></details><details class="creative-disclosure"><summary>独立审阅与版本历史</summary><p class="creative-note">审阅问题单独保存；模型意见不是正式岗位PASS。</p><div class="creative-c-history">${versionsPanel()}<section class="panel"><div class="panel-heading"><h2>独立审阅报告</h2></div><div class="panel-body"><div id="creative-reviews" class="creative-review-list"></div></div></section></div></details><details class="creative-disclosure"><summary>来源核验与运行诊断</summary><div id="creative-provenance">${provenanceMarkup(state.ws.entityProvenance)}</div><div id="creative-statuses">${statusGrid()}</div></details>`;
}
function workspace() {
  const controls = '<button hidden data-action="continue-script" data-testid="creative-continue-script">保存剧本并继续</button><button hidden data-action="confirm-board" data-testid="creative-confirm-board">确认分镜并继续</button>';
  if (stage() === 'storyboard') return `<div id="creative-stale">${staleMarkup()}</div>${boardWorkspace()}<details class="creative-disclosure creative-fee-settings" data-testid="creative-fee-settings"><summary>费用与生成设置 <span>制作图片前另行确认</span></summary><p class="creative-note">当前只保存文字分镜。Codex文字使用现有账号用量，具体费用未返回；项目人民币预算${state.project.budgetCap == null ? '尚未设置' : `为${esc(state.project.budgetCap)}元`}。不把预算、积分余额或未知费用当作免费。</p>${stylePanel()}</details><details class="creative-disclosure" id="creative-full-shots"><summary>完整镜头参数 · 静态画面 / 动态摄影 / 后期声音</summary>${shotPanel()}</details><details class="creative-disclosure"><summary>剧本原稿与创作要求</summary><div class="creative-script-layout">${requirementsPanel()}${draftPanel()}</div></details>${collaborationPanels()}${controls}`;
  return `<div id="creative-stale">${staleMarkup()}</div><div class="creative-script-layout">${requirementsPanel()}${draftPanel()}</div><details class="creative-disclosure"><summary>导演与风格预设</summary>${stylePanel()}</details>${collaborationPanels()}<details class="creative-disclosure"><summary>结构化镜头与分镜设置</summary>${shotPanel()}</details>${controls}`;
}
function shotAsset(shotId) {
  const assets = state.images?.assets?.filter(asset => asset.role === 'shot' && asset.targetId === shotId) || [];
  return [...assets].reverse().find(currentSelectedImage) || assets.at(-1) || null;
}
function currentSelectedImage(asset) { return asset.selected && asset.state === 'selected' && asset.reviewCurrent && asset.review?.verdict === 'accepted' && !asset.stale && asset.fileStatus === 'intact'; }
function imageStatus(asset) {
  if (asset.stale || asset.fileStatus !== 'intact') return badge('历史图片 · 需复核', 'warn');
  if (asset.state === 'rejected' || asset.reviewCurrent && asset.review?.verdict === 'rejected') return badge('历史图片 · 人工检查不通过', 'warn');
  if (currentSelectedImage(asset)) return badge('已选图片');
  return badge(asset.reviewCurrent && asset.review?.verdict === 'accepted' ? '候选图片 · 已检查待选用' : '候选图片 · 待检查');
}
function boardWorkspace() {
  const shots = shotList();
  if (!shots.some(shot => shot.id === state.selectedShotId)) state.selectedShotId = shots[0]?.id ?? null;
  const index = Math.max(0, shots.findIndex(shot => shot.id === state.selectedShotId)), shot = shots[index], asset = shot ? shotAsset(shot.id) : null;
  const chosen = preset();
  const preview = asset?.url ? `<img src="${esc(asset.url)}" alt="${esc(shot.id)}实际导入图片"><figcaption id="creative-preview-caption">${esc(String(index + 1).padStart(2,'0'))}　${esc(shot.purpose || shot.id)} ${imageStatus(asset)}${asset.source?.kind === 'test' ? badge('TEST FIXTURE / NOT AI') : ''}</figcaption>` : `<div class="creative-preview-empty"><span aria-hidden="true">▧</span><strong>${state.imageError ? '画面读取失败' : '尚未制作画面'}</strong><p>${state.imageError ? `${esc(state.imageError)}。项目与原文件保留，可刷新后重试。` : shot ? `先确认${esc(shot.id)}的文字分镜，下一步再导入或制作图片。` : '先完成剧本，再生成分镜或手动添加镜头。'}</p></div>${shot ? `<figcaption id="creative-preview-caption">${esc(String(index + 1).padStart(2,'0'))}　${esc(shot.purpose || shot.id)}</figcaption>` : ''}`;
  return `<section class="creative-board-stage" data-testid="creative-board-stage"><div class="creative-board-grid"><figure class="creative-board-preview ${asset?.url ? 'has-image' : ''}" data-testid="creative-board-preview">${preview}</figure><section class="creative-board-editor" data-testid="creative-board-editor"><div class="creative-board-row"><label for="creative-preview-preset">风格</label><select id="creative-preview-preset" data-testid="creative-preview-preset">${(state.catalog?.presets || []).map(item => `<option value="${esc(item.id)}" ${item.id === chosen?.id ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></div>${shot ? `<div class="creative-board-row"><label for="board-moment">画面</label><textarea id="board-moment" data-shot-index="${index}" data-shot-field="moment" data-testid="creative-board-moment" placeholder="描述首帧画面。">${esc(shot.moment)}</textarea></div><div class="creative-board-row"><label for="board-motion">动作</label><textarea id="board-motion" data-shot-index="${index}" data-shot-field="camera.subjectMotion" data-testid="creative-board-motion" placeholder="描述人物动作和动态变化。">${esc(plain(shot.camera?.subjectMotion ?? shot.action))}</textarea></div><div class="creative-board-row"><label for="board-continuity">衔接</label><textarea id="board-continuity" data-shot-index="${index}" data-shot-field="continuityNote" data-testid="creative-board-continuity" placeholder="记录与下一镜头的关系，不改变上游故事。">${esc(shot.continuityNote || '')}</textarea></div><p class="creative-board-help">${esc(shot.id)} · 设计${esc(shot.durationSeconds)}秒。更多摄影、角色引用和后期声音可在下方展开。</p>` : '<div class="creative-empty">尚无镜头；可生成分镜候选或在完整参数区添加镜头。</div>'}</section></div><div class="creative-thumb-strip" data-testid="creative-shot-strip" aria-label="选择镜头">${shots.map((item, itemIndex) => { const image = shotAsset(item.id); return `<button class="creative-thumb ${item.id === state.selectedShotId ? 'selected' : ''}" data-choose-shot="${esc(item.id)}" data-testid="creative-shot-thumb" aria-pressed="${item.id === state.selectedShotId}">${image?.url ? `<img src="${esc(image.url)}" alt="${esc(item.id)}实际图片">` : `<span class="creative-thumb-empty">${esc(item.id)}<small>画面待制作</small></span>`}<strong>${esc(String(itemIndex + 1).padStart(2,'0'))}　${esc(item.purpose || item.id)}</strong></button>`; }).join('') || '<div class="creative-empty">尚无镜头，不显示示例生成结果。</div>'}</div><div class="creative-board-actions"><span data-testid="creative-board-duration">${shots.length}个镜头 · 设计时长${shots.reduce((sum,item) => sum + Number(item.durationSeconds || 0),0)} / ${esc(state.project.durationSeconds)}秒</span><button class="secondary-button" data-action="generate-storyboard" data-testid="creative-board-generate">生成分镜候选</button><button class="ghost-button" data-action="add-shot">添加镜头</button></div></section>`;
}
function statusGrid() {
  const codex = state.tool;
  const latest = taskList().at(-1);
  const done = taskList().filter(t => t.status === 'succeeded' && t.kind !== 'review').length;
  const toolLabel = codex ? ({ detected: '已检测到本机 Codex', needs_configuration: '待配置或登录', not_verified: '状态尚待核实' }[codex.status] || codex.status || '命令已检测') : '正在核对本机工具';
  return `<div class="creative-status-grid"><div class="creative-status"><span>工具与认证</span><strong>${esc(toolLabel)}</strong><small>每次执行以真实终态为准</small></div><div class="creative-status"><span>能力证据</span><strong>${done ? '本项目已收到文字结果' : '官方 CLI 文字接口'}</strong><small>未接图像和视频接口</small></div><div class="creative-status"><span>执行任务</span><strong>${esc(latest ? statuses[latest.status] || latest.status : '尚无任务')}</strong><small>${latest ? kinds[latest.kind] || latest.kind : '不模拟进度'}</small></div><div class="creative-status"><span>候选结果</span><strong>${done ? `${done} 份文字候选 · 待人工决定` : '尚无候选'}</strong><small>格式合格仍需语义审阅</small></div><div class="creative-status"><span>正式阶段</span><strong>未接入四岗位验证</strong><small>not_checked · 无正式 PASS</small></div><div class="creative-status"><span>媒体状态</span><strong>尚未生成</strong><small>文字设计不等于媒体已验收</small></div></div>`;
}
function staleMarkup() {
  const stale = taskList().some(isStale) || (state.ws?.versions || []).some(isStale) || state.ws?.upstreamStale;
  const conflict = state.conflict ? '<div class="warning-box">其他页面已保存更新。本页未保存人工稿继续保留；保存会校验编辑开始时的 revision，请先复制人工稿并重新载入最新内容后核对。</div>' : '';
  const error = conflict + (state.ws?.compileError ? `<div class="warning-box" data-testid="creative-compile-error">当前保存输入无法编译：${esc(state.ws.compileError)}。人工草稿保留，请修正字段或锁冲突。</div>` : '');
  return error + (stale ? '<div class="warning-box" data-testid="creative-stale">输入、镜头、风格或知识库已改变，部分旧候选 / 审阅需要复核。旧原文和人工稿仍保留；采用前服务端会重新读取当前存储并核对 Hash。</div>' : '');
}
function stylePanel() {
  const presets = state.catalog?.presets || [], directors = state.catalog?.directors || [], chosen = preset();
  const director = directors.find(d => d.id === chosen?.directorId);
  const rules = chosen?.manualDerivedRules || director?.manual_derived_rules || [];
  const ruleCount = directors.reduce((count, d) => count + (d.manual_derived_rules?.length || 0), 0) || 90;
  const sources = Array.isArray(state.catalog?.sources) ? state.catalog.sources : state.catalog?.sources?.styleSources || [];
  return `<section class="panel"><div class="panel-heading"><div><h2>导演与作品级预设 <span class="creative-count">${directors.length} 位导演 / ${presets.length} 个预设</span></h2><p>选具体电影语言，规则来源可追溯</p></div></div><div class="panel-body"><div class="form-row"><div class="form-group"><label for="creative-director">导演导航</label><select id="creative-director" data-testid="creative-director">${directors.map(d => `<option value="${esc(d.id)}" ${d.id === chosen?.directorId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div><div class="form-group"><label for="creative-preset">作品 / 技法预设</label><select id="creative-preset" data-testid="creative-preset">${directors.map(d => `<optgroup label="${esc(d.name)}">${presets.filter(p => p.directorId === d.id).map(p => `<option value="${esc(p.id)}" ${p.id === state.input.stylePresetId ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</optgroup>`).join('')}</select></div></div><div class="creative-preset-info" data-testid="creative-preset-info"><strong>${esc(chosen?.directorName)} · ${esc(chosen?.label)}</strong><p>适用范围：${esc((chosen?.referenceWorks || []).map(plain).join('、') || '按具体场景核对；作品规则不是导演通用公式')}。规则均为设计参考，尚无本项目媒体生成验证。</p>${chosen?.pitfalls?.length ? `<ul>${chosen.pitfalls.map(text => `<li>${esc(text)}</li>`).join('')}</ul>` : ''}<details class="creative-expand"><summary>查看本预设规则及来源</summary>${Object.entries(chosen?.rules || {}).map(([stage, rows]) => `<p><strong>${esc(({narrative:'叙事',still_image:'静态画面',motion:'动态摄影',editing:'后期与剪辑'})[stage] || stage)}</strong></p><ul>${rows.map(rule => `<li>${esc(rule.text)}<br><code>${esc(rule.id)} · ${esc((rule.source_ids || chosen.sourceIds || []).join(', '))}</code></li>`).join('')}</ul>`).join('')}${sources.filter(source => chosen?.sourceIds?.includes(source.id)).map(source => `<p>${/^https:\/\//.test(source.url || '') ? `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title || source.id)}</a>` : esc(source.title || source.id)}<br>${esc(source.supports || '')}</p>`).join('')}</details></div><details class="creative-expand"><summary>手册扩展 · 全库 ${ruleCount} 条 / 当前导演 ${rules.length} 条 / 已选 ${state.input.manualRuleIds.length} 条</summary><p class="creative-rule-summary">仅明确勾选的规则进入任务。案例限定规则默认关闭；显式选择后仍需检查场景是否适用。切换导演将清空不属于该导演的勾选。</p><div class="creative-rule-list">${rules.map(rule => `<label class="creative-rule ${rule.case_only ? 'case' : ''}"><input type="checkbox" data-manual-rule="${esc(rule.id)}" data-testid="creative-manual-rule" ${state.input.manualRuleIds.includes(rule.id) ? 'checked' : ''}><span>${esc(rule.text)}</span> ${rule.case_only ? badge('案例限定 · 默认关闭','warn') : ''}<small>${esc(rule.source?.document || '')} · ${esc((rule.source?.paragraph_ids || []).join(', '))}（段落索引，非页码）</small><code>${esc(rule.id)}</code> <span class="creative-rule-stage">${esc(rule.stage)}</span></label>`).join('')}</div></details></div></section>`;
}
function draftPanel() {
  const scriptSource = taskList().find(task => task.id === state.input.selectedScriptTaskId);
  const active = state.ws.versions.find(version => version.id === state.ws.activeScriptId);
  const current = scriptSource?.result?.body || active?.body || '';
  const showSaved = !state.input.scriptDraft.trim() && current;
  return `<section class="panel"><div class="panel-heading"><div><h2>${showSaved ? '当前剧本' : '人工编辑区'}</h2><p>候选原文与人工稿分别保留，保存产生新版本</p></div></div><div class="panel-body">${showSaved ? `<div class="creative-current-script"><p class="creative-note">${scriptSource ? '已选择的剧本候选' : '当前已保存版本'}${isStale(scriptSource || active) ? badge('需要复核','warn') : ''}</p><pre class="creative-current-body" data-testid="creative-current-script">${esc(current)}</pre><button class="secondary-button" data-action="load-current-script">载入人工编辑区修改</button></div><details class="creative-expand"><summary>人工编辑与版本保存</summary>` : ''}<div class="form-group"><label for="creative-script-draft">人工剧本稿</label><textarea class="creative-script-editor" id="creative-script-draft" data-input="scriptDraft" data-testid="creative-script-draft" maxlength="100000" placeholder="可直接写稿，或从任务候选复制后修改。">${esc(state.input.scriptDraft)}</textarea></div><div class="creative-toolbar"><button class="secondary-button" data-action="save-script-version" data-testid="creative-save-script-version">保存新版本并作为分镜来源</button><span class="creative-save-state" data-dirty-state></span></div>${showSaved ? '</details>' : ''}<p class="creative-note">保存人工剧本版本后，新人工版本将成为分镜来源；旧候选和历史稿保留。当前分镜来源：${scriptSource ? `${esc(date(scriptSource.createdAt))} 的 Codex 剧本候选` : state.ws.activeScriptId ? '已采用 / 已保存的剧本版本' : '尚未选择'}。成功剧本候选可直接用于分镜，无需冒充正式岗位通过。</p><details class="creative-expand"><summary>人工分镜文字稿</summary><textarea data-input="storyboardDraft" data-testid="creative-storyboard-draft" maxlength="100000" placeholder="人工分镜说明；结构化镜头在下方三栏编辑。">${esc(state.input.storyboardDraft)}</textarea><div class="creative-toolbar"><button class="secondary-button" data-action="save-storyboard-version" data-testid="creative-save-storyboard-version">保存人工分镜版本</button></div></details></div></section>`;
}
function shotField(index, field, label, value, { input = false, number = false } = {}) {
  return `<div class="form-group"><label for="shot-${index}-${field.replaceAll('.', '-')}">${esc(label)}</label>${input ? `<input id="shot-${index}-${field.replaceAll('.', '-')}" data-shot-index="${index}" data-shot-field="${esc(field)}" ${number ? 'type="number" min="0.1" step="0.1"' : ''} value="${esc(plain(value))}">` : `<textarea id="shot-${index}-${field.replaceAll('.', '-')}" data-shot-index="${index}" data-shot-field="${esc(field)}" maxlength="12000">${esc(plain(value))}</textarea>`}</div>`;
}
function shotPanel() {
  const shots = shotList(), total = shots.reduce((sum, shot) => sum + Number(shot.durationSeconds || 0), 0);
  return `<section class="panel creative-wide"><div class="panel-heading creative-heading"><div><h2>镜头设计 · 静态、动态与后期分开</h2><p>人物 / 场景 / 道具绑定稳定 ID 与版本；前期视频设计无对白、旁白和配乐</p></div><div class="creative-toolbar"><button class="secondary-button" data-action="export" data-testid="creative-export">导出任务包与提示词</button><button class="primary-button" data-action="generate-storyboard" data-testid="creative-generate-storyboard">Codex 创作分镜候选</button></div></div><div class="creative-shots-toolbar"><span class="creative-total" data-testid="creative-total-duration">${shots.length} 个镜头 · 设计时长 ${total} / ${esc(state.project.durationSeconds)} 秒</span><span class="creative-note">实际媒体时长尚未测量</span><button class="ghost-button small-button" data-action="add-shot">＋添加镜头</button></div><div id="creative-shot-list">${shots.length ? shots.map(shotCard).join('') : '<div class="panel-body creative-empty"><strong>等待镜头输入</strong>先完成剧本候选并选择为分镜来源，或添加镜头自行填写。不会用样例冒充生成。</div>'}</div></section>`;
}
function shotCard(shot, index) {
  const camera = shot.camera || {}, compiled = state.ws.compiled?.find(value => value.shotId === shot.id)?.design;
  const motions = (state.catalog?.motions || []).filter(m => ['camera_motion','camera_orientation','camera_trajectory_mode','compound_camera_lens'].includes(m.dimension));
  return `<article class="creative-shot" data-testid="creative-shot" data-shot-id="${esc(shot.id)}"><div class="creative-shot-title"><h3>${esc(shot.id)}</h3><input class="shot-duration" data-shot-index="${index}" data-shot-field="durationSeconds" type="number" min="0.1" step="0.1" value="${esc(shot.durationSeconds)}" aria-label="${esc(shot.id)}设计时长"><small>秒 · 设计值</small>${compiled ? badge(compiled.structuralStatus === 'valid_draft' ? '结构合格 · 语义待审' : '结构有阻断', compiled.structuralStatus === 'valid_draft' ? '' : 'warn') : ''}<button class="ghost-button small-button" data-remove-shot="${index}">移除本镜头</button></div>${shotField(index, 'purpose', '叙事目的', shot.purpose)}<div class="creative-shot-columns"><section class="creative-shot-column" data-testid="shot-static"><h4>01 · 静态画面 / 首帧</h4>${shotField(index,'moment','选定的单一叙事瞬间',shot.moment)}${shotField(index,'subject','人物主体与服装',shot.subject)}${shotField(index,'action','此刻可见动作状态',shot.action)}${shotField(index,'framing','景别',shot.framing,{input:true})}${shotField(index,'composition','构图与空间占位',shot.composition)}${shotField(index,'focus','静态焦点',shot.focus,{input:true})}<div class="form-row">${shotField(index,'weather','天气',shot.weather,{input:true})}${shotField(index,'timeOfDay','时间',shot.timeOfDay,{input:true})}</div>${shotField(index,'lighting.source','光源',shot.lighting?.source,{input:true})}${shotField(index,'lighting.direction','光线方向',shot.lighting?.direction,{input:true})}${shotField(index,'palette','色彩',shot.palette,{input:true})}</section><section class="creative-shot-column motion" data-testid="shot-motion"><h4>02 · 动态摄影 / 视频</h4><div class="form-group"><label for="motion-${index}">相机位移 / 朝向</label><select id="motion-${index}" data-shot-index="${index}" data-shot-field="camera.motionId">${motions.map(m => `<option value="${esc(m.id)}" ${m.id === camera.motionId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>${shotField(index,'camera.start','起幅',camera.start)}${shotField(index,'camera.path','路径（JSON 对象或文字）',camera.path)}${shotField(index,'camera.speed','速度与停稳',camera.speed,{input:true})}${shotField(index,'camera.end','落幅',camera.end)}${shotField(index,'camera.viewpoint','视点 · 同时影响首帧',camera.viewpoint,{input:true})}${shotField(index,'camera.stability','稳定性',camera.stability,{input:true})}${shotField(index,'camera.focalChange','变焦 / 焦距变化',camera.focalChange,{input:true})}${shotField(index,'camera.focusPlan','独立动态焦点计划',camera.focusPlan)}${shotField(index,'camera.subjectMotion','人物动作进程',camera.subjectMotion)}${shotField(index,'camera.environmentMotion','环境运动',camera.environmentMotion,{input:true})}</section><section class="creative-shot-column post" data-testid="shot-post"><h4>03 · 后期与声音</h4>${shotField(index,'postSound','后期对白、旁白、音效、音乐及剪切计划',shot.postSound)}<p class="creative-note">声音计划独立保存，不混入前期视频提示词。本轮不生成音频。</p>${shotField(index,'entityRefs','稳定实体引用 · JSON',shot.entityRefs || [])}<p class="creative-shot-reference">格式：[{"id":"CHAR-01","version":"v1"}]。没有实际附件时不宣称模型已读参考图。</p><details class="creative-expand"><summary>其他画面及复合摄影字段 · JSON</summary><textarea data-shot-extra="${index}" spellcheck="false">${esc(JSON.stringify(Object.fromEntries(Object.entries(shot).filter(([key]) => !['id','purpose','moment','subject','action','framing','composition','focus','weather','timeOfDay','lighting','palette','durationSeconds','camera','postSound','entityRefs','continuityNote'].includes(key))), null, 2))}</textarea><p class="creative-note">可补 foreground、midground、background、materials、avoid 等。复合运镜需在“完整镜头 JSON”中填 camera.phases 或 linkage。</p></details><details class="creative-expand"><summary>完整镜头 JSON</summary><textarea data-shot-json="${index}" spellcheck="false">${esc(JSON.stringify(shot, null, 2))}</textarea><button class="secondary-button small-button" data-apply-shot-json="${index}">将 JSON 载入编辑区</button></details></section></div>${compiled ? `<details class="creative-prompt"><summary>查看当前已保存输入编译的提示词 / 规则 / 发现</summary><p class="creative-note">未保存的编辑尚未进入以下编译结果。</p><strong>静态画面</strong><pre>${esc(compiled.imagePrompt)}</pre><strong>动态摄影</strong><pre>${esc(compiled.videoPrompt)}</pre><strong>后期 / 叙事上下文规则</strong><pre>${esc(JSON.stringify(compiled.contextRules, null, 2))}</pre>${compiled.findings?.length ? `<pre>${esc(JSON.stringify(compiled.findings, null, 2))}</pre>` : ''}</details>` : ''}</article>`;
}
function taskCards() {
  const jobs = taskList().filter(task => task.kind !== 'review');
  if (!jobs.length) return '<div class="creative-empty"><strong>尚无文字任务</strong>保存创作要求后，调用本机 Codex。真实调用失败会保留错误与原始事件，不生成预设正文。</div>';
  return [...jobs].reverse().map(task => `<article class="creative-task" data-testid="creative-task" data-task-id="${esc(task.id)}" data-task-status="${esc(task.status)}"><div class="creative-task-header"><h3>${esc(kinds[task.kind] || task.kind)}候选</h3>${badge(statuses[task.status] || task.status, task.status === 'failed' ? 'bad' : task.status === 'succeeded' ? 'good' : '')}</div>${isStale(task) ? '<p class="warning-box">旧输入 · 需要复核，不可直接采用</p>' : ''}<p>${esc(task.error || task.message || '候选与正式采用版本分开保存。')}</p><div class="creative-task-ids">任务 ${esc(task.id)}<br>独立会话 ${esc(task.threadId || task.thread_id || '尚未收到')}<br>输入 revision ${esc(task.sourceRevision ?? task.inputRevision ?? task.workspaceRevision ?? task.snapshot?.revision ?? '')} · ${esc(date(task.createdAt))}</div>${task.result ? `<details ${task.id === state.selectedTaskId ? 'open' : ''}><summary>查看原始候选正文</summary><pre>${esc(task.result.body || JSON.stringify(task.result, null, 2))}</pre></details>` : ''}${provenanceMarkup(task.entityProvenance)}<div class="creative-toolbar">${task.status === 'succeeded' && task.result ? `${task.kind === 'script' ? `<button class="secondary-button small-button" data-select-script="${esc(task.id)}" ${isStale(task) ? 'disabled' : ''}>选为分镜来源</button><button class="ghost-button small-button" data-copy-script="${esc(task.id)}">复制到人工剧本区</button>` : `<button class="ghost-button small-button" data-load-shots="${esc(task.id)}">载入候选镜头供修改</button>`}<button class="secondary-button small-button" data-review-task="${esc(task.id)}" ${isStale(task) || state.dirty ? 'disabled' : ''}>新会话独立审阅</button><button class="primary-button small-button" data-adopt-task="${esc(task.id)}" ${isStale(task) || state.dirty || state.ws.versions.some(version => version.taskId === task.id) ? 'disabled' : ''}>${state.ws.versions.some(version => version.taskId === task.id) ? '已人工采用' : '人工采用候选'}</button>` : ''}${['failed','interrupted','cancelled'].includes(task.status) ? `<button class="secondary-button small-button" data-retry-task="${esc(task.id)}" ${state.dirty ? 'disabled' : ''}>以当前输入明确重试</button>` : ''}${['queued','running'].includes(task.status) ? `<button class="ghost-button small-button" data-cancel-task="${esc(task.id)}">取消本地等待</button>` : ''}</div><details><summary>输入快照、真实事件与原始回执</summary><pre>${esc(redacted({ snapshot: task.snapshot || task.inputSnapshot, inputHashes: task.inputHashes, knowledgeHash: task.knowledgeHash, events: task.events, rawText: task.rawText, rawResultPath: task.rawResultPath, rawPath: task.rawPath, exitCode: task.exitCode }))}</pre></details></article>`).join('');
}
function versionsPanel() {
  const versions = state.ws.versions || [], version = selectedVersion(), candidate = selectedTask();
  return `<section class="panel"><div class="panel-heading"><div><h2>采用版本与历史</h2><p>每次人工保存或采用都新增不可变版本</p></div></div><div class="panel-body"><div class="creative-version-bar"><select data-testid="creative-version-select" id="creative-version-select" aria-label="查看历史版本"><option value="">选择已保存版本</option>${[...versions].reverse().map(v => `<option value="${esc(v.id)}" ${v.id === state.selectedVersionId ? 'selected' : ''}>${esc(kinds[v.kind] || v.kind)} · ${v.origin === 'manual' || v.origin === 'user' || v.source === 'manual' ? '人工稿' : '候选采用'} · ${date(v.createdAt)}${isStale(v) ? ' · 需复核' : ''}</option>`).join('')}</select>${version ? `<button class="secondary-button small-button" data-review-version="${esc(version.id)}" ${isStale(version) || state.dirty ? 'disabled' : ''}>独立审阅此版本</button>` : ''}</div>${version ? `<div class="creative-version-meta">${esc(version.id)} · ${esc(version.origin || version.source || '已保存')} ${isStale(version) ? badge('旧版本 · 需复核','warn') : ''}</div><pre class="creative-version-body">${esc(version.body || JSON.stringify(version.result || version, null, 2))}</pre>` : '<div class="creative-empty">尚无保存版本。人工保存与候选采用都会保留历史，不覆盖原稿。</div>'}<details class="creative-expand"><summary>人工稿与当前候选对照</summary><div class="creative-compare"><section><h4>当前人工剧本稿</h4><pre class="creative-version-body">${esc(state.input.scriptDraft || '尚无人工稿')}</pre></section><section><h4>查看中的候选</h4><pre class="creative-version-body">${esc(candidate?.result?.body || plain(candidate?.result) || '选择任务候选后查看')}</pre></section></div></details><details class="creative-expand"><summary>全部不可变版本记录（${versions.length}）</summary><div class="creative-history">${[...versions].reverse().map(v => `<button data-version-id="${esc(v.id)}"><span>${esc(kinds[v.kind] || v.kind)} · ${esc(v.origin || v.source || '已保存')} ${isStale(v) ? ' · 需复核' : ''}</span><small>${date(v.createdAt)}</small></button>`).join('')}</div></details></div></section>`;
}
function reviewCards() {
  const reviews = state.ws.reviews || taskList().filter(task => task.kind === 'review');
  if (!reviews.length) return '<div class="creative-empty"><strong>尚无独立审阅</strong>成功创作后可直接对候选发起新会话审阅，也可先保存人工版本。报告不会直接改写内容。</div>';
  return [...reviews].reverse().map(review => {
    const report = review.report || review.result?.report || review.result;
    const ready = review.status === 'succeeded' && report;
    return `<article class="creative-review" data-testid="creative-review" data-review-id="${esc(review.id)}" data-review-status="${esc(review.status)}"><div class="creative-review-top"><strong>${ready ? `模型审阅意见：${report.verdict === 'PASS' ? 'PASS' : 'REVISE'}` : statuses[review.status] || review.status}</strong>${isStale(review) ? badge('旧报告 · 需复核','warn') : badge('独立报告')}</div><p>${esc(review.error || report?.summary || review.message || '等待真实审阅结果')}</p>${ready ? `<div class="creative-review-criteria">${(report.criteria || []).map(item => `<section class="creative-criterion"><strong>${esc(criteria[item.id] || item.id)} · ${esc(item.verdict || item.status)}</strong><p>${esc(item.evidence || item.summary || '')}</p>${item.issues?.length ? `<p>${item.issues.map(esc).join('<br>')}</p>` : ''}</section>`).join('')}</div>${(report.issues || []).map(issue => `<div class="creative-review-issue"><strong>${esc(issue.id)} · ${esc(issue.severity)} · ${esc(issue.location || issue.shotId || '')}</strong><p>证据：${esc(issue.evidence || issue.description || '')}</p><p>建议：${esc(issue.suggestion || '')}</p></div>`).join('')}<p>文本时长估计：${report.estimatedDurationSeconds == null ? '未确定' : `${esc(report.estimatedDurationSeconds)} 秒`}；${esc(report.durationBasis || '')}。实际媒体未测量。</p>` : ''}<div class="creative-task-ids">独立会话 ${esc(review.threadId || review.thread_id || '尚未收到')}<br>目标 ${esc(review.targetTaskId || review.targetVersionId || review.references?.targetTaskId || review.references?.targetVersionId || '')} · ${date(review.createdAt)}</div><details class="creative-expand"><summary>真实审阅事件与报告原文</summary><pre>${esc(redacted({ events: review.events, result: review.result, report: review.report, rawText: review.rawText, exitCode: review.exitCode }))}</pre></details>${['failed','interrupted','cancelled'].includes(review.status) ? `<button class="secondary-button small-button" data-retry-task="${esc(review.id)}" ${state.dirty ? 'disabled' : ''}>以当前输入明确重试审阅</button>` : ''}${['queued','running'].includes(review.status) ? `<button class="ghost-button small-button" data-cancel-task="${esc(review.id)}">取消本地等待</button>` : ''}</article>`;
  }).join('');
}
function renderRuntime() {
  if (!state.ws) return;
  const provenance = $('#creative-provenance'); if (provenance) provenance.innerHTML = provenanceMarkup(state.ws.entityProvenance);
  const tasks = $('#creative-tasks'); if (tasks) tasks.innerHTML = taskCards();
  const count = $('#creative-task-count'); if (count) count.textContent = `${taskList().filter(t => t.kind !== 'review').length} 次`;
  const reviews = $('#creative-reviews'); if (reviews) reviews.innerHTML = reviewCards();
  const status = $('#creative-statuses'); if (status) status.innerHTML = statusGrid();
  const stale = $('#creative-stale'); if (stale) stale.innerHTML = staleMarkup();
}
function updateDirty() {
  for (const el of app.querySelectorAll('[data-dirty-state]')) { el.textContent = state.dirty ? '有未保存修改' : '已保存'; el.classList.toggle('dirty', state.dirty); }
  for (const el of app.querySelectorAll('[data-action="generate-script"],[data-action="generate-storyboard"],[data-action="export"]')) { el.disabled = state.busy || state.dirty; el.title = state.dirty ? '先保存当前编辑，再执行此操作' : ''; }
  for (const el of app.querySelectorAll('[data-adopt-task],[data-review-task],[data-review-version],[data-retry-task]')) if (state.dirty) el.disabled = true;
}
function setBusy(value) { state.busy = value; for (const el of app.querySelectorAll('button,input,textarea,select')) { if (value) { if (!el.disabled) el.dataset.busyDisabled = 'true'; el.disabled = true; } else if (el.dataset.busyDisabled) { el.disabled = false; delete el.dataset.busyDisabled; } } if (!value) updateDirty(); }
function markDirty() { state.dirty = true; updateDirty(); }
function collectJson() {
  for (const el of app.querySelectorAll('[data-json]')) { let value; try { value = JSON.parse(el.value); } catch { throw new Error(`${el.dataset.json === 'locks' ? '用户锁定设定' : '实体列表'}不是有效 JSON；原稿已保留，请修正后保存。`); } if (!Array.isArray(value)) throw new Error('锁定设定与实体列表都须为 JSON 数组。'); state.input[el.dataset.json] = value; }
  for (const el of app.querySelectorAll('[data-shot-extra]')) { let value; try { value = JSON.parse(el.value); } catch { throw new Error(`镜头 ${Number(el.dataset.shotExtra) + 1} 的其他字段不是有效 JSON。`); } if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('镜头其他字段须为 JSON 对象。'); Object.assign(state.input.shots[Number(el.dataset.shotExtra)], value); }
}
async function readImages(id) { try { state.images = await api(`/api/projects/${encodeURIComponent(id)}/images`); state.imageError = ''; } catch (error) { state.images = null; state.imageError = error.message; } }
async function refresh(preserve = true) { const ws = await api(base()); setWorkspace(ws, preserve && state.dirty); await readImages(state.project.id); render(); schedulePoll(); }
async function save() {
  collectJson();
  const ws = await api(base(), { revision: state.ws.revision, ...copy(state.input) }, 'PUT');
  setWorkspace(ws); state.error = ''; render(); toast('工作台与人工草稿已保存');
}
async function loadProject(id, bypass = false) {
  if (!bypass && !await canLeave()) return;
  if (state.busy) return;
  clearTimeout(state.poll); setBusy(true);
  try { const [project, ws] = await Promise.all([api(`/api/projects/${encodeURIComponent(id)}`), api(`/api/projects/${encodeURIComponent(id)}/creative`)]); state.project = project; state.selectedTaskId = null; state.selectedVersionId = null; state.selectedShotId = null; setWorkspace(ws); await readImages(id); state.error = ''; localStorage.setItem('ai-drama-studio:last-project', id); history.replaceState(null, '', `/creative.html?projectId=${encodeURIComponent(id)}&stage=${stage()}`); render(); schedulePoll(); } catch (error) { failure(error); } finally { setBusy(false); showRequestedSection(); }
}
function schedulePoll() {
  clearTimeout(state.poll);
  if (!state.project || !taskList().some(task => ['queued','running'].includes(task.status))) return;
  state.poll = setTimeout(async () => {
    if (state.busy) { schedulePoll(); return; }
    try {
      const before = taskList().map(t => `${t.id}:${t.status}`).join('|');
      const ws = await api(base()); setWorkspace(ws, state.dirty);
      const after = taskList().map(t => `${t.id}:${t.status}`).join('|');
      if (before !== after && !state.dirty) render(); else renderRuntime();
      updateDirty();
    } catch (error) { failure(error); }
    schedulePoll();
  }, 2200);
}
async function start(kind, extra = {}) {
  if (state.dirty) throw new Error('请先保存人工修改，再创建任务；未保存内容不会被覆盖。');
  const accepted = await confirmAction(`${extra.retry ? '明确重新尝试 · ' : ''}${kind === 'review' ? '发起新会话独立审阅' : `调用 Codex 创作${kinds[kind]}候选`}`, `${extra.retry ? '这是新的执行尝试，会再次使用账号用量；原任务与原始结果保留。' : ''}将发送当前项目文字、锁定设定与相关镜头资料给本机已登录的 Codex，使用现有账号用量。任务只生成文字，不提交任何图片、视频、配音或即梦画布请求。`, kind === 'review' ? '开始独立审阅' : '开始文字创作');
  if (!accepted) return;
  const result = await api(`${base()}/tasks`, { revision: state.ws.revision, projectRevision: state.project.revision, kind, ...extra });
  state.selectedTaskId = result.id || result.task?.id || state.selectedTaskId;
  await refresh(); toast('任务已保存并开始执行，可查看真实状态与事件');
}
async function saveVersion(kind) {
  collectJson(); if (state.dirty) await save();
  const body = kind === 'script' ? state.input.scriptDraft : state.input.storyboardDraft;
  if (!body.trim()) throw new Error(`请先填写人工${kinds[kind]}稿。`);
  await api(`${base()}/versions`, { revision: state.ws.revision, kind, body }); await refresh(false); state.selectedVersionId = kind === 'script' ? state.ws.activeScriptId : state.ws.activeStoryboardId; render(); toast(`人工${kinds[kind]}已保存为新版本，历史稿保留`);
}
async function continueScript() {
  collectJson();
  const current = state.ws.versions.find(version => version.id === state.ws.activeScriptId && version.kind === 'script');
  const unchanged = !state.dirty && current && !isStale(current) && current.body === state.input.scriptDraft;
  if (state.input.scriptDraft.trim() && !unchanged) await saveVersion('script');
  else { if (!state.input.selectedScriptTaskId && !state.ws.activeScriptId) throw new Error('请先生成并选择剧本候选，或保存人工剧本。'); if (state.dirty) await save(); }
  location.href = projectHref('/creative.html', '&stage=storyboard');
}
async function confirmBoard() {
  collectJson();
  if (!shotList().length) throw new Error('尚无分镜，请先生成分镜候选或手动添加镜头。');
  const current = state.ws.versions.find(version => version.id === state.ws.activeStoryboardId && version.kind === 'storyboard');
  if (!state.dirty && current && !isStale(current) && (!state.input.storyboardDraft.trim() || current.body === state.input.storyboardDraft)) { location.href = projectHref('/images.html'); return; }
  if (!state.input.storyboardDraft.trim()) { state.input.storyboardDraft = '【人工确认的分镜文字】\n' + shotList().map(shot => `${shot.id} · ${shot.durationSeconds}秒\n画面：${shot.moment || ''}\n动作：${plain(shot.camera?.subjectMotion ?? shot.action)}\n衔接：${shot.continuityNote || '未补充'}\n后期声音：${shot.postSound || '未补充'}`).join('\n\n'); markDirty(); }
  await saveVersion('storyboard');
  location.href = projectHref('/images.html');
}
function download(value, filename) { const blob = new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: typeof value === 'string' ? 'text/plain;charset=utf-8' : 'application/json;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function newShot(index) { return { id: `SHOT-${String(index).padStart(2,'0')}`, purpose: '', moment: '', subject: '', action: '', framing: '', composition: '', durationSeconds: 10, camera: { motionId: 'CAM_FIXED', path: { mode: 'none' }, start: '', end: '', speed: '固定', viewpoint: '平视', stability: '锁定机位', focalChange: '固定焦距', focusPlan: '', subjectMotion: '', environmentMotion: '' }, postSound: '', entityRefs: [] }; }
function setPath(object, field, value) { const keys = field.split('.'); let current = object; for (const key of keys.slice(0,-1)) current = current[key] ||= {}; current[keys.at(-1)] = value; }
app.addEventListener('input', event => {
  const el = event.target;
  if (!state.input) return;
  if (el.dataset.input) { state.input[el.dataset.input] = el.dataset.input === 'shotCount' ? Number(el.value) : el.value; markDirty(); }
  else if (el.dataset.json || el.dataset.shotExtra !== undefined) markDirty();
  else if (el.dataset.shotField) {
    let value = el.value;
    if (el.dataset.shotField === 'durationSeconds') value = Number(value);
    else if (['camera.path','camera.focusPlan','entityRefs'].includes(el.dataset.shotField) && /^[\[{]/.test(value.trim())) { try { value = JSON.parse(value); } catch {} }
    setPath(state.input.shots[Number(el.dataset.shotIndex)], el.dataset.shotField, value); markDirty();
    const total = $('#creative-total-duration'); if (total) total.textContent = `${shotList().length} 个镜头 · 设计时长 ${shotList().reduce((sum,s) => sum + Number(s.durationSeconds || 0),0)} / ${state.project.durationSeconds} 秒`;
  }
});
app.addEventListener('change', event => {
  const el = event.target;
  try {
  if (el.id === 'creative-director') { const chosen = state.catalog.presets.find(p => p.directorId === el.value); if (chosen) { collectJson(); state.input.stylePresetId = chosen.id; state.input.manualRuleIds = []; markDirty(); render(); } }
  else if (el.id === 'creative-preset' || el.id === 'creative-preview-preset') { collectJson(); const old = preset()?.directorId; state.input.stylePresetId = el.value; if (old !== preset()?.directorId) state.input.manualRuleIds = []; markDirty(); render(); }
  else if (el.dataset.manualRule) { const ids = new Set(state.input.manualRuleIds); if (el.checked) ids.add(el.dataset.manualRule); else ids.delete(el.dataset.manualRule); state.input.manualRuleIds = [...ids]; markDirty(); }
  else if (el.id === 'creative-version-select') { collectJson(); state.selectedVersionId = el.value || null; render(); }
  } catch (error) { failure(error); }
});
app.addEventListener('click', async event => {
  const button = event.target.closest('button,a'); if (!button) return;
  if (button.matches('[data-leave]')) { event.preventDefault(); if (await canLeave()) location.href = button.href; return; }
  if (state.busy) return;
  if (button.dataset.projectId) { await loadProject(button.dataset.projectId); return; }
  if (button.dataset.chooseShot) { try { collectJson(); state.selectedShotId = button.dataset.chooseShot; render(); } catch (error) { failure(error); } return; }
  if (button.dataset.versionId) { try { collectJson(); state.selectedVersionId = button.dataset.versionId; render(); } catch (error) { failure(error); } return; }
  if (button.dataset.action === 'dismiss-error') { state.error = ''; renderError(); return; }
  setBusy(true);
  try {
    if (button.dataset.action === 'save') await save();
    else if (button.dataset.action === 'continue-script') await continueScript();
    else if (button.dataset.action === 'confirm-board') await confirmBoard();
    else if (button.dataset.action === 'load-current-script') { collectJson(); const current = taskList().find(task => task.id === state.input.selectedScriptTaskId)?.result?.body || state.ws.versions.find(version => version.id === state.ws.activeScriptId)?.body; if (!current) throw new Error('当前没有可载入的已保存剧本。'); state.input.scriptDraft = current; markDirty(); render(); }
    else if (button.dataset.action === 'refresh') await refresh();
    else if (button.dataset.action === 'generate-script') await start('script');
    else if (button.dataset.action === 'generate-storyboard') await start('storyboard', { ...(state.input.selectedScriptTaskId ? { scriptTaskId: state.input.selectedScriptTaskId } : {}) });
    else if (button.dataset.action === 'save-script-version') await saveVersion('script');
    else if (button.dataset.action === 'save-storyboard-version') await saveVersion('storyboard');
    else if (button.dataset.action === 'export') { const result = await api(`${base()}/export`); download(result, `AI-Drama-Studio-${state.project.id}-文字分镜任务包.json`); toast('已导出文字任务包；未提交媒体请求'); }
    else if (button.dataset.action === 'add-shot') { collectJson(); const ids = new Set(shotList().map(s => s.id)); let index = shotList().length + 1; while (ids.has(`SHOT-${String(index).padStart(2,'0')}`)) index++; state.input.shots.push(newShot(index)); markDirty(); render(); }
    else if (button.dataset.removeShot !== undefined) { collectJson(); if (await confirmAction('移除此镜头？', '只修改当前编辑区；已保存的任务、候选和历史版本仍会保留。', '从编辑区移除')) { state.input.shots.splice(Number(button.dataset.removeShot),1); markDirty(); render(); } }
    else if (button.dataset.applyShotJson !== undefined) { const index = Number(button.dataset.applyShotJson); const value = JSON.parse($(`[data-shot-json="${index}"]`).value); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('完整镜头须为 JSON 对象。'); state.input.shots[index] = value; markDirty(); render(); }
    else if (button.dataset.selectScript) { if (state.dirty) throw new Error('请先保存人工修改，再切换分镜来源。'); state.input.selectedScriptTaskId = button.dataset.selectScript; const ws = await api(base(), { revision: state.ws.revision, selectedScriptTaskId: button.dataset.selectScript }, 'PUT'); setWorkspace(ws); state.selectedTaskId = button.dataset.selectScript; render(); toast('已选为分镜来源；镜头输入由此剧本候选整理'); }
    else if (button.dataset.copyScript) { collectJson(); if (state.input.scriptDraft.trim() && !await confirmAction('将候选复制到人工剧本区？', '当前编辑区已有人工文字。继续会替换尚未另存的编辑内容；已保存历史不变。', '复制候选')) return; const task = taskList().find(t => t.id === button.dataset.copyScript); state.input.scriptDraft = task.result.body; state.selectedTaskId = task.id; markDirty(); render(); }
    else if (button.dataset.loadShots) { collectJson(); if (shotList().length && !await confirmAction('载入分镜候选供人工修改？', '将替换当前镜头编辑区。先保存的人工稿与原始候选仍保留；保存这些新输入后，旧候选和审阅可能变为需复核。', '载入候选镜头')) return; const task = taskList().find(t => t.id === button.dataset.loadShots); state.input.shots = copy(task.result.shots); state.input.storyboardDraft = task.result.notes || state.input.storyboardDraft; state.selectedTaskId = task.id; markDirty(); render(); }
    else if (button.dataset.reviewTask) await start('review', { targetTaskId: button.dataset.reviewTask });
    else if (button.dataset.reviewVersion) await start('review', { targetVersionId: button.dataset.reviewVersion });
    else if (button.dataset.adoptTask) { if (state.dirty) throw new Error('请先保存当前人工修改，再采用候选。'); const task=taskList().find(item=>item.id===button.dataset.adoptTask); const pending=task?.kind==='script' ? task.entityProvenance?.pendingCount : state.ws.entityProvenance?.pendingCount; const message='采用前会从当前存储重新核对输入、镜头、风格、知识与实体来源。追加不可变版本，保留人工稿；不表示正式岗位或媒体验收通过。'+(pending ? '\n本候选含来源待确认的实体。继续仅保存待确认候选，来源仍待确认，不提升为用户指定事实或事实锁。' : ''); if (!await confirmAction('人工采用候选为新版本？', message, pending ? '确认保存待确认候选' : '校验并采用')) return; await api(`${base()}/adopt`, { revision: state.ws.revision, projectRevision: state.project.revision, taskId: button.dataset.adoptTask, confirmPendingSources: Boolean(pending) }); await refresh(false); toast('已采用为新版本，人工稿、来源状态与历史保留'); }
    else if (button.dataset.retryTask) { const task = taskList().find(t => t.id === button.dataset.retryTask); if (!task) throw new Error('原任务不存在，请刷新。'); await start(task.kind, { ...copy(task.references || {}), retry: true }); }
    else if (button.dataset.cancelTask) { await api(`/api/creative-tasks/${encodeURIComponent(button.dataset.cancelTask)}/cancel`, {}); await refresh(); }
  } catch (error) { failure(error); } finally { setBusy(false); schedulePoll(); }
});
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
async function boot() {
  try {
    const [projects, catalog] = await Promise.all([api('/api/projects'), api('/api/creative/knowledge')]); state.projects = projects.projects || []; state.catalog = catalog;
    const requested = new URLSearchParams(location.search).get('projectId') || localStorage.getItem('ai-drama-studio:last-project');
    const project = state.projects.find(p => p.id === requested) || state.projects[0];
    render(); if (project) await loadProject(project.id, true);
    api('/api/tools').then(report => { state.tool = report.tools?.find(t => t.id === 'codex') || null; renderRuntime(); }).catch(error => { state.tool = { status: 'not_verified', error: error.message }; renderRuntime(); });
  } catch (error) { render(); failure(error); }
}
boot();
