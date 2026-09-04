import test from 'node:test';
import assert from 'node:assert/strict';
import adapter, { tokenize, chunkPassage, bm25TopChunks, buildExcerpt } from '../plugins/local-passage-retrieval/adapter.mjs';
import { getToolRegistry } from '../server/platform/tools/index.mjs';

test('tokenize：英文按词、中文按 bigram', () => {
  const tokens = tokenize('DeepSeek 发布新模型');
  assert.ok(tokens.includes('deepseek'));
  assert.ok(tokens.includes('发布'));
  assert.ok(tokens.includes('新模'));
  assert.ok(tokens.includes('模型'));
});

test('chunkPassage：短段打包、长段硬切', () => {
  const chunks = chunkPassage('第一段。\n\n第二段。', 500);
  assert.equal(chunks.length, 1);
  const long = chunkPassage('字'.repeat(1200), 500);
  assert.equal(long.length, 3);
  assert.ok(long.every((c) => c.length <= 500));
});

test('bm25TopChunks：相关块排在前列且保持原文顺序', () => {
  const chunks = [
    '今天天气很好，适合出门散步。',
    'DeepSeek 发布了新一代开源模型， benchmarks 提升明显。',
    '晚饭吃什么是个永恒的问题。',
    '该模型在代码生成任务上超过了前代，API 价格不变。',
  ];
  const picked = bm25TopChunks(chunks, tokenize('模型 代码生成'), 2);
  assert.deepEqual(picked, [1, 3]);
});

test('buildExcerpt：短文档全文返回', () => {
  const { excerpt, chunks } = buildExcerpt('短文', '任意');
  assert.equal(excerpt, '短文');
  assert.equal(chunks, 1);
});

test('buildExcerpt：长文档保留头部并选中相关段落', () => {
  const intro = '导语：本文介绍数据库索引的基本原理。';
  const filler = '与主题无关的闲谈内容。'.repeat(80);
  const relevant = 'B+ 树索引的查询复杂度是 O(log n)，适合范围查询。';
  const content = `${intro}\n\n${filler}\n\n${relevant}\n\n${filler}`;
  const { excerpt } = buildExcerpt(content, '索引 查询 复杂度', { headChars: 100, maxCharsPerDoc: 1200, k: 3 });
  assert.ok(excerpt.startsWith('导语'));
  assert.ok(excerpt.includes('B+ 树索引'));
  assert.ok(excerpt.length <= 1200);
  assert.ok(!excerpt.includes(filler.repeat(2)), '无关内容不应占满摘录');
});

test('buildExcerpt：查询无命中时回退头部截断', () => {
  const content = '随便写点什么。'.repeat(1000);
  const { excerpt, chunks } = buildExcerpt(content, '完全不相关的词xyz', { maxCharsPerDoc: 1000 });
  assert.equal(chunks, 0);
  assert.equal(excerpt.length, 1000);
});

test('adapter.execute：按文档返回摘录与块统计', async () => {
  const result = await adapter.execute({
    documents: [{ id: 'a', content: '短' }, { id: 'b', content: '长'.repeat(9000) }],
    query: '测试',
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.data.selections.length, 2);
  assert.equal(result.data.selections[0].id, 'a');
});

test('注册表可解析 cap_content_passage_retrieve 并执行', async () => {
  const registry = await getToolRegistry();
  const result = await registry.execute('cap_content_passage_retrieve', {
    documents: [{ id: 'x', content: 'hello world '.repeat(2000) }],
    query: 'hello', k: 2,
  }, {});
  assert.equal(result.status, 'ok');
  assert.equal(result.provenance.plugin, 'local-passage-retrieval');
  assert.ok(result.data.selections[0].excerpt.includes('hello'));
});

test('adapter.health 自检通过', async () => {
  const result = await adapter.health();
  assert.equal(result.status, 'ok');
});
