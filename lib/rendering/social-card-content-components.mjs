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
import { normalizeSocialCardCode, parseSocialCardFencedCode } from './social-card-code-utils.mjs';

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

const SOCIAL_CARD_FONT_SCALE_LIMITS = Object.freeze({
  normal: 1,
  max: 1.18,
  codeMax: 1.12,
});

export function normalizeSocialCardFontScale(value, { renderType = '' } = {}) {
  const max = text(renderType) === 'code' ? SOCIAL_CARD_FONT_SCALE_LIMITS.codeMax : SOCIAL_CARD_FONT_SCALE_LIMITS.max;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return SOCIAL_CARD_FONT_SCALE_LIMITS.normal;
  return Math.min(max, Math.max(1, Math.round(numeric * 100) / 100));
}

function protectedTokens(value) {
  return String(value || '').match(/(?:https?:\/\/[^\s)]+|(?:npm|pnpm|yarn|uv|pip|docker|git|curl|wget)\s+[^\n]+|`[^`]+`)/gi) || [];
}

/**
 * 只做可审计的语义压缩：按句子/词边界收缩并加省略号，不删除列表条目，
 * 也不碰代码、命令、URL 等受保护 token。事实来源字段由调用方原样保留。
 */
export function compactSocialCardText(value, { ratio = 0.72, minChars = 48, preserveProtectedTokens = true, hardLimit = false } = {}) {
  const original = String(value ?? '').trim();
  if (original.length <= minChars) return original;
  const target = Math.max(minChars, Math.floor(original.length * Math.min(.9, Math.max(hardLimit ? .2 : .45, Number(ratio) || .72))));
  if (target >= original.length) return original;
  const tokens = protectedTokens(original);
  // 命令是可执行事实，宁可交给拆页/换行，也不把命令本身截成不可运行的片段。
  if (preserveProtectedTokens && tokens.some((token) => !/^https?:\/\//iu.test(token))) return original;
  const candidate = original.slice(0, Math.max(1, target - 1));
  const boundary = candidate.match(/^([\s\S]*?)(?:[。！？!?；;]|\s|，|,)(?=[^\s\S]*$)/);
  let compact = (hardLimit ? candidate : (boundary?.[1] || candidate)).trim();
  if (compact.length < Math.max(24, Math.floor(target * .45))) compact = candidate.trim();
  compact = `${compact.replace(/[，,；;、\s]+$/g, '')}…`;
  if (preserveProtectedTokens) for (const token of tokens) if (!compact.includes(token)) compact = `${compact} ${token}`;
  if (!compact || compact === `${original}…` || compact.length >= original.length) return original;
  return compact;
}

function contentSizeVariants(content, renderCandidates, { summaryVariant = false } = {}) {
  const normal = { title: text(content?.title), text: text(content?.text), item: content?.item == null ? null : structuredClone(content.item) };
  const variants = [];
  const canCompress = (renderCandidates || []).some((type) => type !== 'code');
  const compact = canCompress ? compactSocialCardText(normal.text) : normal.text;
  if (compact && compact !== normal.text) {
    variants.push({ id: 'compact', mode: 'compress', fontScale: 1, content: { ...normal, text: compact } });
  }
  if (summaryVariant && normal.text.length > 180 && normal.text.length <= 900 && canCompress) {
    const summary = compactSocialCardText(normal.text, { ratio: 0.28, minChars: 42, preserveProtectedTokens: false, hardLimit: true });
    if (summary && summary !== compact && summary !== normal.text) {
      variants.unshift({ id: 'slot-fit', mode: 'slot-fit', fontScale: 1, content: { ...normal, text: summary } });
    }
  }
  variants.push({ id: 'normal', mode: 'normal', fontScale: 1, content: normal });
  variants.push({ id: 'typography-106', mode: 'typography', fontScale: 1.06, content: structuredClone(normal) });
  variants.push({ id: 'typography-112', mode: 'typography', fontScale: 1.12, content: structuredClone(normal) });
  return variants;
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

function normalizeRenderCandidates(values) {
  return unique(values).filter((type) => RENDERABLE_BLOCK_TYPES.includes(type));
}

function factRenderCandidates(candidate = {}) {
  const tags = Array.isArray(candidate.tags) ? candidate.tags : [];
  const result = [];
  if (parseSocialCardFencedCode(candidate.text)) result.push('code');
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
    sizeVariants: [{ id: 'normal', mode: 'normal', fontScale: 1, content: atomContent(atom, block, item) }],
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
  const content = { title: displayLabel, text: text(candidate.text), item: null };
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
    content,
    sizeVariants: contentSizeVariants(content, renderCandidates, {
      // 非安装/运行类事实可以生成一个仅用于页面装箱的短摘要；命令、URL
      // 和验证步骤仍只使用保留技术 token 的常规变体。
      summaryVariant: !parseSocialCardFencedCode(candidate.text)
        && !/\b(?:npm|pnpm|yarn|npx|git|curl|wget|pip|uv|docker)\s+\S+/iu.test(String(candidate.text || '')),
    }),
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

function resolveComponentVariant(component = {}, variantId = '') {
  const variants = Array.isArray(component?.sizeVariants) ? component.sizeVariants : [];
  if (!variants.length) return null;
  return variants.find((variant) => text(variant?.id) === text(variantId)) || variants.find((variant) => variant?.id === 'normal') || variants[0];
}

export function renderSocialCardContentComponent(component = {}, renderType = '', { variantId = '' } = {}) {
  const variant = resolveComponentVariant(component, variantId || component.variantId);
  const content = variant?.content || component.content || {};
  const requestedType = text(renderType || component.preferredRender || component.renderCandidates?.[0] || 'note');
  const fencedCode = parseSocialCardFencedCode(content?.text);
  const type = fencedCode && requestedType !== 'code' ? 'code' : requestedType;
  const title = text(content.title);
  const value = text(content.text);
  const block = {
    type: RENDERABLE_BLOCK_TYPES.includes(type) ? type : 'note',
    ...(title ? { title } : {}),
    source_refs: refs(component.sourceRefs),
    fact_ids: unique(component.factIds),
  };
  const fontScale = normalizeSocialCardFontScale(variant?.fontScale || component.fontScale, { renderType: type });
  if (fontScale > 1) {
    block.font_scale = fontScale;
    block.size_variant = text(variant?.id || component.variantId);
    block.size_mode = text(variant?.mode || component.sizeMode || 'typography');
  }
  if (ITEM_BLOCK_TYPES.has(type)) {
    block.items = content.item != null ? [structuredClone(content.item)] : [value].filter(Boolean);
  } else if (type === 'code' || type === 'text' || type === 'note' || type === 'highlight') {
    block.content = type === 'code' ? normalizeSocialCardCode(value) : value;
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
export function estimateSocialCardContentComponent(component, { page = {}, capacity = {}, renderType = '', variantId = '' } = {}) {
  const resolvedCapacity = resolveCapacity(capacity);
  const currentBlocks = Array.isArray(page?.content_blocks) ? page.content_blocks : [];
  const currentPage = { ...page, content_blocks: currentBlocks };
  const block = renderSocialCardContentComponent(component, renderType, { variantId });
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
  softFitRatio = 1.25,
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
          const variants = Array.isArray(component.sizeVariants) && component.sizeVariants.length
            ? component.sizeVariants
            : [{ id: 'normal', mode: 'normal', fontScale: 1 }];
          for (const variant of variants) {
            if (variant.id === 'slot-fit' && renderType === 'code' && !parseSocialCardFencedCode(variant.content?.text)) continue;
            const estimate = estimateSocialCardContentComponent(component, {
              page,
              capacity: roleCapacity,
              renderType,
              variantId: variant.id,
            });
            // 静态高度模型用于排序和风险标记，不能在这里把所有候选硬删除：
            // 浏览器审计才是最终高度事实，且当前模型对代码/列表块存在明显高估。
            // 只淘汰明显不可能装下的候选，给后续联合装箱和真实渲染留出机会。
            const bodyHeight = Number(estimate.bodyHeightPx || 0);
            const softLimit = bodyHeight > 0 ? bodyHeight * Math.max(Number(safeFitRatio) || 0.92, Number(softFitRatio) || 1.08) : 0;
            if (capacityProfile && bodyHeight > 0 && Number(estimate.estimatedPageHeightPx || 0) > softLimit) continue;
            scoped.push({
              ...component,
              id: `${component.id}@p${pageNumber}-${slot.id}-${renderType}-${variant.id}`,
              componentId: `${component.componentId || component.id}@p${pageNumber}-${slot.id}-${renderType}-${variant.id}`,
              page: pageNumber,
              role,
              slotId: slot.id,
              preferredRender: renderType,
              renderCandidates: [renderType],
              variantId: variant.id,
              sizeMode: variant.mode,
              fontScale: normalizeSocialCardFontScale(variant.fontScale, { renderType }),
              slotLabel: slot.label,
              slotScore: tagScore * 10 + Number(slot.priority || 0),
              estimatedHeightPx: estimate.estimatedHeightPx,
              capacityRisk: estimate.safeFit ? 'safe' : estimate.fits ? 'near-limit' : 'soft-limit',
              capacityEstimate: estimate,
            });
          }
        }
      }
    }
    scoped.sort((a, b) => Number(b.slotScore || 0) - Number(a.slotScore || 0)
      // 同一槽位优先选择更接近安全利用率上限的变体：补充块的职责是填充，
      // 不能因为 compact 变体排在前面而把页面继续留空。
      || Number(b.estimatedHeightPx || 0) - Number(a.estimatedHeightPx || 0)
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
    if (component?.sizeVariants != null) {
      if (!Array.isArray(component.sizeVariants) || !component.sizeVariants.length) issues.push(`${component?.id || '未知组件'} 的 sizeVariants 为空`);
      for (const variant of Array.isArray(component.sizeVariants) ? component.sizeVariants : []) {
        if (!variant?.id || !variant?.content || typeof variant.content !== 'object') issues.push(`${component?.id || '未知组件'} 存在无效尺寸变体`);
        if (variant?.fontScale != null && normalizeSocialCardFontScale(variant.fontScale) !== Number(variant.fontScale)) issues.push(`${component?.id || '未知组件'} 的 fontScale 超出范围`);
        const originalFacts = new Set((component.factIds || []).map(String));
        const variantFacts = new Set((variant.factIds || component.factIds || []).map(String));
        for (const factId of originalFacts) if (!variantFacts.has(factId)) issues.push(`${component?.id || '未知组件'} 变体丢失 factId：${factId}`);
      }
    }
  }
  return { valid: issues.length === 0, issues, count: components.length };
}

/**
 * Content-plan packing: choose one complete, source-backed supplement at a
 * time and try every compatible render candidate against page capacity. This
 * deliberately does not use a prefix of the fact list: a shorter second
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
    const pageSupplements = hasPageScope
      ? (Array.isArray(snapshot.pageCandidates[String(pageNumber)]?.supplements) ? snapshot.pageCandidates[String(pageNumber)].supplements : [])
      : [];
    // 页面专属候选是首选，但不能因为静态容量预估把它过滤为空后就丢失
    // 全局事实池。全局候选仍会经过角色/槽位/来源/真实容量守卫。
    const supplements = hasPageScope && pageSupplements.length
      ? pageSupplements
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
      .sort((a, b) => b.score - a.score
        || (a.component.capacityRisk === 'safe' ? -1 : 0) - (b.component.capacityRisk === 'safe' ? -1 : 0)
        || String(a.component.id).localeCompare(String(b.component.id)));
      for (const { component } of candidates) {
        const renderTypes = [...new Set([
          ...(Array.isArray(slot.blockTypes) ? slot.blockTypes : []),
          ...(Array.isArray(component.renderCandidates) ? component.renderCandidates : []),
        ])].filter((type) => (!allowedBlockTypes.length || allowedBlockTypes.includes(type)) && RENDERABLE_BLOCK_TYPES.includes(type));
        for (const renderType of renderTypes) {
          const variants = component.variantId
            ? [{ id: component.variantId, mode: component.sizeMode, fontScale: component.fontScale }]
            : (Array.isArray(component.sizeVariants) && component.sizeVariants.length
              ? component.sizeVariants
              : [{ id: 'normal', mode: 'normal', fontScale: 1 }]);
          for (const variant of variants) {
            if (variant.id === 'slot-fit' && renderType === 'code' && !parseSocialCardFencedCode(variant.content?.text)) continue;
            const block = renderSocialCardContentComponent(component, renderType, { variantId: variant.id });
            block.supplement_slot_id = slot.id;
            const operation = {
              op: 'add_fact_block',
              page: pageNumber,
              slot_id: slot.id,
              component_id: component.factIds[0],
              fact_ids: [...component.factIds],
              source_refs: [...component.sourceRefs],
              variant_id: variant.id,
              size_mode: variant.mode || 'normal',
              font_scale: normalizeSocialCardFontScale(variant.fontScale, { renderType }),
              block,
            };
            if (typeof canApply === 'function' && !canApply({ operation, page, pageNumber, block, role, slot, component })) continue;
            accepted = operation;
            break;
          }
          if (accepted) break;
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

function jointPackingTarget(page = {}) {
  if (Number(page?.continuation_index || 0) > 1) return 0.62;
  if (text(page?.role || inferCardPageRole(page)) === 'steps') return 0.68;
  return 0.72;
}

function scoreJointPackingPlan(pages = [], capacityProfile = null) {
  let score = 0;
  const diagnostics = [];
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index] || {};
    const role = text(page?.role || inferCardPageRole(page));
    const capacity = capacityProfile?.roles?.[role] || capacityProfile || {};
    const estimate = estimateSocialCardPageLoad(page, capacity);
    const body = Number(estimate.bodyHeightPx || 0);
    if (!body) continue;
    const utilization = Number(estimate.estimatedHeightPx || 0) / body;
    const target = jointPackingTarget(page);
    const overflowPenalty = estimate.overCapacity ? 1000 + Math.max(0, utilization - 1) * 500 : 0;
    const underfillPenalty = Math.max(0, target - utilization) * 100;
    const overfillPenalty = Math.max(0, utilization - 0.94) * 140;
    score -= overflowPenalty + underfillPenalty + overfillPenalty;
    diagnostics.push({ page: index + 1, role, utilization, target, overCapacity: estimate.overCapacity });
  }
  return { score, diagnostics };
}

/**
 * 在拆页后的候选补充操作中做有界组合评分。每个操作本身已经过来源、槽位
 * 和单页容量守卫；这里进一步比较“全部不加 / 加其中一部分 / 全部加入”
 * 的整体结果，避免局部最优导致另一页溢出或续页仍然偏空。
 */
export function selectBestSocialCardJointPackingOperations(cardPlan = [], operations = [], {
  capacityProfile = null,
  maxOperations = 2,
} = {}) {
  const pages = Array.isArray(cardPlan) ? cardPlan : [];
  const candidates = Array.isArray(operations) ? operations.filter((operation) => operation?.op === 'add_fact_block' && Number.isInteger(Number(operation.page)) && operation.block) : [];
  const limit = Math.max(0, Math.min(4, Number(maxOperations) || 0));
  const baseline = scoreJointPackingPlan(pages, capacityProfile);
  let best = { selected: [], score: baseline.score, diagnostics: baseline.diagnostics, baselineScore: baseline.score };
  const total = Math.min(candidates.length, 12);
  const evaluate = (selected) => {
    const simulated = pages.map((page) => ({ ...page, content_blocks: Array.isArray(page?.content_blocks) ? [...page.content_blocks] : [] }));
    for (const operation of selected) {
      const index = Number(operation.page) - 1;
      if (!simulated[index]) return;
      simulated[index] = { ...simulated[index], content_blocks: [...simulated[index].content_blocks, structuredClone(operation.block)] };
    }
    const result = scoreJointPackingPlan(simulated, capacityProfile);
    // 少量操作优先，只有达到相同评分时才偏向更小的改动。
    if (result.score > best.score + 0.01 || (Math.abs(result.score - best.score) <= 0.01 && selected.length < best.selected.length)) {
      best = { selected: [...selected], score: result.score, diagnostics: result.diagnostics, baselineScore: baseline.score };
    }
  };
  const walk = (offset, selected) => {
    if (selected.length > 0) evaluate(selected);
    if (selected.length >= limit) return;
    for (let index = offset; index < total; index += 1) walk(index + 1, [...selected, candidates[index]]);
  };
  if (limit > 0) walk(0, []);
  return {
    operations: best.selected,
    score: best.score,
    baselineScore: best.baselineScore,
    improved: best.score > best.baselineScore + 0.01,
    diagnostics: best.diagnostics,
  };
}

/**
 * 对联合评分的静态预估与真实浏览器审计做对照。该结果只用于校准和诊断，
 * 不把静态估算当成最终门禁，也不修改故事板计划。
 */
export function auditSocialCardJointPacking({ cardPlan = [], report = {}, capacityProfile = null } = {}) {
  const pages = Array.isArray(cardPlan) ? cardPlan : [];
  const auditedPages = Array.isArray(report?.pages) ? report.pages : [];
  const rows = pages.map((page, index) => {
    const role = text(page?.role || inferCardPageRole(page));
    const capacity = capacityProfile?.roles?.[role] || capacityProfile || {};
    const estimate = estimateSocialCardPageLoad(page, capacity);
    const body = Number(estimate.bodyHeightPx || 0);
    const predictedUtilization = body > 0 ? Number(estimate.estimatedHeightPx || 0) / body : null;
    const audited = auditedPages[index] || {};
    const rawActual = Number(audited.utilization);
    const actualUtilization = Number.isFinite(rawActual) ? (rawActual > 1 ? rawActual / 100 : rawActual) : null;
    const issues = Array.isArray(audited.issues) ? audited.issues.map(String) : [];
    const browserOverflow = issues.some((issue) => ['overflow', 'clipped', 'horizontal_overflow', 'vertical_overflow', 'overfilled'].includes(issue));
    const staticOverflow = estimate.overCapacity;
    return {
      page: index + 1,
      role,
      predictedUtilization,
      actualUtilization,
      delta: predictedUtilization != null && actualUtilization != null ? actualUtilization - predictedUtilization : null,
      staticOverflow,
      browserOverflow,
      mismatch: staticOverflow !== browserOverflow,
      issues,
    };
  });
  const deltas = rows.map((row) => Math.abs(Number(row.delta))).filter(Number.isFinite);
  return {
    schemaVersion: 1,
    pages: rows,
    summary: {
      pageCount: rows.length,
      mismatchCount: rows.filter((row) => row.mismatch).length,
      browserOnlyOverflowPages: rows.filter((row) => row.browserOverflow && !row.staticOverflow).map((row) => row.page),
      staticOnlyOverflowPages: rows.filter((row) => row.staticOverflow && !row.browserOverflow).map((row) => row.page),
      meanAbsoluteUtilizationDelta: deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : null,
    },
  };
}

/**
 * Content-plan phase only: choose fact-backed supplement components for an
 * underfilled continuation page. Structure repair must not call this helper;
 * it only repacks blocks already present in the storyboard.
 */
export function buildSocialCardContinuationSupplementOperations(cardPlan = [], snapshot = {}, {
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

/** @deprecated Use buildSocialCardContinuationSupplementOperations. */
export function buildSocialCardContinuationPackingOperations(cardPlan = [], snapshot = {}, options = {}) {
  return buildSocialCardContinuationSupplementOperations(cardPlan, snapshot, options);
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
