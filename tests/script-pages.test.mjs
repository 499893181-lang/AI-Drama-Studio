import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptPages, replaceScriptPage, pageForOffset } from '../public/script-pages.js';

test('按场景/段落分页完整保留空行、CRLF、末尾空格和Unicode，不截断长正文', () => {
  const body = '# 第一场 雨夜\r\n' + ('老人等待。\r\n\r\n'.repeat(120)) + '# 第二场 归来\n' + '😀杯盏微光'.repeat(230) + '\n结尾保留。  \n';
  const pages = scriptPages(body);
  assert.ok(pages.length > 10); assert.equal(pages.map(page => page.text).join(''), body);
  assert.ok(pages.every(page => page.text.length <= 600 && !/[\uD800-\uDBFF]$/.test(page.text)));
  assert.ok(pages.some(page => page.title === '第二场 归来'));
  for (const page of pages) assert.equal(body.slice(page.start, page.end), page.text);
});
test('编辑任意分页只替换该页，切换并保存可重建完整正文和选文全局位置', () => {
  const body = '第一段。\n\n'.repeat(300), pages = scriptPages(body), page = pages[2];
  const next = replaceScriptPage(body, page, page.text + '【人工补充】');
  assert.equal(next.slice(0, page.start), body.slice(0, page.start));
  assert.equal(next.slice(page.start + page.text.length + '【人工补充】'.length), body.slice(page.end));
  assert.equal(scriptPages(next).map(item => item.text).join(''), next);
  assert.equal(pageForOffset(pages, page.start + 3), 2);
  assert.equal(pageForOffset(pages, body.length), pages.length - 1);
  assert.throws(() => replaceScriptPage('已变稿', page, '覆盖'), /当前分页已变化/);
});
test('多个短场景分别有可点击目录页，同场景长正文继续拆页且原文无损', () => {
  const body = '# 第一场 等待\n桌上留茶。\n\n# 第二场 回应\n语音传来。\n\n# 第三场 结尾\n椅子拉近。  \n';
  const pages = scriptPages(body);
  assert.equal(pages.length,3);assert.deepEqual(pages.map(page=>page.scene),['第一场 等待','第二场 回应','第三场 结尾']);
  assert.equal(pages.map(page=>page.text).join(''),body);
  for(let index=0;index<3;index++)assert.equal(pageForOffset(pages,body.indexOf(['# 第一场','# 第二场','# 第三场'][index])),index);
  const long = body.replace('语音传来。','语音传来。'.repeat(200)), split=scriptPages(long);
  assert.ok(split.filter(page=>page.scene==='第二场 回应').length>1);assert.equal(split.map(page=>page.text).join(''),long);
});
