import fs from 'node:fs';
import path from 'node:path';
import { createStoreExecutionLogger } from '../../../platform/tools/execution-log.mjs';
import { executeCapabilityWithPreference } from '../../../platform/tools/capability-slots.mjs';
// capability-call: content.research.search
import {
  RESEARCH_SEARCH_POLICY,
  emptyResearchSearchLedger,
  normalizeResearchSearchTask,
} from '../domain/research-search.mjs';

const text = (value, max = 1000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (value) => Array.isArray(value) ? value : [];

function cacheKey(task) {
  return [
    task.source_type,
    task.task_type,
    task.target_signal,
    task.relation_axis,
    task.target_event_ids?.join(','),
    task.target_relation_ids?.join(','),
    task.research_question,
    task.expected_evidence,
    task.query,
  ]
    .map((value) => text(value, 400).toLocaleLowerCase()).join('|');
}

function readCache(file) {
  if (!file || !fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(file, cache) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function resultSourceId(taskId, index) {
  return `search:${taskId}:${index + 1}`;
}

function normalizeSearchResults(task, result) {
  return list(result?.data?.results).map((item, index) => ({
    source_id: resultSourceId(task.task_id, index),
    task_id: task.task_id,
    title: text(item?.title, 260),
    url: text(item?.url, 500),
    source: text(item?.source, 120),
    published_at: text(item?.publishedAt || item?.published_at, 80),
    snippet: text(item?.snippet || item?.content, 2200),
    content: '',
    evidence_level: 'summary_only',
    provider: text(result?.provenance?.provider || result?.provenance?.plugin, 80),
  })).filter((item) => item.url || item.snippet).slice(0, RESEARCH_SEARCH_POLICY.default_result_limit);
}

function addLedgerEntry(ledger, task, entry) {
  ledger.entries.push({
    task_id: task.task_id,
    task_type: task.task_type,
    target_event_ids: task.target_event_ids,
    target_signal: task.target_signal,
    target_relation_ids: task.target_relation_ids,
    relation_axis: task.relation_axis,
    research_question: task.research_question,
    expected_evidence: task.expected_evidence,
    model_generated: Boolean(task.model_generated),
    provider: entry.provider || task.provider || '',
    query: task.query,
    limit: task.limit,
    result_count: entry.result_count || 0,
    selected_urls: entry.selected_urls || [],
    deferred_urls: entry.deferred_urls || [],
    scraped_urls: entry.scraped_urls || [],
    cache_hit: Boolean(entry.cache_hit),
    status: entry.status,
    error: entry.error || '',
    credits: entry.credits ?? null,
  });
}

function defaultSearchExecutor({ workspaceRoot, batchId, store }) {
  return async (task) => {
    const capability = task.source_type === 'news' ? 'content.news.search' : 'content.web.search';
    return executeCapabilityWithPreference(workspaceRoot, capability, {
      query: task.query,
      maxResults: task.limit,
      ...(task.source_type === 'news' ? { timeRange: 'week' } : {}),
    }, {
      workspaceRoot,
      batchId,
      store,
      allowedCapabilities: [capability],
      executionLog: createStoreExecutionLogger(store, { batchId, skillId: 'discussion-researcher' }),
    });
  };
}

function defaultFallbackSearchExecutor({ workspaceRoot, batchId, store }) {
  return async (task) => executeCapabilityWithPreference(workspaceRoot, 'content.research.search', {
    query: task.query,
    maxResults: task.limit,
    sourceType: task.source_type,
  }, {
    workspaceRoot,
    batchId,
    store,
    allowedCapabilities: ['content.research.search'],
    executionLog: createStoreExecutionLogger(store, { batchId, skillId: 'discussion-researcher' }),
  });
}

/**
 * 执行轻量研究搜索。这里只登记搜索摘要和来源 URL，是否构成研判信号仍由后续模型判断，
 * 正文抓取延迟到编辑室，避免为未选中的候选批量消耗抓取额度。
 */
export async function executeInternalResearchSearch({
  tasks = [],
  batchId = '',
  workspaceRoot,
  store = null,
  cachePath = '',
  generatedAt = new Date().toISOString(),
  searchExecutor = null,
  fallbackSearchExecutor = null,
  onProgress = () => {},
} = {}) {
  const ledger = emptyResearchSearchLedger({ batchId, generatedAt });
  const cache = readCache(cachePath);
  const evidenceByEvent = {};
  const evidenceByRelation = {};
  const referenceEvents = [];
  const normalizedTasks = list(tasks).map((task) => normalizeResearchSearchTask(task, {
    allowedEventIds: task.target_event_ids,
    generatedAt,
  })).filter((result) => result.ok).map((result) => result.task);
  const search = searchExecutor || defaultSearchExecutor({ workspaceRoot, batchId, store });
  const fallbackSearch = fallbackSearchExecutor || defaultFallbackSearchExecutor({ workspaceRoot, batchId, store });
  const completedTasks = [];

  for (const task of normalizedTasks) {
    ledger.counters.search_tasks += 1;
    const key = task.cache_key || cacheKey(task);
    const cached = cache[key];
    let results = [];
    let provider = task.provider || '';
    let status = 'searched';
    let error = '';
    let cacheHit = false;
    if (cached?.results && Array.isArray(cached.results)) {
      results = cached.results;
      provider = cached.provider || provider;
      status = 'cached';
      cacheHit = true;
      ledger.counters.cache_hits += 1;
    } else {
      ledger.counters.cache_misses += 1;
      ledger.counters.search_calls += 1;
      const stageLabel = task.task_type === 'internal_signal_evidence' ? '阶段 1 事件内搜索' : '阶段 2 事件间搜索';
      onProgress(`${stageLabel}：${task.target_signal} · ${task.target_event_ids.join('、')}`);
      try {
        let response = await search(task);
        if (response?.status !== 'ok' || !list(response?.data?.results).length) {
          const fallbackResponse = await fallbackSearch(task);
          if (fallbackResponse?.status === 'ok' && list(fallbackResponse?.data?.results).length) response = fallbackResponse;
        }
        if (response?.status !== 'ok') throw new Error(response?.error?.message || '搜索没有返回有效结果');
        provider = text(response.provenance?.provider || response.provenance?.plugin, 80) || provider;
        if (provider.includes('tavily')) ledger.counters.tavily_calls += 1;
        if (provider.includes('firecrawl')) ledger.counters.firecrawl_search_calls += 1;
        results = normalizeSearchResults(task, response);
        cache[key] = { provider, results, cached_at: generatedAt };
      } catch (searchError) {
        status = 'failed';
        error = text(searchError?.message || searchError, 500);
        ledger.counters.failed_tasks += 1;
      }
    }

    // 研究阶段不抓正文。即使搜索供应商返回了 content，也只把它作为摘要处理，
    // 不在这里升级为 full_text；正文由编辑室针对选中的选题按需获取。
    results = results.map((result) => ({ ...result, content: '', evidence_level: 'summary_only' }));
    const deferredUrls = results.filter((item) => item.url)
      .slice(0, RESEARCH_SEARCH_POLICY.max_deferred_urls_per_task || RESEARCH_SEARCH_POLICY.default_result_limit)
      .map((item) => item.url);
    if (!cacheHit && status !== 'failed') cache[key] = { provider, results, cached_at: generatedAt };
    if (task.task_type === 'internal_signal_evidence') {
      for (const eventId of task.target_event_ids) {
        evidenceByEvent[eventId] ||= [];
        evidenceByEvent[eventId].push(...results.map((result) => ({
          ...result,
          target_signal: task.target_signal,
          target_relation_ids: task.target_relation_ids,
          relation_axis: task.relation_axis,
          expected_evidence: task.expected_evidence,
        })));
      }
    }
    for (const relationId of task.target_relation_ids) {
      evidenceByRelation[relationId] ||= [];
      evidenceByRelation[relationId].push(...results.map((result) => ({
        ...result,
        target_signal: task.target_signal,
        target_relation_ids: task.target_relation_ids,
        relation_axis: task.relation_axis,
        expected_evidence: task.expected_evidence,
      })));
    }
    if (task.task_type === 'external_relation_discovery') {
      results.forEach((result, index) => {
        referenceEvents.push({
          reference_id: `REF-${task.task_id}-${index + 1}`,
          reference_only: true,
          anchor_event_ids: task.target_event_ids,
          target_relation_ids: task.target_relation_ids,
          target_signal: task.target_signal,
          title: result.title,
          url: result.final_url || result.url || null,
          summary: result.snippet,
          content: result.content,
          evidence_level: result.evidence_level,
          source_id: result.source_id,
          published_at: result.published_at,
          provider: result.provider,
          search_task_id: task.task_id,
          relation_axis: task.relation_axis,
          expected_evidence: task.expected_evidence,
        });
      });
    }
    const completed = {
      ...task,
      cache_key: key,
      provider,
      status,
      result_ids: results.map((result) => result.source_id),
      selected_urls: [],
      deferred_urls: deferredUrls,
      evidence_ids: results.map((result) => result.source_id),
      results,
      updated_at: generatedAt,
    };
    completedTasks.push(completed);
    addLedgerEntry(ledger, task, {
      provider,
      result_count: results.length,
      selected_urls: [],
      deferred_urls: deferredUrls,
      scraped_urls: [],
      cache_hit: cacheHit,
      status,
      error,
    });
  }
  writeCache(cachePath, cache);
  return { tasks: completedTasks, evidenceByEvent, evidenceByRelation, referenceEvents, ledger };
}

export function researchSearchEvidenceForEvent(evidenceByEvent, eventId) {
  const seen = new Set();
  return list(evidenceByEvent?.[eventId]).filter((item) => {
    if (!item?.source_id || seen.has(item.source_id)) return false;
    seen.add(item.source_id);
    return true;
  }).slice(0, 16);
}
