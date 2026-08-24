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

export function renderStoryboardBlock(block, { pageLayout = 'stacked', pageRole = '' } = {}) {
  const scale = blockFontScale(block);
  const title = block.title ? `<h2${typographyStyle(scale, 11, 1.3)}>${escapeHtml(block.title)}</h2>` : '';
  const content = String(block.content || '').trim();
  const fencedCode = parseSocialCardFencedCode(content);
  const items = Array.isArray(block.items) ? block.items : [];
  const inferredSteps = pageLayout === 'steps' && pageRole === 'steps' && block.type === 'text'
    ? numberedTextSteps(content)
    : [];
  if (inferredSteps.length) return `<div class="content-block steps-block">${title}<div class="step-col">${inferredSteps.map((item, index) => `<div class="step"><b>${index + 1}</b><div><h3${typographyStyle(scale, 11, 1.3)}>${escapeHtml(item.title)}</h3><p${typographyStyle(scale, 11, 1.45)}>${renderTechnicalText(item.content)}</p></div></div>`).join('')}</div></div>`;
  if (block.type === 'code' || (fencedCode && ['list', 'text', 'note', 'highlight'].includes(String(block.type || '')))) {
    const code = fencedCode ? fencedCode.content : normalizeSocialCardCode(content);
    return `<div class="content-block code-block">${title}<pre><code${typographyStyle(scale, 10, 1.45)}>${escapeHtml(code)}</code></pre></div>`;
  }
  if (block.type === 'list') {
    const cleanListItem = (item) => String(item).replace(/^[-*+•·✓✔✅☑]\uFE0F?\s*/u, '').trim();
    const lines = listBlockValues(block).map((item) => cleanListItem(typeof item === 'string' ? item : [item?.title, item?.content].filter(Boolean).join('：')));
    return `<div class="content-block list-block">${title}<ul>${lines.filter(Boolean).map((item) => `<li${typographyStyle(scale, 11, 1.45)}>${renderTechnicalText(item)}</li>`).join('')}</ul></div>`;
  }
  if (block.type === 'note') return `<aside class="content-block note-block">${title}<p${typographyStyle(scale, 11, 1.5)}>${renderTechnicalText(content)}</p></aside>`;
  if (block.type === 'stats' && items.length) return `<div class="content-block stats-block">${title}<div class="stat-row">${items.map((item) => `<div class="stat"><b${typographyStyle(scale, 19, 1.1)}>${escapeHtml(item.num || '')}</b><span data-text-role="auxiliary"${typographyStyle(scale, 9, 1.3)}>${escapeHtml(item.label || '')}</span></div>`).join('')}</div></div>`;
  if (block.type === 'compare' && ((Array.isArray(block.headers) && block.headers.length) || (Array.isArray(block.rows) && block.rows.length))) {
    const headers = Array.isArray(block.headers) ? block.headers : [];
    const rows = Array.isArray(block.rows) ? block.rows : [];
    return `<div class="content-block compare-block">${title}<table><thead><tr>${headers.map((cell) => `<th data-text-role="auxiliary"${typographyStyle(scale, 9, 1.3)}>${renderTechnicalText(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${(Array.isArray(row) ? row : []).map((cell) => `<td${typographyStyle(scale, 11, 1.4)}>${renderTechnicalText(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  if (block.type === 'steps' && items.length) return `<div class="content-block steps-block">${title}<div class="step-col">${items.map((item, index) => `<div class="step"><b${typographyStyle(scale, 11, 1.2)}>${index + 1}</b><div><h3${typographyStyle(scale, 11, 1.3)}>${escapeHtml(item.title || '')}</h3><p${typographyStyle(scale, 11, 1.45)}>${renderTechnicalText(item.content || '')}</p></div></div>`).join('')}</div></div>`;
  if (block.type === 'timeline' && items.length >= 2) return `<div class="content-block timeline-block">${title}<div class="tl">${items.map((item) => `<div class="tl-node"><span class="tl-time" data-text-role="auxiliary"${typographyStyle(scale, 9, 1.3)}>${escapeHtml(item.time || item.date || '')}</span><h3${typographyStyle(scale, 11, 1.3)}>${escapeHtml(item.title || item.event || item.label || '')}</h3><p${typographyStyle(scale, 11, 1.45)}>${renderTechnicalText(item.content || item.text || item.fact || item.description || '')}</p></div>`).join('')}</div></div>`;
  if (block.type === 'timeline' && items.length === 1) {
    const item = items[0] || {};
    const singleTimelineText = [item.time || item.date, item.title || item.event || item.label, item.content || item.text || item.fact || item.description]
      .filter(Boolean).join('：');
    return `<div class="content-block text-block">${title}<p${typographyStyle(scale, 11, 1.5)}>${renderTechnicalText(singleTimelineText || content)}</p></div>`;
  }
  if (block.type === 'scenes' && items.length) return `<div class="content-block scenes-block">${title}<div class="scene-row">${items.map((item) => `<div class="scene"><h3${typographyStyle(scale, 11, 1.3)}>${escapeHtml(item.title || '')}</h3><p${typographyStyle(scale, 11, 1.45)}>${renderTechnicalText(item.content || '')}</p></div>`).join('')}</div></div>`;
  if (block.type === 'scenes' && content) {
    const lines = content.split(/\n+/).map((item) => item.replace(/^[-*+•·✓✔✅☑]\uFE0F?\s*/u, '').trim()).filter(Boolean);
    return `<div class="content-block list-block scenes-block">${title}<ul>${lines.map((item) => `<li${typographyStyle(scale, 11, 1.45)}>${renderTechnicalText(item)}</li>`).join('')}</ul></div>`;
  }
  if (block.type === 'highlight') return `<div class="content-block highlight-block">${title}<p${typographyStyle(scale, 11, 1.5)}>${renderTechnicalText(content)}</p></div>`;
  if ((block.type === 'steps' || block.type === 'timeline') && content) {
    const lines = content.split(/\n+/).map((item) => item.replace(/^[-*+]\s*/, '').trim()).filter(Boolean);
    return `<div class="content-block list-block">${title}<ul>${lines.map((item) => `<li${typographyStyle(scale, 11, 1.45)}>${renderTechnicalText(item)}</li>`).join('')}</ul></div>`;
  }
  return `<div class="content-block text-block">${title}<p${typographyStyle(scale, 11, 1.5)}>${renderTechnicalText(content)}</p></div>`;
}
