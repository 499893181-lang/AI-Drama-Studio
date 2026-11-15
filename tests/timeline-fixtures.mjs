// Isolated engineering setup. Reuses the tracked marked movie; never generates media.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { CreativeWorkspace } from '../src/creative-store.mjs';
import { ImageWorkspace } from '../src/image-store.mjs';
import { VideoWorkspace } from '../src/video-store.mjs';
import { TimelineService } from '../src/timeline-jobs.mjs';
import { probeVideo } from '../src/video-media.mjs';
import { fixtureEntities, fixtureShots } from './creative-fixtures.mjs';

export const trackedTestVideo = fileURLToPath(new URL('../docs/video-v07-evidence/TEST-FIXTURE-NOT-AI.mp4', import.meta.url));
export const trackedTestImage = fileURLToPath(new URL('../docs/video-v07-evidence/TEST-FIXTURE-NOT-AI-input.png', import.meta.url));
export async function createTimelineFixture({ root, serviceOptions = {}, name = '[TEST] 本地时间轴：非AI素材' } = {}) {
  const artifacts = path.resolve('tests/.artifacts'); fs.mkdirSync(artifacts, { recursive: true });
  const store = new Store(root ?? fs.mkdtempSync(path.join(artifacts, 'timeline-'))), creative = new CreativeWorkspace(store);
  const project = store.create({ name, idea: '独立非个人软件测试故事：三镜头。所有图片和视频是明确TEST夹具，非AI生成。本地拼接不提交外部任务。', durationSeconds: 30, aspectRatio: '16:9' });
  creative.update(project.id, { revision: 0, entities: structuredClone(fixtureEntities), shots: fixtureShots() });
  creative.addVersion(project.id, { revision: 1, kind: 'storyboard', body: '隔离人工分镜，用于时间轴软件测试；不是模型输出或正式岗位PASS。' });
  const images = new ImageWorkspace(store, { creativeWorkspace: creative }), videos = new VideoWorkspace(store, { images });
  const imageBytes = fs.readFileSync(trackedTestImage), bytes = fs.readFileSync(trackedTestVideo), probe = await probeVideo(trackedTestVideo), assets = [];
  for (const shot of fixtureShots()) {
    let imageView = images.import(project.id, { revision: images.get(project.id).revision, role: 'shot', targetId: shot.id, filename: 'TEST-FIXTURE-NOT-AI-input.png', source: { kind: 'test', description: '复用仓库明确TEST图片；非AI生成、仅工程测试。' } }, imageBytes);
    const image = imageView.assets.at(-1); imageView = images.review(project.id, { revision: imageView.revision, assetId: image.id, verdict: 'accepted', notes: '人工软件验收夹具标记；不代表真实AI画面或正式审稿。' }); images.select(project.id, { revision: imageView.revision, assetId: image.id });
    const source = videos.source(project.id, shot.id);
    const task = { id: randomUUID(), externalTaskId: `TEST-LOCAL-IMPORT-${randomUUID()}`, shotId: shot.id, providerStatus: 'success', executionMode: 'isolated-fixture', binding: source.binding, bindingHash: source.bindingHash, inputSnapshot: source.snapshot, parameters: { audioMode: 'provider_default', durationSeconds: probe.durationSeconds, model: 'TEST-LOCAL-EXISTING-VIDEO', resolution: '720p' } };
    const asset = videos.importCandidate(project.id, { task, bytes, probe });
    videos.review(project.id, { revision: videos.get(project.id).revision, assetId: asset.id, verdict: 'accepted', notes: '已核对TEST标记，纯软件测试夹具，不是即梦生成证据。' }); videos.select(project.id, { revision: videos.get(project.id).revision, assetId: asset.id }); assets.push(asset);
  }
  const timeline = new TimelineService(store, { videos, ...serviceOptions });
  return { store, project, creative, images, videos, timeline, assets, clip: { path: trackedTestVideo, bytes, probe, sha256: probe.sha256 } };
}
