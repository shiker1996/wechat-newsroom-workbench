import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// 文章配图确定性生成（待办「文章配图接入图文确定性生成链」）：
// 占位标记为可生成（IMG-DATA，kind=timeline|datacard）时，用固定 HTML 模板 + html-pages-to-images
// 截图产出单张浅色插图。数据只能来自占位中的结构化清单（规划时取自正文），模型不参与渲染。
// 生成失败保留占位并抛错，绝不静默删除或伪造图片。

const RATIO_SIZE = {
  '16:9': { width: 750, height: 422 },
  '4:3': { width: 750, height: 562 },
  '1:1': { width: 600, height: 600 },
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}

function timelineHtml({ title, items }, { width, height }) {
  const rows = items.map((item) => `
    <div class="t-row">
      <div class="t-dot"></div>
      <div class="t-label">${escapeHtml(item.label)}</div>
      <div class="t-value">${escapeHtml(item.value)}</div>
    </div>`).join('');
  return pageHtml({ width, height, title, subtitle: '事件时间线', body: `<div class="t-list">${rows}</div>` }, `
    .t-list{display:flex;flex-direction:column;gap:0}
    .t-row{display:grid;grid-template-columns:18px 130px 1fr;align-items:baseline;padding:13px 0;border-bottom:1px solid #e4e4e7}
    .t-row:last-child{border-bottom:none}
    .t-dot{width:9px;height:9px;border-radius:50%;background:#1d4ed8;align-self:center}
    .t-label{font-size:15px;font-weight:700;color:#18181b}
    .t-value{font-size:15px;color:#3f3f46;line-height:1.45}`);
}

function datacardHtml({ title, items }, { width, height }) {
  const cards = items.map((item) => `
    <div class="d-card">
      <div class="d-value">${escapeHtml(item.value)}</div>
      <div class="d-label">${escapeHtml(item.label)}</div>
    </div>`).join('');
  const cols = items.length <= 2 ? items.length : items.length <= 4 ? 2 : 3;
  return pageHtml({ width, height, title, subtitle: '数据速览', body: `<div class="d-grid" style="grid-template-columns:repeat(${cols},1fr)">${cards}</div>` }, `
    .d-grid{display:grid;gap:14px;height:100%;align-content:center}
    .d-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px 14px;text-align:center}
    .d-value{font-size:26px;font-weight:800;color:#1d4ed8;line-height:1.25;word-break:break-all}
    .d-label{font-size:13px;color:#52525b;margin-top:6px}`);
}

function pageHtml({ width, height, title, subtitle, body }, extraCss) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:"Microsoft YaHei UI","PingFang SC",sans-serif;background:#e9e9e7}
  .page{width:${width}px;height:${height}px;background:#ffffff;padding:28px 30px;display:flex;flex-direction:column}
  .head{border-left:5px solid #1d4ed8;padding-left:14px;margin-bottom:20px}
  .title{font-size:22px;font-weight:800;color:#18181b;line-height:1.3}
  .subtitle{font-size:12px;color:#71717a;letter-spacing:2px;margin-top:4px}
  .content{flex:1;display:flex;flex-direction:column;justify-content:center}
  ${extraCss}
</style></head>
<body><div class="page">
  <div class="head"><div class="title">${escapeHtml(title)}</div><div class="subtitle">${escapeHtml(subtitle)}</div></div>
  <div class="content">${body}</div>
</div></body></html>`;
}

export function buildGenerateImageHtml(generate, ratio = '16:9') {
  const size = RATIO_SIZE[ratio] || { width: 750, height: Math.round(750 * 0.62) };
  if (generate?.kind === 'timeline') return { html: timelineHtml(generate, size), ...size };
  if (generate?.kind === 'datacard') return { html: datacardHtml(generate, size), ...size };
  throw new Error(`未知的可生成图片类型：${generate?.kind || '未声明'}`);
}

export async function generateArticleImage({ workspaceRoot, workdir, slotId, generate, ratio, renderHtmlPages = null }) {
  if (!generate?.items?.length) throw new Error('该占位没有可生成的结构化数据');
  const { html, width, height } = buildGenerateImageHtml(generate, ratio);
  const safeName = String(slotId || 'image').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-');
  const imageDir = path.join(workdir, 'images');
  fs.mkdirSync(imageDir, { recursive: true });
  // Windows 下 Node 对含中文的临时目录执行 recursive rm 可能静默残留；临时前缀保持 ASCII。
  const tempDir = fs.mkdtempSync(path.join(imageDir, '.generate-'));
  const tempHtmlPath = path.join(tempDir, `${safeName}.html`);
  const htmlPath = path.join(imageDir, `${safeName}.html`);
  const target = path.join(imageDir, `${safeName}.png`);
  try {
    fs.writeFileSync(tempHtmlPath, html, 'utf8');
    let execute = renderHtmlPages;
    if (!execute) {
      const screenshotModule = path.join(workspaceRoot, 'skills', 'html-pages-to-images', 'index.js');
      ({ execute } = await import(`${pathToFileURL(screenshotModule).href}?v=${Date.now()}`));
    }
    const result = await execute({ htmlFile: tempHtmlPath, outputDir: tempDir, selector: '.page', pageWidth: width, pageHeight: height, deviceScaleFactor: 2 });
    if (!result.success) throw new Error(`配图生成截图失败：${result.message}`);
    const images = (result.data.images || []).map((item) => (typeof item === 'string' ? item : item.path || item.filePath)).filter(Boolean);
    if (!images.length || !fs.existsSync(images[0])) throw new Error('配图生成未产出 PNG');
    fs.copyFileSync(images[0], target);
    fs.copyFileSync(tempHtmlPath, htmlPath);
    return { localPath: target, htmlPath, width, height };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}
