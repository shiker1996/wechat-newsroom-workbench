import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseResult,
  visiblePartial,
  sanitizeFormUpdates,
  requestMessages,
  runCustomSocialChatStream,
} from '../lib/llm/custom-social-chat.mjs';

function mockGateway(chunks) {
  return {
    config: { defaultProvider: 'test', providers: { test: { maxOutputTokens: 4096 } } },
    async streamComplete(input, onDelta) {
      let total = '';
      for (const chunk of chunks) { total += chunk; onDelta(chunk, total); }
      return { content: total, callId: 1, finishReason: 'stop', usage: { total_tokens: 10 }, model: 'mock' };
    },
  };
}

test('parseResult 解析合法 JSON 与围栏 JSON', () => {
  const plain = parseResult({ content: '{"assistantReply":"好","ready":false}', finishReason: 'stop' });
  assert.equal(plain.assistantReply, '好');
  const fenced = parseResult({ content: '```json\n{"assistantReply":"行"}\n```', finishReason: 'stop' });
  assert.equal(fenced.assistantReply, '行');
});

test('parseResult 对截断/无效 JSON 报错并标记模型调用', () => {
  const calls = [];
  const store = { updateModelCall(id, patch) { calls.push({ id, patch }); } };
  assert.throws(() => parseResult({ content: '{"assistantReply":"没完', finishReason: 'length', callId: 9 }, store), /截断/);
  assert.equal(calls[0].id, 9);
  assert.equal(calls[0].patch.status, 'invalid_output');
  assert.throws(() => parseResult({ content: '不是 JSON', finishReason: 'stop', callId: 10 }, store), /无效 JSON/);
});

test('visiblePartial 从半截 JSON 中抠出 assistantReply', () => {
  assert.equal(visiblePartial('{"assistantReply":"你好，想做'), '你好，想做');
  assert.equal(visiblePartial('{"assistantReply":"第一行\\n第二'), '第一行\n第二');
  assert.equal(visiblePartial('{"formUpdates":{}'), '');
  assert.equal(visiblePartial('{"assistantReply":"完整","ready":true}'), '完整');
});

test('sanitizeFormUpdates 只放行合法字段并清洗取值', () => {
  const out = sanitizeFormUpdates({
    content_type: 'tutorial', channel: 'xiaohongshu', topic: ' 笔记同步 ',
    points: ['【体验】每周整理', '', '【建议】从低频开始'],
    materialUrls: ['https://example.com/a', '不是链接', 'ftp://x'],
    expected_pages: 99, hacker: 'drop me', ready: 'not-a-field',
  });
  assert.deepEqual(out, {
    content_type: 'tutorial', channel: 'xiaohongshu', topic: '笔记同步',
    points: ['【体验】每周整理', '【建议】从低频开始'],
    materialUrls: ['https://example.com/a'],
    expected_pages: 10,
  });
  assert.equal(sanitizeFormUpdates({ content_type: 'essay', channel: 'weibo' }).content_type, undefined);
  assert.equal(sanitizeFormUpdates(null).topic, undefined);
  assert.equal(sanitizeFormUpdates({ expected_pages: 2 }).expected_pages, 4);
});

test('requestMessages 按有无回答生成指令并携带草稿与历史', () => {
  const opening = requestMessages({ draft: { topic: '' }, history: [], answer: '' });
  assert.equal(opening[0].role, 'system');
  const openingBody = JSON.parse(opening[1].content);
  assert.match(openingBody.instruction, /对话刚开始/);
  const answering = requestMessages({ draft: { topic: '笔记同步' }, history: [{ role: 'user', content: 'hi' }], answer: '  我想做教程  ' });
  const answeringBody = JSON.parse(answering[1].content);
  assert.match(answeringBody.instruction, /处理用户刚才的回答/);
  assert.equal(answeringBody.draft.topic, '笔记同步');
  assert.deepEqual(answeringBody.conversation, [{ role: 'user', content: 'hi' }, { role: 'user', content: '我想做教程' }]);
});

test('runCustomSocialChatStream 流式输出回复并返回清洗后的表单更新', async () => {
  const final = '{"assistantReply":"主题已明确。你的目标读者是谁？","formUpdates":{"content_type":"tutorial","topic":"笔记同步","materialUrls":["https://a.com","bad"],"expected_pages":20,"bogus":1},"ready":false}';
  const chunks = [final.slice(0, 20), final.slice(20, 45), final.slice(45)];
  const deltas = [];
  const result = await runCustomSocialChatStream({ gateway: mockGateway(chunks), provider: '', batchId: 'b1', draft: {}, history: [], answer: '', onText: (text) => deltas.push(text) });
  assert.equal(deltas.join(''), '主题已明确。你的目标读者是谁？');
  assert.equal(result.reply, '主题已明确。你的目标读者是谁？');
  assert.deepEqual(result.formUpdates, { content_type: 'tutorial', topic: '笔记同步', materialUrls: ['https://a.com'], expected_pages: 10 });
  assert.equal(result.ready, false);
});
