// Conversation is stored by the local application per project. A response is
// never an edit until the user explicitly applies a snapshot-bound proposal.
const instances = new WeakMap(), projectViews = new Map();
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
const running = new Set(['queued', 'running']);
const statuses = { queued:'等待启动', running:'Codex 正在思考', succeeded:'回复已保存', failed:'本次对话失败', interrupted:'上次等待已中断', cancelled:'已取消本地等待' };
function ensureStyles() { if (document.querySelector('[data-creative-assistant-style]')) return; const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/creative-assistant.css'; link.dataset.creativeAssistantStyle = ''; document.head.append(link); }
function token() { return globalThis.crypto?.randomUUID?.() ?? `assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function splitText(value, lineChars, maxLines) {
  const pages = [], lines = String(value ?? '').split('\n'), limit = Math.max(1, maxLines); let parts = [], used = 0;
  for (const line of lines) {
    const characters = Array.from(line), chunks = [];
    if (!characters.length) chunks.push('');
    for (let offset = 0; offset < characters.length; offset += lineChars) chunks.push(characters.slice(offset, offset + lineChars).join(''));
    for (const chunk of chunks) { if (used >= limit) { pages.push(parts.join('\n')); parts = []; used = 0; } parts.push(chunk); used++; }
  }
  if (parts.length || !pages.length) pages.push(parts.join('\n'));
  return pages;
}
export function mountCreativeAssistant({ container, projectId, getContext, onApplied }) {
  if (!container || !projectId) return { destroy() {}, refresh: async () => {} };
  instances.get(container)?.destroy(); ensureStyles();
  const view = projectViews.get(projectId) ?? { open: matchMedia('(min-width: 1201px)').matches, input: '', turnId: null, tab: 'reply', page: 0 };
  projectViews.set(projectId, view);
  const state = { messages: [], error: '', loading: true, sending: false, applying: false, requestId: null, dead: false, timer: null, refreshId: 0 };
  const aside = document.createElement('aside'); aside.className = 'creative-assistant'; aside.dataset.testid = 'creative-assistant'; aside.setAttribute('aria-label', 'AI创作助手'); container.append(aside);
  const apiBase = `/api/projects/${encodeURIComponent(projectId)}/assistant`;
  const turn = () => state.messages.find(item => item.id === view.turnId) ?? null;
  const active = () => state.messages.find(item => running.has(item.status));
  const label = () => container.querySelector('.studio-project-copy>strong')?.textContent ?? '当前项目';
  async function api(url, body) { const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type':'application/json' }, ...(body === undefined ? {} : { body:JSON.stringify(body) }) }); let result; try { result = await response.json(); } catch { throw new Error(`本机对话服务响应无效（${response.status}）`); } if (!response.ok) throw new Error(result.error ?? '对话操作未完成'); return result; }
  function selectedText(item) {
    if (!item) return { title:'从一个问题开始', text:'告诉我你希望调整什么。讨论只会给出建议；点击“应用修改并保存新版本”后才更新剧本。' };
    if (view.tab === 'question') return { title:'你的问题', text:item.message ?? '' };
    if (view.tab === 'before') return { title:'修改前 · 绑定本次输入', text:item.proposal?.before ?? '本次没有改稿建议。' };
    if (view.tab === 'after') return { title:'修改建议 · 尚未应用', text:item.proposal?.after ?? '本次没有改稿建议。' };
    if (view.tab === 'cautions') return { title:'依据与不确定性', text:[...(item.cautions ?? []), '来源证据有效不等于史实已经核验。没有可核验依据的时代、史实判断应由人工继续核对。'].join('\n\n') };
    if (view.tab === 'record') return { title:'高级 · 本次输入与调用记录', text:`选择段落：${item.snapshot?.selectedText ? `${item.snapshot.selectedText.length}字，已绑定原文位置` : '未选择段落，读取当前完整正文'}\n剧本版本：${item.snapshot?.activeScriptVersionId ?? '尚未确认'}\n编辑版本：${item.snapshot?.editorRevision ?? '未知'}\n真实会话：${item.threadId ?? '尚未收到'}\n任务：${item.id}\n账号用量：${item.usage ? JSON.stringify(item.usage) : '未返回；不等于免费'}\n修改说明：${item.proposal?.reason ?? '无'}\n错误：${item.error ?? '无'}\n历史范围：最近12轮；更早记录保留在本项目。` };
    return { title:'AI 回复', text:item.reply ?? (running.has(item.status) ? '正在等待本机 Codex 的真实回复。可以继续查看正文；不会自动修改，也不会自动重试。' : item.error ?? '尚未收到完整回复。') };
  }
  function renderReader() {
    const holder = aside.querySelector('[data-assistant-reader]'); if (!holder) return;
    const item = turn(), text = selectedText(item); holder.querySelector('[data-assistant-reader-title]').textContent = text.title;
    const copy = holder.querySelector('[data-assistant-reader-copy]');
    const width = copy.clientWidth || 286, height = copy.clientHeight || 230;
    // Conservatively count every code point as a full-width character. The
    // reader itself never scrolls; pagination keeps the input in view.
    const pages = splitText(text.text, Math.max(10, Math.floor(width / 13.2) - 1), Math.max(2, Math.floor(height / 24) - 1));
    view.page = Math.max(0, Math.min(view.page, pages.length - 1)); copy.textContent = pages[view.page];
    holder.querySelector('[data-assistant-page]').textContent = `${view.page + 1} / ${pages.length}`;
    holder.querySelector('[data-assistant-page-prev]').disabled = view.page === 0;
    holder.querySelector('[data-assistant-page-next]').disabled = view.page >= pages.length - 1;
  }
  function render() {
    if (state.dead) return;
    const focused = document.activeElement?.id === 'assistant-prompt' && aside.contains(document.activeElement) ? { start:document.activeElement.selectionStart, end:document.activeElement.selectionEnd } : null;
    container.classList.toggle('assistant-open', view.open); container.classList.toggle('assistant-closed', !view.open);
    const item = turn(), index = state.messages.findIndex(row => row.id === view.turnId), proposal = item?.proposal && item.proposal.kind !== 'none', blocked = state.loading || state.sending || state.applying || Boolean(active());
    const sendReason = state.loading ? '正在读取本项目对话记录。' : state.sending ? '正在保存本次发送意图，请稍候。' : active() ? '本项目已有对话在运行，等待完成或取消后再发送。' : !view.input.trim() ? '输入问题后即可发送；使用现有 Codex 账号用量。' : '发送将读取当前剧本与选段，使用一次 Codex 文字调用。';
    aside.innerHTML = `<button type="button" class="assistant-collapsed" data-assistant-toggle data-testid="assistant-expand" aria-label="展开AI创作助手" aria-expanded="${view.open}"><span aria-hidden="true">✦</span><span>AI助手</span></button><div class="assistant-expanded"><header class="assistant-heading"><div><h2>AI创作助手</h2><p>讨论、检查和改稿建议</p></div><button type="button" class="ghost-button" data-assistant-toggle data-testid="assistant-collapse" aria-label="收起AI创作助手">收起</button></header><div class="assistant-context"><strong title="${esc(label())}">${esc(label())}</strong><span>${new URLSearchParams(location.search).get('stage') === 'storyboard' ? '分镜' : '剧本'} · 发送时读取当前版本及选段</span></div><div class="assistant-conversation"><div class="assistant-message-nav"><button type="button" class="ghost-button" data-assistant-turn-prev ${index <= 0 ? 'disabled' : ''}>上一条</button><span data-testid="assistant-turn-count">${index < 0 ? 0 : index + 1} / ${state.messages.length}</span><button type="button" class="ghost-button" data-assistant-turn-next ${index < 0 || index >= state.messages.length - 1 ? 'disabled' : ''}>下一条</button><button type="button" class="ghost-button assistant-refresh" data-assistant-refresh title="只读取原对话，不重新提交" aria-label="刷新原对话">↻</button></div>${state.error ? `<p class="assistant-error" role="alert" data-testid="assistant-error">${esc(state.error)}</p>` : ''}<div class="assistant-status" data-testid="assistant-status">${state.loading ? '正在读取本项目对话…' : item ? esc(statuses[item.status] ?? item.status) : '尚无对话记录'}${item?.appliedVersionId ? ' · 修改已保存为新版本' : ''}</div>${item?.stale ? `<p class="assistant-warning" data-testid="assistant-stale">需重新讨论：${esc(item.staleReason ?? '剧本或创作要求已经改变；旧建议保留，不能覆盖新稿。')}</p>` : ''}<div class="assistant-tabs" role="tablist" aria-label="查看本条对话">${[['reply','回复'],['question','问题'],...(proposal ? [['before','修改前'],['after','修改后']] : []),['cautions','依据']].map(([id,text]) => `<button type="button" role="tab" aria-selected="${view.tab === id}" data-assistant-tab="${id}">${text}</button>`).join('')}</div><section class="assistant-reader" data-assistant-reader aria-live="polite"><h3 data-assistant-reader-title></h3><div class="assistant-reader-copy" data-assistant-reader-copy data-testid="assistant-reply"></div><div class="assistant-page-nav"><button type="button" class="ghost-button" data-assistant-page-prev>上一页</button><span data-assistant-page></span><button type="button" class="ghost-button" data-assistant-page-next>下一页</button></div></section>${proposal ? `<div class="assistant-proposal"><p>${esc(item.proposal.reason || '检查前后对照，确认后再应用。')}</p><button type="button" class="secondary-button" data-assistant-apply data-testid="assistant-apply" ${state.applying || !item.canApply || item.stale || item.appliedVersionId ? 'disabled' : ''}>${item.appliedVersionId ? '已应用并保存新版本' : '应用修改并保存新版本'}</button>${!item.canApply && !item.appliedVersionId ? `<small>${esc(item.staleReason ?? '仅当前完整、有效的修改建议可以应用；请基于当前正文重新讨论。')}</small>` : ''}</div>` : ''}${item && running.has(item.status) ? '<button type="button" class="ghost-button assistant-cancel" data-assistant-cancel>取消本次等待</button>' : ''}${item ? `<details class="assistant-advanced"><summary>高级 · 本次上下文与调用记录</summary><dl><dt>选段</dt><dd>${item.snapshot?.selectedText ? `${esc(item.snapshot.selectedText.length)}字，已绑定原文位置` : '未选择段落，读取当前完整正文'}</dd><dt>版本</dt><dd>${esc(item.snapshot?.activeScriptVersionId ?? item.snapshot?.editorRevision ?? '尚未确认剧本')}</dd><dt>真实会话</dt><dd>${esc(item.threadId ?? '尚未收到')}</dd><dt>账号用量</dt><dd>${esc(item.usage ? JSON.stringify(item.usage) : '未返回；不等于免费')}</dd></dl><p>${esc(item.error ?? '')}</p></details>` : ''}</div><form class="assistant-input" data-assistant-form><label for="assistant-prompt">${item ? '继续讨论' : '向 AI 提问'}</label><textarea id="assistant-prompt" data-testid="assistant-input" maxlength="12000" rows="3" placeholder="例如：保留结尾，调整前面的节奏。">${esc(view.input)}</textarea><div class="assistant-send-row"><span>Codex账号用量<br>人民币 / 积分费用未知</span><button type="submit" class="primary-button" data-testid="assistant-send" ${blocked || !view.input.trim() ? 'disabled' : ''}>${state.sending ? '正在发送' : '发送'}</button></div><p class="assistant-send-reason" data-testid="assistant-send-reason">${esc(sendReason)}</p></form></div>`;
    const advanced = aside.querySelector('.assistant-advanced'); if (advanced) { const button = document.createElement('button'); button.type = 'button'; button.className = 'assistant-record-link'; button.dataset.assistantTab = 'record'; button.textContent = '高级 · 上下文与用量'; advanced.replaceWith(button); }
    if (focused) { const input = aside.querySelector('#assistant-prompt'); input?.focus({preventScroll:true}); input?.setSelectionRange(focused.start,focused.end); }
    requestAnimationFrame(renderReader);
  }
  async function refresh({ followLatest = false } = {}) {
    const id = ++state.refreshId;
    try { const result = await api(apiBase); if (state.dead || id !== state.refreshId) return; state.messages = result.messages ?? result.jobs ?? []; state.loading = false; state.error = (result.warnings ?? []).join('；'); if (followLatest || !state.messages.some(item => item.id === view.turnId)) { view.turnId = state.messages.at(-1)?.id ?? null; view.page = 0; view.tab = 'reply'; } render(); schedule(); }
    catch (error) { if (state.dead || id !== state.refreshId) return; state.loading = false; state.error = error.message; render(); schedule(); }
  }
  function schedule() { clearTimeout(state.timer); if (!state.dead && active()) state.timer = setTimeout(() => refresh(), 1600); }
  function notify() { window.dispatchEvent(new CustomEvent('ai-drama-assistant-updated', { detail: { projectId } })); }
  async function send() {
    if (state.sending || state.applying || active() || !view.input.trim()) return;
    const message = view.input.trim(); state.sending = true; state.error = ''; render();
    try {
      const context = await getContext(); if (context.projectId && context.projectId !== projectId) throw new Error('项目已经切换；本次问题没有发送，请在当前项目重新确认。');
      const requestId = state.requestId ??= token();
      const result = await api(`${apiBase}/messages`, { ...context, requestId, message }); view.input = ''; state.requestId = null; view.turnId = result.id ?? result.turn?.id; view.page = 0; view.tab = 'reply'; notify(); if (!state.dead) await refresh();
    } catch (error) { state.error = error.message; }
    finally { state.sending = false; render(); }
  }
  async function apply() {
    const item = turn(); if (state.applying || !item?.canApply || item.stale || item.appliedVersionId) return;
    state.applying = true; state.error = ''; render();
    try { const context = await getContext(); const result = await api(`${apiBase}/messages/${encodeURIComponent(item.id)}/apply`, { workspaceRevision:context.workspaceRevision, projectRevision:context.projectRevision, editorRevision:context.editorRevision, editorBody:context.editorBody }); await onApplied?.(result); notify(); if (!state.dead) await refresh(); }
    catch (error) { state.error = error.message; }
    finally { state.applying = false; render(); }
  }
  aside.addEventListener('input', event => { if (event.target.id !== 'assistant-prompt') return; view.input = event.target.value; const button = aside.querySelector('[data-testid=assistant-send]'); if (button) button.disabled = state.loading || state.sending || state.applying || Boolean(active()) || !view.input.trim(); const reason = aside.querySelector('[data-testid=assistant-send-reason]'); if (reason) reason.textContent = view.input.trim() ? '发送将读取当前剧本与选段，使用一次 Codex 文字调用。' : '输入问题后即可发送；使用现有 Codex 账号用量。'; });
  aside.addEventListener('submit', event => { if (!event.target.matches('[data-assistant-form]')) return; event.preventDefault(); event.stopPropagation(); void send(); });
  aside.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    event.stopPropagation();
    if (button.hasAttribute('data-assistant-toggle')) { view.open = !view.open; render(); }
    else if (button.dataset.assistantTab) { view.tab = button.dataset.assistantTab; view.page = 0; render(); }
    else if (button.hasAttribute('data-assistant-page-prev')) { view.page--; renderReader(); }
    else if (button.hasAttribute('data-assistant-page-next')) { view.page++; renderReader(); }
    else if (button.hasAttribute('data-assistant-turn-prev') || button.hasAttribute('data-assistant-turn-next')) { const index = state.messages.findIndex(item => item.id === view.turnId); view.turnId = state.messages[index + (button.hasAttribute('data-assistant-turn-prev') ? -1 : 1)]?.id ?? view.turnId; view.page = 0; view.tab = 'reply'; render(); }
    else if (button.hasAttribute('data-assistant-refresh')) await refresh();
    else if (button.hasAttribute('data-assistant-apply')) await apply();
    else if (button.hasAttribute('data-assistant-cancel')) { const item = turn(); if (!item) return; try { await api(`${apiBase}/messages/${encodeURIComponent(item.id)}/cancel`, {}); await refresh(); } catch (error) { state.error = error.message; render(); } }
  });
  const update = event => { if (event.detail?.projectId === projectId && !state.sending && !state.applying) void refresh(); };
  window.addEventListener('ai-drama-assistant-updated', update);
  const resize = new ResizeObserver(() => renderReader()); resize.observe(aside);
  const handle = { refresh, destroy() { if (state.dead) return; state.dead = true; clearTimeout(state.timer); resize.disconnect(); window.removeEventListener('ai-drama-assistant-updated', update); aside.remove(); container.classList.remove('assistant-open', 'assistant-closed'); } };
  instances.set(container, handle); render(); void refresh(); return handle;
}
