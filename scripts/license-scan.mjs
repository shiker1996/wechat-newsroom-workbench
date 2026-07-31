// 许可证扫描：检查根 package-lock 与技能级 lockfile 中全部依赖的许可证。
// 强 copyleft（GPL/AGPL/LGPL/SSPL）直接失败；未知或许可证缺失列出警告。
import fs from 'node:fs';
import path from 'node:path';

const PERMISSIVE = /^(MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|CC0-1\.0|Unlicense|Python-2\.0|BlueOak-1\.0\.0|CC-BY-3\.0|CC-BY-4\.0|WTFPL|MIT-0|Unicode-DFS-2016|OFL-1\.1)$/i;
// 弱 copyleft（文件级，经 npm 安装且源码随包分发，可接受但记录）
const WEAK_COPYLEFT = /^(MPL-2\.0|EPL-1\.0|EPL-2\.0)$/i;
// 强 copyleft：直接失败
const STRONG_COPYLEFT = /GPL|AGPL|LGPL|SSPL/i;

function classify(expression) {
  const parts = String(expression).replace(/[()]/g, '').split(/\s+(?:AND|OR)\s+/i).map((part) => part.trim()).filter(Boolean);
  let level = 'ok';
  for (const part of parts) {
    if (STRONG_COPYLEFT.test(part)) return 'fail';
    if (PERMISSIVE.test(part)) continue;
    if (WEAK_COPYLEFT.test(part)) { level = 'warn'; continue; }
    level = 'warn';
  }
  return level;
}

const lockfiles = ['package-lock.json',
  ...fs.readdirSync('skills', { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join('skills', entry.name, 'package-lock.json')))
    .map((entry) => path.join('skills', entry.name, 'package-lock.json'))];

const failures = [];
const warnings = [];
let checked = 0;

for (const lockfile of lockfiles) {
  const lock = JSON.parse(fs.readFileSync(lockfile, 'utf8'));
  for (const [name, info] of Object.entries(lock.packages ?? {})) {
    if (!name || info.dev === true && lockfile !== 'package-lock.json') continue;
    if (!name) continue;
    const license = String(info.license ?? info.licenses ?? '').trim();
    if (!license) { warnings.push(`${lockfile} ${name}：未声明许可证`); continue; }
    checked += 1;
    const level = classify(license);
    if (level === 'fail') failures.push(`${lockfile} ${name}：强 copyleft 许可证 ${license}`);
    else if (level === 'warn') warnings.push(`${lockfile} ${name}：弱 copyleft 或未识别许可证 ${license}`);
  }
}

for (const item of warnings) console.warn(`警告：${item}`);
if (failures.length) {
  console.error(`许可证扫描失败，发现 ${failures.length} 个 copyleft 依赖：`);
  for (const item of failures) console.error(`  ${item}`);
  process.exit(1);
}
console.log(`许可证扫描通过：${checked} 个依赖均为宽松许可证（${warnings.length} 个待人工确认）`);
