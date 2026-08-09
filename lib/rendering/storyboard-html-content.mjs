import { listBlockValues } from './social-card-plan.mjs';

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
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

export function renderStoryboardBlock(block, { pageLayout = 'stacked', pageRole = '' } = {}) {
  const title = block.title ? `<h2>${escapeHtml(block.title)}</h2>` : '';
  const content = String(block.content || '').trim();
  const items = Array.isArray(block.items) ? block.items : [];
  const inferredSteps = pageLayout === 'steps' && pageRole === 'steps' && block.type === 'text'
    ? numberedTextSteps(content)
    : [];
  if (inferredSteps.length) return `<div class="content-block steps-block">${title}<div class="step-col">${inferredSteps.map((item, index) => `<div class="step"><b>${index + 1}</b><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.content)}</p></div></div>`).join('')}</div></div>`;
  if (block.type === 'code') return `<div class="content-block code-block">${title}<pre><code>${escapeHtml(content)}</code></pre></div>`;
  if (block.type === 'list') {
    const cleanListItem = (item) => String(item).replace(/^[-*+•·✓✔✅☑]\uFE0F?\s*/u, '').trim();
    const lines = listBlockValues(block).map((item) => cleanListItem(typeof item === 'string' ? item : [item?.title, item?.content].filter(Boolean).join('：')));
    return `<div class="content-block list-block">${title}<ul>${lines.filter(Boolean).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`;
  }
  if (block.type === 'note') return `<aside class="content-block note-block">${title}<p>${escapeHtml(content)}</p></aside>`;
  if (block.type === 'stats' && items.length) return `<div class="content-block stats-block">${title}<div class="stat-row">${items.map((item) => `<div class="stat"><b>${escapeHtml(item.num || '')}</b><span data-text-role="auxiliary">${escapeHtml(item.label || '')}</span></div>`).join('')}</div></div>`;
  if (block.type === 'compare' && ((Array.isArray(block.headers) && block.headers.length) || (Array.isArray(block.rows) && block.rows.length))) {
    const headers = Array.isArray(block.headers) ? block.headers : [];
    const rows = Array.isArray(block.rows) ? block.rows : [];
    return `<div class="content-block compare-block">${title}<table><thead><tr>${headers.map((cell) => `<th data-text-role="auxiliary">${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${(Array.isArray(row) ? row : []).map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  if (block.type === 'steps' && items.length) return `<div class="content-block steps-block">${title}<div class="step-col">${items.map((item, index) => `<div class="step"><b>${index + 1}</b><div><h3>${escapeHtml(item.title || '')}</h3><p>${escapeHtml(item.content || '')}</p></div></div>`).join('')}</div></div>`;
  if (block.type === 'timeline' && items.length) return `<div class="content-block timeline-block">${title}<div class="tl">${items.map((item) => `<div class="tl-node"><span class="tl-time" data-text-role="auxiliary">${escapeHtml(item.time || '')}</span><h3>${escapeHtml(item.title || '')}</h3><p>${escapeHtml(item.content || '')}</p></div>`).join('')}</div></div>`;
  if (block.type === 'scenes' && items.length) return `<div class="content-block scenes-block">${title}<div class="scene-row">${items.map((item) => `<div class="scene"><h3>${escapeHtml(item.title || '')}</h3><p>${escapeHtml(item.content || '')}</p></div>`).join('')}</div></div>`;
  if (block.type === 'highlight') return `<div class="content-block highlight-block">${title}<p>${escapeHtml(content)}</p></div>`;
  if ((block.type === 'steps' || block.type === 'timeline') && content) {
    const lines = content.split(/\n+/).map((item) => item.replace(/^[-*+]\s*/, '').trim()).filter(Boolean);
    return `<div class="content-block list-block">${title}<ul>${lines.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`;
  }
  return `<div class="content-block text-block">${title}<p>${escapeHtml(content)}</p></div>`;
}
