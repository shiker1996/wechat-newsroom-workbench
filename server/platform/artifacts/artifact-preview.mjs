import path from 'node:path';

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

export function isImageArtifact(filePath) {
  return imageExtensions.has(path.extname(String(filePath || '')).toLowerCase());
}

export function injectPhonePreviewStyles(html) {
  const style = `<style data-workbench-phone-preview>
html,body{max-width:100%;overflow-x:hidden}
body{margin-left:0!important;margin-right:0!important}
img{display:block!important;width:auto!important;max-width:100%!important;height:auto!important;object-fit:contain!important;margin-left:auto!important;margin-right:auto!important}
</style>`;
  const value = String(html || '');
  if (/<\/head>/i.test(value)) return value.replace(/<\/head>/i, `${style}</head>`);
  return `${style}${value}`;
}

export function imageArtifactPreviewHtml(contentUrl, title = '图片产物预览') {
  const safeUrl = String(contentUrl).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  const safeTitle = String(title).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0}body{display:grid;place-items:center;padding:24px;background:#171c1b;overflow:auto}img{display:block;width:auto;height:auto;max-width:100%;max-height:calc(100vh - 48px);object-fit:contain;box-shadow:0 12px 36px rgba(0,0,0,.38)}</style></head><body><img src="${safeUrl}" alt="${safeTitle}"></body></html>`;
}

export function textArtifactPreviewHtml(content, title = '文本产物预览') {
  const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const safeTitle = escapeHtml(title);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#f7f3ea;color:#17201e}body{padding:28px 32px;font:14px/1.7 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}h1{margin:0 0 20px;font:600 18px/1.3 Georgia,"Times New Roman",serif}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><main><h1>${safeTitle}</h1><pre>${escapeHtml(content)}</pre></main></body></html>`;
}
