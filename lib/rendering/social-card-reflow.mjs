import { capacityProfileForRole } from './social-card-capacity.mjs';
import { inferCardPageRole } from './social-card-role.mjs';
import { listBlockValues } from './social-card-plan.mjs';

const SPLITTABLE = new Set(['list', 'steps', 'timeline', 'scenes', 'compare', 'stats', 'text', 'note', 'code']);
const ITEM_BLOCKS = new Set(['list', 'steps', 'timeline', 'scenes', 'stats']);
const CODE_NEAR_FIT_RATIO = 1.06;

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

function splitTextUnits(content) {
  const value = String(content || '').trim();
  if (!value) return [];
  const paragraphs = value.split(/\n\s*\n+/).map((item) => item.trim()).filter(Boolean);
  const units = [];
  paragraphs.forEach((paragraph) => {
    const sentences = paragraph.split(/(?<=[。！？!?；;])\s+|(?<=[。！？!?；;])(?=[\u4e00-\u9fff])/).map((item) => item.trim()).filter(Boolean);
    if (sentences.length > 1) units.push(...sentences);
    else units.push(paragraph);
  });
  return units;
}

function compactTextFallback(value, { ratio = .72, minChars = 42 } = {}) {
  const original = String(value ?? '').trim();
  if (original.length <= minChars) return original;
  // 命令与 URL 不能被截断；代码块本身在调用处直接跳过。
  if (/https?:\/\/\S+|\b(?:npm|pnpm|yarn|npx|git|curl|wget|pip|uv|docker)\s+\S+/iu.test(original)) return original;
  const target = Math.max(minChars, Math.floor(original.length * Math.min(.9, Math.max(.45, Number(ratio) || .72))));
  if (target >= original.length) return original;
  let compact = original.slice(0, Math.max(1, target - 1));
  const boundary = compact.match(/^([\s\S]*?)(?:[。！？!?；;]|\s|，|,)(?=[\s\S]*$)/);
  compact = (boundary?.[1] || compact).trim().replace(/[，,；;、\s]+$/g, '');
  if (compact.length < Math.max(22, Math.floor(target * .45))) compact = original.slice(0, target - 1).trim();
  return compact && compact.length < original.length ? `${compact}…` : original;
}

function compactBlockFallback(block, options = {}) {
  const type = String(block?.type || '');
  if (!['text', 'note', 'list', 'steps'].includes(type)) return { block, changed: false };
  const next = clone(block);
  let changed = false;
  if (type === 'text' || type === 'note') {
    const content = compactTextFallback(next.content, options);
    changed = content !== String(next.content || '').trim();
    next.content = content;
  } else if (Array.isArray(next.items)) {
    next.items = next.items.map((item) => {
      if (typeof item === 'string') {
        const content = compactTextFallback(item, options);
        changed ||= content !== item.trim();
        return content;
      }
      if (!item || typeof item !== 'object') return item;
      const content = compactTextFallback(item.content, options);
      if (content === String(item.content || '').trim()) return item;
      changed = true;
      return { ...item, content };
    });
  }
  return { block: next, changed };
}

function compactPageFallback(page, capacity, pageIndex) {
  let current = clone(page);
  const operations = [];
  for (const ratio of [.82, .68]) {
    const estimate = estimateSocialCardPageLoad(current, capacity);
    if (!estimate.overCapacity) break;
    const blocks = Array.isArray(current.content_blocks) ? current.content_blocks : [];
    let changed = false;
    const nextBlocks = blocks.map((block, blockIndex) => {
      const result = compactBlockFallback(block, { ratio });
      if (result.changed) {
        changed = true;
        operations.push({ op: 'compact_text_fallback', page: pageIndex + 1, block: blockIndex + 1, ratio, ellipsis: true });
      }
      return result.block;
    });
    if (!changed) break;
    current = { ...current, content_blocks: nextBlocks };
  }
  return { page: current, operations };
}

function splitCodeUnits(content) {
  const value = String(content || '').trim();
  if (!value) return [];
  const groups = value.split(/\n\s*\n+/).map((item) => item.trim()).filter(Boolean);
  if (groups.length > 1) return groups;
  const lines = value.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim());
  if (lines.length < 2) return [value];
  const units = [];
  let current = [];
  lines.forEach((line) => {
    const isComment = /^\s*(?:#|\/\/|REM\b)/i.test(line);
    if (isComment && current.length && current.some((item) => !/^\s*(?:#|\/\/|REM\b)/i.test(item))) {
      units.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  });
  if (current.length) units.push(current.join('\n'));
  return units.length > 1 ? units : [value];
}

function splitUnitsForBlock(block) {
  const type = String(block?.type || 'text');
  if (type === 'code') return splitCodeUnits(block?.content);
  if (type === 'note' || type === 'text') return splitTextUnits(block?.content);
  return blockItems(block);
}

function withSplitUnits(block, units) {
  const next = clone(block);
  const type = String(block?.type || 'text');
  if (type === 'code' || type === 'note' || type === 'text') {
    next.content = units.map(itemText).join('\n\n');
    if (Array.isArray(next.items)) next.items = [];
    return next;
  }
  return withItems(block, units);
}

function continuationTitle(title, index) {
  const value = String(title || '').trim();
  return value ? `${value}（续${index > 1 ? index : ''}）` : `内容（续${index > 1 ? index : ''}）`;
}

function blockFontScale(block) {
  const raw = Number(block?.font_scale ?? block?.fontScale ?? 1);
  if (!Number.isFinite(raw)) return 1;
  const max = String(block?.type || '') === 'code' ? 1.12 : 1.18;
  return Math.min(max, Math.max(1, raw));
}

function blockHeight(block, visual) {
  const type = String(block?.type || 'text');
  const scale = blockFontScale(block);
  const scaled = (height) => Math.ceil(height * scale);
  const heading = textLength(block?.title) ? 25 : 8;
  if (type === 'code') return scaled(165 + Math.ceil(textLength(block?.content) / 36) * 12);
  if (type === 'compare') {
    const rows = Array.isArray(block?.rows) ? block.rows : [];
    return scaled(heading + 26 + rows.reduce((sum, row) => sum + Math.max(1, lineEstimate((Array.isArray(row) ? row : []).join(' '), 28)) * 18, 0));
  }
  const values = blockItems(block);
  if (values.length) {
    const itemHeight = type === 'stats' ? 58 : type === 'steps' ? 48 : type === 'timeline' ? 48 : 24;
    return scaled(heading + values.reduce((sum, item) => sum + itemHeight + Math.max(0, lineEstimate(itemText(item), 22) - 1) * 15, 0) + Math.max(0, values.length - 1) * 5);
  }
  return scaled(heading + Math.max(1, lineEstimate(block?.content, 28)) * 17 + 14);
}

function mergeAdjacentCodeBlocksForEstimate(blocks) {
  const output = [];
  for (const block of blocks) {
    const previous = output.at(-1);
    if (previous && String(previous?.type || '') === 'code' && String(block?.type || '') === 'code') {
      previous.content = [previous.content, block.content]
        .filter((value) => String(value || '').trim())
        .join('\n\n');
      previous.source_refs = [...new Set([
        ...(Array.isArray(previous.source_refs) ? previous.source_refs : []),
        ...(Array.isArray(block.source_refs) ? block.source_refs : []),
      ].map(String))];
      continue;
    }
    output.push(clone(block));
  }
  return output;
}

/**
 * 估算页面容量。相邻代码块在高度模型中按一个代码面板计算，避免把
 * 边框、内边距和面板间距重复计入；结构性 block-count 仍按原始块数量
 * 校验。reflow 在需要判断“合并前/后”时可关闭该归一化。
 */
export function estimateSocialCardPageLoad(page, capacity, { mergeAdjacentCode = false } = {}) {
  const visual = capacity?.visual || {};
  const titleHeight = Math.min(Number(visual.maxTitleLines || 3), lineEstimate(page?.title, 10)) * 34;
  const blocks = Array.isArray(page?.content_blocks) ? page.content_blocks : [];
  const visualBlocks = mergeAdjacentCode ? mergeAdjacentCodeBlocksForEstimate(blocks) : blocks;
  const estimatedHeightPx = Math.round(80 + titleHeight + visualBlocks.reduce((sum, block) => sum + blockHeight(block, visual), 0) + Math.max(0, visualBlocks.length - 1) * 8);
  const bodyHeightPx = Number(visual.bodyHeightPx || 420);
  const reasons = [];
  if (blocks.length > Number(capacity?.structural?.maxBlocks || 99)) reasons.push('block-count');
  const itemCount = blocks.reduce((sum, block) => sum + blockItems(block).length, 0);
  if (itemCount > Number(capacity?.structural?.maxItems || 99)) reasons.push('item-count');
  // 代码面板的固定装饰高度仍然是静态估算；保留原有 2% 硬预检余量，
  // 另行输出 nearFit，供重排层在相邻代码块合并后交给浏览器审计裁决。
  const staticSlack = blocks.some((block) => String(block?.type || '') === 'code') ? 1.02 : 1;
  const hardReasons = reasons.filter((reason) => reason !== 'estimated-height');
  const nearFit = blocks.some((block) => String(block?.type || '') === 'code')
    && hardReasons.length === 0
    && estimatedHeightPx <= bodyHeightPx * CODE_NEAR_FIT_RATIO;
  if (estimatedHeightPx > bodyHeightPx * staticSlack) reasons.push('estimated-height');
  return {
    estimatedHeightPx,
    bodyHeightPx,
    itemCount,
    visualBlockCount: visualBlocks.length,
    structuralBlockCount: blocks.length,
    hardFitRatio: staticSlack,
    nearFitRatio: CODE_NEAR_FIT_RATIO,
    nearFit,
    overCapacity: reasons.length > 0,
    reasons,
  };
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
  const values = splitUnitsForBlock(block);
  if (values.length < 2) return null;
  const chunks = [];
  let current = [];
  // 拆页时测量“完整候选页”，而不是只测内容块。这样标题、页眉页脚、边框和间距
  // 都由同一个 estimateSocialCardPageLoad 规则计入，不再依赖难以解释的固定扣减值。
  const fallbackBase = Math.max(100, Number(availableHeight || capacity.visual.bodyHeightPx) - 175);
  const pageHeight = (items) => pageTemplate
    ? estimateSocialCardPageLoad({ ...pageTemplate, content_blocks: [withSplitUnits(block, items)] }, capacity).estimatedHeightPx
    : blockHeight(withSplitUnits(block, items), capacity.visual);
  const fits = (items) => pageTemplate
    ? !estimateSocialCardPageLoad({ ...pageTemplate, content_blocks: [withSplitUnits(block, items)] }, capacity).overCapacity
    : pageHeight(items) <= fallbackBase;
  for (const value of values) {
    const trial = [...current, value];
    if (current.length && !fits(trial)) {
      chunks.push(withSplitUnits(block, current));
      current = [value];
    } else current = trial;
  }
  if (current.length) chunks.push(withSplitUnits(block, current));
  // 避免最后一个续页只承载很少条目：在两页都不超容量且整体更均衡时，
  // 从前一页向最后一页移动完整条目，不改变原始顺序和内容。
  if (chunks.length > 1 && values.length >= 4) {
    const previousIndex = chunks.length - 2;
    let previousItems = splitUnitsForBlock(chunks[previousIndex]);
    let lastItems = splitUnitsForBlock(chunks.at(-1));
    while (previousItems.length > lastItems.length + 1 && previousItems.length > 2) {
      const moved = previousItems.at(-1);
      const previousCandidate = withSplitUnits(block, previousItems.slice(0, -1));
      // 被移动条目必须放在续页最前面，否则三页拆分时会打乱原始顺序。
      const lastCandidate = withSplitUnits(block, [moved, ...lastItems]);
      if (!fits(splitUnitsForBlock(previousCandidate)) || !fits(splitUnitsForBlock(lastCandidate))) break;
      const currentGap = Math.abs(pageHeight(splitUnitsForBlock(chunks[previousIndex])) - pageHeight(splitUnitsForBlock(chunks.at(-1))));
      const nextGap = Math.abs(pageHeight(splitUnitsForBlock(previousCandidate)) - pageHeight(splitUnitsForBlock(lastCandidate)));
      if (nextGap >= currentGap) break;
      chunks[previousIndex] = previousCandidate;
      chunks[chunks.length - 1] = lastCandidate;
      previousItems = splitUnitsForBlock(previousCandidate);
      lastItems = splitUnitsForBlock(lastCandidate);
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
      operations.push({ op: 'split_block', page: pageIndex + 1, blockType: block.type, sourceItems: splitUnitsForBlock(block).length, createdChunks: chunks.length, boundary: ['code', 'note', 'text'].includes(String(block?.type || '')) ? 'semantic' : 'item' });
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

function coalesceCodeBlocks(page, capacity, pageIndex) {
  const source = clone(page);
  const blocks = Array.isArray(source.content_blocks) ? source.content_blocks : [];
  const operations = [];
  if (blocks.filter((block) => String(block?.type || '') === 'code').length < 2) return { page: source, operations };
  let current = { ...source, content_blocks: blocks };
  while (true) {
    const currentEstimate = estimateSocialCardPageLoad(current, capacity, { mergeAdjacentCode: false });
    let best = null;
    for (let index = 0; index < current.content_blocks.length - 1; index += 1) {
      const first = current.content_blocks[index];
      const second = current.content_blocks[index + 1];
      if (String(first?.type || '') !== 'code' || String(second?.type || '') !== 'code') continue;
      const merged = {
        type: 'code',
        title: String(first?.title || second?.title || '命令'),
        content: [first?.content, second?.content].filter((value) => String(value || '').trim()).join('\n\n'),
        source_refs: [...new Set([...(first?.source_refs || []), ...(second?.source_refs || [])].map(String))],
      };
      const candidate = {
        ...current,
        content_blocks: [...current.content_blocks.slice(0, index), merged, ...current.content_blocks.slice(index + 2)],
      };
      const estimate = estimateSocialCardPageLoad(candidate, capacity, { mergeAdjacentCode: false });
      if (!best || estimate.estimatedHeightPx < best.estimate.estimatedHeightPx) best = { index, candidate, estimate };
    }
    if (!best) break;
    const nearFitLimit = best.estimate.bodyHeightPx * CODE_NEAR_FIT_RATIO;
    const improvesEstimate = best.estimate.estimatedHeightPx < currentEstimate.estimatedHeightPx;
    const shouldMerge = currentEstimate.overCapacity || (improvesEstimate && best.estimate.estimatedHeightPx <= nearFitLimit);
    if (!shouldMerge) break;
    current = best.candidate;
    operations.push({ op: 'coalesce_code_blocks', page: pageIndex + 1, blocks: [best.index, best.index + 1], blockType: 'code' });
  }
  return { page: current, operations };
}

function reflowPage(page, capacity, pageIndex) {
  const resolvedCapacity = capacity || { structural: { maxBlocks: 4, maxItems: 9 }, visual: { bodyHeightPx: 420, maxTitleLines: 3 }, split: { allowed: true, blockTypes: [...SPLITTABLE] } };
  const compacted = page.kind === 'cover' || page.kind === 'ending'
    ? { page, operations: [] }
    : coalesceCodeBlocks(page, resolvedCapacity, pageIndex);
  const initial = estimateSocialCardPageLoad(compacted.page, resolvedCapacity);
  if (!initial.overCapacity || initial.nearFit) return { pages: [compacted.page], operations: compacted.operations, preflight: initial };
  const result = splitPage(compacted.page, resolvedCapacity, pageIndex);
  let pages = result.pages;
  let fallbackOperations = [];
  const fallbackPages = pages.map((item, index) => {
    const estimate = estimateSocialCardPageLoad(item, resolvedCapacity);
    if (!estimate.overCapacity || estimate.nearFit) return item;
    const fallback = compactPageFallback(item, resolvedCapacity, pageIndex + index);
    fallbackOperations.push(...fallback.operations);
    return fallback.page;
  });
  pages = fallbackPages;
  const finalPreflight = pages.map((item) => estimateSocialCardPageLoad(item, resolvedCapacity));
  return { ...result, pages, operations: [...compacted.operations, ...result.operations, ...fallbackOperations], preflight: { initial, final: finalPreflight, unresolved: finalPreflight.filter((item) => item.overCapacity && !item.nearFit).length } };
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

function duplicateBlockValue(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).replace(/[\s\u3000]+/g, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  }
  if (Array.isArray(value)) return value.map(duplicateBlockValue);
  if (typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (['source_refs', 'fact_ids', 'supplement_slot_id'].includes(key)) return result;
      result[key] = duplicateBlockValue(value[key]);
      return result;
    }, {});
  }
  return String(value);
}

function continuationBlockFingerprint(block) {
  const type = String(block?.type || 'text');
  // 只去重可明确识别为“说明性重复”的块。列表/步骤等结构化事实可能
  // 在不同续页承担不同叙事职责，不在这里做内容删除。
  if (!['code', 'note', 'text'].includes(type)) return '';
  const sourceRefs = Array.isArray(block?.source_refs)
    ? block.source_refs.map((value) => duplicateBlockValue(value)).sort()
    : [];
  const payload = type === 'code'
    // 代码块的注释经常被模型改写（“第10行”/“第 10 行”），但真正
    // 可执行的命令行保持不变；只比较非注释命令行，避免重复命令被
    // 不同解释句掩盖。
    ? String(block?.content || '').split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join('\n')
    : { content: block?.content, title: block?.title };
  const normalized = JSON.stringify(duplicateBlockValue(payload));
  if (normalized.length < 24) return '';
  return `${type}|${sourceRefs.join(',')}|${normalized}`;
}

/**
 * 故事板偶尔会把同一个代码/说明块重复放进连续页。若直接进入模板
 * 重排，重复块会被再次拆成“只有一个代码块”的偏空页。这里仅在同一
 * page_group_id、同一角色内去掉后续页的规范化重复块；不碰列表/步骤
 * 等结构化事实，也不以相似度猜测不同内容。每次去重都写入内部操作
 * 记录，方便布局审计和交付报告追踪。
 */
function dedupeContinuationBlocks(cardPlan) {
  const pages = (Array.isArray(cardPlan) ? cardPlan : []).map(clone);
  const seenByGroup = new Map();
  const operations = [];
  const keptPages = [];
  pages.forEach((page, pageIndex) => {
    const group = pageGroupKey(page);
    const role = String(page?.role || inferCardPageRole(page));
    const seen = group ? (seenByGroup.get(`${group}|${role}`) || new Map()) : null;
    const blocks = Array.isArray(page?.content_blocks) ? page.content_blocks : [];
    const keptBlocks = [];
    blocks.forEach((block, blockIndex) => {
      const fingerprint = seen ? continuationBlockFingerprint(block) : '';
      if (fingerprint && seen.has(fingerprint)) {
        operations.push({
          op: 'dedupe_duplicate_block',
          page: pageIndex + 1,
          block: blockIndex,
          blockType: String(block?.type || 'text'),
          duplicateOfPage: seen.get(fingerprint).page,
          duplicateOfBlock: seen.get(fingerprint).block,
          source: 'deterministic-continuation-dedupe',
        });
        return;
      }
      keptBlocks.push(block);
      if (fingerprint) seen.set(fingerprint, { page: pageIndex + 1, block: blockIndex });
    });
    if (seen && !seenByGroup.has(`${group}|${role}`)) seenByGroup.set(`${group}|${role}`, seen);
    // 只移除去重后没有任何内容块的普通续页；封面和结尾页始终保留。
    if (!keptBlocks.length && page.kind !== 'cover' && page.kind !== 'ending') return;
    page.content_blocks = keptBlocks;
    keptPages.push(page);
  });
  return { pages: keptPages, operations };
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
  // code/note/text 已经具备语义边界；移动完整块或一个完整语义单元
  // 不会造成半条命令、半段说明。这里不再把 code 视为不可移动块。
  return block && typeof block === 'object';
}

function semanticBoundaryMove({ first, second, firstBlocks, secondBlocks, moveSecondToFirst }) {
  const sourceBlocks = moveSecondToFirst ? secondBlocks : firstBlocks;
  const sourceBlockIndex = moveSecondToFirst ? 0 : sourceBlocks.length - 1;
  const block = sourceBlocks[sourceBlockIndex];
  if (!moveableBlock(block)) return null;
  const units = splitUnitsForBlock(block);
  // 一个块只有一个语义单元时，交给完整 block 移动逻辑处理；
  // 多单元块则只移动边界单元，避免为了平衡而再次拆出空块。
  if (units.length < 2) return null;
  const movedUnits = moveSecondToFirst ? units.slice(0, 1) : units.slice(-1);
  const keptUnits = moveSecondToFirst ? units.slice(1) : units.slice(0, -1);
  if (!keptUnits.length) return null;
  const keptBlock = withSplitUnits(block, keptUnits);
  const movedBlock = withSplitUnits(block, movedUnits);
  const nextFirst = moveSecondToFirst
    ? { ...first, content_blocks: [...firstBlocks, movedBlock] }
    : { ...first, content_blocks: [...firstBlocks.slice(0, -1), keptBlock] };
  const nextSecond = moveSecondToFirst
    ? { ...second, content_blocks: [keptBlock, ...secondBlocks.slice(1)] }
    : { ...second, content_blocks: [movedBlock, ...secondBlocks] };
  return { candidateFirst: nextFirst, candidateSecond: nextSecond, block, blockIndex: sourceBlockIndex, boundary: 'semantic' };
}

/**
 * 在不能合并的同组续页之间移动完整内容块，改善左右/上下内容失衡。
 * 这是确定性装箱：不改写文本、不删除事实，只在目标页仍通过硬容量校验时移动。
 */
export function balanceContinuationPages({ pages = [], capacityProfile = null, underfillThreshold = 0.62 } = {}) {
  const output = (Array.isArray(pages) ? pages : []).map(clone);
  const operations = [];
  const threshold = Math.min(0.9, Math.max(0.2, Number(underfillThreshold) || 0.62));
  // 一个故事线可能有三页以上；每次只做一个严格改善的移动，再重新扫描，
  // 直到没有可行移动，避免单轮遍历留下“前页很空、后页很满”的局部最优。
  let changed = true;
  let guard = 0;
  while (changed && guard < Math.max(1, output.length * 3)) {
    changed = false;
    guard += 1;
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
      const directions = [];
      if (firstRatio < threshold && secondRatio > firstRatio) directions.push(true);
      if (secondRatio < threshold && firstRatio > secondRatio) directions.push(false);
      if (!directions.length) continue;

      const currentGap = Math.abs(firstEstimate.estimatedHeightPx - secondEstimate.estimatedHeightPx);
      let best = null;
      for (const moveSecondToFirst of directions) {
        const sourceBlocks = moveSecondToFirst ? secondBlocks : firstBlocks;
        if (sourceBlocks.length < 1) continue;
        const semantic = semanticBoundaryMove({ first, second, firstBlocks, secondBlocks, moveSecondToFirst });
        const blockIndex = moveSecondToFirst ? 0 : firstBlocks.length - 1;
        const block = sourceBlocks[blockIndex];
        if (!semantic && sourceBlocks.length < 2) continue;
        const candidate = semantic || (moveableBlock(block) ? {
          candidateFirst: moveSecondToFirst
            ? { ...first, content_blocks: [...firstBlocks, clone(block)] }
            : { ...first, content_blocks: firstBlocks.slice(0, -1) },
          candidateSecond: moveSecondToFirst
            ? { ...second, content_blocks: secondBlocks.slice(1) }
            : { ...second, content_blocks: [clone(block), ...secondBlocks] },
          block,
          blockIndex,
          boundary: 'block',
        } : null);
        if (!candidate) continue;
        const firstCandidateEstimate = estimateSocialCardPageLoad(candidate.candidateFirst, capacity);
        const secondCandidateEstimate = estimateSocialCardPageLoad(candidate.candidateSecond, capacity);
        const hardReasons = [...firstCandidateEstimate.reasons, ...secondCandidateEstimate.reasons]
          .filter((reason) => reason !== 'estimated-height');
        if (hardReasons.length || firstCandidateEstimate.overCapacity || secondCandidateEstimate.overCapacity) continue;
        const nextGap = Math.abs(firstCandidateEstimate.estimatedHeightPx - secondCandidateEstimate.estimatedHeightPx);
        if (nextGap >= currentGap || (best && nextGap >= best.nextGap)) continue;
        best = { ...candidate, firstCandidateEstimate, secondCandidateEstimate, nextGap, fromPage: moveSecondToFirst ? index + 2 : index + 1, toPage: moveSecondToFirst ? index + 1 : index + 2 };
      }
      if (!best) continue;
      output[index] = best.candidateFirst;
      output[index + 1] = best.candidateSecond;
      operations.push({
        op: 'move_block',
        from_page: best.fromPage,
        to_page: best.toPage,
        block: best.blockIndex,
        blockType: best.block.type,
        boundary: best.boundary,
        role,
        estimatedHeightPx: best.fromPage === index + 1
          ? { from: best.firstCandidateEstimate.estimatedHeightPx, to: best.secondCandidateEstimate.estimatedHeightPx }
          : { from: best.secondCandidateEstimate.estimatedHeightPx, to: best.firstCandidateEstimate.estimatedHeightPx },
        bodyHeightPx: best.firstCandidateEstimate.bodyHeightPx,
      });
      changed = true;
      break;
    }
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
export function compileTemplateAwareCardPlan({ cardPlan = [], capacityProfile = null, maxPages = 9, absoluteMaxPages = null, mergeSlack = 1.08 } = {}) {
  const source = Array.isArray(cardPlan) ? cardPlan : [];
  const deduped = dedupeContinuationBlocks(source);
  const normalizedSource = deduped.pages;
  const pages = [];
  const operations = [];
  const preflight = [];
  for (let index = 0; index < normalizedSource.length; index += 1) {
    const page = normalizedSource[index] || {};
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
  const recommendedExceeded = pages.length > Number(maxPages);
  const absoluteExceeded = Number.isFinite(Number(absoluteMaxPages)) && pages.length > Number(absoluteMaxPages);
  const warnings = [];
  if (deduped.operations.length) warnings.push(`同一故事线去重 ${deduped.operations.length} 个重复说明块`);
  if (recommendedExceeded) warnings.push(`确定性续页后得到 ${pages.length} 页，超过推荐页数 ${maxPages}；未删除事实，继续按续页渲染`);
  if (absoluteExceeded) warnings.push(`确定性续页后得到 ${pages.length} 页，超过绝对安全上限 ${absoluteMaxPages}；未删除事实，交由绝对页数门禁阻断`);
  return {
    pages,
    changed: deduped.operations.length > 0 || operations.length > 0 || pages.length !== source.length,
    originalPageCount: source.length,
    finalPageCount: pages.length,
    operations: [...deduped.operations, ...operations],
    preflight,
    warnings,
    pageBudget: { recommended: Number(maxPages), absolute: Number.isFinite(Number(absoluteMaxPages)) ? Number(absoluteMaxPages) : null, recommendedExceeded, absoluteExceeded },
    unresolved: preflight.flatMap((item) => item.final ? item.final.filter((entry) => entry.overCapacity).map(() => ({ page: item.page, role: item.role, reason: 'still-over-capacity' })) : []),
  };
}
