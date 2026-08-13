import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mermaidConfigForTheme, mermaidSourceWithTheme } from '../chart-theme.mjs';

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

// mmdc 鑷甫鐨?puppeteer 鍙兘鎵句笉鍒板畠鏈熸湜鐨?Chrome 鐗堟湰锛?
// 鍦?puppeteer 缂撳瓨閲屾寫涓€涓湡瀹炲瓨鍦ㄧ殑 chrome.exe锛岄€氳繃 -p 閰嶇疆鏂囦欢鍠傜粰瀹冦€?
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
  if (!mmdcCli) fail(`鏈壘鍒?@mermaid-js/mermaid-cli锛堝凡妫€鏌ラ」鐩湰鍦颁緷璧栧拰 npm 鍏ㄥ眬鐩綍锛夈€傝杩愯 npm install -D @mermaid-js/mermaid-cli`);
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
      // 鐩存帴浠?node 杩愯 mmdc 鍏ュ彛锛岀粫寮€ Windows 涓?spawn .cmd 鐨?EINVAL 闄愬埗銆?
      // Chrome 鍚姩鍋跺彂宕╂簝锛堝挨鍏跺杩涚▼骞跺彂鏃讹級锛屽け璐ュ悗閲嶈瘯涓€娆°€?
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
      if (!fs.existsSync(pngPath) || !fs.statSync(pngPath).size) throw new Error('娓叉煋浜х墿涓虹┖');
      const relative = path.relative(path.dirname(output), pngPath).split(path.sep).join('/');
      result = result.replace(fence[0], `![${name}](${relative})`);
      report.images.push(relative);
      report.converted += 1;
    } catch (error) {
      // 鍗曚釜鍥存爮澶辫触鏃朵繚鐣欏師鍥存爮锛屼笉寰楀垹闄ゅ唴瀹?
      report.failed.push({ index: index + 1, error: String(error.stderr || error.message).trim().slice(0, 500) });
    }
  }
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const temp = `${output}.tmp`;
fs.writeFileSync(temp, result, 'utf8');
fs.renameSync(temp, output);

// 闂ㄧ锛氭浛鎹㈡暟閲忕瓑浜庢垚鍔熸覆鏌撴暟閲忥紝鏈鐞嗗洿鏍忓叏閮ㄧ暀鍦?failed 閲?
const remaining = (result.match(FENCE_RE) || []).length;
if (remaining !== report.failed.length) {
  fail(`鍥存爮鏁伴噺鏍￠獙澶辫触锛氬墿浣?${remaining}锛屽け璐ヨ褰?${report.failed.length}`);
}
console.log(JSON.stringify(report));
process.exit(report.failed.length ? 1 : 0);

