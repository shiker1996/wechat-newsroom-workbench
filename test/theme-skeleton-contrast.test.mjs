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
  assert.match(compiled.css,/\.skeleton-editorial-split:not\(\.page-cover\):not\(\.blocks-1\):not\(\.blocks-3\):not\(\.comp-cols-single\) \.page-content-stack\{display:grid/);
  assert.doesNotMatch(compiled.css,/\.skeleton-editorial-split \.page-content-stack\{display:grid/);
});

test('editorial-split 骨架服从管线单列决策：3 块与 comp-cols-single 页面不启用双栏',()=>{
  const html=renderStoryboardHtml({topic:'测试主题',repository:'example/repo',visualStyle:'solarized',contentType:'repository',channelMode:'xiaohongshu',compositionMode:'smart',pages:[
    {kind:'content',title:'三块页面',content_blocks:[{type:'steps',title:'步骤',items:[{title:'一',content:'x'}]},{type:'list',title:'清单',items:['a','b']},{type:'note',title:'提示',content:'z'}]},
    {kind:'content',title:'两块页面',content_blocks:[{type:'list',title:'清单一',items:['a','b']},{type:'list',title:'清单二',items:['c','d']}]},
  ]});
  const pages=[...html.matchAll(/<section class="([^"]*)"[^>]*data-page-number="(\d)"/g)];
  assert.match(pages[0][1],/blocks-3/);assert.match(pages[0][1],/comp-cols-single/);
  assert.match(pages[1][1],/blocks-2/);assert.doesNotMatch(pages[1][1],/comp-cols-single/);
  const css=html.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1]||'';
  const gridRule=css.match(/\.skeleton-editorial-split[^{]*\{display:grid[^}]*\}/)?.[0]||'';
  assert.ok(gridRule,'应存在 editorial-split 双栏规则');
  assert.match(gridRule,/:not\(\.blocks-3\)/);assert.match(gridRule,/:not\(\.comp-cols-single\)/);
});

test('表面配方的页面底色消费 page token，图文页背景可调',()=>{
  const ice=compileSocialTheme(socialThemeDefinition('ice-blue'));
  assert.match(ice.css,/\.page\{background:linear-gradient\(145deg,var\(--page\)/);
  assert.doesNotMatch(ice.css,/linear-gradient\(145deg,#f9fcff/);
  const neon=compileSocialTheme(socialThemeDefinition('neon'));
  assert.match(neon.css,/\.page\{background-color:var\(--page\)/);
  assert.doesNotMatch(neon.css,/\.page\{background-color:var\(--bg\)/);
  const brutalist=compileSocialTheme(socialThemeDefinition('brutalist'));
  assert.match(brutalist.css,/\.page\{background:color-mix\(in srgb,var\(--page\) 82%/);
  assert.doesNotMatch(brutalist.css,/\.page\{background:color-mix\(in srgb,var\(--surface\) 82%/);
  const grid=structuredClone(socialThemeDefinition('ice-blue'));delete grid.hash;delete grid.file;grid.social.effects.texture='grid';
  const gridCss=compileSocialTheme(grid).css;
  assert.ok(gridCss.includes('.page{background-color:var(--page);background-image:linear-gradient'),'grid 纹理不能把 .page 背景冲成透明');
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
