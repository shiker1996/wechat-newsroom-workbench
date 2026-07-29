import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mermaidConfigForTheme, mermaidSourceWithTheme } from '../../../lib/llm/chart-theme.mjs';

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node render-mermaid.mjs <input.md> <output.md> [imageDir]');
  process.exit(0);
}
if (args.length < 2) {
  console.error('Input and output Markdown paths are required.');
  process.exit(2);
}

const input = path.resolve(args[0]);
const output = path.resolve(args[1]);
const imageDir = path.resolve(args[2] || path.join(path.dirname(output), 'images'));
const tokens = args[3] && fs.existsSync(path.resolve(args[3])) ? JSON.parse(fs.readFileSync(path.resolve(args[3]), 'utf8')) : {};

function fail(message) {
  console.log(JSON.stringify({ converted: 0, failed: [], error: message }));
  process.exit(2);
}

if (!fs.existsSync(input) || !fs.statSync(input).isFile()) fail(`Input file not found: ${input}`);

const FENCE_RE = /```mermaid\b[^\n]*\r?\n([\s\S]*?)```/gi;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const mmdcCandidates = [
  path.join(projectRoot, 'node_modules', '@mermaid-js', 'mermaid-cli', 'src', 'cli.js'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@mermaid-js', 'mermaid-cli', 'src', 'cli.js'),
];
const mmdcCli = mmdcCandidates.find((candidate) => fs.existsSync(candidate)) || '';

// mmdc 自带的 puppeteer 可能找不到它期望的 Chrome 版本；
// 在 puppeteer 缓存里挑一个真实存在的 chrome.exe，通过 -p 配置文件喂给它。
function findChromeExecutable() {
  const programFilesX86 = process.env['ProgramFiles(x86)'] || '';
  const explicitCandidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH || '',
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    programFilesX86 ? path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const explicit = explicitCandidates.find((candidate) => fs.existsSync(candidate));
  if (explicit) return explicit;
  const base = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  if (!fs.existsSync(base)) return '';
  const versions = fs.readdirSync(base)
    .map((dir) => path.join(base, dir, 'chrome-win64', 'chrome.exe'))
    .filter((exe) => fs.existsSync(exe))
    .sort();
  return versions.at(-1) || '';
}

const markdown = fs.readFileSync(input, 'utf8');
const fences = [...markdown.matchAll(FENCE_RE)];
const report = { converted: 0, failed: [], images: [] };

let result = markdown;
if (fences.length) {
  fs.mkdirSync(imageDir, { recursive: true });
  if (!mmdcCli) fail(`未找到 @mermaid-js/mermaid-cli（已检查项目本地依赖和 npm 全局目录）。请运行 npm install -D @mermaid-js/mermaid-cli`);
  const chrome = findChromeExecutable();
  const pptrConfig = path.join(imageDir, '.mmdc-puppeteer-config.json');
  const mermaidConfig = path.join(imageDir, '.mmdc-theme-config.json');
  fs.writeFileSync(mermaidConfig, JSON.stringify(mermaidConfigForTheme(tokens)));
  if (chrome) fs.writeFileSync(pptrConfig, JSON.stringify({ executablePath: chrome, args: ['--no-sandbox'] }));
  for (const [index, fence] of fences.entries()) {
    const name = `mermaid-${index + 1}`;
    const mmdPath = path.join(imageDir, `${name}.mmd`);
    const pngPath = path.join(imageDir, `${name}.png`);
    fs.writeFileSync(mmdPath, mermaidSourceWithTheme(fence[1], tokens) + '\n', 'utf8');
    const mmdcArgs = ['-i', mmdPath, '-o', pngPath, '-c', mermaidConfig, '-b', tokens.colors?.background || 'white', '-w', '1080', '-s', '2'];
    if (chrome) mmdcArgs.push('-p', pptrConfig);
    try {
      // 直接以 node 运行 mmdc 入口，绕开 Windows 下 spawn .cmd 的 EINVAL 限制。
      // Chrome 启动偶发崩溃（尤其多进程并发时），失败后重试一次。
      let lastError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await execFileAsync(process.execPath, [mmdcCli, ...mmdcArgs], { cwd: imageDir, windowsHide: true, timeout: 180000, maxBuffer: 1_000_000 });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (!/Failed to launch the browser/i.test(String(error.stderr || error.message))) break;
        }
      }
      if (lastError) throw lastError;
      if (!fs.existsSync(pngPath) || !fs.statSync(pngPath).size) throw new Error('渲染产物为空');
      const relative = path.relative(path.dirname(output), pngPath).split(path.sep).join('/');
      result = result.replace(fence[0], `![${name}](${relative})`);
      report.images.push(relative);
      report.converted += 1;
    } catch (error) {
      // 单个围栏失败时保留原围栏，不得删除内容
      report.failed.push({ index: index + 1, error: String(error.stderr || error.message).trim().slice(0, 500) });
    }
  }
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const temp = `${output}.tmp`;
fs.writeFileSync(temp, result, 'utf8');
fs.renameSync(temp, output);

// 门禁：替换数量等于成功渲染数量，未处理围栏全部留在 failed 里
const remaining = (result.match(FENCE_RE) || []).length;
if (remaining !== report.failed.length) {
  fail(`围栏数量校验失败：剩余 ${remaining}，失败记录 ${report.failed.length}`);
}
console.log(JSON.stringify(report));
process.exit(report.failed.length ? 1 : 0);
