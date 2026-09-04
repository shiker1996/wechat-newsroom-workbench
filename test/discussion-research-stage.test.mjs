import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiscussionResearch,
  buildDiscussionRelationCandidatePairs,
  buildDiscussionResearchModelInput,
  buildDiscussionResearchModelMessages,
  buildSingleEventResearchModelInput,
  shouldEnableNativeSearch,
  buildTopicResearchModelInput,
  buildResearchDigest,
  cleanSingleEventResearchReport,
  buildTopicCandidates,
  buildVerifiedResearchMaterials,
  generateDiscussionResearchHypotheses,
  generateDiscussionResearchSinglePass,
  generateDiscussionResearchTopics,
  generateDiscussionResearch,
  normalizeDiscussionResearchModel,
  verifyDiscussionResearch,
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
  assert.equal('internal_research' in report, false);
  assert.equal('inter_event_research' in report, false);
  assert.equal('topic_candidate' in report, false);
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
  assert.deepEqual(calls[0].tools, [{ type: 'web_search' }]);
  assert.equal(calls[0].toolChoice, 'auto');
  assert.equal(calls[0].thinking, false);
  assert.equal(calls[0].jsonMode, true);
  assert.match(calls[0].messages[1].content, /快照正文 1/);
  assert.doesNotMatch(calls[0].messages[1].content, /事件 E3/);
  assert.match(calls[0].messages[1].content, /第 1 阶段/);
  assert.equal(calls[2].thinking, true);
  assert.deepEqual(calls[2].tools, [{ type: 'web_search' }]);
  assert.equal(calls[2].toolChoice, 'auto');
  assert.match(calls[2].messages[1].content, /candidate_pairs/);
});

test('新研判流程：每个 Top-K 事件只交互一次，开启 thinking/联网并直接接收 Markdown', async () => {
  const events = [event('E1', 1), event('E2', 2)];
  const base = baseReport(events);
  const calls = [];
  const requests = [];
  const responses = [];
  const gateway = {
    config: { providers: { fake: { maxOutputTokens: 20000 } } },
    complete: async (input) => {
      calls.push(input);
      const current = calls.length === 1 ? 'E1' : 'E2';
      const other = current === 'E1' ? 'E2' : 'E1';
      return { callId: `call-${current}`, finishReason: 'stop', toolCalls: [{ name: 'web_search', providerExecuted: true }], content: `Let me search for more context first.

Let me compile the report now.

# 事件研判报告

## 事件内研判

### 反常
- 结论：当前结果与此前预期存在落差；预期：此前公开方向；观察：当前动作发生变化；落差：承诺与结果不一致；为什么值得讨论：变化会改变参与方的选择；来源：hotspot:1

### 利益冲突
- 结论：收益与成本由不同参与方承担；参与方：用户、公司；争议对象：成本分配；差异：用户承担成本而公司获得收益；为什么值得讨论：责任和收益并不对称；来源：hotspot:1

### 可发散方向
- 方向：需要判断变化是否具有行业代表性；问题：同类主体是否采取相同动作？；基线：行业通常做法；影响：可能改变用户选择；来源：hotspot:1

## 事件外研判

### 对比关系
- 关联事件：${other}；判断：两个事件围绕同一对象但动作不同；具体差异：动作不同、成本承担者不同；可写角度：比较策略差异；观点种子：相同压力不必然导向相同策略；来源：hotspot:1、hotspot:2

## 来源
- [S1] 外部比较资料｜https://example.com/${current}｜摘要：用于支持动作差异的公开资料
` };
    },
  };
  const inputPreview = buildSingleEventResearchModelInput({ event: events[0], scopeItem: base.scope.items[0], events, baseReport: base });
  assert.equal(inputPreview.policy.one_model_interaction_per_event, true);
  assert.equal(inputPreview.batch_event_index.length, 1);
  const result = await generateDiscussionResearchSinglePass({
    gateway, events, baseReport: base, provider: 'fake', workspaceRoot: process.cwd(),
    onModelRequest: (request) => requests.push(request),
    onModelResponse: (response) => responses.push(response),
  });
  assert.equal(calls.length, 2);
  assert.equal(requests.length, 2);
  assert.equal(responses.length, 2);
  assert.ok(calls.every((call) => call.purpose === 'discussion-research'));
  assert.ok(calls.every((call) => call.jsonMode === false));
  assert.ok(calls.every((call) => call.thinking === true));
  assert.ok(calls.every((call) => call.toolChoice === 'auto'));
  assert.ok(calls.every((call) => Array.isArray(call.tools) && call.tools[0].type === 'web_search'));
  assert.ok(calls.every((call) => /不要输出 JSON/u.test(call.messages[1].content)));
  assert.ok(calls.every((call) => !/来源正文/u.test(call.messages[1].content)));
  assert.equal(result.reports.length, 2);
  assert.ok(result.reports.every((report) => report.report_markdown.includes('事件内研判')));
  assert.ok(result.reports.every((report) => report.report_markdown.startsWith('# 事件研判报告')));
  assert.ok(result.reports.every((report) => !report.report_markdown.includes('Let me search')));
  assert.ok(result.reportMaterials.every((material) => material.report_markdown.startsWith('# 事件研判报告')));
  assert.ok(result.internalResearch.every((item) => item.status === 'model_reported'));
  assert.ok(result.relations.length >= 1);
  assert.equal(result.verifiedResearchMaterials.some((item) => item.material_type === 'discussion_report'), true);
});

test('联网门控：本地来源充分且低热度事件关闭原生搜索，并在提示中明确约束', () => {
  const localEvent = {
    ...event('E6', 6),
    t: 40,
    articles: [
      { title: '来源一', source: '来源一', summary: '本地摘要一' },
      { title: '来源二', source: '来源二', summary: '本地摘要二' },
    ],
  };
  const gate = shouldEnableNativeSearch({ event: localEvent, scopeItem: { rank: 6, t: 40 } });
  assert.equal(gate.enabled, false);
  assert.equal(gate.reason, 'sufficient_local_sources_and_low_heat');
  const input = buildSingleEventResearchModelInput({ event: localEvent, scopeItem: { rank: 6, t: 40 }, events: [localEvent], baseReport: { policy: { top_k: 1 }, scope: { items: [{ event_id: 'E6', rank: 6, t: 40 }] } }, nativeWebSearch: gate });
  assert.equal(input.policy.native_web_search, false);
  const messages = buildDiscussionResearchModelMessages({ workspaceRoot: process.cwd(), input, phase: 'single_event' });
  assert.match(messages.user_prompt, /已关闭原生联网搜索/u);
  assert.match(messages.user_prompt, /不得调用搜索/u);
});

test('单事件研判清理前置进度文本但保留无正式标题的原始输出', () => {
  assert.equal(
    cleanSingleEventResearchReport('Let me search.\n\n# 事件研判报告\n\n## 事件内研判'),
    '# 事件研判报告\n\n## 事件内研判',
  );
  assert.equal(cleanSingleEventResearchReport('## 事件内研判\n\n- 结论：有效'), '## 事件内研判\n\n- 结论：有效');
});

test('1A/2A/1B/2B 均使用模型联网，B阶段直接返回求证引用', async () => {
  const events = [event('E1', 1), event('E2', 2)];
  const base = baseReport(events);
  const gateway = {
    config: { providers: { fake: { maxOutputTokens: 20000 } } },
    complete: async () => ({ content: JSON.stringify({ items: [], relations: [], search_tasks: [] }) }),
  };
  const hypothesisRequests = [];
  const hypotheses = await generateDiscussionResearchHypotheses({
    gateway,
    provider: 'fake',
    events,
    baseReport: base,
    workspaceRoot: process.cwd(),
    onModelRequest: (request) => hypothesisRequests.push(request),
  });
  assert.ok(hypothesisRequests.length >= 2);
  assert.ok(hypothesisRequests.every((request) => request.toolChoice === 'auto'));
  assert.ok(hypothesisRequests.every((request) => request.webSearchMode === 'provider_native'));

  const verificationRequests = [];
  await verifyDiscussionResearch({
    gateway,
    provider: 'fake',
    events,
    baseReport: base,
    hypotheses,
    workspaceRoot: process.cwd(),
    onModelRequest: (request) => verificationRequests.push(request),
  });
  assert.ok(verificationRequests.length >= 2);
  assert.ok(verificationRequests.every((request) => request.toolChoice === 'auto'));
  assert.ok(verificationRequests.every((request) => request.webSearchMode === 'provider_native'));
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

test('阶段3输入同时携带事件内搜索证据、事件间搜索证据和外部参考事件', () => {
  const events = [event('E1', 1), event('E2', 2)];
  const base = baseReport(events);
  const input = buildTopicResearchModelInput({
    events,
    baseReport: base,
    internalResearch: [{ event_id: 'E1', signal_count: 1, anomalies: [{ signal_id: 'E1:anomaly:1' }] }],
    relations: [{ relation_id: 'MR-001', relation_kind: 'counterexample', event_ids: ['E1', 'E2'], evidence_source_ids: ['search:relation'] }],
    internalSearchEvidence: {
      E1: [{ source_id: 'search:internal', title: '基线资料', url: 'https://example.com/internal', snippet: '事件内基线', evidence_level: 'full_text' }],
    },
    relationSearchEvidence: {
      'P-E1-E2': [{ source_id: 'search:relation', title: '反例资料', url: 'https://example.com/relation', snippet: '事件间反例', evidence_level: 'full_text' }],
    },
    relationSearchTasks: [{ task_id: 'ST-R-001', target_event_ids: ['E1', 'E2'], target_relation_ids: ['P-E1-E2'], target_signal: 'counterexample', result_ids: ['search:relation'] }],
    referenceEvents: [{ reference_id: 'REF-ST-R-001-1', reference_only: true, anchor_event_ids: ['E1', 'E2'], title: '外部反例', evidence_level: 'summary_only' }],
  });
  assert.equal(input.policy.requires_report_input, true);
  assert.equal(input.policy.requires_research_basis, false);
  assert.equal(input.policy.requires_evidence_source_ids, false);
  assert.deepEqual(input.events.find((item) => item.event_id === 'E1').event_source_ids, ['hotspot:1']);
  assert.deepEqual(input.events.find((item) => item.event_id === 'E1').research_source_ids, ['search:internal', 'search:relation']);
  assert.deepEqual(input.events.find((item) => item.event_id === 'E2').research_source_ids, ['search:relation']);
  assert.equal(input.events.find((item) => item.event_id === 'E1').sources.some((item) => item.source_id === 'search:internal'), true);
  assert.equal(input.events.find((item) => item.event_id === 'E2').sources.some((item) => item.source_id === 'search:relation'), true);
  assert.equal(input.external_reference_events[0].reference_only, true);
  assert.equal(input.relation_search_tasks[0].target_signal, 'counterexample');
});

test('阶段3使用单一压缩研究摘要，不重复发送完整报告和来源片段', () => {
  const digest = buildResearchDigest({
    internalResearch: [{ event_id: 'E1', status: 'verified', anomalies: [{ signal_id: 'S1', statement: '反常', evidence_source_ids: ['SRC-1'] }] }],
    relations: [{ relation_id: 'R1', relation_kind: 'comparison', event_ids: ['E1', 'E2'], relationship_statement: '关系', evidence_source_ids: ['SRC-2'] }],
    verifiedResearchMaterials: [{ material_id: 'M1', status: 'model_reported', anchor_event_ids: ['E1'], statement: '素材', evidence_clips: [{ source_id: 'SRC-1', excerpt: '很长的来源摘录' }] }],
    researchReports: [{ report_id: 'REPORT-1', event_id: 'E1', report_markdown: '# 研判\n\n结论\n\n来源\n\n' + 'x'.repeat(10000) }],
  });
  const input = buildTopicResearchModelInput({
    events: [event('E1', 1), event('E2', 2)],
    baseReport: baseReport([event('E1', 1), event('E2', 2)]),
    internalResearch: [{ event_id: 'E1', anomalies: [{ signal_id: 'S1', statement: '反常' }] }],
    relations: [{ relation_id: 'R1', relation_kind: 'comparison', event_ids: ['E1', 'E2'] }],
    verifiedResearchMaterials: [{ material_id: 'M1', status: 'verified', anchor_event_ids: ['E1'], statement: '素材' }],
    researchReports: [{ report_id: 'REPORT-1', event_id: 'E1', report_markdown: '完整报告'.repeat(3000) }],
  });
  assert.equal(digest.version, 'research-digest-v1');
  assert.equal(digest.materials[0].material_id, 'M1');
  assert.equal(digest.omitted.source_clips, 1);
  assert.equal(input.research_digest.version, 'research-digest-v1');
  assert.equal('internal_research' in input, false);
  assert.equal('inter_event_research' in input, false);
  assert.equal('verified_research_materials' in input, false);
  assert.equal('research_reports' in input, false);
  assert.ok(JSON.stringify(input).length < 20000);
});

test('阶段3不要求关系型选题配额，关系来源仅在模型提供素材时可选回填', async () => {
  const events = [event('E1', 1), event('E2', 2)];
  const base = baseReport(events);
  const calls = [];
  const gateway = {
    config: { providers: { fake: { maxOutputTokens: 20000 } } },
    complete: async (input) => {
      calls.push(input);
      return { content: JSON.stringify({ topic_candidates: [{
        candidate_title: '事件内候选', event_ids: ['E1'], material_ids: [], relation_ids: [], internal_signal_refs: [],
        topic_type: 'model_discussion', core_question: '问题', angle: '角度', thesis_seed: '命题', source_ids: ['hotspot:1'],
      }] }) };
    },
  };
  const result = await generateDiscussionResearchTopics({
    gateway, events, baseReport: base, provider: 'fake', workspaceRoot: process.cwd(),
    internalResearch: [{ event_id: 'E1', anomalies: [{ signal_id: 'E1:anomaly:1', kind: 'anomaly', status: 'supported', statement: '内部反常' }] }],
    relations: [{ relation_id: 'MR-001', relation_kind: 'comparison', status: 'model_reported', event_ids: ['E1', 'E2'], relationship_statement: '两个事件采用了不同策略', differences: ['策略不同'], evidence_source_ids: ['hotspot:1', 'hotspot:2'] }],
    verifiedResearchMaterials: [
      { material_id: 'RM-internal_anomaly-E1:anomaly:1', material_type: 'internal_anomaly', status: 'verified', anchor_event_ids: ['E1'], statement: '内部反常', evidence_source_ids: ['hotspot:1'] },
      { material_id: 'RM-inter_event-MR-001', material_type: 'inter_event_comparison', status: 'model_reported', anchor_event_ids: ['E1', 'E2'], statement: '两个事件采用了不同策略', evidence_source_ids: ['hotspot:1', 'hotspot:2'] },
    ],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].thinking, false);
  assert.equal(result.audit.required, 0);
  assert.equal(result.audit.actual, 0);
  assert.equal(result.audit.repair_attempted, false);
  assert.equal(result.topics.length, 1);
  assert.deepEqual(result.topics[0].relation_ids, []);
});

test('阶段3记录聚合候选与未覆盖事件，不强行生成低质量选题', async () => {
  const events = [event('E1', 1), event('E2', 2), event('E3', 3)];
  const base = buildDiscussionResearch({
    events,
    topK: 3,
    eventHeatRanking: { items: events.map((item) => ({ eventId: item.event_id, rank: item.eventHeatRank, t: item.t, eventValue: item.t, state: 'new_event' })) },
  });
  const gateway = {
    config: { providers: { fake: { maxOutputTokens: 20000 } } },
    complete: async () => ({ content: JSON.stringify({
      topic_candidates: [{
        candidate_title: '两个事件合并后的讨论命题', event_ids: ['E1', 'E2'],
        core_question: '两个事件为什么应放在一起讨论？', angle: '从共同变化切入', thesis_seed: '共同变化比单点新闻更值得讨论',
      }],
      event_coverage: [
        { event_id: 'E1', status: 'covered', candidate_indexes: [1], reason: '' },
        { event_id: 'E2', status: 'covered', candidate_indexes: [1], reason: '' },
        { event_id: 'E3', status: 'uncovered', candidate_indexes: [], reason: '研判信号不足以形成独立文章角度' },
      ],
    }) }),
  };
  const result = await generateDiscussionResearchTopics({
    gateway, events, baseReport: base, provider: 'fake', workspaceRoot: process.cwd(),
    researchReports: events.map((item) => ({ event_id: item.event_id, report_markdown: `报告 ${item.event_id}` })),
  });
  assert.deepEqual(result.coverage, [
    { event_id: 'E1', title: '事件 E1', status: 'covered', candidate_ids: ['MR-T-001'], candidate_indexes: [1], reason: '' },
    { event_id: 'E2', title: '事件 E2', status: 'covered', candidate_ids: ['MR-T-001'], candidate_indexes: [1], reason: '' },
    { event_id: 'E3', title: '事件 E3', status: 'uncovered', candidate_ids: [], candidate_indexes: [], reason: '研判信号不足以形成独立文章角度' },
  ]);
});

test('阶段3兼容研判报告来源别名，并从关系素材继承来源与关系 ID', async () => {
  const events = [event('E1', 1), event('E2', 2)];
  const base = baseReport(events);
  const gateway = {
    config: { providers: { fake: { maxOutputTokens: 20000 } } },
    complete: async () => ({ content: JSON.stringify({ topic_candidates: [{
      candidate_title: '两个事件的策略差异说明了什么？', event_ids: ['E1', 'E2'],
      material_ids: ['RM-inter_event-MR-001'], evidence_source_ids: ['S1'],
      topic_type: 'event_comparison', core_question: '两个事件为何采取不同策略？',
      angle: '比较双方的动作与代价', thesis_seed: '同一压力下不同策略会产生不同代价',
    }] }) }),
  };
  const result = await generateDiscussionResearchTopics({
    gateway, events, baseReport: base, provider: 'fake', workspaceRoot: process.cwd(),
    internalResearch: events.map((item) => ({ event_id: item.event_id, anomalies: [] })),
    relations: [{ relation_id: 'MR-001', relation_kind: 'comparison', status: 'model_reported', event_ids: ['E1', 'E2'], evidence_source_ids: ['native:report-E1:S1'] }],
    verifiedResearchMaterials: [{
      material_id: 'RM-inter_event-MR-001', material_type: 'inter_event_comparison', status: 'model_reported',
      anchor_event_ids: ['E1', 'E2'], statement: '两个事件采用了不同策略', evidence_source_ids: ['native:report-E1:S1'],
      evidence_clips: [{ source_id: 'native:report-E1:S1', title: '研判来源', url: 'https://example.com/research', excerpt: '两个事件的策略差异', evidence_level: 'summary_only' }],
    }],
  });
  assert.equal(result.audit.actual, 1);
  assert.deepEqual(result.topics[0].relation_ids, ['MR-001']);
  assert.deepEqual(result.topics[0].evidence_source_ids, ['native:report-E1:S1']);
});

test('阶段3接受 B 阶段模型联网返回的引用来源', async () => {
  const events = [event('E1', 1)];
  const base = baseReport(events);
  const nativeSourceId = 'native:internal-E1:s1';
  const gateway = {
    config: { providers: { fake: { maxOutputTokens: 20000 } } },
    complete: async () => ({ content: JSON.stringify({ topic_candidates: [{
      candidate_title: '联网引用支持的事件内命题', event_ids: ['E1'],
      material_ids: ['RM-internal_anomaly-E1:anomaly:1'],
      topic_type: 'internal_anomaly', core_question: '这个落差是否成立？', angle: '从基线与实际结果的差异切入',
      thesis_seed: '只有把事件放回基线中比较，反常才有解释力。', source_ids: [nativeSourceId],
    }] }) }),
  };
  const result = await generateDiscussionResearchTopics({
    gateway, events, baseReport: base, provider: 'fake', workspaceRoot: process.cwd(),
    internalResearch: [{ event_id: 'E1', anomalies: [{ signal_id: 'E1:anomaly:1', kind: 'anomaly', status: 'supported', statement: '事件存在基线落差' }] }],
    verifiedResearchMaterials: [{
      material_id: 'RM-internal_anomaly-E1:anomaly:1', material_type: 'internal_anomaly', status: 'needs_review',
      anchor_event_ids: ['E1'], statement: '事件存在基线落差', evidence_source_ids: [nativeSourceId],
      evidence_clips: [{ source_id: nativeSourceId, title: '联网来源', url: 'https://example.com/source', excerpt: '联网搜索引用摘录', evidence_level: 'summary_only' }],
    }],
  });
  assert.equal(result.topics.length, 1);
  assert.equal(result.topics[0].evidence_source_ids[0], nativeSourceId);
  assert.equal(result.topics[0].research_status, 'needs_review');
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

test('没有正文时保留待核事件内研判，旧兼容入口仍可按参数要求筛选候选', () => {
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
  assert.equal(report.internal_signals[0].anomalies.length, 1);
  assert.equal(report.internal_signals[0].anomalies[0].status, 'needs_review');
  assert.equal(report.internal_signals[0].conflicts.length, 1);
  assert.equal(report.internal_signals[0].conflicts[0].status, 'needs_review');
  assert.equal(report.internal_signals[0].divergences.length, 1);
  assert.equal(report.internal_signals[0].divergences[0].status, 'needs_review');
  assert.equal(report.topic_candidates.length, 0);
});

test('阶段2允许有明确反驳对象的反例关系，并拒绝没有反驳对象的关系', () => {
  const events = [event('E1', 1), event('E2', 2), event('E3', 3)];
  const base = buildDiscussionResearch({
    events,
    topK: 3,
    eventHeatRanking: { items: events.map((item) => ({ eventId: item.event_id, rank: item.eventHeatRank, t: item.t, state: 'new_event' })) },
  });
  const raw = {
    items: [],
    relations: [
      { relation_kind: 'counterexample', event_ids: ['E1', 'E2'], statement: 'E2 没有沿着 E1 所代表的采用方向发展', refutes: '行业会继续采用该方案', source_ids: ['hotspot:1', 'hotspot:2'] },
      { relation_kind: 'counterexample', event_ids: ['E1', 'E3'], statement: '没有明确反驳对象', source_ids: ['hotspot:1', 'hotspot:3'] },
    ],
    topic_candidates: [],
  };
  const report = normalizeDiscussionResearchModel(raw, { events, baseReport: base });
  assert.equal(report.relations.length, 1);
  assert.equal(report.relations[0].relation_kind, 'counterexample');
  assert.equal(report.relations[0].relation_type, 'model_counterexample');
});

test('1A保留没有本地source_id的联网探索假设，并交给1B继续验证', async () => {
  const events = [event('E1', 1)];
  const base = baseReport(events);
  const gateway = {
    config: { providers: { fake: { maxOutputTokens: 20000 } } },
    complete: async () => ({ content: JSON.stringify({
      items: [{
        event_id: 'E1',
        anomalies: [{ statement: '当前结果可能偏离该主体此前的公开承诺', expected: '此前承诺与行业基线', observed: '当前事件结果', gap: '需要核对承诺与结果的差异' }],
        interest_conflicts: [],
        divergence_directions: [],
      }],
      search_tasks: [{
        task_type: 'internal_signal_evidence',
        target_event_ids: ['E1'],
        target_signal: 'anomaly',
        research_question: '主体此前是否有相反承诺？',
        query: '主体 公开承诺 结果',
        expected_evidence: '公开承诺、行业基线和当前结果的可比较材料',
      }],
    }) }),
  };
  const result = await generateDiscussionResearchHypotheses({ gateway, events, baseReport: base, provider: 'fake', workspaceRoot: process.cwd() });
  assert.equal(result.internalResearch[0].anomalies.length, 1);
  assert.equal(result.internalResearch[0].anomalies[0].status, 'hypothesis');
  assert.deepEqual(result.internalResearch[0].anomalies[0].evidence_source_ids, []);
  assert.equal(result.searchTasks.length, 1);
  assert.equal(result.searchTasks[0].target_signal, 'anomaly');
});

test('2A即使没有批次内关系对，也会为Top-K锚点寻找外部关系', async () => {
  const events = [
    event('E1', 1),
    { ...event('E2', 2), tags: { eventParts: { who: '另一个主体', object: '另一个对象', actionType: '发布', labels: {} } } },
  ];
  const base = baseReport(events);
  const calls = [];
  const gateway = {
    config: { providers: { fake: { maxOutputTokens: 20000 } } },
    complete: async (input) => {
      calls.push(input);
      if (calls.length === 1) return { content: JSON.stringify({ items: [], search_tasks: [] }) };
      return { content: JSON.stringify({
        relations: [],
        search_tasks: [{
          task_type: 'external_relation_discovery',
          target_event_ids: ['E1'],
          target_relation_ids: ['A-E1'],
          target_signal: 'comparison',
          relation_axis: 'same_subject_different_action',
          research_question: '该主体是否还有另一项可比较动作？',
          query: '该主体 另一项动作 结果',
          expected_evidence: '同一主体的不同动作和结果',
        }],
      }) };
    },
  };
  const result = await generateDiscussionResearchHypotheses({ gateway, events, baseReport: base, provider: 'fake', workspaceRoot: process.cwd() });
  assert.equal(calls.length, 3);
  assert.equal(result.relationPairs.length, 0);
  assert.equal(result.externalAnchorEvents.length, 2);
  assert.equal(result.searchTasks.length, 1);
  assert.equal(result.searchTasks[0].target_relation_ids[0], 'A-E1');
});

test('模型假设阶段生成并保留绑定事件与关系轴的搜索任务', async () => {
  const events = [event('E1', 1), event('E2', 2)];
  const base = baseReport(events);
  const calls = [];
  const gateway = {
    config: { providers: { fake: { maxOutputTokens: 20000 } } },
    complete: async (input) => {
      calls.push(input);
      if (calls.length <= 2) return { content: JSON.stringify({ items: [{ event_id: calls.length === 1 ? 'E1' : 'E2', anomalies: calls.length === 1 ? [{ statement: '发布后动作改变', source_ids: ['hotspot:1'] }] : [], interest_conflicts: [], divergence_directions: [] }], search_tasks: calls.length === 1 ? [{ task_type: 'internal_signal_evidence', target_event_ids: ['E1'], target_signal: 'anomaly', research_question: '是否存在此前承诺？', query: 'E1 承诺 实际变化', expected_evidence: '公开承诺和实际结果' }] : [] }) };
      return { content: JSON.stringify({ relations: [{ relation_kind: 'comparison', event_ids: ['E1', 'E2'], statement: '两个事件动作不同', differences: ['动作不同'] }], search_tasks: [{ task_type: 'external_relation_discovery', target_event_ids: ['E1'], target_relation_ids: ['P-E1-E2'], target_signal: 'comparison', relation_axis: 'same_subject_different_action', research_question: '主体是否还有不同动作？', query: '同一主体 不同动作', expected_evidence: '主体、动作和结果' }] }) };
    },
  };
  const result = await generateDiscussionResearchHypotheses({ gateway, events, baseReport: base, provider: 'fake', workspaceRoot: process.cwd() });
  assert.equal(result.searchTasks.length, 2);
  assert.equal(result.relations.length, 1);
  assert.equal(result.relations[0].status, 'relation_hypothesis');
  assert.deepEqual(result.relations[0].evidence_source_ids, []);
  assert.equal(result.searchTasks[0].model_generated, true);
  assert.equal(result.searchTasks[1].relation_axis, 'same_subject_different_action');
  assert.equal(calls.length, 3);
});

test('验证阶段允许 Top-K 事件与外部参考事件形成关系，并产出写作素材', async () => {
  const events = [event('E1', 1), event('E2', 2)];
  const base = baseReport(events);
  const hypotheses = {
    selectedEvents: events,
    internalResearch: [],
    relations: [],
    relationPairs: [{ pair_id: 'P-E1-E2', event_ids: ['E1', 'E2'] }],
    relationGroups: [],
  };
  const gateway = {
    config: { providers: { fake: { maxOutputTokens: 20000 } } },
    complete: async (input) => {
      const user = input.messages?.[1]?.content || '';
      if (user.includes('第 1B')) return { content: JSON.stringify({ items: [{ event_id: 'E1', anomalies: [], interest_conflicts: [], divergence_directions: [] }] }) };
      return { content: JSON.stringify({ relations: [{ relation_kind: 'comparison', event_ids: ['E1'], reference_event_ids: ['REF-1'], statement: '相似主体采取了相反策略', differences: ['动作方式不同', '结果不同'], insight: '相似压力下的策略选择不同', writing_angles: ['比较不同降本策略'], thesis_seeds: ['相同压力不必然导向相同动作'], source_ids: ['search:relation:1'] }] }) };
    },
  };
  const verified = await verifyDiscussionResearch({
    gateway, events, baseReport: base, hypotheses, provider: 'fake', workspaceRoot: process.cwd(),
    relationSearchEvidence: { 'P-E1-E2': [{ source_id: 'search:relation:1', title: '外部样本', url: 'https://example.com/ref', snippet: '外部样本', content: '完整外部正文', evidence_level: 'full_text' }] },
    relationSearchTasks: [{ task_id: 'ST-1', target_event_ids: ['E1'], target_relation_ids: ['P-E1-E2'], target_signal: 'comparison' }],
    referenceEvents: [{ reference_id: 'REF-1', reference_only: true, anchor_event_ids: ['E1'], source_id: 'search:relation:1', title: '外部样本', evidence_level: 'full_text' }],
  });
  assert.equal(verified.relations.length, 1);
  assert.equal(verified.relations[0].status, 'verified_relation');
  assert.equal(verified.relations[0].reference_event_ids[0], 'REF-1');
  assert.equal(verified.verifiedResearchMaterials[0].status, 'verified');
});

test('验证后的事件内信号带有写作角度和观点种子', () => {
  const materials = buildVerifiedResearchMaterials({ internalResearch: [{ event_id: 'E1', anomalies: [{ signal_id: 'E1:anomaly:1', kind: 'anomaly', status: 'supported', statement: '预期与结果有落差', expected: '预期', observed: '结果', gap: '落差', writing_angles: ['从成本承担者切入'], thesis_seeds: ['表面降本可能是成本转移'], evidence_source_ids: ['S1'], evidence_levels: ['full_text'] }], conflicts: [], divergences: [] }] });
  assert.equal(materials.length, 1);
  assert.equal(materials[0].material_type, 'internal_anomaly');
  assert.equal(materials[0].writing_angles[0], '从成本承担者切入');
  assert.equal(materials[0].thesis_seeds[0], '表面降本可能是成本转移');
});

test('阶段3合并重复研判并把受控搜索正文整理成证据片段', () => {
  const signal = (signalId, status) => ({
    signal_id: signalId,
    kind: 'anomaly',
    status,
    statement: '承诺与实际结果存在落差',
    expected: '公司承诺改善效率',
    observed: '员工反馈流程反而变慢',
    gap: '效率承诺没有兑现',
    alternative_explanations: ['可能是新流程仍处于磨合期'],
    writing_angles: ['从承诺兑现切入'],
    thesis_seeds: ['降本不等于效率提升'],
    question: '是否有更多数据支持这一落差？',
    evidence_source_ids: ['search:ST-1:1'],
    evidence_levels: ['full_text'],
  });
  const materials = buildVerifiedResearchMaterials({
    internalResearch: [{ event_id: 'E1', anomalies: [signal('E1:anomaly:1', 'supported'), signal('E1:anomaly:2', 'needs_review')], conflicts: [], divergences: [] }],
    evidenceSources: new Map([['search:ST-1:1', {
      source_id: 'search:ST-1:1',
      title: '公司回应与员工反馈',
      url: 'https://example.com/source',
      content: '正文中明确写出流程变化和员工反馈。',
      evidence_level: 'full_text',
    }]]),
  });
  assert.equal(materials.length, 1);
  assert.equal(materials[0].status, 'verified');
  assert.equal(materials[0].fact_statement, '员工反馈流程反而变慢');
  assert.equal(materials[0].evidence_clips[0].url, 'https://example.com/source');
  assert.equal(materials[0].evidence_clips[0].excerpt, '正文中明确写出流程变化和员工反馈。');
  assert.equal(materials[0].alternative_explanations[0], '可能是新流程仍处于磨合期');
});
