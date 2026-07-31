// 发布打包：git archive 当前 HEAD → dist/<name>-<version>.zip，并生成 SHA256SUMS.txt。
// 完整发布、升级、降级与备份恢复流程见 docs/release.md。
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (dirty) console.warn('警告：工作区有未提交改动，发布包将基于 HEAD 而非工作区。');

const distDir = 'dist';
fs.mkdirSync(distDir, { recursive: true });

const base = `${pkg.name}-${pkg.version}`;
const zipPath = path.join(distDir, `${base}.zip`);
execFileSync('git', ['archive', '--format=zip', '-o', zipPath, 'HEAD'], { stdio: 'inherit' });

const sum = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
const sumsPath = path.join(distDir, 'SHA256SUMS.txt');
fs.writeFileSync(sumsPath, `${sum}  ${base}.zip\n`);

console.log(`发布包：${zipPath}`);
console.log(`校验和：${sumsPath}`);
console.log(`sha256(${base}.zip) = ${sum}`);
