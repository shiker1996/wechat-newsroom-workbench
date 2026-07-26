import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file || file === '--help' || file === '-h') {
  console.log('Usage: node check-html.mjs <article.html>');
  process.exit(file ? 0 : 2);
}

const target = path.resolve(file);
let raw;
try {
  raw = fs.readFileSync(target, 'utf8');
} catch (error) {
  console.log(JSON.stringify({ valid: false, issues: [`read_failed: ${error.message}`] }));
  process.exit(2);
}

const issues = [];
if (!raw.trim()) issues.push('empty_html');
if (/<\s*div\b/i.test(raw)) issues.push('div_open_tag');
if (/<\s*script\b/i.test(raw)) issues.push('script_tag');
if (/\son[a-z]+\s*=/i.test(raw)) issues.push('event_handler');
if (/<\s*(?:iframe|form)\b/i.test(raw)) issues.push('interactive_or_embedded_tag');
if (/```\s*(?:mermaid|echarts)\b/i.test(raw)) issues.push('unprocessed_chart_fence');

const bodyMatch = raw.match(/<\s*body\b[^>]*>([\s\S]*?)<\/\s*body\s*>/i);
if (bodyMatch && /<\s*style\b/i.test(bodyMatch[1])) issues.push('style_in_body');
if (/<\s*style\b/i.test(raw)) issues.push('style_tag');
if (/<\s*link\b[^>]*\brel\s*=\s*(["'])?stylesheet\1/i.test(raw)) issues.push('stylesheet_link');

const flowTagPattern = /<(main|article|section|p|h[1-6]|blockquote|ol|ul|li)\b[^>]*\bstyle\s*=\s*(["'])([\s\S]*?)\2/gi;
for (const match of raw.matchAll(flowTagPattern)) {
  const tag = match[1].toLowerCase();
  const style = match[3];
  if (/(?:^|;)\s*(?:width|min-width|max-width|height|min-height|max-height)\s*:\s*-?\d+(?:\.\d+)?px\b/i.test(style)) {
    issues.push(`fixed_flow_dimension:${tag}`);
  }
  if ((tag === 'main' || tag === 'article') && /(?:^|;)\s*margin-(?:left|right)\s*:\s*(?!0(?:\.0+)?px\b)-?\d+(?:\.\d+)?px\b/i.test(style)) {
    issues.push(`fixed_root_horizontal_margin:${tag}`);
  }
}

const htmlStart = raw.search(/<\s*(?:!doctype|html)\b/i);
if (htmlStart > 0 && raw.slice(0, htmlStart).trim()) issues.push('content_before_html');
const htmlEndMatch = /<\/\s*html\s*>/gi;
let lastEnd = null;
for (const match of raw.matchAll(htmlEndMatch)) lastEnd = match;
if (lastEnd && raw.slice(lastEnd.index + lastEnd[0].length).trim()) issues.push('content_after_html');

const result = { valid: issues.length === 0, issues: [...new Set(issues)] };
console.log(JSON.stringify(result));
process.exit(result.valid ? 0 : 1);
