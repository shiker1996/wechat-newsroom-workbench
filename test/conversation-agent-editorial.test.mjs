import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../server/platform/core/store.mjs';
import { ToolRegistry } from '../server/platform/tools/registry.mjs';
import { runEditorialAgentTurn, selectEditorialResearchPoints } from '../server/features/articles/application/agent/editorial-adapter.mjs';
import { buildEditorialMessages } from '../server/features/articles/llm/editorial-room.mjs';

function call(capability, input, id = capability) {
  return { id, name: capability, input };
}

function native(callId, toolCalls, model = 'mock') {
  return { callId, content: '', toolCalls, model, usage: { total_tokens: 10 } };
}

function gateway(sequence) {
  let index = 0;
  return {
    config: { defaultProvider: 'mock', providers: { mock: { maxOutputTokens: 4096, supportsNativeTools: true, supportsToolCallStreaming: false } } },
    async complete(input) {
      const next = sequence[index++];
      if (typeof next === 'function') return next(input);
      return next;
    },
  };
}

function registry() {
  const value = new ToolRegistry();
  value.register({
    manifest: {
      id: 'mock-url', name: '网页读取', version: '1.0.0', capabilities: ['cap_content_url_fetch'], riskLevel: 'network-read', pathInputs: ['root'],
      inputSchema: { type: 'object', required: ['targetUrl', 'root'], properties: { targetUrl: { type: 'string' }, title: { type: 'string' }, root: { type: 'string' } } }, outputSchema: { type: 'object' },
    },
    adapter: { async execute(input) { return { status: 'ok', data: { url: input.targetUrl, title: input.title, content: '原文证据：产品实测数据为 42。' }, artifacts: [], warnings: [], provenance: { requestedUrl: input.targetUrl, finalUrl: input.targetUrl } }; } },
  });
  return value;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'editorial-agent-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), 'config', 'capability-consumers.json'), path.join(root, 'config', 'capability-consumers.json'));
  const store = new Store(path.join(root, 'test.db'));
  const batch = store.createBatch({ date: '2026-08-14', title: 'Agent 试点' });
  store.addHotspots(batch.id, 'manual', [{ title: '测试事件', url: 'https://example.com/source' }]);
  const hotspot = store.getBatch(batch.id).hotspots[0];
  const candidate = store.addCandidates(batch.id, [hotspot.id], { tracks: ['article'] })[0];
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store, batch, hotspot, candidate };
}

test('编辑室消息把研判拓展点作为写作输入，不带评分字段', async () => {
  const messages = await buildEditorialMessages({ hotspot_title: '候选命题', url: 'https://example.com/source', category: '新闻事件', risk_level: '低', messages: [], editorial: {} }, '', [], null, process.cwd(), {
    scope: { events: [{ event_id: 'E1', title: '事件一' }, { event_id: 'E2', title: '事件二' }] },
    topic_candidates: [{ candidate_title: '谁反驳了这个趋势？', core_question: '原有判断在哪些条件下不成立？', angle: '从反例切入', thesis_seed: '趋势存在边界' }],
    internal_research: [{ event_id: 'E1', title: '事件一', internal_research: { anomalies: [{ statement: '宣传与结果出现落差' }] } }],
    inter_event_research: [{ relation_id: 'MR-001', relation_kind: 'counterexample', relationship_statement: '事件二反驳了继续扩大的判断', event_ids: ['E1', 'E2'] }],
    reference_events: [{ reference_id: 'REF-1', reference_only: true, title: '外部反例样本', evidence_level: 'summary_only' }],
  });
  const content = messages.map((item) => String(item.content || '')).join('\n');
  assert.match(content, /谁反驳了这个趋势/);
  assert.match(content, /事件二反驳了继续扩大的判断/);
  assert.match(content, /外部反例样本/);
  assert.doesNotMatch(content, /event_value|event_rank/);
});

test('编辑室把研判点目录独立传递，不能被主上下文截断', async () => {
  const events = Array.from({ length: 10 }, (_, index) => ({ event_id: `E${index}`, title: `事件${index}` }));
  const internalResearch = events.map((event, eventIndex) => ({
    event_id: event.event_id,
    title: event.title,
    internal_research: {
      anomalies: Array.from({ length: 4 }, (_, pointIndex) => ({
        signal_id: `I${eventIndex}-${pointIndex}`,
        statement: `反常信号 ${eventIndex}-${pointIndex}：宣传与实际结果存在需要进一步解释的明显落差。`,
        question: '为什么会出现这组落差？',
      })),
    },
  }));
  const messages = await buildEditorialMessages(
    { hotspot_title: '测试', url: '', category: '', risk_level: '', messages: [], editorial: {} },
    '', [], null, process.cwd(),
    { scope: { events }, internal_research: internalResearch, inter_event_research: [], topic_candidates: [], verified_research_materials: [], research_reports: [], reference_events: [] },
  );
  const context = messages.find((item) => String(item.content || '').includes('editorial-context'))?.content || '';
  const catalog = messages.find((item) => String(item.content || '').includes('research-selection-catalog'))?.content || '';
  assert.doesNotMatch(context, /selectable_research_points/);
  assert.match(catalog, /truncated="false"/);
  assert.match(catalog, /"point_count":40/);
  assert.match(catalog, /I9-3/);
});

test('编辑室通过原生工具读取资料、更新底稿，并用结束工具提交回复', async (t) => {
  const { root, store, hotspot, candidate } = fixture(t);
  const events = [{ event_id: 'E001', title: '测试事件', hotspots: [{ ...hotspot, sourceDoc: null }] }];
  const sequence = [
    native('m1', [call('cap_content_url_fetch', { resourceId: `source:${hotspot.id}` }, 'source')]),
      ({ messages, toolChoice }) => {
      assert.notEqual(toolChoice, 'required');
      assert.ok(messages.some((item) => item.role === 'tool' && item.content.includes('产品实测数据为 42')));
      return native('m2', [call('cap_agent_form_update', { operations: [
        { field: 'angle', op: 'replace', value: '从实测落差切入' },
        { field: 'thesis', op: 'replace', value: '宣传与实际效果的差异值得解释' },
        { field: 'confirmed_facts', op: 'append', values: ['来源显示实测数据为 42'] },
        { field: 'author_opinions', op: 'append', values: ['作者主张实测优先'] },
        { field: 'research_basis', op: 'replace', value: '采用事件内部反常主线：宣传与实测结果存在落差。' },
        { field: 'forbidden_claims', op: 'replace', value: '不扩大样本' },
      ] }, 'form')]);
    },
    ({ messages }) => {
      assert.ok(messages.some((item) => item.role === 'tool' && item.content.includes('从实测落差切入')));
      return native('m3', [call('cap_agent_conversation_finish', { assistantReply: '事实已核对，已记录实测落差主线。' }, 'finish')]);
    },
  ];
  const eventsSeen = [];
  const result = await runEditorialAgentTurn({ gateway: gateway(sequence), store, registry: registry(), candidateId: candidate.id, provider: 'mock', events, workspaceRoot: root, onEvent: (event) => eventsSeen.push(event) });
  assert.equal(result.toolCalls, 3);
  assert.equal(result.reply, '事实已核对，已记录实测落差主线。');
  assert.equal(result.candidate.angle, '从实测落差切入');
  assert.equal(result.candidate.thesis, '宣传与实际效果的差异值得解释');
  assert.match(result.editorial.research_basis, /反常主线/);
  assert.equal(store.getAgentRun(result.agentRunId).status, 'completed');
  assert.ok(eventsSeen.some((event) => event.type === 'tool.completed' && event.capability === 'cap_agent_conversation_finish'));
});

test('编辑室业务工具可选择有效研判拓展点，结束工具不需要再提交 JSON', async (t) => {
  const { root, store, candidate } = fixture(t);
  store.updateCandidate(candidate.id, { angle: '从实测落差切入', thesis: '宣传与实际效果的差异值得解释' });
  const researchRoot = path.join(root, 'topics', `${candidate.batch_id}-orchestrated`, 'sources');
  fs.mkdirSync(researchRoot, { recursive: true });
  fs.writeFileSync(path.join(researchRoot, 'discussion-research.json'), JSON.stringify({
    schema_version: 3, policy: { top_k: 10 }, scope: { items: [{ event_id: 'E1', title: '工具发布', event_value: 90, rank: 1 }], events: [{ event_id: 'E1', title: '工具发布' }] },
    internal_signals: [{ event_id: 'E1', title: '工具发布', internal_research: { anomalies: [{ signal_id: 'I1', statement: '宣传效果与实测结果存在落差' }] } }],
    relations: [], reference_events: [], verified_research_materials: [], research_reports: [], generated_at: '2026-08-14T00:00:00Z',
  }), 'utf8');
  const result = await runEditorialAgentTurn({ gateway: gateway([
    native('select', [call('cap_editorial_research_select', { point_ids: ['I1'], rationale: '支撑当前命题' }, 'select')]),
    native('finish', [call('cap_agent_conversation_finish', { assistantReply: '已采用实测落差研判点。' }, 'finish')]),
  ]), store, registry: registry(), candidateId: candidate.id, provider: 'mock', events: [{ event_id: 'E1', title: '工具发布', hotspots: [] }], workspaceRoot: root });
  assert.equal(result.toolCalls, 2);
  assert.equal(store.getCandidate(candidate.id).editorial.adopted_research_points[0].point_id, 'I1');
});

test('编辑室允许普通文本回复；不解析旧 JSON，也不写入其中的字段', async (t) => {
  const { root, store, candidate } = fixture(t);
  const oldJson = JSON.stringify({ type: 'final', assistantReply: '不应被接受', briefUpdates: { angle: '不应写入' } });
  const result = await runEditorialAgentTurn({ gateway: gateway([{ callId: 'legacy', content: oldJson, model: 'mock', usage: {} }]), store, registry: registry(), candidateId: candidate.id, provider: 'mock', events: [], workspaceRoot: root });
  assert.equal(result.reply, oldJson);
  assert.notEqual(store.getCandidate(candidate.id).angle, '不应写入');
});

test('未启用原生工具的模型不会回退到 JSON 协议', async (t) => {
  const { root, store, candidate } = fixture(t);
  const unsupported = gateway([]);
  unsupported.config.providers.mock.supportsNativeTools = false;
  await assert.rejects(runEditorialAgentTurn({ gateway: unsupported, store, registry: registry(), candidateId: candidate.id, provider: 'mock', events: [], workspaceRoot: root }), /未启用原生工具调用/);
});
