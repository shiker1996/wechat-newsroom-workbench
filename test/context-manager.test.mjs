import test from 'node:test';
import assert from 'node:assert/strict';
import { compactMessages, contextBudget, estimateTokens } from '../server/platform/llm/context-manager.mjs';

test('short context is left unchanged', async () => {
  const messages = [{ role: 'user', content: '你好' }];
  const result = await compactMessages(messages, { budget: 100, summarize: async () => 'unused' });
  assert.equal(result.compressed, false);
  assert.deepEqual(result.messages, messages);
});

test('old compressible messages are summarized while protected facts remain', async () => {
  const protectedFact = { role: 'user', content: '来源：https://example.com，数字 42', protected: true };
  const messages = [{ role: 'system', content: '编辑助手' }, protectedFact,
    ...Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `第 ${i} 轮讨论 `.repeat(25) }))];
  const result = await compactMessages(messages, { budget: 350, recentMessageCount: 2, summarize: async () => '保留的历史摘要' });
  assert.equal(result.compressed, true);
  assert.ok(result.messages.some((item) => item.content.includes('历史上下文压缩摘要')));
  assert.ok(result.messages.includes(protectedFact));
  assert.ok(result.afterTokens <= 350);
});

test('context budget reserves output and safety margin', () => {
  assert.equal(contextBudget({ contextWindow: 10000, maxOutputTokens: 2000 }, { safetyReserveTokens: 1000 }, 1500), 7500);
  assert.ok(estimateTokens([{ role: 'user', content: '中文 mixed text' }]) > 8);
});
