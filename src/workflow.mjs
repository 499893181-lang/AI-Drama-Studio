// UI progress is derived from current saved work. It never calls a provider,
// changes a task, grants approval, or promotes model PASS to a formal handoff.
const running = new Set(['queued', 'running', 'submitting', 'querying', 'querying_active', 'downloading', 'exporting']);
const titles = { story: '故事', script: '剧本', storyboard: '分镜', images: '画面', video: '视频', finishing: '配音剪辑', export: '导出' };
export function inspectWorkflow(app, projectId) {
  const project = app.store.read('projects', projectId), warnings = [];
  const read = (name, fn, fallback) => { try { return fn(); } catch (error) { warnings.push({ section: name, message: error.message }); return fallback; } };
  const creative = read('creative', () => app.creative.view(projectId), null);
  const novel = read('novel', () => app.scripts.workspace.view(projectId), null);
  const images = read('images', () => app.images.view(projectId), null);
  const videos = read('videos', () => app.videos.workspace.view(projectId), null);
  const timeline = read('timeline', () => app.timeline.view(projectId), null);
  const tasks = creative?.tasks ?? [], steps = [];
  const add = (id, status, reason, extra = {}) => steps.push({ id, label: titles[id], status, reason, ...extra });
  add('story', project.idea.trim() ? 'completed' : 'pending', project.idea.trim() ? '故事构思已保存在本机，可以继续创作剧本。' : '填写并保存故事构思；默认30秒，时长与画幅可修改。');
  const activeScript = creative?.versions?.find(version => version.id === creative.activeScriptId);
  const novelActive = novel?.versions?.find(version => version.id === novel.activeScriptId && version.kind === 'script');
  const script = activeScript ?? novelActive;
  if (script) add('script', script.stale || novelActive === script && novel.upstreamStale ? 'needs_review' : 'completed', script.stale ? '上游内容改变，已保存剧本需复核；原稿与版本保留。' : '当前剧本已有保存或采用版本；仍可独立审阅和人工修改。');
  else add('script', tasks.some(task => task.kind === 'script') || creative?.scriptDraft?.trim() ? 'in_progress' : 'pending', tasks.some(task => task.kind === 'script' && running.has(task.status)) ? '剧本候选正在处理，按原任务等待结果。' : '生成或编辑剧本后保存一个版本，候选不会自动采用。');
  const storyboard = creative?.versions?.find(version => version.id === creative.activeStoryboardId);
  const shotTargets = (images?.targets ?? []).filter(target => target.role === 'shot');
  if (storyboard?.stale || creative?.compileError && (storyboard || creative?.shots?.length)) add('storyboard', 'needs_review', storyboard?.stale ? '输入或风格变化，当前分镜版本需复核。' : creative.compileError);
  else if (images?.hasSavedStoryboard && shotTargets.length && shotTargets.every(target => target.ready)) add('storyboard', 'completed', '当前镜头设计已保存；确认画面、动作与衔接后制作图片。');
  else add('storyboard', creative?.shots?.length || tasks.some(task => task.kind === 'storyboard') ? 'in_progress' : 'pending', '整理镜头画面、动作和衔接；保存后再制作分镜图片。');
  const selectedImageAssets = (images?.activeSelections ?? []).map(selection => selection.asset).filter(Boolean);
  const currentShotImages = selectedImageAssets.filter(asset => asset.role === 'shot');
  const imageDone = shotTargets.length > 0 && shotTargets.every(target => currentShotImages.some(asset => asset.targetId === target.targetId && asset.state === 'selected' && !asset.stale && asset.reviewCurrent && asset.fileStatus === 'intact'));
  if (selectedImageAssets.some(asset => asset.stale || asset.state === 'rejected') || shotTargets.some(target => !target.ready) && currentShotImages.length) add('images', 'needs_review', '当前选用图片或参考的来源/审核变化，受影响画面需复核，旧图保留。');
  else add('images', imageDone ? 'completed' : images?.assets?.length ? 'in_progress' : 'pending', imageDone ? '各镜头已有当前有效、人工检查并选用的画面。' : '导出出图任务或导入实际图片，再逐镜检查和选用。');
  const videoTargets = videos?.targets ?? [], currentVideos = (videos?.assets ?? []).filter(asset => asset.selected);
  const videoDone = videoTargets.length > 0 && videoTargets.every(target => target.ready && currentVideos.some(asset => asset.shotId === target.shotId && asset.state === 'selected' && !asset.stale && asset.reviewCurrent && asset.fileStatus === 'intact'));
  const videoTasks = [...app.videos.list().values, ...app.canvasVideo.list().values].filter(task => task.projectId === projectId);
  if (currentVideos.some(asset => asset.stale || asset.state === 'rejected')) add('video', 'needs_review', '选用视频的图片、分镜或审核已改变，旧视频与原任务保留。');
  else add('video', videoDone ? 'completed' : videos?.assets?.length || videoTasks.length ? 'in_progress' : 'pending', videoDone ? '各镜头视频已由人工检查并选用；来源和实测信息可查。' : videoTasks.some(task => running.has(task.status)) ? '按原任务查询或恢复下载，不重复生成。' : videoTasks.length ? '已有视频准备或候选；费用、本人授权和人工选用分别确认。' : '先选用有效分镜图，再准备单镜视频；未知费用不能提交。');
  if (timeline?.stale) add('finishing', 'needs_review', timeline.inputValidationError ?? '素材或顺序版本变化，旧时间轴需复核。');
  else add('finishing', timeline?.clips?.length ? 'in_progress' : 'pending', timeline?.clips?.length ? '剪辑顺序已保存；配音与字幕尚未接通，可导出已有视频的本地拼接。' : '整理已选用视频的顺序与音轨；配音/字幕尚未接通，不显示完成。');
  const currentExport = (timeline?.exports ?? []).find(task => task.versionId === timeline.activeVersionId);
  if (currentExport?.status === 'succeeded' && !currentExport.stale) {
    const file = read('export-file', () => app.timeline.file(currentExport.id), null);
    add('export', file ? 'completed' : 'needs_review', file ? '当前时间轴已导出实际MP4；内容与成片仍需人工检查。' : '导出文件缺失或Hash改变，记录与原素材保留。');
  } else if (currentExport?.stale || (timeline?.exports?.length && timeline.stale)) add('export', 'needs_review', '旧导出不代表当前输入或时间轴版本，请复核后重新导出。');
  else add('export', currentExport ? 'in_progress' : 'pending', currentExport ? `本地导出状态：${currentExport.status}；失败或取消不损坏原片。` : '保存时间轴后导出MP4，实际文件核验后才显示导出完成。');
  const thumbnail = currentShotImages.find(asset => !asset.stale && asset.fileStatus === 'intact') ?? images?.assets?.find(asset => asset.fileStatus === 'intact' && !asset.stale);
  const agents=[{...steps.find(s=>s.id==='script')},{...steps.find(s=>s.id==='storyboard')}];
  const visual=app.visuals?read('visuals',()=>app.visuals.view(projectId),null):null;
  const refs=(images?.targets??[]).filter(t=>['character','scene'].includes(t.role));
  const oldReferences=selectedImageAssets.filter(a=>['character','scene'].includes(a.role));
  const refDone=refs.length>0&&refs.every(t=>t.ready&&selectedImageAssets.some(a=>a.key===t.key&&a.state==='selected'&&!a.stale&&a.reviewCurrent));
  agents.splice(1,0,{id:'entities',status:oldReferences.some(a=>a.stale||a.state==='rejected')?'needs_review':refDone?'completed':visual?.visuals?.length||oldReferences.length?'in_progress':'pending',reason:refDone?'人物与场景参考已检查选用；不是正式媒体验收通过。':'保存视觉说明，导入综合人物板与场景四宫格，再人工检查选用。'});
  const visualState=app.visuals?read('visual-state',()=>app.visuals.get(projectId),null):null;
  let promptCurrent=false;if(visualState?.promptPackages?.length){const current=read('prompt-current',()=>app.visuals.prompts(projectId),null);promptCurrent=visualState.promptPackages.at(-1).inputHash===current?.inputHash;}
  agents.push({id:'prompts',status:visualState?.promptPackages?.length?promptCurrent?'completed':'needs_review':steps.find(s=>s.id==='storyboard').status==='completed'?'in_progress':'pending',reason:promptCurrent?'当前输入提示词包已编译保存；不表示视频已提交。':'按当前分镜和所选模型编译并保存提示词包；费用和实际附件另核对。'});
  const voice=app.production?read('voice',()=>app.production.voice.view(projectId),null):null;
  const voiceDone=voice?.utterances?.length>0&&voice.utterances.every(line=>voice.assets.some(a=>a.utteranceId===line.id&&a.selected&&!a.stale&&a.reviewCurrent&&a.review?.verdict==='accepted'));
  agents.push({id:'voice',status:voice?.stale||voice?.assets?.some(a=>a.stale)?'needs_review':voiceDone?'completed':voice?.cards?.length||voice?.utterances?.length?'in_progress':'pending',reason:voiceDone?'当前逐句音频已检查选用；音色、台词及实测时长可查，不表示已对口型。':'设置声音卡和台词，导入或生成后逐句检查、选用。'});
  const edit=app.production?read('editing',()=>app.production.edit.view(projectId),null):null;
  const editExport=edit?.exports?.find(t=>t.versionId===edit.activeVersionId&&t.status==='succeeded');
  const editFile=editExport?read('edit-export',()=>app.production.edit.file(editExport.id),null):null;
  agents.push({id:'editing',status:edit?.stale?'needs_review':editFile?'completed':edit?.activeVersionId?'in_progress':steps.find(s=>s.id==='export').status,reason:editFile?'当前剪辑版本已导出实际文件；仍需人工检查成片。':'编排当前素材、声音与字幕；草稿创建、剪映打开和导出分别核验。'});
  return { projectId, projectRevision: project.revision, projectUpdatedAt: project.updatedAt, steps, agents, thumbnailUrl: thumbnail?.url ?? null, nextStep: steps.find(step => step.status !== 'completed')?.id ?? 'export', warnings, testFixture: Boolean(images?.assets?.some(asset => asset.source?.kind === 'test') || videos?.assets?.some(asset => asset.testFixture)), formalStageStatus: 'not_checked', formalStageMessage: '步骤完成仅表示当前工作台资料已保存或人工选用，不是正式四岗位PASS。' };
}
