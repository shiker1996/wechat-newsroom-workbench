#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const inputArg = process.argv[2];
if (!inputArg || inputArg === '--help' || inputArg === '-h') {
  console.log('Usage: node md-render.js <input.md> [output.rendered.md]');
  process.exit(inputArg ? 0 : 1);
}

const input = path.resolve(inputArg);
const output = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(path.dirname(input), `${path.basename(input, path.extname(input))}.rendered.md`);

if (!fs.existsSync(input) || !fs.statSync(input).isFile()) fail(`Input file not found: ${input}`);
const content = fs.readFileSync(input, 'utf8');
if (!content.trim()) fail(`Input file is empty: ${input}`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, content, 'utf8');
if (!fs.statSync(output).size) fail(`Output file is empty: ${output}`);
console.log(output);
