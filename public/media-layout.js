import { mountStudio, studioHref } from './studio-shell.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fold(node, label) {
  if (!node || node.parentElement?.classList.contains('studio-media-details')) return;
  const details = document.createElement('details'); details.className = 'studio-media-details';
  const summary = document.createElement('summary'); summary.textContent = label; details.append(summary); node.before(details); details.append(node);
}
export function applyMediaLayout(container, options) {
  const { kind, project, projects, ws, task, dirty = false, busy = false } = options;
  const content = container.querySelector('.content'); if (!content) return;
  const finishing = kind === 'timeline' && options.view !== 'export', exporting = kind === 'timeline' && !finishing;
  const title = kind === 'canvas' ? '制作所选镜头视频' : kind === 'direct' ? '制作视频 · 直连渠道' : exporting ? '导出成片' : '配音与剪辑';
  const intro = kind === 'canvas' ? '检查当前画面与运镜，核对费用和本人授权后再生成一个镜头。' : kind === 'direct' ? '保留直连任务的准备、查询和下载能力；认证或费用未就绪时不会生成。' : exporting ? '检查已保存的镜头顺序，导出本地MP4。测试素材和真实作品分别标明。' : '原v1完整镜头拼接保留。配音、字幕与多轨剪辑请使用左侧六Agent工作台。';
  const heading = content.querySelector('.page-heading h1'); if (heading) heading.textContent = title;
  const explanation = content.querySelector('.page-heading p'); if (explanation) explanation.textContent = intro;
  content.classList.add('studio-media-content');
  for (const selector of ['.video-status-grid', '.timeline-local-status']) fold(content.querySelector(selector), '连接、能力与当前素材状态');
  for (const node of content.querySelectorAll('.canvas-scope')) fold(node, '图片、节点与版本绑定');
  for (const node of content.querySelectorAll('.video-input-preview')) { node.classList.add('studio-media-input'); fold(node.querySelector('.video-input-data code'), '查看输入文件Hash'); }
  for (const node of content.querySelectorAll('.video-task-header small')) fold(node, '任务身份与恢复记录');
  for (const selector of ['.video-footnote', '.timeline-footnote']) fold(content.querySelector(selector), '功能范围与素材来源说明');
  if (kind === 'canvas') {
    const link = document.createElement('details'); link.className = 'studio-media-details'; link.innerHTML = `<summary>其他视频渠道与检查记录</summary><p><a href="${escape(studioHref('/video.html', project?.id))}" data-leave>直连视频渠道</a> · <a href="${escape(studioHref('/video-channel.html', project?.id))}" data-leave>查看历史渠道与报价证据</a></p>`; content.append(link);
  }
  if (kind === 'timeline') {
    content.classList.toggle('studio-export-view', exporting); content.classList.toggle('studio-finishing-view', finishing);
    if (exporting) fold(content.querySelector('.timeline-grid'), '检查或修改镜头顺序、素材和音轨');
    else {
      const note = document.createElement('section'); note.className = 'studio-unavailable'; note.innerHTML = '<h2>声音与多轨剪辑</h2><p>当前页面为旧v1拼接。请使用左侧“配音与声音”和“剪辑与导出”管理声音、字幕和多轨计划；本轮生成关闭。</p><a class="secondary-button" href="/studio.html?page=voice">配音与声音</a>'; content.append(note);
      fold(content.querySelector('#timeline-exports')?.closest('.timeline-panel'), '本地导出与历史文件');
    }
    fold(content.querySelector('.timeline-table-wrap')?.closest('.timeline-panel'), '时间轴版本记录');
  }
  let primary, secondary = { label: kind === 'timeline' ? '返回视频' : '返回画面', href: studioHref(kind === 'timeline' ? '/canvas-video.html' : '/images.html', project?.id) }, nextText;
  if (kind === 'timeline') {
    if (finishing) { primary = dirty ? { label: '保存剪辑顺序', selector: '[data-testid=timeline-save]' } : { label: '继续导出', href: studioHref('/timeline.html?view=export', project?.id), disabled: !ws?.activeVersionId, reason: '请先添加已选用视频并保存镜头顺序。' }; nextText = dirty ? '下一步：保存当前顺序，再检查导出设置。' : '下一步：检查导出设置，生成本地MP4。'; }
    else {
      const prepared = ws?.exports?.find(item => item.status === 'prepared' && !item.stale), done = ws?.exports?.find(item => item.status === 'succeeded' && !item.stale);
      primary = prepared ? { label: '导出成片', selector: `[data-run="${prepared.id}"]` } : done ? { label: '下载成片', selector: `[data-export-id="${done.id}"] [data-testid=timeline-download]` } : { label: '准备成片导出', selector: '[data-testid=timeline-prepare]' };
      secondary = { label: '修改剪辑顺序', href: studioHref('/timeline.html?view=finishing', project?.id) }; nextText = done ? '已导出实际文件；下载前请检查画面、时长与音轨。' : '仅在本机拼接已有素材，原片和历史文件保留。';
    }
  } else {
    const prefix = kind === 'canvas' ? 'canvas' : 'video';
    if (task?.status === 'succeeded') { primary = { label: '检查视频候选', onClick: () => { const current = task.result?.assetId ? container.querySelector(`[data-asset-id="${CSS.escape(task.result.assetId)}"]`) : null; (current ?? container.querySelector('[data-asset-id]'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }; nextText = '下一步：人工检查并选用视频，再进入配音剪辑。'; }
    else if (['download_ready', 'download_failed'].includes(task?.status)) { primary = { label: '下载视频候选', selector: `[data-testid=${prefix}-download]` }; nextText = '只恢复原任务下载，不重新生成。'; }
    else if (task?.submittedAt) { primary = { label: '查询原视频任务', selector: `[data-testid=${prefix}-query]` }; nextText = '沿原任务继续查询，不重复提交生成。'; }
    else if (task?.canSubmit || kind === 'direct' && ws?.capability?.canSubmit && task?.quote?.status === 'known') { primary = { label: '生成所选镜头', selector: `[data-testid=${prefix}-submit]` }; nextText = '执行前重新核对当前输入、费用与本人授权。'; }
    else { primary = { label: task ? '复核费用与授权' : '准备所选镜头', selector: `[data-testid=${kind === 'canvas' && task ? 'canvas-quote-refresh' : `${prefix}-prepare`}]`, reason: '须先选用有效分镜图；准备与复核不会启动生成。' }; nextText = '下一步：核对费用与本人授权。准备和复核不会生成视频。'; }
  }
  const handle = mountStudio(container, { step: kind === 'timeline' ? exporting ? 'export' : 'finishing' : 'video', project, projects, projectAttribute: kind === 'canvas' ? 'data-project' : 'data-project-id', title, primary, secondary, nextText });
  handle?.syncActions();
}
