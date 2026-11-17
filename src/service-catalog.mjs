// Public documentation describes catalog capabilities, not this account's access.
export const CATEGORIES = ['text', 'image', 'video', 'voice'];
export const CAPABILITY_REVISION = '2026-11-17.1';
const provider = (id, name, categories, auth, source, extra = {}) => ({ id, name, categories, auth, source, ...extra });
export const SERVICE_PROVIDERS = [
  provider('deepseek', 'DeepSeek 官方 API', ['text'], 'api-key', 'https://api-docs.deepseek.com/api/create-response/'),
  provider('openai', 'OpenAI API', ['text', 'image'], 'api-key', 'https://developers.openai.com/api/docs/guides/image-generation'),
  provider('codex-cli', '本机 Codex', ['text'], 'local-login', 'https://developers.openai.com/codex/cli/'),
  provider('chatgpt-siwc', 'Sign in with ChatGPT（文字）', ['text'], 'oauth', 'https://developers.openai.com/siwc/token-sharing-open-source', { requiresOwnOAuth:true, textOnly:true }),
  provider('seedream', 'Seedream · 火山方舟', ['image'], 'api-key', 'https://docs.volcengine.com/docs/ark/image-generation-tutorial?lang=zh'),
  provider('wan-bailian', 'Wan 3.0 · 百炼', ['video'], 'api-key', 'https://help.aliyun.com/zh/model-studio/wan3-video-generation-guide'),
  provider('seedance', 'Seedance 2.5 · 火山方舟', ['video'], 'api-key', 'https://docs.volcengine.com/docs/ark/seedance-2-5?lang=zh'),
  provider('minimax-h3', 'MiniMax H3 官方 API', ['video'], 'api-key', 'https://platform.minimax.io/docs/api-reference/video-generation-v2-create'),
  provider('minimax-speech', 'MiniMax Speech', ['voice'], 'api-key', 'https://platform.minimax.io/docs/api-reference/speech-t2a-http.md'),
  provider('elevenlabs', 'ElevenLabs', ['voice'], 'api-key', 'https://elevenlabs.io/docs/api-reference/text-to-speech/convert'),
  provider('indextts', 'IndexTTS 本地', ['voice'], 'local-runtime', 'https://github.com/index-tts/index-tts', { blocker: '需配置已启动服务、模型版本及经核验的本地适配契约；不会下载权重。' }),
  provider('qwen3-tts', 'Qwen3-TTS 本地', ['voice'], 'local-runtime', 'https://github.com/QwenLM/Qwen3-TTS', { blocker: '需配置已启动服务、模型版本及经核验的本地适配契约；不会下载权重。' }),
  provider('comfyui', 'ComfyUI 运行后台', ['video'], 'local-runtime', 'https://docs.comfy.org/development/comfyui-server/comms_routes', { blocker: '尚无本项目核验工作流；模型和工作流不可互相替代。' }),
  provider('wangp', 'WanGP 运行后台', ['video'], 'local-runtime', 'https://github.com/deepbeepmeep/WanGP', { blocker: '尚无本项目核验工作流；不能推断支持 Wan 3.0 或 H3。' }),
  provider('external-import', '外部生成后手工导入', ['image'], 'none', null),
];
const model = (provider, category, id, label, capabilities = {}) => ({ provider, category, id, label, capabilities, capabilityRevision: CAPABILITY_REVISION, accountAvailability: 'not_verified', pricing: { status: 'unknown', amount: null, unit: null, source: null } });
export const MODEL_CATALOG = [
  model('deepseek','text','deepseek-flash','DeepSeek Flash',{ structuredOutput:true }),
  model('deepseek','text','deepseek-v4-pro','DeepSeek V4 Pro',{ structuredOutput:true }),
  model('openai','text','account-catalog','从账号模型目录选择',{ requiresAccountCatalog:true }),
  model('codex-cli','text','local-default','Codex 当前本机配置',{ freshSession:true, usage:'subscription_unknown' }),
  model('chatgpt-siwc','text','account-catalog','授权后从可见模型目录选择',{ textOnly:true, requiresAccountCatalog:true, images:false }),
  model('openai','image','gpt-image-2.5-sunburst','GPT Image 2.5 Sunburst',{ references:true }),
  model('openai','image','gpt-image-2.5-flare','GPT Image 2.5 Flare',{ references:true }),
  model('seedream','image','doubao-seedream-5-5-261028','Seedream 5.5',{ references:true }),
  model('wan-bailian','video','wan3.0-video','Wan 3.0',{ durations:[2,30], resolutions:['480P','720P','1080P'], referenceModeExclusive:true }),
  model('wan-bailian','video','wan3.0-video-prime','Wan 3.0 Prime',{ durations:[2,30], resolutions:['480P','720P','1080P'], referenceModeExclusive:true }),
  model('seedance','video','doubao-seedance-2-5-260628','Seedance 2.5 标准',{ durations:[4,30], resolutions:['480p','720p','1080p','4k'], firstFrameRatio:'adaptive', referenceModeExclusive:true, highResolutionCodec:'HEVC 10bit at 1080p/4k; browser decode must be checked' }),
  model('seedance','video','doubao-seedance-2-5-flash-261115','Seedance 2.5 Flash',{ durations:[4,30], resolutions:['480p','720p'], firstFrameRatio:'adaptive', referenceModeExclusive:true }),
  model('minimax-h3','video','MiniMax-H3','MiniMax H3',{ durations:[4,15], resolutions:['768P','2K'], referenceModeExclusive:true }),
  model('minimax-speech','voice','speech-2.8-hd','MiniMax Speech 2.8 HD',{ emotion:true, whisper:false, fluent:false }),
  model('minimax-speech','voice','speech-2.8-turbo','MiniMax Speech 2.8 Turbo',{ emotion:true, whisper:false, fluent:false }),
  model('elevenlabs','voice','eleven_multilingual_v2','Eleven Multilingual v2',{ voiceIdRequired:true }),
  model('indextts','voice','index-tts-2.5','IndexTTS 2.5',{ runtimeRequired:true }),
  model('qwen3-tts','voice','Qwen3-TTS-12Hz-1.7B-CustomVoice','Qwen3-TTS CustomVoice',{ runtimeRequired:true }),
];
export function receiptSucceeded(receipt) {
  if (!receipt || receipt.completed !== true || receipt.error) return false;
  if (receipt.transport === 'http') return ['response.status','response.completed'].includes(receipt.completionEvidence?.type) && receipt.completionEvidence?.status === 'completed' && receipt.httpStatus >= 200 && receipt.httpStatus < 300;
  return receipt.exitCode === 0; // Legacy CLI receipts remain valid under their original contract.
}
