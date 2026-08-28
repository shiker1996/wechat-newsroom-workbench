import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

function usage() {
  console.log('Usage: node browser-inspect.mjs <design.html> [--page pageNumber]');
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}
const inputArg = args.find((arg) => !arg.startsWith('--'));
const pageIndex = args.indexOf('--page');
const requestedPage = pageIndex >= 0 ? Number.parseInt(args[pageIndex + 1], 10) : null;
if (!inputArg) {
  usage();
  process.exit(2);
}

const input = path.resolve(inputArg);
if (!fs.existsSync(input) || !fs.statSync(input).isFile()) {
  console.error(`HTML file not found: ${input}`);
  process.exit(2);
}

async function loadPuppeteer() {
  try {
    return (await import('puppeteer')).default;
  } catch {
    const require = createRequire(import.meta.url);
    const sibling = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'html-pages-to-images');
    const entry = require.resolve('puppeteer', { paths: [process.cwd(), sibling] });
    const loaded = await import(pathToFileURL(entry).href);
    return loaded.default ?? loaded;
  }
}

const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
let result;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 667, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(input).href, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
  result = await page.evaluate((targetPage) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const selectorFor = (element) => element.tagName.toLowerCase()
      + (element.id ? `#${element.id}` : '')
      + (element.className && typeof element.className === 'string'
        ? `.${element.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.')}`
        : '');
    const round = (value) => Math.round(Number(value) * 10) / 10;
    const pages = [...document.querySelectorAll('.page')].map((pageElement, index) => {
      const pageRect = pageElement.getBoundingClientRect();
      const body = pageElement.querySelector(':scope > .page-inner > .page-body, :scope > .page-body, .page-body') || pageElement;
      const bodyRect = body.getBoundingClientRect();
      const elements = [...body.querySelectorAll('*')].filter(visible).slice(0, 80).map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          selector: selectorFor(element),
          text: element.textContent?.trim().slice(0, 120) || '',
          rect: { x: round(rect.x - pageRect.x), y: round(rect.y - pageRect.y), width: round(rect.width), height: round(rect.height) },
          display: style.display,
          position: style.position,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          fontWeight: style.fontWeight,
          color: style.color,
          backgroundColor: style.backgroundColor,
          overflow: style.overflow,
        };
      });
      return {
        page: index + 1,
        kind: pageElement.dataset.pageKind || (pageElement.classList.contains('page-cover') ? 'cover' : 'content'),
        rect: { x: round(pageRect.x), y: round(pageRect.y), width: round(pageRect.width), height: round(pageRect.height) },
        bodyRect: { x: round(bodyRect.x - pageRect.x), y: round(bodyRect.y - pageRect.y), width: round(bodyRect.width), height: round(bodyRect.height) },
        scroll: { width: body.scrollWidth, height: body.scrollHeight, clientWidth: body.clientWidth, clientHeight: body.clientHeight },
        elements,
      };
    }).filter((item) => !Number.isInteger(targetPage) || targetPage < 1 || item.page === targetPage);
    return { file: location.href, pageCount: document.querySelectorAll('.page').length, pages };
  }, requestedPage);
} finally {
  await browser.close();
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
