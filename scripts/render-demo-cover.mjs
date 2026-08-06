// 生成 README 演示封面：工作台总览首屏 + 居中播放按钮。
// 用法：node scripts/render-demo-cover.mjs [baseUrl] [输出png]
// 依赖：演示模式服务与 puppeteer（从 html-pages-to-images 技能目录解析）。
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const baseUrl = (process.argv[2] || 'http://127.0.0.1:4400').replace(/\/$/, '');
const outPath = path.resolve(process.argv[3] || path.join(root, 'docs', 'screenshots', 'ui-demo-cover.png'));

async function loadPuppeteer() {
  try {
    return (await import('puppeteer')).default;
  } catch {
    const require = createRequire(import.meta.url);
    const sibling = path.join(root, 'skills', 'html-pages-to-images');
    const entry = require.resolve('puppeteer', { paths: [process.cwd(), sibling] });
    const loaded = await import(pathToFileURL(entry).href);
    return loaded.default ?? loaded;
  }
}

const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
try {
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/#dashboard`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
  await new Promise((r) => setTimeout(r, 2500));
  await page.evaluate(() => {
    const overlay = document.createElement('div');
    overlay.id = 'demo-play-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;pointer-events:none;';
    overlay.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:112px;height:112px;border-radius:50%;background:rgba(0,0,0,0.45);border:4px solid rgba(255,255,255,0.92);box-shadow:0 8px 32px rgba(0,0,0,0.35)">' +
      '<div style="width:0;height:0;border-top:20px solid transparent;border-bottom:20px solid transparent;border-left:32px solid #ffffff;margin-left:6px"></div></div>';
    document.body.appendChild(overlay);
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: outPath });
} finally {
  await browser.close();
}
console.log(`cover -> ${outPath}`);
