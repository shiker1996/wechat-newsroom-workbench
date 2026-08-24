import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCardPlanJson } from '../server/features/social-cards/application/social-card-pipeline.mjs';

test('布局修复 JSON 清洗支持代码围栏、尾逗号和字符串内真实换行', () => {
  const value = cleanCardPlanJson('```json\n[{"kind":"content","content_blocks":[{"type":"text","content":"第一行\n第二行",},],}]\n```');
  assert.equal(value[0].content_blocks[0].content, '第一行\n第二行');
});

test('布局修复 JSON 不会被内容块内部的 Markdown 代码围栏截断', () => {
  const payload = JSON.stringify([{ kind: 'content', content_blocks: [{ type: 'code', content: '```bash\ntode .\n```' }] }]);
  const value = cleanCardPlanJson('```json\n' + payload + '\n```');
  assert.equal(value[0].content_blocks[0].content, '```bash\ntode .\n```');
});

test('布局修复 JSON 清洗可修复正文中的未转义引号', () => {
  const value = cleanCardPlanJson('[{"kind":"content","content_blocks":[{"type":"text","content":"按下 "Ctrl+C" 退出"}]}]');
  assert.equal(value[0].content_blocks[0].content, '按下 "Ctrl+C" 退出');
});

test('布局修复 JSON 仍拒绝不完整或非法引号结构', () => {
  assert.throws(() => cleanCardPlanJson('[{"kind":"content","title":"缺少结束引号}]'), /Unexpected|unterminated|JSON/);
});
