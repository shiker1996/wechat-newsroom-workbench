function markdownStructure(markdown) {
  const source = String(markdown);
  return {
    headings: [...source.matchAll(/^#{1,3}\s+(.+)$/gm)].map((match) => match[1].replace(/[*_`]/g, '').trim()),
    links: [...source.matchAll(/(?<!!)\[[^\]]+\]\([^)]+\)/g)].length,
    images: [...source.matchAll(/!\[[^\]]*\]\([^)]+\)/g)].length,
    codeBlocks: [...source.matchAll(/^```[^\n]*\n[\s\S]*?^```\s*$/gm)].length,
    tables: [...source.matchAll(/^\s*\|?.+\|.+\s*$\n^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm)].length,
  };
}

export function htmlPreservesStructure(markdown, html) {
  const source = markdownStructure(markdown);
  const visible = String(html).replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const count = (pattern) => (String(html).match(pattern) || []).length;
  const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return count(/<h[1-3]\b/gi) === source.headings.length
    && count(/<a\b[^>]*href=/gi) >= source.links
    && count(/<img\b[^>]*src=/gi) >= source.images
    && count(/<pre\b/gi) >= source.codeBlocks
    && count(/<table\b/gi) >= source.tables
    && source.headings.every((heading) => visible.includes(escape(heading)));
}

export function enforceWechatFlowLayout(html) {
  const source = String(html || '');
  const override = '<style data-wechat-flow-guard>body>article,body>main{width:auto!important;max-width:none!important;margin-left:0!important;margin-right:0!important}</style>';
  if (/<\/head>/i.test(source)) return source.replace(/<\/head>/i, `${override}</head>`);
  return `${override}${source}`;
}

export function extractHtmlModelOutput(value) {
  const raw = String(value || '').trim();
  const fenced = raw.match(/```html\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/);
  let html = fenced ? fenced[1].trim() : raw;
  const start = html.search(/<!doctype\s+html|<html\b|<(?:article|main)\b/i);
  if (start > 0) html = html.slice(start);
  const htmlEnd = html.toLowerCase().lastIndexOf('</html>');
  if (htmlEnd >= 0) html = html.slice(0, htmlEnd + 7);
  return html.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

export function defaultTypesetTheme(candidate) {
  if (candidate?.category === '🏢 大厂战略' && /趣|离谱|八卦/.test(candidate?.angle || '')) return 'gossip-card';
  if (candidate?.composite) return 'research-report';
  switch (candidate?.category) {
    case '🤖 AI/技术动态': return 'tech-wire';
    case '📈 行业趋势':
    case '🏢 大厂战略': return 'research-report';
    case '💼 职场生态': return 'career-essay';
    case '📰 综合资讯': return 'news-digest';
    default: return 'magazine-warm';
  }
}
