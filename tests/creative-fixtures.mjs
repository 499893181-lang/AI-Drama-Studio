// Isolated software-test data. It never represents a real Codex or media result.
export const fixtureIdea = '阴天傍晚，穿灰蓝长衫的独居老人给离家的女儿留一杯茶。收到她报平安的语音后，他把空椅子拉近桌边，温暖结尾。只有老人出镜。';
export const fixtureSubject = 'CHAR-01，老人，灰蓝长衫';
export const fixtureEntities = [
  { id: 'CHAR-01', type: 'character', version: 'v1', description: '独居老人，灰蓝长衫；用户锁定。', source: 'user' },
  { id: 'SCENE-01', type: 'scene', version: 'v1', description: '家中桌边，阴天傍晚。', source: 'user' },
  { id: 'PROP-01', type: 'prop', version: 'v1', description: '茶杯与空椅子。', source: 'user' },
];
const moments = ['老人把茶杯放到空椅子前', '老人听到女儿报平安的语音', '老人把空椅子拉近桌边并微笑'];
export const fixtureScript = () => ({
  body: '【隔离软件测试夹具，非真实模型输出】\n0–10秒：阴天傍晚，灰蓝长衫老人把茶杯放到空椅子前。\n10–20秒：老人听到女儿报平安的语音，轻轻放松。\n20–30秒：老人把空椅子拉近桌边并微笑。只有老人出镜，温暖结尾。',
  entities: structuredClone(fixtureEntities), addedSettings: ['【夹具补充】窗侧柔光；仅供软件测试。'],
  shotSeeds: moments.map((moment, i) => ({
    id: `SHOT-0${i + 1}`, purpose: ['建立等待', '等待得到回应', '温暖结尾'][i], moment,
    subject: fixtureSubject, action: moment, durationSeconds: 10,
    entityRefs: fixtureEntities.map(({ id, version }) => ({ id, version })), weather: '阴天', timeOfDay: '傍晚',
  })),
});
export const fixtureShots = () => fixtureScript().shotSeeds.map(seed => ({
  ...seed, framing: '中景', emotion: '含蓄温暖', composition: '老人和空椅子同框',
  foreground: '桌边', midground: '老人与茶杯', background: '窗外庭院', focus: '老人与茶杯',
  lighting: { source: '阴天窗光', direction: '窗侧照入', softness: '柔和散射光' },
  materials: ['洗旧的灰蓝粗布'], palette: '灰蓝和暖灰', avoid: ['不新增出镜人物'],
  camera: { motionId: 'CAM_FIXED', start: seed.moment, end: seed.moment, path: { mode: 'none', description: '固定机位，无位移' }, speed: '固定', subjectMotion: seed.action, environmentMotion: '静止', viewpoint: '平视', stability: '稳定机位', focalChange: '固定焦距', focusPlan: { start: '茶杯', transition: '随动作转向老人', end: '老人' } },
  postSound: '女儿语音与轻微杯碟声留待后期；当前不生成声音。',
}));
export const fixtureStoryboard = () => ({ shots: fixtureShots(), notes: '隔离软件测试夹具；不是实际分镜生成成功证据。' });
export const fixtureReview = () => ({
  verdict: 'PASS', summary: '隔离独立审阅显示夹具，不代表模型或正式岗位通过。',
  criteria: ['user_requirements', 'motivation', 'logic', 'duration', 'continuity', 'production'].map(id => ({ id, verdict: 'PASS', evidence: '隔离夹具：仅验证逐项证据显示、快照及版本关联。', issues: [] })),
  issues: [], estimatedDurationSeconds: 30, durationBasis: '隔离常量30秒，不是真实估计或媒体实测。',
});
export function fixtureResult(schema) {
  if (schema?.properties?.criteria) return fixtureReview();
  if (schema?.properties?.shotSeeds) return fixtureScript();
  if (schema?.properties?.shots) return fixtureStoryboard();
  throw new Error('隔离测试未识别当前输出Schema，拒绝伪造结果。');
}
export function isolatedRunner(calls = []) {
  return async options => {
    calls.push(options);
    const threadId = `fixture-thread-${calls.length}`;
    options.onEvent?.({ type: 'thread.started', thread_id: threadId });
    options.onEvent?.({ type: 'turn.started' });
    const result = fixtureResult(options.schema);
    options.onEvent?.({ type: 'turn.completed', usage: { input_tokens: 0, output_tokens: 0 } });
    return { exitCode: 0, completed: true, finalMessage: JSON.stringify(result), threadId, usage: { input_tokens: 0, output_tokens: 0 }, raw: 'isolated-software-test' };
  };
}
