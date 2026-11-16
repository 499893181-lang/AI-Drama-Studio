import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { compileShotDesign, loadCreativeKnowledge, listStylePresets } from '../src/creative-design.mjs';

const read = name => JSON.parse(fs.readFileSync(new URL(`../knowledge/creative/${name}`, import.meta.url), 'utf8'));
const example = () => JSON.parse(fs.readFileSync(new URL('../examples/creative/waiting-shot.json', import.meta.url), 'utf8'));
const anchors = read('source-anchors.json');
function checkAnchors(manual, refs) {
  assert.ok(refs.length > 0);
  for (const ref of refs) {
    const range = /^([PT])(\d+)-([PT])?(\d+)$/.exec(ref);
    if (range) {
      assert.ok(!range[3] || range[3] === range[1]);
      for (let n = Number(range[2]); n <= Number(range[4]); n++) assert.ok(anchors[manual][`${range[1]}${String(n).padStart(3, '0')}`], `${manual}:${ref}`);
    } else assert.ok(anchors[manual][ref], `${manual}:${ref}`);
  }
}

test('实际规则有唯一ID和可定位手册段落，案例规则保持显式适用范围', () => {
  const k = loadCreativeKnowledge(), styles = listStylePresets(k), allIds = [];
  assert.equal(k.directors.directors.length, 15);
  assert.equal(styles.length, 17);
  assert.equal(k.imageRules.rules.length, 24);
  assert.equal(k.motion.camera_vocabulary.length, 13);
  assert.equal(k.motion.general_rules.length, 15);
  assert.equal(k.workflow.rules.length, 19);
  const sourceIds = new Set(k.directors.sources.map(s => s.id));
  let base = 0, added = 0, cases = 0;
  for (const s of styles) {
    for (const source of s.sourceIds) assert.ok(sourceIds.has(source));
    for (const rules of Object.values(s.rules)) for (const r of rules) { allIds.push(r.id); base++; }
  }
  for (const director of k.directors.directors) {
    for (const r of director.manual_derived_rules) { allIds.push(r.id); added++; if (r.case_only) cases++; checkAnchors('M03', r.source.paragraph_ids); }
  }
  for (const r of k.imageRules.rules) { allIds.push(r.id); checkAnchors('M01', r.source_refs); }
  for (const r of [...k.motion.camera_vocabulary, ...k.motion.general_rules]) { allIds.push(r.id); checkAnchors('M02', r.source_anchors); }
  assert.equal(new Set(allIds).size, allIds.length);
  assert.equal(base, 94); assert.equal(added, 90); assert.equal(cases, 15);
});

test('同场景三预设预览均保留事实，示例上游Hash来自实际文本', () => {
  const k = loadCreativeKnowledge(), x = example();
  for (const key of ['brief', 'script']) {
    const bytes = fs.readFileSync(new URL(`../examples/creative/${key}.txt`, import.meta.url));
    assert.equal(x.inputHashes[key], createHash('sha256').update(bytes).digest('hex'));
  }
  const designs = ['jia.platform.distance', 'wong.chungking.city', 'anderson.budapest.order'].map(stylePresetId => compileShotDesign({ ...x, stylePresetId }, k));
  assert.equal(new Set(designs.map(d => d.imagePrompt)).size, 3);
  for (const d of designs) {
    assert.equal(d.structuralStatus, 'valid_draft');
    assert.match(d.imagePrompt, /灰蓝长衫/); assert.match(d.imagePrompt, /阴天/);
    assert.equal(d.formalStageStatus, 'not_checked'); assert.equal(d.mediaStatus, 'not_generated');
    assert.ok(d.appliedRules.every(r => d[r.target].includes(r.text)));
    assert.ok(!d.appliedRules.some(r => r.origin === 'explicitly_selected_handbook_extension'));
    assert.ok(d.findings.some(f => f.code === 'reference_not_attached'));
  }
});
