import { cardPageDensity, deterministicCoverTitleLines, listBlockValues, normalizeCoverTitleLines } from '../../social-card-plan.mjs';
import { resolveCardCompositionDecision } from '../../social-card-composition.mjs';
import { inferCardPageRole, SOCIAL_CARD_PAGE_ROLES } from '../../social-card-role.mjs';
import { continuationBadge, escapeHtml, renderStoryboardBlock, renderTechnicalText } from '../../storyboard-html-content.mjs';

const CLEAN_TEMPLATE_IDS = new Set([
  'clean-cover', 'clean-problem', 'clean-feature', 'clean-steps', 'clean-data',
  'clean-compare', 'clean-evidence', 'clean-timeline', 'clean-risk', 'clean-ending',
]);

const LABELS = Object.freeze({
  repository: { cover: 'TOOL / BRIEF', concept: 'CONTEXT / FIRST', feature: 'FEATURE / NOTES', steps: 'METHOD / STEPS', data: 'DATA / SIGNAL', compare: 'COMPARE / VIEW', evidence: 'SOURCES / CHECK', timeline: 'TIMELINE / FLOW', risk: 'BOUNDARY / NOTE', ending: 'SAVE / LATER' },
  event: { cover: 'EVENT / BRIEF', concept: 'CONTEXT / FIRST', feature: 'FACTS / NOTES', steps: 'RESPONSE / STEPS', data: 'DATA / SIGNAL', compare: 'DISCUSSION / VIEW', evidence: 'SOURCES / CHECK', timeline: 'TIMELINE / FLOW', risk: 'BOUNDARY / NOTE', ending: 'SAVE / LATER' },
  custom: { cover: 'NOTE / BRIEF', concept: 'CONTEXT / FIRST', feature: 'POINTS / NOTES', steps: 'METHOD / STEPS', data: 'DATA / SIGNAL', compare: 'COMPARE / VIEW', evidence: 'SOURCES / CHECK', timeline: 'TIMELINE / FLOW', risk: 'BOUNDARY / NOTE', ending: 'SAVE / LATER' },
});

function selected(selection, index) { return selection === true || (Array.isArray(selection) && selection.includes(index)) || (selection instanceof Set && selection.has(index)); }

function pageBrand({ contentType, channelMode, sourceLabel, repository, topic }) {
  const source = sourceLabel || repository || topic;
  if (contentType === 'event') return channelMode === 'xiaohongshu' ? `小红书 · ${source}` : `EVENT DESK / ${source}`;
  if (contentType === 'custom') return channelMode === 'xiaohongshu' ? `小红书 · ${source}` : `CUSTOM / ${source}`;
  return channelMode === 'xiaohongshu' ? `小红书 · ${source}` : `OPEN SOURCE / ${source}`;
}

function titleMarkup(page, topic, coverTitleLines) {
  const value = String(page.title || topic);
  if (page.kind !== 'cover') return `${continuationBadge(page)}${escapeHtml(value)}`;
  let lines = normalizeCoverTitleLines(value, coverTitleLines);
  if (!lines) lines = deterministicCoverTitleLines(value);
  return `${continuationBadge(page)}${lines.map((line) => `<span class="clean-title-line">${escapeHtml(line)}</span>`).join('')}`;
}

function coverLead(page) {
  if (page.kind !== 'cover' || (Array.isArray(page.content_blocks) && page.content_blocks.length)) return '';
  const value = String(page.lead || page.summary || (Array.isArray(page.evidence) ? page.evidence[0] : '') || '').trim();
  return value ? `<p class="clean-cover-lead">${escapeHtml(value.length > 100 ? `${value.slice(0, 99)}…` : value)}</p>` : '';
}

export function renderCleanStoryboardSections({
  topic, repository, pages, compositionMode = 'template', compositionSeed = '', forceSafeComposition = false,
  relaxedDensityPages = false, expandedDensityPages = false, contentType = 'repository', sourceLabel = '', disclosure = '',
  channelMode = 'wechat', coverTitleLines = null, compiledTheme = null,
}) {
  const labels = LABELS[contentType] || LABELS.repository;
  const usedByRole = new Map();
  const defaults = { cover: 'clean-cover', concept: 'clean-problem', feature: 'clean-feature', steps: 'clean-steps', data: 'clean-data', compare: 'clean-compare', evidence: 'clean-evidence', timeline: 'clean-timeline', risk: 'clean-risk', ending: 'clean-ending' };
  const skeleton = ['stacked', 'editorial-split'].includes(compiledTheme?.recipes?.skeleton) ? compiledTheme.recipes.skeleton : 'stacked';
  return (Array.isArray(pages) ? pages : []).map((page, index) => {
    const pageKind = page.kind === 'cover' ? 'cover' : page.kind === 'ending' ? 'ending' : 'content';
    const role = SOCIAL_CARD_PAGE_ROLES.includes(page?.role) ? page.role : inferCardPageRole(page);
    const decision = resolveCardCompositionDecision(page, { compositionMode, layoutStyle: 'auto', channelMode, pageIndex: index, seed: compositionSeed || topic, forceSafe: selected(forceSafeComposition, index), avoidIds: usedByRole.get(role) || [] });
    if (!usedByRole.has(role)) usedByRole.set(role, []);
    if (decision.composition?.id) usedByRole.get(role).push(decision.composition.id);
    const blocks = Array.isArray(page.content_blocks) ? page.content_blocks : [];
    const density = cardPageDensity(page);
    const densityAdjustment = selected(expandedDensityPages, index) ? 'expanded' : selected(relaxedDensityPages, index) ? 'relaxed' : 'none';
    const requested = String(page.layout_intent || '').trim();
    const templateId = CLEAN_TEMPLATE_IDS.has(requested) ? requested : (defaults[role] || 'clean-feature');
    const label = labels[role] || 'TOOL / CARD';
    const brand = pageBrand({ contentType, channelMode, sourceLabel, repository, topic });
    const footer = disclosure || (contentType === 'event' ? '据公开素材整理 · 未核实内容已标注' : contentType === 'custom' ? '内容整理自作者素材 · 建议性内容未实测' : '基于项目文档整理 · 未实际运行');
    const content = blocks.map((block) => renderStoryboardBlock(block, { pageLayout: role === 'steps' ? 'steps' : role, pageRole: role })).join('');
    const evidence = (Array.isArray(page.evidence) ? page.evidence : []).filter(Boolean).map((item) => `<li>${renderTechnicalText(item)}</li>`).join('');
    const listCount = blocks.reduce((n, block) => n + (block?.type === 'list' ? listBlockValues(block).length : 0), 0);
    const composition = decision.composition;
    const compositionClasses = decision.mode === 'smart' && composition
      ? `composition-smart role-${decision.role} comp-${escapeHtml(composition.id)} comp-cols-${escapeHtml(composition.columns)} comp-flow-${escapeHtml(composition.flow)} comp-align-${escapeHtml(composition.alignment)} decor-${escapeHtml(composition.decoration)} overlap-${escapeHtml(composition.overlap)}`
      : '';
    return `<section class="page page-${pageKind} skeleton-${skeleton} template-clean-v1 clean-role-${role} clean-template-${escapeHtml(templateId)} density-${density}${densityAdjustment === 'none' ? '' : ` density-${densityAdjustment}`} blocks-${blocks.length} items-${Math.min(9, listCount)} ${compositionClasses}" data-page-kind="${pageKind}" data-page-role="${role}" data-template-id="${escapeHtml(templateId)}" data-template-pack="clean-v1" data-template-version="1" data-template-source="${requested ? 'storyboard' : 'theme-role-template'}" data-composition-mode="${decision.mode}" data-composition-id="${escapeHtml(composition?.id || '')}" data-layout-source="clean-v1" data-density="${density}" data-density-adjustment="${densityAdjustment}" data-block-count="${blocks.length}" data-page-number="${index + 1}"><div class="page-inner"><header class="page-header"><span class="brand" data-text-role="auxiliary">${escapeHtml(brand)}</span><span class="page-number" data-text-role="auxiliary">${String(index + 1).padStart(2, '0')}</span></header><main class="page-body"><div class="page-content-stack"><div class="clean-kicker" data-text-role="auxiliary"><span data-text-role="auxiliary">${label}</span><i data-text-role="auxiliary">${String(index + 1).padStart(2, '0')}</i></div><h1>${titleMarkup(page, topic, coverTitleLines)}</h1>${coverLead(page)}<div class="clean-block-stack">${content || (evidence ? `<div class="content-block list-block"><ul>${evidence}</ul></div>` : '')}</div></div></main><footer class="page-footer"><span data-text-role="auxiliary">${escapeHtml(footer)}</span><b></b></footer></div></section>`;
  }).join('\n');
}

export const CLEAN_V1_CSS = `
.template-clean-v1{background:var(--page);color:var(--ink)}
.template-clean-v1:after{width:150px;height:150px;right:-78px;top:-66px;border:1px solid var(--accent2);border-radius:50%;opacity:.22;box-shadow:0 0 0 12px color-mix(in srgb,var(--accent2) 9%,transparent)}
.template-clean-v1 .page-inner{padding:24px 22px 19px}.template-clean-v1 .page-header{padding-bottom:10px;border-bottom:1px solid color-mix(in srgb,var(--line) 80%,transparent)}.template-clean-v1 .brand{font:800 10px/1.2 ui-monospace,Consolas,monospace;letter-spacing:.08em;color:var(--muted)}.template-clean-v1 .page-number{font:800 11px/1 ui-monospace,Consolas,monospace;color:var(--accent)}
.template-clean-v1 .page-body{align-items:stretch;padding:16px 0}.template-clean-v1 .page-content-stack{min-height:100%;padding:20px 18px 18px;justify-content:flex-start;gap:12px;border:1px solid color-mix(in srgb,var(--line) 78%,transparent);border-radius:var(--radius);background:var(--surface);box-shadow:0 14px 28px color-mix(in srgb,var(--accent) 13%,transparent);position:relative}.template-clean-v1 .page-content-stack:before{content:"";position:absolute;left:18px;top:-1px;width:54px;border-top:3px solid var(--accent);border-radius:3px}
.template-clean-v1 .clean-kicker{display:flex;justify-content:space-between;align-items:center;font:800 10px/1.2 ui-monospace,Consolas,monospace;letter-spacing:.08em;color:var(--muted);text-transform:uppercase}.template-clean-v1 .clean-kicker span{color:var(--accent)}.template-clean-v1 .clean-kicker i{font-style:normal;color:var(--muted)}.template-clean-v1 h1{font-size:30px;line-height:1.14;letter-spacing:-.025em;color:var(--ink);margin:0;overflow-wrap:anywhere}.template-clean-v1 .clean-block-stack{display:grid;gap:10px;min-height:0}.template-clean-v1 .content-block{gap:6px;padding:10px 11px;border:1px solid color-mix(in srgb,var(--line) 76%,transparent);border-radius:calc(var(--radius)/2);background:color-mix(in srgb,var(--page) 42%,var(--surface))}.template-clean-v1 .content-block h2{font-size:11px;line-height:1.3;color:var(--accent);margin:0}.template-clean-v1 .content-block p,.template-clean-v1 .content-block li{font-size:11px;line-height:1.45;color:var(--ink)}.template-clean-v1 .page ul{gap:6px}.template-clean-v1 .page li{padding:7px 8px 7px 23px;background:color-mix(in srgb,var(--accent) 8%,var(--surface));border:1px solid color-mix(in srgb,var(--line) 68%,transparent);border-radius:calc(var(--radius)/2)}.template-clean-v1 .page li:before{left:9px;top:12px;width:6px;height:6px;border-radius:50%;background:var(--accent2)}.template-clean-v1 .code-block pre{background:var(--code);border:1px solid var(--line);border-radius:calc(var(--radius)/2)}.template-clean-v1 .note-block{border-left:4px solid var(--accent2);background:color-mix(in srgb,var(--accent2) 12%,var(--surface))}.template-clean-v1 .stat-row{gap:8px}.template-clean-v1 .stat{padding:9px 8px;border:1px solid var(--line);border-radius:calc(var(--radius)/2);background:var(--page);text-align:left}.template-clean-v1 .stat b{font-size:21px;line-height:1.1;color:var(--accent)}.template-clean-v1 .compare-block{overflow:hidden}.template-clean-v1 .compare-block th{background:var(--accent);color:var(--inverse);border:0}.template-clean-v1 .compare-block td{font-size:10px;padding:6px;border-color:var(--line)}.template-clean-v1 .step{border-bottom:1px solid var(--line);padding-bottom:9px}.template-clean-v1 .step>b{background:var(--accent);color:var(--inverse)}.template-clean-v1 .tl-node{border-color:var(--accent)}.template-clean-v1 .tl-node:before{background:var(--accent2)}.template-clean-v1 .highlight-block{border-left:4px solid var(--accent);background:color-mix(in srgb,var(--accent) 8%,var(--surface))}.template-clean-v1 .page-footer{font:9px ui-monospace,Consolas,monospace;color:var(--muted)}.template-clean-v1 .page-footer b{display:block;width:36px;height:2px;background:var(--accent2)}
.template-clean-v1.page-cover .page-content-stack{justify-content:flex-end}.template-clean-v1.page-cover h1{font-size:39px;line-height:1.05}.template-clean-v1.page-cover .clean-title-line{display:block;width:max-content;max-width:100%;background:var(--accent);color:var(--inverse);padding:5px 9px;margin:3px 0;border-radius:calc(var(--radius)/2);box-shadow:4px 4px 0 color-mix(in srgb,var(--accent2) 62%,transparent);overflow-wrap:anywhere}.template-clean-v1.page-cover .clean-title-line:nth-child(even){background:var(--ink);box-shadow:4px 4px 0 var(--accent2)}.template-clean-v1 .clean-cover-lead{margin:0;padding-top:9px;border-top:1px solid var(--line);font-size:11px;line-height:1.45;color:var(--muted)}
.template-clean-v1.page-ending .page-content-stack{justify-content:center;background:var(--code);color:var(--inverse);border-color:var(--code);box-shadow:0 14px 28px color-mix(in srgb,var(--code) 28%,transparent)}.template-clean-v1.page-ending h1,.template-clean-v1.page-ending .clean-kicker,.template-clean-v1.page-ending .content-block h2,.template-clean-v1.page-ending .content-block p,.template-clean-v1.page-ending .content-block li{color:var(--inverse)}.template-clean-v1.page-ending .content-block{border-color:color-mix(in srgb,var(--inverse) 36%,transparent);background:rgba(255,255,255,.06)}.template-clean-v1.density-relaxed .page-content-stack{gap:15px}.template-clean-v1.density-expanded .page-content-stack{gap:17px}.template-clean-v1.density-expanded .content-block{padding-block:12px}
.template-clean-v1.skeleton-editorial-split:not(.page-cover):not(.blocks-1):not(.blocks-3):not(.comp-cols-single) .page-content-stack{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,.92fr);align-content:center;gap:12px 14px}.template-clean-v1.skeleton-editorial-split:not(.page-cover) .clean-kicker,.template-clean-v1.skeleton-editorial-split:not(.page-cover) h1,.template-clean-v1.skeleton-editorial-split:not(.page-cover) .clean-cover-lead{grid-column:1/-1}.template-clean-v1.skeleton-editorial-split:not(.page-cover):not(.blocks-1):not(.blocks-3):not(.comp-cols-single) .clean-block-stack{display:grid;grid-column:1/-1;grid-template-columns:minmax(0,1.08fr) minmax(0,.92fr);gap:10px 14px}.template-clean-v1.skeleton-editorial-split:not(.page-cover):not(.blocks-1):not(.blocks-3):not(.comp-cols-single) .content-block:nth-child(odd){grid-column:1}.template-clean-v1.skeleton-editorial-split:not(.page-cover):not(.blocks-1):not(.blocks-3):not(.comp-cols-single) .content-block:nth-child(even){grid-column:2}
.template-clean-v1.skeleton-editorial-split.comp-cols-split-even:not(.page-cover):not(.blocks-1):not(.blocks-3) .page-content-stack,.template-clean-v1.skeleton-editorial-split.comp-cols-split-even:not(.page-cover):not(.blocks-1):not(.blocks-3) .clean-block-stack{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.template-clean-v1.skeleton-editorial-split.comp-cols-split-wide:not(.page-cover):not(.blocks-1):not(.blocks-3) .page-content-stack,.template-clean-v1.skeleton-editorial-split.comp-cols-split-wide:not(.page-cover):not(.blocks-1):not(.blocks-3) .clean-block-stack{grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr)}
.template-clean-v1.skeleton-editorial-split.comp-cols-split-narrow:not(.page-cover):not(.blocks-1):not(.blocks-3) .page-content-stack,.template-clean-v1.skeleton-editorial-split.comp-cols-split-narrow:not(.page-cover):not(.blocks-1):not(.blocks-3) .clean-block-stack{grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr)}
/* stacked 骨架的内容块包在 .clean-block-stack 内，双列构图必须由内层容器承接，不能让外层产生空列。 */
.template-clean-v1.skeleton-stacked.composition-smart:not(.page-cover):not(.page-ending).comp-cols-split-even .page-content-stack{grid-template-columns:minmax(0,1fr)}
.template-clean-v1.skeleton-stacked.composition-smart:not(.page-cover):not(.page-ending).comp-cols-split-even .clean-block-stack{grid-column:1/-1;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px 14px}
.template-clean-v1.skeleton-stacked.composition-smart:not(.page-cover):not(.page-ending).comp-cols-split-wide .page-content-stack{grid-template-columns:minmax(0,1fr)}
.template-clean-v1.skeleton-stacked.composition-smart:not(.page-cover):not(.page-ending).comp-cols-split-wide .clean-block-stack{grid-column:1/-1;grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr);gap:10px 14px}
.template-clean-v1.skeleton-stacked.composition-smart:not(.page-cover):not(.page-ending).comp-cols-split-narrow .page-content-stack{grid-template-columns:minmax(0,1fr)}
.template-clean-v1.skeleton-stacked.composition-smart:not(.page-cover):not(.page-ending).comp-cols-split-narrow .clean-block-stack{grid-column:1/-1;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:10px 14px}
/* Stage 1: keep the kicker aligned with content pages and center the cover body group. */
.template-clean-v1.page-cover .page-content-stack{justify-content:flex-start}
.template-clean-v1.page-cover h1{margin-top:auto;margin-bottom:0}
.template-clean-v1.page-cover .clean-block-stack{margin-bottom:auto}
.template-clean-v1 .compare-block td{font-size:11px}
`;
