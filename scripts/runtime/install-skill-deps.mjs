// 级联安装技能目录内的独立依赖（skills/<name>/package.json）。
// 由根 package.json 的 postinstall 触发，npm ci / npm install 后自动执行。
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const skillsDir = path.join(root, 'skills');

const targets = fs.readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsDir, entry.name, 'package.json')))
  .map((entry) => path.join(skillsDir, entry.name));

if (!targets.length) {
  console.log('技能目录没有独立依赖需要安装');
  process.exit(0);
}

for (const dir of targets) {
  const name = path.basename(dir);
  try {
    execSync('npm install --no-audit --no-fund --loglevel=error', { cwd: dir, stdio: 'inherit' });
    console.log(`技能依赖已就绪：${name}`);
  } catch (error) {
    // 渲染类技能（Puppeteer Chromium 下载）离线时可能失败；不阻断根安装，运行时对应功能降级
    console.warn(`技能依赖安装失败（可稍后在该目录重试 npm install）：${name} — ${error.message}`);
  }
}
