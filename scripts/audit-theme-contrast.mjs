// 全量内置主题对比度审计：用无头浏览器渲染每个图文主题的真实元素，测量前景/背景并算 WCAG 对比度。
// 用法：node scripts/audit-theme-contrast.mjs [--all]
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderStoryboardHtml } from '../lib/llm/social-card-pipeline.mjs';
import { getBuiltinThemeRegistry } from '../lib/themes/theme-registry.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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

function parseHex(hex) {
  const v = hex.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function lum(rgb) {
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const [r, g, b] = rgb;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a, b) {
  const la = lum(parseHex(a)), lb = lum(parseHex(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const themes = getBuiltinThemeRegistry().list({ target: 'social' });
const checks = [
  { label: '正文(h1标题/正文文字) @ surface', selectors: ['.page-content-stack h1'] },
  { label: '正文段落 @ surface', selectors: ['.page .text-block p'] },
  { label: '代码 @ code底', selectors: ['.code-block pre'] },
  { label: '列表项 @ 列表底', selectors: ['.page .list-block li'] },
  { label: '步骤数字 @ 强调色', selectors: ['.step>b'] },
  { label: '表头 @ 强调色', selectors: ['.compare-block th'] },
  { label: '表体 @ surface', selectors: ['.compare-block td'] },
  { label: '结尾页标题 @ 结尾底', selectors: ['.page-ending h1'] },
  { label: '眉题 @ 页面底', selectors: ['.eyebrow'] },
  { label: 'brand @ 页面底', selectors: ['.page-header .brand'] },
  { label: 'note块文字 @ note底', selectors: ['.note-block p'] },
  { label: '封面标题 @ surface', selectors: ['.page-cover h1'] },
];

const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();

const report = [];
for (const theme of themes) {
  const html = renderStoryboardHtml({
    topic: '审计用主题样例', repository: 'example/repo', visualStyle: theme.id,
    contentType: 'repository', channelMode: 'xiaohongshu',
    pages: [
      { kind: 'cover', title: '封面标题示例', lead: '封面导语', content_blocks: [] },
      { kind: 'content', title: '正文页', content_blocks: [
        { type: 'text', title: '小节标题', content: '正文内容示例文本' },
        { type: 'code', title: '代码', content: 'npm install demo\nimport demo from "demo"' },
        { type: 'list', title: '清单', items: ['条目一', '条目二', '条目三'] },
        { type: 'note', title: '提示', content: '提示内容示例' },
        { type: 'compare', title: '对比', headers: ['A', 'B'], rows: [['1', '2']] },
        { type: 'steps', title: '步骤', items: [{ title: '第一步', content: '说明' }] },
      ] },
      { kind: 'ending', title: '结尾标题', content_blocks: [{ type: 'text', content: '结尾正文' }] },
    ],
  });
  const htmlPath = path.join(root, `data/_audit-${theme.id}.html`);
  const fs = await import('node:fs');
  fs.writeFileSync(htmlPath, html, 'utf8');
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });

  const results = await page.evaluate((checkList) => {
    const parseCssColor = (str) => {
      if (!str) return null;
      const s = str.trim();
      if (s.startsWith('rgb(') || s.startsWith('rgba(')) {
        const m = s.match(/[\d.]+/g);
        if (!m) return null;
        const r = Math.round(Number(m[0])), g = Math.round(Number(m[1])), b = Math.round(Number(m[2]));
        const a = m[3] !== undefined ? Number(m[3]) : 1;
        if (a === 0) return null;
        const t = (f, bg) => Math.round(f * a + bg * (1 - a));
        return null; // 半透明在下方用合成逻辑处理
      }
      if (s.startsWith('color(srgb')) { const m = s.match(/[\d.]+/g); if (!m) return null; return `rgb(${Math.round(Number(m[0]) * 255)},${Math.round(Number(m[1]) * 255)},${Math.round(Number(m[2]) * 255)})`; }
      return null;
    };
    const hexOf = (v) => {
      if (!v) return null;
      const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+[\d.]+)?\)/.exec(v);
      return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : (/^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null);
    };
    const isOpaque = (str) => { const m = /rgba\([\d.,\s]+,\s*([\d.]+)\)/.exec(str); return m ? Number(m[1]) >= 0.999 : Boolean(str && !str.includes('rgba(')); };
    const walkBg = (el) => {
      let node = el;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && isOpaque(bg)) return hexOf(bg);
        node = node.parentElement;
      }
      return null;
    };
    const out = [];
    for (const check of checkList) {
      let el = null;
      for (const sel of check.selectors) { el = document.querySelector(sel); if (el) break; }
      if (!el) { out.push({ label: check.label, skip: '未渲染' }); continue; }
      const color = getComputedStyle(el).color;
      const fg = hexOf(color);
      const bg = walkBg(el);
      out.push({ label: check.label, fg, bg });
    }
    return out;
  }, checks);
  fs.rmSync(htmlPath, { force: true });

  const issues = [];
  for (const row of results) {
    if (row.skip || !row.fg || !row.bg) continue;
    const ratio = contrast(row.fg, row.bg);
    row.ratio = Math.round(ratio * 100) / 100;
    if (row.ratio < 3) row.severity = 'CRIT';
    else if (row.ratio < 4.5) row.severity = 'WARN';
    else row.severity = 'OK';
    if (row.severity !== 'OK') issues.push(`${row.label} ${row.fg}/${row.bg} = ${row.ratio}:1`);
  }
  report.push({ id: theme.id, version: theme.version, issues, results });
}

await browser.close();

for (const r of report) {
  console.log(`\n== ${r.id} v${r.version}`);
  if (!r.issues.length) { console.log('   OK 全部元素对比度达标'); continue; }
  for (const line of r.issues) console.log(`   ${line}`);
}
console.log('\n=== 汇总 ===');
const bad = report.filter((r) => r.issues.length);
console.log(`共 ${report.length} 个图文主题，${bad.length} 个存在问题：${bad.map((b) => b.id).join('、')}`);
