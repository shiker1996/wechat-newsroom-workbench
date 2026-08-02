import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSocialTheme, socialThemeDefinition } from '../lib/themes/social-theme-compiler.mjs';
import { renderStoryboardHtml } from '../lib/llm/social-card-pipeline.mjs';
import { articleThemeDefinition } from '../lib/themes/article-theme-compiler.mjs';
import { compileThemePreview } from '../lib/themes/theme-preview.mjs';
import { markdownToHtml } from '../lib/llm/typeset-pipeline.mjs';

function socialPreview(id){
  const definition=structuredClone(socialThemeDefinition(id));
  delete definition.hash;delete definition.file;
  return compileThemePreview({target:'social',definition}).html;
}

function articleHtml(id){
  const definition=structuredClone(articleThemeDefinition(id));
  delete definition.hash;delete definition.file;
  return markdownToHtml('# 标题\n\n正文包含 `inline code`。\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x=1;\n```',{themeDefinition:definition});
}

test('图文骨架类名作用于封面、内容页和结尾页',()=>{
  const html=socialPreview('bone-white');
  assert.equal((html.match(/class="page page-[a-z]+ skeleton-editorial-split/g)||[]).length,5);
  const terminal=socialPreview('neon');
  assert.equal((terminal.match(/class="page page-[a-z]+ skeleton-terminal-rail/g)||[]).length,5);
});

test('editorial-split 双栏构图只作用于非封面页，封面保持底部锚定',()=>{
  const compiled=compileSocialTheme(socialThemeDefinition('bone-white'));
  assert.match(compiled.css,/\.skeleton-editorial-split:not\(\.page-cover\) \.page-content-stack\{display:grid/);
  assert.doesNotMatch(compiled.css,/\.skeleton-editorial-split \.page-content-stack\{display:grid/);
});

test('浅色代码面板的文章主题代码文字回退为正文色',()=>{
  const html=articleHtml('research-report');
  assert.match(html,/<code style="[^"]*background:#F2F4F6;color:#1A1A1A/i);
  assert.doesNotMatch(html,/background:#F2F4F6;color:#FFFFFF/i);
});

test('深色终端主题的代码与深色表头使用正文色而非 inverseText',()=>{
  const html=articleHtml('tech-wire');
  assert.match(html,/<code style="[^"]*background:#161B22;color:#E6EDF3/i);
  assert.match(html,/<th[^>]*style="[^"]*background:#161B22;color:#E6EDF3/i);
  assert.doesNotMatch(html,/background:#161B22;color:#0D1117/i);
});

test('代码面板对比度正常时仍使用 inverseText',()=>{
  const html=articleHtml('gossip-card');
  assert.match(html,/<code style="[^"]*background:#[0-9A-F]{6};color:#FFFFFF/i);
});

test('封面已有内容块时不再叠加封面承载物，超长承载文本被截断',()=>{
  const base={topic:'测试主题',repository:'example/repo',visualStyle:'lavender',contentType:'repository',channelMode:'xiaohongshu'};
  const withBlocks=renderStoryboardHtml({...base,pages:[
    {kind:'cover',title:'封面标题',summary:'这段导语不应该出现在封面上',content_blocks:[{type:'text',title:'要点',content:'已有内容块'}]},
    {kind:'ending',title:'结束'},
  ]});
  assert.doesNotMatch(withBlocks,/class="cover-support cover-support-lead"/);
  const longText='这是一段非常非常长的封面导语，'.repeat(8);
  const withLongLead=renderStoryboardHtml({...base,pages:[
    {kind:'cover',title:'封面标题',summary:longText},
    {kind:'ending',title:'结束'},
  ]});
  const match=withLongLead.match(/cover-support-lead">([^<]+)</);
  assert.ok(match,'应渲染截断后的承载物');
  assert.ok(match[1].length<=60&&match[1].endsWith('…'));
});
