import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { echartsOptionWithTheme } from '../chart-theme.mjs';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node render-echarts.mjs <input.md> <output.md> [imageDir]');
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
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.log(JSON.stringify({ converted: 0, failed: [], error: message }));
  process.exit(2);
}

if (!fs.existsSync(input) || !fs.statSync(input).isFile()) fail(`Input file not found: ${input}`);

// 澶嶇敤 html-pages-to-images 鎶€鑳介噷宸插畨瑁呯殑 puppeteer 涓庢祻瑙堝櫒缂撳瓨
async function loadPuppeteer() {
  try {
    return (await import('puppeteer')).default;
  } catch {
    const require = createRequire(import.meta.url);
    const sibling = path.resolve(skillRoot, '..', 'html-pages-to-images');
    const entry = require.resolve('puppeteer', { paths: [process.cwd(), sibling] });
    const loaded = await import(pathToFileURL(entry).href);
    return loaded.default ?? loaded;
  }
}

function loadEchartsSource() {
  // The plugin is distributed independently of the project skills. Keep the
  // browser bundle inside this package so installed plugins do not reach back
  // into the workspace to resolve a private skill dependency.
  const bundled = path.join(skillRoot, 'echarts.min.txt');
  if (!fs.existsSync(bundled)) throw new Error(`插件包缺少 ECharts 运行时：${path.basename(bundled)}`);
  return fs.readFileSync(bundled, 'utf8');
}

const FENCE_RE = /```echarts\b[^\n]*\r?\n([\s\S]*?)```/gi;
const MAX_OPTION_CHARS = 200_000;

const markdown = fs.readFileSync(input, 'utf8');
const fences = [...markdown.matchAll(FENCE_RE)];
const report = { converted: 0, failed: [], images: [] };

let result = markdown;
if (fences.length) {
  fs.mkdirSync(imageDir, { recursive: true });
  const puppeteer = await loadPuppeteer();
  const echartsSource = loadEchartsSource();
  // Chrome 启动偶发崩溃（尤其多进程并发时），失败后重试一次。
  let browser = null;
  for (let attempt = 0; attempt < 2 && !browser; attempt += 1) {
    try {
      browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    } catch (error) {
      if (attempt === 1 || !/Failed to launch the browser/i.test(String(error.message))) throw error;
    }
  }
  try {
    for (const [index, fence] of fences.entries()) {
      const name = `echarts-${index + 1}`;
      const pngPath = path.join(imageDir, `${name}.png`);
      try {
        const raw = fence[1].trim();
        if (raw.length > MAX_OPTION_CHARS) throw new Error(`閰嶇疆瓒呰繃 ${MAX_OPTION_CHARS} 瀛楃涓婇檺`);
        // 只接收 JSON 配置，不执行来源不明的任意 JavaScript。
        const option = JSON.parse(raw);
        if (!option || typeof option !== 'object' || Array.isArray(option)) throw new Error('閰嶇疆蹇呴』鏄?JSON 瀵硅薄');
        const themedOption = echartsOptionWithTheme(option, tokens);
        const optionJson = JSON.stringify(themedOption).replace(/</g, '\\u003c');
        const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:${themedOption.backgroundColor}">`
          + `<div id="chart" style="width:1080px;height:675px"></div>`
          + `<script>${echartsSource}</script>`
          + `<script>window.__chartDone=false;const chart=echarts.init(document.getElementById('chart'));`
          + `chart.on('finished',()=>{window.__chartDone=true;});chart.setOption(${optionJson});</script>`
          + `</body></html>`;
        const page = await browser.newPage();
        try {
          await page.setViewport({ width: 1100, height: 695, deviceScaleFactor: 2 });
          await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
          await page.waitForFunction('window.__chartDone===true', { timeout: 15000 });
          const element = await page.$('#chart');
          await element.screenshot({ path: pngPath });
        } finally {
          await page.close();
        }
        if (!fs.existsSync(pngPath) || !fs.statSync(pngPath).size) throw new Error('娓叉煋浜х墿涓虹┖');
        const relative = path.relative(path.dirname(output), pngPath).split(path.sep).join('/');
        result = result.replace(fence[0], `![${name}](${relative})`);
        report.images.push(relative);
        report.converted += 1;
      } catch (error) {
        // 单个围栏失败时保留原围栏和错误信息，不得用空白图片替换。
        report.failed.push({ index: index + 1, error: String(error.message).trim().slice(0, 500) });
      }
    }
  } finally {
    await browser.close();
  }
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const temp = `${output}.tmp`;
fs.writeFileSync(temp, result, 'utf8');
fs.renameSync(temp, output);

const remaining = (result.match(FENCE_RE) || []).length;
if (remaining !== report.failed.length) {
  fail(`围栏数量校验失败：剩余 ${remaining}，失败记录 ${report.failed.length}`);
}
console.log(JSON.stringify(report));
process.exit(report.failed.length ? 1 : 0);
