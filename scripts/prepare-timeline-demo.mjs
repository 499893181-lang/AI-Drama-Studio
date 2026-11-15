// Explicit software-acceptance fixture. Copies existing marked media only.
import fs from 'node:fs';
import path from 'node:path';
import { createTimelineFixture } from '../tests/timeline-fixtures.mjs';

if (process.argv[2] !== '--prepare-local-test' || !process.env.DATA_DIR) throw new Error('Use DATA_DIR and --prepare-local-test. No generation mode exists.');
const stateFile = path.resolve('.runtime/timeline-demo.json');
fs.mkdirSync(path.dirname(stateFile), { recursive: true });
if (fs.existsSync(stateFile)) {
  const old = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (path.resolve(old.dataDir) !== path.resolve(process.env.DATA_DIR)) throw new Error('Existing acceptance state belongs to a different DATA_DIR; do not reset it.');
  console.log(JSON.stringify({ ...old, reused: true }, null, 2));
} else {
  const fixture = await createTimelineFixture({ root: path.resolve(process.env.DATA_DIR), name: '[本地导出验收] 三镜头TEST色卡 · 非AI成片' });
  try {
    const view = fixture.timeline.update(fixture.project.id, { revision: 0, clips: [fixture.assets[2], fixture.assets[0], fixture.assets[1]].map(asset => ({ assetId: asset.id })), audioMode: 'mute_derivative' });
    const prepared = fixture.timeline.prepareExport(fixture.project.id, { revision: view.revision });
    const task = await fixture.timeline.startExport(prepared.id);
    if (task.status !== 'succeeded') throw new Error(task.error ?? 'Local export did not complete. Original marked media retained.');
    const state = { dataDir: fixture.store.root, projectId: fixture.project.id, versionId: view.activeVersionId, taskId: task.id, testFixture: true, sourceSha256: fixture.clip.sha256, outputSha256: task.result.sha256, probe: { durationSeconds: task.result.probe.durationSeconds, width: task.result.probe.width, height: task.result.probe.height, audioStreams: task.result.probe.audioStreams }, realImageGenerationCalls: 0, realVideoSubmissions: 0, url: `http://127.0.0.1:4320/timeline.html?projectId=${fixture.project.id}` };
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(state, null, 2));
  } finally { fixture.timeline.close(); }
}
