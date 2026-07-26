import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
const minArg = process.argv[3] ?? '1300';
const maxArg = process.argv[4] ?? '1800';
const min = Number.parseInt(minArg, 10);
const max = Number.parseInt(maxArg, 10);

if (!file || !Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) {
  console.error('Usage: node count-article-chars.mjs <article.md> [min=1300] [max=1800]');
  process.exit(2);
}

const target = path.resolve(file);
const raw = fs.readFileSync(target, 'utf8');
let visible = raw
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^#\s+.*(?:\r?\n|$)/m, '')
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/https?:\/\/\S+/g, '')
  .replace(/^```[^\r\n]*$/gm, '')
  .replace(/^#{1,6}\s*/gm, '')
  .replace(/^\s*(?:[-*+] |\d+[.)]\s+)/gm, '')
  .replace(/[>*_`~|]/g, '')
  .replace(/\s/g, '');

const count = Array.from(visible).length;
const result = { file: target, visible_chars: count, min, max, valid: count >= min && count <= max };
console.log(JSON.stringify(result));
process.exit(result.valid ? 0 : 1);
