import { cardPageDensity, listBlockValues } from './social-card-plan.mjs';

const CARD_ITEM_OVERHEAD = 24;

export function cardBlockVolume(block) {
  if (!block || typeof block !== 'object') return 0;
  const text = (value) => String(value || '').length;
  const itemText = (item) => typeof item === 'string' ? text(item) : text(item?.title) + text(item?.content) + text(item?.num) + text(item?.label) + text(item?.time);
  let volume = text(block.title);
  if (block.type === 'list') {
    const values = listBlockValues(block);
    return volume + Math.max(text(block.content), values.reduce((sum, item) => sum + itemText(item), 0)) + values.length * CARD_ITEM_OVERHEAD;
  }
  volume += text(block.content);
  if (Array.isArray(block.items)) volume += block.items.reduce((sum, item) => sum + itemText(item) + CARD_ITEM_OVERHEAD, 0);
  if (block.type === 'compare') {
    volume += (Array.isArray(block.headers) ? block.headers : []).reduce((sum, cell) => sum + text(cell), 0);
    volume += (Array.isArray(block.rows) ? block.rows : []).reduce((sum, row) => sum + (Array.isArray(row) ? row : []).reduce((cellSum, cell) => cellSum + text(cell), 0) + CARD_ITEM_OVERHEAD, 0);
  }
  return volume;
}

function imbalancedBlocks(blocks) {
  if (blocks.length < 2) return false;
  const volumes = blocks.map(cardBlockVolume); const total = volumes.reduce((sum, value) => sum + value, 0);
  return total > 0 && Math.max(...volumes) / total >= 0.65;
}

const AUXILIARY_TYPES = new Set(['note', 'highlight']);
const isAuxiliary = (block) => AUXILIARY_TYPES.has(block?.type) || block?.role === 'auxiliary' || block?.importance === 'secondary';

function peerGroupPrefersEven(blocks) {
  if (blocks.length === 3 || (blocks.length !== 2 && blocks.length < 4)) return false;
  const type = blocks[0]?.type; const volumes = blocks.map(cardBlockVolume);
  if (!type || blocks.some((block) => block?.type !== type)) return false;
  return Math.max(...volumes) / Math.max(1, Math.min(...volumes)) <= 1.6;
}

function primaryAuxiliaryColumns(blocks) {
  if (blocks.length !== 2) return null;
  const first = isAuxiliary(blocks[0]); const second = isAuxiliary(blocks[1]);
  if (first === second) return null;
  return first ? 'split-narrow' : 'split-wide';
}

export function semanticCardColumns(page, blocks = Array.isArray(page?.content_blocks) ? page.content_blocks : []) {
  if (blocks.length <= 1 || cardPageDensity(page) === 'compact') return 'single';
  if (peerGroupPrefersEven(blocks)) return 'split-even';
  if (imbalancedBlocks(blocks)) return 'single';
  return primaryAuxiliaryColumns(blocks) || 'single';
}
