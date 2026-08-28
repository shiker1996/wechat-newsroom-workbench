import { cardPageDensity, deterministicCoverTitleLines, listBlockValues, normalizeCoverTitleLines } from '../../social-card-plan.mjs';
import { resolveCardCompositionDecision } from '../../social-card-composition.mjs';
import { inferCardPageRole, SOCIAL_CARD_PAGE_ROLES } from '../../social-card-role.mjs';
import { continuationBadge, escapeHtml, renderStoryboardBlock, renderTechnicalText } from '../../storyboard-html-content.mjs';

const BRUTALIST_TEMPLATE_IDS = new Set(['poster-cover', 'thesis-split', 'feature-grid', 'numbered-steps', 'stat-stamp', 'versus-board', 'proof-ledger', 'event-strip', 'warning-panel', 'hard-cta']);
const LABELS = Object.freeze({
  repository: { cover: 'TOOL / POSTER', concept: 'THESIS / FIRST', feature: 'FEATURE / GRID', steps: 'HOW / NUMBERED', data: 'DATA / STAMP', compare: 'VERSUS / BOARD', evidence: 'PROOF / LEDGER', timeline: 'EVENT / STRIP', risk: 'RISK / NOTICE', ending: 'NEXT / ACTION' },
  event: { cover: 'EVENT / POSTER', concept: 'SIGNAL / FIRST', feature: 'FACT / GRID', steps: 'RESPONSE / NUMBERED', data: 'DATA / STAMP', compare: 'DISCUSSION / BOARD', evidence: 'PROOF / LEDGER', timeline: 'TIME / STRIP', risk: 'BOUNDARY / NOTICE', ending: 'NEXT / ACTION' },
  technology: { cover: 'TECH / POSTER', concept: 'WHY / FIRST', feature: 'ARCH / GRID', steps: 'HOW / NUMBERED', data: 'BENCH / STAMP', compare: 'TRADEOFF / BOARD', evidence: 'PROOF / LEDGER', timeline: 'VERSION / STRIP', risk: 'LIMIT / NOTICE', ending: 'NEXT / ACTION' },
  trend: { cover: 'TREND / POSTER', concept: 'SIGNAL / FIRST', feature: 'ECOSYSTEM / GRID', steps: 'ADOPTION / NUMBERED', data: 'SIGNALS / STAMP', compare: 'PLAYERS / BOARD', evidence: 'PROOF / LEDGER', timeline: 'TIME / STRIP', risk: 'BOUNDARY / NOTICE', ending: 'NEXT / ACTION' },
  custom: { cover: 'NOTE / POSTER', concept: 'POINT / FIRST', feature: 'POINT / GRID', steps: 'HOW / NUMBERED', data: 'DATA / STAMP', compare: 'VERSUS / BOARD', evidence: 'SOURCE / LEDGER', timeline: 'TIME / STRIP', risk: 'BOUNDARY / NOTICE', ending: 'NEXT / ACTION' },
});

function selected(selection, index) { return selection === true || (Array.isArray(selection) && selection.includes(index)) || (selection instanceof Set && selection.has(index)); }

function titleMarkup(page, topic, coverTitleLines) {
  const value = String(page.title || topic);
  if (page.kind !== 'cover') return `${continuationBadge(page)}${escapeHtml(value)}`;
  let lines = normalizeCoverTitleLines(value, coverTitleLines);
  if (!lines) lines = deterministicCoverTitleLines(value);
  return `${continuationBadge(page)}${lines.map((line) => `<span class="brutalist-title-line">${escapeHtml(line)}</span>`).join('')}`;
}

function pageBrand({ contentType, channelMode, sourceLabel, repository, topic }) {
  const source = sourceLabel || repository || topic;
  if (contentType === 'event') return channelMode === 'xiaohongshu' ? `小红书 · ${source}` : `EVENT DESK / ${source}`;
  if (contentType === 'technology') return channelMode === 'xiaohongshu' ? `小红书 · ${source}` : `TECH DESK / ${source}`;
  if (contentType === 'trend') return channelMode === 'xiaohongshu' ? `小红书 · ${source}` : `TREND DESK / ${source}`;
  if (contentType === 'custom') return channelMode === 'xiaohongshu' ? `小红书 · ${source}` : `CUSTOM / ${source}`;
  return channelMode === 'xiaohongshu' ? `小红书 · ${source}` : `OPEN SOURCE / ${source}`;
}

export function renderBrutalistStoryboardSections({ topic, repository, pages, compositionMode = 'template', compositionSeed = '', forceSafeComposition = false, relaxedDensityPages = false, expandedDensityPages = false, fitContentPages = false, contentType = 'repository', sourceLabel = '', disclosure = '', channelMode = 'wechat', coverTitleLines = null }) {
  const labels = LABELS[contentType] || LABELS.repository; const usedByRole = new Map();
  return (Array.isArray(pages) ? pages : []).map((page, index) => {
    const pageKind = page.kind === 'cover' ? 'cover' : page.kind === 'ending' ? 'ending' : 'content';
    const role = SOCIAL_CARD_PAGE_ROLES.includes(page?.role) ? page.role : inferCardPageRole(page);
    const decision = resolveCardCompositionDecision(page, { compositionMode, layoutStyle: 'auto', channelMode, pageIndex: index, seed: compositionSeed || topic, forceSafe: selected(forceSafeComposition, index), avoidIds: usedByRole.get(role) || [] });
    if (!usedByRole.has(role)) usedByRole.set(role, []);
    if (decision.composition?.id) usedByRole.get(role).push(decision.composition.id);
    const blocks = Array.isArray(page.content_blocks) ? page.content_blocks : [];
    const density = cardPageDensity(page);
    const densityAdjustment = selected(expandedDensityPages, index) ? 'expanded' : selected(relaxedDensityPages, index) ? 'relaxed' : 'none';
    const fitContentClass = selected(fitContentPages, index) && pageKind === 'content' ? ' fit-content-stack' : '';
    const label = labels[role] || 'CARD / NOTE'; const brand = pageBrand({ contentType, channelMode, sourceLabel, repository, topic });
    const footer = disclosure || (contentType === 'event' ? '据公开素材整理 · 未核实内容已标注' : contentType === 'technology' ? '据开源技术资料整理 · 机制与性能以来源为准' : contentType === 'trend' ? '据公开开源信号整理 · 趋势判断不等同于事实' : contentType === 'custom' ? '内容整理自作者素材 · 建议性内容未实测' : '基于项目文档整理 · 未实际运行');
    const fallbackTemplate = ({ cover: 'poster-cover', concept: 'thesis-split', feature: 'feature-grid', steps: 'numbered-steps', data: 'stat-stamp', compare: 'versus-board', evidence: 'proof-ledger', timeline: 'event-strip', risk: 'warning-panel', ending: 'hard-cta' }[role] || 'thesis-split');
    const requested = String(page.layout_intent || '').trim(); const templateId = BRUTALIST_TEMPLATE_IDS.has(requested) ? requested : fallbackTemplate;
    const content = blocks.map((block) => renderStoryboardBlock(block, { pageLayout: role === 'steps' ? 'steps' : role, pageRole: role })).join('');
    const evidence = (Array.isArray(page.evidence) ? page.evidence : []).filter(Boolean).map((item) => `<li>${renderTechnicalText(item)}</li>`).join('');
    const listCount = blocks.reduce((n, block) => n + (block?.type === 'list' ? listBlockValues(block).length : 0), 0);
    return `<section class="page page-${pageKind}${fitContentClass} skeleton-impact-band template-brutalist-v1 brutalist-role-${role} brutalist-template-${escapeHtml(templateId)} density-${density}${densityAdjustment === 'none' ? '' : ` density-${densityAdjustment}`} blocks-${blocks.length} items-${Math.min(9, listCount)}" data-page-kind="${pageKind}" data-page-role="${role}" data-template-id="${escapeHtml(templateId)}" data-template-pack="brutalist-v1" data-template-version="1" data-template-source="${requested ? 'storyboard' : 'theme-role-template'}" data-composition-mode="${decision.mode}" data-composition-id="${escapeHtml(decision.composition?.id || '')}" data-layout-source="brutalist-v1" data-density="${density}" data-density-adjustment="${densityAdjustment}" data-block-count="${blocks.length}" data-page-number="${index + 1}"><div class="page-inner"><header class="page-header"><span class="brand">${escapeHtml(brand)}</span><span class="page-number">${String(index + 1).padStart(2, '0')}</span></header><main class="page-body"><div class="page-content-stack"><div class="brutalist-kicker"><span>${label}</span><i>${String(index + 1).padStart(2, '0')}</i></div><h1>${titleMarkup(page, topic, coverTitleLines)}</h1><div class="brutalist-rule"></div><div class="brutalist-block-stack">${content || (evidence ? `<div class="content-block list-block"><ul>${evidence}</ul></div>` : '')}</div></div></main><footer class="page-footer"><span>${escapeHtml(footer)}</span><b></b></footer></div></section>`;
  }).join('\n');
}

export const BRUTALIST_V1_CSS = `
.template-brutalist-v1{background:var(--page);color:var(--ink)}
.template-brutalist-v1:after{width:150px;height:150px;right:-72px;top:-55px;border:4px solid var(--ink);border-radius:0;opacity:.14;box-shadow:none;transform:rotate(11deg)}
.template-brutalist-v1 .page-inner{padding:23px 21px 19px}.template-brutalist-v1 .page-header{border-bottom:4px solid var(--ink);padding-bottom:9px}.template-brutalist-v1 .brand{font-size:11px;font-weight:900;letter-spacing:.08em;padding:4px 7px;background:var(--ink);color:var(--inverse)}.template-brutalist-v1 .page-number{font:900 12px/1 ui-monospace,Consolas,monospace;color:var(--ink)}
.template-brutalist-v1 .page-body{align-items:stretch;padding:15px 0}.template-brutalist-v1 .page-content-stack{box-sizing:border-box;min-height:calc(100% - 2px);padding:19px 17px 17px;justify-content:flex-start;gap:10px;border:4px solid var(--ink);border-radius:0;background:var(--surface);box-shadow:8px 8px 0 var(--accentSecondary)}
.template-brutalist-v1 .brutalist-kicker{display:flex;justify-content:space-between;align-items:center;font:900 11px/1.2 ui-monospace,Consolas,monospace;letter-spacing:.06em;color:var(--ink);text-transform:uppercase}.template-brutalist-v1 .brutalist-kicker span{background:var(--accent);color:var(--inverse);padding:5px 7px}.template-brutalist-v1 .brutalist-kicker i{font-style:normal;font-size:14px}.template-brutalist-v1 h1{font-size:30px;line-height:1.06;letter-spacing:-.04em;margin:0;color:var(--ink);overflow-wrap:anywhere}.template-brutalist-v1 .brutalist-rule{height:4px;background:var(--ink);width:100%}.template-brutalist-v1 .brutalist-block-stack{display:grid;gap:10px;min-height:0}.template-brutalist-v1 .content-block{gap:5px;padding:9px 10px;border:3px solid var(--ink);border-radius:0;background:var(--page);box-shadow:4px 4px 0 var(--accent)}.template-brutalist-v1 .content-block h2{font:900 11px/1.25 ui-monospace,Consolas,monospace;color:var(--ink);text-transform:uppercase}.template-brutalist-v1 .content-block p,.template-brutalist-v1 .content-block li{font-size:11px;line-height:1.4;color:var(--ink)}.template-brutalist-v1 .page ul{gap:6px}.template-brutalist-v1 .page li{padding:7px 8px 7px 22px;background:var(--surface);border:2px solid var(--ink);border-radius:0;box-shadow:2px 2px 0 var(--accentSecondary)}.template-brutalist-v1 .page li:before{left:8px;top:12px;width:6px;height:6px;border-radius:0;background:var(--accent)}.template-brutalist-v1 .code-block pre{background:var(--code);border:3px solid var(--ink);border-radius:0}.template-brutalist-v1 .note-block{border-left:9px solid var(--accent);background:var(--surface)}.template-brutalist-v1 .stat-row{gap:8px}.template-brutalist-v1 .stat{padding:8px 7px;border:3px solid var(--ink);border-radius:0;text-align:left;background:var(--accentSecondary)}.template-brutalist-v1 .stat b{font:900 19px/1.1 ui-monospace,Consolas,monospace;color:var(--ink)}.template-brutalist-v1 .stat span{color:var(--ink)}.template-brutalist-v1 .compare-block{overflow:hidden}.template-brutalist-v1 .compare-block th{background:var(--ink);color:var(--inverse);border:0}.template-brutalist-v1 .compare-block td{font-size:11px;padding:6px;border-color:var(--ink)}.template-brutalist-v1 .step>b{border-radius:0;background:var(--accent);color:var(--inverse);font-family:ui-monospace,Consolas,monospace}.template-brutalist-v1 .tl-node{border-color:var(--ink)}.template-brutalist-v1 .tl-node:before{border-radius:0;background:var(--accent)}.template-brutalist-v1 .highlight-block{border-left:9px solid var(--accentSecondary);border-radius:0;background:var(--surface)}.template-brutalist-v1 .page-footer{font:900 11px ui-monospace,Consolas,monospace;color:var(--ink)}.template-brutalist-v1 .page-footer b{display:block;width:42px;height:4px;background:var(--accent)}
.template-brutalist-v1 .page li:before{left:8px;top:10px;width:9px;height:9px;border:2px solid var(--accent);border-radius:0;background:var(--ink);box-shadow:2px 2px 0 var(--accentSecondary);z-index:1}
.template-brutalist-v1.page-cover .page-content-stack{justify-content:flex-end;background:var(--accentSecondary)}.template-brutalist-v1.page-cover h1{font-size:40px;line-height:1.02}.template-brutalist-v1.page-cover .brutalist-title-line{display:block;width:max-content;max-width:100%;background:var(--ink);color:var(--inverse);padding:5px 8px;margin:3px 0;box-shadow:6px 6px 0 var(--accent);overflow-wrap:anywhere}.template-brutalist-v1.page-cover .brutalist-title-line:nth-child(even){background:var(--inverse);color:var(--ink);box-shadow:6px 6px 0 var(--accent)}
.template-brutalist-v1.page-ending .page-content-stack{justify-content:center;background:var(--ink);color:var(--inverse);border-color:var(--ink);box-shadow:8px 8px 0 var(--accent)}.template-brutalist-v1.page-ending h1,.template-brutalist-v1.page-ending .brutalist-kicker,.template-brutalist-v1.page-ending .content-block h2,.template-brutalist-v1.page-ending .content-block p,.template-brutalist-v1.page-ending .content-block li{color:var(--inverse)}.template-brutalist-v1.page-ending .content-block{border-color:var(--inverse);background:transparent;box-shadow:none}.template-brutalist-v1.density-relaxed .page-content-stack{gap:14px}.template-brutalist-v1.density-expanded .page-content-stack{gap:17px}.template-brutalist-v1.density-expanded .content-block{padding-block:12px}
/* Stage 1: keep the kicker aligned with content pages and center the cover body group. */
.template-brutalist-v1.page-cover .page-content-stack{justify-content:flex-start}
.template-brutalist-v1.page-cover h1{margin-top:auto;margin-bottom:0}
.template-brutalist-v1.page-cover .brutalist-block-stack{margin-bottom:auto}
`;
