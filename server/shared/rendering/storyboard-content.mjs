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

export function sanitizeCardPlan(cardPlan) {
  const pages = (Array.isArray(cardPlan) ? cardPlan : []).map((page, pageIndex) => {
    const smart = normalizeCardComposition(page, { pageIndex });
    let contentBlocks = (Array.isArray(page.content_blocks) ? page.content_blocks : []).map((block) => {
      const listItems = block.type === 'list' && (!Array.isArray(block.items) || !block.items.length)
        ? legacyListContentItems(block.content)
        : [];
      const normalizedItems = (Array.isArray(block.items) && block.items.length ? block.items : listItems)
        .map((item) => cleanStructuredItem(item, block.type));
      return ({
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
    });
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
