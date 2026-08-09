import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tutorialVisibleChars } from '../lib/llm/tutorial-pipeline.mjs';

test('教程字数统计忽略标题和链接URL',()=>{
  assert.equal(tutorialVisibleChars('# 教程\n\n[文档](https://example.com)\n正文'),4);
});

test('教程管线使用独立技能并保存标准文章终稿',()=>{
  const source=fs.readFileSync(new URL('../lib/llm/tutorial-pipeline.mjs',import.meta.url),'utf8');
  assert.match(source,/wechat-mp-tutorial/);
  for(const skill of ['title-generator','humanizer-zh','article-reviewer','seo-content-optimizer']){
    assert.match(source,new RegExp(skill));
  }
  for(const artifact of ['03-titles.md','05-humanized.md','06-reviewed.md','08-seo-optimized.md']){
    assert.match(source,new RegExp(artifact.replace('.','\\.')));
  }
  assert.match(source,/kind:'final'/);
  assert.match(source,/09-FINAL\.md/);
});

test('教程入口创建标准文章候选并启动独立任务',()=>{
  const source=fs.readFileSync(new URL('../lib/http/routes/candidate-routes.mjs',import.meta.url),'utf8');
  assert.match(source,/custom-articles\|tutorials/);
  assert.match(source,/tracks: \['article'\]/);
  assert.match(source,/type: 'tutorial'/);
  assert.match(source,/tutorial-chat\\\/stream/);
  assert.match(source,/readLocalProject/);
  assert.match(source,/wechat-experience/);
});

test('自主写作管线按模式选择心得经验或教程技能',()=>{
  const source=fs.readFileSync(new URL('../lib/llm/tutorial-pipeline.mjs',import.meta.url),'utf8');
  assert.match(source,/wechat-mp-personal-writing/);
  assert.match(source,/wechat-mp-tutorial/);
});
