import { createHash } from 'node:crypto';
import { listBlockValues } from './social-card-plan.mjs';
import { buildSocialCardContentAtoms, compareSocialCardContentAtomConservation } from './social-card-content-atoms.mjs';
import { findSocialCardSupplementSlot } from './social-card-supplement-slots.mjs';
import { inferCardPageRole } from './social-card-role.mjs';
import { knownSourceRefsFromSocialCardFactIndex } from './social-card-fact-index.mjs';
import { getSocialCardFactRenderCandidates, isSocialCardFactComponentCompatibleWithSlot } from './social-card-content-components.mjs';

export const SOCIAL_CARD_STRUCTURAL_ISSUES = Object.freeze([
  'overflow', 'clipped', 'horizontal_overflow',
  'invalid_page_grid_structure', 'missing_content_stack', 'empty_page_body',
]);

const SPLITTABLE_BLOCKS = new Set(['list', 'steps', 'timeline', 'scenes', 'stats', 'compare']);
const FACT_BLOCK_TYPES = new Set(['text', 'list', 'steps', 'timeline', 'scenes', 'stats', 'compare', 'note', 'code']);
const BLOCK_FORBIDDEN_KEYS = new Set(['html', 'css', 'style', 'class', 'className', 'script', 'markup', 'template']);

export function classifySocialCardLayoutIssue(page = {}) {
  const issues = new Set(Array.isArray(page?.issues) ? page.issues.map(String) : []);
  const structural = SOCIAL_CARD_STRUCTURAL_ISSUES.filter((issue) => issues.has(issue));
  const density = ['underfilled', 'underfilled_target', 'overfilled', 'text_too_small', 'vertical_imbalance'].filter((issue) => issues.has(issue));
  return { structural, density, kind: structural.length ? 'structural' : density.length ? 'density' : 'none' };
}

export function structuralLayoutPages(report) {
  return (Array.isArray(report?.pages) ? report.pages : [])
    .map((page) => ({ page: Number(page?.page), ...classifySocialCardLayoutIssue(page), issues: Array.isArray(page?.issues) ? page.issues.map(String) : [] }))
    .filter((page) => page.page > 0 && page.kind === 'structural');
}

export function cardPlanHash(cardPlan) {
  return `sha256:${createHash('sha256').update(JSON.stringify(cardPlan || [])).digest('hex')}`;
}

/**
 * 生成布局修复状态指纹，用来识别“同一计划 + 同一审计问题 + 同一确定性变体”
 * 被重复送入修复循环。利用率按 0.1% 归一，避免浏览器舍入噪声绕过无进展门禁；
 * 页面问题顺序也被排序，保证审计器字段顺序变化不会伪造进展。
 */
export function socialCardRepairStateSignature({ cardPlan = [], report = null, densityCalibration = null, safeCompositionPages = [], relaxedDensityPages = [], expandedDensityPages = [], fitContentPages = [] } = {}) {
  const roundUtilization = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 10) / 10 : null;
  const pageSummary = (Array.isArray(report?.pages) ? report.pages : []).map((page) => ({
    page: Number(page?.page) || 0,
    valid: page?.valid === true,
    utilization: roundUtilization(page?.utilization),
    issues: Array.isArray(page?.issues) ? page.issues.map(String).sort() : [],
    overflowPixels: Number(page?.overflowPixels) || 0,
    clippedPixels: Number(page?.clippedPixels) || 0,
    horizontalOverflowPixels: Number(page?.horizontalOverflowPixels) || 0,
  }));
  const density = (Array.isArray(densityCalibration?.pages) ? densityCalibration.pages : []).map((page) => ({
    page: Number(page?.page) || 0,
    utilization: roundUtilization(page?.utilization),
    target: roundUtilization(page?.target),
  }));
  const sortedNumbers = (values) => [...new Set((Array.isArray(values) ? values : [...(values || [])]).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  return JSON.stringify({
    plan: cardPlanHash(cardPlan),
    report: pageSummary,
    density,
    safeCompositionPages: sortedNumbers(safeCompositionPages),
    relaxedDensityPages: sortedNumbers(relaxedDensityPages),
    expandedDensityPages: sortedNumbers(expandedDensityPages),
    fitContentPages: sortedNumbers(fitContentPages),
  });
}

function itemValues(block) {
  if (block?.type === 'list') return listBlockValues(block);
  if (block?.type === 'compare') return Array.isArray(block?.rows) ? block.rows : [];
  return Array.isArray(block?.items) ? block.items : [];
}

function withItems(block, items) {
  const next = structuredClone(block || {});
  if (block?.type === 'list' && (!Array.isArray(block.items) || !block.items.length)) {
    next.items = [];
    next.content = items.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n');
  } else if (block?.type === 'compare') next.rows = items;
  else next.items = items;
  return next;
}

function normalizeGroups(operation) {
  if (!Array.isArray(operation?.groups)) return [];
  return operation.groups.map((group) => {
    if (Array.isArray(group?.blocks)) return { blocks: group.blocks };
    if (Number.isInteger(Number(group?.block))) return { blocks: [{ block: Number(group.block), items: group.items }] };
    return { blocks: [] };
  });
}

function validateSplitOperation(pages, operation, maxPages) {
  const issues = [];
  const pageNumber = Number(operation?.page);
  const page = Number.isInteger(pageNumber) ? pages[pageNumber - 1] : null;
  if (!page) return [`P${pageNumber || '?'} 不存在，不能拆页`];
  if (page.kind === 'cover' || page.kind === 'ending') issues.push(`P${pageNumber} 封面和结尾页不可拆分`);
  const groups = normalizeGroups(operation);
  if (groups.length < 2) issues.push(`P${pageNumber} 至少需要两个续页分组`);
  if (pages.length + groups.length - 1 > maxPages) issues.push(`拆页后将超过页面上限 ${maxPages}`);
  const blocks = Array.isArray(page.content_blocks) ? page.content_blocks : [];
  const covered = new Map();
  for (const [groupIndex, group] of groups.entries()) {
    if (!group.blocks.length) issues.push(`P${pageNumber} 第 ${groupIndex + 1} 个续页为空`);
    for (const entry of group.blocks) {
      const blockIndex = Number(entry?.block);
      const block = blocks[blockIndex];
      if (!Number.isInteger(blockIndex) || !block) { issues.push(`P${pageNumber} 内容块 ${entry?.block} 不存在`); continue; }
      if (!SPLITTABLE_BLOCKS.has(block.type)) { issues.push(`P${pageNumber} 的 ${block.type} 内容块不可拆分`); continue; }
      const values = itemValues(block); const indexes = Array.isArray(entry?.items) ? entry.items.map(Number) : [];
      if (!indexes.length) { issues.push(`P${pageNumber} 内容块 ${blockIndex + 1} 未指定条目`); continue; }
      const seen = covered.get(blockIndex) || new Set();
      for (const index of indexes) {
        if (!Number.isInteger(index) || index < 0 || index >= values.length) issues.push(`P${pageNumber} 内容块 ${blockIndex + 1} 条目索引越界`);
        else if (seen.has(index)) issues.push(`P${pageNumber} 内容块 ${blockIndex + 1} 条目重复分组`);
        else seen.add(index);
      }
      covered.set(blockIndex, seen);
    }
  }
  for (const [blockIndex, indexes] of covered.entries()) {
    const total = itemValues(blocks[blockIndex]).length;
    if (indexes.size !== total) issues.push(`P${pageNumber} 内容块 ${blockIndex + 1} 拆页后会丢失条目`);
  }
  return issues;
}

function pageGroup(page) {
  return String(page?.page_group_id || '').trim();
}

function pageRole(page) {
  return String(page?.role || '').trim();
}

function validateAdjacentPages(pages, firstPageNumber, secondPageNumber, label) {
  const issues = [];
  const firstIndex = Number(firstPageNumber) - 1;
  const secondIndex = Number(secondPageNumber) - 1;
  if (!Number.isInteger(firstIndex) || !pages[firstIndex]) return [`${label}的页面不存在`];
  if (!Number.isInteger(secondIndex) || !pages[secondIndex]) return [`${label}的页面不存在`];
  if (Math.abs(firstIndex - secondIndex) !== 1) issues.push(`${label}只能作用于相邻页面`);
  const first = pages[firstIndex]; const second = pages[secondIndex];
  if ([first, second].some((page) => page.kind === 'cover' || page.kind === 'ending')) issues.push(`${label}不可作用于封面或结尾页`);
  if (first.kind !== second.kind || pageRole(first) !== pageRole(second)) issues.push(`${label}必须保持页面角色一致`);
  if (!pageGroup(first) || pageGroup(first) !== pageGroup(second)) issues.push(`${label}必须保持同一故事线分组`);
  return issues;
}

function validateMoveBlockOperation(pages, operation) {
  const fromPage = Number(operation?.from_page);
  const toPage = Number(operation?.to_page);
  const issues = validateAdjacentPages(pages, fromPage, toPage, '内容块移动');
  if (issues.length) return issues;
  const from = pages[fromPage - 1];
  const blocks = Array.isArray(from.content_blocks) ? from.content_blocks : [];
  if (blocks.length < 2) issues.push(`P${fromPage} 至少保留一个内容块，不能移动唯一内容块`);
  const blockIndex = Number(operation?.block);
  if (!Number.isInteger(blockIndex) || !blocks[blockIndex]) issues.push(`P${fromPage} 内容块 ${operation?.block} 不存在`);
  const expectedIndex = fromPage < toPage ? blocks.length - 1 : 0;
  if (Number.isInteger(blockIndex) && blockIndex !== expectedIndex) issues.push(`内容块移动必须保持页面顺序，只能移动${fromPage < toPage ? '前页末尾' : '后页开头'}内容块`);
  if (blocks[blockIndex]?.type === 'code' && operation?.allow_code !== true) issues.push(`P${fromPage} 代码块默认不可自动移动`);
  return issues;
}

function validateMergeOperation(pages, operation) {
  const pageNumbers = Array.isArray(operation?.pages) ? operation.pages.map(Number) : [];
  if (pageNumbers.length !== 2) return ['合并操作必须恰好包含两个页面'];
  return validateAdjacentPages(pages, pageNumbers[0], pageNumbers[1], '页面合并');
}

function validateAddFactBlockOperation(pages, operation, { knownSourceRefs = [], maxFactBlocksAdded = 1, supplementSlots = null, factIndex = null, allowSemanticRenderTypes = true } = {}) {
  const pageNumber = Number(operation?.page);
  const page = Number.isInteger(pageNumber) ? pages[pageNumber - 1] : null;
  const issues = [];
  if (!page) return [`P${pageNumber || '?'} 不存在，不能补充内容块`];
  if (page.kind === 'cover' || page.kind === 'ending') issues.push(`P${pageNumber} 封面和结尾页不可自动补充内容块`);
  const block = operation?.block && typeof operation.block === 'object' ? operation.block : null;
  const role = String(page?.role || inferCardPageRole(page));
  const slotId = String(operation?.slot_id || '').trim();
  const configuredSlots = Array.isArray(supplementSlots?.[role]) ? supplementSlots[role] : null;
  const slot = configuredSlots ? configuredSlots.find((item) => item?.id === slotId) || null : findSocialCardSupplementSlot(role, slotId);
  if (!slotId) issues.push(`P${pageNumber} 补充内容块必须指定 slot_id`);
  else if (!slot) issues.push(`P${pageNumber} 的角色 ${role} 不支持事实补充槽位：${slotId}`);
  if (!block) issues.push(`P${pageNumber} 补充内容块缺少 block`);
  else {
    if (!FACT_BLOCK_TYPES.has(String(block.type || ''))) issues.push(`P${pageNumber} 不支持的补充内容块类型：${block.type || '空'}`);
    const componentId = String(operation?.component_id || '').trim();
    const candidate = componentId && factIndex && Array.isArray(factIndex.candidates)
      ? factIndex.candidates.find((item) => String(item?.id) === componentId)
      : null;
    if (candidate && slotId && !isSocialCardFactComponentCompatibleWithSlot(candidate, role, slotId)) {
      issues.push(`P${pageNumber} 事实候选与槽位 ${slotId} 语义不匹配`);
    }
    const semanticRenderAllowed = Boolean(allowSemanticRenderTypes && candidate && getSocialCardFactRenderCandidates(candidate).includes(String(block.type || '')));
    if (slot && !slot.blockTypes.includes(String(block.type || '')) && !semanticRenderAllowed) issues.push(`P${pageNumber} 槽位 ${slotId} 不支持内容块类型：${block.type || '空'}`);
    const values = itemValues(block);
    if (slot && values.length > slot.maxItems) issues.push(`P${pageNumber} 槽位 ${slotId} 条目数超过上限 ${slot.maxItems}`);
    if (block.supplement_slot_id && String(block.supplement_slot_id) !== slotId) issues.push(`P${pageNumber} 内容块槽位标记与操作不一致`);
    for (const key of Object.keys(block)) if (BLOCK_FORBIDDEN_KEYS.has(key)) issues.push(`P${pageNumber} 补充内容块包含禁止字段：${key}`);
  }
  const sourceRefs = Array.isArray(operation?.source_refs) && operation.source_refs.length ? operation.source_refs : block?.source_refs;
  if (!Array.isArray(sourceRefs) || !sourceRefs.length) issues.push(`P${pageNumber} 补充内容块必须提供来源引用`);
  const factIds = Array.isArray(operation?.fact_ids) && operation.fact_ids.length ? operation.fact_ids : block?.fact_ids;
  if (Array.isArray(operation?.fact_ids) && Array.isArray(block?.fact_ids) && JSON.stringify(operation.fact_ids.map(String)) !== JSON.stringify(block.fact_ids.map(String))) issues.push(`P${pageNumber} 操作 fact_ids 与内容块 fact_ids 不一致`);
  if (Array.isArray(factIds) && new Set(factIds.map(String)).size !== factIds.length) issues.push(`P${pageNumber} 补充内容块 fact_ids 不能重复`);
  const factCandidates = new Map((Array.isArray(factIndex?.candidates) ? factIndex.candidates : []).map((candidate) => [String(candidate.id), candidate]));
  const known = new Set([...(Array.isArray(knownSourceRefs) ? knownSourceRefs : []), ...knownSourceRefsFromSocialCardFactIndex(factIndex)].map(String));
  if (factIds?.length) {
    if (!factIndex) issues.push(`P${pageNumber} 补充内容块声明了 fact_ids，但当前没有事实候选索引`);
    else for (const factId of factIds) {
      const candidate = factCandidates.get(String(factId));
      if (!candidate) issues.push(`P${pageNumber} 补充内容块引用了未知事实候选：${factId}`);
      else for (const ref of candidate.source_refs || []) if (!(sourceRefs || []).map(String).includes(String(ref))) issues.push(`P${pageNumber} 补充内容块未携带候选事实来源：${ref}`);
    }
  }
  if (!known.size) issues.push('补充内容块缺少可校验的事实来源集合');
  for (const sourceRef of sourceRefs || []) if (!known.has(String(sourceRef))) issues.push(`补充内容块来源未在事实基座中登记：${sourceRef}`);
  if (Number(maxFactBlocksAdded) < 1) issues.push('当前计划不允许补充内容块');
  return issues;
}

function applyOnePlanOperation(pages, operation) {
  if (operation?.op === 'split_page') return applySplitPage(pages, operation);
  if (operation?.op === 'merge_pages') {
    const [firstNumber, secondNumber] = operation.pages.map(Number).sort((a, b) => a - b);
    const firstIndex = firstNumber - 1;
    const first = structuredClone(pages[firstIndex]);
    const second = pages[secondNumber - 1];
    pages.splice(firstIndex, 2, { ...first, content_blocks: [...(first.content_blocks || []), ...(second.content_blocks || [])] });
    return pages;
  }
  if (operation?.op === 'move_block') {
    const fromPage = Number(operation.from_page) - 1;
    const toPage = Number(operation.to_page) - 1;
    const from = pages[fromPage];
    const to = pages[toPage];
    const blocks = Array.isArray(from.content_blocks) ? from.content_blocks : [];
    const [block] = blocks.splice(Number(operation.block), 1);
    from.content_blocks = blocks;
    const targetBlocks = Array.isArray(to.content_blocks) ? to.content_blocks : [];
    if (fromPage < toPage) targetBlocks.unshift(block); else targetBlocks.push(block);
    to.content_blocks = targetBlocks;
    return pages;
  }
  if (operation?.op === 'add_fact_block') {
    const page = pages[Number(operation.page) - 1];
    const block = structuredClone(operation.block);
    if (Array.isArray(operation.source_refs) && operation.source_refs.length) block.source_refs = [...operation.source_refs];
    block.supplement_slot_id = String(operation.slot_id || block.supplement_slot_id || '');
    page.content_blocks = [...(Array.isArray(page.content_blocks) ? page.content_blocks : []), block];
    return pages;
  }
  return pages;
}

export function validateSocialCardRestructureOperations(cardPlan, operations, { maxPages = 10, maxOperations = 4, knownSourceRefs = [], maxFactBlocksAdded = 1, maxFactBlocksPerPage = Infinity, supplementSlots = null, factIndex = null, operationGuard = null, allowSemanticRenderTypes = true } = {}) {
  const list = Array.isArray(operations) ? operations : [];
  const issues = [];
  if (!list.length) issues.push('未返回结构修复操作');
  if (list.length > Number(maxOperations)) issues.push(`结构修复操作超过本轮上限 ${maxOperations}`);
  let pages = structuredClone(cardPlan || []);
  let factBlocksAdded = 0;
  const factBlocksByPage = new Map();
  for (const operation of list) {
    const op = String(operation?.op || '');
    let operationIssues = [];
    if (op === 'split_page') operationIssues = validateSplitOperation(pages, operation, maxPages);
    else if (op === 'move_block') operationIssues = validateMoveBlockOperation(pages, operation);
    else if (op === 'merge_pages') operationIssues = validateMergeOperation(pages, operation);
    else if (op === 'unresolved_component') operationIssues = [String(operation?._componentResolutionIssue || '补充组件无法解析')];
    else if (op === 'add_fact_block') {
      factBlocksAdded += 1;
      const pageNumber = Number(operation?.page);
      const nextPageCount = (factBlocksByPage.get(pageNumber) || 0) + 1;
      operationIssues = validateAddFactBlockOperation(pages, operation, { knownSourceRefs, maxFactBlocksAdded: Number(maxFactBlocksAdded) - factBlocksAdded + 1, supplementSlots, factIndex, allowSemanticRenderTypes });
      if (factBlocksAdded > Number(maxFactBlocksAdded)) operationIssues.push(`补充内容块超过本轮上限 ${maxFactBlocksAdded}`);
      if (nextPageCount > Number(maxFactBlocksPerPage)) operationIssues.push(`P${pageNumber} 补充内容块超过单页上限 ${maxFactBlocksPerPage}`);
    } else operationIssues = [`不支持的结构修复操作：${op || '空操作'}`];
    if (!operationIssues.length && typeof operationGuard === 'function') {
      const guardIssues = operationGuard({ operation, pages: structuredClone(pages) });
      if (Array.isArray(guardIssues)) operationIssues.push(...guardIssues.map(String));
    }
    issues.push(...operationIssues);
    if (!operationIssues.length) {
      if (op === 'add_fact_block') factBlocksByPage.set(Number(operation.page), (factBlocksByPage.get(Number(operation.page)) || 0) + 1);
      pages = applyOnePlanOperation(pages, operation);
    }
    if (pages.length > Number(maxPages)) issues.push(`调整后页面数超过上限 ${maxPages}`);
  }
  const beforeAtoms = buildSocialCardContentAtoms(cardPlan || []);
  const afterAtoms = buildSocialCardContentAtoms(pages);
  const conservation = compareSocialCardContentAtomConservation(beforeAtoms, afterAtoms);
  const beforeRefs = new Map(); beforeAtoms.filter((atom) => atom.source_status === 'provided').flatMap((atom) => atom.source_refs || []).forEach((ref) => beforeRefs.set(ref, (beforeRefs.get(ref) || 0) + 1));
  const afterRefs = new Map(); afterAtoms.filter((atom) => atom.source_status === 'provided').flatMap((atom) => atom.source_refs || []).forEach((ref) => afterRefs.set(ref, (afterRefs.get(ref) || 0) + 1));
  for (const [ref, count] of beforeRefs) if ((afterRefs.get(ref) || 0) < count) issues.push(`调整后丢失来源原子：${ref}`);
  return { valid: issues.length === 0, issues };
}

/**
 * Build one conservative split operation when the model returns no operation.
 * This is only a safety net for a splittable item block; it never touches cover,
 * ending, code, or free-form text blocks and never changes item content.
 */
export function buildDeterministicSocialCardRestructureOperations(cardPlan, structuralPages, { maxPages = 10 } = {}) {
  const pages = Array.isArray(cardPlan) ? cardPlan : [];
  if (pages.length >= maxPages) return [];
  for (const target of Array.isArray(structuralPages) ? structuralPages : []) {
    const pageNumber = Number(target?.page);
    const page = Number.isInteger(pageNumber) ? pages[pageNumber - 1] : null;
    if (!page || page.kind === 'cover' || page.kind === 'ending') continue;
    const blocks = Array.isArray(page.content_blocks) ? page.content_blocks : [];
    const blockIndex = blocks.findIndex((block) => SPLITTABLE_BLOCKS.has(block?.type) && itemValues(block).length >= 2);
    if (blockIndex < 0) continue;
    const count = itemValues(blocks[blockIndex]).length;
    const pivot = Math.ceil(count / 2);
    return [{
      op: 'split_page',
      page: pageNumber,
      groups: [
        { blocks: [{ block: blockIndex, items: Array.from({ length: pivot }, (_, index) => index) }] },
        { blocks: [{ block: blockIndex, items: Array.from({ length: count - pivot }, (_, index) => pivot + index) }] },
      ],
    }];
  }
  return [];
}

/**
 * 页数上限是模板预检约束，不应等到浏览器审计失败后才交给 AI 猜测。
 * 这里只合并相邻、同角色、同故事线的内容页，绝不触碰封面或结尾页。
 */
export function buildDeterministicSocialCardPageCapOperations(cardPlan, { maxPages = 10, canMerge = null } = {}) {
  const pages = structuredClone(Array.isArray(cardPlan) ? cardPlan : []);
  const operations = [];
  while (pages.length > Number(maxPages)) {
    const candidates = [];
    for (let index = 0; index < pages.length - 1; index += 1) {
      const first = pages[index];
      const second = pages[index + 1];
      if ([first, second].some((page) => page?.kind === 'cover' || page?.kind === 'ending')) continue;
      if (String(first?.kind || '') !== String(second?.kind || '')) continue;
      if (String(first?.role || '') !== String(second?.role || '')) continue;
      const firstGroup = pageGroup(first);
      const secondGroup = pageGroup(second);
      if (!firstGroup || firstGroup !== secondGroup) continue;
      const mergedPage = { ...structuredClone(first), content_blocks: [...(first.content_blocks || []), ...(second.content_blocks || [])] };
      if (typeof canMerge === 'function' && !canMerge({ first, second, mergedPage, index })) continue;
      const continuationBonus = Number(second?.continuation_index || 0) > 1 ? 10 : 0;
      const blockCount = (Array.isArray(first?.content_blocks) ? first.content_blocks.length : 0)
        + (Array.isArray(second?.content_blocks) ? second.content_blocks.length : 0);
      candidates.push({ index, score: continuationBonus - blockCount });
    }
    if (!candidates.length) break;
    candidates.sort((a, b) => b.score - a.score || a.index - b.index);
    const index = candidates[0].index;
    const pageNumbers = [index + 1, index + 2];
    operations.push({ op: 'merge_pages', pages: pageNumbers, source: 'deterministic-page-cap' });
    const [first, second] = [pages[index], pages[index + 1]];
    pages.splice(index, 2, { ...structuredClone(first), content_blocks: [...(first.content_blocks || []), ...(second.content_blocks || [])] });
  }
  return operations;
}

function continuationTitle(title, index) {
  const base = String(title || '').trim() || '内容';
  return `${base}（续${index > 1 ? index : ''}）`;
}

function applySplitPage(pages, operation) {
  const pageIndex = Number(operation.page) - 1;
  const source = structuredClone(pages[pageIndex]);
  const blocks = Array.isArray(source.content_blocks) ? source.content_blocks : [];
  const groups = normalizeGroups(operation);
  const selected = new Set(groups.flatMap((group) => group.blocks.map((entry) => Number(entry.block))));
  const nextPages = groups.map((group, groupIndex) => {
    const contentBlocks = groupIndex === 0 ? blocks.filter((_, index) => !selected.has(index)).map(structuredClone) : [];
    for (const entry of group.blocks) {
      const block = blocks[Number(entry.block)];
      const values = itemValues(block);
      contentBlocks.push(withItems(block, entry.items.map(Number).map((index) => values[index])));
    }
    return { ...source, content_blocks: contentBlocks, page_group_id: String(source.page_group_id || `storyboard-page-${operation.page}`), continuation_of: Number(source.continuation_of || operation.page), continuation_index: groupIndex + 1, title: groupIndex ? continuationTitle(source.title, groupIndex) : source.title };
  });
  pages.splice(pageIndex, 1, ...nextPages);
  return pages;
}

export function applySocialCardRestructureOperations(cardPlan, operations, options = {}) {
  const validation = validateSocialCardRestructureOperations(cardPlan, operations, options);
  if (!validation.valid) return { ...validation, changed: false, pages: structuredClone(cardPlan || []) };
  const pages = structuredClone(cardPlan || []);
  [...operations].forEach((operation) => applyOnePlanOperation(pages, operation));
  const beforeAtoms = buildSocialCardContentAtoms(cardPlan || []);
  const afterAtoms = buildSocialCardContentAtoms(pages);
  const conservation = compareSocialCardContentAtomConservation(beforeAtoms, afterAtoms);
  return { valid: true, issues: [], changed: cardPlanHash(pages) !== cardPlanHash(cardPlan), pages, conservation };
}
