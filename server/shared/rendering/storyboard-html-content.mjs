import { listBlockValues } from './social-card-plan.mjs';
export { escapeHtml } from './html-utils.mjs';
import { escapeHtml } from './html-utils.mjs';
import { normalizeSocialCardCode, parseSocialCardFencedCode } from './social-card-code-utils.mjs';

const TECHNICAL_TOKEN_RE = /https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+|(?<![A-Za-z0-9_])(?:npx|npm|pnpm|yarn|bun|git|curl|wget|pip|uv|brew|docker|python|node)\s+[A-Za-z0-9@._~:/?=&%+\\-]+(?:\s+[A-Za-z0-9@._~:/?=&%+\\-]+)*/giu;

function trimTechnicalToken(token) {
  const value = String(token || '');
  const trailing = value.match(/[.,;:!?\u3002\uff0c\uff1b\uff1a\uff01\uff1f)\]}]+$/u)?.[0] || '';
  return { token: trailing ? value.slice(0, -trailing.length) : value, trailing };
}

/** 将命令和 URL 转成可换行的技术片段，保留原文，不让长 token 撑破卡片。 */
export function renderTechnicalText(value = '') {
  const text = String(value ?? '');
  let html = '';
  let cursor = 0;
  for (const match of text.matchAll(TECHNICAL_TOKEN_RE)) {
    const start = match.index ?? 0;
    const { token, trailing } = trimTechnicalToken(match[0]);
    if (!token) continue;
    html += escapeHtml(text.slice(cursor, start));
    const className = /^https?:\/\//iu.test(token)
      ? 'inline-technical technical-url'
      : 'inline-technical technical-command';
    html += `<code class="${className}">${escapeHtml(token)}</code>${escapeHtml(trailing)}`;
    cursor = start + match[0].length;
  }
  return `${html}${escapeHtml(text.slice(cursor))}`;
}

/** 续页只在第二页起显示，避免普通页面增加噪音。 */
export function continuationBadge(page) {
  const index = Number(page?.continuation_index || 0);
  return index > 1
    ? `<span class="continuation-badge" data-text-role="auxiliary">CONTINUED · ${String(index).padStart(2, '0')}</span>`
    : '';
}

export function numberedTextSteps(content = '') {
  const text = String(content).trim();
  // 只识别行首编号；小数（27.8、3436.9）不是步骤标记。
  const starts = [...text.matchAll(/(?:^|\s)(\d+)(?:\.\s+|、\s*)/g)];
  if (starts.length < 2) return [];
  return starts.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < starts.length ? starts[index + 1].index : text.length;
    const value = text.slice(start, end).trim();
    const [first, ...rest] = value.split(/[：:]\s*/);
    return {
      title: rest.length ? first : `第 ${index + 1} 步`,
      content: rest.length ? rest.join('：').trim() : value,
    };
  }).filter((item) => item.content);
}

function blockFontScale(block) {
  const raw = Number(block?.font_scale ?? block?.fontScale ?? 1);
  if (!Number.isFinite(raw)) return 1;
  const max = String(block?.type || '') === 'code' ? 1.12 : 1.18;
  return Math.min(max, Math.max(1, raw));
}

function typographyStyle(scale, base, lineHeight = 1.45) {
  if (scale <= 1) return '';
  const size = (Number(base) * scale).toFixed(2).replace(/0+$/u, '').replace(/\.$/u, '');
  const line = Math.min(1.75, Number(lineHeight) * Math.min(scale, 1.12)).toFixed(2).replace(/0+$/u, '').replace(/\.$/u, '');
  return ` style="font-size:${size}px;line-height:${line}"`;
}

function normalizeStepItem(item) {
  if (item && typeof item === 'object') return item;
  const text = String(item ?? '').trim();
  return { title: text, content: '' };
}

const VISUAL_EMPHASIS = new Set(['normal', 'strong', 'hero']);
const VISUAL_TONES = new Set(['default', 'accent', 'danger', 'success', 'warning', 'muted']);
const VISUAL_ICONS = Object.freeze({
  metric: '↗',
  ai: '✦',
  price: '¥',
  warning: '!',
  source: '◉',
  user: '◎',
  timeline: '→',
  rocket: '↗',
});

function normalizeVisual(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const visual = {};
  if (VISUAL_EMPHASIS.has(String(value.emphasis || ''))) visual.emphasis = String(value.emphasis);
  if (VISUAL_TONES.has(String(value.tone || ''))) visual.tone = String(value.tone);
  if (String(value.icon || '') === 'none') visual.icon = 'none';
  else if (Object.hasOwn(VISUAL_ICONS, String(value.icon || ''))) visual.icon = String(value.icon);
  if (typeof value.badge === 'string' && value.badge.trim()) visual.badge = value.badge.trim().slice(0, 12);
  return visual;
}

function visualClassNames(value) {
  const visual = normalizeVisual(value);
  return [
    visual.emphasis && `visual-emphasis-${visual.emphasis}`,
    visual.tone && `visual-tone-${visual.tone}`,
    visual.icon && visual.icon !== 'none' && `visual-icon-${visual.icon}`,
  ].filter(Boolean).join(' ');
}

function renderVisualMeta(value) {
  const visual = normalizeVisual(value);
  const icon = visual.icon && visual.icon !== 'none'
    ? `<span class="visual-icon" aria-hidden="true">${VISUAL_ICONS[visual.icon]}</span>`
    : '';
  const badge = visual.badge ? `<span class="visual-badge" data-visual-badge="true">${escapeHtml(visual.badge)}</span>` : '';
  return icon || badge ? `<span class="visual-meta">${icon}${badge}</span>` : '';
}

function visualRun(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.text !== 'string') return null;
  const run = { text: value.text };
  if (typeof value.role === 'string' && ['normal', 'metric', 'label', 'warning', 'source'].includes(value.role)) run.role = value.role;
  if (VISUAL_TONES.has(String(value.tone || ''))) run.tone = String(value.tone);
  if (['normal', 'strong'].includes(String(value.emphasis || ''))) run.emphasis = String(value.emphasis);
  return run;
}

function hasCompleteVisualRuns(value, runs = []) {
  const text = String(value ?? '');
  const normalized = Array.isArray(runs) ? runs.map(visualRun) : [];
  return normalized.length > 0
    && normalized.every(Boolean)
    && normalized.map((run) => run.text).join('') === text;
}

/** 只在 runs 按原文完整覆盖 content 时启用，失败则退回普通安全文本。 */
function renderVisualText(value, runs = []) {
  const text = String(value ?? '');
  const normalized = Array.isArray(runs) ? runs.map(visualRun) : [];
  if (!normalized.length || normalized.some((run) => !run) || normalized.map((run) => run.text).join('') !== text) return renderTechnicalText(text);
  return normalized.map((run) => {
    const classes = [
      'visual-run',
      run.role && `visual-role-${run.role}`,
      run.tone && `visual-tone-${run.tone}`,
      run.emphasis && `visual-emphasis-${run.emphasis}`,
    ].filter(Boolean).join(' ');
    return `<span class="${classes}">${renderTechnicalText(run.text)}</span>`;
  }).join('');
}

function blockFrame(type, block, scale, body, tag = 'div', extraClass = '') {
  const visual = visualClassNames(block?.visual);
  const className = ['content-block', `${type}-block`, extraClass, visual].filter(Boolean).join(' ');
  const title = block?.title ? `<h2${typographyStyle(scale, 11, 1.3)}>${escapeHtml(block.title)}</h2>` : '';
  return `<${tag} class="${className}">${renderVisualMeta(block?.visual)}${title}${body}</${tag}>`;
}

function structuredItemText(item, fallback = '') {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return String(item ?? fallback);
  return [item.title || item.label || item.time || item.date, item.content || item.text || item.description || item.fact]
    .filter(Boolean).join('：') || String(fallback || '');
}

export function renderStoryboardBlock(block, { pageLayout = 'stacked', pageRole = '' } = {}) {
  const scale = blockFontScale(block);
  const content = String(block.content || '').trim();
  const fencedCode = parseSocialCardFencedCode(content);
  const items = Array.isArray(block.items) ? block.items : [];
  const inferredSteps = pageLayout === 'steps' && pageRole === 'steps' && block.type === 'text'
    ? numberedTextSteps(content)
    : [];
  if (inferredSteps.length) return blockFrame('steps', block, scale, `<div class="step-col">${inferredSteps.map((item, index) => `<div class="step"><b>${index + 1}</b><div><h3${typographyStyle(scale, 11, 1.3)}>${escapeHtml(item.title)}</h3><p${typographyStyle(scale, 11, 1.45)}>${renderTechnicalText(item.content)}</p></div></div>`).join('')}</div>`);
  if (block.type === 'code' || (fencedCode && ['list', 'text', 'note', 'highlight'].includes(String(block.type || '')))) {
    const code = fencedCode ? fencedCode.content : normalizeSocialCardCode(content);
    return blockFrame('code', block, scale, `<pre><code${typographyStyle(scale, 10, 1.45)}>${escapeHtml(code)}</code></pre>`);
  }
  if (block.type === 'list') {
    const cleanListItem = (item) => String(item).replace(/^[-*+•·✓✔✅☑]\uFE0F?\s*/u, '').trim();
    const lines = listBlockValues(block).map((item) => {
      const text = cleanListItem(structuredItemText(item));
      return { text, visual: item && typeof item === 'object' ? item.visual : null, contentRuns: item && typeof item === 'object' ? item.content_runs : [] };
    });
    return blockFrame('list', block, scale, `<ul>${lines.filter((item) => item.text).map((item) => { const classes = hasCompleteVisualRuns(item.text, item.contentRuns) ? '' : visualClassNames(item.visual); return `<li${classes ? ` class="${classes}"` : ''}${typographyStyle(scale, 11, 1.45)}>${renderVisualMeta(item.visual)}${renderVisualText(item.text, item.contentRuns)}</li>`; }).join('')}</ul>`);
  }
  if (block.type === 'note') return blockFrame('note', block, scale, `<p${typographyStyle(scale, 11, 1.5)}>${renderVisualText(content, block.content_runs)}</p>`, 'aside');
  if (block.type === 'stats' && items.length) return blockFrame('stats', block, scale, `<div class="stat-row">${items.map((item) => {
    const stat = item && typeof item === 'object' ? item : { num: item };
    const statValue = stat.num || stat.value || '';
    const classes = hasCompleteVisualRuns(statValue, stat.content_runs) ? '' : visualClassNames(stat.visual);
    return `<div class="stat${classes ? ` ${classes}` : ''}">${renderVisualMeta(stat.visual)}<b${typographyStyle(scale, 19, 1.1)}>${renderVisualText(statValue, stat.content_runs)}</b><span data-text-role="auxiliary"${typographyStyle(scale, 9, 1.3)}>${escapeHtml(stat.label || '')}</span></div>`;
  }).join('')}</div>`);
  if (block.type === 'compare' && ((Array.isArray(block.headers) && block.headers.length) || (Array.isArray(block.rows) && block.rows.length))) {
    const headers = Array.isArray(block.headers) ? block.headers : [];
    const rows = Array.isArray(block.rows) ? block.rows : [];
    const cellMarkup = (cell) => {
      const value = structuredItemText(cell);
      const visual = cell && typeof cell === 'object' ? cell.visual : null;
      return `${renderVisualMeta(visual)}${renderVisualText(value, cell && typeof cell === 'object' ? cell.content_runs : [])}`;
    };
    return blockFrame('compare', block, scale, `<table><thead><tr>${headers.map((cell) => `<th data-text-role="auxiliary"${typographyStyle(scale, 9, 1.3)}>${cellMarkup(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${(Array.isArray(row) ? row : []).map((cell) => { const value = structuredItemText(cell); const runs = cell && typeof cell === 'object' ? cell.content_runs : []; const classes = hasCompleteVisualRuns(value, runs) ? '' : visualClassNames(cell && typeof cell === 'object' ? cell.visual : null); return `<td${classes ? ` class="${classes}"` : ''}${typographyStyle(scale, 11, 1.4)}>${cellMarkup(cell)}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`);
  }
  if (block.type === 'steps' && items.length) return blockFrame('steps', block, scale, `<div class="step-col">${items.map((rawItem, index) => { const item = normalizeStepItem(rawItem); const content = item.content || ''; const classes = hasCompleteVisualRuns(content, item.content_runs) ? '' : visualClassNames(item.visual); return `<div class="step${classes ? ` ${classes}` : ''}"><b${typographyStyle(scale, 11, 1.2)}>${index + 1}</b><div>${renderVisualMeta(item.visual)}<h3${typographyStyle(scale, 11, 1.3)}>${escapeHtml(item.title || '')}</h3><p${typographyStyle(scale, 11, 1.45)}>${renderVisualText(content, item.content_runs)}</p></div></div>`; }).join('')}</div>`);
  if (block.type === 'timeline' && items.length >= 2) return blockFrame('timeline', block, scale, `<div class="tl">${items.map((item) => { const content = item.content || item.text || item.fact || item.description || ''; const classes = hasCompleteVisualRuns(content, item.content_runs) ? '' : visualClassNames(item.visual); return `<div class="tl-node${classes ? ` ${classes}` : ''}"><span class="tl-time" data-text-role="auxiliary"${typographyStyle(scale, 9, 1.3)}>${escapeHtml(item.time || item.date || '')}</span>${renderVisualMeta(item.visual)}<h3${typographyStyle(scale, 11, 1.3)}>${escapeHtml(item.title || item.event || item.label || '')}</h3><p${typographyStyle(scale, 11, 1.45)}>${renderVisualText(content, item.content_runs)}</p></div>`; }).join('')}</div>`);
  if (block.type === 'timeline' && items.length === 1) {
    const item = items[0] || {};
    const singleTimelineText = [item.time || item.date, item.title || item.event || item.label, item.content || item.text || item.fact || item.description]
      .filter(Boolean).join('：');
    return blockFrame('text', block, scale, `<p${typographyStyle(scale, 11, 1.5)}>${renderVisualText(singleTimelineText || content, block.content_runs)}</p>`);
  }
  if (block.type === 'scenes' && items.length) return blockFrame('scenes', block, scale, `<div class="scene-row">${items.map((item) => { const content = item.content || ''; const classes = hasCompleteVisualRuns(content, item.content_runs) ? '' : visualClassNames(item.visual); return `<div class="scene${classes ? ` ${classes}` : ''}">${renderVisualMeta(item.visual)}<h3${typographyStyle(scale, 11, 1.3)}>${escapeHtml(item.title || '')}</h3><p${typographyStyle(scale, 11, 1.45)}>${renderVisualText(content, item.content_runs)}</p></div>`; }).join('')}</div>`);
  if (block.type === 'scenes' && content) {
    const lines = content.split(/\n+/).map((item) => item.replace(/^[-*+•·✓✔✅☑]\uFE0F?\s*/u, '').trim()).filter(Boolean);
    return blockFrame('list', block, scale, `<ul>${lines.map((item) => `<li${typographyStyle(scale, 11, 1.45)}>${renderTechnicalText(item)}</li>`).join('')}</ul>`, 'div', 'scenes-block');
  }
  if (block.type === 'highlight') return blockFrame('highlight', block, scale, `<p${typographyStyle(scale, 11, 1.5)}>${renderVisualText(content, block.content_runs)}</p>`);
  if ((block.type === 'steps' || block.type === 'timeline') && content) {
    const lines = content.split(/\n+/).map((item) => item.replace(/^[-*+]\s*/, '').trim()).filter(Boolean);
    return blockFrame('list', block, scale, `<ul>${lines.map((item) => `<li${typographyStyle(scale, 11, 1.45)}>${renderTechnicalText(item)}</li>`).join('')}</ul>`);
  }
  return blockFrame('text', block, scale, `<p${typographyStyle(scale, 11, 1.5)}>${renderVisualText(content, block.content_runs)}</p>`);
}
