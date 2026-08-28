import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { candidateSocialCardDir } from '../../../platform/core/workspace-paths.mjs';
import { loadSkillBundle } from '../../../platform/llm/skill-runtime.mjs';
import { bindGenerationSnapshot, prepareSkillRun } from '../../../platform/skills/pipeline-runtime.mjs';
import { runConversationAgent } from '../../../platform/agent/conversation-agent.mjs';
import { buildConversationToolCatalog } from '../../../platform/agent/tool-catalog.mjs';
import { validateAgentEnvelope } from '../../../platform/agent/tool-protocol.mjs';
import { getToolRegistry } from '../../../platform/tools/index.mjs';
import { applyCatalogSchemas, registerProjectResource, resolveResourceArguments, sanitizeCapabilityResult } from '../../../platform/agent/resource-adaptation.mjs';
import { parseModelJsonWithRepair } from '../../../platform/llm/model-json.mjs';
import { runAudit } from './social-card-pipeline.mjs';
import { writeSocialCardAiVisualBaseline } from './social-card-ai-visual-baseline.mjs';
import { compileSocialTheme, compileSocialThemeVariables, socialThemeDefinition } from '../../../shared/themes/social-theme-compiler.mjs';
import { fontStack } from '../../../shared/themes/font-utils.mjs';
import { resolveWorkspaceTheme } from '../../../platform/application/themes/user-theme-service.mjs';
import { createSocialCardStoryboardThemeSnapshot, getSocialCardTemplateCapabilities } from '../../../shared/rendering/social-card-template-resolver.mjs';
import { createSocialCardAiVisualStageRecorder, writeSocialCardAiVisualSkillManifest } from './social-card-ai-visual-pipeline.mjs';
import { runSocialCardAiVisualGenerationAgent } from './social-card-ai-visual-agent.mjs';
import { runSocialCardAiVisualRepairAgent } from './social-card-ai-visual-repair-agent.mjs';
import { generateSocialCardCopy, validateSocialCardCopy } from './social-card-copy.mjs';
import { socialStoryboardClassForContentClass } from '../domain/social-routing.mjs';

const execFileAsync = promisify(execFile);
export const SOCIAL_CARD_BEAUTIFY_HTML = 'ai-beautified.html';
export const SOCIAL_CARD_BEAUTIFY_OUTPUT = 'ai-beautified-output';
export const SOCIAL_CARD_BEAUTIFY_REPORT = 'ai-beautify-report.json';
export const SOCIAL_CARD_BEAUTIFY_DELIVERY_GATE = 'ai-beautified-delivery-gate.json';
const AI_PAGE_SLOT_CLASS = 'ai-page-slot';
const AI_VISUAL_SKILL_NAME = 'social-card-ai-visual-generator';
// 只拦截页面级结构。cover-tags / xhs-tag 虽然也会出现在程序外壳中，
// 但它们同样是封面插槽允许使用的内容组件，不能因为类名相同就误判为重复壳。
const AI_SHELL_CLASS_NAMES = new Set(['page', 'page-cover', 'page-inner', 'page-header', 'page-body', 'page-content-stack', 'page-footer', 'bottom-strip', 'glass-tag', 'glass-hot', 'cover-center', 'cover-bottom', 'cover-date', AI_PAGE_SLOT_CLASS]);
const AI_THEME_SHELL_CLASS = /^(?:ice|neon|tokyo|bt|sol|rt|pc|char|peach|orange|mocha|lav|crim|bone)-(?:topbar|num|title|sub)$/;
const AI_COVER_COMPONENT_CLASS = /^(?:glass-(?:tag|hot)|cover-(?:center|mark|title|divider|sub|bottom|tags|date)|xhs-tag)$/i;
const AI_INTERNAL_FIELDS = new Set(['source_refs', 'source_urls', 'source_url', 'fact_ids', 'evidence_refs']);
const SOCIAL_CARD_BROWSER_AUDIT_CAPABILITY = 'content.social_card.browser_audit';
const SOCIAL_CARD_BROWSER_INSPECT_CAPABILITY = 'content.social_card.browser_inspect';
const SOCIAL_CARD_PROJECT_READ_CAPABILITY = 'filesystem.project.read';
const MAX_AI_PATCH_CSS_CHARS = 12_000;
const MAX_AI_REPAIR_PAGES = 1;
const MAX_AI_GENERATION_CSS_CHUNK_CHARS = 3_500;
const AI_VISUAL_COMPONENT_CLASS = /(?:^|[-_])(?:card|row|list|tip|step|summary|quote|cta|badge|scene|compare|timeline|profile|stat|feat|code)(?:$|-(?:card|row|block|panel|grid|table))$/i;

function visibleText(html) {
  return String(html || '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function protectedTokens(html) {
  const text = visibleText(html);
  const numbers = text.match(/(?<![\w])\d+(?:[.,]\d+)*(?:%|亿|万|元|美元|ms|秒|倍)?/gi) || [];
  const urls = [...String(html || '').matchAll(/(?:href|src)=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((value) => /^https?:\/\//i.test(value));
  return [...new Set([...numbers, ...urls])];
}

function htmlPageCount(html) {
  return [...String(html || '').matchAll(/class=["']([^"']+)["']/gi)]
    .filter((match) => match[1].split(/\s+/).includes('page')).length;
}

function visualSignature(html) {
  const styles = [...String(html || '').matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1].replace(/\/\*[\s\S]*?\*\//g, ''))
    .join('\n');
  const declarations = [...styles.matchAll(/([a-z-]+)\s*:\s*([^;}{]+)/gi)]
    .map((match) => `${match[1].toLowerCase()}:${match[2].replace(/\s+/g, ' ').trim().toLowerCase()}`)
    .sort();
  const classes = [...String(html || '').matchAll(/class=["']([^"']+)["']/gi)]
    .map((match) => match[1].split(/\s+/).filter(Boolean).sort().join(' '))
    .sort();
  const inlineStyles = [...String(html || '').matchAll(/style=["']([^"']+)["']/gi)]
    .map((match) => match[1].replace(/\s+/g, ' ').trim().toLowerCase())
    .sort();
  return [...new Set([...declarations, ...classes, ...inlineStyles])].join('|');
}

function hasMaterialVisualChange(original, candidate) {
  return visualSignature(original) !== visualSignature(candidate);
}

function aiVisualAttributeCssScopes(css) {
  const source = String(css || '');
  const scopes = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const pages = [...match[1].matchAll(/\[data-ai-page\s*=\s*["'](\d+)["']\s*\]/gi)].map((item) => Number(item[1]));
    for (const page of [...new Set(pages)]) {
      scopes.push({ page, start: match.index, end: match.index + match[0].length, css: match[0] });
    }
  }
  return scopes;
}

function pageSelectorWithAttribute(selector, pageNumber) {
  const scope = `[data-ai-page="${pageNumber}"]`;
  const value = String(selector || '').trim();
  if (!value) return '';
  if (/^:scope\b/i.test(value)) return `${scope}${value.replace(/^:scope/i, '')}`;
  if (/^&/.test(value)) return `${scope}${value.slice(1)}`;
  // 页面属性选择器可以从 page root 本身开始；普通属性选择器前缀
  // 需要把 page/page-cover 合并到同一个元素，避免错误地产生后代关系。
  const root = value.match(/^(\.page(?:-cover)?)(?=[\s>+~.#:[\]]|$)/i);
  if (root) return `${scope}${root[1]}${value.slice(root[1].length)}`;
  return `${scope} ${value}`;
}

function pageCssWithAttributeSelectors(css, pageNumber) {
  const source = String(css || '');
  return source.replace(/(^|[{}])(\s*)([^@{}][^{]*?)\s*\{/g, (match, boundary, whitespace, selector) => {
    const value = String(selector || '').trim();
    if (!value) return match;
    const selectors = value.split(',').map((item) => pageSelectorWithAttribute(item, pageNumber)).filter(Boolean);
    return `${boundary}${whitespace}${selectors.join(', ')}{`;
  });
}

function cssHasClassSelector(css, className) {
  const escaped = String(className || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\.${escaped}(?![A-Za-z0-9_-])`).test(String(css || ''));
}

function pageClassEntries(section) {
  return [...String(section || '').matchAll(/<[^>]*\bclass=["']([^"']+)["'][^>]*>/gi)].flatMap((match) => {
    const classes = match[1].split(/\s+/).filter((name) => AI_VISUAL_COMPONENT_CLASS.test(name) || AI_COVER_COMPONENT_CLASS.test(name));
    const inline = /\bstyle=["'][^"']*["']/i.test(match[0]);
    return classes.map((className) => ({ className, inline }));
  });
}

// 生成阶段不能只检查页面数量和根节点：类名存在但没有对应 CSS 时，
// 布局审计仍可能通过，最终却会出现“裸 HTML”页面。这里按页面作用域
// 检查组件根类是否有全局规则或本页 scoped 规则；内联样式也视为该元素
// 已提供样式，避免误报刻意使用 inline style 的合法页面。
export function aiVisualStyleCoverageIssues(candidate) {
  const html = extractBeautifiedHtml(candidate);
  const styleBlocks = [...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)].map((match) => ({ attrs: match[1] || '', css: match[2] || '' }));
  const css = styleBlocks.map((block) => block.css).join('\n');
  const attributeScopes = aiVisualAttributeCssScopes(css);
  const scopedRanges = attributeScopes.map((scope) => [scope.start, scope.end]);
  const globalCss = [...css].filter((_char, index) => !scopedRanges.some(([start, end]) => index >= start && index < end)).join('');
  const sections = pageSectionRanges(html);
  const issues = [];
  for (let index = 0; index < sections.length; index += 1) {
    const section = html.slice(sections[index].start, sections[index].end);
    const classes = pageClassEntries(section);
    const pageScopeCss = [
      ...attributeScopes.filter((scope) => scope.page === index + 1).map((scope) => scope.css),
    ].filter(Boolean).join('\n');
    const missing = [...new Set(classes
      .filter(({ className, inline }) => !inline && !cssHasClassSelector(globalCss, className) && !cssHasClassSelector(pageScopeCss, className))
      .map(({ className }) => className))];
    if (missing.length) issues.push(`P${index + 1} 缺少组件 CSS：${missing.slice(0, 8).map((name) => `.${name}`).join('、')}`);
  }
  return issues;
}

const BEAUTIFY_EMPHASIS_CLASSES = new Set(['metric', 'person', 'company', 'conflict', 'direction', 'label']);
const BEAUTIFY_PATCH_BASE_CSS = `
body.ai-beautified .ai-beautify-emphasis{font-weight:850;padding:0 .08em;border-radius:.16em}
body.ai-beautified .ai-beautify-emphasis.metric{font-size:1.14em;color:var(--accent2);background:color-mix(in srgb,var(--accent2) 14%,transparent)}
body.ai-beautified .ai-beautify-emphasis.person,body.ai-beautified .ai-beautify-emphasis.company{color:var(--accent);font-weight:900}
body.ai-beautified .ai-beautify-emphasis.conflict{color:var(--accent2);font-weight:950;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px}
body.ai-beautified .ai-beautify-emphasis.direction{color:var(--accent2);font-weight:900}
body.ai-beautified .ai-beautify-emphasis.label{font-size:.92em;letter-spacing:.04em;color:var(--muted);font-weight:850}
body.ai-beautified .ai-beautify-fragment{margin:8px 0;padding:9px 11px;border:1px solid color-mix(in srgb,var(--accent2) 34%,var(--line));border-radius:12px;background:color-mix(in srgb,var(--surface) 86%,var(--accent2));box-shadow:0 8px 18px color-mix(in srgb,var(--accent) 10%,transparent)}
body.ai-beautified .ai-beautify-fragment .ai-beautify-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 7px;border-radius:999px;background:var(--accent2);color:var(--inverse);font-size:9px;font-weight:900;letter-spacing:.04em}
body.ai-beautified .ai-beautify-fragment .ai-beautify-arrow{color:var(--accent2);font-weight:950;padding:0 4px}
body.ai-beautified .page-inner{display:flex;flex-direction:column;gap:8px;padding:0 16px 32px}
body.ai-beautified .page-body{flex:1 1 auto;min-height:0;overflow:visible}
body.ai-beautified .page-body.ai-page-slot{gap:8px}
body.ai-beautified .ai-page-slot{position:relative;width:100%;height:auto;min-width:0;min-height:0;flex:1 1 auto;overflow:visible;justify-content:center}
body.ai-beautified .ai-page-slot>*{flex:0 0 auto}
body.ai-beautified .ai-page-slot h1{overflow-wrap:anywhere}
body.ai-beautified .ai-page-slot p,body.ai-beautified .ai-page-slot li{overflow-wrap:anywhere}
`;

function ensureAiBeautifiedBody(html) {
  let output = String(html || '');
  output = output.replace(/<body\b([^>]*)class=["']([^"']*)["']/i, (_match, attributes, classes) => `<body${attributes}class="${classes.split(/\s+/).includes('ai-beautified') ? classes : `${classes} ai-beautified`}"`);
  if (!/class=["'][^"']*\bai-beautified\b/i.test(output)) output = output.replace(/<body\b([^>]*)>/i, '<body$1 class="ai-beautified">');
  return output;
}

function patchJsonText(raw) {
  let text = String(raw || '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  return text;
}

export function extractBeautifyPatch(raw) {
  try {
    const parsed = JSON.parse(patchJsonText(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasUnsafePatchMarkup(value) {
  return /<\/?(?:html|head|body|section)\b|<script\b|<iframe\b|<object\b|<embed\b|javascript:|https?:\/\/|\son[a-z]+\s*=|<style\b|@import\b|url\s*\(/i.test(String(value || ''));
}

function hasScrollContainer(value) {
  return /overflow(?:-x|-y)?\s*:\s*(?:(?:hidden|visible|clip)\s+)*(?:auto|scroll)\b/i.test(String(value || ''));
}

function hasAiShellClass(value) {
  return [...String(value || '').matchAll(/class=["']([^"']+)["']/gi)]
    .some((match) => match[1].split(/\s+/).some((name) => AI_SHELL_CLASS_NAMES.has(name) || AI_THEME_SHELL_CLASS.test(name)));
}

function hasInternalProvenance(value) {
  return /\b(?:hotspot|candidate|batch|fact|source[_-]?ref|evidence[_-]?ref)\s*:\s*[A-Za-z0-9_-]+/i.test(String(value || ''));
}

export function validateBeautifyPatch(original, patch, options = {}) {
  const issues = [];
  const pageCount = htmlPageCount(original);
  const allowPartialPages = options.allowPartialPages === true;
  const allowEmptyCss = options.allowEmptyCss === true;
  const maxPagesPerPatch = Number.isInteger(options.maxPagesPerPatch) && options.maxPagesPerPatch > 0
    ? options.maxPagesPerPatch : null;
  const expectedPage = Number.isInteger(options.expectedPage) ? options.expectedPage : null;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { valid: false, issues: ['AI 未返回合法的增量美化 JSON'], pageCount, patch: null };
  }
  if (typeof patch.css !== 'string') issues.push('增量 CSS 缺失');
  else if (!allowEmptyCss && !patch.css.trim()) issues.push('增量 CSS 缺失');
  else if (patch.css.length > MAX_AI_PATCH_CSS_CHARS) issues.push(`增量 CSS 过大（${patch.css.length} 字符，最大 ${MAX_AI_PATCH_CSS_CHARS}）`);
  if (hasUnsafePatchMarkup(patch.css)) issues.push('增量 CSS 包含不允许的 HTML、脚本或远程资源');
  if (hasScrollContainer(patch.css)) issues.push('增量 CSS 禁止创建内部滚动容器');
  if (!Array.isArray(patch.pages) || !patch.pages.length || (!allowPartialPages && patch.pages.length !== pageCount) || (allowPartialPages && patch.pages.length > pageCount)) {
    issues.push(allowPartialPages ? `修复页面数量无效（应为 1–${pageCount}）` : '增量页面数量不匹配（应为 ' + pageCount + '）');
  }
  if (maxPagesPerPatch && Array.isArray(patch.pages) && patch.pages.length > maxPagesPerPatch) {
    issues.push(`本轮页面增量过大（应为不超过 ${maxPagesPerPatch} 页）`);
  }
  const seenPages = new Set();
  let contentChars = 0;
  for (const item of Array.isArray(patch.pages) ? patch.pages : []) {
    const page = Number(item?.page);
    if (!Number.isInteger(page) || page < 1 || page > pageCount || seenPages.has(page)) {
      issues.push(`增量页面编号无效：${String(item?.page ?? '')}`);
      continue;
    }
    seenPages.add(page);
    if (expectedPage != null && page !== expectedPage) issues.push(`本轮应先生成 P${expectedPage}，不能提交 P${page}`);
    const content = String(item?.page_html ?? item?.content_html ?? '');
    contentChars += content.length;
    const hasPageClass = [...content.matchAll(/class=["']([^"']*)["']/gi)].some((match) => match[1].split(/\s+/).includes('page'));
    if (hasAiShellClass(content)) issues.push(`P${page} 不得重复生成页面壳结构`);
    if (hasInternalProvenance(content)) issues.push(`P${page} 不得展示内部来源标识`);
    if (!content.trim() || content.length > 3_000 || hasUnsafePatchMarkup(content) || hasScrollContainer(content) || hasPageClass) {
      issues.push('P' + page + ' 内容片段不安全、缺失或过大');
    }
  }
  if (contentChars > 16_000) issues.push('增量页面内容总量过大');
  return { valid: issues.length === 0, issues, pageCount, patch };
}

function pageSectionRanges(html) {
  const starts = [...String(html || '').matchAll(/<[a-z][a-z0-9-]*\b[^>]*class=["']([^"']*)["'][^>]*>/gi)]
    .filter((match) => match[1].split(/\s+/).includes('page'))
    .map((match) => match.index);
  return starts.map((start, index) => ({ start, end: starts[index + 1] ?? String(html || '').length }));
}

function elementContentRange(html, classToken) {
  const opening = [...String(html || '').matchAll(/<([a-z][a-z0-9-]*)\b[^>]*class=["']([^"']*)["'][^>]*>/gi)]
    .find((match) => match[2].split(/\s+/).includes(classToken));
  if (!opening || opening.index == null) return null;
  const tagName = opening[1].toLowerCase();
  const openEnd = opening.index + opening[0].length;
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  let depth = 1;
  const tags = /<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi;
  tags.lastIndex = openEnd;
  let match;
  while ((match = tags.exec(String(html || '')))) {
    if (match[1].toLowerCase() !== tagName) continue;
    if (/^<\//.test(match[0])) {
      depth -= 1;
      if (depth === 0) return { start: openEnd, end: match.index };
    } else if (!/\/\s*>$/.test(match[0]) && !voidTags.has(tagName)) {
      depth += 1;
    }
  }
  return null;
}

function renderAiPageShell(context) {
  const themeDefinition = socialThemeDefinition(context?.theme?.id || 'ice-blue', { fallback: true });
  const themeId = String(themeDefinition?.id || 'ice-blue');
  const typography = themeDefinition?.tokens?.typography || {};
  const themeVariables = compileSocialThemeVariables(themeDefinition);
  const bodyFont = fontStack(typography.family || 'sans');
  const headingFont = fontStack(typography.headingFamily || typography.family || 'sans');
  const pageCount = Math.max(0, Number(context?.requiredPageCount) || 0);
  const contentType = String(context?.contentType || '').toLowerCase();
  const themePrefix = ({
    'ice-blue': 'ice', neon: 'neon', 'tokyo-night': 'tokyo', brutalist: 'bt', solarized: 'sol',
    'retro-terminal': 'rt', 'paper-craft': 'pc', charcoal: 'char', peach: 'peach', orange: 'orange',
    mocha: 'mocha', lavender: 'lav', crimson: 'crim', 'bone-white': 'bone',
  })[themeId] || 'ice';
  const shellLabel = contentType.includes('event') ? 'EVENT DESK / 事件专题'
    : contentType.includes('trend') ? 'TREND DESK / 趋势专题'
      : contentType.includes('technology') ? 'TECH DESK / 技术专题'
        : 'TOOL DESK / 工具专题';
  const coverTag = contentType.includes('event') ? '#事件拆解'
    : contentType.includes('trend') ? '#趋势观察'
      : contentType.includes('technology') ? '#技术观察'
        : '#工具图文';
  const coverHot = contentType.includes('event') ? '⚡ 核心矛盾'
    : contentType.includes('trend') ? '📈 趋势信号'
      : contentType.includes('technology') ? '⚙️ 技术要点'
        : '🛠️ 使用指南';
  const coverIcon = contentType.includes('event') ? '⚡'
    : contentType.includes('trend') ? '📈'
      : contentType.includes('technology') ? '⚙️'
        : '🚀';
  const coverDate = new Date().toISOString().slice(0, 10).replaceAll('-', '.');
  const footerLabel = contentType.includes('event') ? '⚡ 事件专题'
    : contentType.includes('trend') ? '📈 趋势专题'
      : contentType.includes('technology') ? '⚙️ 技术专题'
        : `🦊 ${String(context?.topic || '工具图文').slice(0, 16)}`;
  const pages = Array.from({ length: pageCount }, (_, index) => {
    const storyboardPage = Array.isArray(context?.storyboard) ? context.storyboard[index] : null;
    const kind = ['cover', 'ending'].includes(String(storyboardPage?.kind || '').toLowerCase())
      ? String(storyboardPage.kind).toLowerCase() : 'content';
    const role = escapeAttribute(storyboardPage?.role || kind);
    const number = String(index + 1).padStart(2, '0');
    const title = escapeAttribute(storyboardPage?.title || context?.topic || shellLabel);
    const sub = escapeAttribute(storyboardPage?.role || kind);
    const glyph = kind === 'cover' ? coverIcon : ['metric', 'data', 'compare'].includes(String(storyboardPage?.role || '').toLowerCase()) ? '📊' : '✦';
    if (kind === 'cover') {
      return `<div class="page page-cover" data-page-kind="cover" data-page-role="${role}" data-page-number="${index + 1}"><span class="glass-tag">${coverTag}</span><span class="glass-hot">${coverHot}</span><div class="cover-center ${AI_PAGE_SLOT_CLASS}" data-ai-page="${index + 1}"></div><div class="cover-bottom"><div class="cover-tags"><span class="xhs-tag">${coverTag}</span></div><div class="cover-date">${coverDate}</div></div></div>`;
    }
    return `<div class="page" data-page-kind="${kind}" data-page-role="${role}" data-page-number="${index + 1}"><div class="page-inner"><div class="${themePrefix}-topbar"><span class="${themePrefix}-num">${glyph}</span><span class="${themePrefix}-title">${title}</span><span class="${themePrefix}-sub">${sub}</span></div><div class="page-body ${AI_PAGE_SLOT_CLASS}" data-valign="center" data-ai-page="${index + 1}"></div><div class="bottom-strip"><span class="bs-logo">${escapeAttribute(footerLabel)}</span><span class="bs-right">继续阅读 →</span></div></div></div>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeAttribute(context?.topic || '图文')}</title><style data-ai-beautify-shell="true">*{box-sizing:border-box}html,body{margin:0;padding:0;background:var(--bg);color:var(--ink);font-family:${bodyFont};font-size:var(--body-size);line-height:var(--line-height)}body{${themeVariables};--inverseText:var(--inverse)}h1,h2,h3{font-family:${headingFont}}.page{position:relative;width:375px;height:667px;padding:0;overflow:hidden;background:var(--page);color:var(--ink);isolation:isolate}.page-inner{width:100%;height:100%;min-width:0;min-height:0;padding:var(--page-padding);display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:8px}.page-cover{padding:var(--page-padding);display:flex;flex-direction:column;align-items:stretch}.glass-tag,.glass-hot,.xhs-tag{display:inline-flex;align-items:center;width:max-content;max-width:100%;overflow-wrap:anywhere}.glass-tag{padding:4px 8px;border:1px solid var(--line);border-radius:999px;color:var(--accent);font-size:var(--caption-size);font-weight:800}.glass-hot{align-self:flex-end;margin-top:-1.2em;padding:4px 8px;background:var(--accent);color:var(--inverse);border-radius:999px;font-size:var(--caption-size);font-weight:800}.cover-center{display:flex;flex:1;flex-direction:column;align-items:flex-start;justify-content:center;min-width:0;padding:28px 0}.cover-center.${AI_PAGE_SLOT_CLASS}{width:100%;min-height:0;overflow:visible}.cover-center.${AI_PAGE_SLOT_CLASS}>*{max-width:100%;min-width:0}.icon-circle{display:flex;align-items:center;justify-content:center;width:62px;height:62px;margin-bottom:22px;border-radius:18px;background:var(--accent);color:var(--inverse);font-size:32px;box-shadow:8px 8px 0 var(--accent2)}.cover-title{max-width:100%;font-size:34px;line-height:1.18;letter-spacing:-.04em;font-weight:900;color:var(--ink);overflow-wrap:anywhere}.cover-divider{width:68px;height:4px;margin-top:25px;background:var(--accent2)}.cover-sub{max-width:310px;margin-top:18px;color:var(--muted);font-size:15px;line-height:1.65;overflow-wrap:anywhere}.cover-bottom{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;min-width:0;margin-top:auto;color:var(--muted);font-size:var(--caption-size)}.cover-tags{display:flex;flex-wrap:wrap;gap:5px;max-width:275px}.xhs-tag{padding:4px 8px;border:1px solid var(--line);border-radius:999px;color:var(--accent);font-weight:800}.cover-date{white-space:nowrap}.${themePrefix}-topbar{display:flex;align-items:center;gap:8px;min-width:0;padding-bottom:7px;border-bottom:1px solid var(--line);color:var(--muted);font-size:10px;line-height:1.3}.${themePrefix}-num{flex:0 0 auto;color:var(--accent);font-size:13px;font-weight:900}.${themePrefix}-title{min-width:0;overflow-wrap:anywhere;color:var(--ink);font-size:14px;font-weight:900}.${themePrefix}-sub{margin-left:auto;flex:0 0 auto;max-width:34%;overflow-wrap:anywhere;text-align:right;font-size:10px}.page-body{display:flex;align-items:stretch;min-width:0;min-height:0;overflow:hidden}.page-body.${AI_PAGE_SLOT_CLASS}{position:relative;flex-direction:column;justify-content:flex-start;gap:8px;width:100%;min-height:0;overflow:visible;color:var(--ink)}.page-body.${AI_PAGE_SLOT_CLASS}>*{box-sizing:border-box;max-width:100%;min-width:0}.page-body.${AI_PAGE_SLOT_CLASS} img,.page-body.${AI_PAGE_SLOT_CLASS} svg{max-width:100%}.page-body.${AI_PAGE_SLOT_CLASS} h1,.page-body.${AI_PAGE_SLOT_CLASS} h2,.page-body.${AI_PAGE_SLOT_CLASS} h3,.page-body.${AI_PAGE_SLOT_CLASS} p,.page-body.${AI_PAGE_SLOT_CLASS} ul,.page-body.${AI_PAGE_SLOT_CLASS} ol{max-width:100%;overflow-wrap:anywhere}.bottom-strip{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;min-width:0;padding-top:7px;border-top:1px solid var(--line);color:var(--muted);font-size:10px;line-height:1.3}.bs-logo,.bs-right{min-width:0;overflow-wrap:anywhere}.bs-right{text-align:right}</style></head><body class="theme-${escapeAttribute(themeId)} ai-beautified" data-visual-style="${escapeAttribute(themeId)}" data-theme-version="${escapeAttribute(themeDefinition?.version || '')}" data-channel="${escapeAttribute(context?.channelMode || 'wechat')}">${pages}</body></html>`;
}

export function buildBeautifyShell(context) {
  if (!Number(context?.requiredPageCount)) throw new Error('AI 页面壳缺少页面数量');
  return ensureAiBeautifiedBody(appendSourceReferences(renderAiPageShell(context), context?.sourceUrls));
}

function emphasizePageText(html, text, kind) {
  const parts = String(html || '').split(/(<[^>]+>)/g);
  const needle = String(text || '');
  let replaced = false;
  for (let index = 0; index < parts.length; index += 2) {
    if (!parts[index] || !parts[index].includes(needle)) continue;
    parts[index] = parts[index].replace(needle, `<span class="ai-beautify-emphasis ${kind}">${needle}</span>`);
    replaced = true;
    break;
  }
  return { html: parts.join(''), replaced };
}

export function applyBeautifyPatch(original, patch) {
  let output = ensureAiBeautifiedBody(original);
  const warnings = [];
  const ranges = pageSectionRanges(output);
  const pages = [...(patch?.pages || [])].sort((a, b) => Number(a.page) - Number(b.page));
  let offset = 0;
  for (const item of pages) {
    const range = ranges[Number(item.page) - 1];
    if (!range) { warnings.push(`P${item.page} 不存在`); continue; }
    let section = output.slice(range.start + offset, range.end + offset);
    for (const entry of Array.isArray(item.emphasis) ? item.emphasis : []) {
      const result = emphasizePageText(section, String(entry.text || '').trim(), String(entry.kind || 'label'));
      section = result.html;
      if (!result.replaced) warnings.push(`P${item.page} 未找到强调文本：${String(entry.text || '').trim()}`);
    }
    const fragment = String(item.fragment || '').trim();
    if (fragment) {
      const stack = section.match(/<div\b[^>]*class=["'][^"']*\b(?:page-content-stack|ai-page-slot)\b[^"']*["'][^>]*>/i);
      if (!stack || stack.index == null) warnings.push(`P${item.page} 缺少 AI 内容插槽`);
      else {
        const insertAt = stack.index + stack[0].length;
        section = `${section.slice(0, insertAt)}<div class="ai-beautify-fragment">${fragment}</div>${section.slice(insertAt)}`;
      }
    }
    output = `${output.slice(0, range.start + offset)}${section}${output.slice(range.end + offset)}`;
    offset += section.length - (range.end - range.start);
  }
  const css = `${BEAUTIFY_PATCH_BASE_CSS}\n${String(patch?.css || '').trim()}`;
  output = output.replace(/<\/head>/i, `<style data-ai-beautify="patch">${css}</style></head>`);
  return { html: output, warnings };
}

export function applyBeautifyShellPatch(shell, patch, { includeBaseCss = true } = {}) {
  let output = ensureAiBeautifiedBody(shell);
  const warnings = [];
  const ranges = pageSectionRanges(output);
  const pages = [...(patch?.pages || [])].sort((a, b) => Number(a.page) - Number(b.page));
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const item = pages[index];
    const pageNumber = Number(item.page);
    const range = ranges[pageNumber - 1];
    if (!range) {
      warnings.push('P' + pageNumber + ' 不存在');
      continue;
    }
    const section = output.slice(range.start, range.end);
    const slot = elementContentRange(section, AI_PAGE_SLOT_CLASS);
    if (!slot) {
      warnings.push('P' + pageNumber + ' 缺少 ' + AI_PAGE_SLOT_CLASS);
      continue;
    }
    const content = String(item.page_html ?? item.content_html ?? '').trim();
    const nextSection = section.slice(0, slot.start) + content + section.slice(slot.end);
    output = output.slice(0, range.start) + nextSection + output.slice(range.end);
  }
  const css = (includeBaseCss ? BEAUTIFY_PATCH_BASE_CSS + '\n' : '') + String(patch?.css || '').trim();
  output = output.replace(/<\/head>/i, '<style data-ai-beautify="patch">' + css + '</style></head>');
  return { html: output, warnings };
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function bodyData(html, name) {
  const match = String(html || '').match(new RegExp(`data-${name}=["']([^"']+)["']`, 'i'));
  return match ? match[1] : '';
}

function bodyClass(html) {
  const match = String(html || '').match(/<body\b[^>]*class=["']([^"']+)["']/i);
  return match ? match[1] : '';
}

function sourceUrls(html) {
  return [...String(html || '').matchAll(/(?:href|src)=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((value) => /^https?:\/\//i.test(value));
}

function collectSourceUrls(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectSourceUrls(item, output);
    return [...output];
  }
  if (!value || typeof value !== 'object') return [...output];
  for (const [key, item] of Object.entries(value)) {
    if (['source_refs', 'source_urls', 'source_url', 'url'].includes(key)) {
      const values = Array.isArray(item) ? item : [item];
      for (const candidate of values) if (/^https?:\/\//i.test(String(candidate || ''))) output.add(String(candidate));
    } else if (item && typeof item === 'object') collectSourceUrls(item, output);
  }
  return [...output];
}

function factText(value) {
  if (Array.isArray(value)) return value.map(factText).join(' ');
  if (!value || typeof value !== 'object') return String(value ?? '');
  return Object.entries(value)
    .filter(([key]) => !['visual', 'source_refs', 'source_urls', 'source_url', 'fact_ids', 'evidence_refs', 'composition'].includes(key))
    .map(([, item]) => factText(item))
    .join(' ');
}

function stripAiInternalFields(value) {
  if (Array.isArray(value)) return value.map(stripAiInternalFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !AI_INTERNAL_FIELDS.has(key))
    .map(([key, item]) => [key, stripAiInternalFields(item)]));
}

function normalizedChannelMode(value) {
  return String(value || '').toLowerCase().startsWith('xiaohongshu') ? 'xiaohongshu' : 'wechat';
}

function beautifyContentType(candidate, planEnvelope = null) {
  if (planEnvelope?.pageBudget?.contentType) return String(planEnvelope.pageBudget.contentType);
  if (candidate?.content_class === 'github_project') return 'repository';
  if (candidate?.content_class === 'custom') return 'custom';
  return 'event';
}

function syncAiThemeSnapshot({ workdir, store, editorial, candidate }) {
  const planEnvelope = readJsonFile(path.join(workdir, 'card-plan.json'), null);
  const themeId = String(editorial?.visual_style || 'ice-blue');
  const contentType = beautifyContentType(candidate, planEnvelope);
  const channelMode = normalizedChannelMode(planEnvelope?.channel_mode || editorial?.output_mode || 'wechat');
  const themeDefinition = resolveWorkspaceTheme(store, themeId, 'social')
    || socialThemeDefinition(themeId, { fallback: false });
  if (!themeDefinition) throw new Error(`未知图文视觉主题：${themeId}`);
  const capabilities = getSocialCardTemplateCapabilities({ themeDefinition, channelMode, contentType });
  const storyboardSnapshot = createSocialCardStoryboardThemeSnapshot({ themeDefinition, channelMode, contentType });
  const snapshot = {
    ...storyboardSnapshot,
    id: themeDefinition.id,
    label: themeDefinition.label,
    version: themeDefinition.version,
    source: themeDefinition.source,
    hash: themeDefinition.hash,
    templateSource: capabilities.source,
    templateFallback: capabilities.fallback,
  };
  writeFile(path.join(workdir, 'social-theme-snapshot.json'), JSON.stringify(snapshot, null, 2));
  return snapshot;
}

function escapeAttribute(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function appendSourceReferences(html, urls) {
  const sourceUrls = [...new Set((Array.isArray(urls) ? urls : []).filter((url) => /^https?:\/\//i.test(String(url || ''))))];
  if (!sourceUrls.length || /ai-beautify-source-references/i.test(String(html || ''))) return String(html || '');
  const references = sourceUrls.map((url, index) => '<a href="' + escapeAttribute(url) + '" rel="noreferrer">来源 ' + (index + 1) + '</a>').join('');
  return String(html || '').replace(/<\/body>/i, '<aside class="ai-beautify-source-references" hidden aria-label="来源">' + references + '</aside></body>');
}

function compactStoryboardPage(page, index) {
  const blocks = Array.isArray(page?.content_blocks) ? page.content_blocks : [];
  return {
    page: index + 1,
    kind: String(page?.kind || 'content'),
    role: String(page?.role || 'concept'),
    title: String(page?.title || ''),
    lead: String(page?.lead || ''),
    summary: String(page?.summary || ''),
    evidence: Array.isArray(page?.evidence) ? page.evidence : [],
    layout_style: String(page?.layout_style || ''),
    layout_intent: String(page?.layout_intent || ''),
    page_group_id: page?.page_group_id || null,
    continuation_index: page?.continuation_index || null,
    composition: page?.composition || null,
    visual: page?.visual || null,
    content_blocks: blocks,
  };
}

function compactThemeContract(themeSnapshot, original) {
  const themeId = String(themeSnapshot?.id || themeSnapshot?.themeId || bodyData(original, 'visual-style') || 'ice-blue');
  const definition = socialThemeDefinition(themeId, { fallback: true });
  const compiled = definition ? compileSocialTheme(definition) : null;
  const capacity = themeSnapshot?.capacityProfile || {};
  const roles = capacity.roles && typeof capacity.roles === 'object'
    ? Object.fromEntries(Object.entries(capacity.roles).map(([role, value]) => [role, {
      role,
      template: value?.template || '',
      structural: value?.structural || null,
      visual: value?.visual || null,
      split: value?.split || null,
    }]))
    : {};
  return {
    id: themeId,
    label: themeSnapshot?.label || definition?.label || themeId,
    version: themeSnapshot?.version || definition?.version || '',
    canvas: capacity.canvas || { width: 375, height: 667 },
    templatePack: themeSnapshot?.templatePack || capacity.templatePack || null,
    colors: definition?.tokens?.colors || null,
    typography: definition?.tokens?.typography || null,
    spacing: definition?.tokens?.spacing || null,
    shape: definition?.tokens?.shape || null,
    recipes: compiled?.recipes || definition?.social?.recipes || null,
    effects: definition?.social?.effects || null,
    roles,
  };
}

export function buildBeautifyContext({ workdir, original, candidate, editorial }) {
  const planEnvelope = readJsonFile(path.join(workdir, 'card-plan.json'), null);
  let editorialPlan = [];
  try { editorialPlan = JSON.parse(editorial?.card_plan_json || '[]'); } catch {}
  const pages = Array.isArray(planEnvelope?.pages) && planEnvelope.pages.length
    ? planEnvelope.pages
    : Array.isArray(editorialPlan) ? editorialPlan : [];
  const themeSnapshot = readJsonFile(path.join(workdir, 'social-theme-snapshot.json'), {});
  const effectiveThemeSnapshot = editorial?.visual_style
    ? { ...themeSnapshot, id: String(editorial.visual_style) }
    : themeSnapshot;
  const rawChannelMode = planEnvelope?.channel_mode || themeSnapshot?.channelMode || bodyData(original, 'channel') || String(editorial?.output_mode || 'wechat');
  const candidateContentType = candidate?.content_class === 'github_project'
    ? 'repository'
    : candidate?.content_class === 'custom'
      ? 'custom'
      : 'event';
  const contentType = String(planEnvelope?.pageBudget?.contentType || themeSnapshot?.contentType || candidateContentType);
  const requiredPageCount = pages.length || htmlPageCount(original);
  return {
    topic: String(candidate?.hotspot_title || ''),
    contentType,
    channelMode: normalizedChannelMode(rawChannelMode),
    bodyClass: bodyClass(original),
    compositionMode: String(planEnvelope?.composition_mode || editorial?.composition_mode || 'template'),
    layoutStyle: String(planEnvelope?.layout_style || editorial?.layout_style || 'auto'),
    sourceLabel: String(themeSnapshot?.sourceLabel || ''),
    disclosure: contentType === 'event' ? '据公开素材整理 · 未核实内容已标注' : '',
    requiredPageCount,
    storyboardPageCount: pages.length,
    storyboard: pages.map(compactStoryboardPage),
    theme: compactThemeContract(effectiveThemeSnapshot, original),
    sourceUrls: collectSourceUrls(pages).length ? collectSourceUrls(pages) : sourceUrls(original),
    layoutContract: {
      pageWidth: 375,
      pageHeight: 667,
      requiredPageSelector: '.page',
      requiredPageKinds: ['cover', 'content', 'ending'],
      requiredInnerStructure: ['.page-cover|.page-inner', '.page-body', '.bottom-strip'],
      minBodyTextPx: 11,
    },
  };
}

export function buildAiRenderRequest(context = {}, {
  workspaceResourceId = 'project:current',
  workspaceFiles = ['card-plan.json', 'event-analysis.json', 'social-theme-design-spec.md', 'layout-guide.md'],
} = {}) {
  const files = Array.isArray(workspaceFiles) && workspaceFiles.length
    ? workspaceFiles.map((file) => String(file)).filter(Boolean)
    : ['card-plan.json', 'event-analysis.json'];
  const request = {
    workspace: {
      resourceId: workspaceResourceId,
      files,
      instruction: '先读取 workspace.files 中列出的文件；页面职责与内容安排以 card-plan.json（数据库故事板快照）为准，补充事实以 repository-fact-sheet.json、event-analysis.json 或 custom-fact-sheet.json 为准，当前主题视觉规范以 social-theme-design-spec.md 为准，通用排版和密度以 layout-guide.md 为准。设计规范只能控制视觉，不能作为页面正文素材。不要把内部路径、来源 ID 或技术字段展示为页面文案。',
    },
    channelMode: context.channelMode || 'wechat',
    requiredPageCount: Number(context.requiredPageCount) || 0,
  };
  return request;
}

function compactAiVisualValue(value) {
  if (Array.isArray(value)) {
    const items = value.map(compactAiVisualValue).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, compactAiVisualValue(item)])
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  if (value === null || value === undefined || value === '') return undefined;
  return value;
}

function compactAiVisualBlock(block = {}) {
  return compactAiVisualValue({
    type: block.type,
    title: block.title,
    content: block.content,
    text: block.text,
    items: block.items,
    headers: block.headers,
    rows: block.rows,
    source_refs: block.source_refs,
  }) || null;
}

export function buildAiVisualCardPlan(plan = {}) {
  const pages = (Array.isArray(plan?.pages) ? plan.pages : []).map((page, index) => compactAiVisualValue({
    page: index + 1,
    kind: page?.kind,
    role: page?.role,
    title: page?.title,
    goal: page?.goal,
    evidence: page?.evidence,
    content_blocks: (Array.isArray(page?.content_blocks) ? page.content_blocks : [])
      .map(compactAiVisualBlock)
      .filter(Boolean),
  }));
  return compactAiVisualValue({
    schemaVersion: 1,
    topic: plan?.topic,
    channel_mode: plan?.channel_mode,
    requiredPageCount: pages.length,
    pages,
  }) || { schemaVersion: 1, requiredPageCount: 0, pages: [] };
}

function visibleTextFromHtml(html) {
  return String(html || '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function semanticTokens(value) {
  const text = String(value || '').toLowerCase();
  const tokens = new Set();
  for (const word of text.match(/[a-z][a-z0-9._+/-]{1,}|\d+(?:\.\d+)?(?:%|倍|亿|万|元|gb|mb|tb|px)?/gi) || []) tokens.add(word);
  for (const run of text.match(/[\u3400-\u9fff]{2,}/g) || []) {
    if (run.length <= 4) tokens.add(run);
    for (let index = 0; index < run.length - 1; index += 1) tokens.add(run.slice(index, index + 2));
  }
  return [...tokens];
}

function contentBlockText(block = {}) {
  const flatten = (value) => {
    if (Array.isArray(value)) return value.map(flatten).join(' ');
    if (value && typeof value === 'object') return Object.values(value).map(flatten).join(' ');
    return String(value || '');
  };
  return [block.title, block.content, block.text, flatten(block.items), flatten(block.headers), flatten(block.rows)].filter(Boolean).join(' ');
}

function explicitFactTokens(value) {
  return [...new Set(String(value || '').match(/(?:¥|￥|\$)?\d+(?:\.\d+)?(?:%|倍|亿|万|元|港元|美元|gb|mb|tb)|\bv?\d+\.\d+(?:\.\d+)?\b/gi) || [])];
}

export function auditAiVisualContent(html, plan = {}, factText = '') {
  const pages = Array.isArray(plan?.pages) ? plan.pages : [];
  const allowedFacts = new Set(explicitFactTokens(`${factText}\n${JSON.stringify(plan)}`).map((item) => item.toLowerCase()));
  const pageResults = pages.map((pagePlan, index) => {
    const pageNumber = Number(pagePlan?.page) || index + 1;
    const range = pageSectionRange(html, pageNumber);
    const pageHtml = range ? String(html || '').slice(range.start, range.end) : '';
    const visibleText = visibleTextFromHtml(pageHtml);
    const visibleTokens = new Set(semanticTokens(visibleText));
    const blocks = (Array.isArray(pagePlan?.content_blocks) ? pagePlan.content_blocks : []).map((block, blockIndex) => {
      const expectedText = contentBlockText(block);
      const tokens = semanticTokens(expectedText);
      const matched = tokens.filter((token) => visibleTokens.has(token));
      const coverage = tokens.length ? matched.length / tokens.length : 1;
      return {
        block: blockIndex + 1,
        type: block?.type || '',
        title: block?.title || '',
        coverage: Math.round(coverage * 1000) / 1000,
        tokenCount: tokens.length,
        matchedTokenCount: matched.length,
        status: tokens.length && matched.length === 0 ? 'missing' : coverage < 0.25 ? 'warning' : 'covered',
      };
    });
    const unsupportedFacts = explicitFactTokens(visibleText).filter((item) => !allowedFacts.has(item.toLowerCase()));
    const issues = [];
    const warnings = [];
    if (!range) issues.push(`P${pageNumber} 页面缺失`);
    else if (visibleText.length < 8) issues.push(`P${pageNumber} 页面可见内容为空或过少`);
    for (const block of blocks) {
      if (block.status === 'missing') issues.push(`P${pageNumber} 内容块 ${block.block}${block.title ? `「${block.title}」` : ''} 未找到可识别内容`);
      else if (block.status === 'warning') warnings.push(`P${pageNumber} 内容块 ${block.block}${block.title ? `「${block.title}」` : ''} 覆盖较低（${Math.round(block.coverage * 100)}%）`);
    }
    if (unsupportedFacts.length) warnings.push(`P${pageNumber} 出现故事板或事实清单未识别的显式数据：${unsupportedFacts.slice(0, 8).join('、')}`);
    return { page: pageNumber, visibleChars: visibleText.length, blocks, unsupportedFacts, issues, warnings };
  });
  const issues = pageResults.flatMap((page) => page.issues);
  const warnings = pageResults.flatMap((page) => page.warnings);
  return {
    schemaVersion: 1,
    status: issues.length ? 'blocked' : warnings.length ? 'passed-with-warnings' : 'passed',
    valid: issues.length === 0,
    pageCount: pageResults.length,
    issues,
    warnings,
    pages: pageResults,
    checkedAt: new Date().toISOString(),
  };
}

export function extractBeautifiedHtml(raw) {
  let html = String(raw || '').trim();
  html = html.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const doctype = html.search(/<!doctype\s+html/i);
  const htmlStart = html.search(/<html\b/i);
  const start = doctype >= 0 ? doctype : htmlStart;
  if (start > 0) html = html.slice(start);
  const end = html.toLowerCase().lastIndexOf('</html>');
  if (end >= 0) html = html.slice(0, end + '</html>'.length);
  return html.trim();
}

export function validateBeautifiedHtml(original, candidate, options = {}) {
  const html = extractBeautifiedHtml(candidate);
  const issues = [];
  const expectedPageCount = Number(options.pageCount || htmlPageCount(original));
  if (!/<html\b/i.test(html) || !/<\/html>/i.test(html)) issues.push('缺少完整 html 根节点');
  if (!/<body\b/i.test(html)) issues.push('缺少 body 节点');
  if (!htmlPageCount(html)) issues.push('未找到 .page 页面');
  if (htmlPageCount(html) !== expectedPageCount) issues.push(`页面数量改变（原 ${expectedPageCount}，新 ${htmlPageCount(html)}）`);
  if (/<script\b|<iframe\b|<object\b|<embed\b|javascript:/i.test(html)) issues.push('包含不允许的脚本或危险资源');
  if (/\son[a-z]+\s*=/i.test(html)) issues.push('包含事件处理器属性');
  if (html.length > 220_000) issues.push('美化 HTML 过大');
  const requiredTokens = Array.isArray(options.protectedTokens) ? options.protectedTokens : protectedTokens(original);
  const missingTokens = options.validateProtectedTokens === false ? [] : requiredTokens.filter((token) => !html.includes(token));
  if (missingTokens.length) issues.push(`关键事实/来源标记丢失：${missingTokens.slice(0, 8).join('、')}`);
  const styleCoverageIssues = aiVisualStyleCoverageIssues(html);
  issues.push(...styleCoverageIssues);
  return { valid: issues.length === 0, issues, html, pageCount: htmlPageCount(html), missingTokens, styleCoverageIssues };
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, String(content).trimEnd() + '\n', 'utf8');
  fs.renameSync(temporary, filePath);
  return fs.statSync(filePath);
}

async function renderBeautifiedImages({ workspaceRoot, htmlPath, outputDir }) {
  const script = path.join(workspaceRoot, 'skills', 'html-pages-to-images', 'index.js');
  await execFileAsync(process.execPath, [script, '--htmlFile', htmlPath, '--outputDir', outputDir, '--selector', '.page', '--pageWidth', '375', '--pageHeight', '667', '--deviceScaleFactor', '3'], {
    cwd: workspaceRoot, windowsHide: true, timeout: 120_000, maxBuffer: 2_000_000,
  });
  const images = fs.existsSync(outputDir)
    ? fs.readdirSync(outputDir).filter((name) => name.toLowerCase().endsWith('.png')).sort().map((name) => path.join(outputDir, name))
    : [];
  if (!images.length) throw new Error('AI 美化 HTML 未生成任何页面图片');
  return images;
}

export function validateAiVisualScreenshotSet(imagePaths, expectedPageCount) {
  const images = Array.isArray(imagePaths) ? imagePaths.filter(Boolean) : [];
  const expected = Number(expectedPageCount) || 0;
  const issues = [];
  if (images.length !== expected) issues.push(`截图数量不一致（应为 ${expected}，实际 ${images.length}）`);
  for (let index = 0; index < expected; index += 1) {
    const imagePath = images[index];
    const expectedName = `page-${String(index + 1).padStart(2, '0')}.png`;
    if (!imagePath || path.basename(imagePath).toLowerCase() !== expectedName) {
      issues.push(`缺少 ${expectedName}`);
      continue;
    }
    try {
      if (fs.statSync(imagePath).size <= 0) issues.push(`${expectedName} 文件为空`);
    } catch {
      issues.push(`${expectedName} 文件不存在`);
    }
  }
  return { valid: issues.length === 0, expectedPageCount: expected, pageCount: images.length, images, issues };
}

function buildAiVisualSkillPrompt({ workspaceRoot, requiredPageCount, reinforce = false, repairIssues = [], auditRepairIssues = [], styleBrief = '', skillBundle = null }) {
  const skill = skillBundle || loadSkillBundle({ workspaceRoot, skillName: AI_VISUAL_SKILL_NAME });
  if (skill.fallback || !skill.prompt.trim()) throw new Error(`技能缺失或被禁用：skills/${AI_VISUAL_SKILL_NAME}/SKILL.md 无法加载`);
  const reinforceInstruction = reinforce
    ? (auditRepairIssues.length
      ? `这是布局审计定向修复重试。上一版存在以下问题：${repairIssues.join('；') || '布局审计未通过'}。请重新输出完整增量 JSON，不能退回完整 HTML；必须保留严格的 ${requiredPageCount} 页，只修复审计反馈的问题页，不要重写无关页面。`
      : `这是增量补丁强化重试。上一版存在以下问题：${repairIssues.join('；') || '视觉变化不足'}。请重新输出完整增量 JSON，不能退回完整 HTML；必须保留严格的 ${requiredPageCount} 页，并至少让 3 个可见视觉层面发生变化。`)
    : '';
  const auditRepairInstruction = auditRepairIssues.length
    ? `这是浏览器布局审计后的定向修复。只修复以下页面和问题，不要改动其他页面的事实、页面数量或页面职责：${auditRepairIssues.join('；')}。优先调整实际构图、尺寸、间距、对齐和颜色，确保使用主题变量后仍满足对比度与布局要求；不要用滚动容器、裁切或删除文字来规避问题。`
    : '';
  return skill.prompt
    .replaceAll('{{REQUIRED_PAGE_COUNT}}', String(requiredPageCount))
    .replaceAll('{{REINFORCE_INSTRUCTION}}', reinforceInstruction)
    .replaceAll('{{AUDIT_REPAIR_INSTRUCTION}}', auditRepairInstruction)
    .replaceAll('{{STYLE_BRIEF}}', String(styleBrief || '突出核心矛盾和关键事实，增加少量有语义的图标、徽章和箭头，保持清晰克制。').slice(0, 800));
}

function layoutRepairIssues(layout) {
  const issueLabels = new Set(['missing_page_body', 'invalid_page_grid_structure', 'missing_content_stack', 'empty_page_body', 'overflow', 'clipped', 'horizontal_overflow', 'underfilled', 'overfilled', 'vertical_imbalance']);
  return (Array.isArray(layout?.pages) ? layout.pages : []).flatMap((page) => {
    const issues = [];
    for (const issue of Array.isArray(page?.issues) ? page.issues : []) {
      if (!issueLabels.has(issue)) continue;
      if (issue === 'missing_page_body') issues.push(`P${page.page} missing_page_body（页面缺少可审计内容区）`);
      else if (issue === 'invalid_page_grid_structure') issues.push(`P${page.page} invalid_page_grid_structure（内页必须保留 page-inner、页眉、page-body、bottom-strip）`);
      else if (issue === 'missing_content_stack') issues.push(`P${page.page} missing_content_stack（内容页缺少可见内容栈）`);
      else if (issue === 'empty_page_body') issues.push(`P${page.page} empty_page_body（内容区没有可见内容）`);
      else if (issue === 'overflow') issues.push(`P${page.page} overflow ${page.overflowPixels ?? 0}px`);
      else if (issue === 'clipped') issues.push(`P${page.page} clipped ${page.clippedPixels ?? 0}px`);
      else if (issue === 'horizontal_overflow') issues.push(`P${page.page} horizontal_overflow ${page.horizontalOverflowPixels ?? 0}px`);
      else if (issue === 'text_too_small') issues.push(`P${page.page} text_too_small（正文不得低于 11px，辅助文字与标签不得低于 10px）`);
      else if (issue === 'underfilled' || issue === 'overfilled') issues.push(`P${page.page} ${issue}（利用率 ${page.utilization ?? '未知'}%，目标 ${page.target || '未知'}）`);
      else if (issue === 'vertical_imbalance') issues.push(`P${page.page} vertical_imbalance（上下留白差 ${page.verticalBalanceDelta ?? '未知'}px）`);
    }
    return issues;
  }).slice(0, 24);
}

function layoutAuditWarnings(layout) {
  return (Array.isArray(layout?.pages) ? layout.pages : []).flatMap((page) => {
    const warnings = Array.isArray(page?.warnings)
      ? page.warnings.map((warning) => `P${page.page} ${warning}`)
      : [];
    // 兼容旧版审计脚本：旧版可能把文本问题放在 issues 或 textVisibilityIssues，
    // 这里统一转为 warning，避免旧子进程重新触发 AI 修复门禁。
    if (Array.isArray(page?.issues) && page.issues.includes('text_too_small')) {
      warnings.push(`P${page.page} text_too_small（正文/辅助文字字号提示）`);
    }
    if (Array.isArray(page?.issues) && page.issues.includes('text_invisible')) {
      warnings.push(`P${page.page} text_invisible（文字可见性提示）`);
    }
    if (Array.isArray(page?.textVisibilityIssues)) {
      warnings.push(...page.textVisibilityIssues.slice(0, 8).map((issue) => (
        `P${page.page} text_invisible「${String(issue.text || '').slice(0, 120)}」前景 ${issue.foreground || '未知'}、背景 ${issue.background || '未知'}、对比度 ${issue.contrast ?? '未知'}`
      )));
    }
    return warnings;
  }).slice(0, 24);
}

function layoutRepairInstructions(layout) {
  const pages = Array.isArray(layout?.pages) ? layout.pages : [];
  return pages.flatMap((page) => {
      const samples = Array.isArray(page?.styleSamples) ? page.styleSamples : [];
    return (Array.isArray(page?.issues) ? page.issues : []).map((issue) => {
      const lowTextSelectors = samples
        .filter((sample) => {
          const selector = String(sample.selector || '');
          if (/(?:icon|mark|glyph|bullet|symbol|ornament|decoration)/i.test(selector)) return false;
          return Number.parseFloat(sample.fontSize) < (/(tag|label|caption|meta|date|sub|hint|eyebrow|cover-bottom|cover-tags|glass)/i.test(selector) ? 10 : 11);
        })
        .map((sample) => `${sample.selector}=${sample.fontSize}`)
        .slice(0, 4);
      const instructions = {
        missing_page_body: '补齐当前页面的可审计内容区：内页使用 page-inner > page-body，封面使用 page-inner > cover-center；保留页面事实和页面职责。',
        invalid_page_grid_structure: '补齐内页通用外壳 page-inner、主题页眉、page-body 和 bottom-strip；不要改动页面事实、顺序或数量。',
        missing_content_stack: '在现有 page-body 中保留可见的主题组件内容栈；不要用空白卡或装饰伪元素替代事实内容。',
        empty_page_body: '恢复当前页面原有可见事实内容；不得用空白卡、重复文案或装饰填充。',
        overflow: '移除内部滚动和固定超高；降低本页卡片 padding/gap 或拆开当前内容，确保 .page-body 的 scrollHeight 不超过 clientHeight。',
        clipped: '检查越过页面边界的元素；取消负 margin、固定超高和绝对定位越界，保证所有内容落在 375×667 页面安全区内。',
        horizontal_overflow: '让长文本、URL 和数字允许换行（overflow-wrap:anywhere/word-break:break-word），不要用横向滚动或裁切隐藏。',
        text_too_small: `把普通可读文字统一调到至少 11px，辅助文字/标签至少 10px；优先修改实际小字号元素${lowTextSelectors.length ? `：${lowTextSelectors.join('、')}` : '，不要只改外层容器'}。`,
        text_invisible: '根据实际前景色和背景色重新配色；浅色背景使用深色文字，深色背景使用浅色文字，确保文字与承载背景有明显对比。',
        underfilled: '保持事实不变，通过放大标题/数字、增加卡片内边距和行高、合理拉开卡片间距提升页面利用率；不得用空白卡或重复文案填充。',
        overfilled: '保留独立事实，压缩重复表达并降低卡片间距/内边距；不要删除数字、价格、人物、组织或限制条件。',
        vertical_imbalance: '本组 AI 视觉图文统一采用整体垂直居中：让 .page-body 使用 justify-content:center，并通过明确 gap 平衡上下留白；不得改为 flex-start，不得设置 data-valign="start"。',
      };
      return { page: page.page, issue, instruction: instructions[issue] || '调整本页实际构图，使其通过浏览器布局审计。' };
    });
  }).slice(0, 24);
}

async function runBrowserInspect(script, htmlPath, cwd, page = null) {
  const args = [script, htmlPath];
  if (Number.isInteger(page) && page > 0) args.push('--page', String(page));
  const { stdout } = await execFileAsync(process.execPath, args, { cwd, windowsHide: true, timeout: 120_000, maxBuffer: 2_000_000 });
  return JSON.parse(stdout);
}

function buildSingleLayoutAuditRequest(patch, step, fallbackPage = 1) {
  const candidatePage = Number(patch?.pages?.[0]?.page ?? patch?.pages?.[0]?.page_number);
  const page = Number.isInteger(candidatePage) && candidatePage > 0
    ? candidatePage
    : (Number.isInteger(Number(fallbackPage)) && Number(fallbackPage) > 0 ? Number(fallbackPage) : 1);
  return {
    type: 'tool_requests',
    assistant_note: '提交一个视觉补丁并调用浏览器审计',
    requests: [{
      requestId: `tr_layout_${step + 1}`,
      capability: SOCIAL_CARD_BROWSER_AUDIT_CAPABILITY,
      arguments: {
        patch: patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {},
        page,
      },
      reason: '在无头浏览器中获取目标页的真实布局和计算样式',
    }],
  };
}

export async function runSocialCardBeautifyIncremental({ gateway, store, batchId, candidateId, provider, workspaceRoot, onProgress = () => {}, styleBrief = '' }) {
  const batch = store.getBatch(batchId);
  const candidate = store.getCandidate(candidateId);
  if (!batch || !candidate) throw new Error('图文候选不存在');
  const workdir = candidateSocialCardDir(workspaceRoot, batch, candidate);
  const resolved = gateway.resolve(provider);
  const editorial = store.getCardEditorial?.(candidateId) || {};
  syncAiThemeSnapshot({ workdir, store, editorial, candidate });
  onProgress('读取故事板和主题契约，生成 AI 美化页面壳…');
  const context = buildBeautifyContext({ workdir, original: '', candidate, editorial });
  if (!context.storyboardPageCount) throw new Error('请先生成故事板，再使用 AI 美化');
  const shell = buildBeautifyShell(context);
  const workspaceFiles = ['fact-sheet.md', 'card-plan.json'];
  const themeSpecSource = path.join(workspaceRoot, 'themes', 'social', context.theme.id, 'AI_DESIGN_SPEC.md');
  const themeSpecCandidatePath = path.join(workdir, 'social-theme-design-spec.md');
  if (fs.existsSync(themeSpecSource)) {
    writeFile(themeSpecCandidatePath, fs.readFileSync(themeSpecSource, 'utf8'));
    workspaceFiles.push('social-theme-design-spec.md');
  } else {
    fs.rmSync(themeSpecCandidatePath, { force: true });
  }
  const layoutGuideSource = path.join(workspaceRoot, 'skills', AI_VISUAL_SKILL_NAME, 'references', 'layout-guide.md');
  const layoutGuideCandidatePath = path.join(workdir, 'layout-guide.md');
  if (fs.existsSync(layoutGuideSource)) {
    writeFile(layoutGuideCandidatePath, fs.readFileSync(layoutGuideSource, 'utf8'));
    workspaceFiles.push('layout-guide.md');
  } else {
    fs.rmSync(layoutGuideCandidatePath, { force: true });
  }
  const renderRequest = buildAiRenderRequest(context, { workspaceResourceId: 'project:current', workspaceFiles });
  const htmlPath = path.join(workdir, SOCIAL_CARD_BEAUTIFY_HTML);
  const outputDir = path.join(workdir, SOCIAL_CARD_BEAUTIFY_OUTPUT);
  const reportPath = path.join(workdir, 'ai-beautified-layout-report.json');
  let workingHtml = shell;
  let initialPatchApplied = false;
  let lastAuditedPatch = null;
  let lastAuditedEvaluation = null;
  const evaluatePatch = (modelResult) => {
    const patch = extractBeautifyPatch(modelResult?.content);
    const patchCheck = validateBeautifyPatch(workingHtml, patch, {
      allowPartialPages: true,
      allowEmptyCss: initialPatchApplied,
      maxPagesPerPatch: 1,
      expectedPage: nextUnauditedPage(),
    });
    if (!patchCheck.valid) {
      return {
        patch,
        patchCheck,
        applied: null,
        checked: { valid: false, issues: patchCheck.issues, html: workingHtml, pageCount: htmlPageCount(workingHtml) },
        changedByModel: false,
      };
    }
    const applied = applyBeautifyShellPatch(workingHtml, patch, { includeBaseCss: !initialPatchApplied });
    const checked = validateBeautifiedHtml(shell, applied.html, { validateProtectedTokens: false, pageCount: context.requiredPageCount });
    if (applied.warnings.length) checked.issues = [...checked.issues, ...applied.warnings];
    return { patch, patchCheck, applied, checked, changedByModel: checked.valid && hasMaterialVisualChange(shell, checked.html) };
  };
  const auditScript = path.join(workspaceRoot, 'skills', 'xiaohongshu-article-generator', 'scripts', 'layout-audit.mjs');
  const agentPreviewPath = path.join(workdir, '.ai-beautify-agent-preview.html');
  const agentReportPath = path.join(workdir, '.ai-beautify-agent-layout-report.json');
  const auditHistory = [];
  const auditedPages = new Set();
  const appliedPatchMetrics = { cssChars: 0, pages: new Map() };
  const nextUnauditedPage = () => {
    for (let page = 1; page <= context.requiredPageCount; page += 1) {
      if (!auditedPages.has(page)) return page;
    }
    return context.requiredPageCount;
  };
  const auditSocialCardBrowser = async (patch, { page = null } = {}) => {
    const evaluatedPatch = evaluatePatch({ content: JSON.stringify(patch) });
    if (!evaluatedPatch.checked.valid || !evaluatedPatch.changedByModel) {
      return { patchValid: evaluatedPatch.checked.valid, changedByModel: evaluatedPatch.changedByModel, issues: evaluatedPatch.checked.issues, layout: null };
    }
    workingHtml = evaluatedPatch.checked.html;
    initialPatchApplied = true;
    lastAuditedPatch = evaluatedPatch.patch;
    lastAuditedEvaluation = evaluatedPatch;
    appliedPatchMetrics.cssChars += String(evaluatedPatch.patch?.css || '').length;
    for (const page of evaluatedPatch.patch?.pages || []) {
      appliedPatchMetrics.pages.set(Number(page.page), String(page.page_html ?? page.content_html ?? '').length);
    }
    const auditedPage = Number(page) || Number(patch?.pages?.[0]?.page) || null;
    writeFile(agentPreviewPath, evaluatedPatch.checked.html);
    const layout = await runAudit(auditScript, agentPreviewPath, agentReportPath, workdir, { page: auditedPage });
    const issues = layoutRepairIssues(layout);
    if (layout.valid && auditedPage) auditedPages.add(auditedPage);
    auditHistory.push({ attempt: auditHistory.length + 1, issues, patchValid: true, changedByModel: true });
    return {
      patchValid: true,
      changedByModel: true,
      auditedPage,
      completedPages: [...auditedPages].sort((a, b) => a - b),
      nextPage: nextUnauditedPage(),
      issues,
      layout: {
        valid: layout.valid === true,
        pages: (Array.isArray(layout.pages) ? layout.pages : []).map((page) => ({
          page: page.page,
          issues: page.issues || [],
          utilization: page.utilization,
          target: page.target,
          overflowPixels: page.overflowPixels,
          clippedPixels: page.clippedPixels,
          horizontalOverflowPixels: page.horizontalOverflowPixels,
          verticalBalanceDelta: page.verticalBalanceDelta,
          textVisibilityIssues: page.textVisibilityIssues || [],
          styleSamples: page.styleSamples || [],
        })),
      },
    };
  };
  const registry = await getToolRegistry();
  const resources = new Map();
  registerProjectResource(resources, workdir);
  const catalog = applyCatalogSchemas(
    buildConversationToolCatalog({ registry, entryCapabilities: [SOCIAL_CARD_PROJECT_READ_CAPABILITY, SOCIAL_CARD_BROWSER_AUDIT_CAPABILITY] }),
    [SOCIAL_CARD_PROJECT_READ_CAPABILITY],
    workspaceRoot,
  );
  if (!catalog.length) throw new Error('布局审计工具未加载，无法启动 AI 视觉 Agent');
  const providerId = provider || gateway.config?.defaultProvider || '';
  const agentSystem = `${buildAiVisualSkillPrompt({ workspaceRoot, requiredPageCount: context.requiredPageCount, styleBrief })}

当前可用工具目录：${JSON.stringify(catalog)}`;
  const agentMessages = [
    { role: 'system', protected: true, content: agentSystem },
    { role: 'user', protected: true, content: JSON.stringify({ render_request: renderRequest }) },
  ];
  let result = null;
  const modelValidationIssues = [];
  let sourceRead = false;
  const agent = await runConversationAgent({
    entryPoint: 'social-card-ai-visual',
    registry,
    catalog,
    messages: agentMessages,
    store,
    budget: { maxModelSteps: 16, maxToolCalls: 16, maxParallelToolCalls: 1, maxToolResultChars: 40_000, maxTotalToolResultChars: 120_000, maxHistoryChars: 120_000, timeoutMs: 300_000 },
    toolContext: { batchId, candidateId, skillId: AI_VISUAL_SKILL_NAME, provider: providerId, workspaceRoot, allowedRoots: [workdir], allowedCapabilities: [SOCIAL_CARD_PROJECT_READ_CAPABILITY, SOCIAL_CARD_BROWSER_AUDIT_CAPABILITY], auditSocialCardBrowser },
    resolveArguments: (argumentsValue, request) => resolveResourceArguments(argumentsValue, request, { resources, workspaceRoot }),
    sanitizeToolResult: (toolResult, request) => sanitizeCapabilityResult(toolResult, request),
    onEvent: (event) => {
      if (event?.type === 'tool.completed' && event?.capability === SOCIAL_CARD_PROJECT_READ_CAPABILITY) sourceRead = true;
      if (event?.type === 'tool.requested') onProgress('AI 调用浏览器审计工具…');
      if (event?.type === 'tool.completed') onProgress('浏览器审计工具已返回结果…');
    },
    modelStep: async ({ messages, step, signal }) => {
      // 审计未通过时，模型有时会把上一轮完全相同的补丁再次提交。
      // 在模型调用前把审计结果翻译成明确的“必须改变”反馈，避免它反复撞重复工具调用保护。
      let modelMessages = messages;
      const previousAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
      const previousTool = [...messages].reverse().find((message) => message.role === 'tool');
      let previousPatch = null;
      let previousToolData = null;
      let previousToolResult = null;
      try {
        const previousEnvelope = previousAssistant ? JSON.parse(String(previousAssistant.content || '')) : null;
        previousPatch = previousEnvelope?.type === 'tool_requests'
          ? previousEnvelope.requests?.find((request) => request?.capability === SOCIAL_CARD_BROWSER_AUDIT_CAPABILITY)?.arguments?.patch
          : previousEnvelope?.patch || null;
        const previousResults = previousTool ? JSON.parse(String(previousTool.content || '')) : null;
        previousToolResult = Array.isArray(previousResults) ? previousResults[0] : previousResults;
        // 工具重复调用被 Agent 内核拦截时，结果没有 data，只有 error；
        // 这里也必须把它当作失败反馈给模型，否则模型会看不到“不得重复”的原因，
        // 继续生成同一份补丁直到撞上模型步骤预算。
        previousToolData = previousToolResult?.data || previousToolResult;
      } catch { /* 历史消息异常时仍按正常流程请求模型 */ }
      const previousAuditFailed = previousPatch && previousToolData
        && (previousToolResult?.status === 'error'
          || previousToolData.layout?.valid !== true
          || previousToolData.patchValid !== true
          || previousToolData.changedByModel !== true);
      if (previousAuditFailed) {
        const previousIssues = Array.isArray(previousToolData.issues) && previousToolData.issues.length
          ? previousToolData.issues.join('；')
          : previousToolData.error?.message || '上一轮浏览器布局审计未通过';
        modelMessages = [...messages, {
          role: 'user',
          protected: true,
          content: `上一轮提交的页面补丁未通过浏览器审计：${previousIssues}。禁止原样重复上一轮的 css 和 page_html；必须针对这些问题修改当前页面的构图、间距、字号或颜色后再提交，且仍只提交一个页面。`,
        }];
      }
      result = await gateway.complete({
        provider, purpose: 'social-card-beautify-agent', batchId, candidateId, thinking: false, temperature: step ? 0.45 : 0.35,
        maxOutputTokens: Math.min(7000, Number(resolved.provider?.maxOutputTokens) || 7000),
        adaptiveOutput: true, jsonMode: true, signal, messages: modelMessages,
      });
      const parsed = await parseModelJsonWithRepair(result, {
        store,
        label: 'AI 视觉 Agent',
        repair: async (error) => {
          onProgress('AI 输出 JSON 结构异常，反馈模型自动修正…');
          const previous = String(result?.content || '').slice(0, 8_000);
          result = await gateway.complete({
            provider,
            purpose: 'social-card-beautify-agent',
            batchId,
            candidateId,
            thinking: false,
            temperature: 0.2,
            maxOutputTokens: Math.min(7000, Number(resolved.provider?.maxOutputTokens) || 7000),
            adaptiveOutput: true,
            jsonMode: true,
            signal,
            messages: [
              ...messages,
              {
                role: 'user',
                protected: true,
                content: `上一条 AI 响应未能解析为完整 JSON（${error.code || 'JSON_FORMAT_ERROR'}）。请基于当前上下文重新输出一次，严格只返回完整合法 JSON，不要解释，不要 Markdown 围栏，不要改变事实、CSS 或 page_html 的内容。若返回 tool_requests，必须保证 requests、arguments、patch、pages 和 page_html 的括号顺序正确，并以完整的最外层 } 结束。上一条响应如下，仅用于保留原内容：\n<invalid-json>\n${previous}\n</invalid-json>`,
              },
            ],
          });
          return result;
        },
      });
      if (!sourceRead) {
        return validateAgentEnvelope({
          type: 'tool_requests',
          assistant_note: '先读取候选事实清单和故事板文件',
          requests: [{
              requestId: `tr_project_current_${step + 1}`,
              capability: SOCIAL_CARD_PROJECT_READ_CAPABILITY,
              arguments: {
                resourceId: 'project:current',
                options: { includePaths: workspaceFiles, maxFiles: workspaceFiles.length, maxCharsPerFile: 100000, maxTotalChars: 140000 },
              },
            reason: '读取 fact-sheet.md 和 card-plan.json，避免重复传入或遗漏结构化事实',
          }],
        }, { maxRequests: 1 });
      }
      const lastToolMessage = [...messages].reverse().find((message) => message.role === 'tool');
      let auditPassed = false;
      if (lastToolMessage) {
        try {
          const toolResults = JSON.parse(String(lastToolMessage.content || ''));
          const toolData = Array.isArray(toolResults) ? toolResults[0]?.data : toolResults?.data;
          auditPassed = toolData?.patchValid === true && toolData?.changedByModel === true && toolData?.layout?.valid === true;
        } catch { auditPassed = false; }
      }
      const allPagesAudited = auditedPages.size >= context.requiredPageCount;
      if (parsed?.css !== undefined && Array.isArray(parsed?.pages)) {
        if (auditPassed && allPagesAudited) return validateAgentEnvelope({ type: 'final', assistantReply: '布局审计通过', patch: parsed });
        return validateAgentEnvelope(buildSingleLayoutAuditRequest(parsed, step, nextUnauditedPage()), { maxRequests: 1 });
      }
      if (parsed?.type === 'final') {
        if (allPagesAudited) return validateAgentEnvelope(parsed, { maxRequests: 1 });
        if (parsed.patch && typeof parsed.patch === 'object') {
          return validateAgentEnvelope(buildSingleLayoutAuditRequest(parsed.patch, step, nextUnauditedPage()), { maxRequests: 1 });
        }
        throw new Error(`AI 尚未完成逐页视觉生成，仍缺少 P${nextUnauditedPage()}`);
      }
      if (parsed?.type === 'tool_requests') {
          const layoutRequest = Array.isArray(parsed.requests)
          ? parsed.requests.find((request) => request?.capability === SOCIAL_CARD_BROWSER_AUDIT_CAPABILITY)
          : null;
        const requestedPatch = layoutRequest?.arguments?.patch || parsed.patch || parsed.output?.patch || {};
        return validateAgentEnvelope(buildSingleLayoutAuditRequest(requestedPatch, step, nextUnauditedPage()), { maxRequests: 1 });
      }
      return validateAgentEnvelope(buildSingleLayoutAuditRequest(parsed, step, nextUnauditedPage()), { maxRequests: 1 });
    },
  });
  let evaluated = null;
  if (agent.type === 'final' && auditedPages.size >= context.requiredPageCount && lastAuditedEvaluation) {
    // 页面补丁已经逐页审计并累积到 workingHtml；final 只作为完成确认。
    // 模型偶尔会在 final 中重复带回整组 pages，不能把这份未重新审计的
    // 重复内容再次当作新补丁，否则会触发单页协议校验。
    evaluated = lastAuditedEvaluation;
  } else if (agent.type === 'final' && agent.output?.patch) {
    const isLastAuditedPatch = lastAuditedPatch && JSON.stringify(lastAuditedPatch) === JSON.stringify(agent.output.patch);
    evaluated = isLastAuditedPatch
      ? lastAuditedEvaluation
      : evaluatePatch({ content: JSON.stringify(agent.output.patch) });
  }
  else if (agent.type === 'final' && auditedPages.size < context.requiredPageCount) modelValidationIssues.push(`AI 未完成逐页视觉生成，仍缺少 P${nextUnauditedPage()}`);
  else modelValidationIssues.push(agent.type === 'limit'
    ? 'AI 视觉 Agent 达到模型步骤预算（审计修复未能收敛）'
    : 'AI 视觉 Agent 未返回最终增量补丁');
  const checked = evaluated?.checked || { valid: false, issues: modelValidationIssues, html: shell, pageCount: htmlPageCount(shell) };
  const changedByModel = Boolean(evaluated?.changedByModel);
  const modelRetries = 0;
  const layoutRepairRetries = auditHistory.length;
  const fallbackApplied = false;
  const fallbackReason = '';
  if (!checked.valid || !changedByModel) {
    const finalIssues = [...new Set([
      ...modelValidationIssues,
      ...(checked.valid ? ['AI 增量补丁变化不足，未产生实质视觉增强'] : checked.issues),
    ])];
    onProgress(`AI 美化未通过校验，未生成程序化回退页面（${finalIssues.join('；')}）`);
    fs.rmSync(htmlPath, { force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.rmSync(reportPath, { force: true });
    fs.rmSync(path.join(workdir, SOCIAL_CARD_BEAUTIFY_REPORT), { force: true });
    fs.rmSync(agentPreviewPath, { force: true });
    fs.rmSync(agentReportPath, { force: true });
    throw new Error(`AI 美化未通过校验：${finalIssues.join('；')}。未生成程序化回退页面，请重新生成。`);
  }
  onProgress('校验 AI 视觉增量补丁…');
  writeFile(htmlPath, checked.html);
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.rmSync(agentPreviewPath, { force: true });
  fs.rmSync(agentReportPath, { force: true });
  onProgress('根据 AI 视觉 HTML 生成逐页 PNG…');
  let imagePaths = await renderBeautifiedImages({ workspaceRoot, htmlPath, outputDir });
  onProgress('执行 AI 视觉版布局审计…');
  let layout = await runAudit(auditScript, htmlPath, reportPath, workdir);
  const layoutRepairHistory = auditHistory;
  const report = {
    schemaVersion: 3,
    status: layout.valid ? 'passed' : 'layout-review-required',
    source: 'storyboard-theme-ai-patch',
    renderMode: 'storyboard-theme-ai-patch',
    generatedAt: new Date().toISOString(),
    originalHtml: null,
    sourceStoryboard: 'card-plan.json',
    beautifiedHtml: SOCIAL_CARD_BEAUTIFY_HTML,
    pageCount: checked.pageCount,
    storyboardPageCount: context.storyboardPageCount,
    theme: { id: context.theme.id, label: context.theme.label, version: context.theme.version, templatePack: context.theme.templatePack },
    styleBrief: String(styleBrief || '').slice(0, 800),
    changedByModel,
    modelRetries,
    layoutRepairRetries,
    layoutRepairHistory,
    modelValidationIssues: [...new Set(modelValidationIssues)],
    fallbackApplied,
    fallbackReason,
    patch: {
      cssChars: appliedPatchMetrics.cssChars,
      pageCount: auditedPages.size,
      contentChars: [...appliedPatchMetrics.pages.values()].reduce((sum, chars) => sum + chars, 0),
      contentPages: auditedPages.size,
      warnings: evaluated.applied?.warnings || [],
    },
    layout,
    model: { provider: result.provider || provider || '', model: result.model || resolved.provider.model || '', callId: result.callId || null },
  };
  writeFile(path.join(workdir, SOCIAL_CARD_BEAUTIFY_REPORT), JSON.stringify(report, null, 2));
  store.upsertArtifact({ batchId, candidateId, track: 'social_cards', kind: 'AI 美化 HTML', name: SOCIAL_CARD_BEAUTIFY_HTML, path: htmlPath, size: fs.statSync(htmlPath).size, modifiedAt: fs.statSync(htmlPath).mtime.toISOString() });
  store.upsertArtifact({ batchId, candidateId, track: 'social_cards', kind: 'AI 美化布局审计', name: 'ai-beautified-layout-report.json', path: reportPath, size: fs.statSync(reportPath).size, modifiedAt: fs.statSync(reportPath).mtime.toISOString() });
  for (const imagePath of imagePaths) store.upsertArtifact({ batchId, candidateId, track: 'social_cards', kind: 'AI 美化 PNG', name: path.join(SOCIAL_CARD_BEAUTIFY_OUTPUT, path.basename(imagePath)), path: imagePath, size: fs.statSync(imagePath).size, modifiedAt: fs.statSync(imagePath).mtime.toISOString() });
  return { html: SOCIAL_CARD_BEAUTIFY_HTML, outputDir: SOCIAL_CARD_BEAUTIFY_OUTPUT, images: imagePaths.map((item) => path.basename(item)), layout: report.layout, status: report.status };
}

function aiHtmlScaffold() {
  return '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body data-render-mode="ai-visual">\n</body>\n</html>\n';
}

const AI_VISUAL_CENTERING_STYLE_ID = 'ai-page-centering';
const AI_VISUAL_CENTERING_RULE = '.page-body{display:flex;flex-direction:column;justify-content:center !important;align-content:center !important}';

// AI 视觉图文统一垂直居中：不管模型或修复 Agent 输出了 data-valign="start"、
// justify-content:flex-start/flex-end 还是封面底部对齐，都在交付前用确定性规则
// 归一为整体垂直居中，避免依赖模型自觉。卡片内部文字仍保持原有水平对齐。
export function normalizeAiVisualCentering(html) {
  let output = String(html || '');
  output = output.replace(/(<body\b[\s\S]*?<\/body>)/i, (body) => body.replace(/data-valign\s*=\s*(?:"[^"]*"|'[^']*')/gi, 'data-valign="center"'));
  if (!new RegExp(`<style\\b[^>]*id=["']${AI_VISUAL_CENTERING_STYLE_ID}["']`).test(output)) {
    output = output.replace(/<\/head>/i, `<style id="${AI_VISUAL_CENTERING_STYLE_ID}">${AI_VISUAL_CENTERING_RULE}</style>\n</head>`);
  }
  return output;
}

function rejectUnsafeAiHtml(value, { allowSections = false } = {}) {
  const text = String(value || '');
  if (/<script\b|<iframe\b|<object\b|<embed\b|javascript:|\son[a-z]+\s*=|@import\b|@(?:s)cope\b|url\s*\(/i.test(text)) {
    throw new Error('AI HTML 包含不允许的脚本、事件处理器、远程资源或不兼容的 CSS 作用域样式');
  }
  if (!allowSections && /<section\b/i.test(text)) throw new Error('页面增量不得包含 section，请使用 replace_pages');
  if (text.length > 14_000) throw new Error('AI HTML 单次写入过大');
}

function pageSectionRange(html, pageNumber) {
  const source = String(html || '');
  const openings = [...source.matchAll(/<section\b[^>]*class=["']([^"']*)["'][^>]*>/gi)]
    .filter((match) => match[1].split(/\s+/).includes('page'));
  const opening = openings[pageNumber - 1];
  if (!opening || opening.index == null) return null;
  const start = opening.index;
  const tagPattern = /<\/?section\b[^>]*>/gi;
  tagPattern.lastIndex = start + opening[0].length;
  let depth = 1;
  let match;
  while ((match = tagPattern.exec(source))) {
    if (/^<\//.test(match[0])) depth -= 1;
    else if (!/\/\s*>$/.test(match[0])) depth += 1;
    if (depth === 0) return { start, end: tagPattern.lastIndex };
  }
  return null;
}

function pageHtmlFingerprint(html, pageNumber) {
  const range = pageSectionRange(html, pageNumber);
  return range ? String(html || '').slice(range.start, range.end) : '';
}

function pageRepairStyle(html, pageNumber) {
  const match = String(html || '').match(new RegExp(`<style\\b[^>]*id=["']ai-page-repair-${pageNumber}["'][^>]*>[\\s\\S]*?<\\/style>`, 'i'));
  return match?.[0] || '';
}

function pageRepairFingerprint(html, pageNumber) {
  return `${pageHtmlFingerprint(html, pageNumber)}\n${pageRepairStyle(html, pageNumber)}`;
}

function currentAiCss(html, pageNumber) {
  return [...String(html || '').matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)]
    .filter((match) => {
      const repairPage = String(match[1] || '').match(/\bid=["']ai-page-repair-(\d+)["']/i)?.[1];
      return !repairPage || Number(repairPage) === Number(pageNumber);
    })
    .map((match) => match[2].trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 20_000);
}

function validateScopedRepairCss(value) {
  const css = String(value || '').trim();
  if (!css) return '';
  if (css.length > 5_000) throw new Error('单页 scoped_css 过大，请控制在 5000 字符以内');
  if (/<\/?style\b|@import\b|@charset\b|@(?:s)cope\b|url\s*\(|expression\s*\(|javascript:|:root\b/i.test(css)) throw new Error('scoped_css 包含不允许的全局、外部或不兼容样式');
  if (/(^|[},])\s*(?:html|body)\b[^,{]*\{/i.test(css)) throw new Error('scoped_css 不得修改 html 或 body');
  let depth = 0;
  for (const char of css) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth < 0) throw new Error('scoped_css 大括号未正确闭合');
  }
  if (depth !== 0) throw new Error('scoped_css 大括号未正确闭合');
  return css;
}

function applyAiPageRepair(html, { page, page_html: pageHtml, scoped_css: scopedCss }) {
  const pageNumber = Number(page);
  let section = String(pageHtml || '').trim();
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new Error('replace_page_with_styles 的 page 无效');
  if (!/^<section\b/i.test(section) || !/class=["'][^"']*\bpage\b/i.test(section)) throw new Error(`P${pageNumber} 必须是完整 .page section`);
  rejectUnsafeAiHtml(section, { allowSections: true });
  if (/\bdata-ai-page\s*=/i.test(section)) section = section.replace(/\bdata-ai-page\s*=\s*["'][^"']*["']/i, `data-ai-page="${pageNumber}"`);
  else section = section.replace(/^<section\b/i, `<section data-ai-page="${pageNumber}"`);
  let output = replaceAiPages(html, [{ page: pageNumber, page_html: section }]);
  const css = validateScopedRepairCss(scopedCss);
  const styleId = `ai-page-repair-${pageNumber}`;
  output = output.replace(new RegExp(`\\s*<style\\b[^>]*id=["']${styleId}["'][^>]*>[\\s\\S]*?<\\/style>`, 'i'), '');
  if (css) output = output.replace(/<\/head>/i, `<style id="${styleId}">${pageCssWithAttributeSelectors(css, pageNumber)}</style>\n</head>`);
  return output;
}

function replaceAiPages(html, pages) {
  let output = String(html || '');
  const replacements = pages
    .map((item) => ({ page: Number(item?.page), html: String(item?.html || item?.page_html || item?.content || '') }))
    .sort((a, b) => b.page - a.page);
  for (const item of replacements) {
    if (!Number.isInteger(item.page) || item.page < 1) throw new Error('replace_pages 的 page 无效');
    if (!/^<section\b/i.test(item.html) || !/class=["'][^"']*\bpage\b/i.test(item.html)) throw new Error(`P${item.page} 必须是完整 .page section`);
    rejectUnsafeAiHtml(item.html, { allowSections: true });
    const range = pageSectionRange(output, item.page);
    if (!range) throw new Error(`找不到待替换的 P${item.page}`);
    output = output.slice(0, range.start) + item.html.trim() + output.slice(range.end);
  }
  return output;
}

function aiWriteCatalogItem() {
  return {
    capability: 'filesystem.project.write',
    name: '候选 HTML 文件写入',
    description: '在当前候选目录内受限创建或更新 ai-beautified.html；生成阶段分片设置基础 CSS、追加组件 CSS 或追加一页，修复阶段只能替换一个问题页。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['resourceId', 'path', 'mode'],
      properties: {
        resourceId: { type: 'string' },
        path: { type: 'string', enum: [SOCIAL_CARD_BEAUTIFY_HTML] },
        mode: { type: 'string', enum: ['set_head', 'append_head_css', 'append_body', 'replace_pages', 'replace_page_with_styles'] },
        content: { type: 'string' },
        pages: { type: 'array', minItems: 1, maxItems: 1 },
        page: { type: 'integer', minimum: 1 },
        page_html: { type: 'string' },
        scoped_css: { type: 'string' },
      },
    },
    implementations: [{ plugin: 'application-social-card-ai-visual', version: '1.0.0', riskLevel: 'local-write' }],
  };
}

function aiAuditCatalogItem(base) {
  return {
    ...(base || {}),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['resourceId', 'path', 'page', 'revision'],
      properties: {
        resourceId: { type: 'string' },
        path: { type: 'string', enum: [SOCIAL_CARD_BEAUTIFY_HTML] },
        page: { type: 'integer', minimum: 1 },
        revision: { type: 'integer', minimum: 1 },
      },
    },
  };
}

function aiInspectCatalogItem() {
  return {
    capability: SOCIAL_CARD_BROWSER_INSPECT_CAPABILITY,
    name: '浏览器真实布局查看',
    description: '在 375×667 无头浏览器中查看指定页面的真实元素边界、计算字号、颜色和滚动尺寸；只提供观察数据，不执行通过/失败判定。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['resourceId', 'path', 'page'],
      properties: {
        resourceId: { type: 'string' },
        path: { type: 'string', enum: [SOCIAL_CARD_BEAUTIFY_HTML] },
        page: { type: 'integer', minimum: 1 },
      },
    },
    implementations: [{ plugin: 'application-social-card-ai-visual', version: '1.0.0', riskLevel: 'read-only' }],
  };
}

function compactAiAudit(layout) {
  return {
    valid: layout?.valid === true,
    pages: (Array.isArray(layout?.pages) ? layout.pages : []).map((page) => ({
      page: page.page,
      issues: page.issues || [],
      warnings: page.warnings || [],
      utilization: page.utilization,
      target: page.target,
      overflowPixels: page.overflowPixels,
      clippedPixels: page.clippedPixels,
      horizontalOverflowPixels: page.horizontalOverflowPixels,
      verticalBalanceDelta: page.verticalBalanceDelta,
      textVisibilityIssues: page.textVisibilityIssues || [],
      // 计算样式明细体量很大；文字可见性问题已由 textVisibilityIssues 表达，
      // 只保留少量样本给模型定位颜色/字号，避免审计元数据耗尽修复上下文。
      styleSamples: (page.styleSamples || []).slice(0, 6),
    })),
  };
}

export async function runSocialCardBeautify({ gateway, store, batchId, candidateId, provider, workspaceRoot, onProgress = () => {}, styleBrief = '' }) {
  const batch = store.getBatch(batchId);
  const candidate = store.getCandidate(candidateId);
  if (!batch || !candidate) throw new Error('图文候选不存在');
  const workdir = candidateSocialCardDir(workspaceRoot, batch, candidate);
  const originalPath = path.join(workdir, 'my-design.html');
  const originalHtml = fs.existsSync(originalPath) ? fs.readFileSync(originalPath, 'utf8') : '';
  const editorial = store.getCardEditorial?.(candidateId) || {};
  syncAiThemeSnapshot({ workdir, store, editorial, candidate });
  const context = buildBeautifyContext({ workdir, original: originalHtml, candidate, editorial });
  if (!context.storyboardPageCount) throw new Error('请先生成故事板，再使用 AI 视觉生成');

  const baseline = writeSocialCardAiVisualBaseline({
    workdir,
    candidateId,
    batchId,
    contentType: context.contentType,
    channelMode: context.channelMode,
    themeId: context.theme?.id,
    requiredPageCount: context.requiredPageCount,
    storyboardPageCount: context.storyboardPageCount,
  });
  store.upsertArtifact?.({
    batchId,
    candidateId,
    track: 'social_cards',
    kind: 'AI 视觉基线',
    name: 'ai-visual-baseline.json',
    path: baseline.path,
    size: fs.statSync(baseline.path).size,
    modifiedAt: fs.statSync(baseline.path).mtime.toISOString(),
  });
  const stageRecorder = createSocialCardAiVisualStageRecorder({ workdir, batchId, candidateId });
  const inputsStage = stageRecorder.start('inputs', {
    skill: 'fixed-program',
    inputArtifacts: ['card-plan.json', context.contentType === 'repository' ? 'repository-fact-sheet.json' : context.contentType === 'custom' ? 'custom-fact-sheet.json' : 'event-analysis.json', 'social-theme-design-spec.md', 'layout-guide.md'],
    outputArtifact: 'ai-visual-card-plan.json',
  });

  onProgress('准备数据库故事板、原始事实和主题设计规范…');
  let editorialPages = [];
  try { editorialPages = JSON.parse(editorial.card_plan_json || '[]'); } catch {}
  if (!Array.isArray(editorialPages) || !editorialPages.length) throw new Error('数据库故事板为空，请先重新生成故事板');
  const sourcePlan = {
    schemaVersion: 1,
    topic: String(candidate?.angle || candidate?.thesis || ''),
    channel_mode: context.channelMode,
    content_type: context.contentType,
    pages: editorialPages,
  };
  // 故事板的权威来源是 card_editorial_sessions.card_plan_json。这里落盘只是给
  // 文件型 Agent 读取，不依赖程序化图文 Pipeline 预先生成 card-plan.json。
  writeFile(path.join(workdir, 'card-plan.json'), JSON.stringify(sourcePlan, null, 2));

  const factFile = context.contentType === 'repository'
    ? 'repository-fact-sheet.json'
    : context.contentType === 'custom'
      ? 'custom-fact-sheet.json'
      : 'event-analysis.json';
  if (!fs.existsSync(path.join(workdir, factFile))) throw new Error(`AI 视觉生成缺少原始事实文件：${factFile}`);
  const aiVisualPlanPath = path.join(workdir, 'ai-visual-card-plan.json');
  const aiVisualPlan = buildAiVisualCardPlan(sourcePlan);
  writeFile(aiVisualPlanPath, JSON.stringify(aiVisualPlan, null, 2));
  const workspaceFiles = ['card-plan.json', factFile];
  const themeSpecSource = path.join(workspaceRoot, 'themes', 'social', context.theme.id, 'AI_DESIGN_SPEC.md');
  const themeSpecCandidatePath = path.join(workdir, 'social-theme-design-spec.md');
  if (fs.existsSync(themeSpecSource)) {
    writeFile(themeSpecCandidatePath, fs.readFileSync(themeSpecSource, 'utf8'));
    workspaceFiles.push('social-theme-design-spec.md');
  }
  const layoutGuideSource = path.join(workspaceRoot, 'skills', AI_VISUAL_SKILL_NAME, 'references', 'layout-guide.md');
  const layoutGuideCandidatePath = path.join(workdir, 'layout-guide.md');
  if (fs.existsSync(layoutGuideSource)) {
    writeFile(layoutGuideCandidatePath, fs.readFileSync(layoutGuideSource, 'utf8'));
    workspaceFiles.push('layout-guide.md');
  }
  const renderRequest = buildAiRenderRequest(context, { workspaceResourceId: 'project:current', workspaceFiles });
  const htmlPath = path.join(workdir, SOCIAL_CARD_BEAUTIFY_HTML);
  const outputDir = path.join(workdir, SOCIAL_CARD_BEAUTIFY_OUTPUT);
  const reportPath = path.join(workdir, 'ai-beautified-layout-report.json');
  const agentReportPath = path.join(workdir, '.ai-beautify-agent-layout-report.json');
  // 新一轮 AI 视觉生成开始前清理旧 PNG，避免结构门禁失败时页面仍显示上一轮残留结果。
  fs.rmSync(outputDir, { recursive: true, force: true });
  for (const staleReport of [reportPath, path.join(workdir, SOCIAL_CARD_BEAUTIFY_REPORT), agentReportPath]) {
    fs.rmSync(staleReport, { force: true });
  }
  writeFile(htmlPath, aiHtmlScaffold());

  const auditScript = path.join(workspaceRoot, 'skills', 'xiaohongshu-article-generator', 'scripts', 'layout-audit.mjs');
  const inspectScript = path.join(workspaceRoot, 'skills', AI_VISUAL_SKILL_NAME, 'scripts', 'browser-inspect.mjs');
  const auditHistory = [];
  let sourceRead = false;
  let writeCount = 0;
  let cssChunkCount = 0;
  let auditCount = 0;
  let auditAfterRepairPage = null;
  let auditPhase = false;
  let generationPhase = 'idle';
  let lastAudit = null;
  let lastAuditPage = null;
  const validAuditedPages = new Set();
  let lastModelResult = null;
  const resources = new Map();
  registerProjectResource(resources, workdir);
  const registry = await getToolRegistry();
  const baseCatalog = applyCatalogSchemas(
    buildConversationToolCatalog({ registry, entryCapabilities: [SOCIAL_CARD_PROJECT_READ_CAPABILITY, SOCIAL_CARD_BROWSER_AUDIT_CAPABILITY] }),
    [SOCIAL_CARD_PROJECT_READ_CAPABILITY],
    workspaceRoot,
  );
  const auditBase = baseCatalog.find((item) => item.capability === SOCIAL_CARD_BROWSER_AUDIT_CAPABILITY);
  const catalog = [...baseCatalog.filter((item) => item.capability !== SOCIAL_CARD_BROWSER_AUDIT_CAPABILITY), aiInspectCatalogItem(), aiAuditCatalogItem(auditBase), aiWriteCatalogItem()];
  const allowedCapabilities = [SOCIAL_CARD_PROJECT_READ_CAPABILITY, SOCIAL_CARD_BROWSER_INSPECT_CAPABILITY, SOCIAL_CARD_BROWSER_AUDIT_CAPABILITY, 'filesystem.project.write'];
  const visualSkillBundle = loadSkillBundle({ workspaceRoot, skillName: AI_VISUAL_SKILL_NAME });
  const screenshotSkillBundle = loadSkillBundle({ workspaceRoot, skillName: 'html-pages-to-images' });
  const copySkillBundle = loadSkillBundle({ workspaceRoot, skillName: 'xiaohongshu-article-generator' });
  if (visualSkillBundle.fallback || !visualSkillBundle.prompt.trim()) throw new Error(`技能缺失或被禁用：skills/${AI_VISUAL_SKILL_NAME}/SKILL.md 无法加载`);
  if (copySkillBundle.fallback || !copySkillBundle.prompt.trim()) throw new Error('技能缺失或被禁用：skills/xiaohongshu-article-generator/SKILL.md 无法加载');
  const skillRuntime = await prepareSkillRun({
    gateway,
    store,
    batchId,
    candidateId,
    purpose: 'social-card-ai-visual',
    bundles: [visualSkillBundle, screenshotSkillBundle, copySkillBundle],
    provider,
    selection: {
      entryPoint: 'social-card-ai-visual',
      stages: { copy: 'xiaohongshu-article-generator', generation: AI_VISUAL_SKILL_NAME, 'audit-repair': AI_VISUAL_SKILL_NAME, screenshots: 'html-pages-to-images' },
    },
  });
  gateway = bindGenerationSnapshot(gateway, skillRuntime.snapshotId);
  provider = skillRuntime.provider;
  const providerId = provider || gateway.config?.defaultProvider || '';
  const providerMaxOutputTokens = Number(skillRuntime.providerConfig?.maxOutputTokens || skillRuntime.providerConfig?.provider?.maxOutputTokens) || 7000;
  const resolvedModel = skillRuntime.providerConfig?.model || skillRuntime.providerConfig?.provider?.model || '';
  const skillManifest = writeSocialCardAiVisualSkillManifest({ workdir, runtime: skillRuntime, bundles: skillRuntime.bundles, catalog });
  inputsStage.finish({
    outputArtifact: aiVisualPlanPath,
    detail: `已生成 AI 视觉精简故事板，并冻结 ${skillRuntime.snapshotId || '当前运行'} 的技能、模型和工具快照`,
    metadata: { snapshotId: skillRuntime.snapshotId, provider, model: resolvedModel, skillManifest: skillManifest.path },
  });
  const copyStage = stageRecorder.start('copy', {
    skill: 'xiaohongshu-article-generator',
    inputArtifacts: ['card-plan.json', factFile],
    outputArtifact: 'copy.txt',
  });
  const copyPath = path.join(workdir, 'copy.txt');
  try {
    const factDocument = readJsonFile(path.join(workdir, factFile), {});
    const factData = context.contentType === 'event' ? (factDocument.analysis || factDocument) : (factDocument.data || factDocument);
    const copyResult = await generateSocialCardCopy({
      gateway,
      provider,
      providerConfig: skillRuntime.providerConfig,
      batchId,
      candidateId,
      skillPrompt: skillRuntime.bundles.find((bundle) => bundle.skillName === 'xiaohongshu-article-generator')?.prompt || copySkillBundle.prompt,
      channelMode: context.channelMode,
      topic: candidate.hotspot_title,
      contentType: context.contentType,
      storyboardClass: context.contentType === 'event' ? socialStoryboardClassForContentClass(candidate.content_class) : undefined,
      factData,
      sourceUrl: factDocument.sourceUrl || factDocument.source_url || '',
      eventAnalysis: context.contentType === 'event' ? factData : null,
      editorial,
      cardPlan: editorialPages,
      disclosure: context.contentType === 'event' ? '据公开素材整理；未核实主张必须保留边界表达' : context.contentType === 'custom' ? '体验性表述来自作者确认；建议性内容未实测' : '基于项目文档整理，未实际运行',
    });
    const copyCheck = validateSocialCardCopy(copyResult.copy);
    if (!copyCheck.valid) throw new Error(`配套文案门禁未通过：${copyCheck.issues.join('；')}`);
    writeFile(copyPath, copyResult.copy);
    copyStage.finish({
      outputArtifact: 'copy.txt',
      detail: `已生成配套发布文案（${copyCheck.tagCount} 个话题标签）`,
      metadata: { purpose: 'social-card-copy', tagCount: copyCheck.tagCount },
    });
    store.upsertArtifact?.({ batchId, candidateId, track: 'social_cards', kind: '图文配套文案', name: 'copy.txt', path: copyPath, size: fs.statSync(copyPath).size, modifiedAt: fs.statSync(copyPath).mtime.toISOString() });
  } catch (error) {
    copyStage.fail(error);
    throw error;
  }
  const resolveAiArguments = async (argumentsValue, request) => {
    const args = argumentsValue && typeof argumentsValue === 'object' ? argumentsValue : {};
    if ([SOCIAL_CARD_BROWSER_INSPECT_CAPABILITY, SOCIAL_CARD_BROWSER_AUDIT_CAPABILITY, 'filesystem.project.write'].includes(request.capability)) {
      if (String(args.resourceId || '') !== 'project:current' || String(args.path || '') !== SOCIAL_CARD_BEAUTIFY_HTML) {
        const error = new Error('只允许访问当前候选目录中的 ai-beautified.html');
        error.code = 'RESOURCE_NOT_ALLOWED';
        throw error;
      }
      return { ...args, absolutePath: htmlPath };
    }
    return resolveResourceArguments(args, request, { resources, workspaceRoot });
  };
  const toolHandlers = {
    'filesystem.project.write': async (args) => {
      const mode = String(args.mode || '');
      let current = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : aiHtmlScaffold();
      const previousPageCount = htmlPageCount(current);
      if (mode === 'set_head') {
        if (generationPhase === 'pages') throw new Error('页面阶段不能修改全局 CSS，CSS Agent 已经完成');
        const content = String(args.content || '');
        rejectUnsafeAiHtml(content);
        if (!/<style\b/i.test(content)) throw new Error('set_head 必须包含 AI 视觉 CSS style');
        if (content.length > MAX_AI_GENERATION_CSS_CHUNK_CHARS) throw new Error(`基础 CSS 分片过大，请控制在 ${MAX_AI_GENERATION_CSS_CHUNK_CHARS} 字符以内`);
        if (!/<head\b/i.test(current)) throw new Error('当前 HTML 缺少 head');
        current = current.replace(/(<head\b[^>]*>)[\s\S]*?(<\/head>)/i, `$1\n${content.trim()}\n$2`);
        cssChunkCount = 1;
      } else if (mode === 'append_head_css') {
        if (generationPhase === 'pages') throw new Error('页面阶段不能追加全局 CSS，CSS Agent 已经完成');
        const content = String(args.content || '');
        rejectUnsafeAiHtml(content);
        if (previousPageCount > 0) throw new Error('页面生成开始后不能继续追加全局 CSS');
        if (cssChunkCount < 1) throw new Error('必须先使用 set_head 写入基础 CSS');
        if (cssChunkCount >= 3) throw new Error('全局 CSS 分片最多 3 个');
        if (!/<style\b/i.test(content)) throw new Error('append_head_css 必须包含完整 style');
        if (content.length > MAX_AI_GENERATION_CSS_CHUNK_CHARS) throw new Error(`组件 CSS 分片过大，请控制在 ${MAX_AI_GENERATION_CSS_CHUNK_CHARS} 字符以内`);
        current = current.replace(/<\/head>/i, `${content.trim()}\n</head>`);
        cssChunkCount += 1;
      } else if (mode === 'append_body') {
        if (generationPhase === 'css') throw new Error('CSS 阶段不能追加页面，CSS Agent 必须先返回阶段完成');
        if (auditPhase) throw new Error('已进入逐页审计修复阶段，不能继续追加页面');
        if (cssChunkCount < 1) throw new Error('必须先完成基础 CSS 分片');
        const content = String(args.content || '');
        rejectUnsafeAiHtml(content, { allowSections: true });
        if (!/<section\b[^>]*class=["'][^"']*\bpage\b/i.test(content)) throw new Error('append_body 必须追加一个完整 .page section');
        current = current.replace(/<\/body>/i, `\n${content.trim()}\n</body>`);
        const appendedPageCount = htmlPageCount(current) - previousPageCount;
        if (appendedPageCount !== 1) throw new Error('append_body 每次只能追加一个 .page section');
      } else if (mode === 'replace_pages') {
        if (!auditPhase) throw new Error('页面尚未全部生成，生成阶段只能使用 append_body');
        if (!Array.isArray(args.pages) || !args.pages.length) throw new Error('replace_pages 缺少 pages');
        if (args.pages.length > MAX_AI_REPAIR_PAGES) throw new Error(`replace_pages 每次最多修复 ${MAX_AI_REPAIR_PAGES} 页`);
        if (!lastAudit || lastAudit.valid || Number(args.pages[0]?.page) !== lastAuditPage) {
          throw new Error(`当前必须先修复审计未通过的 P${lastAuditPage || '?'}，不得跳到其他页面`);
        }
        current = replaceAiPages(current, args.pages);
        auditAfterRepairPage = Number(args.pages[0]?.page);
      } else if (mode === 'replace_page_with_styles') {
        if (generationPhase !== 'idle') throw new Error('生成阶段不能修复页面');
        if (!auditPhase) throw new Error('页面尚未全部生成，生成阶段不能修复页面');
        const targetPage = Number(args.page);
        if (!lastAudit || lastAudit.valid || targetPage !== lastAuditPage) {
          throw new Error(`当前必须先修复审计未通过的 P${lastAuditPage || '?'}，不得跳到其他页面`);
        }
        current = applyAiPageRepair(current, args);
        auditAfterRepairPage = targetPage;
      } else throw new Error(`不支持的 HTML 写入模式：${mode}`);
      writeFile(htmlPath, current);
      writeCount += 1;
      return { status: 'ok', data: { path: SOCIAL_CARD_BEAUTIFY_HTML, mode, writeCount, pageCount: htmlPageCount(current), chars: current.length } };
    },
    [SOCIAL_CARD_BROWSER_INSPECT_CAPABILITY]: async (args) => {
      const page = Number(args.page);
      onProgress(`AI 查看 P${page} 浏览器真实布局…`);
      return { status: 'ok', data: { inspection: await runBrowserInspect(inspectScript, htmlPath, workdir, page), path: SOCIAL_CARD_BEAUTIFY_HTML, page } };
    },
    [SOCIAL_CARD_BROWSER_AUDIT_CAPABILITY]: async (args) => {
      if (!auditPhase) throw new Error('页面尚未全部生成，完成整组页面后才开始逐页审计');
      const page = Number(args.page);
      onProgress(`AI 审计 P${page} 页面布局…`);
      const layout = await runAudit(auditScript, htmlPath, agentReportPath, workdir, { page });
      const compact = compactAiAudit(layout);
      lastAudit = compact;
      lastAuditPage = page;
      if (compact.valid) validAuditedPages.add(page); else validAuditedPages.delete(page);
      auditCount += 1;
      const issues = layoutRepairIssues(layout);
      const warnings = layoutAuditWarnings(layout);
      auditHistory.push({ attempt: auditCount, issues, warnings, valid: compact.valid, pageCount: compact.pages.length });
      return { status: 'ok', data: { layout: compact, issues, warnings, repairInstructions: layoutRepairInstructions(compact), path: SOCIAL_CARD_BEAUTIFY_HTML, page, revision: auditCount } };
    },
  };
  const generationCatalog = [...baseCatalog.filter((item) => item.capability === SOCIAL_CARD_PROJECT_READ_CAPABILITY), aiWriteCatalogItem()];
  const generationSystem = `${buildAiVisualSkillPrompt({ workspaceRoot, requiredPageCount: context.requiredPageCount, styleBrief, skillBundle: skillRuntime.bundles.find((bundle) => bundle.skillName === AI_VISUAL_SKILL_NAME) || visualSkillBundle })}\n\n当前可用工具目录：${JSON.stringify(generationCatalog)}`;
  const generationStage = stageRecorder.start('generation', {
    skill: AI_VISUAL_SKILL_NAME,
    inputArtifacts: workspaceFiles,
    outputArtifact: SOCIAL_CARD_BEAUTIFY_HTML,
    metadata: { agentEntryPoint: 'social-card-ai-visual-generation', auditToolsVisible: false },
  });
  let generationAgent;
  const generationAttempts = [];
  const runGenerationAttempt = async (attempt, recoveryIssues = []) => {
    writeFile(htmlPath, aiHtmlScaffold());
    cssChunkCount = 0;
    const styleCoverageRecovery = recoveryIssues.some((issue) => issue.includes('缺少组件 CSS'))
      ? '本次恢复特别修复组件样式覆盖：必须先通过 set_head 或 append_head_css 写入覆盖全部页面组件类的完整 CSS，再追加页面 HTML；不能只写有 class 名的 HTML。全局组件 CSS 可统一写一次，页面专属样式使用对应页面的 scoped CSS。'
      : '';
    const recoveryInstruction = recoveryIssues.length
      ? `\n\n这是第 ${attempt} 次全量生成恢复。上一版只通过了部分结构检查，问题如下：${recoveryIssues.join('；')}。${styleCoverageRecovery}请从头重新写入完整 ${context.requiredPageCount} 页；不要修补旧文件，不要调用审计，不要输出完整 HTML JSON。`
      : '';
    const result = await runSocialCardAiVisualGenerationAgent({
      gateway,
      store,
      batchId,
      candidateId,
      provider,
      registry,
      catalog: generationCatalog,
      agentSystem: `${generationSystem}${recoveryInstruction}`,
      renderRequest,
      workspaceFiles,
      requiredPageCount: context.requiredPageCount,
      getPageCount: () => htmlPageCount(fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : ''),
      getCssChunkCount: () => cssChunkCount,
      toolHandlers,
      resolveArguments: resolveAiArguments,
      sanitizeToolResult: (toolResult, request) => sanitizeCapabilityResult(toolResult, request),
      toolContext: { batchId, candidateId, skillId: AI_VISUAL_SKILL_NAME, provider: providerId, workspaceRoot, allowedRoots: [workdir] },
      maxOutputTokens: providerMaxOutputTokens,
      onPhaseChange: (phase) => { generationPhase = phase; },
      onProgress,
    });
    const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
    const check = validateBeautifiedHtml(originalHtml, html, { pageCount: context.requiredPageCount, validateProtectedTokens: false });
    const issues = [...check.issues];
    if (result.type !== 'final') issues.push('全量生成 Agent 未返回完成确认');
    const passed = result.type === 'final' && check.valid === true && htmlPageCount(html) === context.requiredPageCount;
    const attemptRecord = {
      attempt,
      agentRunId: result.agentRunId || null,
      status: passed ? 'passed' : 'blocked',
      agentType: result.type || '',
      pageCount: htmlPageCount(html),
      requiredPageCount: context.requiredPageCount,
      issues,
      modelSteps: result.modelSteps || 0,
      toolCalls: result.toolCalls || 0,
      completedAt: new Date().toISOString(),
    };
    generationAttempts.push(attemptRecord);
    writeFile(path.join(workdir, `ai-beautified-generation-attempt-${attempt}.json`), JSON.stringify(attemptRecord, null, 2));
    if (!passed && attempt === 1 && html) writeFile(path.join(workdir, 'ai-beautified-generation-attempt-1.html'), html);
    return { result, html, check, passed, issues };
  };
  try {
    let attemptResult = await runGenerationAttempt(1);
    if (!attemptResult.passed) {
      onProgress(`全量生成结构门禁未通过，执行一次全量恢复：${attemptResult.issues.join('；')}`);
      attemptResult = await runGenerationAttempt(2, attemptResult.issues);
    }
    generationAgent = attemptResult.result;
    generationStage.finish({
      status: attemptResult.passed ? 'completed' : 'failed',
      gate: attemptResult.passed ? 'passed' : 'failed',
      detail: attemptResult.passed ? `已独立写入 ${attemptResult.result.pageCount}/${context.requiredPageCount} 页` : `全量生成恢复后仍未通过结构门禁：${attemptResult.issues.join('；')}`,
      metadata: { attempts: generationAttempts.length, agentRunId: generationAgent.agentRunId || null, modelSteps: generationAttempts.reduce((sum, item) => sum + item.modelSteps, 0), toolCalls: generationAttempts.reduce((sum, item) => sum + item.toolCalls, 0), pageCount: attemptResult.result.pageCount || 0 },
    });
  } catch (error) {
    generationStage.fail(error);
    throw error;
  }
  const generatedHtmlAfterGeneration = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
  const generationCheck = validateBeautifiedHtml(originalHtml, generatedHtmlAfterGeneration, { pageCount: context.requiredPageCount, validateProtectedTokens: false });
  const generationGateStage = stageRecorder.start('generation-gate', {
    skill: 'fixed-program',
    inputArtifacts: [SOCIAL_CARD_BEAUTIFY_HTML],
    outputArtifact: 'ai-beautified-generation-gate.json',
  });
  const generationGatePassed = generationAttempts.at(-1)?.status === 'passed'
    && generationCheck.valid === true
    && htmlPageCount(generatedHtmlAfterGeneration) === context.requiredPageCount;
  const generationGate = {
    schemaVersion: 1,
    status: generationGatePassed ? 'passed' : 'blocked',
    valid: generationGatePassed,
    pageCount: htmlPageCount(generatedHtmlAfterGeneration),
    requiredPageCount: context.requiredPageCount,
    issues: generationCheck.issues || [],
    attempts: generationAttempts,
    checkedAt: new Date().toISOString(),
  };
  const generationGatePath = path.join(workdir, 'ai-beautified-generation-gate.json');
  writeFile(generationGatePath, JSON.stringify(generationGate, null, 2));
  generationGateStage.finish({
    status: generationGatePassed ? 'completed' : 'blocked',
    gate: generationGatePassed ? 'passed' : 'blocked',
    detail: generationGatePassed ? 'HTML 根节点和页面数量通过结构门禁' : `结构门禁未通过：${generationGate.issues.join('；') || '页面数量或 HTML 结构无效'}`,
    metadata: { pageCount: generationGate.pageCount, requiredPageCount: generationGate.requiredPageCount },
  });
  if (!generationGatePassed) {
    const issues = [...new Set([
      ...generationCheck.issues,
      ...(generationAttempts.at(-1)?.issues || []),
      '全量生成恢复次数已用尽，未进入布局审计修复',
    ])];
    onProgress(`AI 视觉生成结构门禁未通过：${issues.join('；')}`);
    throw new Error(`AI 美化未通过结构门禁：${issues.join('；')}。未生成程序化回退页面；已保留 AI 生成草稿和诊断文件，未进入布局审计修复。`);
  }
  const modelValidationIssues = [];
  const repairReportPath = path.join(workdir, 'ai-beautified-page-repair-report.json');
  const repairStage = stageRecorder.start('audit-repair', {
    skill: AI_VISUAL_SKILL_NAME,
    inputArtifacts: [SOCIAL_CARD_BEAUTIFY_HTML, 'ai-beautified-generation-gate.json'],
    outputArtifact: 'ai-beautified-page-repair-report.json',
    metadata: { agentEntryPoint: 'social-card-ai-visual-repair', browserAuditVisible: false, pipelineAudit: true },
  });
  const repairCatalog = [aiInspectCatalogItem(), aiWriteCatalogItem()];
  const repairSystem = buildAiVisualSkillPrompt({
    workspaceRoot,
    requiredPageCount: context.requiredPageCount,
    styleBrief,
    skillBundle: skillRuntime.bundles.find((bundle) => bundle.skillName === AI_VISUAL_SKILL_NAME) || visualSkillBundle,
  });
  const repairAgentRuns = [];
  const auditPage = async (page, phase = 'before-repair') => {
    onProgress(`Pipeline 审计 P${page} 页面布局…`);
    const layout = await runAudit(auditScript, htmlPath, agentReportPath, workdir, { page });
    const compact = compactAiAudit(layout);
    lastAudit = compact;
    lastAuditPage = page;
    if (compact.valid) validAuditedPages.add(page); else validAuditedPages.delete(page);
    auditCount += 1;
    const issues = layoutRepairIssues(layout);
    const warnings = layoutAuditWarnings(layout);
    const repairInstructions = layoutRepairInstructions(layout);
    const pageLayout = (Array.isArray(layout?.pages) ? layout.pages : []).find((item) => Number(item?.page) === Number(page)) || {};
    const diagnosis = {
      summary: issues.join('；'),
      warnings,
      metrics: {
        utilization: pageLayout.utilization,
        target: pageLayout.target,
        bodyHeight: pageLayout.bodyHeight,
        usedHeight: pageLayout.usedHeight,
        topWhitespace: pageLayout.topWhitespace,
        bottomWhitespace: pageLayout.bottomWhitespace,
        verticalBalanceDelta: pageLayout.verticalBalanceDelta,
        overflowPixels: pageLayout.overflowPixels,
        clippedPixels: pageLayout.clippedPixels,
      },
      elements: (Array.isArray(pageLayout.styleSamples) ? pageLayout.styleSamples : []).slice(0, 16),
    };
    auditHistory.push({ attempt: auditCount, page, phase, issues, warnings, valid: compact.valid, pageCount: compact.pages.length });
    return { layout: compact, issues, warnings, diagnosis, requiredChanges: repairInstructions.map((item) => item.instruction), signature: JSON.stringify({ issues, pages: compact.pages.map((item) => ({ page: item.page, utilization: item.utilization, overflowPixels: item.overflowPixels, clippedPixels: item.clippedPixels, verticalBalanceDelta: item.verticalBalanceDelta })) }) };
  };
  let agent = { type: 'final', modelSteps: 0, toolCalls: 0, agentRunId: null };
  let controlledAuditRepairPassed = false;
  auditPhase = true;
  sourceRead = true;
  try {
    for (let page = 1; page <= context.requiredPageCount; page += 1) {
      let audit = await auditPage(page);
      let previousSignature = '';
      let pagePassed = audit.layout.valid === true;
      for (let repairAttempt = 1; !pagePassed && repairAttempt <= 2; repairAttempt += 1) {
        if (audit.signature === previousSignature) {
          modelValidationIssues.push(`P${page} 布局审计结果无变化，停止重复修复`);
          break;
        }
        previousSignature = audit.signature;
        const beforeHtml = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
        const beforeFingerprint = pageRepairFingerprint(beforeHtml, page);
        const pageHtml = pageHtmlFingerprint(beforeHtml, page);
        onProgress(`启动 P${page} 单页修复 Agent（第 ${repairAttempt} 轮）…`);
        const repairAgent = await runSocialCardAiVisualRepairAgent({
          gateway,
          store,
          batchId,
          candidateId,
          provider,
          registry,
          catalog: repairCatalog,
          agentSystem: repairSystem,
          repairRequest: {
            pageHtml: pageHtml.slice(0, 50_000),
            currentCss: currentAiCss(beforeHtml, page),
            pagePlan: aiVisualPlan.pages?.[page - 1] || null,
            diagnosis: audit.diagnosis,
            requiredChanges: audit.requiredChanges,
            outputContract: {
              mode: 'replace_page_with_styles',
              pageHtml: '完整目标页 section，保留该页事实与职责',
              scopedCss: '仅包含本页新增或覆盖的 CSS 规则，不包含 style 标签；程序会自动限制到当前页',
            },
          },
          page,
          toolHandlers,
          resolveArguments: resolveAiArguments,
          sanitizeToolResult: (toolResult, request) => sanitizeCapabilityResult(toolResult, request),
          toolContext: { batchId, candidateId, skillId: AI_VISUAL_SKILL_NAME, provider: providerId, workspaceRoot, allowedRoots: [workdir] },
          maxOutputTokens: providerMaxOutputTokens,
          onProgress,
        });
        agent = repairAgent;
        repairAgentRuns.push({ page, attempt: repairAttempt, agentRunId: repairAgent.agentRunId || null, type: repairAgent.type || '', modelSteps: repairAgent.modelSteps || 0, toolCalls: repairAgent.toolCalls || 0, wrotePage: repairAgent.writeCompleted === true });
        const afterHtml = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
        const changed = pageRepairFingerprint(afterHtml, page) !== beforeFingerprint;
        audit = await auditPage(page, 'after-repair');
        pagePassed = audit.layout.valid === true;
        if (pagePassed) break;
        if (!changed || repairAgent.writeCompleted !== true) {
          modelValidationIssues.push(`P${page} 单页修复未产生有效页面变化，停止重复修复`);
          break;
        }
        if (audit.signature === previousSignature) {
          modelValidationIssues.push(`P${page} 修复后审计问题未变化，停止重复修复`);
          break;
        }
      }
      if (!pagePassed) {
        validAuditedPages.delete(page);
        modelValidationIssues.push(`P${page} 布局审计未通过${audit.issues.length ? `：${audit.issues.join('；')}` : ''}`);
      }
    }
    controlledAuditRepairPassed = modelValidationIssues.length === 0 && validAuditedPages.size >= context.requiredPageCount;
    writeFile(repairReportPath, JSON.stringify({
      schemaVersion: 2,
      status: controlledAuditRepairPassed ? 'passed' : 'blocked',
      mode: 'pipeline-audit-single-page-agent',
      pageCount: context.requiredPageCount,
      auditedPages: [...validAuditedPages].sort((a, b) => a - b),
      auditCount,
      history: auditHistory,
      agentRuns: repairAgentRuns,
      issues: [...new Set(modelValidationIssues)],
      completedAt: new Date().toISOString(),
    }, null, 2));
    repairStage.finish({
      status: controlledAuditRepairPassed ? 'completed' : 'blocked',
      gate: controlledAuditRepairPassed ? 'passed' : 'blocked',
      detail: controlledAuditRepairPassed ? `已完成 ${validAuditedPages.size} 页单页审计修复` : `单页审计修复未收敛（${validAuditedPages.size}/${context.requiredPageCount}）`,
      outputArtifact: repairReportPath,
      metadata: { auditCount, agentRuns: repairAgentRuns.length, auditedPages: [...validAuditedPages].sort((a, b) => a - b) },
    });
  } catch (error) {
    repairStage.fail(error);
    throw error;
  }
  // 逐页审计修复结束后统一归一垂直居中，再进入最终整组布局审计与截图，
  // 确保无论模型/修复 Agent 是否遵循技能约定，交付页面都整体垂直居中。
  const centeredHtml = normalizeAiVisualCentering(fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '');
  writeFile(htmlPath, centeredHtml);
  onProgress('已统一所有页面内容整体垂直居中');
  // AV-2 的旧整组审计修复 Agent 保留在不可达分支中，便于兼容回放；AV-4 的实际路径由上面的 Pipeline 控制。
  if (false) {
  try {
    agent = await runConversationAgent({
    entryPoint: 'social-card-ai-visual', registry, catalog, messages: agentMessages, store,
    // 四份工作文件需要作为一次完整读取交给模型；28KB 会截断 card-plan.json，
    // 促使模型反复读取并在尚未写入 HTML 前耗尽工具结果预算。
    budget: { maxModelSteps: 24, maxToolCalls: 24, maxParallelToolCalls: 1, maxToolResultChars: 80_000, maxTotalToolResultChars: 320_000, maxHistoryChars: 300_000, timeoutMs: 300_000 },
    toolContext: { batchId, candidateId, skillId: AI_VISUAL_SKILL_NAME, provider: providerId, workspaceRoot, allowedRoots: [workdir], allowedCapabilities, toolHandlers },
    resolveArguments: resolveAiArguments,
    sanitizeToolResult: (toolResult, request) => sanitizeCapabilityResult(toolResult, request),
    onEvent: (event) => {
      if (event?.type === 'tool.completed' && event?.capability === SOCIAL_CARD_PROJECT_READ_CAPABILITY) sourceRead = true;
      if (event?.type === 'tool.completed' && event?.capability === 'filesystem.project.write') onProgress('AI 已写入视觉 HTML…');
      if (event?.type === 'tool.completed' && event?.capability === SOCIAL_CARD_BROWSER_AUDIT_CAPABILITY) onProgress('当前页布局审计完成…');
    },
    modelStep: async ({ messages, step, signal }) => {
      const currentPageCount = htmlPageCount(fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '');
      if (auditAfterRepairPage) {
        const page = auditAfterRepairPage;
        auditAfterRepairPage = null;
        const revision = auditCount + 1;
        return validateAgentEnvelope({ type: 'tool_requests', assistant_note: `修复后审计 P${page}`, requests: [{ requestId: `tr_audit_${revision}`, capability: SOCIAL_CARD_BROWSER_AUDIT_CAPABILITY, arguments: { resourceId: 'project:current', path: SOCIAL_CARD_BEAUTIFY_HTML, page, revision }, reason: `复核刚刚修复的 P${page}` }] }, { maxRequests: 1 });
      }
      if (!auditPhase && currentPageCount >= context.requiredPageCount) {
        auditPhase = true;
        const page = 1;
        const revision = auditCount + 1;
        return validateAgentEnvelope({ type: 'tool_requests', assistant_note: `整组 ${context.requiredPageCount} 页已生成，开始逐页审计 P${page}`, requests: [{ requestId: `tr_audit_${revision}`, capability: SOCIAL_CARD_BROWSER_AUDIT_CAPABILITY, arguments: { resourceId: 'project:current', path: SOCIAL_CARD_BEAUTIFY_HTML, page, revision }, reason: `整组页面生成完成，开始审计 P${page}` }] }, { maxRequests: 1 });
      }
      let modelMessages = messages;
      const feedback = [];
      if (!auditPhase && currentPageCount < context.requiredPageCount) {
        feedback.push(`当前仍处于页面生成阶段，已生成 ${currentPageCount}/${context.requiredPageCount} 页。请继续使用 filesystem.project.write 的 append_body，只追加下一页 P${currentPageCount + 1}；不要调用浏览器审计、replace_pages 或 final。`);
      }
      const lastToolMessage = [...messages].reverse().find((message) => message.role === 'tool');
      if (lastToolMessage && /相同工具与参数在本轮中不得重复调用|已达到工具调用预算/.test(String(lastToolMessage.content || ''))) {
        return validateAgentEnvelope({ type: 'final', assistantReply: '本页修复请求未产生新的页面变化，停止重复修复并保留当前审计结果。', htmlPath: SOCIAL_CARD_BEAUTIFY_HTML }, { maxRequests: 1 });
      }
      if (lastAudit && !lastAudit.valid) {
        const auditFeedback = layoutRepairIssues(lastAudit).join('；') || '布局审计未通过';
        const repairInstructions = layoutRepairInstructions(lastAudit).map((item) => `P${item.page} ${item.issue}：${item.instruction}`).join('\n');
        feedback.push(`上一轮 P${lastAuditPage || '?'} 审计未通过：${auditFeedback}。只修复 P${lastAuditPage || '?'}，不要修改其他页面。必须按以下修复指令调整实际 HTML：\n${repairInstructions}\n使用 filesystem.project.write 的 replace_pages，pages 只能提交一个页面；修复后等待程序自动审计该页。不要输出完整 HTML 到 JSON。`);
      }
      if (feedback.length) modelMessages = [...messages, { role: 'user', protected: true, content: feedback.join('\n') }];
      let result = await gateway.complete({
        provider, purpose: 'social-card-beautify-agent', batchId, candidateId, thinking: false,
        temperature: step ? 0.35 : 0.25, maxOutputTokens: Math.min(7000, providerMaxOutputTokens),
        adaptiveOutput: true, jsonMode: true, signal, messages: modelMessages,
      });
      const parsed = await parseModelJsonWithRepair(result, {
        store, label: 'AI 视觉 Agent',
        repair: async (error) => {
          onProgress('AI 输出 JSON 结构异常，反馈模型自动修正…');
          result = await gateway.complete({ provider, purpose: 'social-card-beautify-agent', batchId, candidateId, thinking: false, temperature: 0.15,
            maxOutputTokens: Math.min(7000, providerMaxOutputTokens), adaptiveOutput: true, jsonMode: true, signal,
            messages: [...messages, { role: 'user', protected: true, content: `上一条响应 JSON 不完整（${error.code || 'JSON_FORMAT_ERROR'}）。只返回一个完整、简短、合法 JSON 工具请求；不要返回 HTML 正文，不要解释。` }] });
          return result;
        },
      });
      lastModelResult = result;
      if (!sourceRead) return validateAgentEnvelope({ type: 'tool_requests', assistant_note: '先读取四份候选工作文件', requests: [{ requestId: `tr_read_${step + 1}`, capability: SOCIAL_CARD_PROJECT_READ_CAPABILITY, arguments: { resourceId: 'project:current', options: { includePaths: workspaceFiles, maxFiles: workspaceFiles.length, maxCharsPerFile: 100000, maxTotalChars: 140000 } }, reason: '读取事实、故事板、主题 SPEC 和 Layout Guide' }] }, { maxRequests: 1 });
      if (parsed?.type === 'final') {
        const generatedPageCount = htmlPageCount(fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '');
        if (generatedPageCount < context.requiredPageCount) {
          return validateAgentEnvelope({ type: 'tool_requests', assistant_note: `页面尚未生成完整（${generatedPageCount}/${context.requiredPageCount}），继续生成下一页`, requests: [{ requestId: `tr_generation_status_${step + 1}`, capability: SOCIAL_CARD_PROJECT_READ_CAPABILITY, arguments: { resourceId: 'project:current', options: { includePaths: ['card-plan.json'], maxFiles: 1, maxCharsPerFile: 100000, maxTotalChars: 100000 } }, reason: '提醒 Agent 按故事板继续生成缺失页面' }] }, { maxRequests: 1 });
        }
        if (!auditPhase) auditPhase = true;
        const nextPage = Array.from({ length: context.requiredPageCount }, (_, index) => index + 1).find((page) => !validAuditedPages.has(page));
        if (!nextPage && lastAudit?.valid === true && writeCount > 0) return validateAgentEnvelope(parsed, { maxRequests: 1 });
        const revision = auditCount + 1;
        return validateAgentEnvelope({ type: 'tool_requests', assistant_note: `先审计 P${nextPage || 1}`, requests: [{ requestId: `tr_audit_${revision}`, capability: SOCIAL_CARD_BROWSER_AUDIT_CAPABILITY, arguments: { resourceId: 'project:current', path: SOCIAL_CARD_BEAUTIFY_HTML, page: nextPage || 1, revision }, reason: `在无头浏览器中审计 P${nextPage || 1}` }] }, { maxRequests: 1 });
      }
      if (parsed?.type === 'tool_requests' && Array.isArray(parsed.requests) && parsed.requests.length) {
        const request = parsed.requests[0];
        if (!auditPhase && request.capability === SOCIAL_CARD_BROWSER_AUDIT_CAPABILITY) {
          return validateAgentEnvelope({ type: 'tool_requests', assistant_note: `页面尚未生成完整（${currentPageCount}/${context.requiredPageCount}），先继续追加下一页`, requests: [{ requestId: `tr_generation_status_${step + 1}`, capability: SOCIAL_CARD_PROJECT_READ_CAPABILITY, arguments: { resourceId: 'project:current', options: { includePaths: ['card-plan.json'], maxFiles: 1, maxCharsPerFile: 100000, maxTotalChars: 100000 } }, reason: '生成阶段不执行布局审计' }] }, { maxRequests: 1 });
        }
        if (request.capability === SOCIAL_CARD_BROWSER_AUDIT_CAPABILITY) {
          request.arguments = { ...(request.arguments || {}), page: Number(request.arguments?.page) || lastAuditPage || 1 };
          request.arguments = { ...(request.arguments || {}), resourceId: 'project:current', path: SOCIAL_CARD_BEAUTIFY_HTML, revision: auditCount + 1 };
        }
        return validateAgentEnvelope({ ...parsed, requests: [request] }, { maxRequests: 1 });
      }
      return validateAgentEnvelope({ type: 'tool_requests', assistant_note: '请使用工具写入完整 HTML，不要把 HTML 放在回答中', requests: [{ requestId: `tr_continue_${step + 1}`, capability: 'filesystem.project.write', arguments: { resourceId: 'project:current', path: SOCIAL_CARD_BEAUTIFY_HTML, mode: 'append_body', content: '' }, reason: '继续通过文件工具生成页面' }] }, { maxRequests: 1 });
    },
    });
  } catch (error) {
    repairStage.fail(error);
    throw error;
  }

  }

  const generatedHtml = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
  const checked = validateBeautifiedHtml(originalHtml, generatedHtml, { pageCount: context.requiredPageCount, validateProtectedTokens: false });
  if (agent.type !== 'final') modelValidationIssues.push(agent.type === 'limit' ? 'AI 视觉 Agent 达到模型步骤预算（单页审计修复未能收敛）' : 'AI 视觉 Agent 未返回最终确认');
  if (!lastAudit?.valid) modelValidationIssues.push(`完整 HTML 未通过浏览器布局审计${lastAudit?.pages?.length ? `：${lastAudit.pages.flatMap((page) => (page.issues || []).map((issue) => `P${page.page} ${issue}`)).join('；')}` : ''}`);
  if (!hasMaterialVisualChange(aiHtmlScaffold(), generatedHtml)) modelValidationIssues.push('AI 未生成实质视觉内容');
  if (!checked.valid) modelValidationIssues.push(...checked.issues);
  const auditRepairPassed = controlledAuditRepairPassed;
  writeFile(repairReportPath, JSON.stringify({
    schemaVersion: 1,
    status: auditRepairPassed ? 'passed' : 'blocked',
    pageCount: context.requiredPageCount,
    auditedPages: [...validAuditedPages].sort((a, b) => a - b),
    auditCount,
    history: auditHistory,
    issues: modelValidationIssues.filter((issue) => /布局|P\d+/.test(issue)),
    completedAt: new Date().toISOString(),
  }, null, 2));
  repairStage.finish({
    status: auditRepairPassed ? 'completed' : 'blocked',
    gate: auditRepairPassed ? 'passed' : 'blocked',
    detail: auditRepairPassed ? `已完成 ${validAuditedPages.size} 页兼容审计修复` : `当前兼容 Agent 会话未完成全部页面审计修复（${validAuditedPages.size}/${context.requiredPageCount}）`,
    outputArtifact: repairReportPath,
    metadata: { auditCount, auditedPages: [...validAuditedPages].sort((a, b) => a - b) },
  });
  if (modelValidationIssues.length) {
    const finalIssues = [...new Set(modelValidationIssues)];
    onProgress(`AI 视觉生成未通过校验（${finalIssues.join('；')}）`);
    fs.rmSync(outputDir, { recursive: true, force: true });
    throw new Error(`AI 美化未通过校验：${finalIssues.join('；')}。已保留 AI HTML 和诊断报告，未生成程序化回退页面。`);
  }
  onProgress('执行最终整组布局审计…');
  const finalAuditStage = stageRecorder.start('final-audit', {
    skill: 'fixed-program',
    inputArtifacts: [SOCIAL_CARD_BEAUTIFY_HTML, repairReportPath],
    outputArtifact: 'ai-beautified-layout-report.json',
  });
  let layout;
  try {
    layout = await runAudit(auditScript, htmlPath, reportPath, workdir);
    finalAuditStage.finish({
      status: layout.valid ? 'completed' : 'blocked',
      gate: layout.valid ? 'passed' : 'blocked',
      detail: layout.valid ? '最终整组布局审计通过' : '最终整组布局审计仍需人工处理',
      metadata: { pageCount: layout.pageCount || 0, valid: layout.valid === true },
    });
  } catch (error) {
    finalAuditStage.fail(error);
    throw error;
  }
  const finalAuditPassed = layout.valid === true
    && Number(layout.pageCount) === context.requiredPageCount
    && Array.isArray(layout.pages)
    && layout.pages.length === context.requiredPageCount
    && layout.pages.every((page) => page?.valid === true);
  const finalAuditIssues = finalAuditPassed
    ? []
    : [...new Set([
      ...(Array.isArray(layout.pages) ? layout.pages.flatMap((page) => (page.issues || []).map((issue) => `P${page.page} ${issue}`)) : []),
      ...(Number(layout.pageCount) !== context.requiredPageCount ? [`页面数量不一致（应为 ${context.requiredPageCount}，实际 ${layout.pageCount || 0}）`] : []),
      ...(layout.valid !== true ? ['整组布局审计未通过'] : []),
    ])];
  const finalAuditWarnings = layoutAuditWarnings(layout);
  onProgress('检查 AI 图文内容块覆盖与显式事实一致性…');
  const contentAuditStage = stageRecorder.start('content-audit', {
    skill: 'fixed-program',
    inputArtifacts: [SOCIAL_CARD_BEAUTIFY_HTML, 'ai-visual-card-plan.json', factFile],
    outputArtifact: 'ai-visual-content-audit.json',
  });
  const factText = fs.readFileSync(path.join(workdir, factFile), 'utf8');
  const contentAudit = auditAiVisualContent(fs.readFileSync(htmlPath, 'utf8'), aiVisualPlan, factText);
  const contentAuditPath = path.join(workdir, 'ai-visual-content-audit.json');
  writeFile(contentAuditPath, JSON.stringify(contentAudit, null, 2));
  contentAuditStage.finish({
    status: contentAudit.valid ? 'completed' : 'blocked',
    gate: contentAudit.valid ? 'passed' : 'blocked',
    detail: contentAudit.valid
      ? `内容覆盖检查通过${contentAudit.warnings.length ? `，${contentAudit.warnings.length} 项提示` : ''}`
      : `内容覆盖检查未通过：${contentAudit.issues.join('；')}`,
    metadata: { pageCount: contentAudit.pageCount, issueCount: contentAudit.issues.length, warningCount: contentAudit.warnings.length },
  });
  const report = {
    schemaVersion: 5, status: finalAuditPassed ? 'pending-screenshots' : 'layout-review-required', source: 'storyboard-theme-ai-visual', renderMode: 'full-html-agent', generatedAt: new Date().toISOString(),
    originalHtml: null, sourceStoryboard: 'ai-visual-card-plan.json', originalStoryboard: 'card-plan.json', beautifiedHtml: SOCIAL_CARD_BEAUTIFY_HTML, pageCount: checked.pageCount, storyboardPageCount: context.storyboardPageCount,
    theme: { id: context.theme.id, label: context.theme.label, version: context.theme.version, templatePack: context.theme.templatePack }, styleBrief: String(styleBrief || '').slice(0, 800),
    changedByModel: true,
    modelSteps: (generationAgent?.modelSteps || 0) + (agent?.modelSteps || 0),
    toolCalls: (generationAgent?.toolCalls || 0) + (agent?.toolCalls || 0),
    agentRuns: {
      generation: { agentRunId: generationAgent?.agentRunId || null, modelSteps: generationAgent?.modelSteps || 0, toolCalls: generationAgent?.toolCalls || 0, pageCount: generationAgent?.pageCount || 0 },
      auditRepair: { agentRunId: agent?.agentRunId || null, modelSteps: agent?.modelSteps || 0, toolCalls: agent?.toolCalls || 0 },
    },
    layoutRepairRetries: auditHistory.length, layoutRepairHistory: auditHistory, modelValidationIssues: [], fallbackApplied: false, fallbackReason: '', layout,
    finalAudit: { status: finalAuditPassed ? 'passed' : 'blocked', valid: finalAuditPassed, issues: finalAuditIssues, warnings: finalAuditWarnings, checkedAt: new Date().toISOString() },
    contentAudit: { status: contentAudit.status, valid: contentAudit.valid, issues: contentAudit.issues, warnings: contentAudit.warnings, path: path.basename(contentAuditPath) },
    screenshots: { status: 'not-run', expectedPageCount: context.requiredPageCount, pageCount: 0, attempts: [] },
    deliveryGate: { status: 'pending', registered: false },
    model: { provider: lastModelResult?.provider || provider || '', model: lastModelResult?.model || resolvedModel, callId: lastModelResult?.callId || null },
    skillManifest: path.basename(skillManifest.path), stageExecutions: path.basename(stageRecorder.path),
  };
  writeFile(path.join(workdir, SOCIAL_CARD_BEAUTIFY_REPORT), JSON.stringify(report, null, 2));

  // 最终整组布局审计是硬门禁。失败时保留 HTML、布局报告和阶段记录，
  // 但必须跳过截图和正式交付，避免“审计失败却仍然有可下载 PNG”。
  const screenshotsStage = stageRecorder.start('screenshots', {
    skill: 'html-pages-to-images',
    inputArtifacts: [SOCIAL_CARD_BEAUTIFY_HTML, reportPath],
    outputArtifact: SOCIAL_CARD_BEAUTIFY_OUTPUT,
  });
  if (!finalAuditPassed || !contentAudit.valid) {
    fs.rmSync(outputDir, { recursive: true, force: true });
    screenshotsStage.finish({
      status: 'blocked',
      gate: 'blocked',
      detail: '最终布局或内容覆盖门禁未通过，跳过 PNG 截图',
      metadata: { skipped: true, finalAuditIssues, contentAuditIssues: contentAudit.issues },
    });
    const deliveryStage = stageRecorder.start('delivery-gate', {
      skill: 'fixed-program',
      inputArtifacts: [SOCIAL_CARD_BEAUTIFY_HTML, reportPath, SOCIAL_CARD_BEAUTIFY_REPORT],
      outputArtifact: SOCIAL_CARD_BEAUTIFY_REPORT,
    });
    report.status = finalAuditPassed ? 'content-review-required' : 'layout-review-required';
    report.screenshots = { status: 'blocked', expectedPageCount: context.requiredPageCount, pageCount: 0, attempts: [], reason: finalAuditPassed ? 'content-audit-blocked' : 'final-audit-blocked' };
    report.deliveryGate = { status: 'blocked', registered: false, reason: finalAuditPassed ? 'content-audit-blocked' : 'final-audit-blocked' };
    writeFile(path.join(workdir, SOCIAL_CARD_BEAUTIFY_REPORT), JSON.stringify(report, null, 2));
    deliveryStage.finish({
      status: 'blocked',
      gate: 'blocked',
      detail: '最终布局或内容覆盖门禁未通过，未登记 HTML、PNG 为正式交付',
      metadata: { registered: false, finalAuditIssues, contentAuditIssues: contentAudit.issues },
    });
    const blockedIssues = [...finalAuditIssues, ...contentAudit.issues];
    throw new Error(`AI 美化未通过最终交付前门禁：${blockedIssues.join('；') || '布局或内容覆盖未通过'}。已保留 AI HTML 和诊断报告，未生成 PNG。`);
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.rmSync(agentReportPath, { force: true });
  onProgress('根据 AI 视觉 HTML 生成逐页 PNG…');
  let imagePaths = [];
  let screenshotCheck = { valid: false, expectedPageCount: context.requiredPageCount, pageCount: 0, images: [], issues: [] };
  const screenshotAttempts = [];
  let screenshotFailure = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      if (attempt > 1) {
        fs.rmSync(outputDir, { recursive: true, force: true });
        fs.mkdirSync(outputDir, { recursive: true });
        onProgress(`截图失败，重试截图阶段（第 ${attempt} 次；不重新调用 AI）…`);
      }
      imagePaths = await renderBeautifiedImages({ workspaceRoot, htmlPath, outputDir });
      screenshotCheck = validateAiVisualScreenshotSet(imagePaths, context.requiredPageCount);
      screenshotAttempts.push({ attempt, status: screenshotCheck.valid ? 'passed' : 'blocked', pageCount: screenshotCheck.pageCount, issues: screenshotCheck.issues });
      if (screenshotCheck.valid) {
        screenshotFailure = null;
        break;
      }
      throw new Error(screenshotCheck.issues.join('；'));
    } catch (error) {
      screenshotFailure = error;
      if (attempt === 2) break;
    }
  }
  if (screenshotFailure) {
    fs.rmSync(outputDir, { recursive: true, force: true });
    screenshotsStage.fail(screenshotFailure, { detail: `PNG 截图失败（已重试 ${screenshotAttempts.length} 次）：${screenshotFailure.message}` });
    report.status = 'screenshots-failed';
    report.screenshots = { status: 'blocked', expectedPageCount: context.requiredPageCount, pageCount: screenshotCheck.pageCount, attempts: screenshotAttempts, issues: screenshotCheck.issues.length ? screenshotCheck.issues : [screenshotFailure.message] };
    report.deliveryGate = { status: 'blocked', registered: false, reason: 'screenshots-failed' };
    writeFile(path.join(workdir, SOCIAL_CARD_BEAUTIFY_REPORT), JSON.stringify(report, null, 2));
    const deliveryStage = stageRecorder.start('delivery-gate', {
      skill: 'fixed-program',
      inputArtifacts: [SOCIAL_CARD_BEAUTIFY_HTML, reportPath, SOCIAL_CARD_BEAUTIFY_REPORT],
      outputArtifact: SOCIAL_CARD_BEAUTIFY_REPORT,
    });
    deliveryStage.finish({ status: 'blocked', gate: 'blocked', detail: 'PNG 截图失败，未登记正式交付', metadata: { registered: false } });
    throw new Error(`AI 美化截图阶段失败：${screenshotFailure.message}。已重试截图，未重新调用 AI，未登记正式交付。`);
  }
  screenshotsStage.finish({ outputArtifact: SOCIAL_CARD_BEAUTIFY_OUTPUT, metadata: { imageCount: imagePaths.length, attempts: screenshotAttempts } });
  report.screenshots = { status: 'passed', expectedPageCount: context.requiredPageCount, pageCount: imagePaths.length, attempts: screenshotAttempts };
  writeFile(path.join(workdir, SOCIAL_CARD_BEAUTIFY_REPORT), JSON.stringify(report, null, 2));

  const deliveryStage = stageRecorder.start('delivery-gate', {
    skill: 'fixed-program',
    inputArtifacts: [SOCIAL_CARD_BEAUTIFY_HTML, 'copy.txt', reportPath, SOCIAL_CARD_BEAUTIFY_REPORT, SOCIAL_CARD_BEAUTIFY_OUTPUT],
    outputArtifact: SOCIAL_CARD_BEAUTIFY_DELIVERY_GATE,
  });
  const deliveryGatePath = path.join(workdir, SOCIAL_CARD_BEAUTIFY_DELIVERY_GATE);
  const deliveryHtmlCheck = validateBeautifiedHtml(originalHtml, fs.readFileSync(htmlPath, 'utf8'), { pageCount: context.requiredPageCount, validateProtectedTokens: false });
  const deliveryCopyCheck = validateSocialCardCopy(fs.readFileSync(copyPath, 'utf8'));
  const deliveryGate = {
    schemaVersion: 1,
    status: deliveryHtmlCheck.valid && finalAuditPassed && contentAudit.valid && screenshotCheck.valid && deliveryCopyCheck.valid ? 'passed' : 'blocked',
    registered: false,
    checkedAt: new Date().toISOString(),
    checks: {
      html: { valid: deliveryHtmlCheck.valid, pageCount: deliveryHtmlCheck.pageCount, issues: deliveryHtmlCheck.issues },
      copy: deliveryCopyCheck,
      finalAudit: { valid: finalAuditPassed, pageCount: layout.pageCount, issues: finalAuditIssues },
      contentAudit: { valid: contentAudit.valid, status: contentAudit.status, issues: contentAudit.issues, warnings: contentAudit.warnings },
      screenshots: screenshotCheck,
    },
    artifacts: { html: SOCIAL_CARD_BEAUTIFY_HTML, copy: 'copy.txt', layoutReport: path.basename(reportPath), contentAudit: path.basename(contentAuditPath), screenshots: SOCIAL_CARD_BEAUTIFY_OUTPUT },
  };
  writeFile(deliveryGatePath, JSON.stringify(deliveryGate, null, 2));
  if (deliveryGate.status !== 'passed') {
    fs.rmSync(outputDir, { recursive: true, force: true });
    report.status = 'delivery-blocked';
    report.deliveryGate = { status: 'blocked', registered: false, path: path.basename(deliveryGatePath) };
    writeFile(path.join(workdir, SOCIAL_CARD_BEAUTIFY_REPORT), JSON.stringify(report, null, 2));
    deliveryStage.finish({ status: 'blocked', gate: 'blocked', detail: '交付一致性门禁未通过，未登记正式产物', metadata: { registered: false } });
    throw new Error(`AI 美化交付门禁未通过：${[...deliveryHtmlCheck.issues, ...deliveryCopyCheck.issues, ...finalAuditIssues, ...contentAudit.issues, ...screenshotCheck.issues].join('；')}`);
  }
  deliveryGate.registered = true;
  deliveryGate.checkedAt = new Date().toISOString();
  writeFile(deliveryGatePath, JSON.stringify(deliveryGate, null, 2));
  report.status = 'passed';
  report.deliveryGate = { status: 'passed', registered: true, path: path.basename(deliveryGatePath) };
  writeFile(path.join(workdir, SOCIAL_CARD_BEAUTIFY_REPORT), JSON.stringify(report, null, 2));
  store.upsertArtifact({ batchId, candidateId, track: 'social_cards', kind: 'AI 视觉 HTML', name: SOCIAL_CARD_BEAUTIFY_HTML, path: htmlPath, size: fs.statSync(htmlPath).size, modifiedAt: fs.statSync(htmlPath).mtime.toISOString() });
  for (const artifactPath of [skillManifest.path, path.join(workdir, 'ai-beautified-generation-gate.json'), repairReportPath, stageRecorder.path, deliveryGatePath]) {
    if (!fs.existsSync(artifactPath)) continue;
    store.upsertArtifact({ batchId, candidateId, track: 'social_cards', kind: 'AI 视觉运行记录', name: path.basename(artifactPath), path: artifactPath, size: fs.statSync(artifactPath).size, modifiedAt: fs.statSync(artifactPath).mtime.toISOString() });
  }
  store.upsertArtifact({ batchId, candidateId, track: 'social_cards', kind: 'AI 视觉布局审计', name: 'ai-beautified-layout-report.json', path: reportPath, size: fs.statSync(reportPath).size, modifiedAt: fs.statSync(reportPath).mtime.toISOString() });
  for (const imagePath of imagePaths) store.upsertArtifact({ batchId, candidateId, track: 'social_cards', kind: 'AI 视觉 PNG', name: path.join(SOCIAL_CARD_BEAUTIFY_OUTPUT, path.basename(imagePath)), path: imagePath, size: fs.statSync(imagePath).size, modifiedAt: fs.statSync(imagePath).mtime.toISOString() });
  deliveryStage.finish({ detail: 'AI 视觉 HTML、发布文案、布局报告、PNG 和交付门禁已登记', metadata: { imageCount: imagePaths.length, deliveryGate: path.basename(deliveryGatePath), copy: 'copy.txt', registered: true } });
  return { html: SOCIAL_CARD_BEAUTIFY_HTML, outputDir: SOCIAL_CARD_BEAUTIFY_OUTPUT, images: imagePaths.map((item) => path.basename(item)), layout: report.layout, status: report.status };
}
