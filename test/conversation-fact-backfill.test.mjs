import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../server/platform/core/store.mjs';
import { selectConversationSearchAttachments } from '../server/platform/agent/fact-attachments.mjs';
import { attachInformationSearch } from '../server/platform/integrations/information-search.mjs';

const attachment = (capability, query, updatedAt, data = {}) => ({
  capability,
  updated_at: updatedAt,
  data: { ...data, _agentQuery: query },
});

test('回填选择：query 精确等于 topic 时优先精确匹配', () => {
  const attachments = [
    attachment('cap_content_web_search', '别的 query', '2026-08-14T02:00:00Z', { answer: '新但无关' }),
    attachment('cap_content_web_search', '最终主题', '2026-08-14T01:00:00Z', { answer: '旧但精确' }),
  ];
  const selected = selectConversationSearchAttachments(attachments, '最终主题');
  assert.equal(selected.get('cap_content_web_search').data.answer, '旧但精确');
});

test('回填选择：query 与 topic 不一致时回退到同会话最近一次检索结果', () => {
  const attachments = [
    attachment('cap_content_news_search', '对话中的搜索词', '2026-08-14T02:00:00Z', { answer: '最近结果' }),
    attachment('cap_content_news_search', '更早的搜索词', '2026-08-14T01:00:00Z', { answer: '较早结果' }),
  ];
  const selected = selectConversationSearchAttachments(attachments, '最终定稿主题');
  assert.equal(selected.get('cap_content_news_search').data.answer, '最近结果');
  assert.equal(selected.has('cap_content_web_search'), false);
  assert.equal(selectConversationSearchAttachments([], '主题').size, 0);
});

test('回填复用后 attachInformationSearch 跳过已回填槽位，不再重复搜索', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fact-backfill-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const originalKey = process.env.TAVILY_API_KEY;
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  process.env.TAVILY_API_KEY = 'test-key';
  globalThis.fetch = async () => { fetches += 1; throw new Error('不应发起搜索请求'); };
  try {
    // 模拟创建端：query≠topic，helper 回退复用同 batch 的 Agent 检索结果回填
    const attachments = [
      attachment('cap_content_web_search', '对话搜索词', '2026-08-14T02:00:00Z', { answer: 'Agent 答案', results: [{ title: '官方', url: 'https://example.com' }] }),
      attachment('cap_content_news_search', '对话新闻词', '2026-08-14T02:00:00Z', { answer: 'Agent 新闻', results: [] }),
    ];
    const fact = { topic: '最终定稿主题' };
    for (const [capability, item] of selectConversationSearchAttachments(attachments, fact.topic)) {
      const base = { query: String(item.data?._agentQuery || fact.topic), provider: 'conversation-agent', answer: item.data.answer || '', results: item.data.results || [], warnings: item.data.warnings || [], searched_at: item.updated_at };
      if (capability === 'cap_content_web_search') fact.web_search = base;
      if (capability === 'cap_content_news_search') fact.news_search = base;
    }
    assert.equal(fact.web_search.query, '对话搜索词');
    const result = await attachInformationSearch({ fact, input: {}, root, toolContext: {} });
    assert.ok(result.attached.includes('web_search') && result.attached.includes('news_search'), '已回填槽位应被标记为复用');
    assert.equal(fetches, 0, '已回填的槽位不应重复搜索');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalKey;
  }
});

test('事实附件按 batch 与 entryPoint 隔离，跨批次不串数据', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fact-backfill-'));
  const store = new Store(path.join(root, 'test.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const batchA = store.createBatch({ date: '2026-08-14', title: '批次 A' });
  const batchB = store.createBatch({ date: '2026-08-14', title: '批次 B' });
  store.saveConversationFactAttachment({ batchId: batchA.id, entryPoint: 'independent-writing', capability: 'cap_content_web_search', fingerprint: 'f1', agentRunId: null, data: { _agentQuery: 'A 的搜索', answer: 'A 结果' } });
  store.saveConversationFactAttachment({ batchId: batchB.id, entryPoint: 'independent-writing', capability: 'cap_content_web_search', fingerprint: 'f2', agentRunId: null, data: { _agentQuery: 'B 的搜索', answer: 'B 结果' } });
  store.saveConversationFactAttachment({ batchId: batchA.id, entryPoint: 'custom-social', capability: 'cap_content_web_search', fingerprint: 'f3', agentRunId: null, data: { _agentQuery: '图文会话搜索', answer: '图文结果' } });
  const listA = store.listConversationFactAttachments({ batchId: batchA.id });
  assert.deepEqual(listA.map((item) => item.data.answer), ['A 结果']);
  assert.deepEqual(store.listConversationFactAttachments({ batchId: batchB.id }).map((item) => item.data.answer), ['B 结果']);
  assert.deepEqual(store.listConversationFactAttachments({ batchId: batchA.id, entryPoint: 'custom-social' }).map((item) => item.data.answer), ['图文结果']);
});
