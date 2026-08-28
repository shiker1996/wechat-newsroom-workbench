import { normalizeCardComposition } from './social-card-composition.mjs';

const INSTRUCTION_PATTERNS = [
  /^让读者(?:一眼)?知道/, /^让读者/, /^读者(?:能|会|可以|理解|了解|知道)/,
  /^本页(?:旨在|希望|要|应该|目的(?:是|为))?/, /^这一页(?:旨在|希望|要|应该|目的(?:是|为))?/,
  /^本卡(?:旨在|希望|要|应该|目的(?:是|为))?/, /^本章节(?:旨在|希望|要|应该|目的(?:是|为))?/, /^请/,
];

function cleanInstructionText(text) {
  if (typeof text !== 'string') return text;
  let value = text.trim();
  for (const pattern of INSTRUCTION_PATTERNS) value = value.replace(pattern, '').trim();
  return value.replace(/^[，。；、:：\s]+/, '').trim();
}

function cleanStructuredItem(item, blockType) {
  if (typeof item === 'string') return cleanInstructionText(item);
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const next = Object.fromEntries(Object.entries(item).map(([key, value]) => [
    key,
    typeof value === 'string' ? cleanInstructionText(value) : value,
  ]));
  if (blockType === 'timeline') {
    // 时间线模型偶尔把正文放在 text/fact，渲染契约使用 content。
    // 在故事板入口统一归一化，避免时间能显示但事件正文为空。
    const title = String(next.title || next.event || next.label || '').trim();
    const content = String(next.content || next.text || next.fact || next.description || '').trim();
    if (title && !next.title) next.title = title;
    if (content && !next.content) next.content = content;
    for (const key of ['event', 'label', 'text', 'fact', 'description']) delete next[key];
  }
  return next;
}

function legacyListContentItems(content) {
  if (Array.isArray(content)) return content;
  const value = String(content || '').trim();
  if (!value) return [];
  const lines = value.split(/\r?\n+/).map((item) => item.trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  if (/[；;]/u.test(value)) {
    const items = value.split(/[；;]/u).map((item) => item.trim()).filter(Boolean);
    if (items.length > 1) return items;
  }
  // 旧版重排器曾把列表数组 join 成逗号字符串。只有在同一字符串
  // 至少包含两个年份节点时才拆 ASCII 逗号，避免误拆普通句子里的逗号。
  if ((value.match(/\d{4}年/g) || []).length >= 2 && value.includes(',')) {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function listItemDisplayText(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return String(item ?? '');
  return [item.title || item.label || item.time || item.date, item.content || item.text || item.description]
    .filter(Boolean).join('：');
}

// 故事板里的 visual 首先是“关键信息提取”，不是渲染参数。
// AI 没有显式标注时，只做保守的语义兜底：优先标记结构本身已经表达
// 变化、对比、边界和路径的内容块；普通背景段落不自动装饰。
const DEFAULT_BLOCK_VISUALS = Object.freeze({
  compare: { emphasis: 'strong', tone: 'accent', icon: 'metric', badge: '对比信号' },
  stats: { emphasis: 'hero', tone: 'accent', icon: 'metric', badge: '核心数据' },
  timeline: { emphasis: 'strong', tone: 'accent', icon: 'timeline', badge: '时间变化' },
  highlight: { emphasis: 'strong', tone: 'accent', icon: 'rocket', badge: '关键变化' },
  steps: { emphasis: 'strong', tone: 'accent', icon: 'rocket', badge: '操作路径' },
  note: { tone: 'warning', icon: 'warning', badge: '事实边界' },
});

const VISUAL_TITLE_HINTS = [
  { pattern: /价格|涨价|上涨|下跌|下降|跌幅/u, visual: { emphasis: 'strong', tone: 'danger', icon: 'price', badge: '价格变化' } },
  { pattern: /性能|数据|指标|增长|收入|利润|参数/u, visual: { emphasis: 'strong', tone: 'accent', icon: 'metric', badge: '数据重点' } },
  { pattern: /AI|模型|智能/u, visual: { emphasis: 'strong', tone: 'accent', icon: 'ai', badge: 'AI信号' } },
  { pattern: /事实|确认|来源|公告/u, visual: { tone: 'default', icon: 'source', badge: '已确认' } },
  { pattern: /后续|关注|进展/u, visual: { tone: 'accent', icon: 'timeline', badge: '后续观察' } },
];

// 只对正文、边界和亮点句做句内标注。完整覆盖校验仍在 HTML 渲染器中执行，
// 因此这层即使遇到异常文本也不会吞掉原文。
const KEY_FACT_TOKEN_RE = /[A-Z][A-Za-z0-9.+-]{1,}|\d+(?:\.\d+)?(?:%|％|亿港元|港元|亿元|万元|万股|元|亿|万|倍|纳米|核|季度)?/gu;
const KEY_FACT_NAME_RE = /(?<![\u4e00-\u9fff])[\u4e00-\u9fff]{2,3}(?=连续|随后|曾|已|将|宣布|发布|增持|买入|回应|收购|提出|采用|推出|投资|融资)/gu;
const KEY_FACT_ORG_RE = /(?<![\u4e00-\u9fff])[\u4e00-\u9fff]{2,8}(?:公司|集团|巴巴|股份|科技|平台|项目|芯片|模型|引擎|框架|仓库)(?=\d|在|于|宣布|发布|采用|支持|融资|投资|公告|的)/gu;
const KEY_FACT_OBJECT_RE = /(?:增持|买入|投资|收购|发布|宣布|支持|采用|推出)([\u4e00-\u9fff]{2,4})(?=港股|股票|超|达到|上涨|下跌|\d)/gu;

function inferredContentRuns(content) {
  const text = String(content || '');
  const metricMatches = [...text.matchAll(KEY_FACT_TOKEN_RE)].filter((match) => {
    const token = String(match[0] || '');
    const after = text.slice(Number(match.index || 0) + token.length);
    // 单独的年份只是时间定位，不把普通时间线列表误转成视觉对象。
    if (/^\d{4}$/u.test(token) && /^(?:年|[-/]\d{1,2})/u.test(after)) return false;
    return /[A-Z]/u.test(token) || /\d{2,}/u.test(token) || /[%％亿港元亿元万元万股元倍纳米核季度]/u.test(token);
  }).map((match) => ({
    start: Number(match.index || 0),
    end: Number(match.index || 0) + String(match[0] || '').length,
    text: String(match[0] || ''),
    role: 'metric',
  }));
  const entityMatches = [
    ...text.matchAll(KEY_FACT_NAME_RE),
    ...text.matchAll(KEY_FACT_ORG_RE),
    ...[...text.matchAll(KEY_FACT_OBJECT_RE)].map((match) => {
      const value = String(match[1] || '').replace(/(?:港股|股票|连续|随后|超|达到)$/u, '');
      return value ? {
        index: Number(match.index || 0) + String(match[0] || '').length - String(match[1] || '').length,
        value,
      } : null;
    }).filter(Boolean),
  ].map((match) => ({
    start: Number(match.index || 0),
    end: Number(match.index || 0) + String(match[0] || match.value || '').length,
    text: String(match[0] || match.value || ''),
    role: 'label',
  }));
  const matches = [...metricMatches, ...entityMatches]
    .sort((left, right) => left.start - right.start || (right.end - right.start) - (left.end - left.start))
    .filter((match, index, all) => index === 0 || match.start >= all.slice(0, index).at(-1).end);
  if (!matches.length) return null;
  const runs = [];
  let cursor = 0;
  for (const match of matches) {
    const start = match.start;
    const token = match.text;
    if (start > cursor) runs.push({ text: text.slice(cursor, start), role: 'normal' });
    const context = text.slice(Math.max(0, start - 8), start);
    const danger = match.role === 'metric' && /下降|下滑|下跌|跌|降|减少|涨价|上涨/u.test(context);
    runs.push({ text: token, role: match.role, tone: danger ? 'danger' : 'accent', emphasis: 'strong' });
    cursor = match.end;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), role: 'normal' });
  return runs;
}

function structuredItemDisplayText(item, blockType) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object' || Array.isArray(item)) return String(item ?? '');
  if (['timeline', 'steps', 'scenes'].includes(blockType)) {
    return String(item.content || item.text || item.fact || item.description || '').trim();
  }
  if (blockType === 'stats') return String(item.num || item.value || item.content || '').trim();
  return [item.title || item.label || item.time || item.date, item.content || item.text || item.description || item.fact]
    .filter(Boolean).join('：');
}

function inferredStructuredVisual(item, blockType) {
  const text = structuredItemDisplayText(item, blockType);
  const runs = inferredContentRuns(text);
  if (!runs || !runs.some((run) => run.role && run.role !== 'normal')) return item;
  const danger = runs.some((run) => run.tone === 'danger');
  const next = item && typeof item === 'object' && !Array.isArray(item)
    ? { ...item }
    : { content: text };
  if (!next.visual || typeof next.visual !== 'object') {
    next.visual = { emphasis: 'strong', tone: danger ? 'danger' : 'accent' };
  }
  if (!Array.isArray(next.content_runs) || next.content_runs.map((run) => String(run?.text || '')).join('') !== text) {
    next.content_runs = runs;
  }
  return next;
}

function backfillStructuredVisuals(block) {
  const type = String(block?.type || '');
  const next = { ...block };
  if (['list', 'stats', 'steps', 'timeline', 'scenes'].includes(type) && Array.isArray(next.items)) {
    next.items = next.items.map((item) => inferredStructuredVisual(item, type));
  }
  if (type === 'compare' && Array.isArray(next.rows)) {
    next.rows = next.rows.map((row) => (Array.isArray(row)
      ? row.map((cell) => inferredStructuredVisual(cell, type))
      : row));
  }
  return next;
}

function inferredBlockVisual(block, page) {
  const type = String(block?.type || '');
  const title = String(block?.title || '');
  // 具体叙事标题优先于通用块型：例如“价格变化”应使用 price，
  // 即使它承载在 compare 块中；note 则始终保留事实边界的 warning 语义。
  if (type === 'note' && DEFAULT_BLOCK_VISUALS[type]) return { ...DEFAULT_BLOCK_VISUALS[type] };
  const hinted = VISUAL_TITLE_HINTS.find((item) => item.pattern.test(title))?.visual;
  if (hinted) return { ...DEFAULT_BLOCK_VISUALS[type], ...hinted };
  if (DEFAULT_BLOCK_VISUALS[type]) return { ...DEFAULT_BLOCK_VISUALS[type] };
  if (page?.kind === 'cover' && type === 'text') return { emphasis: 'hero', tone: 'accent', icon: 'rocket', badge: '核心事件' };
  return null;
}

function backfillVisualIntent(block, page, { allowStructuredVisuals = true } = {}) {
  const inferred = inferredBlockVisual(block, page);
  const visual = inferred || (block?.visual && typeof block.visual === 'object' ? block.visual : null);
  const base = {
    ...block,
    ...(visual ? { visual: { ...inferred, ...(block.visual || {}) } } : {}),
  };
  const next = allowStructuredVisuals ? backfillStructuredVisuals(base) : base;
  if (!Array.isArray(next.content_runs) || !next.content_runs.length) {
    const runs = ['text', 'note', 'highlight'].includes(String(next.type || '')) ? inferredContentRuns(next.content) : null;
    if (runs) next.content_runs = runs;
  }
  return next;
}

export function sanitizeCardPlan(cardPlan) {
  const pages = (Array.isArray(cardPlan) ? cardPlan : []).map((page, pageIndex) => {
    const smart = normalizeCardComposition(page, { pageIndex });
    let contentBlocks = (Array.isArray(page.content_blocks) ? page.content_blocks : []).map((block) => {
      const listItems = block.type === 'list' && (!Array.isArray(block.items) || !block.items.length)
        ? legacyListContentItems(block.content)
        : [];
      const normalizedItems = (Array.isArray(block.items) && block.items.length ? block.items : listItems)
        .map((item) => cleanStructuredItem(item, block.type));
      return backfillVisualIntent({
      ...block,
      title: cleanInstructionText(block.title),
      // 列表数组以及旧版逗号拼接字符串都归一化为 items；同时保留
      // 换行文本，兼容编辑室仍以 content 作为列表编辑入口的旧界面。
      content: block.type === 'list' && normalizedItems.length
        ? normalizedItems.map(listItemDisplayText).filter(Boolean).join('\n')
        : cleanInstructionText(block.content),
      items: normalizedItems,
      headers: (Array.isArray(block.headers) ? block.headers : []).map(cleanInstructionText),
      rows: (Array.isArray(block.rows) ? block.rows : []).map((row) => (Array.isArray(row) ? row : []).map(cleanInstructionText)),
      }, page, { allowStructuredVisuals: listItems.length === 0 });
    });
    const hasRichList = contentBlocks.some((block) => block.type === 'list' && block.items.length >= 2);
    contentBlocks = contentBlocks.flatMap((block) => {
      if (block.type !== 'timeline' || block.items.length >= 2) return [block];
      // 单条事实没有时间线结构；已有多条列表时直接移除冗余时间线，
      // 否则降级为普通文本，绝不渲染只有一个节点的时间线骨架。
      if (hasRichList) return [];
      const item = block.items[0] || {};
      const content = [item.time || item.date, item.title || item.event || item.label, item.content || item.text || item.fact || item.description]
        .filter(Boolean).join('：');
      return [{ ...block, type: 'text', content, items: [], headers: [], rows: [] }];
    });
    return {
      ...page,
      role: smart.role,
      composition: smart.composition,
      title: cleanInstructionText(page.title),
      goal: cleanInstructionText(page.goal),
      evidence: (Array.isArray(page.evidence) ? page.evidence : []).map(cleanInstructionText),
      content_blocks: contentBlocks,
    };
  });
  return pages;
}

export function cardPlanRepairStructureIssues(previousPlan, nextPlan) {
  const issues = [];
  if (!Array.isArray(nextPlan) || nextPlan.length !== previousPlan.length) return [`页面数量必须保持为 ${previousPlan.length}`];
  const arrayLength = (value) => Array.isArray(value) ? value.length : 0;
  const lineCount = (value) => String(value || '').split(/\n+/).filter((line) => line.trim()).length;
  for (let pageIndex = 0; pageIndex < previousPlan.length; pageIndex += 1) {
    const previous = previousPlan[pageIndex] || {}; const next = nextPlan[pageIndex] || {}; const prefix = `P${pageIndex + 1}`;
    if (next.kind !== previous.kind) issues.push(`${prefix} 页面类型不能修改`);
    if (next.title !== previous.title) issues.push(`${prefix} 页面标题不能修改`);
    if (next.goal !== previous.goal) issues.push(`${prefix} 页面目标不能修改`);
    if (JSON.stringify(next.evidence || []) !== JSON.stringify(previous.evidence || [])) issues.push(`${prefix} 证据引用不能修改`);
    const beforeBlocks = Array.isArray(previous.content_blocks) ? previous.content_blocks : [];
    const afterBlocks = Array.isArray(next.content_blocks) ? next.content_blocks : [];
    if (afterBlocks.length !== beforeBlocks.length) { issues.push(`${prefix} 内容块数量必须保持为 ${beforeBlocks.length}`); continue; }
    for (let blockIndex = 0; blockIndex < beforeBlocks.length; blockIndex += 1) {
      const before = beforeBlocks[blockIndex] || {}; const after = afterBlocks[blockIndex] || {}; const blockPrefix = `${prefix}B${blockIndex + 1}`;
      if (after.type !== before.type) issues.push(`${blockPrefix} 类型不能修改`);
      if (after.title !== before.title) issues.push(`${blockPrefix} 标题不能修改`);
      for (const key of ['items', 'headers', 'rows']) if (arrayLength(after[key]) !== arrayLength(before[key])) issues.push(`${blockPrefix} ${key} 条目数量不能修改`);
      if (before.type === 'list' && !arrayLength(before.items) && lineCount(after.content) !== lineCount(before.content)) issues.push(`${blockPrefix} 列表条目数量不能修改`);
      if (before.type === 'code' && after.content !== before.content) issues.push(`${blockPrefix} 代码内容不能修改`);
      if (arrayLength(before.rows) && before.rows.some((row, index) => arrayLength(after.rows?.[index]) !== arrayLength(row))) issues.push(`${blockPrefix} rows 列数不能修改`);
    }
  }
  return issues;
}
