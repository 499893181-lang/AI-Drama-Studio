import { mountStudio, studioHref, invalidateStudioWorkflow } from './studio-shell.js';
import { studioConfig } from './studio-config.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const pretty = value => esc(JSON.stringify(value, null, 2));
const app = document.querySelector('#resources-app'), params = new URLSearchParams(location.search);
const section = studioConfig.resources.some(item => item.id === params.get('section')) ? params.get('section') : 'entities';
const state = { projects: [], project: null, creative: null, images: null, canvas: null, catalog: null, chosenStyle: null, error: '', busy: false, dirty: false };
async function api(url, body, method = 'POST') { const response = await fetch(url, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const value = await response.json(); if (!response.ok) throw new Error(value.error ?? '本地资源读取失败'); return value; }
function message(text, error = false) { const node = document.querySelector('#toast'); node.textContent = text; node.className = `visible${error ? ' error' : ''}`; clearTimeout(message.timer); message.timer = setTimeout(() => { node.className = ''; }, 6000); }
async function load(id) {
  state.busy = true;
  try {
    state.project = await api(`/api/projects/${encodeURIComponent(id)}`);
    const values = await Promise.allSettled([api(`/api/projects/${id}/creative`), api(`/api/projects/${id}/images`), api(`/api/projects/${id}/canvas-video`), api('/api/creative/knowledge')]);
    for (const [index, key] of ['creative', 'images', 'canvas', 'catalog'].entries()) state[key] = values[index].status === 'fulfilled' ? values[index].value : null;
    state.error = values.filter(item => item.status === 'rejected').map(item => item.reason.message).join('；'); state.chosenStyle = state.creative?.stylePresetId; state.dirty = false;
    localStorage.setItem('ai-drama-studio:last-project', id); history.replaceState(null, '', studioHref(`/resources.html?section=${section}`, id));
  } finally { state.busy = false; render(); }
}
function entityContent() {
  const entities = (state.creative?.effectiveEntities ?? []).filter(item => ['character', 'scene', 'prop'].includes(item.type));
  return `<p class="resource-meta">来自当前剧本与分镜的真实设定。修改人物或场景会沿现有规则使相关分镜、图片和视频需要复核。</p><div class="resource-list">${entities.map(entity => { const reference = state.images?.assets?.find(asset => asset.targetId === entity.id && asset.selected && !asset.stale && asset.state === 'selected' && asset.reviewCurrent && asset.review?.verdict === 'accepted' && asset.fileStatus === 'intact'); return `<article class="resource-item"><h2>${esc(({character:'角色',scene:'场景',prop:'道具'})[entity.type])} · ${esc(entity.id)}</h2>${reference?.url ? `<img src="${esc(reference.url)}" alt="当前${esc(entity.id)}参考图">` : '<p class="resource-meta">尚无当前有效选用参考图</p>'}<p>${esc(entity.description)}</p><span class="resource-badge">版本 ${esc(entity.version)}</span><p class="resource-meta">来源：${esc(entity.resolvedSource ?? entity.source ?? '待确认')}；${reference ? '参考图已按当前版本选用' : '参考图尚待制作、导入或重新检查'}</p><details><summary>来源与版本记录</summary><pre class="resource-pre">${pretty(entity)}</pre></details></article>`; }).join('') || '<div class="resource-empty">尚无角色或场景设定。先保存剧本，或在创作工作台编辑当前实体。</div>'}</div><p><a class="secondary-button" href="${studioHref('/images.html', state.project?.id)}" data-leave>管理角色与场景参考图</a></p>`;
}
function styleContent() {
  const presets = state.catalog?.presets ?? [], directors = state.catalog?.directors ?? [], preset = presets.find(item => item.id === state.chosenStyle) ?? presets[0];
  return `<p class="resource-meta">${directors.length}位导演、${presets.length}个作品级预设。这里展示规则来源；选择预设不代表已经生成或通过画面验收。</p><div class="resource-toolbar"><label for="resource-preset">作品级预设<select id="resource-preset" data-testid="resource-preset">${presets.map(item => `<option value="${esc(item.id)}" ${item.id === preset?.id ? 'selected' : ''}>${esc(item.directorName)} · ${esc(item.label)}</option>`).join('')}</select></label></div>${preset ? `<section class="resource-panel"><h2>${esc(preset.directorName)} · ${esc(preset.label)}</h2><p>${esc((preset.referenceWorks ?? []).map(item => typeof item === 'string' ? item : item.title ?? item.name).filter(Boolean).join('、'))}</p><p>适用边界：${esc((preset.pitfalls ?? []).join('；') || '使用前核对当前场景；不是导演通用公式。')}</p><details open><summary>规则与来源</summary>${Object.entries(preset.rules ?? {}).map(([kind, rules]) => `<h3>${esc(({narrative:'叙事',still_image:'静态画面',motion:'动态摄影',editing:'后期剪辑'})[kind] ?? kind)}</h3><ul class="resource-rules">${rules.map(rule => `<li>${esc(rule.text)}<div class="resource-meta">${esc(rule.id)} · ${esc((rule.source_ids ?? preset.sourceIds ?? []).join(' / '))}</div></li>`).join('')}</ul>`).join('')}</details><p class="resource-meta">应用会保存当前风格，并清空不属于新导演的手册勾选；相关旧结果将按真实Hash标记需复核。</p></section>` : '<div class="resource-empty">风格规则暂未加载，请刷新本地状态。</div>'}`;
}
function budgetContent() {
  const tasks = state.canvas?.tasks ?? [], task = tasks[0], quote = task?.quote;
  return `<div class="resource-grid"><section class="resource-panel"><h2>项目预算计划</h2><label for="resource-budget">人民币预算上限（元）<input id="resource-budget" data-testid="resource-budget" type="number" min="0" step="0.01" value="${esc(state.project?.budgetCap ?? '')}" placeholder="尚未设置"></label><p>这是制作计划，不是工具报价，不会限制Codex账号额度，也不与积分换算。修改后请复核下游输入。</p></section><section class="resource-panel"><h2>已保存的视频费用依据</h2>${quote ? `<p><strong>${quote.amount == null ? '费用待确认' : `${esc(quote.amount)}积分 · 最大预估`}</strong></p><p>仅限任务 ${esc(task.id)} 对应画布、节点和参数。</p><p class="resource-meta">检查时间：${esc(quote.checkedAt ?? '未返回')}<br>有效期：${esc(quote.expiresAt ?? '未返回，不推算')}<br>实际扣费：${esc(task.cost?.actualAmount ?? '未返回')}</p>` : '<p>当前项目没有已保存的同节点视频报价。费用未知，不显示为免费。</p>'}<p>70积分是首次测试的预估批准阈值，不是结算或平台绝对扣费上限。余额不是报价；人民币与积分分别记录。</p><a class="secondary-button" href="${studioHref('/canvas-video.html', state.project?.id)}" data-leave>查看具体镜头费用与授权</a></section></div>`;
}
function settingsContent() { return `<section class="resource-panel"><h2>${esc(studioConfig.name)} · 本机工作台</h2><p>项目、不可变版本与任务记录保存在原本机数据目录；刷新与重启不重置任务。认证和签名材料不会随界面改版复制或上传。</p><p>自动出图继续关闭；视频真实执行必须有具体任务的本机签名批准。当前未接通自动配音、字幕编辑和完整正式四岗位验证，不能显示成已完成。</p><div class="resource-toolbar"><a class="secondary-button" href="${studioHref('/video-channel.html', state.project?.id)}" data-leave>查看渠道诊断记录</a><a class="secondary-button" href="${studioHref('/script.html', state.project?.id)}" data-leave>可选即梦剧本渠道</a><a class="secondary-button" href="${studioHref('/video.html', state.project?.id)}" data-leave>直连视频渠道</a></div><details><summary>关于名称与界面</summary><p>软件名称集中在studio-config.js配置；页面共用蓝白设计变量、系统中文无衬线字体和完整双层左侧导航。</p></details></section>`; }
function render() {
  const title = studioConfig.resources.find(item => item.id === section)?.label ?? '项目资源';
  app.innerHTML = `<main class="main"><div class="content"><div class="page-heading"><div><h1>${esc(title)}</h1><p>查看和管理当前项目的${esc(title)}，所有设置与真实项目绑定。</p></div></div>${state.error ? `<div class="resource-error" role="alert">${esc(state.error)}</div>` : ''}${state.project ? ({entities:entityContent,style:styleContent,budget:budgetContent,settings:settingsContent}[section])() : '<div class="resource-empty">选择已有项目，或先新建一个故事。</div>'}</div></main>`;
  let primary = { label: '返回创作', href: studioHref('/creative.html?stage=script', state.project?.id) };
  if (section === 'entities') primary = { label: '编辑角色与场景', href: studioHref('/creative.html?stage=script&section=entities', state.project?.id), disabled: !state.project };
  if (section === 'style') primary = { label: '应用到当前工作台', disabled: !state.project || state.busy || !state.chosenStyle, onClick: saveStyle };
  if (section === 'budget') primary = { label: '保存预算计划', disabled: !state.project || state.busy, onClick: saveBudget };
  mountStudio(app, { section, step: 'storyboard', title, project: state.project, projects: state.projects, primary, secondary: { label: '返回分镜', href: studioHref('/creative.html?stage=storyboard', state.project?.id) }, nextText: section === 'style' || section === 'budget' ? '修改后按当前输入与版本重新核对后续结果。' : '项目资源共用同一套设定和版本，不在这里伪造生成结果。' });
}
function lockInputs(value) { state.busy = value; for (const node of app.querySelectorAll('input,select')) node.disabled = value; }
async function saveStyle() {
  if (!state.project || !state.creative) return;
  const preset = state.catalog?.presets?.find(item => item.id === state.chosenStyle), director = state.catalog?.directors?.find(item => item.id === preset?.directorId);
  const allowed = new Set((preset?.manualDerivedRules ?? director?.manual_derived_rules ?? []).map(rule => rule.id));
  const manualRuleIds = state.chosenStyle === state.creative.stylePresetId ? state.creative.manualRuleIds : (state.creative.manualRuleIds ?? []).filter(id => allowed.has(id));
  lockInputs(true);
  try { state.creative = await api(`/api/projects/${state.project.id}/creative`, { revision: state.creative.revision, stylePresetId: state.chosenStyle, manualRuleIds }, 'PUT'); state.dirty = false; invalidateStudioWorkflow(state.project.id); lockInputs(false); render(); message('风格已保存；相关旧结果需要按当前输入复核。'); }
  finally { lockInputs(false); }
}
async function saveBudget() {
  const input = document.querySelector('#resource-budget'), value = input.value;
  if (!input.validity.valid || value.trim() && (!Number.isFinite(Number(value)) || Number(value) < 0)) throw new Error('预算须为非负有限金额，或留空表示未设置。');
  lockInputs(true);
  try { state.project = await api(`/api/projects/${state.project.id}`, { revision: state.project.revision, budgetCap: value.trim() ? Number(value) : null }, 'PUT'); state.dirty = false; invalidateStudioWorkflow(state.project.id); lockInputs(false); render(); message('预算计划已保存，没有提交任何收费任务。'); }
  finally { lockInputs(false); }
}
app.addEventListener('change', event => { if (event.target.id === 'resource-preset') { state.chosenStyle = event.target.value; state.dirty = true; render(); } });
app.addEventListener('input', event => { if (event.target.id === 'resource-budget') state.dirty = true; });
app.addEventListener('click', event => { const button = event.target.closest('[data-project-id]'); if (button && !state.busy && button.dataset.projectId !== state.project?.id) { if (state.dirty && !window.confirm('当前资源编辑尚未保存，切换项目并放弃本页修改？')) return; load(button.dataset.projectId).catch(error => { state.error = error.message; render(); }); } });
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
async function start() { const list = await api('/api/projects'); state.projects = list.projects ?? []; const requested = params.get('projectId') ?? localStorage.getItem('ai-drama-studio:last-project'); const project = state.projects.find(item => item.id === requested) ?? state.projects[0]; if (project) await load(project.id); else render(); }
start().catch(error => { state.error = error.message; render(); });
