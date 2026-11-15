import { resolveExecutable, runProbe } from './tools.mjs';

// Detection only: no generation, API request, authorization flow or credential read.
export async function inspectImageCapabilities({ resolve = resolveExecutable, probe = runProbe } = {}) {
  const binary = resolve('codex');
  const commands = [['--version'], ['login', 'status'], ['features', 'list'], ['exec', '--help']];
  const results = binary ? await Promise.all(commands.map(args => probe(binary, args, { timeout: 15000 }))) : [];
  const loggedIn = results[1]?.exitCode === 0 && /logged in|已登录/i.test(results[1].output) && !/not logged in/i.test(results[1].output);
  const generationFeature = results[2]?.exitCode === 0 && /^image_generation\s+\S+\s+true\s*$/m.test(results[2].output);
  return {
    checkedAt: new Date().toISOString(), mode: 'manual_export_import', automaticSubmissionEnabled: false,
    codex: { installed: !!binary, version: results[0]?.output.match(/codex-cli\s+(\S+)/)?.[1] ?? null, loggedIn: !!loggedIn, imageGenerationFlagDetected: !!generationFeature,
      capabilityStatus: generationFeature ? 'command_detected_not_generation_verified' : 'not_verified',
      note: generationFeature ? '本机CLI报告image_generation已开启，官方文档提供账号图像创作方式；工作台尚未验证自动执行、产物导出及本次费用，保留手工导出和导入。' : '尚未从本机CLI核实图像执行能力；使用手工导出和导入。',
    },
    evidence: results.map((result, index) => ({ command: `codex ${commands[index].join(' ')}`, exitCode: result.exitCode, timedOut: !!result.timedOut,
      output: result.output.split(/\r?\n/).filter(line => /codex-cli|logged in|已登录|not logged|^image_generation\s|--image|Optional image/i.test(line)).join('\n').slice(0, 3000) })),
    officialSources: [
      { title: 'OpenAI官方图像创作说明', url: 'https://learn.chatgpt.com/docs/image-generation', scope: '账号图像创作与额度说明；不等于已接通工作台图像API' },
      { title: 'OpenAI官方API CLI', url: 'https://developers.openai.com/api/docs/libraries/openai-cli', scope: '文档提供openai images generate；本轮未配置或调用API' },
    ],
    cost: { status: 'unknown', label: '费用待确认', amount: null, unit: null, currency: null, note: '网页权益、Codex账号额度与API计费分别核实；登录或订阅不代表免费。本轮不执行生成。' },
    formalStageStatus: 'not_checked', mediaGenerationStatus: 'not_generated',
  };
}
