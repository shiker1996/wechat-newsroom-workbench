import fs from 'node:fs';
import {
  applySocialCardRestructureOperations,
  validateSocialCardRestructureOperations,
} from '../../../shared/rendering/social-card-repair-policy.mjs';
import {
  buildSocialCardContentAtoms,
  buildSocialCardSupplementUsageIndex,
  normalizeSocialCardContentFingerprint,
} from '../../../shared/rendering/social-card-content-atoms.mjs';
import { inferCardPageRole } from '../../../shared/rendering/social-card-role.mjs';
import { getSocialCardSupplementSlots } from '../../../shared/rendering/social-card-supplement-slots.mjs';
import { buildSocialCardFactCandidatePrompt, knownSourceRefsFromSocialCardFactIndex } from '../../../shared/rendering/social-card-fact-index.mjs';
import {
  isSocialCardFactComponentCompatibleWithSlot,
  renderSocialCardContentComponent,
} from '../../../shared/rendering/social-card-content-components.mjs';
import { normalizeSocialCardCode, parseSocialCardFencedCode } from '../../../shared/rendering/social-card-code-utils.mjs';
import { socialCardSlotSemanticTags } from '../../../shared/rendering/social-card-page-component-contract.mjs';
import { validateInput } from '../../../platform/tools/schemas.mjs';

const SOCIAL_CARD_CONTENT_PLANNER_SCHEMA = JSON.parse(fs.readFileSync(new URL('../../../shared/domain/schemas/social-card-content-planner.schema.json', import.meta.url), 'utf8'));

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
export function buildSocialCardContentPlannerPrompt({ facts = {}, layoutReport = {}, cardPlan = [], totalPageCount = null, contentAtoms = [], templateCapabilities = {}, factIndex = null, contentComponents = null, maxPages = 10, recommendedPages = null, absoluteMaxPages = null, maxOperations = 4, maxFactBlocksPerRound = 2, maxFactBlocksPerPage = Infinity } = {}) {
  const componentPool = buildSocialCardPlannerComponentPool(contentComponents, layoutReport);
  const hasNumber = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
  const hardMaxPages = hasNumber(absoluteMaxPages) ? Number(absoluteMaxPages) : Number(maxPages);
  const softMaxPages = hasNumber(recommendedPages) ? Number(recommendedPages) : Number(maxPages);
  const actualPageCount = hasNumber(totalPageCount) ? Number(totalPageCount) : Number(cardPlan.length);
  const pageCapExceeded = actualPageCount > softMaxPages;
  const absolutePageCapExceeded = actualPageCount > hardMaxPages;
  return [
    '你是 Social 图文内容计划调整器。只解决内容如何承载，不生成 HTML、CSS 或完整 card_plan。',
    `本轮最多返回 ${maxOperations} 个操作，绝对安全上限为 ${hardMaxPages} 页；推荐控制在 ${softMaxPages} 页以内。add_component 本轮最多 ${maxFactBlocksPerRound} 个，单页不设固定 1 个上限，必须按目标页 remainingBlockCapacity 在安全容量内动态填充${Number.isFinite(Number(maxFactBlocksPerPage)) ? `（本轮最大剩余容量 ${maxFactBlocksPerPage}）` : ''}。每个补充块必须先从组件候选池选择一个事实组件，再选择其 renderCandidates 中能被目标模板承载的渲染类型。`,
    ...(pageCapExceeded ? [`当前计划已有 ${actualPageCount} 页，超过模板允许的 ${softMaxPages} 页（推荐页数）；本轮优先使用 merge_pages 合并相邻同故事线续页或移动完整内容块后再合并，但没有安全合并时不要为了回到推荐页数而删除事实。仅 add_component 不能解决超页问题。`] : []),
    ...(absolutePageCapExceeded ? [`当前计划已有 ${actualPageCount} 页，超过绝对安全上限 ${hardMaxPages} 页；必须优先合并安全续页，无法降至绝对上限时返回 {"operations":[]}，程序将阻断而不会截断事实。`] : []),
    '允许的操作只有 split_page、move_block、merge_pages、add_component。',
    'split_page 必须覆盖原内容块全部条目且不重复；move_block 只能移动相邻同故事线页面的完整内容块，并保持原始顺序；merge_pages 只能合并相邻同角色同故事线页面；add_component 必须包含 page、component_id、source_refs 和由 AI 生成的 display block，可选 render_type、fact_ids，不要填写 slot_id，程序会根据目标页候选的语义自动解析槽位。',
    '字段必须严格使用契约名称：合并用 {"op":"merge_pages","pages":[5,6]}；补充用 {"op":"add_component","page":6,"component_id":"component-fact-id@p6-verify-note","render_type":"note","fact_ids":["fact-id"],"source_refs":["已登记来源"],"block":{"type":"note","title":"…","content":"…","fact_ids":["fact-id"],"source_refs":["已登记来源"]}}。列表、步骤、时间线和场景块的多条内容必须放入 items，content 只能是字符串。不要使用 target_page、merge_with 或 slot_id；组件不存在、语义不匹配或容量不安全时返回空操作。',
    '每个目标页的 pageCandidates、role、allowedSupplementSlots、allowedBlockTypes 和 remainingBlockCapacity 以布局审计输入为准；add_component 只能使用目标页列出的组件和渲染形式。',
    '禁止删除事实、修改封面/结尾职责、跨故事线合并、修改主题/模板、缩小字号或返回任意代码。补充事实前必须以目标页剩余容量为硬约束，不能为了填满而引入可能溢出的长事实；没有安全操作时返回 {"operations":[]}。核心内容和已有补充块是不可重复的事实覆盖，跨页面不得重复同一 fact_id 或同一展示条目，同页不得重复已占用 supplement_slot_id；若候选事实已被核心块覆盖、已在其他补充块出现或没有安全容量，直接跳过。sourceText/source_text 只是来源证据，禁止原样写入 block。displayTextStatus=pending 的候选必须先为本次页面生成简洁中文或技术展示文案 display_text，再按 capacityEstimate 生成；不能直接复用任何 source_text。',
    '只返回 JSON 对象：{"operations":[...]}。',
    `布局审计：${plannerJson(layoutReport)}`,
    `当前卡片计划（仅目标页及相邻关系页；每页含真实 page_number）：${plannerJson(cardPlan)}`,
    `内容原子（用于守恒和来源引用）：${plannerJson(contentAtoms)}`,
    `事实基座（组件内容只能引用这里已登记的事实）：${plannerJson(facts)}`,
    `可选事实候选（只能引用候选 id 和 source_refs）：${factIndex ? buildSocialCardFactCandidatePrompt(factIndex) : '{}'}`,
    `组件候选池（只能使用目标页 pageCandidates 中列出的组件；renderCandidates 仅表示可尝试的渲染方式）：${plannerJson(componentPool || {})}`,
    `模板容量和角色槽位：${plannerJson(templateCapabilities)}`,
  ].join('\n');
}

/**
 * 内容计划调整器只需要看到目标页可安全承载的页面专属候选。
 * 全局 supplements 是事实索引的原始组件池，可能包含仅适用于其他
 * 页面角色的事实；把它直接暴露给模型会导致模型选中无法解析槽位的组件。
 */
export function buildSocialCardPlannerComponentPool(contentComponents = null, layoutReport = {}) {
  if (!contentComponents || typeof contentComponents !== 'object') return null;
  const sourcePages = contentComponents.pageCandidates && typeof contentComponents.pageCandidates === 'object'
    ? contentComponents.pageCandidates
    : {};
  const targetPages = Array.isArray(layoutReport?.pages) && layoutReport.pages.length
    ? new Set(layoutReport.pages.map((item) => String(Number(item?.page))).filter((page) => page !== '0' && page !== 'NaN'))
    : null;
  const targetPageByNumber = new Map((Array.isArray(layoutReport?.pages) ? layoutReport.pages : [])
    .map((page) => [String(Number(page?.page)), page]));
  const targetPagesList = [...targetPageByNumber.values()];
  const usage = buildSocialCardSupplementUsageIndex(targetPagesList);
  const globallyUsedFactIds = new Set([...usage.coreFactIds, ...usage.supplementFactIds]);
  const coreTextFingerprints = usage.coreTextFingerprints;
  const supplementTextFingerprints = usage.supplementTextFingerprints;
  const componentTextFingerprints = (component) => [
    component?.displayText,
    component?.sourceText,
    component?.content?.title,
    component?.content?.text,
    component?.content?.item,
  ].map(normalizeSocialCardContentFingerprint).filter((value) => value.length >= 8);
  const overlapsExistingText = (component) => componentTextFingerprints(component).some((candidateText) =>
    [...coreTextFingerprints, ...supplementTextFingerprints].some((existingText) =>
      existingText.length >= 8 && (candidateText.includes(existingText) || existingText.includes(candidateText))));
  const pageCandidates = {};
  for (const [pageKey, scope] of Object.entries(sourcePages)) {
    if (targetPages && !targetPages.has(String(pageKey))) continue;
    const role = String(scope?.role || '');
    const scopedSupplements = Array.isArray(scope?.supplements) ? scope.supplements : [];
    const globalSupplements = Array.isArray(contentComponents?.supplements) ? contentComponents.supplements : [];
    const targetPage = targetPageByNumber.get(String(pageKey));
    const usedSupplementSlots = new Set((Array.isArray(targetPage?.content_blocks) ? targetPage.content_blocks : [])
      .map((block) => String(block?.supplement_slot_id || '').trim()).filter(Boolean));
    const roleCompatibleSupplements = scopedSupplements.length ? scopedSupplements : globalSupplements.filter((component) =>
      getSocialCardSupplementSlots(role).some((slot) => isSocialCardFactComponentCompatibleWithSlot({
        id: component?.factIds?.[0] || component?.id,
        path: component?.path,
        tags: component?.semanticTags,
        component_eligible: component?.componentEligible,
      }, role, slot.id)));
      // 页面已经使用过的事实不能再以另一种 render_type 补一次，
      // 否则同一时间线会同时出现 timeline 和 list 两份。
    const supplements = roleCompatibleSupplements
      .filter((component) => !(Array.isArray(component?.factIds) && component.factIds.some((id) => globallyUsedFactIds.has(String(id)))))
      .filter((component) => !(component?.slotId && usedSupplementSlots.has(String(component.slotId))))
      .filter((component) => !overlapsExistingText(component));
    pageCandidates[String(pageKey)] = {
      page: Number(scope?.page || pageKey),
      role,
      supplements: supplements.map((component) => ({
          id: component?.id,
          componentId: component?.componentId || component?.id,
          page: component?.page,
          role: component?.role,
          slotId: component?.slotId,
          slotLabel: component?.slotLabel,
          semanticTags: component?.semanticTags,
          preferredRender: component?.preferredRender,
          renderCandidates: component?.renderCandidates,
          estimatedHeightPx: component?.estimatedHeightPx,
          capacityEstimate: component?.capacityEstimate,
          factIds: component?.factIds,
          sourceRefs: component?.sourceRefs,
          sourceStatus: component?.sourceStatus,
          sourceText: component?.sourceText,
          displayText: component?.displayText,
          displayTextStatus: component?.displayTextStatus,
          displayLanguage: component?.displayLanguage,
          displayBudgetChars: component?.displayBudgetChars,
          content: component?.content,
        })),
    };
  }
  return { schemaVersion: 1, source: 'planner-page-candidates', pageCandidates };
}

export function normalizeSocialCardContentPlannerResult(result, options = {}) {
  return normalizeSocialCardContentPlannerResultWithOptions(result, options);
}

function findPageComponent(contentComponents, pageNumber, componentId) {
  const pageScope = contentComponents?.pageCandidates?.[String(pageNumber)];
  const pageComponents = Array.isArray(pageScope?.supplements) ? pageScope.supplements : [];
  const global = Array.isArray(contentComponents?.supplements) ? contentComponents.supplements : [];
  // 一旦存在页面专属候选，就不再回退到全局池。全局池中的事实可能
  // 属于其他页面角色，回退会让槽位解析变成空字符串并在后续才失败。
  const hasPageScope = Boolean(contentComponents?.pageCandidates
    && Object.prototype.hasOwnProperty.call(contentComponents.pageCandidates, String(pageNumber)));
  const candidates = hasPageScope && pageComponents.length ? pageComponents : global;
  return candidates.find((component) => String(component?.id || '') === String(componentId || '')
    || String(component?.componentId || '') === String(componentId || '')
    || (Array.isArray(component?.factIds) && component.factIds.map(String).includes(String(componentId || '')))) || null;
}

function resolveComponentSlot(component, page, configuredSlots) {
  const role = String(page?.role || inferCardPageRole(page));
  const slots = Array.isArray(configuredSlots?.[role]) ? configuredSlots[role] : getSocialCardSupplementSlots(role);
  const explicit = String(component?.slotId || '').trim();
  if (explicit && slots.some((slot) => String(slot?.id) === explicit)) return explicit;
  const tags = new Set(Array.isArray(component?.semanticTags) ? component.semanticTags.map(String) : []);
  return slots
    .map((slot, index) => ({
      slot,
      index,
      score: socialCardSlotSemanticTags(role, slot.id).filter((tag) => tags.has(String(tag))).length,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score
      || Number(b.slot?.priority || 0) - Number(a.slot?.priority || 0)
      || a.index - b.index)[0]?.slot?.id || '';
}

function normalizeComponentOperation(operation, { cardPlan = [], contentComponents = null, supplementSlots = null } = {}) {
  const pageNumber = Number(operation?.page);
  const page = Number.isInteger(pageNumber) ? cardPlan[pageNumber - 1] : null;
  const component = findPageComponent(contentComponents, pageNumber, operation?.component_id);
  if (!page) {
    return {
      ...operation,
      op: 'unresolved_component',
      _componentResolutionIssue: `P${pageNumber || '?'} 目标页面不存在，无法解析 component_id ${String(operation?.component_id || '空')}`,
    };
  }
  if (!component) {
    return {
      ...operation,
      op: 'unresolved_component',
      _componentResolutionIssue: `P${pageNumber} 的 component_id ${String(operation?.component_id || '空')} 不属于当前页面候选池`,
    };
  }
  const slotId = component && page ? resolveComponentSlot(component, page, supplementSlots) : '';
  if (!slotId) {
    return {
      ...operation,
      op: 'unresolved_component',
      _componentResolutionIssue: `P${pageNumber} 的 component_id ${String(operation?.component_id || '空')} 无法从页面语义解析有效槽位`,
    };
  }
  const factIds = Array.isArray(operation?.fact_ids) && operation.fact_ids.length
    ? operation.fact_ids.map(String)
    : Array.isArray(component?.factIds) ? component.factIds.map(String) : [];
  const sourceRefs = Array.isArray(operation?.source_refs) && operation.source_refs.length
    ? operation.source_refs.map(String)
    : Array.isArray(component?.sourceRefs) ? component.sourceRefs.map(String) : [];
  const requestedRenderType = String(operation?.render_type || operation?.block?.type || component?.preferredRender || '').trim();
  const fencedCode = parseSocialCardFencedCode(operation?.block?.content) || parseSocialCardFencedCode(component?.content?.text);
  const renderType = fencedCode && requestedRenderType !== 'code' ? 'code' : requestedRenderType;
  const block = operation?.block && typeof operation.block === 'object'
    ? structuredClone(operation.block)
    : component ? renderSocialCardContentComponent(component, renderType) : null;
  if (block) {
    block.type = block.type || renderType || 'note';
    if (Array.isArray(block.content)) {
      return {
        ...operation,
        op: 'invalid_component_operation',
        _operationIssue: `P${pageNumber} 的 block.content 必须是字符串；列表类多条内容请使用 items`,
      };
    }
    if (fencedCode) {
      block.type = 'code';
      block.content = normalizeSocialCardCode(block.content || component?.content?.text || '');
      delete block.items;
    }
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

/**
 * Schema 门禁失败时按操作隔离，保留可以独立进入后续语义/容量校验的操作。
 * 这只处理机器契约层；组件候选、槽位和浏览器布局仍由后续门禁裁决。
 */
export function partitionSocialCardContentPlannerOperationsBySchema(result) {
  const value = typeof result === 'string' ? JSON.parse(result) : result;
  const operations = Array.isArray(value) ? value : value?.operations;
  const accepted = [];
  const rejected = [];
  for (const [index, operation] of (Array.isArray(operations) ? operations : []).entries()) {
    const validation = validateSocialCardContentPlannerSchema({ operations: [operation] });
    if (validation.valid) accepted.push(operation);
    else rejected.push({ index, operation, issues: validation.issues });
  }
  return { operations: accepted, rejectedOperations: rejected };
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
