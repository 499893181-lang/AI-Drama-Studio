// Lossless UTF-16 paging: ranges match textarea selectionStart/selectionEnd.
// Separators belong to a page, so joining pages reproduces the exact document.
export function scriptPages(body = '', { maxChars = 480, maxLines = 10 } = {}) {
  body = String(body);
  if (!Number.isInteger(maxChars) || maxChars < 40 || !Number.isInteger(maxLines) || maxLines < 2) throw new Error('分页参数无效');
  if (!body.length) return [{ start: 0, end: 0, text: '', title: '第1页', scene: '' }];
  const headings = [...body.matchAll(/^[ \t]*(?:#{1,4}\s|第[一二三四五六七八九十百\d]+[场幕章]|场景\s*[\d一二三四五六七八九十：:]|scene\s*\d).*$/gmi)].map(match => match.index);
  const pages = []; let start = 0, currentScene = '';
  while (start < body.length) {
    let limit = Math.min(body.length, start + maxChars), lines = 0;
    for (let i = start; i < limit; i++) if (body[i] === '\n' && ++lines >= maxLines) { limit = i + 1; break; }
    if (limit < body.length && /[\uD800-\uDBFF]/.test(body[limit - 1]) && /[\uDC00-\uDFFF]/.test(body[limit])) limit--;
    const nextScene = headings.find(offset => offset > start && offset < limit && body.slice(start,offset).trim());
    let end = nextScene ?? limit;
    if (nextScene === undefined && limit < body.length) {
      const slice = body.slice(start, limit), paragraph = slice.lastIndexOf('\n\n');
      const line = slice.lastIndexOf('\n');
      if (paragraph >= Math.min(80, maxChars / 3)) end = start + paragraph + 2;
      else if (line >= Math.min(80, maxChars / 3)) end = start + line + 1;
    }
    const text = body.slice(start, end);
    const heading = text.split(/\r?\n/).find(line => /^(?:#{1,4}\s|第[一二三四五六七八九十百\d]+[场幕章]|场景\s*[\d一二三四五六七八九十：:]|scene\s*\d)/i.test(line.trim()));
    if (heading) currentScene = heading.trim().replace(/^#+\s*/, '').slice(0, 50);
    const first = text.split(/\r?\n/).find(line => line.trim())?.trim() ?? '';
    pages.push({ start, end, text, title: currentScene || first.slice(0, 28) || `第${pages.length + 1}页`, scene: currentScene });
    start = end;
  }
  return pages;
}
export function replaceScriptPage(body, page, nextText) {
  if (!page || !Number.isInteger(page.start) || !Number.isInteger(page.end) || page.start < 0 || page.end < page.start || page.end > body.length || body.slice(page.start, page.end) !== page.text) throw new Error('当前分页已变化，请重新读取；完整正文未被覆盖。');
  return body.slice(0, page.start) + nextText + body.slice(page.end);
}
export function pageForOffset(pages, offset) {
  return Math.max(0, pages.findIndex((page, index) => offset >= page.start && (offset < page.end || index === pages.length - 1)));
}
