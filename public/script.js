const $ = selector => document.querySelector(selector);
const app = $('#script-app');
const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clone = value => structuredClone(value);
const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚无记录';
const state = { projects: [], project: null, ws: null, input: {}, binding: {}, limits: { credits: null }, inputDirty: false, draftBody: '', draftDirty: false, kind: 'script', selectedId: null, parentId: null, tasks: [], reviews: [], tool: null, cost: null, costs: {}, error: '', busy: false, poll: null };
const sections = [['synopsis', '故事梗概'], ['background', '背景'], ['characters', '人物关系'], ['conflict', '核心冲突'], ['emotion', '情绪发展'], ['ending', '结局']];
const criteriaNames = { user_requirements: '用户指定内容', motivation: '人物动机', logic: '剧情逻辑', duration: '目标时长', continuity: '场景连续性', production: '制作难度' };
const statusLabels = { prepared: '任务已准备', awaiting_confirmation: '等待确认', awaiting_cost: '费用待确认', submitting: '正在提交', queued: '等待启动', running: '运行中', succeeded: '真实任务成功', failed: '任务失败', interrupted: '上次运行中断', uncertain: '结果待核实', cancelled: '已取消' };
const anyDirty = () => state.inputDirty || state.draftDirty;
const projectPath = suffix => `/api/projects/${encodeURIComponent(state.project.id)}/script${suffix}`;
const selected = () => (state.ws?.versions || []).find(version => version.id === state.selectedId);
const labelKind = kind => kind === 'outline' ? '大纲' : '剧本';
async function api(url, data, method) {
  const options = { method: method || (data === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000) };
  if (data !== undefined) options.body = JSON.stringify(data);
  const response = await fetch(url, options);
  let result;
  try { result = await response.json(); } catch { throw new Error(`工作台响应异常（${response.status}），请确认本机服务仍在运行。`); }
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || `请求失败（${response.status}）`);
  return result;
}
function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.className = `visible${error ? ' error' : ''}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.className = ''; }, error ? 8500 : 3500);
}
function failure(error) { state.error = error.message || String(error); renderError(); toast(state.error, true); }
function renderError() {
  const el = $('#script-error');
  if (el) el.innerHTML = state.error ? `<div class="script-error" role="alert"><button data-action="dismiss-error" aria-label="关闭错误">×</button>${esc(state.error)}</div>` : '';
}
async function confirmAction(title, message, accept = '继续') {
  const dialog = $('#script-confirm');
  dialog.innerHTML = `<div class="script-dialog-content"><h2 id="script-confirm-heading">${esc(title)}</h2><p>${esc(message)}</p><div class="script-dialog-actions"><button class="secondary-button" data-confirm="cancel">继续编辑</button><button class="primary-button" data-confirm="accept">${esc(accept)}</button></div></div>`;
  dialog.showModal();
  return new Promise(resolve => {
    const finish = result => { dialog.removeEventListener('click', click); dialog.removeEventListener('cancel', cancel); dialog.close(); resolve(result); };
    const click = event => { const action = event.target.closest('[data-confirm]')?.dataset.confirm; if (action) finish(action === 'accept'); };
    const cancel = event => { event.preventDefault(); finish(false); };
    dialog.addEventListener('click', click); dialog.addEventListener('cancel', cancel);
  });
}
async function canLeave() {
  if (state.busy) { toast('当前操作尚未结束，请稍候。'); return false; }
  return !anyDirty() || await confirmAction('保留未保存的修改？', '剧本输入或人工稿尚未保存。继续切换会放弃这些未保存内容；已保存的版本会完整保留。', '放弃未保存并切换');
}
function setWorkspace(ws, { keepDraft = false } = {}) {
  state.ws = ws; state.input = clone(ws.input || {}); state.binding = clone(ws.binding || { projectId: '', teamId: '' }); state.inputDirty = false;
  state.limits = clone(ws.spendingLimits || { credits: null });
  state.tasks = ws.tasks || []; state.reviews = ws.reviews || []; state.tool = ws.tool || state.tool; state.cost = ws.costEstimate || state.cost; state.costs = ws.costEstimates || { script: state.cost };
  const versions = ws.versions || [];
  if (!versions.some(version => version.id === state.selectedId)) state.selectedId = state.kind === 'outline' ? ws.activeOutlineId : ws.activeScriptId;
  if (!state.selectedId) state.selectedId = [...versions].reverse().find(version => version.kind === state.kind)?.id || null;
  if (!keepDraft) { state.draftBody = ''; state.draftDirty = false; state.parentId = null; }
}
function pill(label, type = '') { return `<span class="script-pill ${esc(type)}">${esc(label)}</span>`; }
function projectSidebar() {
  return `<aside class="sidebar"><div class="brand"><div class="brand-mark">▤</div><div><div class="brand-name">AI-Drama-Studio</div><div class="brand-sub">让故事开始发生</div></div></div><a class="script-nav" href="/" data-action="return"><span class="step-number">01</span>故事立项</a><div class="script-nav active"><span class="step-number">02</span>剧本与独立审阅</div><a class="script-nav" href="/video.html${state.project ? `?projectId=${encodeURIComponent(state.project.id)}` : ''}" data-leave><span class="step-number">04</span>单镜头视频</a><a class="script-nav" href="/timeline.html${state.project ? `?projectId=${encodeURIComponent(state.project.id)}` : ''}" data-leave><span class="step-number">05</span>本地时间轴</a><div class="sidebar-heading"><span>我的项目 <span class="project-count">${state.projects.length}</span></span></div><div class="project-list">${state.projects.map(project => `<button class="project-link ${project.id === state.project?.id ? 'active' : ''}" data-project-id="${esc(project.id)}"><span class="project-dot"></span><div><strong>${esc(project.name)}</strong><small>${project.durationSeconds} 秒 · ${project.aspectRatio === '16:9' ? '横屏' : '竖屏'}</small></div></button>`).join('') || '<div class="empty-list">先创建一个故事项目。</div>'}</div><div class="sidebar-bottom"><span class="local-dot"></span><div>本地版本记录<small>已保存的稿件与审阅独立保留</small></div></div></aside>`;
}
function render() {
  document.body.classList.add('script-page');
  app.innerHTML = `<div class="layout">${projectSidebar()}<main class="main"><header class="topbar"><div class="breadcrumb">工作空间<span>/</span><strong>剧本</strong>${state.project ? `<span class="breadcrumb-project">/　${esc(state.project.name)}</span>` : ''}</div><div class="top-actions"><a class="secondary-button" href="/creative.html${state.project ? `?projectId=${encodeURIComponent(state.project.id)}` : ''}" data-action="return" data-testid="open-creative">Codex 文字与分镜 →</a><a class="ghost-button" href="/" data-action="return">返回故事立项</a><button class="secondary-button" data-action="reload" data-testid="script-refresh">刷新状态</button></div></header><div class="content"><div class="page-heading"><div><div class="eyebrow">让创作说明成为可拍摄的故事</div><h1>剧本与独立审阅</h1><p>即梦生成候选，Codex 独立检查，最终稿由你决定。</p></div><span class="stage-badge">第二阶段 · 剧本</span></div><div class="script-route-steps"><span>已保存创作说明</span><span>→</span><strong>即梦剧本候选</strong><span>→</span><strong>Codex 独立审阅</strong><span>→</span><span>人工修改与版本保存</span></div><div id="script-error"></div>${state.project && state.ws ? workspaceView() : `<div class="script-empty"><strong>${state.projects.length ? '请选择一个故事项目' : '故事还没有开始'}</strong>先在故事立项中保存项目和创作说明，再进入剧本阶段。<p><a href="/" data-action="return">前往故事立项</a></p></div>`}<p class="footer-note">图片、视频、配音和剪辑留待后续阶段。本页面不以文本节点保存冒充即梦 Agent 改稿。</p></div></main></div>`;
  if (state.kind === 'outline' && selected()) $('.script-editor-toolbar')?.insertAdjacentHTML('beforeend', '<button class="secondary-button" data-action="outline-to-summary" data-testid="outline-to-summary">填入本集梗概</button>');
  $('#script-input-form')?.insertAdjacentHTML('beforeend', `<div class="form-group"><label for="script-credit-cap">积分预算上限（可选，独立于人民币预算）</label><input id="script-credit-cap" data-spend="credits" data-testid="script-credit-cap" type="number" min="0" max="1000000000" step="any" value="${state.limits.credits === null ? '' : esc(state.limits.credits)}" placeholder="尚未设定"><p class="script-panel-note">设置上限不等于同意付费。只有取得本次明确费用并再次确认后才可提交；人民币与积分不换算。</p></div>`);
  renderError(); renderRuntime(); setBusy(state.busy); dirtyIndicators();
}
function workspaceView() {
  const input = state.input;
  const p = state.project;
  const noBrief = !p.creativeBrief;
  return `<div id="script-stale-banner" class="script-state-box">${staleBanner()}</div>${noBrief ? '<div class="warning-box script-not-ready">本项目尚无已保存的创作说明。请先返回故事立项，采用或保存创作说明后再整理剧本输入。</div>' : ''}<div class="script-top-summary"><section class="script-summary-card"><h2>即梦短剧工具</h2><div id="novel-tool-status" class="script-live-status"></div><p>绑定真实即梦画布后才能提交业务任务。本地项目编号不能代替即梦画布编号。</p></section><section class="script-summary-card"><div class="script-cost-title"><h2>提交前费用与预算</h2><strong data-testid="script-cost-status" id="script-cost-label">费用待确认</strong></div><div id="script-cost-detail"></div><p class="script-budget-evidence">本项目预算上限：${p.budgetCap === null ? '未设定' : `${esc(p.budgetCap)} 元人民币`}。计划金额不等于即梦积分报价；余额不能代替单次任务费用。</p></section></div><div class="script-grid"><div class="script-stack"><section class="panel"><div class="panel-heading script-panel-heading"><div><h2>创作说明与剧本输入</h2><p>只从已保存内容整理，保留原有要求</p></div><div class="script-panel-actions"><button class="ghost-button" data-action="sync" data-testid="script-sync" ${noBrief ? 'disabled' : ''}>从当前说明整理</button></div></div><div class="panel-body"><details class="script-source"><summary>查看当前已保存的创作说明</summary><p><strong>原始构思</strong><br>${esc(p.idea)}</p>${p.creativeBrief ? `<dl>${sections.map(([key, title]) => `<dt>${title}</dt><dd>${esc(p.creativeBrief[key])}</dd>`).join('')}</dl><p><strong>用户指定内容</strong><br>${(p.creativeBrief.preservedContent || []).map(esc).join('<br>') || '未单列'}</p><p><strong>AI 补充设定</strong><br>${(p.creativeBrief.addedSettings || []).map(esc).join('<br>') || '未单列'}</p>` : '<p>暂无已保存说明。</p>'}</details><form id="script-input-form"><div class="script-input-grid"><div class="form-group"><label for="outline-count">计划集数</label><input id="outline-count" data-input="episode_num" data-testid="script-input-episode-count" type="number" min="1" max="100" value="${esc(input.episode_num ?? 1)}"></div><div class="form-group"><label for="current-episode">当前集数</label><input id="current-episode" data-input="current_episode" data-testid="script-input-current-episode" type="number" min="1" value="${esc(input.current_episode ?? 1)}"></div></div>${field('idea', '大纲创意 / 故事梗概', 'script-input-idea')}${field('story_engine', '故事引擎：目标、阻碍与代价', 'script-input-engine')}${field('characters', '人物与关系', 'script-input-characters')}${field('current_episode_summary', '本集梗概', 'script-input-summary')}${field('requirement', '本集要求：时长、结局与用户锁定内容', 'script-input-requirement')}<details class="script-input-more"><summary>背景与参考文本</summary><div>${field('world_setting', '世界与场景背景', 'script-input-world')}${field('ref_content', '大纲参考文本', 'script-input-reference')}</div></details><div class="form-group"><label for="script-language">剧本语言区域</label><select id="script-language" data-input="script_localization"><option value="cn" ${input.script_localization !== 'i18n' ? 'selected' : ''}>中文</option><option value="i18n" ${input.script_localization === 'i18n' ? 'selected' : ''}>国际化</option></select></div></form></div><div class="form-footer"><button class="secondary-button" data-action="save-input" data-testid="script-input-save">保存输入与绑定</button><span id="script-input-dirty" class="script-dirty-indicator"></span></div></section><section class="panel"><div class="panel-heading"><div><h2>真实即梦画布绑定</h2><p>只核对现有画布，不自动创建</p></div></div><div class="panel-body"><div class="form-group"><label for="remote-project">即梦项目 / 画布 ID</label><input id="remote-project" data-binding="projectId" data-testid="remote-project-id" maxlength="200" value="${esc(state.binding.projectId || '')}" placeholder="粘贴已有即梦画布的真实编号"></div><div class="form-group"><label for="remote-team">空间 ID</label><input id="remote-team" data-binding="teamId" data-testid="remote-team-id" maxlength="200" value="${esc(state.binding.teamId || '')}" placeholder="按实际账号空间填写；留空使用工具默认"></div><button class="secondary-button" data-action="verify-binding" data-testid="verify-binding">保存并校验绑定</button><p id="script-binding-status" class="script-binding-status"></p></div></section><section class="panel"><div class="panel-heading"><div><h2>生成任务与候选</h2><p>先准备输入和费用，再决定是否提交</p></div></div><div class="panel-body"><p class="script-panel-note">准备任务只保存输入与幂等编号，不消耗生成额度。费用未知时不会提交；任务中断后沿原编号查询。</p><div class="script-action-row"><button class="secondary-button" data-action="prepare-outline" data-testid="prepare-outline" ${noBrief ? 'disabled' : ''}>准备大纲任务</button><button class="primary-button" data-action="prepare-script" data-testid="prepare-script" ${noBrief ? 'disabled' : ''}>准备剧本任务</button></div><div id="script-tasks" class="script-task-list"></div></div></section></div><div class="script-stack"><section class="panel"><div class="panel-heading script-panel-heading"><div><h2>稿件与版本</h2><p>候选、人工稿与历史版本分别保留</p></div><div class="script-tabs"><button class="script-tab ${state.kind === 'outline' ? 'active' : ''}" data-kind="outline" data-testid="script-outline-tab">大纲</button><button class="script-tab ${state.kind === 'script' ? 'active' : ''}" data-kind="script" data-testid="script-script-tab">剧本</button></div></div><div class="panel-body"><div class="script-editor-toolbar"><select id="script-version-select" data-testid="script-version-select" aria-label="查看已保存版本">${versionOptions()}</select><button class="secondary-button" data-action="activate-version" data-testid="script-activate-version" ${!selected() ? 'disabled' : ''}>设为当前版本</button></div><div id="script-version-view">${versionView()}</div><div class="script-editor-label"><label for="script-draft">人工编辑区 · 保存为新版本</label><label class="script-import-button">导入文本<input type="file" id="script-import" data-testid="script-import" accept=".txt,.md,text/plain,text/markdown" aria-label="导入剧本文本"></label></div><textarea id="script-draft" class="script-draft" data-testid="script-draft-body" maxlength="100000" placeholder="粘贴或输入${labelKind(state.kind)}。也可以点击下方“以查看版本开始编辑”。">${esc(state.draftBody)}</textarea><p class="script-editor-tip">修改不会覆盖历史稿。人工修改由你完成；当前没有已验证的即梦 Agent 定向改稿接口。</p><div class="script-action-row"><button class="ghost-button" data-action="edit-version" data-testid="script-edit-version" ${!selected() ? 'disabled' : ''}>以查看版本开始编辑</button><span id="script-draft-dirty" class="script-dirty-indicator"></span></div><details class="script-history-detail"><summary>查看全部版本记录</summary><div class="script-version-history">${versionHistory()}</div></details></div><div class="form-footer script-save-footer"><button class="primary-button" data-action="save-version" data-testid="script-save-version">保存人工${labelKind(state.kind)}新版本</button><span class="script-compact-notes">已保存的旧版本始终保留</span></div></section><section class="panel"><div class="panel-heading script-panel-heading"><div><h2>Codex 独立审阅</h2><p>逐项证据与问题独立保存，不改写稿件</p></div><div class="script-panel-actions"><button class="secondary-button" data-action="review" data-testid="script-review-start" ${selected()?.kind !== 'script' ? 'disabled' : ''}>审阅查看中的剧本</button></div></div><div class="panel-body"><p class="script-panel-note">检查用户指定内容、人物动机、剧情逻辑、目标时长、场景连续性和制作难度。时长是基于文本的估计；调用使用本机 Codex 账号用量。</p><div id="script-reviews"></div></div></section></div></div>`;
}
function field(key, label, testId) { return `<div class="form-group"><label for="input-${key}">${label}</label><textarea id="input-${key}" data-input="${key}" data-testid="${testId}" maxlength="20000">${esc(state.input[key] || '')}</textarea></div>`; }
function staleBanner() {
  if (!state.ws?.upstreamStale) return '';
  return '<div class="warning-box" data-testid="script-upstream-stale">上游创作说明或项目要求已改变。旧输入、剧本与审阅保留为历史，需要复核；请核对后从当前说明重新整理。</div>';
}
function versionOptions() {
  const versions = (state.ws?.versions || []).filter(version => version.kind === state.kind);
  return versions.length ? versions.map((version, index) => `<option value="${esc(version.id)}" ${version.id === state.selectedId ? 'selected' : ''}>${labelKind(state.kind)} ${index + 1} · ${version.origin === 'user' ? '人工稿' : '即梦候选'} · ${time(version.createdAt)}${version.stale ? ' · 需复核' : ''}</option>`).join('') : '<option value="">尚无已保存版本</option>';
}
function versionView() {
  const version = selected();
  if (!version) return `<div class="script-empty"><strong>还没有${labelKind(state.kind)}版本</strong>可以先准备即梦生成任务，或直接在下方粘贴人工稿。候选只有在明确采用后才成为保存版本。</div>`;
  const current = version.id === (state.kind === 'outline' ? state.ws.activeOutlineId : state.ws.activeScriptId);
  return `<div class="script-version-meta">${pill(current ? '当前版本' : '历史版本', current ? 'purple' : '')} ${pill(version.origin === 'user' ? '人工稿' : '即梦生成', '')} ${version.stale ? pill('需要复核', 'warn') : ''}<br>保存时间：${esc(time(version.createdAt))} · 版本编号：${esc(version.id)}</div><div class="script-version-preview" data-testid="script-version-body">${esc(version.body)}</div>`;
}
function versionHistory() {
  const versions = state.ws?.versions || [];
  return [...versions].reverse().map(version => `<button data-version-id="${esc(version.id)}"><span>${labelKind(version.kind)} · ${version.origin === 'user' ? '人工稿' : '即梦候选'}${version.stale ? ' · 需要复核' : ''}<small>${esc(time(version.createdAt))}</small></span><span>${version.id === state.ws.activeScriptId || version.id === state.ws.activeOutlineId ? '当前' : '查看'}</span></button>`).join('') || '<p>尚无历史版本。</p>';
}
function renderRuntime() {
  if (!state.ws) return;
  const tool = $('#novel-tool-status');
  if (tool) tool.innerHTML = `${pill(state.tool?.installed ? '工具已配置' : '工具待配置', state.tool?.installed ? 'good' : 'warn')} ${pill(state.tool?.loggedIn ? '已确认登录' : '登录待完成', state.tool?.loggedIn ? 'good' : 'warn')} ${state.tool?.version ? `<span class="hint">${esc(state.tool.version)}</span>` : ''}<p>${esc(state.tool?.message || '以真实工具检查结果为准。')}</p>`;
  const estimate = state.cost || { status: 'unknown', label: '费用待确认', canSubmit: false };
  const costs = { outline: state.costs.outline || { status: 'unknown', canSubmit: false }, script: state.costs.script || estimate };
  const label = $('#script-cost-label'); if (label) label.textContent = Object.values(costs).every(value => value.status === 'known' && value.canSubmit) ? '分动作费用已核对' : '费用待确认';
  const cost = $('#script-cost-detail'); if (cost) cost.innerHTML = ['outline', 'script'].map(kind => priceMarkup(costs[kind], kind)).join('') + `<p>积分预算上限：${state.ws.spendingLimits?.credits === null || state.ws.spendingLimits?.credits === undefined ? '未设定' : esc(state.ws.spendingLimits.credits)}。积分与人民币分别核对，不推算兑换率。</p>`;
  const binding = $('#script-binding-status'); if (binding) binding.innerHTML = state.inputDirty ? '输入或绑定有未保存修改；校验前会先保存。' : state.ws.binding?.verified ? `<strong>真实绑定已校验</strong>${state.ws.binding.title ? ` · ${esc(state.ws.binding.title)}` : ''}` : '尚未校验真实画布。保存编号不等于校验成功。';
  const stale = $('#script-stale-banner'); if (stale) stale.innerHTML = staleBanner();
  const tasks = $('#script-tasks'); if (tasks) tasks.innerHTML = taskCards();
  const reviews = $('#script-reviews'); if (reviews) reviews.innerHTML = reviewCards();
  setBusy(state.busy);
}
function priceMarkup(quote, kind) {
  const known = quote?.status === 'known' && quote.canSubmit;
  const expiry = quote?.validity?.kind === 'not_stated' ? '官方未注明有效期，仅代表本次检查；后续须重新核验' : quote?.expiresAt ? `官方有效期至${time(quote.expiresAt)}` : '有效期未确认';
  const sources = (quote?.sources || []).map(source => `<li>${/^https:\/\//i.test(source.url || '') ? `<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.title)}</a>` : esc(source.title || source.command || '官方来源')}：${esc(source.excerpt || source.summary || '')}</li>`).join('');
  const metering = quote?.metering?.basis === 'output_characters' ? '<p>计量规则：按产出字数；每字单价与计费币种待确认；不支持总价预检。计量单位“字”不等于价格单位。</p>' : '';
  return `<section class="script-price-evidence" data-price-kind="${esc(kind)}"><p><strong>${labelKind(kind)}：${esc(known ? quote.label || `${quote.amount} ${quote.unit || quote.currency}` : '费用待确认')}</strong></p><p>${esc(quote?.basis || '未取得适用于本次CLI动作的可核验价格；网页免费权益不能直接视为CLI免费。')}</p>${metering}<p>渠道：${esc(quote?.channel || 'jimeng-novel-cli')}；计价单位：${esc(quote?.unit || quote?.currency || '未确认')}；${esc(expiry)}。</p>${quote?.checkedAt ? `<p>检查时间：${esc(time(quote.checkedAt))}</p>` : ''}${quote?.conditions?.length ? `<ul>${quote.conditions.map(condition => `<li>${esc(condition)}</li>`).join('')}</ul>` : ''}${sources ? `<details><summary>查看费用来源</summary><ul>${sources}</ul></details>` : ''}${known ? `<p>证据标识：${esc(quote.evidenceId || quote.officialQuoteId || '旧提供方记录')}；本地证据标识不等于官方报价编号。</p>` : '<p>本动作提交已锁定；可以整理输入、保存待提交任务与人工稿。</p>'}</section>`;
}
function receiptPreview(receipts) {
  const text = JSON.stringify(receipts, (key, value) => /token|cookie|authorization|device.?code|user.?code/i.test(key) ? '[已隐藏]' : value, 2);
  return text.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]').replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[已隐藏]');
}
function taskCards() {
  if (!state.tasks.length) return '<p class="script-compact-notes">尚无生成任务，没有提交任何即梦请求。</p>';
  return [...state.tasks].reverse().map(task => {
    const validBody = task.status === 'succeeded' && typeof task.body === 'string' && task.body.trim();
    const canSubmit = task.cost?.canSubmit === true && task.cost?.status !== 'unknown' && ['prepared', 'awaiting_confirmation', 'awaiting_cost'].includes(task.status) && !task.stale;
    return `<article class="script-task" data-task-id="${esc(task.id)}"><div class="script-task-header"><h3>${labelKind(task.kind)}任务</h3>${pill(statusLabels[task.status] || task.status, task.status === 'succeeded' ? 'good' : task.status === 'failed' ? 'bad' : 'warn')}</div>${task.stale ? '<p>上游或输入已变更：需要复核，旧任务不得直接采用。</p>' : ''}<p>${esc(task.error || task.message || (task.cost?.canSubmit ? '请核对费用后明确提交。' : '费用待确认；没有因准备任务而提交生成。'))}</p>${priceMarkup(task.cost, task.kind)}<div class="script-task-ids"><code>request-id：${esc(task.requestId || '尚无')}</code><code>thread_id：${esc(task.threadId || '尚未收到')}</code><code>run_id：${esc(task.runId || '尚未收到')}</code></div>${validBody ? `<details><summary>查看真实返回候选正文</summary><div class="script-candidate-preview">${esc(task.body)}</div></details>` : ''}<div class="script-action-row"><button class="primary-button" data-submit-task="${esc(task.id)}" ${!canSubmit ? 'disabled' : ''} title="${canSubmit ? '确认费用后提交此任务' : '费用未知或任务状态不允许提交'}">${canSubmit ? '确认费用并提交' : '费用待确认 · 禁止提交'}</button><button class="secondary-button" data-query-task="${esc(task.id)}" ${!task.threadId || !task.runId ? 'disabled' : ''}>查询原任务</button>${validBody ? `<button class="secondary-button" data-adopt-task="${esc(task.id)}" ${task.stale ? 'disabled' : ''}>采用${labelKind(task.kind)}候选</button>` : ''}</div>${task.receipts?.length ? `<details class="script-receipts"><summary>查看保留的任务回执</summary><pre>${esc(receiptPreview(task.receipts))}</pre></details>` : ''}</article>`;
  }).join('');
}
function reviewCards() {
  if (!state.reviews.length) return '<div class="script-empty"><strong>等待独立审阅</strong>选择一个已保存的剧本版本，再发起 Codex 审阅。报告与稿件分开保存，修改后旧报告需要重新核对。</div>';
  return [...state.reviews].reverse().map(review => {
    const report = review.status === 'succeeded' ? review.report : null;
    return `<article class="script-review-card" data-review-id="${esc(review.id)}" data-review-status="${esc(review.status)}"><div class="script-review-title"><strong>${report ? `审阅结论：${report.verdict === 'PASS' ? '通过' : '需修改'}` : statusLabels[review.status] || review.status}</strong>${review.needsReview ? pill('旧报告 · 需要复核', 'warn') : pill(report?.verdict === 'PASS' ? '当前版本审阅' : '独立报告', report?.verdict === 'PASS' ? 'good' : '')}</div>${review.error || review.message ? `<p class="script-review-summary">${esc(review.error || review.message)}</p>` : ''}${report ? `<p class="script-review-summary">${esc(report.summary)}</p><div class="script-review-criteria">${(report.criteria || []).map(item => `<section class="script-criterion"><div class="script-criterion-heading">${pill(item.verdict === 'PASS' ? '通过' : '需修改', item.verdict === 'PASS' ? 'good' : 'warn')}<strong>${esc(criteriaNames[item.id] || item.id)}</strong></div><p>${esc(item.evidence)}</p>${item.issues?.length ? `<ul>${item.issues.map(issue => `<li>${esc(issue)}</li>`).join('')}</ul>` : ''}</section>`).join('')}</div>${(report.issues || []).map(issue => `<div class="script-issue"><strong>${esc(issue.id)} · ${esc(({ blocking: '阻断', major: '主要', minor: '次要' })[issue.severity] || issue.severity)} · ${esc(issue.location)}</strong><p>证据：${esc(issue.evidence)}</p><p>建议：${esc(issue.suggestion)}</p></div>`).join('')}<p class="script-review-meta">文本时长估计：${report.estimatedDurationSeconds === null ? '未能确定' : `${esc(report.estimatedDurationSeconds)} 秒`}。${esc(report.durationBasis || '')}</p>` : ''}<div class="script-review-meta">剧本版本：${esc(review.versionId)}<br>保存时间：${esc(time(review.updatedAt || review.createdAt))}</div>${review.events?.length ? `<details class="script-review-events"><summary>真实运行记录</summary>${review.events.map(event => `<p>${esc(time(event.at))}　${esc(event.message || event.type)}</p>`).join('')}</details>` : ''}${['queued', 'running'].includes(review.status) ? `<button class="ghost-button" data-cancel-review="${esc(review.id)}">取消本次审阅</button>` : ''}</article>`;
  }).join('');
}
function setBusy(value) {
  state.busy = value;
  for (const el of app.querySelectorAll('input,textarea,select,button')) {
    if (value) { if (!el.disabled) el.dataset.busyDisabled = 'true'; el.disabled = true; }
    else if (el.dataset.busyDisabled) { el.disabled = false; delete el.dataset.busyDisabled; }
  }
  if (!value) dirtyIndicators();
}
function dirtyIndicators() {
  const input = $('#script-input-dirty'); if (input) input.textContent = state.inputDirty ? '输入有未保存修改' : '输入已保存';
  const draft = $('#script-draft-dirty'); if (draft) draft.textContent = state.draftDirty ? '人工稿有未保存修改' : '可另存为新版本';
  const button = $('[data-testid="script-review-start"]');
  if (button) {
    const version = selected();
    button.disabled = state.busy || !version || version.kind !== 'script' || version.id !== state.ws?.activeScriptId || version.stale || anyDirty();
    button.title = button.disabled ? '先保存当前输入与人工稿，再选择有效的活动剧本版本审阅。' : '调用本机 Codex 独立审阅此保存版本';
  }
}
async function loadProject(id, { bypassDirty = false } = {}) {
  if (!bypassDirty && !await canLeave()) return;
  if (!id) return;
  setBusy(true); clearTimeout(state.poll);
  try {
    const [project, workspace] = await Promise.all([api(`/api/projects/${encodeURIComponent(id)}`), api(`/api/projects/${encodeURIComponent(id)}/script`)]);
    state.project = project; state.selectedId = null; state.kind = 'script'; setWorkspace(workspace); state.error = '';
    localStorage.setItem('ai-drama-studio:last-project', id); history.replaceState(null, '', `/script.html?projectId=${encodeURIComponent(id)}`);
    render(); schedulePoll();
  } catch (error) { failure(error); }
  finally { setBusy(false); }
}
async function saveInput({ quiet = false } = {}) {
  if (!state.ws || state.busy) return false;
  const form = $('#script-input-form'); if (form && !form.reportValidity()) return false;
  setBusy(true);
  try {
    const ws = await api(projectPath(''), { revision: state.ws.revision, input: state.input, binding: { projectId: state.binding.projectId || '', teamId: state.binding.teamId || '' }, spendingLimits: state.limits }, 'PUT');
    setWorkspace(ws, { keepDraft: true }); render(); if (!quiet) toast('剧本输入与绑定已保存'); return true;
  } catch (error) { failure(error); return false; }
  finally { setBusy(false); }
}
async function refreshWorkspace({ project = false, silent = false } = {}) {
  if (!state.project) return;
  const projectId = state.project.id;
  const ws = await api(projectPath(''));
  if (state.project?.id !== projectId) return;
  if (project) {
    const currentProject = await api(`/api/projects/${encodeURIComponent(projectId)}`);
    if (state.project?.id !== projectId) return;
    state.project = currentProject;
  }
  if (state.inputDirty || state.draftDirty) {
    state.tasks = ws.tasks || []; state.reviews = ws.reviews || []; state.tool = ws.tool || state.tool; state.cost = ws.costEstimate || state.cost; state.costs = ws.costEstimates || { script: state.cost };
    state.ws.upstreamStale = ws.upstreamStale;
    state.ws.versions = ws.versions || state.ws.versions;
    const view = $('#script-version-view'); if (view) view.innerHTML = versionView();
    if (project) render(); else renderRuntime();
    if (!silent) toast('运行状态已刷新；未保存的输入和人工稿保留。');
  } else {
    const changed = ws.revision !== state.ws.revision;
    setWorkspace(ws, { keepDraft: true });
    if (changed || project) render(); else { renderRuntime(); const view = $('#script-version-view'); if (view) view.innerHTML = versionView(); }
    if (!silent) toast('状态已刷新');
  }
}
function schedulePoll() {
  clearTimeout(state.poll);
  state.poll = setTimeout(async () => {
    if (state.project && !state.busy) {
      try { await refreshWorkspace({ silent: true }); }
      catch (error) { if (!state.error) failure(new Error(`状态读取失败：${error.message}。已保留当前编辑内容。`)); }
    }
    schedulePoll();
  }, 5000);
}
async function syncInput() {
  if (state.busy) return;
  if (!state.project.creativeBrief) { toast('请先在故事立项保存创作说明。', true); return; }
  if (!await confirmAction('从当前说明重新整理？', '这会替换当前剧本输入，已保存的大纲、剧本与审阅历史都会保留。未保存的人工稿会继续保留在编辑区。', '重新整理输入')) return;
  setBusy(true);
  try { const ws = await api(projectPath('/sync'), { revision: state.ws.revision }); state.project = await api(`/api/projects/${encodeURIComponent(state.project.id)}`); setWorkspace(ws, { keepDraft: true }); render(); toast('已从当前保存的创作说明整理输入'); }
  catch (error) { failure(error); } finally { setBusy(false); }
}
async function verifyBinding() {
  if (state.busy) return;
  if (state.inputDirty && !await saveInput({ quiet: true })) return;
  setBusy(true);
  try { const ws = await api(projectPath('/verify-binding'), { revision: state.ws.revision }); setWorkspace(ws, { keepDraft: true }); render(); toast(ws.binding?.verified ? '已校验真实即梦画布绑定' : '尚未确认绑定，请查看检查结果。', !ws.binding?.verified); }
  catch (error) { failure(error); } finally { setBusy(false); }
}
async function prepare(kind) {
  if (state.busy) return;
  if (state.inputDirty && !await saveInput({ quiet: true })) return;
  setBusy(true);
  try { await api(projectPath('/prepare'), { revision: state.ws.revision, kind }); await refreshWorkspace({ silent: true }); toast(`${labelKind(kind)}任务已准备；没有提交生成。请查看费用状态。`); }
  catch (error) { failure(error); } finally { setBusy(false); }
}
async function taskAction(id, action) {
  if (state.busy) return;
  const task = state.tasks.find(item => item.id === id); if (!task) return;
  if (action === 'submit') {
    if (!task.cost?.canSubmit || task.cost.status === 'unknown') { toast('费用待确认，不能提交生成。', true); return; }
    if (state.inputDirty) { toast('输入尚未保存，请先保存并重新准备任务。', true); return; }
    if (!await confirmAction('确认本次生成费用？', `${task.cost.label || ''}\n${task.cost.basis || ''}\n本次只提交这一条${labelKind(task.kind)}任务；不会生成媒体。`, '确认费用并提交')) return;
  }
  if (action === 'adopt' && state.inputDirty) { toast('输入尚未保存，请先保存后核对候选是否仍有效。', true); return; }
  setBusy(true);
  try {
    const data = action === 'adopt' ? { revision: state.ws.revision } : action === 'submit' ? { confirm: true } : {};
    const result = await api(`/api/script-tasks/${encodeURIComponent(id)}/${action}`, data);
    if (action === 'adopt') { setWorkspace(result, { keepDraft: true }); state.kind = task.kind; state.selectedId = task.kind === 'outline' ? result.activeOutlineId : result.activeScriptId; render(); toast('候选已采用并保存为新版本'); }
    else { await refreshWorkspace({ silent: true }); toast(action === 'query' ? '已查询原任务，没有重新提交' : '已按确认的任务调用即梦，请查看真实状态'); }
  } catch (error) { failure(error); } finally { setBusy(false); }
}
async function chooseKind(kind) {
  if (state.busy || kind === state.kind) return;
  if (state.draftDirty && !await confirmAction('切换稿件类型？', '人工编辑区有未保存内容，切换会放弃这份未保存文字；历史版本保留。', '放弃未保存并切换')) return;
  state.kind = kind; state.selectedId = kind === 'outline' ? state.ws.activeOutlineId : state.ws.activeScriptId;
  if (!state.selectedId) state.selectedId = [...(state.ws.versions || [])].reverse().find(version => version.kind === kind)?.id || null;
  state.draftBody = ''; state.draftDirty = false; state.parentId = null; render();
}
async function chooseVersion(id) {
  if (state.busy) return;
  const version = state.ws.versions.find(version => version.id === id); if (!version) return;
  if (version.kind !== state.kind) {
    if (state.draftDirty && !await confirmAction('切换稿件类型？', '人工编辑区有未保存内容，切换会放弃这份未保存文字；历史版本保留。', '放弃未保存并切换')) return;
    state.draftBody = ''; state.draftDirty = false; state.parentId = null;
  }
    state.kind = version.kind; state.selectedId = id; render();
}
async function editVersion() {
  const version = selected(); if (!version || state.busy) return;
  if (state.draftDirty && !await confirmAction('用查看版本开始编辑？', '这会替换编辑区尚未保存的文字，已保存版本不受影响。', '替换编辑区')) return;
  state.draftBody = version.body; state.parentId = version.id; state.draftDirty = true; render(); $('#script-draft')?.focus();
}
async function outlineToSummary() {
  const version = selected();
  if (state.busy || !version || version.kind !== 'outline') return;
  if (version.body.length > 20000) { toast('这份大纲超过本集梗概20000字上限，请选取所需部分后手动填写。', true); return; }
  if (state.input.current_episode_summary && !await confirmAction('用大纲填入本集梗概？', '这会替换当前本集梗概。请核对大纲是否适用于这一集，再保存输入；大纲版本和人工编辑稿都会保留。', '填入本集梗概')) return;
  state.input.current_episode_summary = version.body; state.inputDirty = true;
  const textarea = $('[data-testid="script-input-summary"]'); if (textarea) textarea.value = version.body;
  dirtyIndicators(); toast('大纲已填入本集梗概，尚未保存。请继续核对人物和本集要求。');
}
async function saveVersion() {
  if (state.busy) return;
  if (!state.draftBody.trim()) { toast('请先输入或导入人工稿。', true); $('#script-draft')?.focus(); return; }
  if (state.inputDirty && !await saveInput({ quiet: true })) return;
  setBusy(true);
  try {
    const ws = await api(projectPath('/versions'), { revision: state.ws.revision, kind: state.kind, body: state.draftBody, parentVersionId: state.parentId || selected()?.id || null });
    setWorkspace(ws); state.selectedId = state.kind === 'outline' ? ws.activeOutlineId : ws.activeScriptId; render(); toast(`人工${labelKind(state.kind)}已保存为新版本，旧稿和旧报告均保留。`);
  } catch (error) { failure(error); } finally { setBusy(false); }
}
async function activateVersion() {
  if (state.busy || !selected()) return;
  if (state.inputDirty && !await saveInput({ quiet: true })) return;
  setBusy(true);
  try { const ws = await api(projectPath('/activate'), { revision: state.ws.revision, versionId: state.selectedId }); setWorkspace(ws, { keepDraft: true }); render(); toast('已切换当前版本；相关旧审阅会重新核对有效性。'); }
  catch (error) { failure(error); } finally { setBusy(false); }
}
async function review() {
  const version = selected();
  if (state.busy || !version || version.kind !== 'script') return;
  if (state.draftDirty) { toast('人工稿尚未保存。请先另存新版本，再审阅该保存版本。', true); return; }
  if (state.inputDirty && !await saveInput({ quiet: true })) return;
  setBusy(true);
  try { await api(projectPath('/reviews'), { revision: state.ws.revision, versionId: version.id }); await refreshWorkspace({ silent: true }); toast('已发起本机 Codex 独立审阅，报告会独立保存。'); }
  catch (error) { failure(error); } finally { setBusy(false); }
}
async function cancelReview(id) {
  if (state.busy) return;
  setBusy(true);
  try { await api(`/api/script-reviews/${encodeURIComponent(id)}/cancel`, {}); await refreshWorkspace({ silent: true }); toast('审阅已取消，已有稿件和历史报告保留。'); }
  catch (error) { failure(error); } finally { setBusy(false); }
}
app.addEventListener('input', event => {
  const el = event.target;
  if (el.dataset.input) { state.input[el.dataset.input] = ['episode_num', 'current_episode'].includes(el.dataset.input) ? Number(el.value) : el.value; state.inputDirty = true; }
  if (el.dataset.binding) { state.binding[el.dataset.binding] = el.value; state.inputDirty = true; }
  if (el.dataset.spend === 'credits') { state.limits.credits = el.value === '' ? null : Number(el.value); state.inputDirty = true; }
  if (el.id === 'script-draft') { state.draftBody = el.value; state.draftDirty = true; }
  dirtyIndicators();
});
app.addEventListener('change', async event => {
  const el = event.target;
  if (el.id === 'script-version-select') await chooseVersion(el.value);
  if (el.id === 'script-import' && el.files?.[0]) {
    const file = el.files[0];
    if (file.size > 1024 * 1024) { toast('导入文本最多 1 MB。', true); return; }
    if (state.draftDirty && !await confirmAction('替换人工编辑区？', '导入会替换尚未保存的文字，已保存版本保留。', '导入文本')) return;
    try { const text = await file.text(); if (text.length > 100000) throw new Error('导入正文不能超过100000字符。'); state.draftBody = text; state.draftDirty = true; state.parentId = selected()?.id || null; render(); toast('文本已导入编辑区，尚未保存。'); }
    catch (error) { failure(error); }
  }
});
app.addEventListener('submit', event => { if (event.target.id === 'script-input-form') { event.preventDefault(); saveInput(); } });
app.addEventListener('click', async event => {
  const link = event.target.closest('[data-project-id]'); if (link) { await loadProject(link.dataset.projectId); return; }
  const kind = event.target.closest('[data-kind]'); if (kind) { await chooseKind(kind.dataset.kind); return; }
  const version = event.target.closest('[data-version-id]'); if (version) { await chooseVersion(version.dataset.versionId); return; }
  for (const [attribute, action] of [['submitTask', 'submit'], ['queryTask', 'query'], ['adoptTask', 'adopt']]) { const target = event.target.closest(`[data-${attribute.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}]`); if (target) { await taskAction(target.dataset[attribute], action); return; } }
  const cancel = event.target.closest('[data-cancel-review]'); if (cancel) { await cancelReview(cancel.dataset.cancelReview); return; }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'return') { event.preventDefault(); if (await canLeave()) location.href = event.target.closest('[data-action]')?.getAttribute('href') || '/'; }
  if (action === 'dismiss-error') { state.error = ''; renderError(); }
  if (action === 'save-input') await saveInput();
  if (action === 'sync') await syncInput();
  if (action === 'verify-binding') await verifyBinding();
  if (action === 'prepare-outline') await prepare('outline');
  if (action === 'prepare-script') await prepare('script');
  if (action === 'edit-version') await editVersion();
  if (action === 'outline-to-summary') await outlineToSummary();
  if (action === 'save-version') await saveVersion();
  if (action === 'activate-version') await activateVersion();
  if (action === 'review') await review();
  if (action === 'reload' && !state.busy) { setBusy(true); try { await refreshWorkspace({ project: true }); } catch (error) { failure(error); } finally { setBusy(false); } }
});
window.addEventListener('beforeunload', event => { if (anyDirty()) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); if (state.draftDirty) saveVersion(); else saveInput(); } });
async function initialize() {
  app.innerHTML = '<div class="script-loading">正在读取本地项目与剧本记录…</div>';
  try {
    const result = await api('/api/projects'); state.projects = result.projects || [];
    const requested = new URL(location.href).searchParams.get('projectId');
    const id = requested || localStorage.getItem('ai-drama-studio:last-project') || state.projects[0]?.id;
    render(); if (id && state.projects.some(project => project.id === id)) await loadProject(id, { bypassDirty: true });
  } catch (error) { render(); failure(error); }
}
initialize();
