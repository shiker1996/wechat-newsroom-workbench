import { compileSocialTheme, socialThemeDefinition } from '../../../shared/themes/social-theme-compiler.mjs';
import { NEON_V1_CSS, renderNeonStoryboardSections } from '../../../shared/rendering/templates/social/neon-v1.mjs';
import { BRUTALIST_V1_CSS, renderBrutalistStoryboardSections } from '../../../shared/rendering/templates/social/brutalist-v1.mjs';
import { EDITORIAL_V1_CSS, renderEditorialStoryboardSections } from '../../../shared/rendering/templates/social/editorial-v1.mjs';
import { CLEAN_V1_CSS, renderCleanStoryboardSections } from '../../../shared/rendering/templates/social/clean-v1.mjs';
import { renderStoryboardSections } from '../../../shared/rendering/storyboard-page-renderer.mjs';
import { renderStoryboardDocument } from '../../../shared/rendering/storyboard-document-renderer.mjs';
import { resolveSocialCardTemplateContext } from '../../../shared/rendering/social-card-template-resolver.mjs';

function extractCardPlanJsonText(value) {
  const raw = String(value || '').trim();
  const opening = raw.match(/^```(?:json)?[ \t]*\r?\n?/i);
  let json = opening ? raw.slice(opening[0].length) : raw;
  if (opening) json = json.replace(/\r?\n```[ \t]*$/, '').trim();
  const start = Math.min(json.includes('{') ? json.indexOf('{') : Infinity, json.includes('[') ? json.indexOf('[') : Infinity);
  const end = Math.max(json.lastIndexOf('}'), json.lastIndexOf(']'));
  if (!Number.isFinite(start) || end < 0) throw new Error('布局修复未返回可解析的 card_plan JSON');
  return json.slice(start, end + 1);
}

function normalizeCardPlanJsonText(json) {
  let normalized = '';
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < json.length; index += 1) {
    const char = json[index];
    if (quoted) {
      if (escaped) { normalized += char; escaped = false; continue; }
      if (char === '\\') { normalized += char; escaped = true; continue; }
      if (char === '"') {
        let next = index + 1;
        while (/\s/.test(json[next] || '')) next += 1;
        if (json[next] === ',' || json[next] === '}' || json[next] === ']' || json[next] === ':' || next >= json.length) { normalized += char; quoted = false; }
        else normalized += '\\"';
        continue;
      }
      if (char === '\r') { if (json[index + 1] === '\n') index += 1; normalized += '\\n'; continue; }
      if (char === '\n') { normalized += '\\n'; continue; }
      if (char === '\t') { normalized += '\\t'; continue; }
      if (char.charCodeAt(0) < 0x20) { normalized += `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`; continue; }
      normalized += char;
      continue;
    }
    if (char === '"') quoted = true;
    normalized += char;
  }
  let withoutTrailingCommas = '';
  quoted = false;
  escaped = false;
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (quoted) {
      withoutTrailingCommas += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; withoutTrailingCommas += char; continue; }
    if (char === ',') {
      let next = index + 1;
      while (/\s/.test(normalized[next] || '')) next += 1;
      if (normalized[next] === '}' || normalized[next] === ']') continue;
    }
    withoutTrailingCommas += char;
  }
  return withoutTrailingCommas;
}

export function cleanCardPlanJson(value) {
  const json = extractCardPlanJsonText(value);
  try { return JSON.parse(json); }
  catch (firstError) {
    try { return JSON.parse(normalizeCardPlanJsonText(json)); }
    catch { throw firstError; }
  }
}

export function renderStoryboardHtml({ topic, repository, pages, visualStyle = 'ice-blue', themeDefinition: providedTheme = null, layoutStyle = 'auto', compositionMode = 'template', compositionSeed = '', forceSafeComposition = false, relaxedDensityPages = false, expandedDensityPages = false, fitContentPages = false, contentType = 'repository', sourceLabel = '', disclosure = '', channelMode = 'wechat', coverTitleLines = null, templatePackOverride = '', templateCssOverride = '' }) {
  const themeDefinition = providedTheme || socialThemeDefinition(visualStyle, { fallback: false });
  if (!themeDefinition) throw new Error(`未知图文视觉主题：${visualStyle}`);
  const compiledTheme = compileSocialTheme(themeDefinition);
  const customTemplatePack = templatePackOverride && typeof templatePackOverride === 'object' ? templatePackOverride : null;
  const templatePackId = typeof templatePackOverride === 'string' ? templatePackOverride : '';
  const templateContext = resolveSocialCardTemplateContext({ themeDefinition, channelMode, contentType, templatePackId, templatePack: customTemplatePack });
  let sections = templateContext.pack.id === 'neon-v1'
    ? renderNeonStoryboardSections({ topic, repository, pages, compiledTheme, compositionMode, compositionSeed, forceSafeComposition, relaxedDensityPages, expandedDensityPages, fitContentPages, contentType, sourceLabel, disclosure, channelMode, coverTitleLines })
    : templateContext.pack.id === 'brutalist-v1'
      ? renderBrutalistStoryboardSections({ topic, repository, pages, compositionMode, compositionSeed, forceSafeComposition, relaxedDensityPages, expandedDensityPages, fitContentPages, contentType, sourceLabel, disclosure, channelMode, coverTitleLines })
      : templateContext.pack.id === 'editorial-v1'
        ? renderEditorialStoryboardSections({ topic, repository, pages, compositionMode, compositionSeed, forceSafeComposition, relaxedDensityPages, expandedDensityPages, fitContentPages, contentType, sourceLabel, disclosure, channelMode, coverTitleLines })
        : templateContext.pack.id === 'clean-v1'
          ? renderCleanStoryboardSections({ topic, repository, pages, compiledTheme, compositionMode, compositionSeed, forceSafeComposition, relaxedDensityPages, expandedDensityPages, fitContentPages, contentType, sourceLabel, disclosure, channelMode, coverTitleLines })
          : renderStoryboardSections({ topic, repository, pages, compiledTheme, layoutStyle, compositionMode, compositionSeed, forceSafeComposition, relaxedDensityPages, expandedDensityPages, fitContentPages, contentType, sourceLabel, disclosure, channelMode, coverTitleLines, templatePackId, templatePack: customTemplatePack });
  if (fitContentPages) {
    const indexes = fitContentPages === true
      ? new Set((Array.isArray(pages) ? pages : []).map((page, index) => page?.kind === 'cover' || page?.kind === 'ending' ? -1 : index).filter((index) => index >= 0))
      : new Set(Array.isArray(fitContentPages) || fitContentPages instanceof Set ? [...fitContentPages].map(Number).filter((index) => index >= 0) : []);
    if (indexes.size) {
      let pageIndex = 0;
      sections = sections.replace(/<section class="page /g, (match) => { const current = pageIndex; pageIndex += 1; return indexes.has(current) ? '<section class="page fit-content-stack ' : match; });
    }
  }
  return renderStoryboardDocument({ topic, contentType, channelMode, compiledTheme, sections,
    templatePackId: templateContext.pack.id, templateVersion: templateContext.pack.version, templateSource: templateContext.source,
    templateCss: templateCssOverride || templateContext.pack.css || (templateContext.pack.id === 'neon-v1' ? NEON_V1_CSS : templateContext.pack.id === 'brutalist-v1' ? BRUTALIST_V1_CSS : templateContext.pack.id === 'editorial-v1' ? EDITORIAL_V1_CSS : templateContext.pack.id === 'clean-v1' ? CLEAN_V1_CSS : '') });
}
