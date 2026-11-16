import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve('public'), files = fs.readdirSync(root), failures = [];
for (const name of files.filter(name => name.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, name)], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) failures.push(`${name}: ${result.stderr}`);
  const text = fs.readFileSync(path.join(root, name), 'utf8');
  for (const match of text.matchAll(/(?:from\s*|import\s*)['"](\.\/[^'"]+)['"]/g)) if (!fs.existsSync(path.resolve(root, match[1]))) failures.push(`${name}: missing ${match[1]}`);
}
for (const name of files.filter(name => name.endsWith('.html'))) {
  const text = fs.readFileSync(path.join(root, name), 'utf8');
  if (!text.includes('/studio.css')) failures.push(`${name}: shared design stylesheet missing`);
  for (const match of text.matchAll(/(?:src|href)=["'](\/(?!api\/)[^"'?]+)["']/g)) if (!fs.existsSync(path.join(root, match[1]))) failures.push(`${name}: missing ${match[1]}`);
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`UI check passed: ${files.filter(name => name.endsWith('.js')).length} JavaScript modules and ${files.filter(name => name.endsWith('.html')).length} real application pages; imports and local assets resolved.`);
