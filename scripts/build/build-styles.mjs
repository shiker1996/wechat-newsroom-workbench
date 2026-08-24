import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stylesRoot = path.join(root, 'public', 'styles');
const bundlePath = path.join(root, 'public', 'styles.css');
const sources = [
  'tokens-base.css',
  'social-card.css',
  'production.css',
  'topics-accessibility.css',
  'editor-themes.css',
  'system-console.css',
];

const bundle = `${sources.map((name) => fs.readFileSync(path.join(stylesRoot, name), 'utf8').replace(/\s+$/, '')).join('\n\n')}\n`;
fs.writeFileSync(bundlePath, bundle, 'utf8');
console.log(`样式 bundle 已生成：${sources.length} 个分片 -> ${path.relative(root, bundlePath)}`);
