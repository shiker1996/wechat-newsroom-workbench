import { colorContrast } from '../themes/theme-validator.mjs';
import { articleThemeDefinition, compileArticleTheme } from '../themes/article-theme-compiler.mjs';

export function normalizeDesignTokens(input = {}) {
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

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

// 自动主题：与成稿链 writerSkill 的判定保持一致——八卦吃瓜类走卡片风，
// 其余按选题分类映射到对应主题；综合文按研报处理。
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
  const components = theme.components;
  const themeVariables = theme.variables;
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
    colors: { ...(themeVariables.colors || {}), ...legacyFlat, ...(tokens.colors || {}) },
  };
  const design = normalizeDesignTokens(merged);
  const { background, text: ink, muted, accent } = design.colors;
  const surface = merged.colors.surface || background;
  const accentSecondary = merged.colors.accentSecondary || accent;
  const line = merged.colors.line || muted;
  const inverseText = merged.colors.inverseText || background;
  const codeBackground = merged.colors.codeBackground || surface;
  // codeBackground 与 inverseText 并非天然成对（浅色代码面板或深色主题会撞色），
  // 代码与深色表头文字色在 inverseText 与正文色之间确定性选择对比度更高者
  const codeText = colorContrast(inverseText, codeBackground) >= colorContrast(ink, codeBackground) ? inverseText : ink;
  const bodyPx = design.typography.body_px;
  const lineHeight = design.typography.line_height;
  const h2Px = design.typography.h2_px;
  const sectionPx = design.spacing.section_px;
  const paragraphPx = design.spacing.paragraph_px;
  const radiusPx = design.image.radius_px;
  const captionPx = design.image.caption_px;
  const h1Px = Number(themeVariables.typography.h1Px);
  const letterSpacing = Number(themeVariables.typography.letterSpacingEm);
  const articlePaddingPx = Number(themeVariables.spacing.articlePaddingPx);
  const cardGapPx = Number(themeVariables.spacing.cardGapPx);
  const borderWidthPx = Number(themeVariables.shape.borderWidthPx);
  const rhythm=tokens.themeDefinition?variants.rhythm||'standard':'standard';
  const rhythmSectionPx=Math.max(16,Math.min(56,sectionPx+(rhythm==='airy'?8:rhythm==='dense'?-8:0)));
  const rhythmParagraphPx=Math.max(8,Math.min(28,paragraphPx+(rhythm==='airy'?4:rhythm==='dense'?-4:0)));
  const rhythmCardGapPx=Math.max(4,Math.min(28,cardGapPx+(rhythm==='airy'?3:rhythm==='dense'?-3:0)));
  const rhythmLineHeight=Math.max(1.35,Math.min(2.1,lineHeight+(rhythm==='airy'?.08:rhythm==='dense'?-.08:0)));
  const themeRadiusPx = Number(themeVariables.shape.radiusPx);
  const shadow = ({none:'none',soft:`0 10px 28px ${hexToRgba(ink,.12)}`,hard:`6px 6px 0 ${accentSecondary}`,glow:`0 0 22px ${hexToRgba(accent,.28)}`})[themeVariables.shape.shadow] || 'none';
  const font = `-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif`;
  // 杂志风：标题、引言用衬线，正文保留无衬线保证移动端可读性
  const serif = `Georgia,'Songti SC','STSong','SimSun',serif`;
  const mono = `Consolas,'Courier New',monospace`;
  const headingFont = themeVariables.typography.headingFamily === 'serif' ? serif : themeVariables.typography.headingFamily === 'mono' ? mono : font;
  const bodyFont = variants.bodyFont === 'serif' ? serif : variants.bodyFont === 'mono' ? mono : font;
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
    article: `box-sizing:border-box;margin:0;padding:${articlePaddingPx}px;background:${background};color:${ink};font-family:${bodyFont};font-size:${bodyPx}px;line-height:${rhythmLineHeight};letter-spacing:${letterSpacing}em;${articleFrame}${variants.justify ? ';text-align:justify' : ''}`,
    kicker: `margin:0 0 14px`,
    kickerChip: `display:inline-block;padding:3px 8px;background:${accent};color:${inverseText};font-size:${Math.max(captionPx - 1, 11)}px;font-weight:700;letter-spacing:2px`,
    kickerLine: `margin:0 0 16px;padding-bottom:10px;border-bottom:1px solid ${hexToRgba(accent, 0.35)};color:${accent};font-size:${Math.max(captionPx - 1, 11)}px;font-weight:700;letter-spacing:4px`,
    kickerMono: `margin:0 0 14px;padding-bottom:8px;border-bottom:1px dashed ${hexToRgba(accent, 0.45)};color:${accent};font-family:${mono};font-size:${captionPx}px;letter-spacing:1px`,
    kickerCenter: `margin:0 0 18px;text-align:center;color:${muted};font-size:${Math.max(captionPx - 1, 11)}px;letter-spacing:6px`,
    h1: variants.h1 === 'invert-block'
      ? `background:${ink};color:${inverseText};padding:18px 18px 22px;font-size:${h1Px}px;line-height:1.3;margin:0 0 ${rhythmSectionPx}px;border-bottom:6px solid ${accent};font-weight:900;letter-spacing:${letterSpacing}em`
      : variants.h1 === 'center-double'
        ? `font-family:${headingFont};text-align:center;font-size:${h1Px}px;line-height:1.35;margin:0 0 ${rhythmSectionPx}px;padding:20px 4px 18px;border-top:6px double ${ink};border-bottom:1px solid ${ink};font-weight:700;letter-spacing:${letterSpacing}em`
      : variants.h1 === 'serif-display'
          ? `font-family:${headingFont};font-size:${h1Px}px;line-height:1.35;margin:0 0 ${rhythmSectionPx}px;padding:4px 0 16px;border-bottom:1px solid ${line};font-weight:700;color:${ink};letter-spacing:${letterSpacing}em`
          : variants.h1 === 'terminal-title'
            ? `font-family:${headingFont};font-size:${h1Px}px;line-height:1.3;margin:0 0 ${rhythmSectionPx}px;padding:4px 0 16px;border-bottom:1px solid ${line};font-weight:800;color:${ink};letter-spacing:${letterSpacing}em`
          : variants.serifHeadings
            ? `font-family:${headingFont};font-size:${h1Px}px;line-height:1.4;margin:0 0 ${rhythmSectionPx}px;padding-bottom:16px;border-bottom:1px solid ${line};font-weight:700;letter-spacing:${letterSpacing}em`
            : `font-size:${h1Px}px;line-height:1.35;margin:0 0 ${rhythmSectionPx}px;font-weight:900;color:${ink};letter-spacing:${letterSpacing}em`,
    h2: variants.h2 === 'numbered-rule'
      ? `font-family:${headingFont};font-size:${h2Px}px;line-height:1.45;margin:${sectionPx + 6}px 0 ${paragraphPx}px;padding-top:18px;border-top:${Math.max(1,borderWidthPx)}px solid ${line};font-weight:700`
      : variants.h2 === 'terminal'
        ? `font-family:${mono};font-size:${h2Px}px;line-height:1.4;margin:${sectionPx + 6}px 0 ${paragraphPx + 4}px;padding-bottom:8px;border-bottom:1px dashed ${hexToRgba(accent, 0.5)};font-weight:700;color:${ink}`
        : variants.h2 === 'center-double'
          ? `font-family:${serif};text-align:center;font-size:${h2Px + 1}px;letter-spacing:2px;line-height:1.4;margin:${sectionPx + 8}px 0 ${paragraphPx + 6}px;padding-bottom:12px;border-bottom:2px solid ${ink};font-weight:700`
          : variants.h2 === 'cn-number'
            ? `font-family:${serif};font-size:${h2Px + 2}px;line-height:1.45;margin:${sectionPx + 8}px 0 ${paragraphPx}px;font-weight:700;color:${ink}`
            : variants.h2 === 'invert-tag'
              ? `display:inline-block;background:${ink};color:${background};font-size:${h2Px - 1}px;line-height:1.35;margin:${sectionPx + 8}px 0 ${paragraphPx + 4}px;padding:7px 14px;font-weight:800;letter-spacing:.02em`
              : `font-size:${h2Px}px;font-weight:800;color:${ink};margin:0;line-height:1.3`,
    h2Wrap: `margin:${sectionPx + 10}px 0 ${paragraphPx + 6}px;padding:4px 14px 5px;border-left:${Math.max(1,borderWidthPx+4)}px solid ${accent};background:${surface};border-radius:0 ${themeRadiusPx}px ${themeRadiusPx}px 0`,
    h2Eyebrow: `display:block;font-size:${Math.max(captionPx - 1, 11)}px;color:${accentSecondary};letter-spacing:3px;font-weight:700;margin-bottom:8px`,
    h2Number: `font-family:${font};color:${accent};font-size:${bodyPx}px;letter-spacing:.08em;margin-right:10px;font-weight:400`,
    h3: `font-family:${headingFont};font-size:${Math.min(h2Px, bodyPx + 2)}px;margin:${rhythmSectionPx - 4}px 0 ${Math.max(rhythmParagraphPx - 4, 6)}px`,
    h4: `font-size:${bodyPx}px;margin:${rhythmSectionPx - 6}px 0 ${Math.max(rhythmParagraphPx - 6, 4)}px`,
    p: `margin:0 0 ${rhythmParagraphPx}px;line-height:${rhythmLineHeight}`,
    lead: `margin:0 0 ${rhythmParagraphPx + 4}px;padding:${isResearch ? '0 6px 16px' : isCareer ? '0 2px 14px' : '0 0 14px'};border-bottom:1px solid ${hexToRgba(isResearch ? ink : accent, 0.2)};font-size:${bodyPx + 1}px;line-height:${Math.min(rhythmLineHeight + 0.08, 2.1).toFixed(2)}`,
    strongColor: variants.strong === 'accent' ? accent : ink,
    blockquote: variants.quote === 'warm-card'
      ? `margin:${paragraphPx + 8}px 0;padding:14px 16px;background:${hexToRgba(accent, 0.1)};border-left:4px solid ${accent};border-radius:0 12px 12px 0;color:${ink};font-family:${serif};font-size:${bodyPx}px;line-height:${lineHeight}`
      : variants.quote === 'terminal-panel'
        ? `margin:${paragraphPx + 6}px 0;padding:${cardGapPx}px;background:${surface};border-left:${Math.max(1,borderWidthPx+2)}px solid ${accent};border-radius:${themeRadiusPx}px;color:${ink};font-size:${bodyPx}px;line-height:${lineHeight};box-shadow:${shadow}`
        : variants.quote === 'boxed'
          ? `margin:${paragraphPx + 8}px 0;padding:16px 20px;border:1px solid ${ink};color:${ink};font-family:${serif};font-size:${bodyPx}px;line-height:${lineHeight}`
          : variants.quote === 'quote-marks'
            ? `margin:${sectionPx - 4}px 0;padding:10px 24px;text-align:center;font-family:${serif};font-size:${bodyPx + 4}px;line-height:1.9;color:${lighten(ink, 0.08)}`
            : variants.quote === 'plain-bar'
              ? `margin:${paragraphPx + 6}px 0;padding:12px 16px;border-left:6px solid ${ink};color:${ink};font-size:${bodyPx}px;line-height:${lineHeight}`
              : variants.quote === 'dark-block'
                ? `margin:${paragraphPx + 8}px 0;padding:${cardGapPx+6}px;background:${codeBackground};color:${codeText};border-radius:12px;font-size:${bodyPx + 2}px;font-weight:700;line-height:${lineHeight};box-shadow:${shadow}`
                : `margin:${paragraphPx + 4}px 0;padding:16px 20px;background:linear-gradient(135deg,${hexToRgba(accent, 0.08)} 0%,${hexToRgba(accent, 0.05)} 100%);border-left:4px solid ${accent};border-radius:0 12px 12px 0;color:${ink};font-size:${bodyPx}px;line-height:${lineHeight}`,
    list: `margin:12px 0 ${paragraphPx + 4}px;padding:${variants.list === 'news-panel' ? '10px 12px 10px 30px' : '0 0 0 25px'}${variants.list === 'news-panel' ? `;background:${hexToRgba(ink, 0.035)};border-top:1px solid ${hexToRgba(ink, 0.15)};border-bottom:1px solid ${hexToRgba(ink, 0.15)}` : ''}`,
    listNone: `margin:12px 0 ${paragraphPx + 4}px;padding-left:6px;list-style:none`,
    li: 'margin:7px 0',
    a: `color:${accent};text-decoration:none;border-bottom:1px solid ${accent}`,
    img: `display:block;max-width:100%;height:auto;margin:26px auto${variants.image === 'rounded' ? `;border-radius:${radiusPx || 10}px` : ''}${variants.image === 'framed' ? `;border:1px solid ${hexToRgba(ink, 0.2)};padding:3px;box-sizing:border-box` : ''}`,
    hr: `text-align:center;color:${muted};letter-spacing:.6em;margin:${sectionPx}px 0;font-size:${bodyPx}px`,
    hairline: `border-top:${Math.max(1,borderWidthPx)}px solid ${line};margin:${sectionPx}px 0;font-size:0;line-height:0`,
    thickBar: `border-top:4px solid ${ink};margin:${sectionPx}px 0;font-size:0;line-height:0`,
    monoDivider: `text-align:center;color:${muted};font-family:${mono};font-size:${captionPx}px;letter-spacing:2px;margin:${sectionPx}px 0`,
    code: `font-family:${mono};background:${codeBackground};color:${codeText};padding:2px 5px;border:${borderWidthPx}px solid ${line};border-radius:${Math.min(themeRadiusPx,6)}px`,
    pre: `margin:0 0 ${paragraphPx}px;padding:${cardGapPx+2}px;overflow-x:auto;background:${codeBackground};border-left:${Math.max(1,borderWidthPx+2)}px solid ${accent};border-radius:${themeRadiusPx}px;white-space:pre;box-shadow:${shadow}`,
    codeBlock: `font-family:${mono};font-size:${Math.max(bodyPx - 2, 12)}px;line-height:1.65;color:${codeText};white-space:pre`,
    table: `width:100%;margin:4px 0 ${paragraphPx + 4}px;border-collapse:collapse;table-layout:fixed;font-size:${Math.max(bodyPx - 1, 13)}px`,
    th: `padding:10px 9px;border:${Math.max(1,borderWidthPx)}px solid ${line};background:${variants.table === 'dark-header' ? codeBackground : variants.table === 'ink-header' ? ink : surface};color:${variants.table === 'dark-header' ? codeText : variants.table === 'ink-header' ? inverseText : ink};font-weight:700;text-align:left;word-break:break-word`,
    td: `padding:10px 9px;border:${Math.max(1,borderWidthPx)}px solid ${line};${variants.table === 'dark-header' ? `background:${surface};` : ''}vertical-align:top;word-break:break-word`,
    sup: `color:${accent};font-size:${Math.max(captionPx - 1, 11)}px;line-height:0`,
    footnote: `font-size:${captionPx}px;color:${muted};line-height:1.7;margin:0 0 8px`,
  };
  const roleColor=(role)=>({text:ink,muted,accent,accentSecondary,inverseText,line}[role]||ink),surfaceColor=(role)=>({surface,page:surface,accent,accentSecondary,codeBackground,transparent:'transparent'}[role]||''),componentFont=(role)=>role==='serif'?serif:role==='mono'?mono:role==='sans'?font:'',scaled=(base,scale,delta=2)=>Math.max(8,base+(scale==='compact'?-delta:scale==='display'?delta:0)),explicit=theme.definition.article.components||{};
  if(explicit.title){const title=components.title,titleFont=componentFont(title.fontFamily);styles.h1+=`${titleFont?`;font-family:${titleFont}`:''};font-size:${scaled(h1Px,title.sizeScale,3)}px;color:${roleColor(title.colorRole)}`;}
  if(explicit.lead)styles.lead+=`;font-size:${scaled(bodyPx+1,components.lead.sizeScale,2)}px;color:${roleColor(components.lead.colorRole)}`;
  if(explicit.quote){const quote=components.quote,quoteSurface=surfaceColor(quote.surfaceRole);styles.blockquote+=`;color:${roleColor(quote.textColorRole)};border-color:${roleColor(quote.borderColorRole)}${quoteSurface?`;background:${quoteSurface}`:''}`;}
  if(explicit.list){styles.list+=`;color:${roleColor(components.list.markerColorRole)}`;styles.listNone+=`;color:${roleColor(components.list.markerColorRole)}`;styles.liText=`color:${roleColor(components.list.textColorRole)}`;}else styles.liText='';
  if(explicit.table){const table=components.table,tableSurface=surfaceColor(table.headerSurfaceRole);styles.th+=`;color:${roleColor(table.headerTextColorRole)};border-color:${roleColor(table.borderColorRole)}${tableSurface?`;background:${tableSurface}`:''}`;styles.td+=`;border-color:${roleColor(table.borderColorRole)}`;}
  if(explicit.code){const code=components.code,codeSurface=surfaceColor(code.surfaceRole)||codeBackground;styles.code+=`;color:${roleColor(code.textColorRole)};background:${codeSurface}`;styles.pre+=`;background:${codeSurface}`;styles.codeBlock+=`;color:${roleColor(code.textColorRole)}`;}
  styles.imageCaption=explicit.imageCaption?`display:block;margin:-18px 0 22px;text-align:center;font-size:${scaled(captionPx,components.imageCaption.sizeScale,1)}px;line-height:1.5;color:${roleColor(components.imageCaption.colorRole)}`:'';
  return { styles, variants };
}

function inline(text, styles) {
  let value = escapeHtml(text);
  value = value.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, styles.imageCaption?`<span><img src="$2" alt="$1" style="${styles.img}"><small style="${styles.imageCaption}">$1</small></span>`:`<img src="$2" alt="$1" style="${styles.img}">`);
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
    blocks.push(`<${list.type} style="${listStyle}">${list.items.map((item) => `<li style="${styles.li}">${chevron ? `<span style="color:${styles.strongColor};font-weight:700">› </span>` : ''}${styles.liText?`<span style="${styles.liText}">${wrapLiItem(renderInline(item))}</span>`:wrapLiItem(renderInline(item))}</li>`).join('')}</${list.type}>`);
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
