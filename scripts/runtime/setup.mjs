// 首次安装引导：逐项检测 → 给出修复动作 → 用户确认后执行。
// 幂等可重跑：已完成的项自动跳过；--yes 非交互模式全按默认处理（供 CI/文档引用）。
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 汇总各项安装状态：done 跳过 / pending 待处理 / optional-missing 可选缺失。
export function inspectSetup(root) {
  const hasDeps = fs.existsSync(path.join(root, 'node_modules', 'markdown-it'));
  const configPath = path.join(root, 'config.local.json');
  const hasConfig = fs.existsSync(configPath);
  const rsshubCloned = fs.existsSync(path.join(root, 'RSSHub', 'lib'));
  // 与 scripts/runtime/rsshub-start.ps1 的运行前提一致：本地 tsx 运行时存在才算就绪。
  const rsshubReady = rsshubCloned && fs.existsSync(path.join(root, 'RSSHub', 'node_modules', 'tsx', 'dist', 'cli.mjs'));
  return {
    nodeOk: Number(process.versions.node.split('.')[0]) >= 24,
    deps: hasDeps ? 'done' : 'pending',
    config: hasConfig ? 'done' : 'pending',
    rsshub: rsshubReady ? 'done' : rsshubCloned ? 'deps-missing' : 'optional-missing',
  };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const yes = process.argv.includes('--yes');
  const rl = yes ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (question) => (yes ? '' : (await rl.question(question)).trim());
  const confirm = async (question) => yes || /^(y|yes|是)?$/i.test(await ask(question));

  console.log('见字工作台 · 安装引导');
  const status = inspectSetup(root);
  if (!status.nodeOk) {
    console.error(`[错误] Node.js 需要 24 或更高版本，当前为 ${process.versions.node}，请先升级。`);
    process.exit(1);
  }

  // 1. 依赖安装
  if (status.deps === 'pending') {
    console.log('\n[1/3] 缺少 node_modules 依赖。');
    if (await confirm('  现在运行 npm install？(Y/n) ')) {
      const r = spawnSync('npm', ['install'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
      if (r.status !== 0) { console.error('[错误] npm install 失败，请手动执行后重跑本向导。'); process.exit(1); }
    } else console.log('  已跳过。未安装依赖时工作台无法启动。');
  } else console.log('\n[1/3] 依赖已安装，跳过。');

  // 2. config.local.json
  if (status.config === 'pending') {
    console.log('\n[2/3] 未找到 config.local.json（默认端口 4317）。');
    if (await confirm('  从 config.example.json 复制一份？(Y/n) ')) {
      fs.copyFileSync(path.join(root, 'config.example.json'), path.join(root, 'config.local.json'));
      console.log('  已创建 config.local.json，可稍后按需修改。');
    } else console.log('  已跳过，将使用内置默认配置。');
  } else console.log('\n[2/3] config.local.json 已存在，跳过。');

  // 3. RSSHub（可选）：缺失时直接从 GitHub 浅克隆并安装依赖。
  // eslint 10 与 eslint-nibble 的 peer 声明冲突，统一加 --legacy-peer-deps。
  const installRsshubDeps = () => {
    console.log('  安装 RSSHub 依赖（首次约数分钟）……');
    const install = spawnSync('npm', ['install', '--legacy-peer-deps'], { cwd: path.join(root, 'RSSHub'), stdio: 'inherit', shell: process.platform === 'win32' });
    if (install.status !== 0) console.error('  [警告] RSSHub 依赖安装失败，可稍后进入 RSSHub/ 目录手动执行 npm install --legacy-peer-deps。');
    else console.log('  RSSHub 已就位。');
  };
  if (status.rsshub === 'deps-missing') {
    console.log('\n[3/3] RSSHub 目录已克隆，但依赖未安装，热点采集功能不可用（可选）。');
    if (await confirm('  现在安装 RSSHub 依赖？(Y/n) ')) installRsshubDeps();
    else console.log('  已跳过。需要时可重跑本向导，或进入 RSSHub/ 目录执行 npm install --legacy-peer-deps。');
  } else if (status.rsshub === 'optional-missing') {
    console.log('\n[3/3] 未找到 RSSHub 目录，热点采集功能不可用（可选）。');
    if (await confirm('  现在从 GitHub 克隆 RSSHub 并安装依赖？(Y/n) ')) {
      const gitCheck = spawnSync('git', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' });
      if (gitCheck.status !== 0) {
        console.log('  未找到 git，无法自动克隆。请安装 git 后重跑本向导，或手动克隆 https://github.com/DIYgod/RSSHub 到 RSSHub/ 目录。');
      } else {
        const clone = spawnSync('git', ['clone', '--depth', '1', 'https://github.com/DIYgod/RSSHub.git', 'RSSHub'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
        if (clone.status !== 0) {
          console.error('  [警告] RSSHub 克隆失败（网络原因可稍后重跑本向导，幂等）。');
        } else {
          console.log('  克隆完成。');
          installRsshubDeps();
        }
      }
    } else console.log('  已跳过。需要时可重跑本向导，或手动克隆 https://github.com/DIYgod/RSSHub 到 RSSHub/ 目录。');
  } else console.log('\n[3/3] RSSHub 目录已就位，跳过。');

  rl?.close();
  console.log('\n安装引导完成，最终环境检测：');
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'runtime', 'check-env.mjs')], { cwd: root, stdio: 'inherit' });
  process.exit(r.status ?? 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
