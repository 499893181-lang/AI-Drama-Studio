import { createHash } from 'node:crypto';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const provenanceHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const entityFacts = entity => Object.fromEntries(['id', 'type', 'version', 'description', 'source'].map(key => [key, entity[key]]));
export const entityFactsHash = entity => provenanceHash(entityFacts(entity));
const clone = value => structuredClone(value);
const entryKey = entity => `${entity.id}@${entity.version}`;
const pending = (entity, reason, snapshotHash = null) => ({ entityId: entity.id, version: entity.version, entityHash: entityFactsHash(entity), declaredSource: entity.source, resolvedSource: 'pending', status: 'pending_confirmation', reason, evidence: [], inputSnapshotHash: snapshotHash, bindingValid: true });

function evidenceText(snapshot, path) {
  if (path === 'source.idea') return snapshot.source?.idea;
  if (path === 'instructions') return snapshot.instructions;
  const match = /^entities\.(\d+)\.description$/.exec(path);
  if (!match) return null;
  const entity = snapshot.entities?.[Number(match[1])];
  const record = entity && snapshot.entityInputEvidence?.[entryKey(entity)];
  return entity?.source === 'user' && record?.entityHash === entityFactsHash(entity) && record.kind === 'explicit_user_edit' ? entity.description : null;
}

/** Character evidence, not semantic inference: the complete description must be an exact excerpt. */
export function assessEntityProvenance(result, snapshot) {
  const snapshotHash = provenanceHash(snapshot);
  const evidenceRows = Array.isArray(result.entityEvidence) ? result.entityEvidence : [];
  const entries = (result.entities ?? []).map(entity => {
    const row = pending(entity, '来源声明未经充分证据核实，保留原文并待人工确认。', snapshotHash);
    const inherited = snapshot.entities?.find(item => item.id === entity.id && item.version === entity.version && entityFactsHash(item) === row.entityHash);
    const manual = inherited && snapshot.entityInputEvidence?.[entryKey(inherited)];
    if (manual?.entityHash === row.entityHash && manual.kind === 'explicit_user_edit') {
      row.resolvedSource = entity.source === 'ai' ? 'ai' : 'user';
      row.status = entity.source === 'ai' ? 'ai_addition' : 'verified_user_input';
      row.reason = '实体内容由工作台实际人工新建或修改提交，服务端记录了输入证据；不是模型自报。';
      const index = snapshot.entities.findIndex(item => item.id === entity.id);
      row.evidence = [{ path: `entities.${index}.description`, start: 0, end: entity.description.length, quote: entity.description, snapshotHash }];
      return row;
    }
    if (entity.source === 'ai') {
      if (Array.isArray(result.addedSettings) && result.addedSettings.some(text => typeof text === 'string' && text.includes(entity.description))) {
        row.resolvedSource = 'ai'; row.status = 'ai_addition'; row.reason = '模型明确声明为AI补充，并在addedSettings保留逐项说明；不认定为用户事实。';
      } else row.reason = '声明为AI补充，但缺少与该实体对应的addedSettings说明，待人工确认。';
      return row;
    }
    const proofs = evidenceRows.filter(proof => proof.entityId === entity.id && proof.version === entity.version);
    if (proofs.length !== 1) { row.reason = inherited ? '历史/继承实体缺少可验证的原始来源证据，不能用相同source声明补造证据。' : '新增实体自报用户来源，但缺少唯一可定位的输入证据，待人工确认。'; return row; }
    const proof = proofs[0], original = evidenceText(snapshot, proof.path);
    if (proof.snapshotHash !== snapshotHash || typeof original !== 'string' || !Number.isInteger(proof.start) || !Number.isInteger(proof.end) || proof.start < 0 || proof.end <= proof.start || proof.end > original.length || original.slice(proof.start, proof.end) !== proof.quote || entity.description !== proof.quote) {
      row.reason = '输入证据的快照、允许来源路径、UTF-16位置或完整描述摘录不匹配；不能把未被摘录覆盖的新设定认定为用户指定。'; return row;
    }
    row.resolvedSource = 'user'; row.status = 'verified_user_input'; row.reason = '完整实体描述与允许的用户输入摘录逐字一致；仅验证字符来源，不宣称理解语义。'; row.evidence = [clone(proof)];
    return row;
  });
  return { schemaVersion: '0.5.0', inputSnapshotHash: snapshotHash, entries, pendingCount: entries.filter(row => row.resolvedSource === 'pending').length };
}

export function legacyEntityProvenance(entities, reason = '旧记录没有绑定输入快照的来源侧录，保留原始声明，待人工确认。') {
  return { schemaVersion: '0.5.0', inputSnapshotHash: null, entries: entities.map(entity => pending(entity, reason)), pendingCount: entities.length };
}

export function validateEntityProvenance(report, result, snapshot, expectedSnapshotHash = null) {
  if (!report) return legacyEntityProvenance(result.entities ?? []);
  const expected = assessEntityProvenance(result, snapshot);
  if (expectedSnapshotHash && expectedSnapshotHash !== provenanceHash(snapshot) || provenanceHash(report) !== provenanceHash(expected)) {
    const invalid = legacyEntityProvenance(result.entities ?? [], '来源侧录与当前实体或原输入快照不匹配，证据失效，待人工确认。');
    invalid.entries.forEach(entry => { entry.bindingValid = false; });
    return invalid;
  }
  return expected;
}

export function provenanceBase(result, snapshot, report, expectedSnapshotHash = provenanceHash(snapshot)) {
  return { result: { entities: clone(result.entities ?? []), entityEvidence: clone(result.entityEvidence ?? []), addedSettings: clone(result.addedSettings ?? []) }, inputSnapshot: clone(snapshot), expectedSnapshotHash, report: clone(report) };
}

export function mergeEntityProvenance(entities, bases = []) {
  const reports = [...bases].reverse().map(base => validateEntityProvenance(base.report, base.result, base.inputSnapshot, base.expectedSnapshotHash));
  const entries = entities.map(entity => {
    const hash = entityFactsHash(entity);
    let invalid = null;
    for (const verified of reports) {
      const row = verified.entries.find(item => item.entityId === entity.id && item.version === entity.version && item.entityHash === hash);
      if (row && row.bindingValid && row.resolvedSource !== 'pending') return clone(row);
      if (row?.bindingValid === false) invalid = row;
    }
    return invalid ? clone(invalid) : pending(entity, '当前实体缺少完整有效的来源证据；历史声明保留，待人工确认。');
  });
  return { schemaVersion: '0.5.0', inputSnapshotHash: null, entries, pendingCount: entries.filter(row => row.resolvedSource === 'pending').length };
}

export function evidenceForExplicitEdits(previous, next, oldEvidence = {}) {
  const evidence = clone(oldEvidence);
  for (const entity of next) {
    const before = previous.find(item => item.id === entity.id && item.version === entity.version);
    if (!before || entityFactsHash(before) !== entityFactsHash(entity)) evidence[entryKey(entity)] = { kind: 'explicit_user_edit', entityHash: entityFactsHash(entity) };
  }
  return evidence;
}
