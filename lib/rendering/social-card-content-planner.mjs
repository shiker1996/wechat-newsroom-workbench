import fs from 'node:fs';
import {
  applySocialCardRestructureOperations,
  validateSocialCardRestructureOperations,
} from './social-card-repair-policy.mjs';
import { buildSocialCardContentAtoms } from './social-card-content-atoms.mjs';
import { inferCardPageRole } from './social-card-role.mjs';
import { getSocialCardSupplementSlots } from './social-card-supplement-slots.mjs';
import { buildSocialCardFactCandidatePrompt, knownSourceRefsFromSocialCardFactIndex } from './social-card-fact-index.mjs';
import {
  renderSocialCardContentComponent,
  validateSocialCardContentComponents,
} from './social-card-content-components.mjs';
import { validateInput } from '../tools/schemas.mjs';

const SOCIAL_CARD_CONTENT_PLANNER_SCHEMA = JSON.parse(fs.readFileSync(new URL('../domain/schemas/social-card-content-planner.schema.json', import.meta.url), 'utf8'));

export const SOCIAL_CARD_CONTENT_PLANNER_OPERATION_TYPES = Object.freeze([
  'split_page',
  'move_block',
  'merge_pages',
  'add_component',
]);

/**
 * 先执行机器可读的操作契约校验，再执行页面语义、来源和容量校验。
 * add_component 是唯一的模型补充组件契约；内部转换结果只供现有
 * 结构校验器使用，不作为模型输入或对外操作类型。
 */
export function validateSocialCardContentPlannerSchema(result) {
  const value = typeof result === 'string' ? JSON.parse(result) : result;
  const message = validateInput(SOCIAL_CARD_CONTENT_PLANNER_SCHEMA, value);
  return { valid: !message, issues: message ? [message] : [] };
}

const plannerJson = (value) => JSON.stringify(value ?? null);

/**
 * 内容计划调整器的模型契约。模型只能给出操作，不接触 HTML/CSS，也不能回传完整故事板。
 */
export function buildSocialCardContentPlannerPrompt({ facts = {}, layoutReport = {}, cardPlan = [], contentAtoms = [], templateCapabilities = {}, factIndex = null, contentComponents = null, maxPages = 10, maxOperations = 4, maxFactBlocksPerRound = 2, maxFactBlocksPerPage = 1 } = {}) {
  const componentPool = contentComponents && validateSocialCardContentComponents(contentComponents).valid ? contentComponents : null;
  return [
    '你是 Social 图文内容计划调整器。只解决内容如何承载，不生成 HTML、CSS 或完整 card_plan。',
    `本轮最多返回 ${maxOperations} 个操作，调整后最多 ${maxPages} 页；add_component 本轮最多 ${maxFactBlocksPerRound} 个，且每个页面最多 ${maxFactBlocksPerPage} 个。每个补充块必须先从组件候选池选择一个事实组件，再选择其 renderCandidates 中能被目标模板承载的渲染类型。`,
    '允许的操作只有 split_page、move_block、merge_pages、add_component。',
    'split_page 必须覆盖原内容块全部条目且不重复；move_block 只能移动相邻同故事线页面的完整内容块，并保持原始顺序；merge_pages 只能合并相邻同角色同故事线页面；add_component 必须包含 page、component_id、source_refs，可选 render_type、fact_ids 和 block，不要填写 slot_id，程序会根据目标页候选的语义自动解析槽位。',
    '字段必须严格使用契约名称：合并用 {"op":"merge_pages","pages":[5,6]}；补充用 {"op":"add_component","page":6,"component_id":"component-fact-id@p6-verify-note","render_type":"note","fact_ids":["fact-id"],"source_refs":["已登记来源"],"block":{"type":"note","title":"…","content":"…","fact_ids":["fact-id"],"source_refs":["已登记来源"]}}。不要使用 target_page、merge_with 或 slot_id；组件不存在、语义不匹配或容量不安全时返回空操作。',
    '每个目标页的 pageCandidates、role、allowedSupplementSlots、allowedBlockTypes 和 remainingBlockCapacity 以布局审计输入为准；add_component 只能使用目标页列出的组件和渲染形式。',
    '禁止删除事实、修改封面/结尾职责、跨故事线合并、修改主题/模板、缩小字号或返回任意代码。补充事实前必须以目标页剩余容量为硬约束，不能为了填满而引入可能溢出的长事实；没有安全操作时返回 {"operations":[]}。',
    '只返回 JSON 对象：{"operations":[...]}。',
    `布局审计：${plannerJson(layoutReport)}`,
    `当前卡片计划：${plannerJson(cardPlan)}`,
    `内容原子（用于守恒和来源引用）：${plannerJson(contentAtoms)}`,
    `事实基座（组件内容只能引用这里已登记的事实）：${plannerJson(facts)}`,
    `可选事实候选（只能引用候选 id 和 source_refs）：${factIndex ? buildSocialCardFactCandidatePrompt(factIndex) : '{}'}`,
    `组件候选池（优先使用 supplements 中的组件；renderCandidates 仅表示可尝试的渲染方式）：${plannerJson(componentPool || {})}`,
    `模板容量和角色槽位：${plannerJson(templateCapabilities)}`,
  ].join('\n');
}

export function normalizeSocialCardContentPlannerResult(result, options = {}) {
  return normalizeSocialCardContentPlannerResultWithOptions(result, options);
}

function findPageComponent(contentComponents, pageNumber, componentId) {
  const pageScope = contentComponents?.pageCandidates?.[String(pageNumber)];
  const pageComponents = Array.isArray(pageScope?.supplements) ? pageScope.supplements : [];
  const global = Array.isArray(contentComponents?.supplements) ? contentComponents.supplements : [];
  const all = [...pageComponents, ...global];
  return all.find((component) => String(component?.id || '') === String(componentId || '')
    || String(component?.componentId || '') === String(componentId || '')
    || (Array.isArray(component?.factIds) && component.factIds.map(String).includes(String(componentId || '')))) || null;
}

function resolveComponentSlot(component, page, configuredSlots) {
  const role = String(page?.role || inferCardPageRole(page));
  const slots = Array.isArray(configuredSlots?.[role]) ? configuredSlots[role] : getSocialCardSupplementSlots(role);
  const explicit = String(component?.slotId || '').trim();
  if (explicit && slots.some((slot) => String(slot?.id) === explicit)) return explicit;
  const tags = new Set(Array.isArray(component?.semanticTags) ? component.semanticTags.map(String) : []);
  const slotTags = {
    ...Object.fromEntries(slots.map((slot) => [String(slot.id), []])),
  };
  const semanticMap = {
    capability: ['capability'], run: ['run'], install: ['install'], verify: ['output', 'run'],
    prerequisite: ['platform', 'permission', 'network'], boundary: ['limitation', 'security'],
    output: ['output', 'metric'], source: ['source'], release: ['release', 'timeline'],
    metric: ['metric'], timeline: ['timeline', 'release'], maturity: ['maturity'], context: ['context', 'source'],
  };
  for (const slot of slots) slotTags[slot.id] = semanticMap[String(slot.id)] || [];
  return slots.find((slot) => slotTags[slot.id].some((tag) => tags.has(tag)))?.id || '';
}

function normalizeComponentOperation(operation, { cardPlan = [], contentComponents = null, supplementSlots = null } = {}) {
  const pageNumber = Number(operation?.page);
  const page = Number.isInteger(pageNumber) ? cardPlan[pageNumber - 1] : null;
  const component = findPageComponent(contentComponents, pageNumber, operation?.component_id);
  const slotId = component && page ? resolveComponentSlot(component, page, supplementSlots) : '';
  const factIds = Array.isArray(operation?.fact_ids) && operation.fact_ids.length
    ? operation.fact_ids.map(String)
    : Array.isArray(component?.factIds) ? component.factIds.map(String) : [];
  const sourceRefs = Array.isArray(operation?.source_refs) && operation.source_refs.length
    ? operation.source_refs.map(String)
    : Array.isArray(component?.sourceRefs) ? component.sourceRefs.map(String) : [];
  const renderType = String(operation?.render_type || operation?.block?.type || component?.preferredRender || '').trim();
  const block = operation?.block && typeof operation.block === 'object'
    ? structuredClone(operation.block)
    : component ? renderSocialCardContentComponent(component, renderType) : null;
  if (block) {
    block.type = block.type || renderType || 'note';
    block.fact_ids = factIds;
    block.source_refs = sourceRefs;
    block.supplement_slot_id = slotId;
  }
  return {
    ...operation,
    op: 'add_fact_block',
    _internalComponentOperation: true,
    _sourceOperation: structuredClone(operation),
    component_id: factIds[0] || String(operation?.component_id || ''),
    component_ref: String(operation?.component_id || ''),
    slot_id: slotId,
    fact_ids: factIds,
    source_refs: sourceRefs,
    block,
  };
}

function normalizeSocialCardContentPlannerResultWithOptions(result, options = {}) {
  const value = typeof result === 'string' ? JSON.parse(result) : result;
  const operations = Array.isArray(value) ? value : value?.operations;
  return {
    operations: Array.isArray(operations)
      ? operations.map((operation) => operation?.op === 'add_component'
        ? normalizeComponentOperation(operation, options)
        : operation?.op === 'add_fact_block' && !operation?._internalComponentOperation
          ? { ...operation, op: 'unsupported_legacy_fact_block' }
          : operation)
      : [],
  };
}

function knownRefsFromAtoms(cardPlan, contentAtoms, knownSourceRefs) {
  const atoms = Array.isArray(contentAtoms) && contentAtoms.length ? contentAtoms : buildSocialCardContentAtoms(cardPlan || []);
  return [...new Set([
    ...(Array.isArray(knownSourceRefs) ? knownSourceRefs : []),
    ...atoms.flatMap((atom) => Array.isArray(atom?.source_refs) ? atom.source_refs : []),
  ].map(String).filter((ref) => ref && !ref.startsWith('legacy:')))];
}

function supplementSlotsForPlan(cardPlan, configuredSlots) {
  if (configuredSlots && typeof configuredSlots === 'object') return configuredSlots;
  return Object.fromEntries((Array.isArray(cardPlan) ? cardPlan : []).map((page) => {
    const role = String(page?.role || inferCardPageRole(page));
    return [role, getSocialCardSupplementSlots(role)];
  }));
}

export function validateSocialCardContentPlannerOperations(cardPlan, operations, options = {}) {
  const normalized = normalizeSocialCardContentPlannerResultWithOptions(operations, { ...options, cardPlan });
  const supplementSlots = supplementSlotsForPlan(cardPlan, options.supplementSlots);
  const factIndex = options.factIndex || null;
  return validateSocialCardRestructureOperations(cardPlan, normalized.operations, {
    maxPages: options.maxPages ?? 10,
    maxOperations: options.maxOperations ?? 4,
    maxFactBlocksAdded: options.maxFactBlocksAdded ?? 1,
    maxFactBlocksPerPage: options.maxFactBlocksPerPage ?? Infinity,
    knownSourceRefs: [...knownRefsFromAtoms(cardPlan, options.contentAtoms, options.knownSourceRefs), ...knownSourceRefsFromSocialCardFactIndex(factIndex)],
    supplementSlots,
    factIndex,
    operationGuard: options.operationGuard,
    allowSemanticRenderTypes: options.allowSemanticRenderTypes ?? true,
  });
}

export function applySocialCardContentPlannerOperations(cardPlan, operations, options = {}) {
  const normalized = normalizeSocialCardContentPlannerResultWithOptions(operations, { ...options, cardPlan });
  const validation = validateSocialCardContentPlannerOperations(cardPlan, normalized.operations, options);
  if (!validation.valid) return { ...validation, changed: false, pages: structuredClone(cardPlan || []) };
  return applySocialCardRestructureOperations(cardPlan, normalized.operations, {
    maxPages: options.maxPages ?? 10,
    maxOperations: options.maxOperations ?? 4,
    maxFactBlocksAdded: options.maxFactBlocksAdded ?? 1,
    maxFactBlocksPerPage: options.maxFactBlocksPerPage ?? Infinity,
    knownSourceRefs: [...knownRefsFromAtoms(cardPlan, options.contentAtoms, options.knownSourceRefs), ...knownSourceRefsFromSocialCardFactIndex(options.factIndex || null)],
    supplementSlots: supplementSlotsForPlan(cardPlan, options.supplementSlots),
    factIndex: options.factIndex || null,
    operationGuard: options.operationGuard,
    allowSemanticRenderTypes: options.allowSemanticRenderTypes ?? true,
  });
}

/**
 * Apply planner operations independently. A bad fact selection on P2/P4 must
 * not discard a valid continuation-page repair on P6. The returned `changed`
 * flag is true when at least one operation was accepted; rejected operations
 * remain visible in `issues`/`rejectedOperations` for auditability.
 */
export function applySocialCardContentPlannerOperationsPartial(cardPlan, operations, options = {}) {
  const normalized = normalizeSocialCardContentPlannerResultWithOptions(operations, { ...options, cardPlan });
  let pages = structuredClone(cardPlan || []);
  let factBlocksAdded = 0;
  const acceptedOperations = [];
  const rejectedOperations = [];
  for (const operation of normalized.operations) {
    const isFact = operation?.op === 'add_fact_block' || operation?.op === 'add_component';
    if (isFact && factBlocksAdded >= Number(options.maxFactBlocksAdded ?? 1)) {
      rejectedOperations.push({ operation, issues: [`补充内容块超过本轮上限 ${options.maxFactBlocksAdded ?? 1}`] });
      continue;
    }
    const result = applySocialCardContentPlannerOperations(pages, [operation], {
      ...options,
      maxOperations: 1,
      maxFactBlocksAdded: isFact ? 1 : options.maxFactBlocksAdded ?? 1,
    });
    if (result.valid && result.changed) {
      pages = result.pages;
      acceptedOperations.push(operation?._sourceOperation || operation);
      if (isFact) factBlocksAdded += 1;
    } else {
      rejectedOperations.push({ operation, issues: result.issues || ['操作未通过校验'] });
    }
  }
  return {
    valid: rejectedOperations.length === 0 && acceptedOperations.length > 0,
    changed: acceptedOperations.length > 0,
    pages,
    operations: acceptedOperations,
    rejectedOperations,
    issues: rejectedOperations.flatMap((item) => item.issues || []),
  };
}
