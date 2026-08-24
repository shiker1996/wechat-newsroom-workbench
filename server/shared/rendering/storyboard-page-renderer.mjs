import { cardPageDensity, deterministicCoverTitleLines, listBlockValues, normalizeCoverTitleLines } from './social-card-plan.mjs';
import { resolveCardLayoutDecision } from './social-card-layout.mjs';
import { inferCardPageRole, SOCIAL_CARD_PAGE_ROLES } from './social-card-role.mjs';
import { resolveCardCompositionDecision } from './social-card-composition.mjs';
import { continuationBadge, escapeHtml, renderStoryboardBlock, renderTechnicalText } from './storyboard-html-content.mjs';
import { resolveSocialCardTemplate } from './social-card-template-resolver.mjs';

const PAGE_LABELS = Object.freeze({
  repository: { cover: 'TOOL RADAR', problem: 'WHY IT MATTERS', capability: 'CORE FEATURES', quickstart: 'QUICK START', scenario: 'USE CASES', limitation: 'BEFORE YOU USE', ending: 'SAVE FOR LATER' },
  event: { cover: 'BREAKING FOCUS', 'what-happened': 'WHAT HAPPENED', timeline: 'TIMELINE', evidence: 'EVIDENCE CHECK', positions: 'WHO SAID WHAT', impact: 'WHY IT MATTERS', risk: 'FACT BOUNDARY', ending: 'KEEP WATCHING' },
  custom: { cover: 'NEW NOTE', highlight: 'KEY POINTS', step: 'HOW TO', item: 'THE LIST', boundary: 'FACT BOUNDARY', ending: 'SAVE FOR LATER' },
});

function selectedForPage(selection, index) {
  return selection === true
    || (Array.isArray(selection) && selection.includes(index))
    || (selection instanceof Set && selection.has(index));
}

function trackUsedComposition(usedByRole, role, compositionId) {
  if (!role || !compositionId) return;
  if (!usedByRole.has(role)) usedByRole.set(role, []);
  usedByRole.get(role).push(compositionId);
}

function coverTitleMarkup(title, { topic, compiledTheme, coverTitleLines }) {
  const value = String(title || topic);
  if (compiledTheme.recipes.coverTitle !== 'highlight-block') return escapeHtml(value);
  let lines = normalizeCoverTitleLines(value, coverTitleLines);
  if (!lines) lines = deterministicCoverTitleLines(value);
  return lines.map((line) => `<span class="cover-title-line">${escapeHtml(line)}</span>`).join('');
}

function coverSupportMarkup(page, coverSupport) {
  if (page.kind !== 'cover' || coverSupport === 'none') return '';
  if (Array.isArray(page.content_blocks) && page.content_blocks.length) return '';
  let text = String(page.lead || page.summary || (Array.isArray(page.evidence) ? page.evidence[0] : '') || '').trim();
  if (!text) return '';
  if (text.length > 60) text = `${text.slice(0, 59)}…`;
  if (coverSupport === 'metric') return `<div class="cover-support cover-support-metric"><b>01</b><span>${escapeHtml(text)}</span></div>`;
  if (coverSupport === 'statement') return `<aside class="cover-support cover-support-statement"><small>CORE TAKEAWAY</small><p>${escapeHtml(text)}</p></aside>`;
  return `<p class="cover-support cover-support-lead">${escapeHtml(text)}</p>`;
}

function pageBrand({ contentType, channelMode, sourceLabel, repository, topic }) {
  if (contentType === 'event') return channelMode === 'xiaohongshu' ? `小红书 · ${sourceLabel || topic}` : `EVENT DESK / ${sourceLabel || topic}`;
  if (contentType === 'custom') return channelMode === 'xiaohongshu' ? `小红书 · ${sourceLabel || topic}` : `CUSTOM / ${sourceLabel || topic}`;
  return channelMode === 'xiaohongshu' ? `小红书 · ${repository || topic}` : `OPEN SOURCE / ${repository || topic}`;
}

export function renderStoryboardSections({
  topic, repository, pages, compiledTheme, layoutStyle = 'auto', compositionMode = 'template', compositionSeed = '',
  forceSafeComposition = false, relaxedDensityPages = false, expandedDensityPages = false, contentType = 'repository',
  sourceLabel = '', disclosure = '', channelMode = 'wechat', coverTitleLines = null, templatePackId = '', templatePack = null,
}) {
  const skeleton = compiledTheme.recipes.skeleton || 'stacked';
  const coverSupport = compiledTheme.recipes.coverSupport || 'none';
  const usedCompositionByRole = new Map();
  return (Array.isArray(pages) ? pages : []).map((page, index) => {
    const pageKind = page.kind === 'cover' ? 'cover' : page.kind === 'ending' ? 'ending' : 'content';
    const pageRole = SOCIAL_CARD_PAGE_ROLES.includes(page?.role) ? page.role : inferCardPageRole(page);
    const templateDecision = resolveSocialCardTemplate(page, { themeDefinition: compiledTheme.definition, channelMode, contentType, templatePackId, templatePack });
    const compositionDecision = resolveCardCompositionDecision(page, {
      compositionMode, layoutStyle, channelMode, pageIndex: index, seed: compositionSeed || topic,
      forceSafe: selectedForPage(forceSafeComposition, index), avoidIds: usedCompositionByRole.get(pageRole) || [],
    });
    trackUsedComposition(usedCompositionByRole, compositionDecision.role, compositionDecision.composition?.id);
    const layoutDecision = compositionDecision.mode === 'template' ? compositionDecision : resolveCardLayoutDecision(page, 'auto', channelMode);
    const pageLayout = layoutDecision.layout;
    const layoutClass = compositionDecision.mode === 'smart' ? 'layout-smart' : `layout-${pageLayout}`;
    const composition = compositionDecision.composition;
    const pageBlocks = Array.isArray(page.content_blocks) ? page.content_blocks : [];
    const triSpanClass = compositionDecision.mode === 'smart' && pageBlocks.length === 3 && composition.columns !== 'single' && composition.flow === 'alternate' ? ' tri-span-last' : '';
    const compositionClasses = compositionDecision.mode === 'smart'
      ? `composition-smart role-${compositionDecision.role} comp-${composition.id} comp-cols-${composition.columns} comp-flow-${composition.flow} comp-align-${composition.alignment} decor-${composition.decoration} overlap-${composition.overlap}${triSpanClass}`
      : 'composition-template';
    const pageDensity = cardPageDensity(page);
    const blockCount = pageBlocks.length;
    const listItemCount = pageBlocks.reduce((total, block) => block?.type === 'list' ? total + listBlockValues(block).length : total, 0);
    const evidence = (Array.isArray(page.evidence) ? page.evidence : []).map((item) => `<li>${renderTechnicalText(item)}</li>`).join('');
    const blocks = pageBlocks.map((block) => renderStoryboardBlock(block, { pageLayout, pageRole: compositionDecision.role })).join('');
    const labels = PAGE_LABELS[contentType] || PAGE_LABELS.repository;
    const label = labels[page.kind] || (contentType === 'event' ? 'EVENT CARD' : contentType === 'custom' ? 'CUSTOM CARD' : 'TOOL CARD');
    const brand = pageBrand({ contentType, channelMode, sourceLabel, repository, topic });
    const footer = disclosure || (contentType === 'event' ? '据公开素材整理 · 未核实内容已标注' : contentType === 'custom' ? '内容整理自作者素材 · 建议性内容未实测' : '基于项目文档整理 · 未实际运行');
    const densityAdjustment = selectedForPage(expandedDensityPages, index) ? 'expanded' : selectedForPage(relaxedDensityPages, index) ? 'relaxed' : 'none';
    const densityAdjustmentClass = densityAdjustment === 'none' ? '' : ` density-${densityAdjustment}`;
    const skeletonClass = skeleton === 'stacked' ? '' : ` skeleton-${skeleton}`;
    const title = `${continuationBadge(page)}${pageKind === 'cover'
      ? coverTitleMarkup(page.title || topic, { topic, compiledTheme, coverTitleLines })
      : escapeHtml(page.title || topic)}`;
    return `<section class="page page-${pageKind}${skeletonClass} ${layoutClass} density-${pageDensity}${densityAdjustmentClass} blocks-${blockCount} items-${Math.min(9, listItemCount)} ${compositionClasses}" data-page-kind="${pageKind}" data-page-role="${compositionDecision.role}" data-template-id="${escapeHtml(templateDecision.templateId)}" data-template-pack="${escapeHtml(templateDecision.templatePack)}" data-template-version="${escapeHtml(templateDecision.templateVersion)}" data-template-source="${escapeHtml(templateDecision.source)}" data-composition-mode="${compositionDecision.mode}" data-composition-id="${composition?.id || ''}" data-layout="${pageLayout}" data-layout-source="${compositionDecision.source}" data-density="${pageDensity}" data-density-adjustment="${densityAdjustment}" data-block-count="${blockCount}" data-list-item-count="${Math.min(9, listItemCount)}" data-page-number="${index + 1}"><div class="page-inner"><header class="page-header"><span class="brand">${escapeHtml(brand)}</span><span class="page-number">${String(index + 1).padStart(2, '0')}</span></header><main class="page-body" data-valign="center"><div class="page-content-stack" data-card-index="${String(index + 1).padStart(2, '0')}"><span class="eyebrow">${label}</span><h1>${title}</h1>${coverSupportMarkup(page, coverSupport)}${blocks || (evidence ? `<ul>${evidence}</ul>` : '')}</div></main><footer class="page-footer"><span>${escapeHtml(footer)}</span><i></i></footer></div></section>`;
  }).join('\n');
}
