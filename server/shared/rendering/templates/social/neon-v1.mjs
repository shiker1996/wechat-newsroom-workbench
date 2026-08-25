import { cardPageDensity, deterministicCoverTitleLines, listBlockValues, normalizeCoverTitleLines } from '../../social-card-plan.mjs';
import { resolveCardCompositionDecision } from '../../social-card-composition.mjs';
import { inferCardPageRole, SOCIAL_CARD_PAGE_ROLES } from '../../social-card-role.mjs';
import { continuationBadge, escapeHtml, renderStoryboardBlock, renderTechnicalText } from '../../storyboard-html-content.mjs';

const LABELS = Object.freeze({
  repository: { cover: 'TOOL / RADAR', concept: 'PROBLEM / SIGNAL', feature: 'FEATURE / STACK', steps: 'FLOW / STEPS', data: 'DATA / BOARD', compare: 'COMPARE / MODE', evidence: 'EVIDENCE / LOG', timeline: 'TIME / LINE', risk: 'RISK / BOUNDARY', ending: 'NEXT / MOVE' },
  event: { cover: 'EVENT / RADAR', concept: 'EVENT / SIGNAL', feature: 'FACT / STACK', steps: 'RESPONSE / FLOW', data: 'DATA / BOARD', compare: 'DISCUSSION / MODE', evidence: 'EVIDENCE / LOG', timeline: 'TIME / LINE', risk: 'RISK / BOUNDARY', ending: 'NEXT / MOVE' },
  technology: { cover: 'TECH / RADAR', concept: 'WHY / SIGNAL', feature: 'ARCH / STACK', steps: 'HOW / FLOW', data: 'BENCH / BOARD', compare: 'TRADEOFF / MODE', evidence: 'EVIDENCE / LOG', timeline: 'VERSION / LINE', risk: 'LIMIT / BOUNDARY', ending: 'NEXT / MOVE' },
  trend: { cover: 'TREND / RADAR', concept: 'SIGNAL / FIRST', feature: 'ECOSYSTEM / STACK', steps: 'ADOPTION / FLOW', data: 'SIGNALS / BOARD', compare: 'PLAYERS / MODE', evidence: 'EVIDENCE / LOG', timeline: 'TIME / LINE', risk: 'BOUNDARY / CHECK', ending: 'NEXT / MOVE' },
  custom: { cover: 'NOTE / RADAR', concept: 'NOTE / SIGNAL', feature: 'POINT / STACK', steps: 'HOW / TO', data: 'DATA / BOARD', compare: 'COMPARE / MODE', evidence: 'SOURCE / LOG', timeline: 'TIME / LINE', risk: 'BOUNDARY / CHECK', ending: 'NEXT / MOVE' },
});
const NEON_TEMPLATE_IDS = new Set(['hero-metrics', 'problem-stack', 'feature-stack', 'steps-rail', 'metric-board', 'comparison-board', 'evidence-ledger', 'timeline-rail', 'risk-frame', 'closing-cta']);

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
  return `${continuationBadge(page)}${lines.map((line) => `<span class="cover-title-line">${escapeHtml(line)}</span>`).join('')}`;
}

function metricMarkup(page) {
  if (page.kind !== 'cover' || (Array.isArray(page.content_blocks) && page.content_blocks.length)) return '';
  const text = String(page.lead || page.summary || (Array.isArray(page.evidence) ? page.evidence[0] : '') || '').trim();
  if (!text) return '';
  return `<div class="neon-cover-metric"><b>01</b><span>${escapeHtml(text.length > 80 ? `${text.slice(0, 79)}…` : text)}</span></div>`;
}

function renderNeonBlocks(page, { pageLayout, pageRole }) {
  const blocks = Array.isArray(page.content_blocks) ? page.content_blocks : [];
  const body = blocks.map((block, index) => `<div class="neon-unit neon-unit-${index + 1}">${renderStoryboardBlock(block, { pageLayout, pageRole })}</div>`).join('');
  if (body) return body;
  const evidence = (Array.isArray(page.evidence) ? page.evidence : []).filter(Boolean);
  return evidence.length ? `<div class="neon-unit neon-evidence-list"><ul>${evidence.map((item) => `<li>${renderTechnicalText(item)}</li>`).join('')}</ul></div>` : '';
}

export function renderNeonStoryboardSections({
  topic, repository, pages, compiledTheme, compositionMode = 'template', compositionSeed = '', forceSafeComposition = false,
  relaxedDensityPages = false, expandedDensityPages = false, contentType = 'repository', sourceLabel = '', disclosure = '',
  channelMode = 'wechat', coverTitleLines = null,
}) {
  const usedByRole = new Map();
  const labels = LABELS[contentType] || LABELS.repository;
  return (Array.isArray(pages) ? pages : []).map((page, index) => {
    const pageKind = page.kind === 'cover' ? 'cover' : page.kind === 'ending' ? 'ending' : 'content';
    const role = SOCIAL_CARD_PAGE_ROLES.includes(page?.role) ? page.role : inferCardPageRole(page);
    const decision = resolveCardCompositionDecision(page, { compositionMode, layoutStyle: 'auto', channelMode, pageIndex: index, seed: compositionSeed || topic, forceSafe: selected(forceSafeComposition, index), avoidIds: usedByRole.get(role) || [] });
    if (!usedByRole.has(role)) usedByRole.set(role, []);
    if (decision.composition?.id) usedByRole.get(role).push(decision.composition.id);
    const blocks = Array.isArray(page.content_blocks) ? page.content_blocks : [];
    const density = cardPageDensity(page);
    const densityAdjustment = selected(expandedDensityPages, index) ? 'expanded' : selected(relaxedDensityPages, index) ? 'relaxed' : 'none';
    const label = labels[role] || (pageKind === 'ending' ? 'NEXT / MOVE' : 'TOOL / CARD');
    const brand = pageBrand({ contentType, channelMode, sourceLabel, repository, topic });
    const footer = disclosure || (contentType === 'event' ? '据公开素材整理 · 未核实内容已标注' : contentType === 'technology' ? '据开源技术资料整理 · 机制与性能以来源为准' : contentType === 'trend' ? '据公开开源信号整理 · 趋势判断不等同于事实' : contentType === 'custom' ? '内容整理自作者素材 · 建议性内容未实测' : '基于项目文档整理 · 未实际运行');
    const defaultTemplateId = ({ cover: 'hero-metrics', concept: 'problem-stack', feature: 'feature-stack', steps: 'steps-rail', data: 'metric-board', compare: 'comparison-board', evidence: 'evidence-ledger', timeline: 'timeline-rail', risk: 'risk-frame', ending: 'closing-cta' }[role] || 'problem-stack');
    const requestedTemplateId = String(page.layout_intent || '').trim();
    const templateId = NEON_TEMPLATE_IDS.has(requestedTemplateId) ? requestedTemplateId : defaultTemplateId;
    const layoutClass = `neon-role-${role} neon-template-${templateId}`;
    const title = titleMarkup(page, topic, coverTitleLines);
    return `<section class="page page-${pageKind} skeleton-terminal-rail template-neon-v1 ${layoutClass} density-${density}${densityAdjustment === 'none' ? '' : ` density-${densityAdjustment}`} blocks-${blocks.length} items-${Math.min(9, blocks.reduce((n, block) => n + (block?.type === 'list' ? listBlockValues(block).length : 0), 0))}" data-page-kind="${pageKind}" data-page-role="${role}" data-template-id="${escapeHtml(templateId)}" data-template-pack="neon-v1" data-template-version="1" data-composition-mode="${decision.mode}" data-composition-id="${escapeHtml(decision.composition?.id || '')}" data-layout-source="neon-v1" data-density="${density}" data-density-adjustment="${densityAdjustment}" data-block-count="${blocks.length}" data-page-number="${index + 1}"><div class="page-inner"><header class="page-header"><span class="brand" data-text-role="auxiliary">${escapeHtml(brand)}</span><span class="page-number" data-text-role="auxiliary">${String(index + 1).padStart(2, '0')}</span></header><main class="page-body"><div class="page-content-stack"><div class="neon-kicker" data-text-role="auxiliary"><span class="neon-dot"></span>${label}<span class="neon-slash">//</span></div><h1>${title}</h1>${metricMarkup(page)}<div class="neon-block-stack">${renderNeonBlocks(page, { pageLayout: role === 'steps' ? 'steps' : role, pageRole: role })}</div></div></main><footer class="page-footer"><span data-text-role="auxiliary">${escapeHtml(footer)}</span><i></i></footer></div></section>`;
  }).join('\n');
}

export const NEON_V1_CSS = `
.template-neon-v1{--neon-grid:color-mix(in srgb,var(--accent) 9%,transparent);background-color:var(--page);background-image:linear-gradient(var(--neon-grid) 1px,transparent 1px),linear-gradient(90deg,var(--neon-grid) 1px,transparent 1px);background-size:18px 18px}
.template-neon-v1:after{width:220px;height:220px;right:-112px;top:-104px;border:1px solid var(--accent2);border-radius:50%;opacity:.28;box-shadow:0 0 30px color-mix(in srgb,var(--accent2) 22%,transparent)}
.template-neon-v1 .page-inner{padding:24px 22px 20px}.template-neon-v1 .page-header{border-bottom:1px solid color-mix(in srgb,var(--line) 82%,transparent);padding-bottom:10px}.template-neon-v1 .brand{font-size:10px;letter-spacing:.12em}.template-neon-v1 .page-number{font-size:10px}.template-neon-v1 .page-body{align-items:stretch;padding:16px 0}.template-neon-v1 .page-content-stack{min-height:100%;padding:21px 18px 18px;justify-content:flex-start;gap:12px;border:1px solid var(--line);border-radius:var(--radius);background:linear-gradient(145deg,color-mix(in srgb,var(--surface) 94%,transparent),color-mix(in srgb,var(--page) 45%,var(--surface)));box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 4%,transparent),0 14px 28px color-mix(in srgb,var(--code) 26%,transparent)}
.template-neon-v1 .page-content-stack:before{content:"";position:absolute;left:0;top:0;width:58px;border-top:2px solid var(--accent2);box-shadow:80px 0 0 var(--accent)}.template-neon-v1 .neon-kicker{display:flex;align-items:center;gap:7px;font:800 9px/1.2 ui-monospace,Consolas,monospace;letter-spacing:.14em;color:var(--accent)}.template-neon-v1 .neon-dot{width:7px;height:7px;border-radius:50%;background:var(--accent2);box-shadow:0 0 10px var(--accent2)}.template-neon-v1 .neon-slash{margin-left:auto;color:var(--accent2);opacity:.8}.template-neon-v1 h1{font-size:27px;line-height:1.12;letter-spacing:-.04em;color:var(--ink);margin:3px 0 0}.template-neon-v1.page-cover h1{font-size:39px;line-height:1.02;max-width:96%;margin-top:auto;padding-top:16px}.neon-title-line{display:block}.template-neon-v1 .neon-cover-metric{display:flex;gap:10px;align-items:baseline;border-top:1px solid var(--line);padding-top:10px;margin-top:auto;color:var(--muted);font-size:11px;line-height:1.45}.template-neon-v1 .neon-cover-metric b{font:800 28px/1 ui-monospace,Consolas,monospace;color:var(--accent)}.template-neon-v1 .neon-block-stack{display:grid;gap:10px;min-height:0}.template-neon-v1 .neon-unit{min-width:0}.template-neon-v1 .content-block{gap:6px;padding:10px 11px;border:1px solid color-mix(in srgb,var(--line) 80%,transparent);background:color-mix(in srgb,var(--surface) 82%,transparent);border-radius:2px}.template-neon-v1 .content-block h2{font:800 10px/1.3 ui-monospace,Consolas,monospace;letter-spacing:.08em;color:var(--accent2);text-transform:uppercase}.template-neon-v1 .content-block p,.template-neon-v1 .content-block li{font-size:11px;line-height:1.42}.template-neon-v1 .page ul{gap:6px}.template-neon-v1 .page li{padding:7px 8px 7px 25px;background:color-mix(in srgb,var(--accent) 9%,transparent);border-left:2px solid var(--accent);border-radius:0}.template-neon-v1 .page li:before{left:9px;top:12px;width:6px;height:6px;border-radius:0;background:var(--accent2)}.template-neon-v1 .code-block pre{background:#020403;border:1px solid var(--line);border-radius:0}.template-neon-v1 .note-block{border-left:3px solid var(--accent2);border-radius:0;background:color-mix(in srgb,var(--accent2) 10%,transparent)}.template-neon-v1 .stat-row{gap:7px}.template-neon-v1 .stat{padding:9px 7px;border-radius:2px;text-align:left;background:color-mix(in srgb,var(--accent) 8%,transparent);border-color:var(--line)}.template-neon-v1 .stat b{font:800 20px/1.1 ui-monospace,Consolas,monospace}.template-neon-v1 .compare-block{overflow:hidden}.template-neon-v1 .compare-block th{background:var(--accent);color:var(--inverse);border:0}.template-neon-v1 .compare-block td{font-size:10px;padding:6px;border-color:var(--line)}.template-neon-v1 .step{border-bottom:1px solid var(--line);padding-bottom:8px}.template-neon-v1 .step>b{border-radius:2px;background:var(--accent2);color:var(--inverse);font-family:ui-monospace,Consolas,monospace}.template-neon-v1 .step h3{font-size:11px}.template-neon-v1 .tl-node{border-color:var(--accent)}.template-neon-v1 .tl-node:before{border-radius:0;background:var(--accent2)}.template-neon-v1 .highlight-block{border-left:4px solid var(--accent2);border-radius:0;background:color-mix(in srgb,var(--accent2) 12%,transparent)}.template-neon-v1 .page-footer{font:9px ui-monospace,Consolas,monospace}.template-neon-v1 .page-footer i{background:var(--accent2)}
.template-neon-v1.page-cover h1{color:var(--ink)}.template-neon-v1.page-cover h1 .cover-title-line{background:var(--accent);color:var(--inverse);box-shadow:4px 0 0 var(--accent2);padding:5px 10px;margin:3px 0;width:fit-content;max-width:100%;display:block;overflow-wrap:anywhere}.template-neon-v1.page-cover h1 .cover-title-line:nth-child(even){background:var(--code);color:var(--ink);box-shadow:-4px 0 0 var(--accent2)}
.template-neon-v1.page-ending .page-content-stack{background:var(--accent);color:var(--inverse);border-color:var(--accent);justify-content:center}.template-neon-v1.page-ending .neon-kicker,.template-neon-v1.page-ending h1,.template-neon-v1.page-ending .content-block h2,.template-neon-v1.page-ending .content-block p,.template-neon-v1.page-ending .content-block li{color:var(--inverse)}.template-neon-v1.page-ending .content-block{border-color:color-mix(in srgb,var(--inverse) 35%,transparent);background:color-mix(in srgb,var(--inverse) 8%,transparent)}.template-neon-v1.page-ending .neon-dot{background:var(--inverse);box-shadow:none}.template-neon-v1.density-relaxed .page-content-stack{gap:15px}.template-neon-v1.density-expanded .page-content-stack{gap:18px}.template-neon-v1.density-expanded .content-block{padding-block:13px}.template-neon-v1[data-composition-mode="smart"] .page-content-stack{justify-content:flex-start}.template-neon-v1[data-layout-source="safe"] .page-content-stack:before{display:none}
.template-neon-v1 .page-footer{font-size:11px}.template-neon-v1 .brand{font-size:11px}.template-neon-v1 .content-block h2{font-size:11px}
.template-neon-v1 .neon-slash{font-size:11px}
/* Keep comparison cell text above the 11px body-text audit floor. */
.template-neon-v1 .compare-block td{font-size:11px}
/* Stage 1: keep the kicker aligned with content pages and center the cover body group. */
.template-neon-v1.page-cover .page-content-stack{justify-content:flex-start}
.template-neon-v1.page-cover h1{margin-top:auto;margin-bottom:0}
.template-neon-v1.page-cover .neon-cover-metric{margin-top:0}
.template-neon-v1.page-cover .neon-block-stack{margin-bottom:auto}
`;
