import { studioConfig } from './studio-config.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const states = new WeakMap(), workflowCache = new Map();
const icons = {
  film: '<path d="m3 6 16-4 2 5-16 4-2-5ZM4 10v11h16V7M7 5l3 4m3-6 3 4M10 13l5 3-5 3v-6Z"/>',
  home: '<path d="m3 11 9-8 9 8M5 9v12h5v-7h4v7h5V9"/>',
  play: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 7 7 5-7 5V7Z"/>',
  people: '<path d="M4 21v-3a6 6 0 0 1 12 0v3M17 4a4 4 0 0 1 0 8m1 3a6 6 0 0 1 3 5"/><circle cx="10" cy="6" r="4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m4 18 5-5 4 3 4-6 4 5"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  settings: '<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3H9Z"/><circle cx="12" cy="12" r="3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  ratio: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M6 8h3M6 8v3m12 5h-3m3 0v-3"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
export const studioIcon = name => `<svg class="studio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.film}</svg>`;
export function studioHref(href, projectId) { const url = new URL(href, location.origin); if (projectId) url.searchParams.set('projectId', projectId); return url.pathname + url.search + url.hash; }
export function invalidateStudioWorkflow(projectId) { if (projectId) workflowCache.delete(projectId); else workflowCache.clear(); }

function safeImage(value) { if (typeof value !== 'string') return null; try { const url = new URL(value, location.origin); return url.origin === location.origin && url.pathname.startsWith('/api/') ? url.pathname + url.search : null; } catch { return null; } }
function initialStep(step) { return studioConfig.steps.find(item => item.id === step) ?? studioConfig.steps[0]; }
function projectList(options) {
  const attribute = /^data-[a-z-]+$/.test(options.projectAttribute ?? '') ? options.projectAttribute : 'data-project-id';
  return (options.projects ?? []).map(project => `<button type="button" class="studio-project-option ${project.id === options.project?.id ? 'is-current' : ''}" ${attribute}="${escape(project.id)}" title="${escape(project.name)}"><span>${escape(project.name)}</span><small>${escape(project.durationSeconds)}秒 · ${escape(project.aspectRatio)}</small></button>`).join('') || '<p class="studio-empty-small">尚无项目，请先创建故事。</p>';
}
function projectPanel(options) {
  const project = options.project, current = initialStep(options.step), pid = project?.id;
  const thumbnail = safeImage(options.thumbnailUrl ?? options.workflow?.thumbnailUrl);
  return `<aside class="studio-panel" aria-label="项目与制作流程"><div class="studio-product-name">${escape(studioConfig.name)}</div><section class="studio-project-summary"><div class="studio-project-thumbnail" data-studio-thumbnail>${thumbnail ? `<img src="${escape(thumbnail)}" alt="当前项目已保存素材">` : studioIcon('film')}</div><div class="studio-project-copy"><strong title="${escape(project?.name ?? '选择或创建项目')}">${escape(project?.name ?? '选择或创建项目')}</strong><div class="studio-project-facts">${project ? `<span>${studioIcon('clock')}${escape(project.durationSeconds)}秒</span><span>${studioIcon('ratio')}${escape(project.aspectRatio)}</span>` : '<span>从一个故事开始</span>'}</div></div></section><details class="studio-project-picker"><summary>切换项目 ${studioIcon('down')}</summary><div class="studio-project-options">${projectList(options)}<a class="studio-new-project" href="/?new=1" data-leave>${studioIcon('plus')}新建项目</a></div></details><nav class="studio-steps" aria-label="七步制作流程">${studioConfig.steps.map((step, index) => `<a class="studio-step ${step.id === current.id ? 'is-active' : ''}" href="${escape(studioHref(step.href, pid))}" data-leave data-studio-step="${step.id}" ${step.id === current.id ? 'aria-current="step"' : ''} title="${escape(step.label)}：状态待核对"><span class="studio-step-dot" data-step-dot></span><span class="studio-step-label">${step.label}</span><span class="studio-step-status" data-step-status>待处理</span></a>`).join('')}</nav><nav class="studio-resources" aria-label="项目资源">${studioConfig.resources.map(item => `<a class="studio-resource ${options.section === item.id ? 'is-active' : ''}" href="${escape(studioHref(`/resources.html?section=${item.id}`, pid))}" data-leave>${studioIcon(item.icon)}<span>${item.label}</span></a>`).join('')}</nav><div class="studio-panel-bottom">项目保存在本机</div></aside>`;
}
function rail(options) {
  const pid = options.project?.id;
  return `<aside class="studio-rail" aria-label="应用导航"><a class="studio-rail-logo" href="/" data-leave title="${escape(studioConfig.name)}">${studioIcon('film')}</a><div class="studio-rail-links"><a class="studio-rail-link" href="/" data-leave title="项目与故事" aria-label="项目与故事">${studioIcon('home')}</a><button type="button" class="studio-rail-link is-active" data-studio-toggle-panel title="显示或收起项目面板" aria-label="显示或收起项目面板" aria-expanded="true">${studioIcon('play')}</button>${studioConfig.resources.map(item => `<a class="studio-rail-link ${options.section === item.id ? 'is-active' : ''}" href="${escape(studioHref(`/resources.html?section=${item.id}`, pid))}" data-leave title="${item.label}" aria-label="${item.label}">${studioIcon(item.icon)}</a>`).join('')}</div></aside>`;
}
function actionMarkup(action, primary) {
  if (!action) return '';
  const disabled = action.disabled === true;
  return `<button type="button" class="${primary ? 'primary-button studio-primary' : 'secondary-button'}" data-studio-action="${primary ? 'primary' : 'secondary'}" ${disabled ? 'disabled' : ''} title="${escape(action.reason ?? '')}"><span>${escape(action.label ?? '继续')}</span>${primary ? studioIcon('arrow') : ''}</button>`;
}
function normalizeStatuses(value) {
  const raw = value?.steps ?? value?.statuses ?? [];
  const entries = Array.isArray(raw) ? raw.map(item => [item.id ?? item.step, item]) : Object.entries(raw).map(([id, item]) => [id, typeof item === 'string' ? { status: item } : item]);
  return new Map(entries);
}
function applyWorkflow(state, value) {
  if (states.get(state.container) !== state) return;
  const statuses = normalizeStatuses(value), labels = { completed: '已完成', complete: '已完成', in_progress: '进行中', active: '进行中', pending: '待处理', needs_review: '需复核', stale: '需复核', blocked: '待处理', failed: '待处理' };
  for (const link of state.frame.querySelectorAll('[data-studio-step]')) {
    const record = statuses.get(link.dataset.studioStep), status = labels[record?.status] ? record.status : 'pending';
    link.dataset.status = status; link.querySelector('[data-step-status]').textContent = labels[status];
    const complete = ['completed', 'complete'].includes(status), review = ['needs_review', 'stale'].includes(status);
    link.querySelector('[data-step-dot]').innerHTML = complete ? studioIcon('check') : review ? '!' : '';
    link.title = `${link.querySelector('.studio-step-label').textContent}：${labels[status]}${record?.reason ? `；${record.reason}` : ''}`;
  }
  const thumbnail = safeImage(value?.thumbnailUrl ?? value?.project?.thumbnailUrl);
  if (thumbnail) { const holder = state.frame.querySelector('[data-studio-thumbnail]'); if (!holder.querySelector('img')) holder.innerHTML = `<img src="${escape(thumbnail)}" alt="当前项目已保存素材">`; }
}
async function loadWorkflow(state, refresh = false) {
  const id = state.options.project?.id; if (!id) return;
  if (state.options.workflow) { applyWorkflow(state, state.options.workflow); return; }
  const fetchCurrent = () => {
    const entry = { pending: null, queued: null };
    entry.pending = fetch(`/api/projects/${encodeURIComponent(id)}/workflow`, { signal: AbortSignal.timeout(15000) }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error ?? '流程状态暂不可用'); return value; }).finally(() => { if (workflowCache.get(id) === entry) entry.pending = null; });
    workflowCache.set(id, entry); return entry.pending;
  };
  const existing = workflowCache.get(id);
  // A render can follow a save while an older read is in flight. Queue one
  // fresh read rather than showing that pre-save snapshot as current status.
  let requested;
  if (existing?.pending) { existing.queued ??= existing.pending.catch(() => null).then(fetchCurrent); requested = existing.queued; }
  else requested = fetchCurrent();
  try { applyWorkflow(state, await requested); } catch (error) { if (states.get(state.container) === state) for (const node of state.frame.querySelectorAll('[data-studio-step]')) node.title = `状态尚未核实：${error.message}。项目及原任务未改变。`; }
}
function findTarget(state, action) { if (!action?.selector) return null; try { return state.content.querySelector(action.selector) ?? state.actions?.querySelector(action.selector) ?? state.container.querySelector(action.selector); } catch { return null; } }
function syncActions(state) {
  if (states.get(state.container) !== state) return;
  for (const kind of ['primary', 'secondary']) {
    const action = state.options[kind], button = state.frame.querySelector(`[data-studio-action="${kind}"]`); if (!button || !action) continue;
    const target = findTarget(state, action), disabled = action.disabled === true || state.waiting || Boolean(action.selector && (!target || target.disabled || target.getAttribute('aria-disabled') === 'true'));
    button.disabled = disabled; button.title = action.reason ?? target?.title ?? (disabled && action.selector && !target ? '当前操作尚不可用，请先完成本页输入。' : '');
  }
}
export function mountStudio(container, options = {}) {
  if (!container) return;
  const previous = states.get(container); previous?.observer?.disconnect();
  document.body.classList.add('studio-ui'); container.classList.add('studio-mounted');
  const originalMain = container.querySelector('.main') ?? container.querySelector('.channel-main') ?? container;
  const content = originalMain.querySelector(':scope > .content') ?? container.querySelector('.content');
  if (!content) return;
  const previousScroll = originalMain.classList.contains('studio-main') ? originalMain.scrollTop : 0;
  const focused = content.contains(document.activeElement) ? document.activeElement : null;
  const selection = focused && typeof focused.selectionStart === 'number' ? { start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection } : null;
  const topbar = originalMain.querySelector(':scope > .topbar');
  let oldActions = topbar ? topbar.querySelector('.top-actions') : previous?.actions;
  if (topbar) {
    const looseActions = [...topbar.querySelectorAll('button,a')].filter(node => !oldActions?.contains(node) && !node.closest('.breadcrumb,.studio-breadcrumb'));
    if (looseActions.length) {
      oldActions ??= document.createElement('div'); oldActions.classList.add('top-actions');
      for (const node of looseActions) oldActions.append(node);
    }
  }
  const contentNode = content; contentNode.classList.add('studio-content');
  for (const duplicate of contentNode.querySelectorAll('.workflow,.creative-route,.video-route,.canvas-stage,.timeline-route')) duplicate.remove();
  const frame = document.createElement('div'); frame.className = 'studio-frame';
  if (matchMedia('(max-width: 900px)').matches) frame.classList.add('studio-panel-collapsed');
  const current = initialStep(options.step), title = options.title ?? (options.section ? studioConfig.resources.find(item => item.id === options.section)?.label : current.label) ?? current.label;
  frame.innerHTML = `${rail(options)}${projectPanel(options)}<header class="studio-header"><div class="studio-breadcrumb"><a href="/" data-leave>项目</a><span>›</span><span class="studio-breadcrumb-project">${escape(options.project?.name ?? '新项目')}</span><span>›</span><strong>${escape(title)}</strong></div><div class="studio-header-actions"></div></header><main class="studio-main main" aria-label="${escape(title)}工作区"></main><footer class="studio-footer"><div class="studio-footer-secondary">${actionMarkup(options.secondary, false)}</div><div class="studio-footer-next"><span data-studio-message>${escape(options.nextText ?? '完成当前内容后，继续下一步。')}</span>${actionMarkup(options.primary, true)}</div></footer>`;
  frame.querySelector('.studio-main').append(contentNode);
  if (oldActions?.children.length) { const details = document.createElement('details'); details.className = 'studio-more-actions'; details.innerHTML = `<summary title="更多操作" aria-label="更多操作">${studioIcon('more')}</summary>`; oldActions.classList.add('studio-original-actions'); details.append(oldActions); frame.querySelector('.studio-header-actions').append(details); }
  container.replaceChildren(frame);
  const newMain = frame.querySelector('.studio-main'); newMain.scrollTop = previousScroll;
  if (focused?.isConnected) { focused.focus({ preventScroll: true }); if (selection) focused.setSelectionRange(selection.start, selection.end, selection.direction); }
  const state = { container, frame, content: contentNode, actions: oldActions, options, waiting: false, observer: null }; states.set(container, state);
  frame.querySelector('[data-studio-toggle-panel]').setAttribute('aria-expanded', String(!frame.classList.contains('studio-panel-collapsed')));
  frame.querySelector('[data-studio-toggle-panel]').addEventListener('click', event => { event.stopPropagation(); const collapsed = frame.classList.toggle('studio-panel-collapsed'); event.currentTarget.setAttribute('aria-expanded', String(!collapsed)); });
  for (const button of frame.querySelectorAll('[data-studio-action]')) button.addEventListener('click', async event => {
    event.stopPropagation(); const action = options[event.currentTarget.dataset.studioAction]; if (!action || event.currentTarget.disabled) return;
    if (action.onClick) { state.waiting = true; syncActions(state); try { await action.onClick(); } catch (error) { const message = state.frame.querySelector('[data-studio-message]'); if (message) { message.textContent = error.message ?? '操作未完成，请检查当前输入。'; message.setAttribute('role', 'alert'); } } finally { state.waiting = false; syncActions(state); } }
    else if (action.selector) { const target = findTarget(state, action); if (target && !target.disabled) target.click(); }
    else if (action.href) { const anchor = document.createElement('a'); anchor.href = studioHref(action.href, options.project?.id); anchor.dataset.leave = ''; anchor.hidden = true; state.content.append(anchor); anchor.click(); anchor.remove(); }
  });
  state.observer = new MutationObserver(() => syncActions(state)); state.observer.observe(contentNode, { attributes: true, attributeFilter: ['disabled', 'aria-disabled'], childList: true, subtree: true }); if (oldActions) state.observer.observe(oldActions, { attributes: true, attributeFilter: ['disabled', 'aria-disabled'], childList: true, subtree: true });
  document.title = `${studioConfig.name} · ${title}`;
  syncActions(state); void loadWorkflow(state);
  return { refreshWorkflow: () => loadWorkflow(state, true), syncActions: () => syncActions(state) };
}
