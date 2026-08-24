// 渲染全部内置文章/图文主题的正式样稿截图与密度报告，供主题视觉审查使用。
// 用法：node scripts/media/render-theme-review.mjs [输出目录]
// 依赖 puppeteer（从 html-pages-to-images 技能目录解析，与 layout-audit.mjs 相同策略）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileThemePreview } from '../../server/platform/application/themes/theme-preview.mjs';
import { socialThemeDefinition } from '../../server/shared/themes/social-theme-compiler.mjs';
import { articleThemeDefinition } from '../../server/shared/themes/article-theme-compiler.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.resolve(process.argv[2] || path.join(root, 'docs/archive/audits/theme-ux/review'));
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

const listDir = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.basename(f, '.json'));
const socialIds = listDir(path.join(root, 'themes/social'));
const articleIds = listDir(path.join(root, 'themes/article'));

const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const summary = { social: {}, article: {} };
try {
  const page = await browser.newPage();
  for (const id of socialIds) {
    const definition = structuredClone(socialThemeDefinition(id));
    delete definition.hash; delete definition.file;
    const html = compileThemePreview({ target: 'social', definition }).html;
    const htmlPath = path.join(outDir, `social-${id}.html`);
    fs.writeFileSync(htmlPath, html, 'utf8');
    await page.setViewport({ width: 440, height: 720, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });
    await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
    const pages = await page.$$('.page');
    for (let i = 0; i < pages.length; i += 1) {
      const kind = await pages[i].evaluate((el) => el.dataset.pageKind || (el.classList.contains('page-cover') ? 'cover' : 'content'));
      await pages[i].screenshot({ path: path.join(outDir, `social-${id}-p${i + 1}-${kind}.png`) });
    }
    summary.social[id] = {
      recipes: definition.social?.recipes || {},
      pages: pages.length,
    };
  }
  for (const id of articleIds) {
    const definition = structuredClone(articleThemeDefinition(id));
    delete definition.hash; delete definition.file;
    const html = compileThemePreview({ target: 'article', definition }).html;
    const htmlPath = path.join(outDir, `article-${id}.html`);
    fs.writeFileSync(htmlPath, html, 'utf8');
    await page.setViewport({ width: 820, height: 1200, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });
    await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
    const article = await page.$('body>article');
    await article.screenshot({ path: path.join(outDir, `article-${id}.png`), captureBeyondViewport: true });
    summary.article[id] = { recipes: definition.article?.recipes || {} };
  }
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(outDir, 'assignments.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(`done -> ${outDir}`);
