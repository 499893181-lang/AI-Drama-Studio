import { mountStudio, studioHref } from './studio-shell.js';
const esc = value => String(value ?? '未返回').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const pretty = value => esc(typeof value === 'object' ? JSON.stringify(value, null, 2) : value);
const row = (title, value) => `<tr><th>${esc(title)}</th><td>${pretty(value)}</td></tr>`;
const query = new URLSearchParams(location.search), project = query.get('projectId');
if (project) document.querySelector('#back').href = `/video.html?projectId=${encodeURIComponent(project)}`;
async function load() {
  const response = await fetch('/api/video-channels/canvas', { signal: AbortSignal.timeout(15000) });
  const record = await response.json();
  if (!response.ok) throw new Error(record.error ?? '读取检查记录失败');
  const canvas = record.canvas ?? {}, params = record.parameters ?? {}, quote = record.quote ?? {};
  const url = canvas.webUrl ?? record.webUrl;
  const official = typeof url === 'string' && /^https:\/\/jimeng\.jianying\.com\/ai-tool\/ai-canvas\/[a-zA-Z0-9-]+$/.test(url);
  document.querySelector('#channel-report').innerHTML = `
    <p><a class="secondary-button" id="canvas-workbench" href="/canvas-video.html${project?`?projectId=${encodeURIComponent(project)}`:''}">进入画布单镜工作台 · 待授权</a></p><div class="video-notice" data-testid="canvas-no-submit">真实视频提交关闭 · 0笔视频生成。100积分仅为未授权计划预算，既不是报价，也不是平台硬限额。</div>
    <section class="video-panel"><div class="video-body"><h2>当前检查结论</h2><p>${esc(record.message ?? '按下方实际回执读取各项结论。')}</p>
      <table>${row('检查时间', record.checkedAt)}${row('渠道', record.channel)}${row('历史最大预估', quote.amount == null ? '费用待确认' : `${quote.amount}积分`)}${row('有效期', quote.expiresAt ?? '未返回，不推算')}</table><details><summary>画布身份、参数及费用原始记录</summary><pre>${pretty({canvas,parameters:params,quote,eligibility:record.eligibility})}</pre></details>
      ${official ? `<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">打开独立官方测试画布</a></p>` : ''}
      <p>报价只限本画布、本节点、本模型及参数，不能套给 direct image2video。生成前需重新检查最新草稿及报价，并由本人确认费用和预算；此存档不构成授权。实际扣费未返回时保持未知。</p>
    </div></section>
    <section class="video-panel"><div class="video-body"><h2>实际输入与证据边界</h2><p>沿用已保存的 TEST FIXTURE / NOT AI 测试图片，没有新生成图片。保存待生成视频草稿与导入已有视频是两类操作，草稿没有视频产物。</p><pre>${pretty(record.input)}</pre>
      <p>保存和报价已验证的范围以回执为准；运行、终态、下载、模型实际准入及参考画面符合性仍需下一次获批的真实验收。会话登录不能代替其他渠道登录，价格目录不能代替本账号准入。</p>
      <details><summary>完整脱敏检查记录</summary><pre data-testid="canvas-evidence">${pretty(record)}</pre></details>
    </div></section>`;
  const list = await (await fetch('/api/projects')).json();
  const projects = list.projects ?? [], selected = projects.find(item => item.id === project) ?? projects[0] ?? null;
  const content = document.querySelector('.channel-main .content'), heading = content?.querySelector('h1'); if (heading) heading.textContent = '渠道与历史报价记录';
  mountStudio(document.querySelector('.channel-main'), { section: 'settings', step: 'video', title: '渠道记录', project: selected, projects, projectAttribute: 'data-channel-project', primary: { label: '返回视频制作', href: studioHref('/canvas-video.html', selected?.id) }, nextText: '此页只读展示历史检查档案，不构成当前费用或消费授权。' });
  document.querySelector('.channel-main').addEventListener('click', event => { const node = event.target.closest('[data-channel-project]'); if (node) location.href = studioHref('/video-channel.html', node.dataset.channelProject); });
}
load().catch(error => { document.querySelector('#channel-report').textContent = error.message; });
