import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

function usage() {
  console.log('Usage: node layout-audit.mjs <design.html> [--json report.json]');
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}
const inputArg = args.find((arg) => !arg.startsWith('--'));
const jsonIndex = args.indexOf('--json');
const reportArg = jsonIndex >= 0 ? args[jsonIndex + 1] : null;
if (!inputArg || (jsonIndex >= 0 && !reportArg)) {
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
let report;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 667, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(input).href, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });

  const pages = await page.evaluate(() => {
    const thresholds = {
      cover: { min: 0.45, max: 0.90 },
      content: { min: 0.50, max: 0.96 },
      ending: { min: 0.20, max: 0.90 },
    };
    const round = (value) => Math.round(value * 10) / 10;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };

    return [...document.querySelectorAll('.page')].map((pageElement, index) => {
      const kind = pageElement.dataset.pageKind || (pageElement.classList.contains('page-cover') ? 'cover' : 'content');
      const limits = thresholds[kind] || thresholds.content;
      const body = pageElement.querySelector('.page-body');
      const issues = [];
      if (!body) return { page: index + 1, kind, valid: false, issues: ['missing_page_body'] };

      const inner = pageElement.querySelector(':scope > .page-inner');
      if (kind === 'content' && (!inner || inner.children.length !== 3)) {
        issues.push('invalid_page_grid_structure');
      }

      const pageRect = pageElement.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const descendants = [...body.querySelectorAll('*')].filter(visible);
      const stack = body.querySelector(':scope > .page-content-stack');
      if (kind === 'content' && !stack) issues.push('missing_content_stack');
      const direct = stack && visible(stack) ? [stack] : [...body.children].filter(visible);
      if (!direct.length && kind === 'content') issues.push('empty_page_body');

      // stack 自身可能带 min-height 等装饰性高度，直接测其边界会掩盖稀疏内容；
      // 已用区域改测 stack 内可见子元素（eyebrow/标题/内容块）的并集，装饰均为伪元素不参与测量
      const stackChildren = stack && visible(stack) ? [...stack.children].filter(visible) : [];
      const measured = stackChildren.length ? stackChildren : direct;
      const directRects = measured.map((element) => element.getBoundingClientRect());
      const firstTop = directRects.length ? Math.min(...directRects.map((rect) => rect.top)) : bodyRect.top;
      const lastBottom = directRects.length ? Math.max(...directRects.map((rect) => rect.bottom)) : bodyRect.top;
      const usedHeight = Math.max(0, lastBottom - firstTop);
      const utilization = bodyRect.height > 0 ? usedHeight / bodyRect.height : 0;
      const topWhitespace = Math.max(0, firstTop - bodyRect.top);
      const bottomWhitespace = Math.max(0, bodyRect.bottom - lastBottom);
      const scrollOverflow = Math.max(0, body.scrollHeight - body.clientHeight);

      let clippedPixels = 0;
      for (const element of descendants) {
        const rect = element.getBoundingClientRect();
        clippedPixels = Math.max(
          clippedPixels,
          bodyRect.top - rect.top,
          rect.bottom - bodyRect.bottom,
          pageRect.top - rect.top,
          rect.bottom - pageRect.bottom,
          pageRect.left - rect.left,
          rect.right - pageRect.right,
        );
      }
      clippedPixels = Math.max(0, clippedPixels);
      if (scrollOverflow > 1) issues.push('overflow');
      if (clippedPixels > 1) issues.push('clipped');
      if (utilization < limits.min && direct.length) issues.push('underfilled');
      if (utilization > limits.max && scrollOverflow <= 1 && clippedPixels <= 1) issues.push('overfilled');
      const stackStyle = stack && visible(stack) ? getComputedStyle(stack) : null;
      // grid 构图看 align-content，flex 构图看 justify-content；
      // 刻意顶部/底部锚定的构图（hero、data、comp-align-start/end）不做居中平衡要求
      const stackValign = stackStyle
        ? (stackStyle.display.includes('grid') ? stackStyle.alignContent : stackStyle.justifyContent)
        : 'center';
      const centered = kind === 'content' && (body.dataset.valign || 'center') === 'center' && /^(center|normal)$/.test(stackValign);
      const balanceTolerance = Math.max(8, bodyRect.height * 0.03);
      if (centered && direct.length && Math.abs(topWhitespace - bottomWhitespace) > balanceTolerance) {
        issues.push('vertical_imbalance');
      }

      const tooSmallText = descendants.some((element) => {
        if (!element.textContent?.trim()) return false;
        const style = getComputedStyle(element);

        const isCode =
          element.matches('code, pre, kbd, samp') ||
          element.closest('pre, code');
        if (isCode) {
          return false;
        }

        const size = Number.parseFloat(style.fontSize);
        const auxiliary = element.matches('small, [data-text-role="auxiliary"]')
          || [...element.classList].some((name) => /(?:tag|label|caption|meta|date|sub|hint|eyebrow)/i.test(name));
        return size < (auxiliary ? 9 : 11);
      });
      if (tooSmallText) issues.push('text_too_small');

      return {
        page: index + 1,
        kind,
        valid: issues.length === 0,
        utilization: round(utilization * 100),
        target: `${Math.round(limits.min * 100)}-${Math.round(limits.max * 100)}%`,
        bodyHeight: round(bodyRect.height),
        usedHeight: round(usedHeight),
        topWhitespace: round(topWhitespace),
        bottomWhitespace: round(bottomWhitespace),
        verticalBalanceDelta: round(Math.abs(topWhitespace - bottomWhitespace)),
        overflowPixels: round(scrollOverflow),
        clippedPixels: round(clippedPixels),
        issues: [...new Set(issues)],
      };
    });
  });
  report = {
    file: input,
    pageCount: pages.length,
    valid: pages.length > 0 && pages.every((item) => item.valid),
    pages,
  };
} finally {
  await browser.close();
}

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (reportArg) fs.writeFileSync(path.resolve(reportArg), serialized, 'utf8');
process.stdout.write(serialized);
process.exit(report.valid ? 0 : 1);
