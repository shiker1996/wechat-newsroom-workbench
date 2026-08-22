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
