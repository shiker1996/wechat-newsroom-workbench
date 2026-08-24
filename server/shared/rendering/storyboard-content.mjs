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

export function sanitizeCardPlan(cardPlan) {
  return (Array.isArray(cardPlan) ? cardPlan : []).map((page, pageIndex) => {
    const smart = normalizeCardComposition(page, { pageIndex });
    return {
      ...page,
      role: smart.role,
      composition: smart.composition,
      title: cleanInstructionText(page.title),
      goal: cleanInstructionText(page.goal),
      evidence: (Array.isArray(page.evidence) ? page.evidence : []).map(cleanInstructionText),
      content_blocks: (Array.isArray(page.content_blocks) ? page.content_blocks : []).map((block) => ({
        ...block,
        title: cleanInstructionText(block.title),
        content: cleanInstructionText(block.content),
        items: (Array.isArray(block.items) ? block.items : []).map((item) => typeof item === 'string'
          ? cleanInstructionText(item)
          : Object.fromEntries(Object.entries(item || {}).map(([key, value]) => [key, typeof value === 'string' ? cleanInstructionText(value) : value]))),
        headers: (Array.isArray(block.headers) ? block.headers : []).map(cleanInstructionText),
        rows: (Array.isArray(block.rows) ? block.rows : []).map((row) => (Array.isArray(row) ? row : []).map(cleanInstructionText)),
      })),
    };
  });
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
