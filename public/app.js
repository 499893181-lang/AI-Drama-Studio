const icons = {
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4m-4 6h4m10-6h4m-4 6h4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings: '<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1"/><circle cx="12" cy="12" r="5"/>',
  edit: '<path d="m16 3 5 5-12 12H4v-5L16 3Zm-3 3 5 5M4 20h16"/>',
  sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v1"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.film}</svg>`;
const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sections = [['synopsis', '故事梗概'], ['background', '故事背景'], ['characters', '人物关系'], ['conflict', '核心冲突'], ['emotion', '情绪发展'], ['ending', '故事结局']];
const state = { projects: [], project: null, draft: null, dirty: false, creating: false, busy: false, job: null, tools: null, warnings: [], polling: null, viewCandidate: true };
const $ = (selector) => document.querySelector(selector);
const app = $('#app');
const blankDraft = () => ({ name: '', idea: '', durationSeconds: 30, aspectRatio: '9:16', style: '', budgetCap: null, references: [], creativeBrief: null });
const clone = value => structuredClone(value);
const activeJob = () => state.job && ['queued', 'running'].includes(state.job.status);
const dateLabel = value => value ? new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : '';
const fullTime = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '';

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body instanceof Blob ? {} : { 'Content-Type': 'application/json' }), ...options.headers } });
  let data;
  try { data = await response.json(); } catch { throw new Error(`服务器响应异常（${response.status}），请确认工作台仍在运行。`); }
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : data.error?.message || data.message || `请求失败（${response.status}）`;
    throw new Error(message);
  }
  return data;
}
function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.className = `visible${error ? ' error' : ''}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.className = ''; }, error ? 8500 : 3500);
}
function markDirty() {
  state.dirty = true;
  const el = $('#save-state'); if (el) { el.className = 'save-state dirty'; el.innerHTML = `${svg('clock')}有未保存修改`; }
}
async function confirmDiscard() {
  if (!state.dirty) return true;
  const dialog = $('#confirm-dialog');
  dialog.innerHTML = `<div class="confirm-body"><h2 id="confirm-heading" class="confirm-heading">保留当前修改？</h2><p>当前内容尚未保存。你可以先保存，再切换到其他项目。</p><div class="confirm-actions"><button class="ghost-button" data-choice="discard">放弃修改</button><button class="secondary-button" data-choice="cancel">继续编辑</button><button class="primary-button" data-choice="save">保存并切换</button></div></div>`;
  dialog.showModal();
  return new Promise(resolve => {
    const onClose = () => { cleanup(); resolve(false); };
    const cleanup = () => { dialog.removeEventListener('click', onClick); dialog.removeEventListener('cancel', onClose); };
    const onClick = async event => {
      const choice = event.target.closest('[data-choice]')?.dataset.choice;
      if (!choice) return;
      if (choice === 'save') { const saved = await saveProject(); if (!saved) return; }
      cleanup(); dialog.close(); resolve(choice !== 'cancel');
    };
    dialog.addEventListener('click', onClick); dialog.addEventListener('cancel', onClose);
  });
}
function workflow() {
  return `<div class="workflow" aria-label="制作流程">${['故事立项', '即梦剧本', 'Codex 审阅', '即梦分镜', 'Codex 检查', '画风预算', '画布视频', '后期制作', '成片导出'].map((label, index) => `${index ? '<div class="step-connector"></div>' : ''}<div class="workflow-step ${index === 0 ? 'current' : ''}" ${index === 0 ? 'aria-current="step"' : 'title="后续阶段尚未开放"'}><span class="step-circle">${index + 1}</span>${label}</div>`).join('')}</div>`;
}
function sidebar() {
  return `<aside class="sidebar"><div class="brand"><div class="brand-mark">${svg('film')}</div><div><div class="brand-name">AI-Drama-Studio</div><div class="brand-sub">让故事开始发生</div></div></div><div class="nav-item">${svg('grid')}故事立项工作台<span class="tag">01</span></div><div class="sidebar-heading"><span>我的项目 <span class="project-count">${state.projects.length.toString().padStart(2, '0')}</span></span><button type="button" data-action="new" title="新建项目" aria-label="新建项目">＋</button></div><div class="project-list">${state.projects.length ? state.projects.map(project => `<button class="project-link ${state.project?.id === project.id ? 'active' : ''}" data-project-id="${esc(project.id)}"><span class="project-dot"></span><div><strong>${esc(project.name)}</strong><small>${esc(dateLabel(project.updatedAt))} · ${esc(project.durationSeconds)} 秒 · ${project.aspectRatio === '16:9' ? '横屏' : '竖屏'}</small></div></button>`).join('') : '<div class="empty-list">你的第一部短剧，<br>就从这里开始。</div>'}</div><div class="sidebar-bottom"><span class="local-dot"></span><div>本地工作空间<small>内容保存在这台电脑上</small></div></div></aside>`;
}
function render() {
  const editing = Boolean(state.draft);
  app.innerHTML = `<div class="layout">${sidebar()}<main class="main"><header class="topbar"><div class="breadcrumb">工作空间<span>/</span><strong>故事立项</strong>${state.project ? `<span class="breadcrumb-project">/　${esc(state.project.name)}</span>` : ''}</div><div class="top-actions">${state.project ? '<button class="primary-button" data-action="open-creative" data-testid="open-creative">文字与分镜创作 →</button><button class="secondary-button" data-action="open-script" data-testid="open-script">即梦剧本</button>' : ''}<button class="ghost-button" data-action="tools" data-testid="check-tools">${svg('settings')}环境检测</button><button class="primary-button" data-action="new" data-testid="new-project">${svg('plus')}新建项目</button></div></header><div class="content"><div class="page-heading"><div><div class="eyebrow">每个好故事，都从一个想法开始</div><h1>故事立项工作台</h1><p>记录灵感，明确创作方向，让 Codex 帮你把构思变成故事。</p></div><span class="stage-badge">第一阶段 · 本地创作</span></div>${workflow()}${state.warnings.length ? `<div class="warning-box" role="alert">${state.warnings.map(esc).join('<br>')}</div>` : ''}${editing ? editor() : welcome()}<p class="footer-note">${svg('shield')}保存项目后可进入本机 Codex 文字与分镜创作；即梦剧本保留为可选渠道。</p></div></main></div>`;
  if (editing) { bindForm(); renderJob(); }
}
function welcome() {
  return `<section class="empty-workspace"><div class="eyebrow">你的创作空间，已经准备好了</div><h2>把一个念头，<br>变成下一部短剧。</h2><p>不必一开始就想好全部。写下一个场景、一个人物，<br>或是一个让你念念不忘的冲突，故事从这里生长。</p><button class="primary-button" data-action="new">创建第一个项目${svg('arrow')}</button></section><div class="feature-grid"><div class="feature-card">${svg('edit')}<h3>留住每一个灵感</h3><p>构思、时长、画风和预算，在一个项目中有序保存。</p></div><div class="feature-card">${svg('sparkle')}<h3>与 Codex 一起创作</h3><p>调用本机 Codex 扩写故事，并区分你的设定与补充内容。</p></div><div class="feature-card">${svg('folder')}<h3>随时回来，接着写</h3><p>项目与参考素材保存在本地，关闭后重新打开仍然可用。</p></div></div>`;
}
function editor() {
  const d = state.draft;
  return `<div class="workspace"><section class="panel"><div class="panel-heading"><div class="panel-icon">${svg('edit')}</div><div><h2>故事设定</h2><p>你的构思，是一切创作的起点</p></div><div id="save-state" class="save-state ${state.dirty ? 'dirty' : ''}">${svg(state.dirty ? 'clock' : 'check')}${state.dirty ? '有未保存修改' : state.creating ? '新项目' : '已保存到本地'}</div></div><form id="project-form"><div class="panel-body"><div class="form-group"><div class="label-line"><label for="project-name">项目名称<span class="required">*</span></label></div><input id="project-name" name="name" data-testid="name" required maxlength="120" value="${esc(d.name)}" placeholder="给这个故事起个名字"></div><div class="form-group"><div class="label-line"><label for="project-idea">故事构思<span class="required">*</span></label><span class="hint" id="idea-count">${d.idea.length} 字</span></div><textarea id="project-idea" class="idea-input" name="idea" data-testid="idea" maxlength="20000" placeholder="写下你的故事想法。人物、场景、冲突，或是一个想要实现的结局……\n\n你指定的内容将作为扩写的创作约束。">${esc(d.idea)}</textarea></div><div class="form-row"><div class="form-group"><div class="label-line"><label for="project-duration">目标时长</label></div><div class="input-unit"><input id="project-duration" name="durationSeconds" data-testid="duration" type="number" min="5" max="7200" step="1" required value="${esc(d.durationSeconds)}"><span>秒</span></div></div><div class="form-group"><div class="label-line"><span class="field-label">画面比例</span></div><div class="ratio-options" role="group" aria-label="横竖屏"><button type="button" data-ratio="9:16" data-testid="aspect-portrait" aria-pressed="${d.aspectRatio === '9:16'}" class="ratio-button ${d.aspectRatio === '9:16' ? 'selected' : ''}"><span class="ratio-symbol"></span>竖屏</button><button type="button" data-ratio="16:9" data-testid="aspect-landscape" aria-pressed="${d.aspectRatio === '16:9'}" class="ratio-button ${d.aspectRatio === '16:9' ? 'selected' : ''}"><span class="ratio-symbol"></span>横屏</button></div></div></div><div class="form-group"><div class="label-line"><label for="project-style">画风说明</label><span class="hint">可选</span></div><textarea id="project-style" class="style-input" name="style" data-testid="style" maxlength="5000" placeholder="例如：温暖的二维手绘，柔和光线，低饱和色彩">${esc(d.style)}</textarea></div><div class="form-group"><div class="label-line"><label for="reference-input">参考素材</label><span class="hint">可选 · 本地保存</span></div><label class="upload-zone" for="reference-input">${svg('upload')}<span><strong>点击添加参考文件</strong><small>图片、视频、音频或文档 · 单个不超过 25 MB</small></span><input type="file" id="reference-input" data-testid="references" multiple aria-label="添加参考素材"></label><div class="reference-list">${referenceItems()}</div><p class="budget-help">本阶段保存文件；Codex 仅接收文件信息，不读取或分析素材内容。</p></div><div class="form-group"><div class="label-line"><label for="project-budget">预算上限</label><span class="hint">可选</span></div><div class="input-unit"><input id="project-budget" name="budgetCap" data-testid="budget" type="number" min="0" max="100000000" step="0.01" value="${d.budgetCap === null ? '' : esc(d.budgetCap)}" placeholder="暂未设定"><span>元</span></div><p class="budget-help">用于后续制作规划；本阶段不估价，也不提交付费生成任务。</p></div></div><div class="form-footer"><button type="submit" class="secondary-button" data-testid="save-project" ${state.busy ? 'disabled' : ''}>${svg('save')}保存项目</button><button type="button" class="primary-button" data-action="expand" data-testid="expand-story" ${state.busy || activeJob() ? 'disabled' : ''}>${svg('sparkle')}${activeJob() ? 'Codex 正在扩写' : '让 Codex 扩写'}</button></div></form></section><section class="panel brief-panel"><div class="panel-heading"><div class="panel-icon">${svg('sparkle')}</div><div><h2>创作说明</h2><p>从故事雏形，到清晰的创作方向</p></div><span class="hint auto-margin">${d.creativeBrief ? '可自由编辑' : '由本机 Codex 扩写'}</span></div><div class="panel-body"><div id="job-container" aria-live="polite"></div><div id="brief-container">${briefContent()}</div></div></section></div>`;
}
function referenceItems() {
  return (state.draft.references || []).map(ref => `<div class="reference-item"><a href="/api/projects/${encodeURIComponent(state.project.id)}/references/${encodeURIComponent(ref.id)}" target="_blank" rel="noopener">${esc(ref.name)}</a><span>${ref.size > 1024 * 1024 ? (ref.size / 1024 / 1024).toFixed(1) + ' MB' : Math.ceil(ref.size / 1024) + ' KB'}</span><button type="button" data-remove-reference="${esc(ref.id)}" aria-label="移除参考素材 ${esc(ref.name)}" title="移除参考素材">×</button></div>`).join('');
}
function candidateVisible() { return state.viewCandidate && state.job?.status === 'succeeded' && state.job.result && !state.job.appliedAt; }
function briefContent() {
  const candidate = candidateVisible();
  const brief = candidate ? state.job.result : state.draft?.creativeBrief;
  if (!brief) return `<div class="blank-brief"><div class="blank-art">${svg('sparkle')}</div><h3>给灵感一点生长的空间</h3><p>填写左侧故事构思，点击「让 Codex 扩写」，<br>生成属于这个项目的创作说明。</p><div class="brief-outline">${sections.map(([key, label], i) => `<div class="outline-item"><span>0${i + 1}</span><strong>${label}</strong></div>`).join('')}</div></div><div class="provenance-note">${svg('shield')}<div><strong>你的想法，始终是故事的起点。</strong><br>扩写会保留你指定的内容，并单独标明 AI 自行补充的设定。结果由你审阅、编辑和决定是否采用。</div></div>`;
  return `${candidate ? `<div class="candidate-banner"><p><strong>本次扩写已完成，等待你审阅</strong>下方是 Codex 真实返回的候选内容。采用后可自由修改。</p><button type="button" class="primary-button small-button" data-action="apply" data-testid="apply-expansion">采用本次扩写</button>${state.draft.creativeBrief ? '<button type="button" class="ghost-button small-button" data-action="show-current">查看当前说明</button>' : ''}</div>` : state.job?.status === 'succeeded' && !state.job.appliedAt ? '<div class="candidate-banner"><p>你正在编辑已保存的创作说明，另有一份扩写候选可查看。</p><button class="secondary-button small-button" data-action="show-candidate">查看扩写候选</button></div>' : ''}${sections.map(([key, label], index) => `<div class="brief-section"><label for="brief-${key}"><span class="section-number">0${index + 1}</span>${label}</label><textarea id="brief-${key}" data-brief="${key}" data-testid="brief-${key}" ${candidate ? 'readonly' : ''}>${esc(brief[key])}</textarea></div>`).join('')}<div class="provenance-group"><h3>保留的用户指定内容</h3><label class="sr-only" for="brief-preserved">保留的用户指定内容，每行一条</label><textarea id="brief-preserved" data-brief-list="preservedContent" ${candidate ? 'readonly' : ''} placeholder="每行一条">${esc((brief.preservedContent || []).join('\n'))}</textarea></div><div class="provenance-group added"><h3>AI 自行补充的设定 · 采用前请核对</h3><label class="sr-only" for="brief-added">AI 自行补充的设定，每行一条</label><textarea id="brief-added" data-brief-list="addedSettings" ${candidate ? 'readonly' : ''} placeholder="每行一条">${esc((brief.addedSettings || []).join('\n'))}</textarea></div>${candidate ? '' : '<p class="budget-help">修改创作说明后，请点击左侧「保存项目」。</p>'}`;
}
function renderJob() {
  const el = $('#job-container'); if (!el) return;
  const job = state.job; if (!job) { el.innerHTML = ''; return; }
  const labels = { queued: '等待 Codex 启动', running: 'Codex 正在扩写', succeeded: 'Codex 扩写完成', failed: 'Codex 扩写失败', cancelled: '本次扩写已取消', interrupted: '上次扩写已中断' };
  const statusClass = job.status === 'failed' || job.status === 'interrupted' ? 'failed' : job.status === 'succeeded' ? 'success' : '';
  el.innerHTML = `<div class="job-card ${statusClass}" data-testid="job-status" data-status="${esc(job.status)}"><div class="job-title">${activeJob() ? '<span class="spinner"></span>' : svg(job.status === 'succeeded' ? 'check' : 'alert')}${labels[job.status] || esc(job.status)}</div><p>${esc(job.error || job.message || job.phase || '')}</p><div class="job-meta">${esc(fullTime(job.createdAt))}${job.inputRevision ? ` · 来源版本 ${job.inputRevision}` : ''}${job.appliedAt ? ' · 已采用' : ''}</div>${job.events?.length ? `<details class="event-details"><summary class="event-summary">查看真实运行记录（${job.events.length}）</summary><div class="job-events">${job.events.slice(-30).map(event => `<div>${esc(event.at ? new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false }) : '')}　${esc(event.message || event.type)}</div>`).join('')}</div></details>` : ''}${activeJob() ? '<button class="ghost-button" type="button" data-action="cancel-job">取消本次扩写</button>' : ''}</div>`;
}
function bindForm() {
  $('#project-form')?.addEventListener('submit', async event => { event.preventDefault(); await saveProject(); });
}
function upsertProject(project) {
  const index = state.projects.findIndex(p => p.id === project.id);
  if (index >= 0) state.projects[index] = project; else state.projects.unshift(project);
  state.projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  state.project = project; state.draft = clone(project); state.creating = false; state.dirty = false;
  localStorage.setItem('ai-drama-studio:last-project', project.id);
}
async function saveProject({ quiet = false } = {}) {
  if (state.busy || !state.draft) return false;
  const form = $('#project-form'); if (form && !form.reportValidity()) return false;
  if (!state.draft.name.trim()) { toast('请先为项目填写名称。', true); $('#project-name')?.focus(); return false; }
  state.busy = true; setBusy();
  try {
    const project = await api(state.creating ? '/api/projects' : `/api/projects/${encodeURIComponent(state.project.id)}`, { method: state.creating ? 'POST' : 'PUT', body: JSON.stringify(state.draft) });
    upsertProject(project); render(); if (!quiet) toast('项目已保存'); return true;
  } catch (error) { toast(error.message, true); return false; }
  finally { state.busy = false; setBusy(); }
}
function setBusy() {
  document.querySelectorAll('#project-form input, #project-form textarea, #project-form [data-ratio], #project-form [data-remove-reference], #brief-container textarea').forEach(element => { element.disabled = state.busy; });
  const save = $('[data-testid="save-project"]'); if (save) save.disabled = state.busy;
  const expand = $('[data-testid="expand-story"]'); if (expand) { expand.disabled = state.busy || Boolean(activeJob()); expand.innerHTML = svg('sparkle') + (activeJob() ? 'Codex 正在扩写' : '让 Codex 扩写'); }
}
async function newProject() {
  if (state.busy) { toast('正在保存当前操作，请稍候再切换项目。'); return; }
  if (!await confirmDiscard()) return;
  clearTimeout(state.polling); state.project = null; state.job = null; state.draft = blankDraft(); state.creating = true; state.dirty = false; state.viewCandidate = true; render(); $('#project-name')?.focus();
}
async function selectProject(id) {
  if (state.busy) { toast('正在保存当前操作，请稍候再切换项目。'); return; }
  if (id === state.project?.id) return;
  if (!await confirmDiscard()) return;
  state.busy = true; setBusy();
  try {
    const project = await api(`/api/projects/${encodeURIComponent(id)}`);
    clearTimeout(state.polling); state.job = null; upsertProject(project); state.viewCandidate = true; render();
    if (project.latestJobId) await loadJob(project.latestJobId, project.id);
  } catch (error) { toast(error.message, true); }
  finally { state.busy = false; setBusy(); }
}
async function expand() {
  if (state.busy || activeJob()) return;
  if (!state.draft.idea.trim()) { toast('请先填写故事构思，再让 Codex 扩写。', true); $('#project-idea')?.focus(); return; }
  if (!await saveProject({ quiet: true })) return;
  state.busy = true; setBusy();
  try {
    const projectId = state.project.id;
    const job = await api(`/api/projects/${encodeURIComponent(projectId)}/expand`, { method: 'POST', body: JSON.stringify({ revision: state.project.revision }) });
    state.project.latestJobId = job.id; state.draft.latestJobId = job.id; state.job = job; state.viewCandidate = true;
    renderJob(); setBusy(); pollJob(job.id, projectId);
    toast('已发起本机 Codex 调用，运行状态将在右侧显示。');
  } catch (error) { toast(error.message, true); }
  finally { state.busy = false; setBusy(); }
}
async function loadJob(id, projectId) {
  try {
    const job = await api(`/api/jobs/${encodeURIComponent(id)}`);
    if (state.project?.id !== projectId) return;
    state.job = job; renderJob(); const brief = $('#brief-container'); if (brief) brief.innerHTML = briefContent(); setBusy();
    if (activeJob()) pollJob(id, projectId);
  } catch (error) { toast(`运行记录读取失败：${error.message}`, true); }
}
function pollJob(id, projectId) {
  clearTimeout(state.polling);
  state.polling = setTimeout(async () => {
    if (state.project?.id !== projectId) return;
    try {
      const job = await api(`/api/jobs/${encodeURIComponent(id)}`);
      if (state.project?.id !== projectId) return;
      state.job = job; renderJob(); setBusy();
      if (activeJob()) pollJob(id, projectId);
      else {
        const brief = $('#brief-container'); if (brief) brief.innerHTML = briefContent();
        setBusy();
        toast(job.status === 'succeeded' ? 'Codex 扩写完成，请审阅后采用。' : job.error || job.message || '扩写未完成，请查看运行记录。', job.status !== 'succeeded');
      }
    } catch (error) { toast(`状态读取失败：${error.message}。正在重试。`, true); pollJob(id, projectId); }
  }, 1500);
}
async function applyExpansion() {
  if (state.busy || !state.job?.result) return;
  if (state.dirty && !await saveProject({ quiet: true })) return;
  state.busy = true; setBusy();
  try {
    const project = await api(`/api/jobs/${encodeURIComponent(state.job.id)}/apply`, { method: 'POST', body: JSON.stringify({ revision: state.project.revision }) });
    upsertProject(project); state.job.appliedAt = new Date().toISOString(); render(); toast('已采用本次扩写。你可以继续修改创作说明。');
  } catch (error) { toast(error.message, true); }
  finally { state.busy = false; setBusy(); }
}
async function cancelJob() {
  if (!activeJob()) return;
  try { state.job = await api(`/api/jobs/${encodeURIComponent(state.job.id)}/cancel`, { method: 'POST', body: '{}' }); renderJob(); setBusy(); }
  catch (error) { toast(error.message, true); }
}
async function uploadFiles(files) {
  if (!files.length) return;
  if (Array.from(files).some(file => file.size > 25 * 1024 * 1024)) { toast('单个参考文件不能超过 25 MB，请选择较小的文件。', true); return; }
  if ((state.creating || state.dirty) && !await saveProject({ quiet: true })) return;
  state.busy = true; setBusy();
  try {
    for (const file of files) {
      const project = await api(`/api/projects/${encodeURIComponent(state.project.id)}/references`, { method: 'POST', headers: { 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      upsertProject(project);
    }
    render(); toast('参考素材已保存到本地。扩写仅接收文件信息，不会分析文件内容。');
  } catch (error) { toast(error.message, true); render(); }
  finally { state.busy = false; setBusy(); }
}
async function removeReference(id) {
  if (state.busy) return;
  if (state.dirty && !await saveProject({ quiet: true })) return;
  state.busy = true; setBusy();
  try { const project = await api(`/api/projects/${encodeURIComponent(state.project.id)}/references/${encodeURIComponent(id)}`, { method: 'DELETE' }); upsertProject(project); render(); toast('参考素材已移除'); }
  catch (error) { toast(error.message, true); }
  finally { state.busy = false; setBusy(); }
}
const statusNames = { detected: '已检测到', needs_configuration: '需配置', not_verified: '尚未验证' };
function renderTools(loading = false, error = '') {
  const dialog = $('#tools-dialog');
  dialog.innerHTML = `<div class="dialog-header"><h2 id="tools-heading">本地工具与接口检测</h2><button class="close-button" aria-label="关闭环境检测" data-close-tools>×</button></div><div class="dialog-body"><p>读取本机工具的真实版本、帮助与认证状态。本阶段不提交即梦生图或视频任务。</p>${loading ? '<div class="job-card"><div class="job-title"><span class="spinner"></span>正在读取本机工具状态…</div><p>部分工具检查可能需要几秒钟，请稍候。</p></div>' : error ? `<div class="warning-box">${esc(error)}</div>` : (state.tools?.tools || []).map(tool => `<article class="tool-card"><div class="tool-title"><h3>${esc(tool.name)}${tool.version ? ` <span class="hint">${esc(tool.version)}</span>` : ''}</h3><span class="status-chip ${esc(tool.status)}">${statusNames[tool.status] || esc(tool.status)}</span></div><p>${esc(tool.summary)}</p>${tool.path ? `<div class="tool-path">${esc(tool.path)}</div>` : ''}${(tool.capabilities || []).map(cap => `<div class="capability"><span class="status-chip ${esc(cap.status)}">${statusNames[cap.status] || esc(cap.status)}</span><span><strong>${esc(cap.name)}</strong> · ${esc(cap.detail)}</span></div>`).join('')}${tool.nextAction ? `<p class="next-action">下一步：${esc(tool.nextAction)}</p>` : ''}${tool.evidence?.length ? `<details><summary>查看原始检查证据</summary>${tool.evidence.map(evidence => `<pre>${esc(evidence.command)}\n退出码：${esc(evidence.exitCode)}\n${esc(evidence.output)}</pre>`).join('')}</details>` : ''}</article>`).join('')}</div><div class="dialog-footer"><span>${state.tools?.checkedAt ? `检测时间：${esc(fullTime(state.tools.checkedAt))}` : '仅检查，不生成媒体'}</span><button class="secondary-button small-button" data-refresh-tools ${loading ? 'disabled' : ''}>重新检测</button></div>`;
}
async function showTools(refresh = false) {
  const dialog = $('#tools-dialog'); renderTools(!state.tools || refresh); if (!dialog.open) dialog.showModal();
  try { state.tools = await api(refresh ? '/api/tools/refresh' : '/api/tools', refresh ? { method: 'POST', body: '{}' } : {}); renderTools(); }
  catch (error) { renderTools(false, error.message); }
}

app.addEventListener('click', async event => {
  const projectLink = event.target.closest('[data-project-id]'); if (projectLink) { await selectProject(projectLink.dataset.projectId); return; }
  const ratio = event.target.closest('[data-ratio]');
  if (ratio) { state.draft.aspectRatio = ratio.dataset.ratio; document.querySelectorAll('[data-ratio]').forEach(el => { el.classList.toggle('selected', el === ratio); el.setAttribute('aria-pressed', String(el === ratio)); }); markDirty(); return; }
  const reference = event.target.closest('[data-remove-reference]'); if (reference) { await removeReference(reference.dataset.removeReference); return; }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'new') await newProject();
  if (action === 'tools') await showTools();
  if (action === 'expand') await expand();
  if (action === 'apply') await applyExpansion();
  if (action === 'cancel-job') await cancelJob();
  if (action === 'open-creative') {
    if (state.busy) { toast('当前操作尚未结束，请稍候。'); return; }
    if (!state.project || !await confirmDiscard()) return;
    state.dirty = false;
    location.href = `/creative.html?projectId=${encodeURIComponent(state.project.id)}`;
  }
  if (action === 'open-script') {
    if (state.busy) { toast('当前操作尚未结束，请稍候。'); return; }
    if (!state.project || !await confirmDiscard()) return;
    state.dirty = false;
    location.href = `/script.html?projectId=${encodeURIComponent(state.project.id)}`;
  }
  if (action === 'show-current' || action === 'show-candidate') {
    if (state.busy) { toast('正在保存当前操作，请稍候再切换说明。'); return; }
    state.viewCandidate = action === 'show-candidate'; $('#brief-container').innerHTML = briefContent();
  }
});
app.addEventListener('input', event => {
  const target = event.target; if (!state.draft) return;
  if (target.name && ['name', 'idea', 'durationSeconds', 'style', 'budgetCap'].includes(target.name)) {
    state.draft[target.name] = target.name === 'durationSeconds' ? Number(target.value) : target.name === 'budgetCap' ? target.value === '' ? null : Number(target.value) : target.value;
    if (target.name === 'idea') $('#idea-count').textContent = `${target.value.length} 字`; markDirty();
  }
  if (target.dataset.brief && state.draft.creativeBrief) { state.draft.creativeBrief[target.dataset.brief] = target.value; markDirty(); }
  if (target.dataset.briefList && state.draft.creativeBrief) { state.draft.creativeBrief[target.dataset.briefList] = target.value.split('\n').map(value => value.trim()).filter(Boolean); markDirty(); }
});
app.addEventListener('change', event => { if (event.target.id === 'reference-input') uploadFiles(Array.from(event.target.files || [])); });
$('#tools-dialog').addEventListener('click', event => { if (event.target.closest('[data-close-tools]')) $('#tools-dialog').close(); if (event.target.closest('[data-refresh-tools]')) showTools(true); });
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); saveProject(); } });

async function initialize() {
  render();
  try {
    const data = await api('/api/projects'); state.projects = data.projects; state.warnings = data.warnings || [];
    const last = localStorage.getItem('ai-drama-studio:last-project'); const first = state.projects.find(project => project.id === last) || state.projects[0];
    if (first) { upsertProject(await api(`/api/projects/${encodeURIComponent(first.id)}`)); render(); if (state.project.latestJobId) await loadJob(state.project.latestJobId, state.project.id); }
    else render();
  } catch (error) { state.warnings = [`无法读取本地项目：${error.message}`]; render(); }
}
initialize();
