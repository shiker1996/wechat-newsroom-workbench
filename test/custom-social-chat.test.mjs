import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseResult,
  sanitizeFormUpdates,
  requestMessages,
} from '../server/features/social-cards/llm/custom-social-chat.mjs';

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
  const openingBody = JSON.parse(opening[1].content.match(/<untrusted-data[^>]*>\n([\s\S]*)\n<\/untrusted-data>/)[1]);
  assert.equal(openingBody.draft.topic, '');
  assert.match(opening.at(-1).content, /对话刚开始/);
  const answering = requestMessages({ draft: { topic: '笔记同步' }, history: [{ role: 'user', content: 'hi' }], answer: '  我想做教程  ' });
  const answeringBody = JSON.parse(answering[1].content.match(/<untrusted-data[^>]*>\n([\s\S]*)\n<\/untrusted-data>/)[1]);
  assert.equal(answeringBody.draft.topic, '笔记同步');
  // 历史与本轮回答展开为真实 user/assistant 回合，指令作为最后一条 user 消息
  assert.deepEqual(answering.slice(2, -1), [{ role: 'user', content: 'hi' }, { role: 'user', content: '我想做教程' }]);
  assert.match(answering.at(-1).content, /处理用户刚才的回答/);
});
