import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOpenQuestions, hasOpenQuestions } from '../lib/domain/open-questions.mjs';

test('open_questions 无问题表述归一为空串', () => {
  for (const value of ['', '  ', '无', '无。', '无.', '没有了', '暂无', '无未决问题', 'none', 'N/A',
    '无。已确认：替代成本框架的边界条件在结尾一句带过；四类企业分析以Anthropic与Kimi为主。',
    '无，剩下的都可以写了', '无未决问题。']) {
    assert.equal(normalizeOpenQuestions(value), '', `应当清零: ${value}`);
    assert.equal(hasOpenQuestions(value), false, `应当无未决: ${value}`);
  }
});

test('open_questions 真实问题不误伤', () => {
  for (const value of ['无版权数据能否使用？', '作者对涨价的立场还没确认', '定价数据从哪里来？']) {
    assert.equal(normalizeOpenQuestions(value), value, `应当保留: ${value}`);
    assert.equal(hasOpenQuestions(value), true, `应当有未决: ${value}`);
  }
});
