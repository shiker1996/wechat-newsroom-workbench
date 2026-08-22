import { buildSocialCardContentAtoms } from './social-card-content-atoms.mjs';
import { estimateSocialCardPageLoad } from './social-card-reflow.mjs';
import { getSocialCardSupplementSlots } from './social-card-supplement-slots.mjs';
import { inferCardPageRole } from './social-card-role.mjs';
import {
  displayLabelForSocialCardFact,
  isSocialCardFactMetadataCandidate,
  semanticIntentCandidatesForTags,
  socialCardFactComponentPresentation,
  SOCIAL_CARD_SLOT_SEMANTIC_TAGS,
  SOCIAL_CARD_PAGE_COMPONENT_SCHEMA_VERSION,
} from './social-card-page-component-contract.mjs';

export const SOCIAL_CARD_CONTENT_COMPONENT_SCHEMA_VERSION = 1;

const RENDERABLE_BLOCK_TYPES = Object.freeze([
  'text', 'list', 'code', 'note', 'stats', 'compare', 'steps', 'timeline', 'scenes', 'highlight',
]);

const ITEM_BLOCK_TYPES = new Set(['list', 'steps', 'timeline', 'scenes']);

const TAG_RENDER_CANDIDATES = Object.freeze({
  install: ['steps', 'code', 'list', 'note', 'text'],
  run: ['steps', 'code', 'list', 'note', 'text'],
  output: ['note', 'text', 'list', 'steps'],
  capability: ['list', 'scenes', 'text', 'note'],
  limitation: ['note', 'text', 'list'],
  security: ['note', 'text', 'list'],
  metric: ['stats', 'compare', 'text', 'note'],
  release: ['timeline', 'list', 'note', 'text'],
  timeline: ['timeline', 'list', 'note', 'text'],
  source: ['note', 'list', 'text'],
  platform: ['note', 'text', 'list'],
  permission: ['note', 'text', 'list'],
  network: ['note', 'text', 'list'],
  context: ['text', 'note', 'list'],
  maturity: ['note', 'text'],
});

const DEFAULT_FACT_RENDER_CANDIDATES = Object.freeze(['note', 'text', 'list']);

const SLOT_SEMANTIC_TAGS = SOCIAL_CARD_SLOT_SEMANTIC_TAGS;

const text = (value) => String(value ?? '').trim();
const refs = (value) => [...new Set((Array.isArray(value) ? value : value == null ? [] : [value]).map(text).filter(Boolean))];

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

function normalizeRenderCandidates(values) {
  return unique(values).filter((type) => RENDERABLE_BLOCK_TYPES.includes(type));
}

function factRenderCandidates(candidate = {}) {
  const tags = Array.isArray(candidate.tags) ? candidate.tags : [];
  const result = [];
  for (const tag of tags) result.push(...(TAG_RENDER_CANDIDATES[tag] || []));
  const candidates = normalizeRenderCandidates(result);
  return candidates.length ? candidates : [...DEFAULT_FACT_RENDER_CANDIDATES];
}

/**
 * README 的章节标题、字段名和状态元数据不是可直接渲染的补充事实。
 * 事实组件必须同时满足“不是标题字段”和“至少命中目标槽位语义”。
 */
export function isSocialCardFactComponentCompatibleWithSlot(candidate = {}, role = '', slotId = '') {
  if (!candidate || !String(candidate.id || '').trim()) return false;
  if (candidate.component_eligible === false || isSocialCardFactMetadataCandidate(candidate)) return false;
  const candidatePath = String(candidate.path || '');
  if (/\.(?:title|label|type|checkedAt|publishedAt)$/i.test(candidatePath)) return false;
  // maturity 是状态元数据；即使索引同时带有 release 标签，也不能把
  // `facts.maturity = released/beta` 当成 concept.conclusion 的正文。
  if (String(role || '').trim() === 'concept' && String(slotId || '').trim() === 'conclusion'
    && (candidatePath === 'facts.maturity' || /\.(?:version|status|maturity)$/i.test(candidatePath))) return false;
  const tags = new Set(Array.isArray(candidate.tags) ? candidate.tags.map(String) : []);
  const allowed = SLOT_SEMANTIC_TAGS[`${String(role || '').trim()}.${String(slotId || '').trim()}`] || [];
  return allowed.length > 0 && allowed.some((tag) => tags.has(tag));
}

export function getSocialCardFactRenderCandidates(candidate = {}) {
  return factRenderCandidates(candidate);
}

function atomContent(atom, block, item = null) {
  const itemTitle = item && typeof item === 'object' ? text(item.title || item.label) : '';
  const blockTitle = text(block?.title);
  return {
    title: itemTitle || blockTitle,
    text: text(atom?.text),
    item: item == null ? null : structuredClone(item),
  };
}

function semanticTagsForCore(page, block, atom) {
  const tags = [];
  const role = text(page?.role);
  const type = text(block?.type || atom?.blockType);
  if (role) tags.push(role);
  if (type) tags.push(type);
  if (role === 'steps') {
    if (type === 'code') tags.push('run');
    if (type === 'steps') tags.push('install', 'run');
  }
  if (role === 'risk') tags.push('limitation');
  if (role === 'feature') tags.push('capability');
  if (role === 'evidence') tags.push('source');
  return unique(tags);
}

function coreRenderCandidates(blockType) {
  const type = text(blockType);
  if (RENDERABLE_BLOCK_TYPES.includes(type)) {
    return normalizeRenderCandidates([type, ...(TAG_RENDER_CANDIDATES[type] || [])]);
  }
  return [...DEFAULT_FACT_RENDER_CANDIDATES];
}

function coreComponent({ atom, page, block, item = null }) {
  const semanticIntentCandidates = semanticIntentCandidatesForTags(semanticTagsForCore(page, block, atom));
  const component = {
    schemaVersion: SOCIAL_CARD_PAGE_COMPONENT_SCHEMA_VERSION,
    id: `component-${atom.id}`,
    componentId: `component-${atom.id}`,
    kind: 'core',
    origin: 'storyboard',
    page: atom.page,
    block: atom.block,
    item: atom.item,
    role: text(page?.role),
    displayLabel: text(block?.title || page?.title),
    semanticIntent: semanticIntentCandidates[0] || '',
    semanticIntentCandidates,
    semanticTags: semanticTagsForCore(page, block, atom),
    priority: atom.priority || 'supporting',
    renderCandidates: coreRenderCandidates(atom.blockType),
    preferredRender: text(atom.blockType) || 'text',
    content: atomContent(atom, block, item),
    factIds: unique(block?.fact_ids),
    sourceRefs: refs(atom.source_refs),
    sourceStatus: text(atom.source_status) || 'missing',
    splitPolicy: atom.can_split ? 'item' : 'atomic',
  };
  return component;
}

function factComponent(candidate, index) {
  const renderCandidates = factRenderCandidates(candidate);
  const presentation = socialCardFactComponentPresentation(candidate);
  const displayLabel = presentation.displayLabel || displayLabelForSocialCardFact(candidate);
  const semanticIntentCandidates = presentation.semanticIntentCandidates.length
    ? presentation.semanticIntentCandidates
    : semanticIntentCandidatesForTags(candidate.tags);
  return {
    schemaVersion: SOCIAL_CARD_PAGE_COMPONENT_SCHEMA_VERSION,
    id: `component-${candidate.id}`,
    componentId: `component-${candidate.id}`,
    kind: 'supplement',
    origin: 'fact-index',
    factIndex: Number(candidate.index || index + 1),
    page: null,
    role: '',
    path: text(candidate.path),
    displayLabel,
    semanticIntent: presentation.semanticIntent || semanticIntentCandidates[0] || '',
    semanticIntentCandidates,
    semanticTags: unique(candidate.tags),
    priority: text(candidate.priority) || 'supporting',
    renderCandidates,
    preferredRender: renderCandidates[0] || 'note',
    content: { title: displayLabel, text: text(candidate.text), item: null },
    factIds: candidate.id ? [text(candidate.id)] : [],
    sourceRefs: refs(candidate.source_refs),
    sourceStatus: text(candidate.source_status) || 'missing',
    splitPolicy: 'atomic',
  };
}

function blockItems(block, component) {
  const item = component?.content?.item;
  if (item != null) return [item];
  if (ITEM_BLOCK_TYPES.has(text(block?.type)) && Array.isArray(block?.items)) return block.items;
  if (block?.type === 'list' && typeof block?.content === 'string') return block.content.split(/\n+/).map((value) => value.trim()).filter(Boolean);
  return [];
}

export function renderSocialCardContentComponent(component = {}, renderType = '') {
  const type = text(renderType || component.preferredRender || component.renderCandidates?.[0] || 'note');
  const content = component.content || {};
  const title = text(content.title);
  const value = text(content.text);
  const block = {
    type: RENDERABLE_BLOCK_TYPES.includes(type) ? type : 'note',
    ...(title ? { title } : {}),
    source_refs: refs(component.sourceRefs),
    fact_ids: unique(component.factIds),
  };
  if (ITEM_BLOCK_TYPES.has(type)) {
    block.items = content.item != null ? [structuredClone(content.item)] : [value].filter(Boolean);
  } else if (type === 'code' || type === 'text' || type === 'note' || type === 'highlight') {
    block.content = value;
  } else if (type === 'compare') {
    block.rows = [[value]];
  } else {
    block.content = value;
  }
  return block;
}

function resolveCapacity(capacity) {
  return capacity?.capacity || capacity || {};
}

/**
 * Estimate a component against the current page and template. The estimate is
 * intentionally derived from the existing page-load estimator so stage 1 does
 * not introduce a second, conflicting height model.
 */
export function estimateSocialCardContentComponent(component, { page = {}, capacity = {}, renderType = '' } = {}) {
  const resolvedCapacity = resolveCapacity(capacity);
  const currentBlocks = Array.isArray(page?.content_blocks) ? page.content_blocks : [];
  const currentPage = { ...page, content_blocks: currentBlocks };
  const block = renderSocialCardContentComponent(component, renderType);
  const candidatePage = { ...page, content_blocks: [...currentBlocks, block] };
  const current = estimateSocialCardPageLoad(currentPage, resolvedCapacity);
  const candidate = estimateSocialCardPageLoad(candidatePage, resolvedCapacity);
  const estimatedHeightPx = Math.max(0, candidate.estimatedHeightPx - current.estimatedHeightPx);
  const bodyHeightPx = Number(candidate.bodyHeightPx || current.bodyHeightPx || 0);
  return {
    componentId: text(component?.id),
    renderType: text(renderType || component?.preferredRender || 'note'),
    estimatedHeightPx,
    estimatedPageHeightPx: candidate.estimatedHeightPx,
    currentPageHeightPx: current.estimatedHeightPx,
    bodyHeightPx,
    fits: !candidate.overCapacity,
    safeFit: !candidate.overCapacity && candidate.estimatedHeightPx <= bodyHeightPx * 0.92,
    reasons: [...candidate.reasons],
  };
}

/**
 * 为每个页面建立“可装箱候选”，而不是把全部事实组件作为一个全局池
 * 交给后续逻辑猜测。候选同时绑定 page、role、slot 和渲染形式；容量只
 * 用现有页面估算器计算，最终浏览器审计仍然是权威门禁。
 */
export function buildSocialCardPageComponentCandidates(cardPlan = [], snapshot = {}, {
  capacityProfile = null,
  targetPages = null,
  safeFitRatio = 0.92,
  maxCandidatesPerPage = 40,
} = {}) {
  const pages = Array.isArray(cardPlan) ? cardPlan : [];
  const supplements = Array.isArray(snapshot?.supplements) ? snapshot.supplements : [];
  const requestedPages = Array.isArray(targetPages) && targetPages.length
    ? new Set(targetPages.map((value) => Number(value)).filter(Number.isInteger))
    : null;
  const pageCandidates = {};
  for (let index = 0; index < pages.length; index += 1) {
    const pageNumber = index + 1;
    if (requestedPages && !requestedPages.has(pageNumber)) continue;
    const page = pages[index] || {};
    const role = text(page?.role || inferCardPageRole(page));
    const roleCapacity = capacityProfile?.roles?.[role] || capacityProfile || {};
    const core = (Array.isArray(snapshot?.core) ? snapshot.core : []).filter((component) => Number(component?.page) === pageNumber);
    const scoped = [];
    const slots = getSocialCardSupplementSlots(role).sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
    for (const slot of slots) {
      for (const component of supplements) {
        if (component?.sourceStatus !== 'provided' || !component.factIds?.length || !component.sourceRefs?.length) continue;
        if (!isSocialCardFactComponentCompatibleWithSlot({
          id: component.factIds[0],
          path: component.path,
          tags: component.semanticTags,
          component_eligible: component.componentEligible,
        }, role, slot.id)) continue;
        const tagScore = (component.semanticTags || []).filter((tag) => (SLOT_SEMANTIC_TAGS[`${role}.${slot.id}`] || []).includes(tag)).length;
        if (tagScore < 1) continue;
        const renderTypes = [...new Set([
          ...(Array.isArray(slot.blockTypes) ? slot.blockTypes : []),
          ...(Array.isArray(component.renderCandidates) ? component.renderCandidates : []),
        ])].filter((type) => RENDERABLE_BLOCK_TYPES.includes(type));
        for (const renderType of renderTypes) {
          const estimate = estimateSocialCardContentComponent(component, { page, capacity: roleCapacity, renderType });
          if (capacityProfile && (!estimate.fits || (Number.isFinite(Number(estimate.bodyHeightPx)) && estimate.bodyHeightPx > 0 && !estimate.safeFit))) continue;
          scoped.push({
            ...component,
            id: `${component.id}@p${pageNumber}-${slot.id}-${renderType}`,
            componentId: `${component.componentId || component.id}@p${pageNumber}-${slot.id}-${renderType}`,
            page: pageNumber,
            role,
            slotId: slot.id,
            preferredRender: renderType,
            renderCandidates: [renderType],
            slotLabel: slot.label,
            slotScore: tagScore * 10 + Number(slot.priority || 0),
            estimatedHeightPx: estimate.estimatedHeightPx,
            capacityEstimate: estimate,
          });
        }
      }
    }
    scoped.sort((a, b) => Number(b.slotScore || 0) - Number(a.slotScore || 0)
      || Number(a.estimatedHeightPx || 0) - Number(b.estimatedHeightPx || 0)
      || String(a.id).localeCompare(String(b.id)));
    pageCandidates[String(pageNumber)] = {
      page: pageNumber,
      role,
      core,
      supplements: scoped.slice(0, Math.max(0, Number(maxCandidatesPerPage) || 0)),
      summary: {
        coreCount: core.length,
        supplementCount: Math.min(scoped.length, Math.max(0, Number(maxCandidatesPerPage) || 0)),
        rejectedByCapacity: capacityProfile ? true : false,
      },
    };
  }
  return pageCandidates;
}

export function buildSocialCardContentComponents({ cardPlan = [], factIndex = null, contentType = 'repository', capacityProfile = null, targetPages = null } = {}) {
  const pages = Array.isArray(cardPlan) ? cardPlan : [];
  const atoms = buildSocialCardContentAtoms(pages);
  const core = [];
  for (const atom of atoms) {
    const page = pages[Number(atom.page) - 1] || {};
    const blocks = Array.isArray(page.content_blocks) ? page.content_blocks : [];
    const block = blocks[Number(atom.block)] || {};
    const item = atom.item == null ? null : (Array.isArray(block.items) ? block.items[Number(atom.item)] : null);
    core.push(coreComponent({ atom, page, block, item }));
  }
  const candidates = Array.isArray(factIndex?.candidates) ? factIndex.candidates : [];
  const supplements = candidates
    .filter((candidate) => candidate?.component_eligible !== false && !isSocialCardFactMetadataCandidate(candidate))
    .map((candidate, index) => factComponent(candidate, index));
  const components = [...core, ...supplements];
  const pageCandidates = capacityProfile
    ? buildSocialCardPageComponentCandidates(pages, { core, supplements }, { capacityProfile, targetPages })
    : {};
  return {
    schemaVersion: SOCIAL_CARD_CONTENT_COMPONENT_SCHEMA_VERSION,
    contentType: text(contentType) || 'repository',
    source: capacityProfile ? 'stage2-page-component-candidates' : 'stage1-component-pool',
    pageCandidates,
    core,
    supplements,
    components,
    summary: {
      componentCount: components.length,
      coreCount: core.length,
      supplementCount: supplements.length,
      sourceStatus: {
        provided: components.filter((item) => item.sourceStatus === 'provided').length,
        'legacy-fallback': components.filter((item) => item.sourceStatus === 'legacy-fallback').length,
        missing: components.filter((item) => !['provided', 'legacy-fallback'].includes(item.sourceStatus)).length,
      },
    },
  };
}

export function validateSocialCardContentComponents(snapshot = {}) {
  const components = Array.isArray(snapshot?.components) ? snapshot.components : [];
  const issues = [];
  const ids = new Set();
  for (const component of components) {
    if (!component?.id) issues.push('组件缺少 id');
    else if (ids.has(component.id)) issues.push(`组件 id 重复：${component.id}`);
    else ids.add(component.id);
    if (!Array.isArray(component?.renderCandidates) || !component.renderCandidates.length) issues.push(`${component?.id || '未知组件'} 缺少 renderCandidates`);
    if (component?.renderCandidates?.some((type) => !RENDERABLE_BLOCK_TYPES.includes(type))) issues.push(`${component?.id || '未知组件'} 包含不可渲染类型`);
    if (!Array.isArray(component?.sourceRefs) || !component.sourceRefs.length) issues.push(`${component?.id || '未知组件'} 缺少 sourceRefs`);
  }
  return { valid: issues.length === 0, issues, count: components.length };
}

/**
 * Stage 2 packing: choose one complete, source-backed component at a time and
 * try every compatible render candidate against the current page capacity.
 * This deliberately does not use a prefix of the fact list: a shorter second
 * candidate may fit when the highest-ranked candidate does not.
 */
export function buildSocialCardComponentPackingOperations(cardPlan = [], layoutPages = [], snapshot = {}, {
  maxOperations = 2,
  maxComponentsPerPage = 1,
  maxBlocksByRole = {},
  allowedBlockTypes = [],
  canApply = null,
  continuationOnly = false,
} = {}) {
  if (!Array.isArray(cardPlan) || !Array.isArray(layoutPages) || Number(maxOperations) < 1) return [];
  const allSupplements = Array.isArray(snapshot?.supplements) ? snapshot.supplements : [];
  if (!allSupplements.length && !snapshot?.pageCandidates) return [];
  const operations = [];
  const pageCounts = new Map();
  const globallyUsedFactIds = new Set(cardPlan.flatMap((page) => (Array.isArray(page?.content_blocks) ? page.content_blocks : []).flatMap((block) => Array.isArray(block?.fact_ids) ? block.fact_ids.map(String) : [])));
  const targets = [...layoutPages].sort((a, b) => Number(a?.utilization ?? 1) - Number(b?.utilization ?? 1) || Number(a?.page || 0) - Number(b?.page || 0));
  for (const layoutPage of targets) {
    if (operations.length >= Number(maxOperations)) break;
    if (!Array.isArray(layoutPage?.issues) || !layoutPage.issues.some((issue) => ['underfilled', 'underfilled_target'].includes(String(issue)))) continue;
    const pageNumber = Number(layoutPage.page);
    const page = Number.isInteger(pageNumber) ? cardPlan[pageNumber - 1] : null;
    if (!page || page.kind === 'cover' || page.kind === 'ending') continue;
    if (continuationOnly && Number(page.continuation_index || layoutPage.continuation_index || 0) <= 1) continue;
    if ((pageCounts.get(pageNumber) || 0) >= Number(maxComponentsPerPage)) continue;
    const role = String(page.role || inferCardPageRole(page));
    const maxBlocks = Number(maxBlocksByRole?.[role]);
    const blocks = Array.isArray(page.content_blocks) ? page.content_blocks : [];
    if (Number.isFinite(maxBlocks) && blocks.length >= maxBlocks) continue;
    const usedFactIds = new Set(blocks.flatMap((block) => Array.isArray(block?.fact_ids) ? block.fact_ids.map(String) : []));
    const usedSourceRefs = new Set(blocks.flatMap((block) => Array.isArray(block?.source_refs) ? block.source_refs.map(String) : []));
    const usedSlots = new Set(blocks.map((block) => text(block?.supplement_slot_id)).filter(Boolean));
    const hasPageScope = snapshot?.pageCandidates && Object.prototype.hasOwnProperty.call(snapshot.pageCandidates, String(pageNumber));
    const supplements = hasPageScope
      ? (Array.isArray(snapshot.pageCandidates[String(pageNumber)]?.supplements) ? snapshot.pageCandidates[String(pageNumber)].supplements : [])
      : allSupplements;
    const slots = getSocialCardSupplementSlots(role).filter((slot) => !usedSlots.has(slot.id)).sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
    let accepted = null;
    for (const slot of slots) {
      const slotTags = new Set(SLOT_SEMANTIC_TAGS[`${role}.${slot.id}`] || []);
      const candidates = supplements
        .filter((component) => component.sourceStatus === 'provided' && component.factIds?.length && component.sourceRefs?.length)
        .filter((component) => isSocialCardFactComponentCompatibleWithSlot({
          id: component.factIds[0],
          path: component.path,
          tags: component.semanticTags,
        }, role, slot.id))
        .filter((component) => !component.factIds.some((id) => usedFactIds.has(String(id)) || globallyUsedFactIds.has(String(id))))
        .map((component) => {
          const tagScore = (component.semanticTags || []).filter((tag) => slotTags.has(tag)).length;
          const sourcePenalty = (component.sourceRefs || []).some((ref) => usedSourceRefs.has(String(ref))) ? 1 : 0;
          return { component, score: tagScore * 10 + (component.priority === 'core' ? 4 : 1) - sourcePenalty };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || String(a.component.id).localeCompare(String(b.component.id)));
      for (const { component } of candidates) {
        const renderTypes = [...new Set([
          ...(Array.isArray(slot.blockTypes) ? slot.blockTypes : []),
          ...(Array.isArray(component.renderCandidates) ? component.renderCandidates : []),
        ])].filter((type) => (!allowedBlockTypes.length || allowedBlockTypes.includes(type)) && RENDERABLE_BLOCK_TYPES.includes(type));
        for (const renderType of renderTypes) {
          const block = renderSocialCardContentComponent(component, renderType);
          block.supplement_slot_id = slot.id;
          const operation = { op: 'add_fact_block', page: pageNumber, slot_id: slot.id, component_id: component.factIds[0], fact_ids: [...component.factIds], source_refs: [...component.sourceRefs], block };
          if (typeof canApply === 'function' && !canApply({ operation, page, block, role, slot, component })) continue;
          accepted = operation;
          break;
        }
        if (accepted) break;
      }
      if (accepted) break;
    }
    if (accepted) {
      operations.push(accepted);
      pageCounts.set(pageNumber, (pageCounts.get(pageNumber) || 0) + 1);
      for (const factId of accepted.fact_ids || []) globallyUsedFactIds.add(String(factId));
    }
  }
  return operations;
}

/**
 * Build packing targets directly from static capacity after a split/reflow.
 * The next browser audit remains authoritative; this pass only fills safe
 * continuation pages before that audit so a code-only续页 is not left empty.
 */
export function buildSocialCardContinuationPackingOperations(cardPlan = [], snapshot = {}, {
  capacityProfile = null,
  underfillThreshold = 0.62,
  maxOperations = 2,
  maxComponentsPerPage = 1,
  maxBlocksByRole = {},
  allowedBlockTypes = [],
  canApply = null,
} = {}) {
  const pages = Array.isArray(cardPlan) ? cardPlan : [];
  const layoutPages = pages.map((page, index) => {
    const role = text(page?.role || inferCardPageRole(page));
    const capacity = capacityProfile?.roles?.[role] || capacityProfile || {};
    const estimate = estimateSocialCardPageLoad(page, capacity);
    const body = Number(estimate.bodyHeightPx || 0);
    const utilization = body > 0 ? Number(estimate.estimatedHeightPx || 0) / body : 1;
    return {
      page: index + 1,
      role,
      continuation_index: Number(page?.continuation_index || 0),
      utilization,
      issues: utilization < Number(underfillThreshold) ? ['underfilled'] : [],
    };
  });
  return buildSocialCardComponentPackingOperations(pages, layoutPages, snapshot, {
    maxOperations,
    maxComponentsPerPage,
    maxBlocksByRole,
    allowedBlockTypes,
    canApply,
    continuationOnly: true,
  });
}

/** Remove semantically invalid fact blocks emitted by the storyboard model.
 * Core storyboard blocks are preserved; only blocks explicitly marked as
 * supplement slots are filtered, so this cannot delete authored content.
 */
export function sanitizeSocialCardPlanFactBindings(cardPlan = [], factIndex = null) {
  const candidates = new Map((Array.isArray(factIndex?.candidates) ? factIndex.candidates : [])
    .map((candidate) => [String(candidate.id), candidate]));
  const removed = [];
  const pages = (Array.isArray(cardPlan) ? cardPlan : []).map((page, pageIndex) => {
    const role = text(page?.role || inferCardPageRole(page));
    const blocks = Array.isArray(page?.content_blocks) ? page.content_blocks : [];
    const nextBlocks = blocks.filter((block, blockIndex) => {
      const slotId = text(block?.supplement_slot_id);
      const factIds = Array.isArray(block?.fact_ids) ? block.fact_ids.map(String).filter(Boolean) : [];
      if (!slotId || !factIds.length) return true;
      const valid = factIds.length > 0
        && factIds.every((factId) => isSocialCardFactComponentCompatibleWithSlot(candidates.get(factId), role, slotId));
      if (!valid) {
        removed.push({ page: pageIndex + 1, block: blockIndex + 1, role, slotId, factIds, title: text(block?.title) });
        return false;
      }
      return true;
    });
    return nextBlocks.length === blocks.length ? page : { ...page, content_blocks: nextBlocks };
  });
  return { pages, removed };
}

export { RENDERABLE_BLOCK_TYPES };
