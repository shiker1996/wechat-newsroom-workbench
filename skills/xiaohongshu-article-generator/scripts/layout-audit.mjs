import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

function usage() {
  console.log('Usage: node layout-audit.mjs <design.html> [--json report.json] [--page pageNumber]');
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}
const inputArg = args.find((arg) => !arg.startsWith('--'));
const jsonIndex = args.indexOf('--json');
const reportArg = jsonIndex >= 0 ? args[jsonIndex + 1] : null;
const pageIndex = args.indexOf('--page');
const requestedPage = pageIndex >= 0 ? Number.parseInt(args[pageIndex + 1], 10) : null;
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

  const pages = await page.evaluate((targetPage) => {
    const thresholds = {
      cover: { min: 0.45, max: 0.90 },
      content: { min: 0.50, max: 0.96 },
      ending: { min: 0.20, max: 0.90 },
    };
    const round = (value) => Math.round(value * 10) / 10;
    const parseColor = (value) => {
      const raw = String(value || '').trim().toLowerCase();
      const hex = raw.match(/^#([0-9a-f]{3,8})$/i);
      if (hex) {
        const value = hex[1].length <= 4 ? hex[1].split('').map((item) => item + item).join('') : hex[1];
        return {
          r: Number.parseInt(value.slice(0, 2), 16),
          g: Number.parseInt(value.slice(2, 4), 16),
          b: Number.parseInt(value.slice(4, 6), 16),
          a: value.length === 8 ? Number.parseInt(value.slice(6, 8), 16) / 255 : 1,
        };
      }
      const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
      if (!rgb) return null;
      const parts = rgb[1].split(',').map((part) => part.trim());
      if (parts.length < 3) return null;
      const alpha = parts[3] == null ? 1 : Number(parts[3]);
      return {
        r: Number(parts[0]),
        g: Number(parts[1]),
        b: Number(parts[2]),
        a: Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1,
      };
    };
    const composite = (foreground, background) => {
      if (!foreground) return background;
      const alpha = Math.max(0, Math.min(1, Number(foreground.a)));
      if (alpha >= 0.999) return { ...foreground, a: 1 };
      const base = background || { r: 255, g: 255, b: 255, a: 1 };
      return {
        r: foreground.r * alpha + base.r * (1 - alpha),
        g: foreground.g * alpha + base.g * (1 - alpha),
        b: foreground.b * alpha + base.b * (1 - alpha),
        a: 1,
      };
    };
    const luminance = (color) => {
      const channel = (value) => {
        const normalized = Math.max(0, Math.min(255, Number(value))) / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    };
    const contrast = (foreground, background) => {
      if (!foreground || !background) return 0;
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };

    return [...document.querySelectorAll('.page')].map((pageElement, index) => {
      const kind = pageElement.dataset.pageKind || (pageElement.classList.contains('page-cover') ? 'cover' : 'content');
      const limits = thresholds[kind] || thresholds.content;
      // AI 图文使用技能通用页面壳：封面把 ai-page-slot 放在 cover-center，
      // 内页把它放在 page-inner > page-body；布局审计以该插槽作为可视内容区。
      const aiPageSlot = pageElement.querySelector(':scope > .ai-page-slot, :scope > .page-inner > .page-body.ai-page-slot');
      const aiShell = Boolean(aiPageSlot);
      const aiFullDocument = document.body?.dataset.renderMode === 'ai-visual';
      // 完整 AI 封面没有 page-body：以 page-inner 作为可用画布，
      // 再从 cover-center 与 cover-bottom 的真实子元素计算内容边界。
      const existingPageBody = pageElement.querySelector(':scope > .page-inner > .page-body, :scope > .page-body, .page-body');
      const body = aiShell
        ? aiPageSlot
        : kind === 'cover'
          ? (existingPageBody || pageElement.querySelector(':scope > .page-inner, :scope > .cover-center'))
          : pageElement.querySelector(':scope > .page-inner > .page-body, :scope > .page-body, .page-body');
      const issues = [];
      if (!body) return { page: index + 1, kind, valid: false, issues: ['missing_page_body'] };

      const inner = pageElement.querySelector(':scope > .page-inner');
      if (!aiShell && !aiFullDocument && kind === 'content' && (!inner || inner.children.length !== 3)) {
        issues.push('invalid_page_grid_structure');
      }

      const pageRect = pageElement.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const descendants = [...body.querySelectorAll('*')].filter(visible);
      const warnings = [];
      const stack = body.querySelector(':scope > .page-content-stack');
      if (!aiShell && !aiFullDocument && kind === 'content' && !stack) issues.push('missing_content_stack');
      const direct = stack && visible(stack) ? [stack] : [...body.children].filter(visible);
      if (!direct.length && kind === 'content') issues.push('empty_page_body');

      // stack 自身可能带 min-height 等装饰性高度，直接测其边界会掩盖稀疏内容；
      // 已用区域改测 stack 内可见子元素（eyebrow/标题/内容块）的并集，装饰均为伪元素不参与测量。
      // 封面的 cover-center 同样是占满剩余空间的 flex 容器，不能把它自己的
      // 全高边界当成内容；改测其实际子元素，并把 cover-bottom 的实际子元素纳入构图。
      const stackChildren = stack && visible(stack) ? [...stack.children].filter(visible) : [];
      const coverCenter = kind === 'cover'
        ? pageElement.querySelector(':scope > .page-inner > .cover-center')
        : null;
      const coverBottom = kind === 'cover'
        ? pageElement.querySelector(':scope > .page-inner > .cover-bottom')
        : null;
      const coverCenterChildren = coverCenter ? [...coverCenter.children].filter(visible) : [];
      const coverBottomChildren = coverBottom ? [...coverBottom.children].filter(visible) : [];
      const coverMeasured = coverCenterChildren.concat(coverBottomChildren.length ? coverBottomChildren : (coverBottom && visible(coverBottom) ? [coverBottom] : []));
      const measured = coverMeasured.length
        ? coverMeasured
        : (stackChildren.length ? stackChildren : direct);
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
      // 列间遮盖：未折行文本（如长 URL）会把自身盒撑出所在列，压住相邻列内容；
      // clipped 只对照页面边界，捕捉不到这种列内溢出；这里量元素相对父盒的横向超出
      let horizontalOverflowPixels = 0;
      for (const element of descendants) {
        if (!element.textContent?.trim()) continue;
        if (getComputedStyle(element).overflowX !== 'visible') continue;
        const parent = element.parentElement;
        if (!parent || parent === body) continue;
        const rect = element.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        horizontalOverflowPixels = Math.max(horizontalOverflowPixels, rect.right - parentRect.right, parentRect.left - rect.left);
      }
      if (scrollOverflow > 1) issues.push('overflow');
      if (clippedPixels > 1) issues.push('clipped');
      if (horizontalOverflowPixels > 2) issues.push('horizontal_overflow');
      if (utilization < limits.min && direct.length) issues.push('underfilled');
      if (utilization > limits.max && scrollOverflow <= 1 && clippedPixels <= 1) issues.push('overfilled');
      const stackStyle = stack && visible(stack) ? getComputedStyle(stack) : (aiShell ? getComputedStyle(body) : null);
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

      // AI 视觉组件约定：正文承载元素统一使用 *-body；.page-body 只是布局插槽。
      const tooSmallText = descendants.some((element) => {
        if (!element.textContent?.trim()) return false;
        const hasBodyRole = [...element.classList].some((name) => /-body$/i.test(name) && name !== 'page-body');
        if (!hasBodyRole) return false;
        const style = getComputedStyle(element);

        const isCode =
          element.matches('code, pre, kbd, samp') ||
          element.closest('pre, code');
        if (isCode) {
          return false;
        }

        const size = Number.parseFloat(style.fontSize);
        const decorative = element.matches('[aria-hidden="true"], [role="img"]')
          || [...element.classList].some((name) => /(?:icon|mark|glyph|bullet|symbol|ornament|decoration)/i.test(name));
        if (decorative) {
          return false;
        }
        const auxiliary = element.matches('small, [data-text-role="auxiliary"], .page-footer, .cover-bottom, .visual-badge, .continuation-badge')
          || [...element.classList].some((name) => /(?:tag|label|caption|meta|date|sub|hint|eyebrow|glass)/i.test(name));
        return size < (auxiliary ? 10 : 11);
      });
      if (tooSmallText) warnings.push('text_too_small');

      // 结构和尺寸都可能正常，但文字前景色与其实际承载背景相同，
      // 例如封面色块标题的偶数行。只检查直接承载文字的元素，避免父级
      // h1 与内部 span 的不同背景被重复计算；背景按祖先层级合成。
      const textVisibilityIssues = [];
      const directTextElements = descendants.filter((element) => [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()));
      const selectorFor = (element) => element.tagName.toLowerCase()
        + (element.id ? `#${element.id}` : '')
        + (element.className && typeof element.className === 'string'
          ? `.${element.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.')}`
          : '');
      // 渐变背景：background-color 是透明的，但 background-image 会实际着色，
      // 例如封面的 radial-gradient。这里提取渐变所有色标作为候选背景，否则
      // 透明 background-color 会一路合成到白色画布，把深色渐变封面误判成白底。
      const gradientStops = (backgroundImage) => {
        const images = String(backgroundImage || '');
        if (!/gradient\(/i.test(images)) return [];
        const colors = [];
        for (const match of images.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)) {
          const parsed = parseColor(match[0]);
          if (parsed && parsed.a > 0) colors.push(parsed);
        }
        return colors;
      };
      const backgroundFor = (element) => {
        const chain = [];
        for (let current = element; current && current !== document.documentElement; current = current.parentElement) {
          chain.unshift(current);
          if (current === pageElement) break;
        }
        // 从最远祖先向元素逐层合成。每个元素自身的 background-color 作为底层，
        // background-image 渐变叠在其上（透明色标最终露出底色）；渐变会给出多个
        // 候选背景（每个色标一个），更近层的不透明背景覆盖下方候选，
        // 因此不能碰到不透明层就提前返回。
        let candidates = [null];
        for (const current of chain) {
          const style = getComputedStyle(current);
          const stops = gradientStops(style.backgroundImage);
          const bgColor = parseColor(style.backgroundColor);
          if (stops.length) {
            const base = bgColor && bgColor.a > 0
              ? candidates.map((candidate) => composite(bgColor, candidate))
              : candidates;
            candidates = base.flatMap((background) => stops.map((stop) => composite(stop, background)));
          } else if (bgColor && bgColor.a > 0) {
            candidates = candidates.map((candidate) => composite(bgColor, candidate));
          }
          if (candidates.length > 12) candidates = candidates.slice(0, 12);
        }
        return candidates;
      };
      const worstBackground = (foreground, backgrounds) => {
        let worst = null;
        let worstRatio = Infinity;
        for (const background of backgrounds) {
          const ratio = contrast(composite(foreground, background), background);
          if (ratio < worstRatio) {
            worstRatio = ratio;
            worst = background;
          }
        }
        return { background: worst, ratio: worstRatio === Infinity ? 0 : worstRatio };
      };
      for (const element of directTextElements) {
        const style = getComputedStyle(element);
        const textColor = parseColor(style.color);
        const { background, ratio } = worstBackground(textColor, backgroundFor(element));
        const chain = [];
        for (let current = element; current && current !== document.documentElement; current = current.parentElement) {
          chain.unshift(current);
          if (current === pageElement) break;
        }
        const opacity = [...chain].reduce((value, current) => value * Number(getComputedStyle(current).opacity || 1), 1);
        if (opacity <= 0.05 || !textColor || ratio < 1.2) {
          textVisibilityIssues.push({
            selector: selectorFor(element),
            text: element.textContent.trim().slice(0, 80),
            foreground: style.color,
            background: background ? `rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})` : 'transparent',
            contrast: round(ratio),
          });
        }
      }
      if (textVisibilityIssues.length) warnings.push('text_invisible');

      // 给 Agent 的浏览器工具返回少量真实计算样式，而不是整份 DOM/CSS，
      // 让它能判断“文字太小/颜色不对/卡片挤压”究竟发生在哪个元素。
      const styleSamples = directTextElements.slice(0, 32).map((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const foreground = parseColor(style.color);
        const { background, ratio } = worstBackground(foreground, backgroundFor(element));
        return {
          selector: selectorFor(element),
          text: element.textContent.trim().slice(0, 80),
          rect: { x: round(rect.x - pageRect.x), y: round(rect.y - pageRect.y), width: round(rect.width), height: round(rect.height) },
          display: style.display,
          position: style.position,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          color: style.color,
          background: background ? `rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})` : 'transparent',
          contrast: round(ratio),
        };
      });

      return {
        page: index + 1,
        kind,
        valid: issues.length === 0,
        warnings: [...new Set(warnings)],
        utilization: round(utilization * 100),
        target: `${Math.round(limits.min * 100)}-${Math.round(limits.max * 100)}%`,
        bodyHeight: round(bodyRect.height),
        usedHeight: round(usedHeight),
        topWhitespace: round(topWhitespace),
        bottomWhitespace: round(bottomWhitespace),
        verticalBalanceDelta: round(Math.abs(topWhitespace - bottomWhitespace)),
        overflowPixels: round(scrollOverflow),
        clippedPixels: round(clippedPixels),
        horizontalOverflowPixels: round(horizontalOverflowPixels),
        textVisibilityIssues,
        styleSamples,
        issues: [...new Set(issues)],
      };
    }).filter((item) => !Number.isInteger(targetPage) || targetPage < 1 || item.page === targetPage);
  }, requestedPage);
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
