import { studioConfig } from './studio-config.js';
import { t, preferences, translateInterface } from './studio-i18n.js';
import { mountCreativeAssistant } from './creative-assistant.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const states = new WeakMap(), workflowCache = new Map();
let preferenceRead;
function syncPreferences(frame,title){preferenceRead??=fetch('/api/studio/preferences').then(async response=>{if(!response.ok)return;const value=await response.json();preferences({language:value.language?.startsWith('en')?'en':'zh',theme:value.theme});}).catch(()=>{});void preferenceRead.then(()=>{if(frame.isConnected){translateInterface(frame);document.title=studioConfig.name+' · '+t(title);}});}
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
  const pid = options.project?.id, step = options.step, section = options.section;
  const url = (page) => studioHref('/studio.html?page='+page,pid);
  const current = options.studioPage ?? (section === 'style' ? 'directors' : section === 'entities' ? 'entities' : section === 'settings' ? 'services' : null);
  const agents = [
    ['script','剧本','/creative.html?stage=script','script'],
    ['entities','角色与场景',url('entities'),'images'],
    ['storyboard','分镜拆解','/creative.html?stage=storyboard','storyboard'],
    ['prompts','提示词',url('prompts'),'video'],
    ['voice','配音与声音',url('voice'),'finishing'],
    ['editing','剪辑与导出（剪映）',url('editing'),'export']
  ];
  const isAgent = !['services','general','style','directors','storage'].includes(current);
  return '<aside class="studio-panel" aria-label="'+t('Agent配置')+'"><a class="studio-product-name" href="/" data-leave><img src="/studio-mark.svg" alt="">'+escape(studioConfig.brand??studioConfig.name)+'</a><nav class="studio-primary-nav" aria-label="应用导航">'+
    [['services','AI服务配置','settings'],['general','通用','panel'],['style','风格预设','image'],['directors','导演风格预设','film']].map(([id,label,icon]) => '<a class="studio-nav-item '+(current === id ? 'is-active':'')+'" href="'+escape(url(id))+'" data-leave data-primary-nav="'+id+'">'+studioIcon(icon)+'<span>'+t(label)+'</span></a>').join('')+
    '<details class="studio-agent-group" open><summary class="studio-nav-item '+(isAgent ? 'is-current':'')+'" data-primary-nav="agents">'+studioIcon('database')+'<span>'+t('Agent配置')+'</span>'+studioIcon('down')+'</summary><nav class="studio-agent-nav" aria-label="Agents">'+agents.map(([id,label,href,legacyStep])=>'<a class="studio-nav-item '+((current === id || !current && (step === legacyStep || id === 'script' && step === 'story')) ? 'is-active':'')+'" href="'+escape(studioHref(href,pid))+'" data-leave data-agent-nav="'+id+'" data-studio-agent="'+id+'" data-studio-step="'+legacyStep+'"><span class="studio-agent-branch"></span><span class="studio-step-label">'+t(label)+'</span><span class="studio-step-status" data-step-status></span></a>').join('')+'</nav></details><a class="studio-nav-item '+(current === 'storage' ? 'is-active':'')+'" href="'+escape(url('storage'))+'" data-leave data-primary-nav="storage">'+studioIcon('home')+'<span>'+t('存储位置')+'</span></a></nav><a class="studio-nav-item studio-panel-bottom" href="'+escape(studioHref('/resources.html?section=budget',pid))+'" data-leave>'+studioIcon('settings')+'<span>'+t('项目设置')+'</span></a></aside>';
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
    const agent = value?.agents?.find(item=>item.id===link.dataset.studioAgent);
    const record = agent ?? statuses.get(link.dataset.studioStep), status = labels[record?.status] ? record.status : 'pending';
    link.dataset.status = status; link.querySelector('[data-step-status]').textContent = t(labels[status]);
    const complete = ['completed', 'complete'].includes(status), review = ['needs_review', 'stale'].includes(status);
    if (link.querySelector('[data-step-dot]')) link.querySelector('[data-step-dot]').innerHTML = complete ? studioIcon('check') : review ? '!' : '';
    link.title = `${link.querySelector('.studio-step-label').textContent}：${labels[status]}${record?.reason ? `；${record.reason}` : ''}`;
  }
  const thumbnail = safeImage(value?.thumbnailUrl ?? value?.project?.thumbnailUrl);
  if (thumbnail) { const holder = state.frame.querySelector('[data-studio-thumbnail]'); if (holder && !holder.querySelector('img')) holder.innerHTML = `<img src="${escape(thumbnail)}" alt="当前项目已保存素材">`; }
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
function retireLegacyInputs(state) {
  if (!['/script.html','/video.html','/canvas-video.html'].includes(location.pathname)) return;
  for (const node of state.content.querySelectorAll('[data-testid="canvas-prepare"],[data-testid="canvas-submit"],[data-testid="canvas-redo"],[data-testid="video-prepare"],[data-testid="video-submit"],[data-redo],[data-action="prepare-outline"],[data-action="prepare-script"],[data-task-action="submit"],[data-testid="video-model"],#script-model')) {
    if (!node.disabled) node.disabled = true;
    node.title = t('即梦已退出新任务；此页仅保留历史查询、下载和人工版本。');
  }
}
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
  const previous = states.get(container); previous?.observer?.disconnect(); previous?.assistant?.destroy();
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
  if (['/script.html','/video.html','/canvas-video.html'].includes(location.pathname) && !contentNode.querySelector('[data-legacy-retired]')) { const notice=document.createElement('div');notice.className='warning-box';notice.dataset.legacyRetired='';notice.textContent=t('即梦已退出新任务；此页仅保留历史查询、下载和人工版本。');contentNode.querySelector('.page-heading')?.after(notice); }
  for (const duplicate of contentNode.querySelectorAll('.workflow,.creative-route,.video-route,.canvas-stage,.timeline-route')) duplicate.remove();
  const frame = document.createElement('div'); frame.className = 'studio-frame';
  if (matchMedia('(max-width: 900px)').matches) frame.classList.add('studio-panel-collapsed');
  const current = initialStep(options.step), title = options.title ?? (options.section ? studioConfig.resources.find(item => item.id === options.section)?.label : current.label) ?? current.label;
  frame.innerHTML = `${projectPanel(options)}<header class="studio-header"><button class="ghost-button studio-mobile-menu" data-studio-toggle-panel aria-label="导航" aria-expanded="false">☰</button><div class="studio-breadcrumb"><a href="/" data-leave>故事与需求</a><span>›</span><span class="studio-breadcrumb-project">${escape(options.project?.name ?? '新项目')}</span><span>›</span><strong>${escape(title)}</strong></div><div class="studio-header-actions"><details class="studio-top-projects"><summary>${escape(options.project?.name ?? t("切换项目"))}${options.project ? `<small class="studio-project-facts">${escape(options.project.durationSeconds)}${t('秒')} · ${escape(options.project.aspectRatio)}</small>` : ""}</summary><div class="studio-project-options">${projectList(options)}</div></details><a class="studio-new-link" href="/?new=1" data-leave>${studioIcon("plus")}${t("新建项目")}</a></div></header><main class="studio-main main" aria-label="${escape(title)}工作区"></main><footer class="studio-footer"><div class="studio-footer-secondary">${actionMarkup(options.secondary, false)}</div><div class="studio-footer-next"><span data-studio-message>${escape(options.nextText ?? '完成当前内容后，继续下一步。')}</span>${actionMarkup(options.primary, true)}</div></footer>`;
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
  state.observer = new MutationObserver(() => { syncActions(state); translateInterface(contentNode); }); state.observer.observe(contentNode, { attributes: true, attributeFilter: ['disabled', 'aria-disabled'], childList: true, subtree: true }); if (oldActions) state.observer.observe(oldActions, { attributes: true, attributeFilter: ['disabled', 'aria-disabled'], childList: true, subtree: true });
  document.title = `${studioConfig.name} · ${title}`;
  syncActions(state); void loadWorkflow(state); translateInterface(frame);syncPreferences(frame,title);
  setTimeout(() => {
    if (!frame.isConnected || frame.querySelector('.creative-assistant')) return;
    const types = {entities:'entity',prompts:'prompt',voice:'voice',editing:'editing',style:'settings',directors:'settings',services:'settings',general:'settings',storage:'settings'};
    const targetType = options.assistantTargetType ?? types[options.studioPage] ?? (options.step === 'storyboard' ? 'storyboard' : options.step === 'finishing' || options.step === 'export' ? 'editing' : options.step === 'images' || options.step === 'video' ? 'prompt' : 'settings');
    const apiPath = options.project?.id ? '/api/projects/'+encodeURIComponent(options.project.id)+'/studio-assistant' : '/api/studio/assistant';
    state.assistant = mountCreativeAssistant({container:frame,projectId:options.project?.id ?? 'global',apiPath,targetType,targetId:options.assistantTargetId,contextLabel:options.assistantContextLabel??title,getContext:async()=>{await options.beforeAssistantContext?.();const response=await fetch(apiPath+'?'+new URLSearchParams({targetType,...(options.assistantTargetId?{targetId:options.assistantTargetId}:{})}));const result=await response.json();if(!response.ok)throw new Error(result.error ?? 'Context unavailable'); return {projectId:options.project?.id,targetType,targetId:result.target?.id,targetHash:result.target?.hash,selectedText:window.getSelection()?.toString() ?? ''};},onApplied:()=>location.reload()});
    translateInterface(frame);
  },0);
  return { refreshWorkflow: () => loadWorkflow(state, true), syncActions: () => syncActions(state) };
}
