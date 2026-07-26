import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node normalize-html.mjs <input.html> <output.html>');
  process.exit(0);
}
if (args.length < 2) {
  console.error('Input and output HTML paths are required.');
  process.exit(2);
}

const input = path.resolve(args[0]);
const output = path.resolve(args[1]);
if (!fs.existsSync(input) || !fs.statSync(input).isFile()) {
  console.error(`Input file not found: ${input}`);
  process.exit(2);
}
const source = fs.readFileSync(input, 'utf8');
if (!source.trim()) {
  console.error('Input HTML is empty.');
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

const remoteStylesheets = [...source.matchAll(/<link\b[^>]*rel\s*=\s*(["'])stylesheet\1[^>]*href\s*=\s*(["'])(.*?)\2/gi)]
  .map((match) => match[3])
  .filter((href) => /^https?:\/\//i.test(href));
if (remoteStylesheets.length) {
  console.error(`Remote stylesheets are not allowed: ${remoteStylesheets.join(', ')}`);
  process.exit(2);
}

const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
let result;
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:\/\//i.test(url)) request.abort();
    else request.continue();
  });
  await page.goto(pathToFileURL(input).href, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });

  result = await page.evaluate(() => {
    const properties = [
      'display', 'box-sizing', 'float', 'clear',
      'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'color', 'background-color', 'background-image', 'background-position', 'background-size', 'background-repeat',
      'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
      'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
      'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
      'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
      'box-shadow', 'opacity', 'overflow', 'overflow-x', 'overflow-y',
      'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
      'text-align', 'text-decoration-line', 'text-decoration-color', 'text-indent', 'text-transform',
      'letter-spacing', 'word-spacing', 'white-space', 'word-break', 'overflow-wrap',
      'vertical-align', 'list-style-type', 'list-style-position', 'object-fit', 'object-position'
    ];
    const before = {
      text: document.body?.textContent ?? '',
      links: document.querySelectorAll('a[href]').length,
      images: document.querySelectorAll('img[src]').length,
    };
    const warnings = [];

    const materializePseudo = (element, pseudo, position) => {
      const style = getComputedStyle(element, pseudo);
      const raw = style.content;
      if (!raw || raw === 'none' || raw === 'normal' || raw === '""') return;
      let content = raw;
      if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
        content = raw.slice(1, -1);
      }
      if (/^(?:url|counter|attr)\(/i.test(content)) {
        warnings.push(`complex_pseudo:${element.tagName.toLowerCase()}:${pseudo}`);
        return;
      }
      const span = document.createElement('span');
      span.setAttribute('data-materialized-pseudo', pseudo.replaceAll(':', ''));
      span.textContent = content.replace(/\\A/gi, '\n').replace(/\\(["'\\])/g, '$1');
      const declarations = properties.map((property) => `${property}:${style.getPropertyValue(property)}`).join(';');
      span.setAttribute('style', declarations);
      if (position === 'before') element.prepend(span); else element.append(span);
    };

    const elements = [...document.body.querySelectorAll('*')];
    for (const element of elements) {
      materializePseudo(element, '::before', 'before');
      materializePseudo(element, '::after', 'after');
      const computed = getComputedStyle(element);
      const declarations = properties
        .map((property) => [property, computed.getPropertyValue(property)])
        .filter(([, value]) => value && value !== 'normal')
        .map(([property, value]) => `${property}:${value}`)
        .join(';');
      element.setAttribute('style', declarations);
      for (const attribute of [...element.attributes]) {
        if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      }
    }

    document.querySelectorAll('script, iframe, form, style, link[rel~="stylesheet" i]').forEach((element) => element.remove());
    for (const div of [...document.querySelectorAll('div')]) {
      const display = div.style.display;
      const replacement = document.createElement(display === 'inline' || display === 'inline-block' ? 'span' : 'section');
      for (const attribute of [...div.attributes]) replacement.setAttribute(attribute.name, attribute.value);
      while (div.firstChild) replacement.appendChild(div.firstChild);
      div.replaceWith(replacement);
    }

    const bodyForTextCheck = document.body.cloneNode(true);
    bodyForTextCheck.querySelectorAll('[data-materialized-pseudo]').forEach((element) => element.remove());
    const after = {
      text: bodyForTextCheck.textContent ?? '',
      links: document.querySelectorAll('a[href]').length,
      images: document.querySelectorAll('img[src]').length,
    };
    return {
      html: `<!doctype html>\n${document.documentElement.outerHTML}`,
      before,
      after,
      warnings,
      remaining: {
        style: document.querySelectorAll('style, link[rel~="stylesheet" i]').length,
        div: document.querySelectorAll('div').length,
        script: document.querySelectorAll('script, [onclick], [onload]').length,
      },
    };
  });
} finally {
  await browser.close();
}

if (result.before.text !== result.after.text || result.before.links !== result.after.links || result.before.images !== result.after.images) {
  console.error(JSON.stringify({ success: false, reason: 'content_integrity_mismatch', before: result.before, after: result.after }));
  process.exit(1);
}
if (Object.values(result.remaining).some((count) => count !== 0)) {
  console.error(JSON.stringify({ success: false, reason: 'normalization_incomplete', remaining: result.remaining }));
  process.exit(1);
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const temp = `${output}.tmp`;
fs.writeFileSync(temp, `${result.html}\n`, 'utf8');
fs.copyFileSync(temp, output);
fs.rmSync(temp);
console.log(JSON.stringify({ success: true, input, output, before: result.before, after: result.after, warnings: result.warnings }));
