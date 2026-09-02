import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildInternalResearchSearchTasks,
  buildRelationResearchSearchTasks,
  buildDiscussionRelationCandidateGroups,
  buildDiscussionRelationCandidatePairs,
  buildRelationResearchModelInput,
  buildResearchSearchBaseline,
  buildInternalResearchModelInput,
  executeInternalResearchSearch,
  normalizeResearchSearchTask,
  validateResearchSearchTask,
} from '../server/features/research/index.mjs';

test('阶段0搜索契约只绑定Top-K，且不默认补齐时间线', () => {
  const baseline = buildResearchSearchBaseline({
    batchId: 'B-001',
    generatedAt: '2026-09-02T00:00:00.000Z',
    scope: { items: [{ event_id: 'E1' }, { event_id: 'E2' }] },
  });

  assert.equal(baseline.status, 'contract_ready');
  assert.deepEqual(baseline.scope.event_ids, ['E1', 'E2']);
  assert.equal(baseline.scope.event_count, 2);
  assert.equal(baseline.policy.no_default_timeline_backfill, true);
  assert.equal(baseline.policy.timeline_only_when_required_by_relation, true);
  assert.deepEqual(baseline.tasks, []);
  assert.equal(baseline.ledger.counters.search_calls, 0);
});

test('事件内搜索任务必须绑定一个Top-K事件和三类研判信号，并限制返回量', () => {
  const result = normalizeResearchSearchTask({
    task_id: 'ST-001',
    task_type: 'internal_signal_evidence',
    target_event_ids: ['E1'],
    target_signal: 'anomaly',
    research_question: '发布后的动作变化是否有独立来源支持？',
    gap: '事件卡只记录了摘要，需要寻找原始报道。',
    query: 'OpenClaw 发布后 动作变化 原始报道',
    provider: 'tavily',
    limit: 20,
    selected_urls: ['https://example.com/1', 'https://example.com/2', 'https://example.com/3'],
  }, { allowedEventIds: ['E1'] });

  assert.equal(result.ok, true);
  assert.equal(result.task.limit, 5);
  assert.deepEqual(result.task.selected_urls, ['https://example.com/1', 'https://example.com/2']);
  assert.equal(result.task.status, 'planned');
});

test('关系搜索支持关系证据和外部关系发现，但拒绝越界事件与时间线补齐', () => {
  const relation = validateResearchSearchTask({
    task_type: 'relation_evidence',
    target_event_ids: ['E1', 'E2'],
    target_relation_ids: ['R1'],
    target_signal: 'comparison',
    research_question: '两件事是否存在可比较的动作差异？',
    query: 'E1 E2 action comparison',
  }, { allowedEventIds: ['E1', 'E2'], allowedRelationIds: ['R1'] });
  assert.equal(relation, null);

  const discovery = validateResearchSearchTask({
    task_type: 'external_relation_discovery',
    target_event_ids: ['E1'],
    target_signal: 'trend',
    research_question: '是否存在同一趋势下的外部事件？',
    query: 'same trend related events',
  }, { allowedEventIds: ['E1'] });
  assert.equal(discovery, null);

  assert.equal(validateResearchSearchTask({
    task_type: 'internal_signal_evidence',
    target_event_ids: ['E9'],
    target_signal: 'anomaly',
    research_question: '问题',
    query: '查询',
  }, { allowedEventIds: ['E1'] }).code, 'event_out_of_scope');

  assert.equal(validateResearchSearchTask({
    task_type: 'timeline_backfill',
    target_event_ids: ['E1'],
    target_signal: 'timeline',
    research_question: '补齐时间线',
    query: 'event timeline',
  }, { allowedEventIds: ['E1'] }).code, 'timeline_not_a_target');
});

test('阶段1只为已有事件内信号生成有限搜索任务，并绑定具体研判目标', () => {
  const tasks = buildInternalResearchSearchTasks({
    scope: { items: [{ event_id: 'E1', rank: 1 }, { event_id: 'E2', rank: 2 }] },
    events: [
      { event_id: 'E1', representative_title: '事件一', articles: [{ hotspot_id: 1 }] },
      { event_id: 'E2', representative_title: '事件二', articles: [{ hotspot_id: 2 }] },
    ],
    internalSignals: [
      { event_id: 'E1', title: '事件一', internal_research: {
        anomalies: [{ statement: '实际结果偏离承诺' }],
        interest_conflicts: [{ statement: '用户承担成本，平台获得收益' }],
        divergence_directions: [{ statement: '需要核实影响范围' }],
      } },
      { event_id: 'E2', title: '事件二', internal_research: { anomalies: [{ statement: '前后动作变化' }] } },
    ],
    maxTasks: 3,
  });
  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks.map((task) => task.target_signal).sort(), ['anomaly', 'anomaly', 'interest_conflict']);
  assert.equal(tasks.every((task) => task.task_type === 'internal_signal_evidence'), true);
  assert.equal(tasks.every((task) => task.target_event_ids.length === 1), true);
});

test('阶段1搜索结果保留任务绑定和摘要证据，并把正文 URL 延迟给编辑室', async (t) => {
  let fetches = 0;
  const searchResult = await executeInternalResearchSearch({
    tasks: [{
      task_id: 'ST-I-001', task_type: 'internal_signal_evidence', target_event_ids: ['E1'],
      target_signal: 'anomaly', research_question: '是否存在基线落差？', query: '事件一 基线 落差', source_type: 'news',
    }],
    batchId: 'B-001',
    workspaceRoot: process.cwd(),
    cachePath: '',
    searchExecutor: async () => ({ status: 'ok', data: { results: [{ title: '独立报道', url: 'https://example.com/report', content: '摘要' }] }, provenance: { provider: 'tavily' } }),
    fetchExecutor: async () => { fetches += 1; return ({ status: 'ok', data: { title: '独立报道', final_url: 'https://example.com/report', content: '不应在研判阶段抓取' } }); },
  });
  assert.equal(searchResult.tasks[0].status, 'searched');
  assert.equal(searchResult.tasks[0].results[0].evidence_level, 'summary_only');
  assert.equal(searchResult.tasks[0].results[0].content, '');
  assert.deepEqual(searchResult.tasks[0].deferred_urls, ['https://example.com/report']);
  assert.equal(searchResult.tasks[0].results[0].task_id, 'ST-I-001');
  assert.equal(searchResult.ledger.counters.search_calls, 1);
  assert.equal(searchResult.ledger.counters.scraped_urls, 0);
  assert.equal(fetches, 0);

  const input = buildInternalResearchModelInput({
    event: { event_id: 'E1', representative_title: '事件一', articles: [], card: {} },
    scopeItem: { rank: 1, event_value: 80 },
    searchEvidence: searchResult.evidenceByEvent.E1,
    baseReport: { policy: { top_k: 30 } },
  });
  assert.equal(input.event.sources[0].source_id, 'search:ST-I-001:1');
  assert.equal(input.event.sources[0].evidence_level, 'summary_only');
  assert.equal(input.event.sources[0].search.target_signal, 'anomaly');
});

test('阶段1同一查询重跑命中缓存，且不重复搜索或抓取正文', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-search-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const task = {
    task_id: 'ST-I-CACHE', task_type: 'internal_signal_evidence', target_event_ids: ['E1'],
    target_signal: 'divergence', research_question: '影响范围是什么？', query: '事件一 影响范围', source_type: 'web',
  };
  let searches = 0;
  let fetches = 0;
  const options = {
    tasks: [task], batchId: 'B-001', workspaceRoot: root, cachePath: path.join(root, 'cache.json'),
    searchExecutor: async () => { searches += 1; return { status: 'ok', data: { results: [{ title: '资料', url: 'https://example.com/a', content: '摘要' }] }, provenance: { provider: 'tavily' } }; },
    fetchExecutor: async () => { fetches += 1; return { status: 'ok', data: { fetch_method: 'python', content: '正文'.repeat(100) } }; },
  };
  const first = await executeInternalResearchSearch(options);
  const second = await executeInternalResearchSearch(options);
  assert.equal(first.ledger.counters.search_calls, 1);
  assert.equal(second.ledger.counters.cache_hits, 1);
  assert.equal(searches, 1);
  assert.equal(fetches, 0);
});

test('阶段2搜索任务只围绕时间关系候选生成关系证据、趋势样本和反例样本', () => {
  const events = [1, 2, 3].map((rank) => ({
    event_id: `E${rank}`,
    representative_title: `同一对象事件${rank}`,
    latest_time: `2026-09-${String(10 + rank).padStart(2, '0')}T08:00:00Z`,
    tags: { eventParts: { who: `主体${rank}`, object: '同一对象', actionType: rank === 1 ? '发布' : '回应', occasion: '', labels: {} } },
    articles: [{ hotspot_id: rank, title: `来源${rank}` }],
  }));
  const baseReport = { scope: { items: events.map((event, index) => ({ event_id: event.event_id, rank: index + 1 })) } };
  const pairs = buildDiscussionRelationCandidatePairs({ events, baseReport });
  const groups = buildDiscussionRelationCandidateGroups({ events, baseReport });
  const tasks = buildRelationResearchSearchTasks({ scope: baseReport.scope, events, relationPairs: pairs, relationGroups: groups, maxTasks: 4 });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].event_ids.length, 3);
  assert.equal(tasks.length, 4);
  assert.deepEqual(tasks.map((task) => task.task_type), ['relation_evidence', 'relation_evidence', 'external_relation_discovery', 'external_relation_discovery']);
  assert.deepEqual(tasks.slice(2).map((task) => task.target_signal), ['trend', 'counterexample']);
  assert.equal(tasks.every((task) => task.target_event_ids.every((id) => ['E1', 'E2', 'E3'].includes(id))), true);
  assert.equal(tasks.every((task) => task.target_relation_ids.length === 1), true);
});

test('阶段2搜索结果按关系注入模型，并保留外部参考事件为 reference_only', async () => {
  const events = [1, 2].map((rank) => ({
    event_id: `E${rank}`,
    representative_title: `事件${rank}`,
    latest_time: `2026-09-${String(10 + rank).padStart(2, '0')}T08:00:00Z`,
    tags: { eventParts: { who: '同一主体', object: '同一对象', actionType: rank === 1 ? '发布' : '回应', labels: {} } },
    articles: [{ hotspot_id: rank, title: `来源${rank}`, content: `正文${rank}` }],
  }));
  const pair = { pair_id: 'P-E1-E2', event_ids: ['E1', 'E2'], recall_reasons: ['shared_object'], recall_score: 20 };
  const result = await executeInternalResearchSearch({
    tasks: [
      { task_id: 'ST-R-001', task_type: 'relation_evidence', target_event_ids: ['E1', 'E2'], target_relation_ids: ['P-E1-E2'], target_signal: 'comparison', research_question: '差异是什么？', query: '事件1 事件2 对比', source_type: 'news' },
      { task_id: 'ST-R-002', task_type: 'external_relation_discovery', target_event_ids: ['E1', 'E2'], target_relation_ids: ['P-E1-E2'], target_signal: 'counterexample', research_question: '是否有反例？', query: '事件 反例', source_type: 'web' },
    ],
    batchId: 'B-002', workspaceRoot: process.cwd(), cachePath: '',
    searchExecutor: async (task) => ({ status: 'ok', data: { results: [{ title: `${task.target_signal}资料`, url: `https://example.com/${task.task_id}`, content: '摘要' }] }, provenance: { provider: 'tavily' } }),
    fetchExecutor: async ({ result: fetchedResult }) => ({ status: 'ok', data: { content: `完整正文${fetchedResult?.url || ''}`.repeat(80), fetch_method: 'python' } }),
  });
  const input = buildRelationResearchModelInput({
    events, baseReport: { scope: { items: [{ event_id: 'E1' }, { event_id: 'E2' }] }, policy: { top_k: 30 } },
    relationPairs: [pair], relationSearchEvidence: result.evidenceByRelation,
    relationSearchTasks: result.tasks, referenceEvents: result.referenceEvents,
  });
  assert.equal(result.referenceEvents.length, 1);
  assert.equal(result.referenceEvents[0].reference_only, true);
  assert.equal((result.evidenceByEvent.E1 || []).some((source) => source.task_id === 'ST-R-001'), false);
  assert.equal(input.events[0].sources.some((source) => source.search?.target_relation_ids?.includes('P-E1-E2')), true);
  assert.equal(input.external_reference_events[0].reference_id, 'REF-ST-R-002-1');
  assert.equal(input.relation_search_tasks.length, 2);
});
