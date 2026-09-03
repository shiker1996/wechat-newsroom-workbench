import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  sanitizeFormUpdates,
  requestMessages,
} from '../server/features/social-cards/llm/custom-social-chat.mjs';

test('自定义图文策划不再暴露普通文本 JSON 解析协议', () => {
  const source = fs.readFileSync(new URL('../server/features/social-cards/application/agent/custom-social-adapter.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /parseResult|parseModelJson/);
  assert.match(source, /agent\.conversation\.finish/);
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
