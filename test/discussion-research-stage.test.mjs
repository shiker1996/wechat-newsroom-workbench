import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiscussionResearch,
  buildDiscussionRelationCandidatePairs,
  buildDiscussionResearchModelInput,
  buildDiscussionResearchModelMessages,
  buildTopicCandidates,
  generateDiscussionResearch,
  normalizeDiscussionResearchModel,
} from '../server/features/research/index.mjs';

function event(id, rank, title = `事件 ${id}`) {
  return {
    event_id: id,
    representative_title: title,
    latest_time: `2026-08-${String(10 + rank).padStart(2, '0')}T08:00:00Z`,
    source_count: 1,
    report_count: 1,
    t: 90 - rank,
    eventHeatRank: rank,
    tags: { eventParts: { who: '同一主体', object: '同一对象', actionType: rank === 1 ? '发布' : '回应', labels: {} } },
    articles: [{ hotspot_id: rank, title: `来源报道 ${id}`, source: '测试源', summary: `来源摘要 ${id}`, content: `来源正文 ${id}` }],
    card: {
      conclusion: `事件卡结论 ${id}`,
      confirmed_facts: [`已确认事实 ${id}`],
      unverified: [`待核实信息 ${id}`],
      timeline: [{ time: '08-10', fact: `时间事实 ${id}` }],
    },
  };
}

function baseReport(events) {
  return buildDiscussionResearch({
    events,
    topK: 2,
    eventHeatRanking: { items: events.map((item) => ({ eventId: item.event_id, rank: item.eventHeatRank, t: item.t, eventValue: item.t, state: 'new_event' })) },
  });
}

test('模型研判输出被转换为事件内信号、事件间关系和候选选题', () => {
  const events = [event('E1', 1), event('E2', 2)];
  const base = baseReport(events);
  const report = normalizeDiscussionResearchModel({
    items: [{
      event_id: 'E1',
      anomalies: [{ statement: '发布后短时间内出现方向调整', why_matters: '说明事件不是一次性动作', source_ids: ['hotspot:1'], confidence: 'high' }],
      interest_conflicts: [{ statement: '用户承担迁移成本，开发者获得生态收益', parties: ['用户', '开发者'], difference: '成本与收益承担者不同', source_ids: ['hotspot:1'], confidence: 'medium' }],
      divergence_directions: [{ statement: '需要继续核实调整是否影响现有用户', question: '谁承担迁移成本？', source_ids: ['hotspot:1'], status: 'needs_review', confidence: 'medium' }],
    }],
    relations: [{
      relation_kind: 'comparison', event_ids: ['E1', 'E2'],
      statement: '两个事件都围绕同一对象，但一个是发布，另一个是回应，动作和责任位置不同',
      question: '为什么回应没有沿用发布时的承诺？', differences: ['动作不同', '责任位置不同'],
      source_ids: ['hotspot:1', 'hotspot:2'], confidence: 'high',
    }],
    topic_candidates: [{
      candidate_title: '同一产品从发布到回应，谁承担了调整成本？', event_ids: ['E1', 'E2'], relation_ids: ['MR-001'],
      topic_type: 'event_comparison', core_question: '发布和回应之间发生了什么变化？', angle: '从承诺变化与成本承担者切入',
      thesis_seed: '动作变化比发布本身更能说明各方利益如何重新分配。', source_ids: ['hotspot:1', 'hotspot:2'], confidence: 'high',
    }],
  }, { events, baseReport: base });

  assert.equal(report.mode, 'model_analysis');
  assert.equal(report.research_source, 'model');
  assert.equal(report.internal_signals[0].anomalies[0].statement, '发布后短时间内出现方向调整');
  assert.equal(report.internal_signals[0].interest_conflicts[0].parties[0], '用户');
  assert.equal(report.relations[0].relation_kind, 'comparison');
  assert.deepEqual(report.relations[0].differences, ['动作不同', '责任位置不同']);
  assert.equal(report.topic_candidates[0].relation_ids[0], 'MR-001');
  const candidates = buildTopicCandidates({
    events,
    discussionResearch: report,
    ranking: events.map((item) => ({ eventId: item.event_id, eventValue: item.t, t: item.t, eventHeatRank: item.eventHeatRank, finalPreScore: 50 })),
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].title, '同一产品从发布到回应，谁承担了调整成本？');
  assert.equal(candidates[0].analysis_source, 'model');
});

test('程序门禁拒绝没有具体差异或未知证据的对比关系', () => {
  const events = [event('E1', 1), event('E2', 2)];
  const base = baseReport(events);
  const report = normalizeDiscussionResearchModel({
    items: [],
    relations: [
      { relation_kind: 'comparison', event_ids: ['E1', 'E2'], statement: '关键词相同所以有关联', source_ids: ['hotspot:1'], confidence: 'low' },
      { relation_kind: 'sequence', event_ids: ['E1', 'E2'], statement: '前后发生', source_ids: ['unknown-source'], confidence: 'medium' },
    ],
    topic_candidates: [],
  }, { events, baseReport: base });
  assert.equal(report.relations.length, 0);
});

test('阶段研判通过 discussion-research 用途调用模型，并把 Top-K 资料传入', async () => {
  const events = [event('E1', 1), event('E2', 2), event('E3', 3)];
  const base = baseReport(events);
  const calls = [];
  const gateway = {
    config: { providers: { fake: { maxOutputTokens: 20000 } } },
    complete: async (input) => {
      calls.push(input);
      return {
        content: JSON.stringify({ items: [], relations: [], topic_candidates: [] }),
      };
    },
  };
  const result = await generateDiscussionResearch({ gateway, provider: 'fake', events, baseReport: base, store: {
    getHotspotSource: (hotspotId) => ({ title: `快照标题 ${hotspotId}`, content: `快照正文 ${hotspotId}`, source: '快照源' }),
  }, workspaceRoot: process.cwd() });
  assert.equal(result.research_source, 'model');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].purpose, 'discussion-research');
  assert.equal(calls[0].thinking, false);
  assert.equal(calls[0].jsonMode, true);
  assert.match(calls[0].messages[1].content, /快照正文 1/);
  assert.doesNotMatch(calls[0].messages[1].content, /事件 E3/);
  assert.match(calls[0].messages[1].content, /第 1 阶段/);
  assert.equal(calls[2].thinking, true);
  assert.match(calls[2].messages[1].content, /candidate_pairs/);
});

test('模型输入快照与首次模型请求使用同一组 messages', () => {
  const events = [event('E1', 1), event('E2', 2), event('E3', 3)];
  const base = baseReport(events);
  const input = buildDiscussionResearchModelInput({ events, baseReport: base, store: {
    getHotspotSource: (hotspotId) => ({ content: `快照正文 ${hotspotId}` }),
  } });
  const snapshot = buildDiscussionResearchModelMessages({ workspaceRoot: process.cwd(), input });
  assert.equal(snapshot.messages[0].content, snapshot.system_prompt);
  assert.equal(snapshot.messages[1].content, snapshot.user_prompt);
  assert.match(snapshot.messages[1].content, /快照正文 1/);
  assert.doesNotMatch(snapshot.messages[1].content, /事件 E3/);
});

test('来源输入明确标注正文、摘要、仓库元数据和标题四种证据等级', () => {
  const base = baseReport([event('E1', 1)]);
  const sourceEvent = {
    ...event('E1', 1),
    articles: [
      { hotspot_id: 1, title: '正文来源', content: '完整正文' },
      { hotspot_id: 2, title: '摘要来源', summary: '只有摘要' },
      { hotspot_id: 3, title: '仓库来源', repositoryMeta: { repository: 'owner/repo' } },
      { hotspot_id: 4, title: '标题来源' },
    ],
  };
  const input = buildDiscussionResearchModelInput({ events: [sourceEvent], baseReport: base });
  assert.deepEqual(input.events[0].sources.map((source) => source.evidence_level), ['full_text', 'summary_only', 'repository_meta', 'title_only']);
});

test('事件间模型只能处理时间关系图召回的候选对', () => {
  const events = [
    event('E1', 1),
    event('E2', 2),
    { ...event('E3', 3), tags: { eventParts: { who: '完全不同主体', object: '完全不同对象', actionType: '发布', labels: {} } } },
  ];
  const base = buildDiscussionResearch({
    events,
    topK: 3,
    eventHeatRanking: { items: events.map((item) => ({ eventId: item.event_id, rank: item.eventHeatRank, t: item.t, state: 'new_event' })) },
  });
  const pairs = buildDiscussionRelationCandidatePairs({ events, baseReport: base });
  assert.deepEqual(pairs.map((pair) => pair.event_ids), [['E1', 'E2']]);
  assert.ok(pairs[0].recall_reasons.includes('nearby_time'));
});

test('没有正文时只保留待核发散方向，候选必须绑定研判依据', () => {
  const summaryEvent = { ...event('E1', 1), articles: [{ hotspot_id: 1, title: '摘要来源', summary: '只有摘要' }] };
  const base = baseReport([summaryEvent]);
  const raw = {
    items: [{
      event_id: 'E1',
      anomalies: [{ statement: '摘要推断出的确定反常', source_ids: ['hotspot:1'], confidence: 'high' }],
      interest_conflicts: [{ statement: '摘要推断出的确定冲突', parties: ['用户', '平台'], source_ids: ['hotspot:1'], confidence: 'high' }],
      divergence_directions: [{ statement: '需要核实摘要说法', question: '摘要说法是否属实？', source_ids: ['hotspot:1'], confidence: 'medium' }],
    }],
    relations: [],
    topic_candidates: [{
      candidate_title: '没有研判依据的标题', event_ids: ['E1'], relation_ids: [],
      topic_type: 'internal_divergence', core_question: '问题', angle: '角度', thesis_seed: '命题', source_ids: ['hotspot:1'],
    }],
  };
  const report = normalizeDiscussionResearchModel(raw, { events: [summaryEvent], baseReport: base, requireTopicBasis: true, strictEvidence: true });
  assert.equal(report.internal_signals[0].anomalies.length, 0);
  assert.equal(report.internal_signals[0].conflicts.length, 0);
  assert.equal(report.internal_signals[0].divergences.length, 1);
  assert.equal(report.internal_signals[0].divergences[0].status, 'needs_review');
  assert.equal(report.topic_candidates.length, 0);
});
