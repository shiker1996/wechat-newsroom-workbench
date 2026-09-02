const INTERNAL_SIGNALS = new Set(['anomaly', 'interest_conflict', 'divergence']);
const RELATION_SIGNALS = new Set(['sequence', 'response', 'comparison', 'trend', 'counterexample']);
const TASK_TYPES = new Set(['internal_signal_evidence', 'relation_evidence', 'external_relation_discovery']);
const TASK_STATUSES = new Set(['planned', 'delegated_to_model', 'searched', 'cached', 'failed', 'skipped']);
const RELATION_AXES = new Set([
  'same_subject_different_action',
  'similar_subject_same_action',
  'same_object_different_strategy',
  'contrasting_action_or_outcome',
  'same_occasion_comparison',
  'trend_sample',
  'counterexample_sample',
]);

export const RESEARCH_SEARCH_SCHEMA_VERSION = 2;
export const RESEARCH_SEARCH_TASK_TYPES = Object.freeze([...TASK_TYPES]);
export const RESEARCH_SEARCH_TARGETS = Object.freeze([...INTERNAL_SIGNALS, ...RELATION_SIGNALS]);
export const RESEARCH_SEARCH_RELATION_AXES = Object.freeze([...RELATION_AXES]);

export const RESEARCH_SEARCH_POLICY = Object.freeze({
  scope: 'discussion_top_k_only',
  no_default_timeline_backfill: true,
  timeline_only_when_required_by_relation: true,
  body_fetch: 'deferred_to_editorial',
  max_daily_tasks: 12,
  max_daily_internal_tasks: 8,
  max_daily_inter_event_tasks: 4,
  default_result_limit: 5,
  // 任务契约保留少量 URL 选择上限；研究阶段不执行抓取，只把 URL 延迟给编辑室。
  max_planned_urls_per_task: 2,
  max_deferred_urls_per_task: 5,
  max_initial_searches_per_task: 1,
  max_retry_searches_per_task: 1,
  providers: ['tavily', 'firecrawl'],
});

const text = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (value) => Array.isArray(value) ? value : [];

function ids(value, max = 8) {
  return [...new Set(list(value).map((item) => text(typeof item === 'object' ? item.id || item.event_id || item.relation_id : item, 120)).filter(Boolean))].slice(0, max);
}

function scopeIds(scope) {
  const items = Array.isArray(scope) ? scope : scope?.items;
  return ids(items?.map((item) => item?.event_id || item?.eventId || item));
}

export function emptyResearchSearchLedger({ batchId = '', generatedAt = new Date().toISOString() } = {}) {
  return {
    schema_version: RESEARCH_SEARCH_SCHEMA_VERSION,
    batch_id: text(batchId, 120),
    generated_at: generatedAt,
    counters: {
      search_tasks: 0,
      search_calls: 0,
      cache_hits: 0,
      cache_misses: 0,
      scraped_urls: 0,
      tavily_calls: 0,
      firecrawl_search_calls: 0,
      firecrawl_scrape_calls: 0,
      failed_tasks: 0,
      skipped_tasks: 0,
    },
    entries: [],
  };
}

export function buildResearchSearchBaseline({ batchId = '', scope = {}, generatedAt = new Date().toISOString() } = {}) {
  const eventIds = scopeIds(scope);
  return {
    schema_version: RESEARCH_SEARCH_SCHEMA_VERSION,
    batch_id: text(batchId, 120),
    generated_at: generatedAt,
    status: 'contract_ready',
    scope: {
      name: 'discussion_top_k',
      event_ids: eventIds,
      event_count: eventIds.length,
      excluded_content_classes: ['github_project'],
    },
    policy: {
      ...RESEARCH_SEARCH_POLICY,
      allowed_internal_targets: [...INTERNAL_SIGNALS],
      allowed_relation_targets: [...RELATION_SIGNALS],
      allowed_task_types: [...TASK_TYPES],
      allowed_statuses: [...TASK_STATUSES],
    },
    tasks: [],
    reference_events: [],
    ledger: emptyResearchSearchLedger({ batchId, generatedAt }),
  };
}

function sourceIdsForEvent(event) {
  return ids((Array.isArray(event?.articles) ? event.articles : []).map((article) => (
    article?.source_id || (article?.hotspot_id != null ? `hotspot:${article.hotspot_id}` : article?.id)
  )), 8);
}

function signalText(signal) {
  return text(signal?.statement || signal?.question || signal?.difference || signal?.basis?.[0], 240);
}

function eventIdOf(event) {
  return text(event?.event_id || event?.eventId, 120);
}

function eventTitleOf(event) {
  return text(event?.representative_title || event?.title, 180);
}

function eventPartsOf(event) {
  const parts = event?.tags?.eventParts || event?.eventParts || {};
  return {
    who: text(parts.who, 100),
    object: text(parts.object || parts.what, 100),
    action: text(parts.actionType || parts.action, 100),
  };
}

function localEvidenceIdsForEvents(events) {
  return [...new Set(list(events).flatMap((event) => sourceIdsForEvent(event)))].slice(0, 8);
}

function relationSearchSignal(pair, eventsById) {
  const reasons = new Set(list(pair?.recall_reasons));
  const events = list(pair?.event_ids).map((id) => eventsById.get(String(id))).filter(Boolean);
  const parts = events.map(eventPartsOf);
  if (reasons.has('shared_who') && parts.some((item) => /回应|反驳|澄清|回复|质疑|解释/.test(item.action))) return 'response';
  if (reasons.has('shared_who')) return 'sequence';
  return reasons.has('shared_object') || reasons.has('shared_action') || reasons.has('shared_occasion') ? 'comparison' : 'sequence';
}

function relationQuery(pair, eventsById, suffix = '') {
  const titles = list(pair?.event_ids).map((id) => eventTitleOf(eventsById.get(String(id)))).filter(Boolean);
  return `${titles.join(' 与 ')} ${suffix}`.trim().slice(0, 600);
}

/**
 * 从时间关系图召回结果中生成少量关系搜索任务。
 * 关系是否成立仍由阶段 2 模型判断；这里仅为候选对/候选组补充关系证据、趋势样本和反例样本。
 */
export function buildRelationResearchSearchTasks({ scope = {}, relationPairs = [], relationGroups = [], events = [], maxTasks = RESEARCH_SEARCH_POLICY.max_daily_inter_event_tasks, generatedAt = new Date().toISOString() } = {}) {
  const scopeItems = Array.isArray(scope) ? scope : scope?.items;
  const allowedEventIds = (scopeItems || []).map((item) => item?.event_id || item?.eventId).filter(Boolean);
  const eventsById = new Map(list(events).map((event) => [eventIdOf(event), event]));
  const pairs = list(relationPairs).filter((pair) => list(pair?.event_ids).length >= 2);
  const groups = list(relationGroups).filter((group) => list(group?.event_ids).length >= 3);
  const taskLimit = Math.max(0, Number(maxTasks) || RESEARCH_SEARCH_POLICY.max_daily_inter_event_tasks);
  const discoverySlots = Math.min(2, taskLimit);
  const candidates = [];
  const relationEvidenceSlots = Math.max(0, taskLimit - discoverySlots);

  pairs.slice(0, relationEvidenceSlots).forEach((pair, index) => {
    const targetSignal = relationSearchSignal(pair, eventsById);
    const pairEvents = list(pair.event_ids).map((id) => eventsById.get(String(id))).filter(Boolean);
    candidates.push({
      task_type: 'relation_evidence',
      target_event_ids: list(pair.event_ids),
      target_relation_ids: [text(pair.pair_id, 120)],
      target_signal: targetSignal,
      research_question: targetSignal === 'comparison'
        ? '这两个事件是否存在可验证的动作、收益、成本或结果差异？'
        : targetSignal === 'response'
          ? '后一个事件是否明确回应前一个事件，回应改变了什么？'
          : '两个事件是否存在有来源支持的前后变化，而不是仅仅时间接近？',
      gap: '时间关系图只能召回候选，需补充公开材料确认关系是否真实存在。',
      query: relationQuery(pair, eventsById, targetSignal === 'comparison' ? '动作 收益 成本 结果 对比' : targetSignal === 'response' ? '回应 澄清 反驳 后续动作' : '此前 后续 变化 影响'),
      source_type: 'news',
      provider: '',
      limit: RESEARCH_SEARCH_POLICY.default_result_limit,
      status: 'planned',
      local_evidence_ids: localEvidenceIdsForEvents(pairEvents),
      gap_basis: list(pair.recall_reasons).join(', '),
      priority: 400 - index * 10 + Number(pair.recall_score || 0),
      created_at: generatedAt,
      updated_at: generatedAt,
    });
  });

  const discoveryAnchor = groups[0] || pairs[0];
  if (discoveryAnchor && discoverySlots > 0) {
    const anchorEvents = list(discoveryAnchor.event_ids).map((id) => eventsById.get(String(id))).filter(Boolean);
    candidates.push({
      task_type: 'external_relation_discovery',
      target_event_ids: list(discoveryAnchor.event_ids),
      target_relation_ids: [text(discoveryAnchor.group_id || discoveryAnchor.pair_id, 120)],
      target_signal: 'trend',
      research_question: '除锚定事件外，是否还有独立事件共同指向同一变化趋势？',
      gap: '当前只有 Top-K 锚定事件，需要外部独立样本判断是否构成趋势。',
      query: relationQuery(discoveryAnchor, eventsById, '行业趋势 其他案例 独立事件 采用 变化'),
      source_type: 'web',
      provider: '',
      limit: RESEARCH_SEARCH_POLICY.default_result_limit,
      status: 'planned',
      local_evidence_ids: localEvidenceIdsForEvents(anchorEvents),
      gap_basis: '需要至少 3 个独立事件，或 2 个 Top-K 事件加外部参考事件。',
      priority: 300,
      created_at: generatedAt,
      updated_at: generatedAt,
    });
  }
  if (discoveryAnchor && discoverySlots > 1) {
    const anchorEvents = list(discoveryAnchor.event_ids).map((id) => eventsById.get(String(id))).filter(Boolean);
    candidates.push({
      task_type: 'external_relation_discovery',
      target_event_ids: list(discoveryAnchor.event_ids),
      target_relation_ids: [text(discoveryAnchor.group_id || discoveryAnchor.pair_id, 120)],
      target_signal: 'counterexample',
      research_question: '是否存在与当前观察方向相反的独立事件或样本？',
      gap: '不能只收集支持趋势的材料，需要主动寻找反向样本。',
      query: relationQuery(discoveryAnchor, eventsById, '反例 相反方向 失败 退出 不采用 替代方案'),
      source_type: 'web',
      provider: '',
      limit: RESEARCH_SEARCH_POLICY.default_result_limit,
      status: 'planned',
      local_evidence_ids: localEvidenceIdsForEvents(anchorEvents),
      gap_basis: '需要明确反驳的趋势或判断，并保留反向样本的来源。',
      priority: 290,
      created_at: generatedAt,
      updated_at: generatedAt,
    });
  }

  return candidates
    .map((task, index) => normalizeResearchSearchTask({ ...task, task_id: `ST-R-${String(index + 1).padStart(3, '0')}` }, { allowedEventIds, generatedAt }).task)
    .filter(Boolean)
    .slice(0, taskLimit);
}

/**
 * 从事件卡已有的观察信号中识别“值得补证”的事件内缺口。
 * 这里只生成搜索问题，不判断反常、利益冲突或发散是否成立。
 */
export function buildInternalResearchSearchTasks({ scope = {}, internalSignals = [], events = [], maxTasks = RESEARCH_SEARCH_POLICY.max_daily_internal_tasks, generatedAt = new Date().toISOString() } = {}) {
  const scopeItems = Array.isArray(scope) ? scope : scope?.items;
  const eventById = new Map((Array.isArray(events) ? events : []).map((event) => [String(event?.event_id || event?.eventId || ''), event]));
  const candidates = [];
  for (const item of Array.isArray(internalSignals) ? internalSignals : []) {
    const eventId = text(item?.event_id, 120);
    if (!eventId) continue;
    const event = eventById.get(eventId) || {};
    const scopeItem = (scopeItems || []).find((entry) => String(entry?.event_id || entry?.eventId || '') === eventId) || {};
    const title = text(item?.title || event?.representative_title, 180);
    const localEvidence = sourceIdsForEvent(event);
    const research = item?.internal_research || item;
    const add = (targetSignal, signal, question, query, priority, gap) => {
      candidates.push({
        task_type: 'internal_signal_evidence',
        target_event_ids: [eventId],
        target_signal: targetSignal,
        research_question: question,
        gap,
        query,
        source_type: targetSignal === 'divergence' ? 'web' : 'news',
        provider: '',
        limit: RESEARCH_SEARCH_POLICY.default_result_limit,
        status: 'planned',
        local_evidence_ids: localEvidence,
        gap_basis: signalText(signal),
        priority: Number(priority) || 0,
        created_at: generatedAt,
        updated_at: generatedAt,
      });
    };
    const anomalies = Array.isArray(research?.anomalies) ? research.anomalies : [];
    const conflicts = Array.isArray(research?.interest_conflicts || research?.conflicts) ? (research.interest_conflicts || research.conflicts) : [];
    const divergences = Array.isArray(research?.divergence_directions || research?.divergences) ? (research.divergence_directions || research.divergences) : [];
    if (anomalies.length) add(
      'anomaly', anomalies[0],
      `「${title}」是否偏离公开承诺、行业基线或主体此前做法？`,
      `${title} 公开承诺 行业基线 实际结果 成本 影响`,
      300 - Number(scopeItem.rank || 999) + (anomalies[0]?.status === 'needs_review' ? 20 : 0),
      '需要外部基线和独立结果，核对事件卡观察到的落差。',
    );
    if (conflicts.length) add(
      'interest_conflict', conflicts[0],
      `「${title}」中参与方的收益、成本、责任或解释权如何分配？`,
      `${title} 用户 开发者 员工 公司 成本 收益 责任 争议`,
      280 - Number(scopeItem.rank || 999) + 30,
      '需要外部材料确认参与方和利益差异，不能只依据来源分歧。',
    );
    if (divergences.length) add(
      'divergence', divergences[0],
      `「${title}」可能影响谁，基线是什么，后续什么信号能验证或推翻这一方向？`,
      `${title} 用户 开发者 员工 行业影响 基线 后续结果`,
      260 - Number(scopeItem.rank || 999) + 10,
      '需要影响对象、历史基线或后续验证信号，避免把待核信息写成事实。',
    );
  }
  const deduped = new Map();
  for (const candidate of candidates) {
    const key = [candidate.target_event_ids[0], candidate.target_signal].join('|');
    const existing = deduped.get(key);
    if (!existing || candidate.priority > existing.priority) deduped.set(key, candidate);
  }
  const allowedEventIds = (scopeItems || []).map((item) => item?.event_id || item?.eventId).filter(Boolean);
  return [...deduped.values()]
    .sort((a, b) => b.priority - a.priority || a.target_event_ids[0].localeCompare(b.target_event_ids[0]) || a.target_signal.localeCompare(b.target_signal))
    .slice(0, Math.max(0, Number(maxTasks) || RESEARCH_SEARCH_POLICY.max_daily_internal_tasks))
    .map((task, index) => normalizeResearchSearchTask({ ...task, task_id: `ST-I-${String(index + 1).padStart(3, '0')}` }, { allowedEventIds, generatedAt }).task)
    .filter(Boolean);
}

function taskError(code, message) {
  return { code, message };
}

export function validateResearchSearchTask(raw, { allowedEventIds = [], allowedRelationIds = [] } = {}) {
  const allowedEvents = new Set(ids(allowedEventIds, 1000));
  const allowedRelations = new Set(ids(allowedRelationIds, 1000));
  if (!raw || typeof raw !== 'object') return taskError('invalid_task', '搜索任务必须是对象');
  const taskType = text(raw.task_type, 80);
  const targetSignal = text(raw.target_signal, 80);
  const eventIds = ids(raw.target_event_ids, 8);
  const relationIds = ids(raw.target_relation_ids, 8);
  if (taskType === 'timeline_backfill' || targetSignal === 'timeline') {
    return taskError('timeline_not_a_target', '时间线补齐不是独立搜索目标');
  }
  if (!TASK_TYPES.has(taskType)) return taskError('invalid_task_type', `不允许的搜索任务类型：${taskType || 'empty'}`);
  if (!RESEARCH_SEARCH_TARGETS.includes(targetSignal)) return taskError('invalid_target_signal', `不允许的研判目标：${targetSignal || 'empty'}`);
  if (eventIds.some((id) => !allowedEvents.has(id))) return taskError('event_out_of_scope', '搜索任务包含不在 Top-K 范围内的事件');
  if (relationIds.some((id) => allowedRelations.size && !allowedRelations.has(id))) return taskError('relation_out_of_scope', '搜索任务包含未知事件关系');
  if (taskType === 'internal_signal_evidence' && (eventIds.length !== 1 || !INTERNAL_SIGNALS.has(targetSignal))) {
    return taskError('invalid_internal_target', '事件内搜索必须绑定一个事件和 anomaly、interest_conflict 或 divergence');
  }
  if (taskType === 'relation_evidence' && (!RELATION_SIGNALS.has(targetSignal) || (relationIds.length === 0 && eventIds.length < 2))) {
    return taskError('invalid_relation_target', '关系证据搜索必须绑定关系 ID 或至少两个事件');
  }
  if (taskType === 'external_relation_discovery' && (!eventIds.length || !RELATION_SIGNALS.has(targetSignal))) {
    return taskError('invalid_discovery_target', '外部关系发现必须绑定 Top-K 锚点事件和事件间研判目标');
  }
  if ((taskType === 'relation_evidence' || taskType === 'external_relation_discovery') && raw.relation_axis && !RELATION_AXES.has(text(raw.relation_axis, 100))) {
    return taskError('invalid_relation_axis', `不允许的事件间搜索方向：${text(raw.relation_axis, 100)}`);
  }
  if (!text(raw.research_question, 600)) return taskError('missing_research_question', '搜索任务必须说明研判问题');
  if (!text(raw.query, 600)) return taskError('missing_query', '搜索任务必须包含查询词');
  return null;
}

export function normalizeResearchSearchTask(raw, { allowedEventIds = [], allowedRelationIds = [], generatedAt = new Date().toISOString() } = {}) {
  const error = validateResearchSearchTask(raw, { allowedEventIds, allowedRelationIds });
  if (error) return { ok: false, error };
  const eventIds = ids(raw.target_event_ids, 8);
  const relationIds = ids(raw.target_relation_ids, 8);
  return {
    ok: true,
    task: {
      task_id: text(raw.task_id, 120) || `ST-${Date.now()}`,
      task_type: text(raw.task_type, 80),
      target_event_ids: eventIds,
      target_relation_ids: relationIds,
      target_signal: text(raw.target_signal, 80),
      relation_axis: RELATION_AXES.has(raw.relation_axis) ? raw.relation_axis : '',
      research_question: text(raw.research_question, 600),
      gap: text(raw.gap, 600),
      gap_basis: text(raw.gap_basis, 500),
      expected_evidence: text(raw.expected_evidence, 500),
      search_intent: text(raw.search_intent, 500),
      hypothesis_ids: ids(raw.hypothesis_ids, 8),
      model_generated: raw.model_generated === true,
      local_evidence_ids: ids(raw.local_evidence_ids, 8),
      query: text(raw.query, 600),
      source_type: ['news', 'web'].includes(raw.source_type) ? raw.source_type : 'web',
      provider: ['tavily', 'firecrawl'].includes(raw.provider) ? raw.provider : '',
      limit: Math.min(Math.max(Number(raw.limit) || RESEARCH_SEARCH_POLICY.default_result_limit, 1), RESEARCH_SEARCH_POLICY.default_result_limit),
      status: TASK_STATUSES.has(raw.status) ? raw.status : 'planned',
      result_ids: ids(raw.result_ids, 10),
      selected_urls: list(raw.selected_urls).map((item) => text(item, 500)).filter(Boolean).slice(0, RESEARCH_SEARCH_POLICY.max_planned_urls_per_task),
      evidence_ids: ids(raw.evidence_ids, 10),
      cache_key: text(raw.cache_key, 300),
      created_at: text(raw.created_at, 60) || generatedAt,
      updated_at: text(raw.updated_at, 60) || generatedAt,
    },
  };
}
