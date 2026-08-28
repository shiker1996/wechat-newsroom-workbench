import { cardPageDensity, deterministicCoverTitleLines, listBlockValues, normalizeCoverTitleLines } from '../../social-card-plan.mjs';
import { resolveCardCompositionDecision } from '../../social-card-composition.mjs';
import { inferCardPageRole, SOCIAL_CARD_PAGE_ROLES } from '../../social-card-role.mjs';
import { continuationBadge, escapeHtml, renderStoryboardBlock, renderTechnicalText } from '../../storyboard-html-content.mjs';

const EDITORIAL_TEMPLATE_IDS = new Set([
  'paper-poster', 'margin-thesis', 'column-notes', 'numbered-margin', 'data-table',
  'compare-sheet', 'source-ledger', 'timeline-strip', 'risk-note', 'closing-editor',
]);

const LABELS = Object.freeze({
  repository: {
    cover: 'FIELD NOTES / 01', concept: 'EDITORIAL / CONTEXT', feature: 'EDITORIAL / NOTES',
    steps: 'METHOD / STEPS', data: 'DATA / TABLE', compare: 'COMPARE / SHEET',
    evidence: 'SOURCES / LEDGER', timeline: 'TIMELINE / FILE', risk: 'BOUNDARY / NOTE', ending: 'EDITOR’S NOTE',
  },
  event: {
    cover: 'FIELD NOTES / EVENT', concept: 'CONTEXT / FIRST', feature: 'FACTS / NOTES',
    steps: 'RESPONSE / STEPS', data: 'DATA / TABLE', compare: 'DISCUSSION / SHEET',
    evidence: 'SOURCES / LEDGER', timeline: 'TIMELINE / FILE', risk: 'BOUNDARY / NOTE', ending: 'EDITOR’S NOTE',
  },
  technology: {
    cover: 'FIELD NOTES / TECH', concept: 'WHY / FIRST', feature: 'ARCH / NOTES',
    steps: 'HOW / STEPS', data: 'BENCH / TABLE', compare: 'TRADEOFF / SHEET',
    evidence: 'SOURCES / LEDGER', timeline: 'VERSION / FILE', risk: 'LIMIT / NOTE', ending: 'EDITOR’S NOTE',
  },
  trend: {
    cover: 'FIELD NOTES / TREND', concept: 'SIGNAL / FIRST', feature: 'ECOSYSTEM / NOTES',
    steps: 'ADOPTION / STEPS', data: 'SIGNALS / TABLE', compare: 'PLAYERS / SHEET',
    evidence: 'SOURCES / LEDGER', timeline: 'TIMELINE / FILE', risk: 'BOUNDARY / NOTE', ending: 'EDITOR’S NOTE',
  },
  custom: {
    cover: 'FIELD NOTES / NOTE', concept: 'CONTEXT / FIRST', feature: 'POINTS / NOTES',
    steps: 'METHOD / STEPS', data: 'DATA / TABLE', compare: 'COMPARE / SHEET',
    evidence: 'SOURCES / LEDGER', timeline: 'TIMELINE / FILE', risk: 'BOUNDARY / NOTE', ending: 'EDITOR’S NOTE',
  },
});

function selected(selection, index) {
  return selection === true || (Array.isArray(selection) && selection.includes(index)) || (selection instanceof Set && selection.has(index));
}

function pageBrand({ contentType, channelMode, sourceLabel, repository, topic }) {
  const source = sourceLabel || repository || topic;
  if (contentType === 'event') return channelMode === 'xiaohongshu' ? `小红书 · ${source}` : `EVENT DESK / ${source}`;
  if (contentType === 'technology') return channelMode === 'xiaohongshu' ? `小红书 · ${source}` : `TECH DESK / ${source}`;
  if (contentType === 'trend') return channelMode === 'xiaohongshu' ? `小红书 · ${source}` : `TREND DESK / ${source}`;
  if (contentType === 'custom') return channelMode === 'xiaohongshu' ? `小红书 · ${source}` : `CUSTOM / ${source}`;
  return channelMode === 'xiaohongshu' ? `小红书 · ${source}` : `OPEN SOURCE / ${source}`;
}

function titleMarkup(page, topic, coverTitleLines) {
  const value = String(page.title || topic);
  if (page.kind !== 'cover') return `${continuationBadge(page)}${escapeHtml(value)}`;
  let lines = normalizeCoverTitleLines(value, coverTitleLines);
  if (!lines) lines = deterministicCoverTitleLines(value);
  return `${continuationBadge(page)}${lines.map((line) => `<span class="editorial-title-line">${escapeHtml(line)}</span>`).join('')}`;
}

function coverNote(page) {
  if (page.kind !== 'cover' || (Array.isArray(page.content_blocks) && page.content_blocks.length)) return '';
  const text = String(page.lead || page.summary || (Array.isArray(page.evidence) ? page.evidence[0] : '') || '').trim();
  return text ? `<aside class="editorial-cover-note"><b data-text-role="auxiliary">READING NOTE</b><span>${escapeHtml(text.length > 100 ? `${text.slice(0, 99)}…` : text)}</span></aside>` : '';
}

export function renderEditorialStoryboardSections({
  topic, repository, pages, compositionMode = 'template', compositionSeed = '', forceSafeComposition = false,
  relaxedDensityPages = false, expandedDensityPages = false, contentType = 'repository', sourceLabel = '', disclosure = '',
  channelMode = 'wechat', coverTitleLines = null,
}) {
  const labels = LABELS[contentType] || LABELS.repository;
  const usedByRole = new Map();
  return (Array.isArray(pages) ? pages : []).map((page, index) => {
    const pageKind = page.kind === 'cover' ? 'cover' : page.kind === 'ending' ? 'ending' : 'content';
    const role = SOCIAL_CARD_PAGE_ROLES.includes(page?.role) ? page.role : inferCardPageRole(page);
    const decision = resolveCardCompositionDecision(page, {
      compositionMode, layoutStyle: 'auto', channelMode, pageIndex: index, seed: compositionSeed || topic,
      forceSafe: selected(forceSafeComposition, index), avoidIds: usedByRole.get(role) || [],
    });
    if (!usedByRole.has(role)) usedByRole.set(role, []);
    if (decision.composition?.id) usedByRole.get(role).push(decision.composition.id);
    const blocks = Array.isArray(page.content_blocks) ? page.content_blocks : [];
    const density = cardPageDensity(page);
    const densityAdjustment = selected(expandedDensityPages, index) ? 'expanded' : selected(relaxedDensityPages, index) ? 'relaxed' : 'none';
    const label = labels[role] || 'FIELD NOTE';
    const brand = pageBrand({ contentType, channelMode, sourceLabel, repository, topic });
    const footer = disclosure || (contentType === 'event' ? '据公开素材整理 · 未核实内容已标注' : contentType === 'technology' ? '据开源技术资料整理 · 机制与性能以来源为准' : contentType === 'trend' ? '据公开开源信号整理 · 趋势判断不等同于事实' : contentType === 'custom' ? '内容整理自作者素材 · 建议性内容未实测' : '基于项目文档整理 · 未实际运行');
    const defaults = { cover: 'paper-poster', concept: 'margin-thesis', feature: 'column-notes', steps: 'numbered-margin', data: 'data-table', compare: 'compare-sheet', evidence: 'source-ledger', timeline: 'timeline-strip', risk: 'risk-note', ending: 'closing-editor' };
    const requested = String(page.layout_intent || '').trim();
    const templateId = EDITORIAL_TEMPLATE_IDS.has(requested) ? requested : (defaults[role] || 'margin-thesis');
    const content = blocks.map((block) => renderStoryboardBlock(block, { pageLayout: role === 'steps' ? 'steps' : role, pageRole: role })).join('');
    const evidence = (Array.isArray(page.evidence) ? page.evidence : []).filter(Boolean).map((item) => `<li>${renderTechnicalText(item)}</li>`).join('');
    const listCount = blocks.reduce((n, block) => n + (block?.type === 'list' ? listBlockValues(block).length : 0), 0);
    return `<section class="page page-${pageKind} skeleton-paper-offset template-editorial-v1 editorial-role-${role} editorial-template-${escapeHtml(templateId)} density-${density}${densityAdjustment === 'none' ? '' : ` density-${densityAdjustment}`} blocks-${blocks.length} items-${Math.min(9, listCount)}" data-page-kind="${pageKind}" data-page-role="${role}" data-template-id="${escapeHtml(templateId)}" data-template-pack="editorial-v1" data-template-version="1" data-template-source="${requested ? 'storyboard' : 'theme-role-template'}" data-composition-mode="${decision.mode}" data-composition-id="${escapeHtml(decision.composition?.id || '')}" data-layout-source="editorial-v1" data-density="${density}" data-density-adjustment="${densityAdjustment}" data-block-count="${blocks.length}" data-page-number="${index + 1}"><div class="page-inner"><header class="page-header"><span class="brand" data-text-role="auxiliary">${escapeHtml(brand)}</span><span class="page-number" data-text-role="auxiliary">${String(index + 1).padStart(2, '0')}</span></header><main class="page-body"><div class="page-content-stack"><div class="editorial-kicker" data-text-role="auxiliary"><span data-text-role="auxiliary">${label}</span><i data-text-role="auxiliary">${String(index + 1).padStart(2, '0')}</i></div><h1>${titleMarkup(page, topic, coverTitleLines)}</h1>${coverNote(page)}<div class="editorial-block-stack">${content || (evidence ? `<div class="content-block list-block"><ul>${evidence}</ul></div>` : '')}</div></div></main><footer class="page-footer"><span data-text-role="auxiliary">${escapeHtml(footer)}</span><b></b></footer></div></section>`;
  }).join('\n');
}

export const EDITORIAL_V1_CSS = `
.template-editorial-v1{background:var(--page);color:var(--ink);background-image:linear-gradient(rgba(58,40,32,.035) 1px,transparent 1px);background-size:100% 5px}
.template-editorial-v1:after{width:130px;height:170px;right:-64px;top:-54px;border:1px solid var(--accent);border-radius:0;opacity:.18;box-shadow:8px 8px 0 var(--accentSecondary);transform:rotate(8deg)}
.template-editorial-v1 .page-inner{padding:24px 22px 19px}.template-editorial-v1 .page-header{border-bottom:1px solid var(--line);padding-bottom:10px}.template-editorial-v1 .brand{font:800 10px/1.2 ui-monospace,Consolas,monospace;letter-spacing:.08em;color:var(--muted)}.template-editorial-v1 .page-number{font:700 11px/1 serif;color:var(--accent)}
.template-editorial-v1 .page-body{align-items:stretch;padding:16px 0}.template-editorial-v1 .page-content-stack{min-height:100%;padding:19px 18px 17px;justify-content:flex-start;gap:11px;border:1px solid var(--line);border-radius:2px;background:var(--surface);box-shadow:5px 5px 0 color-mix(in srgb,var(--accentSecondary) 45%,transparent);position:relative}.template-editorial-v1 .page-content-stack:before{content:"";position:absolute;left:18px;top:-1px;width:44px;border-top:3px solid var(--accent);box-shadow:54px 0 0 var(--accentSecondary)}
.template-editorial-v1 .editorial-kicker{display:flex;justify-content:space-between;align-items:center;font:800 10px/1.2 ui-monospace,Consolas,monospace;letter-spacing:.08em;color:var(--muted);text-transform:uppercase}.template-editorial-v1 .editorial-kicker span{color:var(--accent)}.template-editorial-v1 .editorial-kicker i{font-style:normal;color:var(--muted)}.template-editorial-v1 h1{font:700 30px/1.12 Georgia,"Times New Roman",serif;letter-spacing:-.025em;color:var(--ink);margin:0;overflow-wrap:anywhere}.template-editorial-v1 .editorial-block-stack{display:grid;gap:10px;min-height:0}.template-editorial-v1 .content-block{gap:5px;padding:9px 10px;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:0;background:color-mix(in srgb,var(--page) 46%,var(--surface))}.template-editorial-v1 .content-block h2{font:800 11px/1.25 ui-monospace,Consolas,monospace;color:var(--accent);letter-spacing:.04em}.template-editorial-v1 .content-block p,.template-editorial-v1 .content-block li{font-size:11px;line-height:1.42;color:var(--ink)}.template-editorial-v1 .page ul{gap:5px}.template-editorial-v1 .page li{padding:6px 8px 6px 21px;background:var(--surface);border:1px solid var(--line);border-radius:0}.template-editorial-v1 .page li:before{left:8px;top:11px;width:5px;height:5px;border-radius:50%;background:var(--accent)}.template-editorial-v1 .code-block pre{background:var(--code);border:1px solid var(--ink);border-radius:0}.template-editorial-v1 .note-block{border-left:4px solid var(--accentSecondary);background:color-mix(in srgb,var(--accentSecondary) 13%,var(--surface))}.template-editorial-v1 .stat-row{gap:7px}.template-editorial-v1 .stat{padding:8px 7px;border:1px solid var(--line);border-radius:0;text-align:left;background:var(--page)}.template-editorial-v1 .stat b{font:700 20px/1.1 Georgia,"Times New Roman",serif;color:var(--accent)}.template-editorial-v1 .compare-block{overflow:hidden}.template-editorial-v1 .compare-block th{background:var(--ink);color:var(--inverse);border:0}.template-editorial-v1 .compare-block td{font-size:10px;padding:6px;border-color:var(--line)}.template-editorial-v1 .step{border-bottom:1px solid var(--line);padding-bottom:8px}.template-editorial-v1 .step>b{border-radius:50%;background:var(--accent);color:var(--inverse);font-family:ui-monospace,Consolas,monospace}.template-editorial-v1 .tl-node{border-color:var(--accent)}.template-editorial-v1 .tl-node:before{background:var(--accentSecondary)}.template-editorial-v1 .highlight-block{border-left:4px solid var(--accent);border-radius:0;background:color-mix(in srgb,var(--accent) 9%,var(--surface))}.template-editorial-v1 .editorial-cover-note{display:grid;gap:4px;padding:8px 10px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);color:var(--muted);font-size:11px;line-height:1.4}.template-editorial-v1 .editorial-cover-note b{font:800 10px/1.2 ui-monospace,Consolas,monospace;letter-spacing:.1em;color:var(--accent)}.template-editorial-v1 .page-footer{font:10px ui-monospace,Consolas,monospace;color:var(--muted)}.template-editorial-v1 .page-footer b{display:block;width:36px;height:2px;background:var(--accent)}
.template-editorial-v1.page-cover .page-content-stack{justify-content:flex-end;background:var(--page)}.template-editorial-v1.page-cover h1{font-size:39px;line-height:1.03}.template-editorial-v1.page-cover .editorial-title-line{display:block;width:max-content;max-width:100%;background:var(--accent);color:var(--inverse);padding:4px 8px;margin:3px 0;box-shadow:4px 4px 0 var(--accentSecondary);overflow-wrap:anywhere}.template-editorial-v1.page-cover .editorial-title-line:nth-child(even){background:var(--ink);color:var(--inverse);box-shadow:4px 4px 0 var(--accent)}
.template-editorial-v1.page-ending .page-content-stack{justify-content:center;background:var(--ink);color:var(--inverse);border-color:var(--ink);box-shadow:5px 5px 0 var(--accent)}.template-editorial-v1.page-ending h1,.template-editorial-v1.page-ending .editorial-kicker,.template-editorial-v1.page-ending .editorial-kicker span,.template-editorial-v1.page-ending .editorial-kicker i,.template-editorial-v1.page-ending .content-block h2,.template-editorial-v1.page-ending .content-block p,.template-editorial-v1.page-ending .content-block li,.template-editorial-v1.page-ending .page-footer{color:var(--inverse)}.template-editorial-v1.page-ending .content-block{border-color:rgba(255,255,255,.45);background:transparent}.template-editorial-v1.density-relaxed .page-content-stack{gap:14px}.template-editorial-v1.density-expanded .page-content-stack{gap:17px}.template-editorial-v1.density-expanded .content-block{padding-block:12px}
/* Stage 1: keep the kicker aligned with content pages and center the cover body group. */
.template-editorial-v1.page-cover .page-content-stack{justify-content:flex-start}
.template-editorial-v1.page-cover h1{margin-top:auto;margin-bottom:0}
.template-editorial-v1.page-cover .editorial-block-stack{margin-bottom:auto}
/* Keep comparison cell text above the 11px body-text audit floor. */
.template-editorial-v1 .compare-block td{font-size:11px}
`;
