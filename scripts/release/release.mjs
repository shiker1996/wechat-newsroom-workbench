// 发布打包：git archive 当前 HEAD → dist/<name>-<version>.zip，并生成 SHA256SUMS.txt。
// 完整发布、升级、降级与备份恢复流程见 docs/release.md。
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'), 'utf8'));
const headPkg=JSON.parse(execFileSync('git',['show','HEAD:package.json'],{encoding:'utf8'}));
if(headPkg.version!==pkg.version)throw new Error(`工作区版本 ${pkg.version} 与 HEAD 版本 ${headPkg.version} 不一致，拒绝发布`);

const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (dirty) console.warn('警告：工作区有未提交改动，发布包将基于 HEAD 而非工作区。');

const distDir = path.resolve(root,'dist');
if(path.dirname(distDir)!==root)throw new Error('dist 路径越界');
if(fs.existsSync(distDir))for(const name of fs.readdirSync(distDir))fs.rmSync(path.join(distDir,name),{recursive:true,force:true});
else fs.mkdirSync(distDir, { recursive: true });

const base = `${pkg.name}-${pkg.version}`;
const zipPath = path.join(distDir, `${base}.zip`);
execFileSync('git', ['archive', '--format=zip', '-o', zipPath, 'HEAD'], { stdio: 'inherit' });

const sum = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
const artifacts=fs.readdirSync(distDir).filter((name)=>name!=='SHA256SUMS.txt'&&fs.statSync(path.join(distDir,name)).isFile()).sort();
const sums=artifacts.map((name)=>`${crypto.createHash('sha256').update(fs.readFileSync(path.join(distDir,name))).digest('hex')}  ${name}`).join('\n');
const sumsPath = path.join(distDir, 'SHA256SUMS.txt');
fs.writeFileSync(sumsPath, `${sums}\n`);

console.log(`发布包：${zipPath}`);
console.log(`校验和：${sumsPath}`);
console.log(`sha256(${base}.zip) = ${sum}`);
