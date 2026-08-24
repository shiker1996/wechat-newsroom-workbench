// 渲染工作台主要视图的整页截图，用于 README / 渠道物料。
// 用法：node scripts/media/render-ui-shots.mjs [baseUrl] [输出目录]
// 依赖：演示模式服务（npm start -- --demo）与 puppeteer（从 html-pages-to-images 技能目录解析）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const baseUrl = (process.argv[2] || 'http://127.0.0.1:4400').replace(/\/$/, '');
const outDir = path.resolve(process.argv[3] || path.join(root, 'docs', 'screenshots'));
fs.mkdirSync(outDir, { recursive: true });

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const page = await browser.newPage();

async function activeBatchId() {
  const res = await page.evaluate(async () => {
    const response = await fetch('/api/batches?limit=5');
    const batches = await response.json();
    return batches.length ? batches[0].id : null;
  });
  return res;
}

const shots = [
  { view: 'dashboard', file: 'ui-dashboard.png', needBatch: false, settleMs: 2500 },
  { view: 'overview', file: 'ui-atlas.png', needBatch: true, settleMs: 3500 },
  { view: 'topics', file: 'ui-topics.png', needBatch: true, settleMs: 2500 },
  { view: 'social-topics', file: 'ui-social-topics.png', needBatch: true, settleMs: 2500 },
  { view: 'artifacts', file: 'ui-artifacts.png', needBatch: false, settleMs: 2000 },
];

try {
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/#dashboard`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
  await sleep(2000);
  const batchId = await activeBatchId();
  console.log(`batch: ${batchId}`);

  for (const shot of shots) {
    if (shot.needBatch && batchId) {
      try { await page.select('#batch-switcher', batchId); } catch { /* 切换器未就绪时忽略 */ }
    }
    await page.evaluate((view) => { if (window.go) window.go(view); else location.hash = `#${view}`; }, shot.view);
    await sleep(shot.settleMs);
    const target = path.join(outDir, shot.file);
    await page.screenshot({ path: target, fullPage: true });
    const size = fs.statSync(target).size;
    console.log(`${shot.file} (${Math.round(size / 1024)} KB)`);
  }
} finally {
  await browser.close();
}
console.log(`done -> ${outDir}`);
