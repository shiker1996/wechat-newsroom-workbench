import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildImagesMarkdown, imageManifestFile, registerGeneratedImageAssets, uploadImageToCdn } from './image-workflow.mjs';
import { loadSkillBundle } from './skill-runtime.mjs';
import { batchArticlesDir, candidateArticleDir } from '../core/workspace-paths.mjs';
import { getToolRegistry } from '../tools/index.mjs';
import { createStoreExecutionLogger } from '../tools/execution-log.mjs';
import { bindGenerationSnapshot, prepareSkillRun } from '../skills/pipeline-runtime.mjs';
import { articleThemeCompatibilityView, articleThemeDefinition, compileArticleTheme } from '../themes/article-theme-compiler.mjs';
import { resolveWorkspaceTheme } from '../themes/user-theme-service.mjs';

const execFileAsync = promisify(execFile);

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, String(content).trimEnd() + '\n', 'utf8');
  fs.renameSync(temp, filePath);
  return fs.statSync(filePath);
}

function addArtifact(store, batchId, kind, name, filePath) {
  const stat = fs.statSync(filePath);
  store.upsertArtifact({ batchId, kind, name, path: filePath, size: stat.size, modifiedAt: stat.mtime.toISOString() });
}

function parseJson(result, store) {
  try {
    return JSON.parse(String(result.content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch (error) {
    const reason = result.finishReason === 'length' ? '排版设计输出达到上限，JSON 被截断' : `排版设计返回无效 JSON：${error.message}`;
    store.updateModelCall(result.callId, { status: 'invalid_output', error: reason });
    throw new Error(reason);
  }
}

const TYPESET_SKILLS = [
  'wechat-article-typeset', 'wechat-md-render', 'magazine-design-advisor',
  'mermaid-render', 'wechat-echarts-blocks-to-images',
  'wechat-md-to-draft', 'wechat-html-normalizer',
  'wechat-html-check-no-div',
];

export const TYPESET_STAGE_CONTRACT = Object.freeze([
  { id:'rendered', skill:'wechat-md-render' },
  { id:'design', skill:'magazine-design-advisor' },
  { id:'images', skill:'wechat-article-typeset' },
  { id:'draft', skill:'wechat-md-to-draft' },
  { id:'normalized', skill:'wechat-html-normalizer' },
  { id:'gate', skill:'wechat-html-check-no-div' },
]);

function loadTypesetSkills(workspaceRoot) {
  const bundles = Object.fromEntries(TYPESET_SKILLS.map((name) => [name, loadSkillBundle({ workspaceRoot, skillName:name })]));
  const required = ['wechat-article-typeset', 'wechat-md-render', 'magazine-design-advisor', 'wechat-md-to-draft', 'wechat-html-normalizer', 'wechat-html-check-no-div'];
  const missing = required.filter((name) => bundles[name].fallback);
  if (missing.length) throw new Error(`项目排版技能缺失：${missing.join('、')}，请检查 skills 目录`);
  return bundles;
}

function skillScript(bundle, ...segments) {
  const script = path.join(bundle.root, bundle.skillName, ...segments);
  if (!fs.existsSync(script)) throw new Error(`技能 ${bundle.skillName} 缺少执行脚本：${segments.join('/')}`);
  return script;
}

function normalizeDesignTokens(input = {}) {
  const legacy = input || {};
  const colors = legacy.colors || {};
  const hex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
  const number = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
  return {
    schema_version: 1,
    colors: {
      background: hex(colors.background, '#FFFFFF'),
      text: hex(colors.text || legacy.textColor, '#202522'),
      muted: hex(colors.muted || legacy.mutedColor, '#6C736E'),
      accent: hex(colors.accent || legacy.accentColor, '#C4473A'),
    },
    typography: {
      body_px: number(input.typography?.body_px, 16, 15, 18),
      line_height: number(input.typography?.line_height, 1.8, 1.5, 2.1),
      h2_px: number(input.typography?.h2_px, 22, 19, 28),
    },
    spacing: {
      section_px: number(input.spacing?.section_px, 30, 20, 42),
      paragraph_px: number(input.spacing?.paragraph_px, 16, 10, 24),
    },
    image: {
      radius_px: number(input.image?.radius_px, 0, 0, 16),
      caption_px: number(input.image?.caption_px, 13, 11, 15),
    },
  };
}

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

function htmlPreservesStructure(markdown, html) {
  const source = markdownStructure(markdown);
  const visible = String(html).replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const headingCount = (String(html).match(/<h[1-3]\b/gi) || []).length;
  const linkCount = (String(html).match(/<a\b[^>]*href=/gi) || []).length;
  const imageCount = (String(html).match(/<img\b[^>]*src=/gi) || []).length;
  const codeBlockCount = (String(html).match(/<pre\b/gi) || []).length;
  const tableCount = (String(html).match(/<table\b/gi) || []).length;
  return headingCount === source.headings.length && linkCount >= source.links && imageCount >= source.images
    && codeBlockCount >= source.codeBlocks && tableCount >= source.tables
    && source.headings.every((heading) => visible.includes(heading));
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

function writeExecutionFiles(workdir, bundles, stages) {
  const manifest = Object.fromEntries(Object.entries(bundles).map(([name, bundle]) => [name, {
    hash: bundle.hash, files: bundle.files.map((file) => path.relative(workdir, file)), fallback: bundle.fallback,
  }]));
  writeFile(path.join(workdir, 'typeset-skill-manifest.json'), JSON.stringify(manifest, null, 2));
  writeFile(path.join(workdir, 'typeset-stage-executions.json'), JSON.stringify(stages, null, 2));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

// 兼容旧调用方的只读视图；生产主题来源已经切换为 themes/article/*.json。
export const TYPESET_THEMES = articleThemeCompatibilityView();

// 自动主题：与成稿链 writerSkill 的判定保持一致——八卦吃瓜类走卡片风，
// 其余按选题分类映射到对应主题；综合文按研报处理。
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

function hexToRgba(hex, alpha) {
  const n = parseInt(String(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function lighten(hex, ratio) {
  const n = parseInt(String(hex).slice(1), 16);
  const mix = (channel) => Math.round(channel + (255 - channel) * ratio);
  const toHex = (v) => v.toString(16).padStart(2, '0');
  return `#${toHex(mix((n >> 16) & 255))}${toHex(mix((n >> 8) & 255))}${toHex(mix(n & 255))}`;
}

// 由 design tokens 推导每个元素的内联样式。公众号编辑器只保留内联样式，
// 确定性渲染直接输出 style 属性，避免再经浏览器内联化。
// 注意：门禁禁止流式标签出现固定像素宽高，这里只用百分比/自动尺寸。
function buildInlineStyles(tokens, themeName = 'magazine-warm') {
  const theme = compileArticleTheme(tokens.themeDefinition||articleThemeDefinition(themeName));
  const variants = theme.variants;
  const isGossip = variants.frame === 'gossip-frame';
  const isTech = variants.frame === 'terminal-frame';
  const isResearch = variants.frame === 'report-frame';
  const isCareer = variants.frame === 'letter-frame';
  const isNews = variants.frame === 'news-frame';
  // 合并优先级：主题底色 < 旧版扁平 token（accentColor 等） < 嵌套 colors
  const legacyFlat = {};
  if (tokens.accentColor) legacyFlat.accent = tokens.accentColor;
  if (tokens.textColor) legacyFlat.text = tokens.textColor;
  if (tokens.mutedColor) legacyFlat.muted = tokens.mutedColor;
  const merged = {
    ...tokens,
    colors: { ...(theme.tokens.colors || {}), ...legacyFlat, ...(tokens.colors || {}) },
  };
  const design = normalizeDesignTokens(merged);
  const { background, text: ink, muted, accent } = design.colors;
  const bodyPx = design.typography.body_px;
  const lineHeight = design.typography.line_height;
  const h2Px = design.typography.h2_px;
  const sectionPx = design.spacing.section_px;
  const paragraphPx = design.spacing.paragraph_px;
  const radiusPx = design.image.radius_px;
  const captionPx = design.image.caption_px;
  const font = `-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif`;
  // 杂志风：标题、引言用衬线，正文保留无衬线保证移动端可读性
  const serif = `Georgia,'Songti SC','STSong','SimSun',serif`;
  const mono = `Consolas,'Courier New',monospace`;
  const headingFont = variants.serifHeadings ? serif : font;
  const bodyFont = variants.bodyFont === 'serif' ? serif : font;
  const articleFrame = isTech
    ? `border-top:3px solid ${accent};border-bottom:1px solid ${hexToRgba(accent, 0.35)}`
    : isNews
      ? `border-top:8px solid ${ink}`
      : isResearch
        ? `border-top:1px solid ${ink};border-bottom:1px solid ${ink}`
        : isGossip
          ? `border-top:6px solid ${accent}`
          : isCareer
            ? `border-top:1px solid ${hexToRgba(accent, 0.35)}`
            : `border-top:3px double ${accent}`;
  const styles = {
    article: `box-sizing:border-box;margin:0;padding:${isResearch ? '28px 20px' : isTech ? '22px 18px 28px' : '26px 18px 30px'};background:${background};color:${ink};font-family:${bodyFont};font-size:${bodyPx}px;line-height:${lineHeight};letter-spacing:${isTech ? '.01em' : '.025em'};${articleFrame}${variants.justify ? ';text-align:justify' : ''}`,
    kicker: `margin:0 0 14px`,
    kickerChip: `display:inline-block;padding:3px 8px;background:${accent};color:#FFFFFF;font-size:${Math.max(captionPx - 1, 11)}px;font-weight:700;letter-spacing:2px`,
    kickerLine: `margin:0 0 16px;padding-bottom:10px;border-bottom:1px solid ${hexToRgba(accent, 0.35)};color:${accent};font-size:${Math.max(captionPx - 1, 11)}px;font-weight:700;letter-spacing:4px`,
    kickerMono: `margin:0 0 14px;padding-bottom:8px;border-bottom:1px dashed ${hexToRgba(accent, 0.45)};color:${accent};font-family:${mono};font-size:${captionPx}px;letter-spacing:1px`,
    kickerCenter: `margin:0 0 18px;text-align:center;color:${muted};font-size:${Math.max(captionPx - 1, 11)}px;letter-spacing:6px`,
    h1: variants.h1 === 'invert-block'
      ? `background:${ink};color:${background};padding:18px 18px 22px;font-size:${h2Px + 9}px;line-height:1.3;margin:0 0 ${sectionPx}px;border-bottom:6px solid ${accent};font-weight:900;letter-spacing:.01em`
      : variants.h1 === 'center-double'
        ? `font-family:${serif};text-align:center;font-size:${h2Px + 10}px;line-height:1.35;margin:0 0 ${sectionPx}px;padding:20px 4px 18px;border-top:6px double ${ink};border-bottom:1px solid ${ink};font-weight:700;letter-spacing:.04em`
      : variants.h1 === 'serif-display'
          ? `font-family:${serif};font-size:${h2Px + 12}px;line-height:1.35;margin:0 0 ${sectionPx}px;padding:4px 0 16px;border-bottom:1px solid ${hexToRgba(accent, 0.3)};font-weight:700;color:${ink};letter-spacing:.06em`
          : variants.h1 === 'terminal-title'
            ? `font-family:${font};font-size:${h2Px + 8}px;line-height:1.3;margin:0 0 ${sectionPx}px;padding:4px 0 16px;border-bottom:1px solid ${hexToRgba(accent, 0.45)};font-weight:800;color:${ink};letter-spacing:-.01em`
          : variants.serifHeadings
            ? `font-family:${headingFont};font-size:${h2Px + 8}px;line-height:1.4;margin:0 0 ${sectionPx}px;padding-bottom:16px;border-bottom:1px solid #dedbd3;font-weight:700;letter-spacing:.01em`
            : `font-size:${h2Px + 7}px;line-height:1.35;margin:0 0 ${sectionPx}px;font-weight:900;color:${ink};letter-spacing:-.01em`,
    h2: variants.h2 === 'numbered-rule'
      ? `font-family:${headingFont};font-size:${h2Px}px;line-height:1.45;margin:${sectionPx + 6}px 0 ${paragraphPx}px;padding-top:18px;border-top:2px solid #E8E2D6;font-weight:700`
      : variants.h2 === 'terminal'
        ? `font-family:${mono};font-size:${h2Px}px;line-height:1.4;margin:${sectionPx + 6}px 0 ${paragraphPx + 4}px;padding-bottom:8px;border-bottom:1px dashed ${hexToRgba(accent, 0.5)};font-weight:700;color:${ink}`
        : variants.h2 === 'center-double'
          ? `font-family:${serif};text-align:center;font-size:${h2Px + 1}px;letter-spacing:2px;line-height:1.4;margin:${sectionPx + 8}px 0 ${paragraphPx + 6}px;padding-bottom:12px;border-bottom:2px solid ${ink};font-weight:700`
          : variants.h2 === 'cn-number'
            ? `font-family:${serif};font-size:${h2Px + 2}px;line-height:1.45;margin:${sectionPx + 8}px 0 ${paragraphPx}px;font-weight:700;color:${ink}`
            : variants.h2 === 'invert-tag'
              ? `display:inline-block;background:${ink};color:${background};font-size:${h2Px - 1}px;line-height:1.35;margin:${sectionPx + 8}px 0 ${paragraphPx + 4}px;padding:7px 14px;font-weight:800;letter-spacing:.02em`
              : `font-size:${h2Px}px;font-weight:800;color:${ink};margin:0;line-height:1.3`,
    h2Wrap: `margin:${sectionPx + 10}px 0 ${paragraphPx + 6}px;padding:4px 14px 5px;border-left:5px solid ${accent};background:${hexToRgba(accent, 0.065)};border-radius:0 10px 10px 0`,
    h2Eyebrow: `display:block;font-size:${Math.max(captionPx - 1, 11)}px;color:${lighten(accent, 0.35)};letter-spacing:3px;font-weight:700;margin-bottom:8px`,
    h2Number: `font-family:${font};color:${accent};font-size:${bodyPx}px;letter-spacing:.08em;margin-right:10px;font-weight:400`,
    h3: `font-family:${headingFont};font-size:${Math.min(h2Px, bodyPx + 2)}px;margin:${sectionPx - 4}px 0 ${Math.max(paragraphPx - 4, 6)}px`,
    h4: `font-size:${bodyPx}px;margin:${sectionPx - 6}px 0 ${Math.max(paragraphPx - 6, 4)}px`,
    p: `margin:0 0 ${paragraphPx}px;line-height:${lineHeight}`,
    lead: `margin:0 0 ${paragraphPx + 4}px;padding:${isResearch ? '0 6px 16px' : isCareer ? '0 2px 14px' : '0 0 14px'};border-bottom:1px solid ${hexToRgba(isResearch ? ink : accent, 0.2)};font-size:${bodyPx + 1}px;line-height:${Math.min(lineHeight + 0.08, 2.1).toFixed(2)}`,
    strongColor: variants.strong === 'accent' ? accent : ink,
    blockquote: variants.quote === 'warm-card'
      ? `margin:${paragraphPx + 8}px 0;padding:14px 16px;background:${hexToRgba(accent, 0.1)};border-left:4px solid ${accent};border-radius:0 12px 12px 0;color:${ink};font-family:${serif};font-size:${bodyPx}px;line-height:${lineHeight}`
      : variants.quote === 'terminal-panel'
        ? `margin:${paragraphPx + 6}px 0;padding:14px 16px;background:#161B22;border-left:3px solid ${accent};border-radius:6px;color:${lighten(ink, 0.02)};font-size:${bodyPx}px;line-height:${lineHeight}`
        : variants.quote === 'boxed'
          ? `margin:${paragraphPx + 8}px 0;padding:16px 20px;border:1px solid ${ink};color:${ink};font-family:${serif};font-size:${bodyPx}px;line-height:${lineHeight}`
          : variants.quote === 'quote-marks'
            ? `margin:${sectionPx - 4}px 0;padding:10px 24px;text-align:center;font-family:${serif};font-size:${bodyPx + 4}px;line-height:1.9;color:${lighten(ink, 0.08)}`
            : variants.quote === 'plain-bar'
              ? `margin:${paragraphPx + 6}px 0;padding:12px 16px;border-left:6px solid ${ink};color:${ink};font-size:${bodyPx}px;line-height:${lineHeight}`
              : variants.quote === 'dark-block'
                ? `margin:${paragraphPx + 8}px 0;padding:18px 20px;background:#111111;color:#FFFFFF;border-radius:12px;font-size:${bodyPx + 2}px;font-weight:700;line-height:${lineHeight}`
                : `margin:${paragraphPx + 4}px 0;padding:16px 20px;background:linear-gradient(135deg,${hexToRgba(accent, 0.08)} 0%,${hexToRgba(accent, 0.05)} 100%);border-left:4px solid ${accent};border-radius:0 12px 12px 0;color:${ink};font-size:${bodyPx}px;line-height:${lineHeight}`,
    list: `margin:12px 0 ${paragraphPx + 4}px;padding:${variants.list === 'news-panel' ? '10px 12px 10px 30px' : '0 0 0 25px'}${variants.list === 'news-panel' ? `;background:${hexToRgba(ink, 0.035)};border-top:1px solid ${hexToRgba(ink, 0.15)};border-bottom:1px solid ${hexToRgba(ink, 0.15)}` : ''}`,
    listNone: `margin:12px 0 ${paragraphPx + 4}px;padding-left:6px;list-style:none`,
    li: 'margin:7px 0',
    a: `color:${accent};text-decoration:none;border-bottom:1px solid ${accent}`,
    img: `display:block;max-width:100%;height:auto;margin:26px auto${variants.image === 'rounded' ? `;border-radius:${radiusPx || 10}px` : ''}${variants.image === 'framed' ? `;border:1px solid ${hexToRgba(ink, 0.2)};padding:3px;box-sizing:border-box` : ''}`,
    hr: `text-align:center;color:${muted};letter-spacing:.6em;margin:${sectionPx}px 0;font-size:${bodyPx}px`,
    hairline: `border-top:1px solid #E5E7EB;margin:${sectionPx}px 0;font-size:0;line-height:0`,
    thickBar: `border-top:4px solid ${ink};margin:${sectionPx}px 0;font-size:0;line-height:0`,
    monoDivider: `text-align:center;color:${muted};font-family:${mono};font-size:${captionPx}px;letter-spacing:2px;margin:${sectionPx}px 0`,
    code: `font-family:${mono};background:${hexToRgba(accent, 0.15)};padding:2px 5px;border-radius:3px`,
    pre: `margin:0 0 ${paragraphPx}px;padding:14px 16px;overflow-x:auto;background:${variants.h2 === 'terminal' ? '#161B22' : hexToRgba(ink, 0.06)};border-left:3px solid ${accent};border-radius:6px;white-space:pre`,
    codeBlock: `font-family:${mono};font-size:${Math.max(bodyPx - 2, 12)}px;line-height:1.65;color:${ink};white-space:pre`,
    table: `width:100%;margin:4px 0 ${paragraphPx + 4}px;border-collapse:collapse;table-layout:fixed;font-size:${Math.max(bodyPx - 1, 13)}px`,
    th: `padding:10px 9px;border:1px solid ${hexToRgba(ink, 0.28)};background:${variants.table === 'dark-header' ? '#161B22' : variants.table === 'ink-header' ? ink : hexToRgba(accent, 0.12)};color:${variants.table === 'dark-header' || variants.table === 'ink-header' ? background : ink};font-weight:700;text-align:left;word-break:break-word`,
    td: `padding:10px 9px;border:1px solid ${hexToRgba(ink, 0.18)};${variants.table === 'dark-header' ? `background:#0F141B;` : ''}vertical-align:top;word-break:break-word`,
    sup: `color:${accent};font-size:${Math.max(captionPx - 1, 11)}px;line-height:0`,
    footnote: `font-size:${captionPx}px;color:${muted};line-height:1.7;margin:0 0 8px`,
  };
  return { styles, variants };
}

function inline(text, styles) {
  let value = escapeHtml(text);
  value = value.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, `<img src="$2" alt="$1" style="${styles.img}">`);
  value = value.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, `<a href="$2" style="${styles.a}">$1</a>`);
  value = value.replace(/\[\^([^\]]+)\]/g, `<sup style="${styles.sup}">[$1]</sup>`);
  value = value.replace(/`([^`]+)`/g, `<code style="${styles.code}">$1</code>`);
  // 公众号编辑器约定（对齐 wechat-html-normalizer SPEC §5.7）：
  // 加粗用 <span leaf=""><span textstyle=""> 嵌套内联形式，不用 strong/b
  value = value.replace(/\*\*([^*]+)\*\*/g, `<span leaf=""><span textstyle="" style="font-weight: bold;color:${styles.strongColor}">$1</span></span>`);
  value = value.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<span leaf=""><span textstyle="" style="font-style:italic">$1</span></span>');
  return value;
}

export function markdownToHtml(markdown, tokens = {}) {
  const { styles, variants } = buildInlineStyles(tokens, tokens.theme);
  const kicker = String(tokens.kicker || '').trim();
  const renderInline = (text) => inline(text, styles);
  const dividerHtml = variants.divider === 'hairline'
    ? `<p style="${styles.hairline}"></p>`
    : variants.divider === 'thick-bar'
      ? `<p style="${styles.thickBar}"></p>`
      : variants.divider === 'mono-comment'
        ? `<p style="${styles.monoDivider}">/* ─────── 8&lt; ─────── */</p>`
        : variants.divider === 'rule-mark'
          ? `<p style="${styles.hr}">◆</p>`
          : variants.divider === 'stars'
            ? `<p style="${styles.hr}">✦&ensp;✦&ensp;✦</p>`
            : `<p style="${styles.hr}">···</p>`;
  const lines = String(markdown).replace(/\r/g, '').split('\n');
  const blocks = [];
  const footnotes = [];
  let paragraph = [];
  let list = null;
  let leadUsed = false;
  let h2Count = 0;
  const flushParagraph = () => {
    if (paragraph.length) {
      // 全文首个段落按杂志导语处理：字号略大，节奏更从容（视主题而定）
      const style = variants.lead && !leadUsed ? styles.lead : styles.p;
      leadUsed = true;
      blocks.push(`<p style="${style}">${paragraph.map(renderInline).join('<br>')}</p>`);
      paragraph = [];
    }
  };
  // SPEC §5.7：列表项「加粗前缀 + 正文」须用 font-weight:normal 断开，
  // 否则公众号编辑器会把整行当成全粗（并可能拆行）
  const wrapLiItem = (html) => {
    const boldOpen = '<span leaf=""><span textstyle="" style="font-weight: bold;';
    if (!html.startsWith(boldOpen)) return html;
    const end = html.indexOf('</span></span>');
    if (end < 0) return html;
    const rest = html.slice(end + '</span></span>'.length);
    if (!rest.trim()) return html;
    return `${html.slice(0, end + '</span></span>'.length)}<span leaf=""><span textstyle="" style="font-weight: normal">${rest}</span></span>`;
  };
  const flushList = () => {
    if (!list) return;
    // 终端风列表：去掉默认圆点，用绿色 › 光标前缀
    const chevron = variants.list === 'chevron' && list.type === 'ul';
    const listStyle = chevron ? styles.listNone : styles.list;
    blocks.push(`<${list.type} style="${listStyle}">${list.items.map((item) => `<li style="${styles.li}">${chevron ? `<span style="color:${styles.strongColor};font-weight:700">› </span>` : ''}${wrapLiItem(renderInline(item))}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  const splitTableRow = (line) => {
    let value = line.trim();
    if (value.startsWith('|')) value = value.slice(1);
    if (value.endsWith('|')) value = value.slice(0, -1);
    const cells = [];
    let cell = '';
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === '\\' && value[index + 1] === '|') {
        cell += '|';
        index += 1;
      } else if (value[index] === '|') {
        cells.push(cell.trim());
        cell = '';
      } else cell += value[index];
    }
    cells.push(cell.trim());
    return cells;
  };
  const isTableDivider = (line) => {
    const cells = splitTableRow(line);
    return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const fence = line.match(/^\s*```([^`]*)$/);
    if (fence) {
      flushParagraph(); flushList();
      const codeLines = [];
      lineIndex += 1;
      while (lineIndex < lines.length && !/^\s*```\s*$/.test(lines[lineIndex])) {
        codeLines.push(lines[lineIndex]);
        lineIndex += 1;
      }
      const language = fence[1].trim().replace(/[^\w.+-]/g, '');
      const languageAttr = language ? ` data-language="${escapeHtml(language)}"` : '';
      blocks.push(`<pre style="${styles.pre}"><code${languageAttr} style="${styles.codeBlock}">${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }
    if (line.includes('|') && lineIndex + 1 < lines.length && isTableDivider(lines[lineIndex + 1])) {
      flushParagraph(); flushList();
      const headers = splitTableRow(line);
      const rows = [];
      lineIndex += 2;
      while (lineIndex < lines.length && lines[lineIndex].trim() && lines[lineIndex].includes('|')) {
        rows.push(splitTableRow(lines[lineIndex]));
        lineIndex += 1;
      }
      lineIndex -= 1;
      const headerHtml = headers.map((cell) => `<th style="${styles.th}">${renderInline(cell)}</th>`).join('');
      const bodyHtml = rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td style="${styles.td}">${renderInline(row[cellIndex] || '')}</td>`).join('')}</tr>`).join('');
      blocks.push(`<table style="${styles.table}"><thead><tr>${headerHtml}</tr></thead>${bodyHtml ? `<tbody>${bodyHtml}</tbody>` : ''}</table>`);
      continue;
    }
    if (/^<!--/.test(line.trim())) { flushParagraph(); flushList(); blocks.push(line); continue; }
    const footnoteDef = line.match(/^\[\^([^\]]+)\]:\s*(.+)$/);
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (footnoteDef) { flushParagraph(); flushList(); footnotes.push({ id: footnoteDef[1], text: footnoteDef[2] }); }
    else if (heading) {
      flushParagraph(); flushList();
      const level = heading[1].length;
      if (level === 2) h2Count += 1;
      if (level === 2 && variants.h2 === 'eyebrow-border') {
        // 卡片风章节：左边条 + 「📍 第N篇」眉题
        const cn = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][h2Count - 1] || h2Count;
        blocks.push(`<section style="${styles.h2Wrap}"><span style="${styles.h2Eyebrow}">📍 第${cn}篇</span><h2 style="${styles.h2}">${renderInline(heading[2])}</h2></section>`);
      } else {
        // 章节前缀：终端风「# 」、手账风「一、」、杂志风「01 /」
        let prefix = '';
        if (level === 2 && variants.h2 === 'terminal') prefix = `<span style="color:${styles.strongColor}"># </span>`;
        else if (level === 2 && variants.h2 === 'cn-number') {
          const cn = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][h2Count - 1] || h2Count;
          prefix = `<span style="color:${styles.strongColor}">${cn}、</span>`;
        } else if (level === 2 && variants.h2 === 'numbered-rule') prefix = `<span style="${styles.h2Number}">${String(h2Count).padStart(2, '0')} /</span>`;
        // 眉题：杂志式栏目小标签，放在 h1 上方
        const chip = level === 1 && kicker
          ? variants.kicker === 'chip'
            ? `<p style="${styles.kicker}"><span style="${styles.kickerChip}">${escapeHtml(kicker)}</span></p>`
            : variants.kicker === 'line-label'
              ? `<p style="${styles.kickerLine}">${escapeHtml(kicker)}</p>`
              : variants.kicker === 'mono-line'
                ? `<p style="${styles.kickerMono}">$ ${escapeHtml(kicker)}</p>`
                : variants.kicker === 'center-label'
                  ? `<p style="${styles.kickerCenter}">${escapeHtml(kicker)}</p>`
                  : ''
          : '';
        blocks.push(`${chip}<h${level} style="${styles[`h${level}`]}">${prefix}${renderInline(heading[2])}</h${level}>`);
      }
    }
    else if (bullet || ordered) {
      flushParagraph(); const type = bullet ? 'ul' : 'ol';
      if (list?.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push((bullet || ordered)[1]);
    } else if (/^>\s?/.test(line)) {
      flushParagraph(); flushList();
      const quoteText = renderInline(line.replace(/^>\s?/, ''));
      // 手账风拉页引文：首尾加大号引号
      blocks.push(variants.quote === 'quote-marks'
        ? `<section style="${styles.blockquote}"><span style="font-size:30px;line-height:1">“</span>${quoteText}<span style="font-size:30px;line-height:1">”</span></section>`
        : `<section style="${styles.blockquote}">${quoteText}</section>`);
    }
    else if (/^---+$/.test(line.trim())) { flushParagraph(); flushList(); blocks.push(dividerHtml); }
    else if (!line.trim()) { flushParagraph(); flushList(); }
    else paragraph.push(line);
  }
  flushParagraph(); flushList();
  // 脚注定义统一收束到文末：分隔符 + 小号灰字参考来源区
  if (footnotes.length) {
    blocks.push(dividerHtml);
    for (const note of footnotes) {
      blocks.push(`<p style="${styles.footnote}"><sup style="${styles.sup}">[${escapeHtml(note.id)}]</sup> ${renderInline(note.text)}</p>`);
    }
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>公众号文章</title></head><body><article style="${styles.article}">${blocks.join('\n')}</article></body></html>`;
}

async function runScript(script, args, cwd) {
  try {
    return await execFileAsync(process.execPath, [script, ...args], { cwd, windowsHide: true, timeout: 120000, maxBuffer: 2_000_000 });
  } catch (error) {
    throw new Error(String(error.stderr || error.stdout || error.message).trim());
  }
}

export async function runTypesetPipeline({ gateway, store, batchId, candidateId, documentKind = null, provider, workspaceRoot, skillsWorkspaceRoot = workspaceRoot, snapshotId=null, draftMode = 'deterministic', theme = 'auto', autoUploadGeneratedImages = true, onProgress = () => {} }) {
  const candidate = candidateId==null?null:store.getCandidate(candidateId);
  const daily=documentKind==='daily-final';
  if ((!daily&&(!candidate||candidate.batch_id!==batchId))||(daily&&candidate)) throw new Error('待排版文稿不存在或不属于当前批次');
  // theme 为 auto/缺省时按候选类型确定性映射，不传模型
  if (theme === 'auto' || !theme) theme = defaultTypesetTheme(daily?{category:'📰 综合资讯'}:candidate);
  const themeDefinition=resolveWorkspaceTheme(store,theme,'article')||articleThemeDefinition(theme,{fallback:false});
  if (!themeDefinition) throw new Error(`未知排版主题：${theme}（可选：auto、${Object.keys(TYPESET_THEMES).join('、')}）`);
  const compiledTheme=compileArticleTheme(themeDefinition);
  store.recordThemeUsage?.({themeId:themeDefinition.id,version:themeDefinition.version,target:'article',source:themeDefinition.source,batchId,candidateId});
  const batch = store.getBatch(batchId);
  const workdir = daily?path.join(batchArticlesDir(workspaceRoot,batch),'daily'):candidateArticleDir(workspaceRoot, batch, candidate);
  const finalPath = daily?path.join(workdir,'03-FINAL.md'):path.join(workdir, '09-FINAL.md');
  if (!fs.existsSync(finalPath)) throw new Error(`缺少 ${path.basename(finalPath)}，请先保存终稿`);
  const themeSnapshotPath=path.join(workdir,'article-theme-snapshot.json');
  writeFile(themeSnapshotPath,JSON.stringify({schemaVersion:1,id:themeDefinition.id,label:themeDefinition.label,version:themeDefinition.version,source:themeDefinition.source,hash:themeDefinition.hash},null,2));
  const skills = loadTypesetSkills(skillsWorkspaceRoot);
  const typesetRuntime=await prepareSkillRun({gateway,store,batchId,candidateId,purpose:'typeset',bundles:Object.values(skills),provider,snapshotId});
  gateway=bindGenerationSnapshot(gateway,typesetRuntime.snapshotId);
  provider=typesetRuntime.provider;
  const stages = [];
  const record = (stage, skill, output, status = 'completed', detail = '') => {
    const expected = TYPESET_STAGE_CONTRACT[stages.length];
    if (!expected || expected.id !== stage || expected.skill !== skill) {
      throw new Error(`排版契约阶段不一致：期望 ${expected?.id || '结束'}/${expected?.skill || '-'}，实际 ${stage}/${skill}`);
    }
    stages.push({ stage, skill, skillHash:skills[skill]?.hash || '', output, status, detail, completedAt:new Date().toISOString() });
    writeExecutionFiles(workdir, skills, stages);
  };
  const renderedPath = path.join(workdir, '09-FINAL.rendered.md');
  onProgress('排版 1/6：按总契约执行 wechat-md-render');
  await runScript(skillScript(skills['wechat-md-render'], 'scripts', 'md-render.js'), [finalPath, renderedPath], workdir);
  if (!fs.readFileSync(renderedPath, 'utf8').trim()) throw new Error('预渲染结果为空');
  record('rendered', 'wechat-md-render', renderedPath);
  addArtifact(store, batchId, '预渲染文章', path.basename(renderedPath), renderedPath);

  const providerConfig = typesetRuntime.providerConfig;
  onProgress('排版 2/6：按总契约执行 magazine-design-advisor');
  const designResult = await gateway.complete({ provider, purpose: 'magazine-design', batchId, candidateId, jsonMode: true,
    maxOutputTokens: Math.min(3200, providerConfig.maxOutputTokens), messages: [
      { role: 'system', protected: true, content: `${skills['wechat-article-typeset'].prompt}\n\n## 当前阶段子技能\n${skills['magazine-design-advisor'].prompt}\n\n执行契约：当前只执行 design 阶段，只返回 JSON，不得改写正文。格式为 {"schemeMarkdown":"完整 Markdown 设计方案","tokens":{"schema_version":1,"colors":{"background":"#FFFFFF","text":"#222222","muted":"#666666","accent":"#B42318"},"typography":{"body_px":16,"line_height":1.75,"h2_px":24},"spacing":{"section_px":28,"paragraph_px":14},"image":{"radius_px":0,"caption_px":13}}}。` },
      { role: 'user', protected: true, content: fs.readFileSync(renderedPath, 'utf8').slice(0, 16000) },
    ] });
  const design = parseJson(designResult, store);
  const schemePath = path.join(workdir, '09-FINAL.design-scheme.md');
  const tokensPath = path.join(workdir, 'magazine-design-tokens.json');
  writeFile(schemePath, design.schemeMarkdown || '# 杂志设计方案\n\n克制、清晰、移动端优先。');
  const htmlTokens = normalizeDesignTokens(design.tokens);
  writeFile(tokensPath, JSON.stringify(htmlTokens, null, 2));
  const chartTokensPath = path.join(workdir, 'chart-design-tokens.json');
  const themeColors = compiledTheme.tokens.colors;
  const chartThemeColors=themeDefinition.tokens.colors;
  const articleRenderTokens={...compiledTheme.tokens,...htmlTokens,colors:{...(htmlTokens.colors||{}),...themeColors},theme,themeDefinition};
  writeFile(chartTokensPath, JSON.stringify({ ...htmlTokens, colors:{ ...(htmlTokens.colors || {}), ...chartThemeColors }, theme, themeVersion:themeDefinition.version, themeHash:themeDefinition.hash }, null, 2));
  record('design', 'magazine-design-advisor', `${schemePath};${tokensPath}`);
  addArtifact(store, batchId, '杂志设计方案', path.basename(schemePath), schemePath);
  addArtifact(store, batchId, '杂志设计 Tokens', path.basename(tokensPath), tokensPath);
  addArtifact(store, batchId, '文章主题快照', path.basename(themeSnapshotPath), themeSnapshotPath);

  const rendered = fs.readFileSync(renderedPath, 'utf8');
  onProgress('排版 3/6：按总契约处理图片和显式视觉模块');
  // Mermaid / ECharts 围栏由确定性脚本渲染为本地 PNG 并替换为图片引用；
  // 渲染失败的围栏保留原文并报错，绝不静默丢图
  const chartSteps = [
    [/```\s*mermaid\b/i, 'diagram.mermaid.render', 'Mermaid', '09-FINAL.mermaid.md'],
    [/```\s*echarts\b/i, 'diagram.echarts.render', 'ECharts', '09-FINAL.echarts.md'],
  ];
  const chartNotes = [];
  let chartReadyPath = renderedPath;
  const toolRegistry = await getToolRegistry();
  for (const [pattern, capability, label, fileName] of chartSteps) {
    if (!pattern.test(fs.readFileSync(chartReadyPath, 'utf8'))) continue;
    const chartPath = path.join(workdir, fileName);
    let chartReport = null;
    const toolResult = await toolRegistry.execute(capability, {
      inputPath:chartReadyPath, outputPath:chartPath, imageDir:path.join(workdir, 'images'), tokensPath:chartTokensPath,
    }, { allowedRoots:[workdir], allowedCapabilities:typesetRuntime.allowedCapabilities, cwd:workdir, timeoutMs:180000,
      executionLog:createStoreExecutionLogger(store,{batchId,candidateId,generationSnapshotId:typesetRuntime.snapshotId,skillId:'wechat-article-typeset'}) });
    if (toolResult.status === 'error') {
      const detail = toolResult.error.message;
      record('images', 'wechat-article-typeset', '', 'blocked', `${label} 渲染失败：${detail}`);
      throw new Error(`${label} 图表渲染失败，已停止排版以避免丢图：${detail}`);
    }
    chartReport = toolResult.data;
    chartReadyPath = chartPath;
    const generatedWorkspace = registerGeneratedImageAssets(workdir, label, chartReport.images || []);
    const generatedPaths = new Set((chartReport.images || []).map((item) => String(item).replaceAll('\\', '/')));
    const pendingUploads = generatedWorkspace.items.filter((item) =>
      item.generated && generatedPaths.has(String(item.relativePath || '').replaceAll('\\', '/')) && item.status !== 'cdn');
    for (const item of autoUploadGeneratedImages ? pendingUploads : []) {
      onProgress(`排版 3/6：${label} 图片已更新，正在上传 CDN`);
      await uploadImageToCdn(workdir, item.id, { authorizedExternalWrite:true, allowedCapabilities:typesetRuntime.allowedCapabilities,
        store,batchId,candidateId,generationSnapshotId:typesetRuntime.snapshotId,skillId:'wechat-article-typeset' });
    }
    addArtifact(store, batchId, `${label} 转图文章`, path.basename(chartPath), chartPath);
    chartNotes.push(`${label} ${chartReport.converted} 张${pendingUploads.length ? '（已重新上传 CDN）' : '（内容未变，复用 CDN）'}`);
  }
  const imageResult = buildImagesMarkdown(workdir, fs.readFileSync(chartReadyPath, 'utf8'));
  if (imageResult.unresolved.length) throw new Error(`配图尚未就绪：${imageResult.unresolved.join('、')}，请先提供图片并上传 CDN`);
  const imagesPath = path.join(workdir, '09-FINAL.images.md');
  writeFile(imagesPath, imageResult.content);
  addArtifact(store, batchId, '图片就绪文章', path.basename(imagesPath), imagesPath);
  const manifestPath = imageManifestFile(workdir);
  if (fs.existsSync(manifestPath)) addArtifact(store, batchId, '配图资产清单', path.basename(manifestPath), manifestPath);
  record('images', 'wechat-article-typeset', imagesPath, 'completed', chartNotes.length ? `显式视觉模块已转图并使用 CDN 地址：${chartNotes.join('、')}` : '最终 HTML 图片均已取得可公开访问的 HTTPS 地址');

  onProgress('排版 4/6：按总契约执行 wechat-md-to-draft');
  const draftHtml = path.join(workdir, 'article.ai.draft.html');
  let draftDetail;
  // 默认确定性渲染：HTML 拼装是机械工作，直接按 tokens 输出内联样式，
  // 不调用模型，也就不存在结构保真回退。draftMode 'llm' 保留旧路径用于实验对比。
  if (draftMode === 'llm') {
    const htmlGenSystem = `${skills['wechat-article-typeset'].prompt}\n\n## 当前阶段子技能\n${skills['wechat-md-to-draft'].prompt}\n\n执行契约：当前只执行 draft 阶段，只输出 UTF-8 HTML，不附说明或 Markdown 围栏。严格保留正文、标题、数字、来源、链接、图片与章节顺序；样式只能来自给定 tokens。`;
    const { provider: providerConfig2 } = gateway.resolve(provider);
    const htmlGenResult = await gateway.complete({ provider, purpose: 'typeset-html', batchId, candidateId,
      maxOutputTokens: Math.min(8000, providerConfig2.maxOutputTokens), messages: [
        { role: 'system', content: htmlGenSystem, protected: true },
        { role: 'user', content: JSON.stringify({
          designScheme: fs.readFileSync(schemePath, 'utf8'), tokens: htmlTokens, markdown: imageResult.content,
        }), protected: true },
      ] });
    const htmlContent = extractHtmlModelOutput(htmlGenResult.content);
    // If AI output lacks basic HTML structure, fallback to deterministic converter
    const useModelHtml = /<\/?h[1-3]/i.test(htmlContent) && htmlPreservesStructure(imageResult.content, htmlContent);
    writeFile(draftHtml, enforceWechatFlowLayout(useModelHtml ? htmlContent : markdownToHtml(imageResult.content, articleRenderTokens)));
    draftDetail = useModelHtml ? '模型初稿通过结构保真门禁' : '模型初稿不合格，使用确定性转换器';
  } else {
    // 眉题取账号名（没有账号配置时省略）；主题 tokens 作底色，LLM tokens 叠加覆盖
    let kicker = '';
    try { kicker = String(JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'account-context.json'), 'utf8')).name || '').trim(); } catch { /* 无账号配置 */ }
    writeFile(draftHtml, markdownToHtml(imageResult.content, { ...articleRenderTokens, kicker }));
    draftDetail = `确定性渲染：主题 ${theme}@${themeDefinition.version}（${themeDefinition.hash}），按 JSON 主题和 design tokens 输出内联样式，未调用模型`;
  }
  if (!htmlPreservesStructure(imageResult.content, fs.readFileSync(draftHtml, 'utf8'))) throw new Error('HTML 初稿未完整保留标题、章节、链接或图片');
  record('draft', 'wechat-md-to-draft', draftHtml, 'completed', draftDetail);
  addArtifact(store, batchId, 'HTML 初稿', path.basename(draftHtml), draftHtml);

  onProgress('排版 5/6：按总契约执行 wechat-html-normalizer');
  const finalHtml = path.join(workdir, 'article.ai.html');
  if (draftMode === 'llm') {
    // 模型初稿样式写在 <style> 里，需浏览器计算级联并物化为内联样式
    await runScript(skillScript(skills['wechat-html-normalizer'], 'scripts', 'normalize-html.mjs'), [draftHtml, finalHtml], workdir);
    record('normalized', 'wechat-html-normalizer', finalHtml);
  } else {
    // 确定性初稿天生是内联样式，跳过浏览器内联化
    fs.copyFileSync(draftHtml, finalHtml);
    record('normalized', 'wechat-html-normalizer', finalHtml, 'completed', '确定性初稿已是内联样式，跳过浏览器内联化');
  }

  onProgress('排版 6/6：按总契约执行 wechat-html-check-no-div');
  const gate = await runScript(skillScript(skills['wechat-html-check-no-div'], 'scripts', 'check-html.mjs'), [finalHtml], workdir);
  let gateResult;
  try { gateResult = JSON.parse(gate.stdout.trim().split(/\r?\n/).at(-1)); } catch { throw new Error(`无法解析排版门禁结果：${gate.stdout}`); }
  if (!gateResult.valid) throw new Error(`排版门禁未通过：${(gateResult.issues || []).join('、')}`);
  record('gate', 'wechat-html-check-no-div', finalHtml, 'completed', JSON.stringify(gateResult));
  addArtifact(store, batchId, '门禁后 HTML', path.basename(finalHtml), finalHtml);

  if (stages.length !== TYPESET_STAGE_CONTRACT.length) throw new Error('排版契约未完整执行');
  onProgress('排版完成：article.ai.html 已生成并通过门禁');
  store.updateBatch(batchId, { stage: 'typeset', status: 'completed' });
  return { workdir, finalHtml, gate: gateResult, theme:{id:themeDefinition.id,version:themeDefinition.version,hash:themeDefinition.hash}, themeSnapshot:themeSnapshotPath, skillManifest:path.join(workdir, 'typeset-skill-manifest.json'), stageExecutions:path.join(workdir, 'typeset-stage-executions.json') };
}
