import test from 'node:test';
import assert from 'node:assert/strict';
import { insertVisualFences } from '../server/features/articles/llm/visual-planner.mjs';
import { illustrateArticle } from '../server/features/articles/application/article-illustration.mjs';

test('insertVisualFences inserts fence at end of the matching section', () => {
  const markdown = '# 标题\n\n## 流程\n\n第一段。\n\n第二段。\n\n## 数据\n\n数据正文。\n';
  const output = insertVisualFences(markdown, [
    { afterHeading:'流程', fence:'```mermaid\nflowchart TB\nA --> B\n```' },
  ]);
  assert.ok(output.includes('第二段。\n\n```mermaid'));
  assert.ok(output.includes('```\n\n## 数据'));
  // 重复插入同一围栏幂等
  assert.equal(insertVisualFences(output, [{ afterHeading:'流程', fence:'```mermaid\nflowchart TB\nA --> B\n```' }]), output);
  // 找不到章节时保持原文
  assert.equal(insertVisualFences(markdown, [{ afterHeading:'不存在', fence:'```mermaid\nflowchart TB\nA --> B\n```' }]), markdown);
});

test('illustrateArticle runs visual planning before manual image placeholders', async () => {
  const purposes = [];
  const gateway = { complete: async (input) => {
    purposes.push(input.purpose);
    if (input.purpose === 'article-visual-plan') {
      return { content: JSON.stringify({ summary:'加一张流程图', placements:[
        { type:'mermaid', afterHeading:'流程', purpose:'流程关系', code:'flowchart TB\nA[开始] --> B[结束]' },
      ] }) };
    }
    return { content: JSON.stringify({ placements:[
      { type:'资料', content:'后台截图', anchor:'第二段', suggestedSource:'作者提供', copyrightAction:'确认授权' },
    ] }) };
  } };
  const store = { updateModelCall() {} };
  const markdown = '# 标题\n\n## 流程\n\n第一段。\n\n第二段。\n';
  const result = await illustrateArticle({
    gateway, store, provider:'test', batchId:'b', candidateId:1, markdown, factBase:'facts',
  });
  assert.deepEqual(purposes, ['article-visual-plan', 'article-image-plan']);
  assert.ok(result.markdown.includes('```mermaid'));
  assert.ok(result.markdown.includes('IMG:') || result.markdown.includes('IMAGE'));
  assert.equal(result.visualPlan.placements.length, 1);
});

test('illustrateArticle continues with image placeholders when visual planning fails', async () => {
  const gateway = { complete: async (input) => {
    if (input.purpose === 'article-visual-plan') return { content:'不是 JSON' };
    return { content: JSON.stringify({ placements:[] }) };
  } };
  const store = { updateModelCall() {} };
  const warnings = [];
  const result = await illustrateArticle({
    gateway, store, provider:'test', batchId:'b', candidateId:1,
    markdown:'# 标题\n\n正文。\n', factBase:'', onProgress:(m)=>warnings.push(m),
  });
  assert.ok(warnings.some((m)=>/跳过该环节/.test(m)));
  assert.ok(result.markdown.includes('IMAGE-PLAN:none'));
});
