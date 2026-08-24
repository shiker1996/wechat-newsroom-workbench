import { createHash } from 'node:crypto';

const ITEM_BLOCKS = new Set(['list', 'steps', 'timeline', 'scenes', 'stats']);
const SPLITTABLE_BLOCKS = new Set(['list', 'steps', 'timeline', 'scenes', 'stats', 'compare', 'text']);

function text(value) {
  return String(value ?? '').trim();
}

function refs(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map(text).filter(Boolean))];
}

function fallbackRef(pageIndex, blockIndex, itemIndex = null) {
  return `legacy:page-${pageIndex + 1}:block-${blockIndex + 1}${itemIndex == null ? '' : `:item-${itemIndex + 1}`}`;
}

function itemValues(block) {
  if (ITEM_BLOCKS.has(String(block?.type || '')) && Array.isArray(block?.items) && block.items.length) return block.items;
  if (block?.type === 'list' && typeof block?.content === 'string') {
    const lines = block.content.split(/\n+/).map((value) => value.trim()).filter(Boolean);
    if (lines.length) return lines;
  }
  if (block?.type === 'compare' && Array.isArray(block?.rows) && block.rows.length) return block.rows;
  return null;
}

function itemText(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (!value || typeof value !== 'object') return text(value);
  const display = Object.entries(value)
    .filter(([key]) => !['source_refs', 'sourceRefs', 'atom_id', 'atomId'].includes(key))
    .map(([, item]) => typeof item === 'string' || typeof item === 'number' ? String(item) : JSON.stringify(item))
    .filter(Boolean)
    .join(' ');
  return text(display);
}

/**
 * 用于补充块互斥判断的稳定文本指纹。这里不做语义相似度，避免把
 * 不同事实误判成重复；事实 ID 和完全相同的展示条目分别负责事实级、
 * 内容级去重。
 */
export function normalizeSocialCardContentFingerprint(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\u3000]+/gu, '')
    .replace(/[，。！？；：、“”‘’（）()【】《》〈〉「」,.!?;:'"()[\]{}<>]/gu, '')
    .trim();
}

export function socialCardBlockContentValues(block = {}) {
  const values = itemValues(block);
  if (values) return values.map(itemText).map(normalizeSocialCardContentFingerprint).filter(Boolean);
  const value = block?.type === 'code' ? block.content : block?.content || block?.title || block?.text || '';
  return [normalizeSocialCardContentFingerprint(value)].filter(Boolean);
}

const SEMANTIC_INTENT_PATTERNS = Object.freeze([
  ['source', /来源|证据|核验|核查|出处|引用|参考/iu],
  ['maturity', /成熟度|成熟|当前状态|状态限制|阶段限制/iu],
  ['boundary', /边界|限制|风险|未知|未核实|缺口/iu],
  ['timeline', /时间线|时间点|阶段变化|发布记录/iu],
  ['release', /发布|上线|上市|融资/iu],
  ['metric', /指标|数据|规模|金额|数量/iu],
  ['capability', /能力|功能|特性/iu],
  ['context', /背景|概览|简介|说明/iu],
]);

const SLOT_INTENTS = Object.freeze({
  source: 'source',
  evidence: 'source',
  maturity: 'maturity',
  status: 'maturity',
  permission: 'boundary',
  network: 'boundary',
  cost_security: 'boundary',
  event: 'timeline',
  change: 'timeline',
  release: 'release',
  metric: 'metric',
  capability: 'capability',
  context: 'context',
});

/**
 * 页面级语义职责兜底。组件候选带有 semanticIntent，但历史核心块和
 * 已落地补充块未必带该字段，因此这里从页面角色、槽位和标题恢复稳定
 * 语义，供同页候选过滤及最终应用层兜底校验使用。
 */
export function socialCardBlockSemanticIntents(block = {}, page = {}) {
  const intents = new Set();
  const explicit = block?.semantic_intent ?? block?.semanticIntent;
  if (explicit) intents.add(String(explicit).trim());
  const slotId = String(block?.supplement_slot_id || block?.supplementSlotId || '').trim();
  if (SLOT_INTENTS[slotId]) intents.add(SLOT_INTENTS[slotId]);
  const role = String(page?.role || '').trim();
  if (role === 'evidence') intents.add('source');
  const title = String(block?.title || '').trim();
  for (const [intent, pattern] of SEMANTIC_INTENT_PATTERNS) if (pattern.test(title)) intents.add(intent);
  return [...intents].filter(Boolean);
}

/**
 * 汇总当前计划的核心覆盖和补充使用情况。
 * supplement_slot_id 是唯一可靠的来源边界：没有该字段的块视为故事板核心块，
 * 有该字段的块视为后续补充块。这样不会把历史核心块误当成补充候选。
 */
export function buildSocialCardSupplementUsageIndex(cardPlan = []) {
  const pages = Array.isArray(cardPlan) ? cardPlan : [];
  const coreFactIds = new Set();
  const supplementFactIds = new Set();
  const coreTextFingerprints = new Set();
  const supplementTextFingerprints = new Set();
  const pageUsage = new Map();

  pages.forEach((page, pageIndex) => {
    const pageNumber = pageIndex + 1;
    const pageFacts = new Set();
    const pageSlots = new Set();
    const pageTexts = new Set();
    const pageSemanticIntents = new Set();
    const blocks = Array.isArray(page?.content_blocks) ? page.content_blocks : [];
    blocks.forEach((block) => {
      const isSupplement = Boolean(String(block?.supplement_slot_id || '').trim());
      const factIds = Array.isArray(block?.fact_ids) ? block.fact_ids.map(String).filter(Boolean) : [];
      const texts = socialCardBlockContentValues(block);
      socialCardBlockSemanticIntents(block, page).forEach((intent) => pageSemanticIntents.add(intent));
      factIds.forEach((factId) => (isSupplement ? supplementFactIds : coreFactIds).add(factId));
      texts.forEach((fingerprint) => {
        (isSupplement ? supplementTextFingerprints : coreTextFingerprints).add(fingerprint);
        pageTexts.add(fingerprint);
      });
      if (isSupplement) {
        factIds.forEach((factId) => pageFacts.add(factId));
        pageSlots.add(String(block.supplement_slot_id).trim());
      }
    });
    pageUsage.set(pageNumber, { factIds: pageFacts, slots: pageSlots, textFingerprints: pageTexts, semanticIntents: pageSemanticIntents });
  });

  return { coreFactIds, supplementFactIds, coreTextFingerprints, supplementTextFingerprints, pageUsage };
}

export function validateSocialCardSupplementUniqueness({
  pages = [], pageNumber, block = null, factIds = [], slotId = '',
} = {}) {
  const usage = buildSocialCardSupplementUsageIndex(pages);
  const issues = [];
  const pageUsage = usage.pageUsage.get(Number(pageNumber));
  const normalizedFactIds = (Array.isArray(factIds) ? factIds : []).map(String).filter(Boolean);
  const normalizedSlotId = String(slotId || '').trim();
  const fingerprints = socialCardBlockContentValues(block || {});
  const page = pages[Number(pageNumber) - 1] || {};
  const semanticIntents = socialCardBlockSemanticIntents({ ...(block || {}), supplement_slot_id: normalizedSlotId }, page);
  const prefix = `P${Number(pageNumber) || '?'} 补充内容块`;

  const coreFact = normalizedFactIds.find((factId) => usage.coreFactIds.has(factId));
  if (coreFact) issues.push(`${prefix}引用的事实已由核心内容覆盖：${coreFact}`);
  const usedSupplementFact = normalizedFactIds.find((factId) => usage.supplementFactIds.has(factId));
  if (usedSupplementFact) issues.push(`${prefix}引用的事实已被其他补充块使用：${usedSupplementFact}`);
  if (pageUsage && normalizedSlotId && pageUsage.slots.has(normalizedSlotId)) {
    issues.push(`${prefix}槽位已占用：${normalizedSlotId}`);
  }
  const coreDuplicate = fingerprints.find((fingerprint) => usage.coreTextFingerprints.has(fingerprint));
  if (coreDuplicate) issues.push(`${prefix}内容已存在于核心内容中：${coreDuplicate}`);
  const supplementDuplicate = fingerprints.find((fingerprint) => usage.supplementTextFingerprints.has(fingerprint));
  if (supplementDuplicate) issues.push(`${prefix}内容已存在于其他补充块中：${supplementDuplicate}`);
  const pageDuplicate = fingerprints.find((fingerprint) => pageUsage?.textFingerprints.has(fingerprint));
  if (pageDuplicate && !supplementDuplicate && !coreDuplicate) issues.push(`${prefix}与当前页面已有内容重复：${pageDuplicate}`);
  const semanticDuplicate = semanticIntents.find((intent) => pageUsage?.semanticIntents?.has(intent));
  if (semanticDuplicate) issues.push(`${prefix}与当前页面已有内容语义职责重复：${semanticDuplicate}`);
  return issues;
}

function atomId(pageIndex, blockIndex, itemIndex = null, value = '') {
  const digest = createHash('sha1').update(`${pageIndex}|${blockIndex}|${itemIndex ?? 'block'}|${value}`).digest('hex').slice(0, 10);
  return `atom-p${pageIndex + 1}-b${blockIndex + 1}-${itemIndex == null ? 'block' : `i${itemIndex + 1}`}-${digest}`;
}

function resolveRefs(page, block, item, pageIndex, blockIndex, itemIndex = null) {
  const itemRefs = item && typeof item === 'object' ? refs(item.source_refs ?? item.sourceRefs) : [];
  const blockRefs = refs(block?.source_refs ?? block?.sourceRefs);
  const pageRefs = refs(page?.source_refs ?? page?.sourceRefs ?? page?.evidence);
  const provided = itemRefs.length ? itemRefs : blockRefs.length ? blockRefs : pageRefs;
  return { sourceRefs: provided.length ? provided : [fallbackRef(pageIndex, blockIndex, itemIndex)], sourceStatus: provided.length ? 'provided' : 'legacy-fallback' };
}

function atom({ page, pageIndex, block, blockIndex, item = null, itemIndex = null, kind = 'block', value = '' }) {
  const source = resolveRefs(page, block, item, pageIndex, blockIndex, itemIndex);
  const type = String(block?.type || 'text');
  return {
    id: atomId(pageIndex, blockIndex, itemIndex, value),
    page: pageIndex + 1,
    block: blockIndex,
    item: itemIndex,
    kind,
    blockType: type,
    text: text(value),
    source_refs: source.sourceRefs,
    source_status: source.sourceStatus,
    priority: type === 'code' || type === 'steps' || type === 'list' ? 'core' : 'supporting',
    can_split: SPLITTABLE_BLOCKS.has(type) && itemIndex != null,
    can_move: page?.kind !== 'cover' && page?.kind !== 'ending',
  };
}

export function buildSocialCardContentAtoms(cardPlan = []) {
  const pages = Array.isArray(cardPlan) ? cardPlan : [];
  const atoms = [];
  pages.forEach((page, pageIndex) => {
    const blocks = Array.isArray(page?.content_blocks) ? page.content_blocks : [];
    blocks.forEach((block, blockIndex) => {
      const values = itemValues(block);
      if (values) {
        values.forEach((value, itemIndex) => atoms.push(atom({ page, pageIndex, block, blockIndex, item: value, itemIndex, kind: 'item', value: itemText(value) })));
        return;
      }
      const value = block?.type === 'code' ? block.content : block?.content || block?.title || '';
      atoms.push(atom({ page, pageIndex, block, blockIndex, kind: 'block', value }));
    });
  });
  return atoms;
}

export function summarizeSocialCardContentAtoms(atoms = []) {
  const list = Array.isArray(atoms) ? atoms : [];
  const sourceStatus = { provided: 0, 'legacy-fallback': 0 };
  const blockTypes = {};
  for (const item of list) {
    sourceStatus[item.source_status] = (sourceStatus[item.source_status] || 0) + 1;
    blockTypes[item.blockType] = (blockTypes[item.blockType] || 0) + 1;
  }
  return { atomCount: list.length, sourceStatus, blockTypes, pages: new Set(list.map((item) => item.page)).size };
}

export function validateSocialCardContentAtoms(cardPlan = [], atoms = buildSocialCardContentAtoms(cardPlan)) {
  const pages = Array.isArray(cardPlan) ? cardPlan : [];
  const list = Array.isArray(atoms) ? atoms : [];
  const issues = [];
  const ids = new Set();
  for (const item of list) {
    if (!item?.id) issues.push('内容原子缺少 id');
    else if (ids.has(item.id)) issues.push(`内容原子 id 重复：${item.id}`);
    else ids.add(item.id);
    if (!Array.isArray(item?.source_refs) || !item.source_refs.length) issues.push(`${item?.id || '未知原子'} 缺少 source_refs`);
  }
  const blockCount = pages.reduce((sum, page) => sum + (Array.isArray(page?.content_blocks) ? page.content_blocks.length : 0), 0);
  const structuredBlockCount = pages.reduce((sum, page) => (Array.isArray(page?.content_blocks) ? page.content_blocks : []).reduce((total, block) => total + (itemValues(block) ? 1 : 0), sum), 0);
  const structuredItems = pages.reduce((sum, page) => (Array.isArray(page?.content_blocks) ? page.content_blocks : []).reduce((total, block) => total + (itemValues(block)?.length || 0), sum), 0);
  const expectedAtoms = blockCount - structuredBlockCount + structuredItems;
  if (list.length !== expectedAtoms) issues.push(`内容原子数量 ${list.length} 与内容块/条目数量 ${expectedAtoms} 不一致`);
  return { valid: issues.length === 0, issues, summary: summarizeSocialCardContentAtoms(list) };
}

export function buildSocialCardContentAtomSnapshot(cardPlan = [], { source = 'storyboard' } = {}) {
  const atoms = buildSocialCardContentAtoms(cardPlan);
  const validation = validateSocialCardContentAtoms(cardPlan, atoms);
  return {
    schemaVersion: 1,
    source: String(source || 'storyboard'),
    summary: validation.summary,
    validation: { valid: validation.valid, issues: validation.issues },
    atoms,
  };
}

export function compareSocialCardContentAtomConservation(beforeAtoms = [], afterAtoms = []) {
  const before = Array.isArray(beforeAtoms) ? beforeAtoms : [];
  const after = Array.isArray(afterAtoms) ? afterAtoms : [];
  const refsBefore = before.flatMap((item) => item.source_refs || []).sort();
  const refsAfter = after.flatMap((item) => item.source_refs || []).sort();
  return {
    beforeCount: before.length,
    afterCount: after.length,
    atomCountDelta: after.length - before.length,
    sourceRefsPreserved: JSON.stringify(refsBefore) === JSON.stringify(refsAfter),
    beforeSourceRefs: refsBefore,
    afterSourceRefs: refsAfter,
  };
}
