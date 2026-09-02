import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiscussionResearch, buildTopicCandidates, DISCUSSION_RESEARCH_TOP_K, DISCUSSION_RESEARCH_TOP_K_OPTIONS, resolveDiscussionResearchTopK } from '../server/features/research/index.mjs';

test('讨论研判 Top-K 默认值为8且只允许配置5、8、10', () => {
  assert.equal(DISCUSSION_RESEARCH_TOP_K, 8);
  assert.deepEqual(DISCUSSION_RESEARCH_TOP_K_OPTIONS, [5, 8, 10]);
  assert.equal(resolveDiscussionResearchTopK(5), 5);
  assert.equal(resolveDiscussionResearchTopK('10'), 10);
  assert.equal(resolveDiscussionResearchTopK(6), 8);
});

function event(id, rank, parts, card = {}) {
  return {
    event_id: id,
    representative_title: `事件 ${id}`,
    latest_time: `2026-08-${String(10 + rank).padStart(2, '0')}T08:00:00Z`,
    source_count: 2,
    report_count: 2,
    t: 90 - rank,
    eventHeatRank: rank,
    tags: { eventParts: { ...parts, labels: { who: parts.who, object: parts.object } } },
    articles: [{ category_id: `G${rank}`, hotspot_id: rank, title: `报道 ${id}`, source: '测试源' }],
    card,
  };
}

test('阶段0只取T榜前K，并保留T不变策略', () => {
  const events = [
    event('E1', 1, { who: 'openai', object: '模型', actionType: '发布' }),
    event('E2', 2, { who: 'openai', object: '模型', actionType: '争议回应' }),
    event('E3', 3, { who: 'google', object: '模型', actionType: '发布' }),
  ];
  const report = buildDiscussionResearch({ events, topK: 2, eventHeatRanking: { items: events.map((item) => ({ eventId: item.event_id, rank: item.eventHeatRank, t: item.t, eventValue: item.t, state: 'new_event' })) } });
  assert.deepEqual(report.scope.items.map((item) => item.event_id), ['E1', 'E2']);
  assert.equal(report.policy.t_unchanged, true);
  assert.equal(report.policy.f_unchanged, true);
  assert.equal(report.policy.pool_unchanged, true);
  assert.equal(report.topic_candidates.length, 0);
});

test('阶段0的讨论研判Top-K排除项目图文，但事件热榜排名保持为T原排名', () => {
  const project = { ...event('P1', 1, { who: '作者A', object: '项目', actionType: '发布' }), classification: { contentClass: 'github_project' } };
  const news = event('E1', 2, { who: 'openai', object: '模型', actionType: '发布' });
  const technology = event('E2', 3, { who: 'google', object: '模型', actionType: '发布' });
  const items = [project, news, technology].map((item) => ({
    eventId: item.event_id, rank: item.eventHeatRank, t: item.t, eventValue: item.t, state: 'new_event',
    contentClass: item.classification?.contentClass || 'news_event',
  }));
  const report = buildDiscussionResearch({ events: [project, news, technology], topK: 2, eventHeatRanking: { items } });
  assert.deepEqual(report.scope.items.map((item) => item.event_id), ['E1', 'E2']);
  assert.deepEqual(report.scope.items.map((item) => item.rank), [2, 3]);
  assert.equal(report.scope.excluded_count, 1);
  assert.deepEqual(report.policy.excluded_content_classes, ['github_project']);
});

test('阶段0不生成事件内结论或事件间关系', () => {
  const events = [
    event('E1', 1, { who: 'openai', object: '模型', actionType: '发布' }, {
      timeline: [{ time: '08-01', fact: '宣布发布' }, { time: '08-02', fact: '随后回应' }],
      disagreements: ['两家来源对发布时间说法不同'],
    }),
    event('E2', 2, { who: 'openai', object: '模型', actionType: '回应' }),
  ];
  const report = buildDiscussionResearch({ events, eventHeatRanking: { items: events.map((item) => ({ eventId: item.event_id, rank: item.eventHeatRank, t: item.t, state: 'new_event' })) } });
  assert.equal(report.mode, 'phase0_scope');
  assert.equal(report.policy.semantic_judgement, 'model_only');
  assert.deepEqual(report.internal_signals, []);
  assert.deepEqual(report.relations, []);
  assert.deepEqual(report.scope.items.map((item) => item.source_ids), [['hotspot:1'], ['hotspot:2']]);
});

test('阶段0报告不能直接生成选题，必须等待模型研判结果', () => {
  const events = [
    event('E1', 1, { who: 'openai', object: '模型', actionType: '发布' }),
    event('E2', 2, { who: 'openai', object: '模型', actionType: '回应' }),
  ];
  const research = buildDiscussionResearch({ events, eventHeatRanking: { items: events.map((item) => ({ eventId: item.event_id, rank: item.eventHeatRank, t: item.t, eventValue: item.t, state: 'new_event' })) }, topK: 2 });
  const ranking = events.map((item) => ({ eventId: item.event_id, finalPreScore: 70 - item.eventHeatRank, eventValue: item.t, t: item.t, eventHeatRank: item.eventHeatRank, category: '📰 综合资讯', riskLevel: '低', articles: item.articles }));
  assert.deepEqual(buildTopicCandidates({ events, discussionResearch: research, ranking }), []);
});
