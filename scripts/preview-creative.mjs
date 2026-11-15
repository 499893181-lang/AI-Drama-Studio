// Offline stdout preview only: no model calls, media submission or data/ writes.
import fs from 'node:fs';
import { loadCreativeKnowledge, listStylePresets, compileShotDesign } from '../src/creative-design.mjs';

const args = process.argv.slice(2);
try {
  const knowledge = loadCreativeKnowledge();
  if (args[0] === '--list') {
    process.stdout.write(JSON.stringify(listStylePresets(knowledge).map(({ id, directorName, label, referenceWorks }) => ({ id, directorName, label, referenceWorks })), null, 2) + '\n');
  } else if (!args[0] || args.length > 2 || args[0].startsWith('--')) {
    process.stderr.write('用法：node scripts/preview-creative.mjs --list\n或：node scripts/preview-creative.mjs <镜头JSON路径> [作品级预设ID]\n');
    process.exitCode = 2;
  } else {
    const input = JSON.parse(fs.readFileSync(args[0], 'utf8'));
    if (args[1]) input.stylePresetId = args[1];
    const result = compileShotDesign(input, knowledge);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.structuralStatus === 'blocked') process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(JSON.stringify({ code: error.code ?? 'preview_failed', message: error.message }) + '\n');
  process.exitCode = 1;
}
