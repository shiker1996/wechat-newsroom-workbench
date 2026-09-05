import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stylesRoot = path.join(root, 'public', 'styles');
const generatedRoot = path.join(root, 'public', 'assets', 'styles');
const styleVersion = '20260905-css-split-8';

function readStyle(name) {
  return fs.readFileSync(path.join(stylesRoot, name), 'utf8').replace(/\s+$/, '');
}

function writeGenerated(name, parts) {
  fs.mkdirSync(generatedRoot, { recursive: true });
  const content = `${parts.map(readStyle).join('\n\n')}\n`;
  fs.writeFileSync(path.join(generatedRoot, name), content, 'utf8');
  return content;
}

// The browser loads this small common bundle first, then route bundles on demand.
const generated = {
  'common.css': writeGenerated('common.css', ['tokens-base.css', 'chrome.css', 'production.css']),
  'social.css': writeGenerated('social.css', ['social-card.css']),
  'topics.css': writeGenerated('topics.css', ['topics-accessibility.css']),
  'editor.css': writeGenerated('editor.css', ['editor-themes.css']),
  'system.css': writeGenerated('system.css', ['system-console.css']),
};
console.log(`按需样式已生成：${Object.entries(generated).map(([name, content]) => `${name} ${(Buffer.byteLength(content) / 1024).toFixed(1)} KB`).join(', ')}（版本 ${styleVersion}）`);
