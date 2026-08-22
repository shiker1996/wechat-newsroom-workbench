import { capacityProfileForRole } from './social-card-capacity.mjs';
import { inferCardPageRole } from './social-card-role.mjs';
import { listBlockValues } from './social-card-plan.mjs';

const SPLITTABLE = new Set(['list', 'steps', 'timeline', 'scenes', 'compare', 'stats', 'text']);
const ITEM_BLOCKS = new Set(['list', 'steps', 'timeline', 'scenes', 'stats']);

const clone = (value) => value && typeof value === 'object' ? structuredClone(value) : value;
const textLength = (value) => String(value ?? '').trim().length;
const lineEstimate = (value, charsPerLine = 18) => Math.max(1, Math.ceil(textLength(value) / charsPerLine));

function itemText(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return String(item ?? '');
  return Object.values(item).filter((value) => typeof value === 'string' || typeof value === 'number').join(' ');
}

function blockItems(block) {
  if (block?.type === 'list') return listBlockValues(block);
  if (ITEM_BLOCKS.has(block?.type) && Array.isArray(block?.items) && block.items.length) return block.items;
  if (block?.type === 'compare' && Array.isArray(block?.rows) && block.rows.length) return block.rows;
  if (block?.type === 'text') {
    const paragraphs = String(block?.content || '').split(/\n{2,}|(?<=。)\n/).map((value) => value.trim()).filter(Boolean);
    return paragraphs.length > 1 ? paragraphs : [];
  }
  return [];
}

function withItems(block, items) {
  const next = { ...clone(block) };
  if (block?.type === 'list' && (!Array.isArray(block.items) || !block.items.length)) {
    next.content = items.map(itemText).join('\n');
    next.items = [];
  } else if (block?.type === 'compare') {
    next.rows = items;
  } else if (ITEM_BLOCKS.has(block?.type) || block?.type === 'text') {
    next.items = items;
    if (block?.type === 'text') next.content = items.map(itemText).join('\n\n');
  }
  return next;
}

function continuationTitle(title, index) {
  const value = String(title || '').trim();
  return value ? `${value}（续${index > 1 ? index : ''}）` : `内容（续${index > 1 ? index : ''}）`;
}

function blockHeight(block, visual) {
  const type = String(block?.type || 'text');
  const heading = textLength(block?.title) ? 25 : 8;
  if (type === 'code') return 165 + Math.ceil(textLength(block?.content) / 36) * 12;
  if (type === 'compare') {
    const rows = Array.isArray(block?.rows) ? block.rows : [];
    return heading + 26 + rows.reduce((sum, row) => sum + Math.max(1, lineEstimate((Array.isArray(row) ? row : []).join(' '), 28)) * 18, 0);
  }
  const values = blockItems(block);
  if (values.length) {
    const itemHeight = type === 'stats' ? 58 : type === 'steps' ? 48 : type === 'timeline' ? 48 : 24;
    return heading + values.reduce((sum, item) => sum + itemHeight + Math.max(0, lineEstimate(itemText(item), 22) - 1) * 15, 0) + Math.max(0, values.length - 1) * 5;
  }
  return heading + Math.max(1, lineEstimate(block?.content, 28)) * 17 + 14;
}

export function estimateSocialCardPageLoad(page, capacity) {
  const visual = capacity?.visual || {};
  const titleHeight = Math.min(Number(visual.maxTitleLines || 3), lineEstimate(page?.title, 10)) * 34;
  const blocks = Array.isArray(page?.content_blocks) ? page.content_blocks : [];
  const estimatedHeightPx = Math.round(80 + titleHeight + blocks.reduce((sum, block) => sum + blockHeight(block, visual), 0) + Math.max(0, blocks.length - 1) * 8);
  const bodyHeightPx = Number(visual.bodyHeightPx || 420);
  const reasons = [];
  if (blocks.length > Number(capacity?.structural?.maxBlocks || 99)) reasons.push('block-count');
  const itemCount = blocks.reduce((sum, block) => sum + blockItems(block).length, 0);
  if (itemCount > Number(capacity?.structural?.maxItems || 99)) reasons.push('item-count');
  if (estimatedHeightPx > bodyHeightPx) reasons.push('estimated-height');
  return { estimatedHeightPx, bodyHeightPx, itemCount, overCapacity: reasons.length > 0, reasons };
}

export function scaleSocialCardCapacityProfile(profile, scale = 1) {
  const factor = Math.min(1, Math.max(.55, Number(scale) || 1));
  if (!profile || factor === 1) return profile;
  return {
    ...structuredClone(profile),
    roles: Object.fromEntries(Object.entries(profile.roles || {}).map(([role, value]) => [role, {
      ...value,
      visual: { ...value.visual, bodyHeightPx: Math.max(240, Math.round(Number(value.visual?.bodyHeightPx || 420) * factor)) },
    }])),
  };
}

function splitBlock(block, capacity, availableHeight, pageTemplate = null) {
  const type = String(block?.type || 'text');
  if (!capacity?.split?.allowed || !capacity.split.blockTypes.includes(type) || !SPLITTABLE.has(type)) return null;
  const values = blockItems(block);
  if (values.length < 2) return null;
  const chunks = [];
  let current = [];
  // 拆页时测量“完整候选页”，而不是只测内容块。这样标题、页眉页脚、边框和间距
  // 都由同一个 estimateSocialCardPageLoad 规则计入，不再依赖难以解释的固定扣减值。
  const fallbackBase = Math.max(100, Number(availableHeight || capacity.visual.bodyHeightPx) - 175);
  const pageHeight = (items) => pageTemplate
    ? estimateSocialCardPageLoad({ ...pageTemplate, content_blocks: [withItems(block, items)] }, capacity).estimatedHeightPx
    : blockHeight(withItems(block, items), capacity.visual);
  const fits = (items) => pageTemplate
    ? !estimateSocialCardPageLoad({ ...pageTemplate, content_blocks: [withItems(block, items)] }, capacity).overCapacity
    : pageHeight(items) <= fallbackBase;
  for (const value of values) {
    const trial = [...current, value];
    if (current.length && !fits(trial)) {
      chunks.push(withItems(block, current));
      current = [value];
    } else current = trial;
  }
  if (current.length) chunks.push(withItems(block, current));
  // 避免最后一个续页只承载很少条目：在两页都不超容量且整体更均衡时，
  // 从前一页向最后一页移动完整条目，不改变原始顺序和内容。
  if (chunks.length > 1 && values.length >= 4) {
    const previousIndex = chunks.length - 2;
    let previousItems = blockItems(chunks[previousIndex]);
    let lastItems = blockItems(chunks.at(-1));
    while (previousItems.length > lastItems.length + 1 && previousItems.length > 2) {
      const moved = previousItems.at(-1);
      const previousCandidate = withItems(block, previousItems.slice(0, -1));
      // 被移动条目必须放在续页最前面，否则三页拆分时会打乱原始顺序。
      const lastCandidate = withItems(block, [moved, ...lastItems]);
      if (!fits(blockItems(previousCandidate)) || !fits(blockItems(lastCandidate))) break;
      const currentGap = Math.abs(pageHeight(blockItems(chunks[previousIndex])) - pageHeight(blockItems(chunks.at(-1))));
      const nextGap = Math.abs(pageHeight(blockItems(previousCandidate)) - pageHeight(blockItems(lastCandidate)));
      if (nextGap >= currentGap) break;
      chunks[previousIndex] = previousCandidate;
      chunks[chunks.length - 1] = lastCandidate;
      previousItems = blockItems(previousCandidate);
      lastItems = blockItems(lastCandidate);
    }
  }
  return chunks.length > 1 ? chunks : null;
}

function splitPage(page, capacity, pageIndex) {
  const source = clone(page);
  const baseBlocks = Array.isArray(source.content_blocks) ? source.content_blocks : [];
  const pages = [{ ...source, content_blocks: [] }];
  const operations = [];
  for (const block of baseBlocks) {
    let current = pages[pages.length - 1];
    const candidate = [...current.content_blocks, block];
    const probe = { ...current, content_blocks: candidate };
    if (!estimateSocialCardPageLoad(probe, capacity).overCapacity) {
      current.content_blocks = candidate;
      continue;
    }
    const chunks = splitBlock(block, capacity, capacity.visual.bodyHeightPx, source);
    if (chunks) {
      current = pages[pages.length - 1];
      if (current.content_blocks.length) pages.push({ ...source, content_blocks: [] });
      chunks.forEach((chunk, chunkIndex) => {
        if (chunkIndex > 0) pages.push({ ...source, content_blocks: [] });
        const target = pages[pages.length - 1];
        target.content_blocks.push(chunk);
      });
      operations.push({ op: 'split_block', page: pageIndex + 1, blockType: block.type, sourceItems: blockItems(block).length, createdChunks: chunks.length });
      continue;
    }
    if (current.content_blocks.length) {
      pages.push({ ...source, content_blocks: [block] });
      operations.push({ op: 'move_block', page: pageIndex + 1, blockType: block.type });
    } else current.content_blocks.push(block);
  }
  const nonEmpty = pages.filter((item) => item.content_blocks.length || item.kind !== 'content');
  if (nonEmpty.length > 1) {
    const groupId = String(source.page_group_id || `storyboard-page-${pageIndex + 1}`);
    nonEmpty.forEach((item, index) => {
      item.page_group_id = groupId;
      item.continuation_of = Number(source.continuation_of || pageIndex + 1);
      item.continuation_index = index + 1;
      if (index > 0 && item.kind !== 'cover' && item.kind !== 'ending') item.title = continuationTitle(source.title, index);
    });
  }
  return { pages: nonEmpty, operations };
}

function reflowPage(page, capacity, pageIndex) {
  const resolvedCapacity = capacity || { structural: { maxBlocks: 4, maxItems: 9 }, visual: { bodyHeightPx: 420, maxTitleLines: 3 }, split: { allowed: true, blockTypes: [...SPLITTABLE] } };
  const initial = estimateSocialCardPageLoad(page, resolvedCapacity);
  if (!initial.overCapacity || page.kind === 'cover' || page.kind === 'ending') return { pages: [page], operations: [], preflight: initial };
  const result = splitPage(page, resolvedCapacity, pageIndex);
  const finalPreflight = result.pages.map((item) => estimateSocialCardPageLoad(item, resolvedCapacity));
  return { ...result, preflight: { initial, final: finalPreflight, unresolved: finalPreflight.filter((item) => item.overCapacity).length } };
}

function pageGroupKey(page) {
  const value = String(page?.page_group_id || '').trim();
  return value || null;
}

function mergeableContinuationPages(first, second) {
  if (!first || !second || first.kind === 'cover' || first.kind === 'ending' || second.kind === 'cover' || second.kind === 'ending') return false;
  if (first.kind !== second.kind) return false;
  if (String(first.role || inferCardPageRole(first)) !== String(second.role || inferCardPageRole(second))) return false;
  const group = pageGroupKey(first);
  return Boolean(group && group === pageGroupKey(second));
}

function reindexContinuationGroups(pages) {
  const groups = new Map();
  pages.forEach((page, index) => {
    const group = pageGroupKey(page);
    if (!group) return;
    if (!groups.has(group)) groups.set(group, { firstIndex: index, title: String(page.title || '').replace(/（续\d*）$/, '') });
  });
  groups.forEach(({ firstIndex, title }, group) => {
    const first = pages[firstIndex];
    const continuationOf = Number(first.continuation_of || firstIndex + 1);
    let continuationIndex = 0;
    pages.forEach((page) => {
      if (pageGroupKey(page) !== group) return;
      continuationIndex += 1;
      page.continuation_of = continuationOf;
      page.continuation_index = continuationIndex;
      if (continuationIndex > 1 && page.kind !== 'cover' && page.kind !== 'ending') page.title = continuationTitle(title, continuationIndex - 1);
    });
  });
}

/**
 * 将同一故事板页产生的过短续页重新装箱。
 *
 * 这里允许一个小的静态测量余量（默认 8%）：静态估算会把主题边框、阴影
 * 等因素算得比浏览器略保守，最终仍由浏览器布局审计决定是否接受该候选页。
 * 仅合并同组、同角色的内容页，且不突破 block/item 的硬上限。
 */
export function mergeUnderfilledContinuationPages({ pages = [], capacityProfile = null, slack = 1.08 } = {}) {
  const output = (Array.isArray(pages) ? pages : []).map(clone);
  const operations = [];
  const factor = Math.max(1, Number(slack) || 1.08);
  let index = 0;
  while (index < output.length - 1) {
    const first = output[index];
    const second = output[index + 1];
    if (!mergeableContinuationPages(first, second)) {
      index += 1;
      continue;
    }
    const role = first.role || inferCardPageRole(first);
    const capacity = capacityProfileForRole(capacityProfile, role);
    if (!capacity) {
      index += 1;
      continue;
    }
    const candidate = {
      ...first,
      content_blocks: [
        ...(Array.isArray(first.content_blocks) ? first.content_blocks : []),
        ...(Array.isArray(second.content_blocks) ? second.content_blocks : []),
      ],
    };
    const estimate = estimateSocialCardPageLoad(candidate, capacity);
    const hardReasons = estimate.reasons.filter((reason) => reason !== 'estimated-height');
    if (hardReasons.length || estimate.estimatedHeightPx > estimate.bodyHeightPx * factor) {
      index += 1;
      continue;
    }
    output.splice(index, 2, candidate);
    operations.push({ op: 'merge_pages', pages: [index + 1, index + 2], role, estimatedHeightPx: estimate.estimatedHeightPx, bodyHeightPx: estimate.bodyHeightPx });
    if (index > 0) index -= 1;
  }
  if (operations.length) reindexContinuationGroups(output);
  return { pages: output, operations };
}

function moveableBlock(block) {
  return block && typeof block === 'object' && String(block.type || 'text') !== 'code';
}

/**
 * 在不能合并的同组续页之间移动完整内容块，改善左右/上下内容失衡。
 * 这是确定性装箱：不改写文本、不删除事实，只在目标页仍通过硬容量校验时移动。
 */
export function balanceContinuationPages({ pages = [], capacityProfile = null, underfillThreshold = 0.62 } = {}) {
  const output = (Array.isArray(pages) ? pages : []).map(clone);
  const operations = [];
  const threshold = Math.min(0.9, Math.max(0.2, Number(underfillThreshold) || 0.62));

  for (let index = 0; index < output.length - 1; index += 1) {
    const first = output[index];
    const second = output[index + 1];
    if (!mergeableContinuationPages(first, second)) continue;
    const role = first.role || inferCardPageRole(first);
    const capacity = capacityProfileForRole(capacityProfile, role);
    if (!capacity) continue;
    const firstEstimate = estimateSocialCardPageLoad(first, capacity);
    const secondEstimate = estimateSocialCardPageLoad(second, capacity);
    const firstRatio = firstEstimate.estimatedHeightPx / Math.max(1, firstEstimate.bodyHeightPx);
    const secondRatio = secondEstimate.estimatedHeightPx / Math.max(1, secondEstimate.bodyHeightPx);
    const firstBlocks = Array.isArray(first.content_blocks) ? first.content_blocks : [];
    const secondBlocks = Array.isArray(second.content_blocks) ? second.content_blocks : [];
    const moveSecondToFirst = firstRatio < threshold && secondRatio > firstRatio && secondBlocks.length >= 2;
    const moveFirstToSecond = secondRatio < threshold && firstRatio > secondRatio && firstBlocks.length >= 2;
    if (!moveSecondToFirst && !moveFirstToSecond) continue;

    const currentGap = Math.abs(firstEstimate.estimatedHeightPx - secondEstimate.estimatedHeightPx);
    let best = null;
    const sourceBlocks = moveSecondToFirst ? secondBlocks : firstBlocks;
    const blockIndex = moveSecondToFirst ? 0 : firstBlocks.length - 1;
    const block = sourceBlocks[blockIndex];
    if (!moveableBlock(block)) continue;
    const candidateFirst = moveSecondToFirst
      ? { ...first, content_blocks: [...firstBlocks, clone(block)] }
      : { ...first, content_blocks: firstBlocks.slice(0, -1) };
    const candidateSecond = moveSecondToFirst
      ? { ...second, content_blocks: secondBlocks.slice(1) }
      : { ...second, content_blocks: [clone(block), ...secondBlocks] };
    const firstCandidateEstimate = estimateSocialCardPageLoad(candidateFirst, capacity);
    const secondCandidateEstimate = estimateSocialCardPageLoad(candidateSecond, capacity);
    const hardReasons = [...firstCandidateEstimate.reasons, ...secondCandidateEstimate.reasons]
      .filter((reason) => reason !== 'estimated-height');
    if (hardReasons.length || firstCandidateEstimate.overCapacity || secondCandidateEstimate.overCapacity) continue;
    const nextGap = Math.abs(firstCandidateEstimate.estimatedHeightPx - secondCandidateEstimate.estimatedHeightPx);
    if (nextGap >= currentGap) continue;
    best = { block, blockIndex, candidateFirst, candidateSecond, firstCandidateEstimate, secondCandidateEstimate, nextGap, fromPage: moveSecondToFirst ? index + 2 : index + 1, toPage: moveSecondToFirst ? index + 1 : index + 2 };
    if (!best) continue;
    output[index] = best.candidateFirst;
    output[index + 1] = best.candidateSecond;
    operations.push({
      op: 'move_block',
      from_page: best.fromPage,
      to_page: best.toPage,
      block: best.blockIndex,
      blockType: best.block.type,
      role,
      estimatedHeightPx: best.fromPage === index + 1
        ? { from: best.firstCandidateEstimate.estimatedHeightPx, to: best.secondCandidateEstimate.estimatedHeightPx }
        : { from: best.secondCandidateEstimate.estimatedHeightPx, to: best.firstCandidateEstimate.estimatedHeightPx },
      bodyHeightPx: best.firstCandidateEstimate.bodyHeightPx,
    });
  }
  if (operations.length) reindexContinuationGroups(output);
  return { pages: output, operations };
}

/** 将续页均衡与过短续页合并统一为一次确定性的计划编排。 */
export function rebalanceContinuationPages({ pages = [], capacityProfile = null, mergeSlack = 1.08, underfillThreshold = 0.62 } = {}) {
  const balanced = balanceContinuationPages({ pages, capacityProfile, underfillThreshold });
  const packed = mergeUnderfilledContinuationPages({ pages: balanced.pages, capacityProfile, slack: mergeSlack });
  return {
    pages: packed.pages,
    operations: [...balanced.operations, ...packed.operations],
  };
}

/** 模板感知的确定性重排：保留事实，优先拆分可续页块，不做 AI 改写或静默截断。 */
export function compileTemplateAwareCardPlan({ cardPlan = [], capacityProfile = null, maxPages = 9, mergeSlack = 1.08 } = {}) {
  const source = Array.isArray(cardPlan) ? cardPlan : [];
  const pages = [];
  const operations = [];
  const preflight = [];
  for (let index = 0; index < source.length; index += 1) {
    const page = source[index] || {};
    const role = page.role || inferCardPageRole(page);
    const capacity = capacityProfileForRole(capacityProfile, role);
    const result = reflowPage(page, capacity, index);
    pages.push(...result.pages);
    operations.push(...result.operations);
    preflight.push({ page: index + 1, role, ...result.preflight });
  }
  const packed = rebalanceContinuationPages({ pages, capacityProfile, mergeSlack });
  if (packed.operations.length) {
    pages.splice(0, pages.length, ...packed.pages);
    operations.push(...packed.operations);
  }
  const capped = pages.length > maxPages;
  const warnings = capped ? [`确定性续页后得到 ${pages.length} 页，超过当前上限 ${maxPages}；未删除事实，待后续结构修复处理`] : [];
  return {
    pages,
    changed: operations.length > 0 || pages.length !== source.length,
    originalPageCount: source.length,
    finalPageCount: pages.length,
    operations,
    preflight,
    warnings,
    unresolved: preflight.flatMap((item) => item.final ? item.final.filter((entry) => entry.overCapacity).map(() => ({ page: item.page, role: item.role, reason: 'still-over-capacity' })) : []),
  };
}
