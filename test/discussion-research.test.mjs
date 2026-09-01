import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiscussionResearch, buildTopicCandidates, selectTopicCandidates } from '../server/features/research/index.mjs';

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

test('事件内信号只来自事件卡已有字段', () => {
  const report = buildDiscussionResearch({ events: [event('E1', 1, { who: 'openai' }, {
    timeline: [{ time: '08-01', fact: '宣布发布' }, { time: '08-02', fact: '随后回应' }],
    source_increment: [{ source: '来源A', adds: '补充了发布时间' }],
    disagreements: ['两家来源对发布时间说法不同'],
    unverified: ['是否影响 API 用户尚待核实'],
  })], eventHeatRanking: { items: [{ eventId: 'E1', rank: 1, t: 80, eventValue: 80, state: 'new_event' }] } });
  const signals = report.internal_signals[0];
  assert.equal(signals.anomalies.length, 2);
  assert.equal(signals.conflicts[0].statement, '两家来源对发布时间说法不同');
  assert.equal(signals.divergences[0].statement, '是否影响 API 用户尚待核实');
  assert.equal(signals.anomalies.some((item) => item.statement.includes('影响 API 用户')), false);
});

test('相同语义的发散方向合并展示并保留多条证据', () => {
  const report = buildDiscussionResearch({ events: [event('E1', 1, { who: 'openai' }, {
    source_increment: [
      { source: '来源A', adds: '补充发布时间' },
      { source: '来源B', adds: '补充产品细节' },
    ],
    disagreements: ['两家来源对发布时间说法不同', '两家来源对发布时间说法不同'],
  })], eventHeatRanking: { items: [{ eventId: 'E1', rank: 1, t: 80, eventValue: 80, state: 'new_event' }] } });
  const directions = report.internal_signals[0].internal_research.divergence_directions;
  assert.equal(directions.length, 2);
  assert.equal(directions[0].evidence_count, 2);
  assert.equal(directions[1].evidence_count, 1);
  assert.equal(directions[0].basis.length, 2);
});

test('事件间研判同时使用事件维度和时间顺序，并保持确定性', () => {
  const events = [
    event('E1', 1, { who: 'openai', object: '模型', actionType: '发布' }),
    event('E2', 2, { who: 'openai', object: '模型', actionType: '争议回应' }),
    event('E3', 3, { who: 'google', object: '模型', actionType: '发布' }),
  ];
  const heat = { items: events.map((item) => ({ eventId: item.event_id, rank: item.eventHeatRank, t: item.t, state: 'new_event' })) };
  const first = buildDiscussionResearch({ events, eventHeatRanking: heat });
  const second = buildDiscussionResearch({ events: [...events].reverse(), eventHeatRanking: heat });
  assert.deepEqual(first.relations, second.relations);
  const sameSubject = first.relations.find((item) => item.event_ids.includes('E1') && item.event_ids.includes('E2'));
  assert.equal(sameSubject.relation_type, 'same_subject_sequence');
  assert.deepEqual(sameSubject.shared_dimensions.sort(), ['object', 'who']);
  assert.equal(sameSubject.temporal_order, 'E1_before_E2');
});

test('阶段2从Top-K研判生成单事件与关系候选，临时问题不改变T', () => {
  const events = [
    event('E1', 1, { who: 'openai', object: '模型', actionType: '发布' }, { disagreements: ['发布时间说法不同'] }),
    event('E2', 2, { who: 'openai', object: '模型', actionType: '回应' }),
    event('E3', 3, { who: 'google', object: '模型', actionType: '发布' }),
  ];
  const heat = { items: events.map((item) => ({ eventId: item.event_id, rank: item.eventHeatRank, t: item.t, eventValue: item.t, state: 'new_event' })) };
  const research = buildDiscussionResearch({ events, eventHeatRanking: heat, topK: 2 });
  const ranking = events.map((item) => ({ eventId: item.event_id, finalPreScore: 70 - item.eventHeatRank, eventValue: item.t, t: item.t, eventHeatRank: item.eventHeatRank, category: '📰 综合资讯', riskLevel: '低', articles: item.articles }));
  const before = events.map((item) => item.t);
  const candidates = buildTopicCandidates({ events, discussionResearch: research, ranking });
  assert.equal(candidates.some((item) => item.candidate_type === 'single_event'), true);
  assert.equal(candidates.some((item) => item.candidate_type === 'dual_event_relation'), true);
  assert.equal(candidates.some((item) => item.discussion_question.includes('连续动作')), true);
  assert.deepEqual(events.map((item) => item.t), before);
  const selection = selectTopicCandidates(candidates, { coreLimit: 1, blackLimit: 1, backupLimit: 1 });
  assert.equal(selection.core.length, 1);
  assert.equal(selection.selected.every((item) => item.research_context.topic_candidate.is_author_stance === false), true);
  assert.equal(selection.all.every((item) => item.event_ids.every((id) => ['E1', 'E2'].includes(id))), true);
});
