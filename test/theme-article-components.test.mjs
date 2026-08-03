import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ARTICLE_COMPONENT_CATALOG, articleComponentDefaults, resolveArticleComponents } from '../lib/themes/component-catalog.mjs';
import { articleThemeDefinition, compileArticleTheme } from '../lib/themes/article-theme-compiler.mjs';
import { normalizeAiThemeCandidate, buildAiThemeMessages } from '../lib/themes/ai-theme-generator.mjs';
import { markdownToHtml } from '../lib/llm/typeset-pipeline.mjs';
import { compileThemePreview } from '../lib/themes/theme-preview.mjs';
import { auditThemeForPublish } from '../lib/themes/theme-publish-gate.mjs';
import { validateThemeDefinition } from '../lib/themes/theme-validator.mjs';

function articleTheme(){const value=structuredClone(articleThemeDefinition('magazine-warm'));delete value.hash;delete value.file;value.id='article-components';value.source='user';value.status='draft';value.article.components=articleComponentDefaults(value.article.recipes);return value;}

test('P4 文章组件目录覆盖标题、导语、引用、列表、表格、代码和图片说明',()=>{
  assert.deepEqual(Object.keys(ARTICLE_COMPONENT_CATALOG),['title','lead','quote','list','table','code','imageCaption']);
  const value=articleTheme();assert.doesNotThrow(()=>validateThemeDefinition(value,{expectedTarget:'article'}));
  const schema=JSON.parse(fs.readFileSync(new URL('../themes/schema/theme.schema.json',import.meta.url),'utf8'));assert.deepEqual(Object.keys(schema.properties.article.properties.components.properties),Object.keys(ARTICLE_COMPONENT_CATALOG));
});

test('P4 文章组件属性进入正式编译器和公众号内联 HTML',()=>{
  const value=articleTheme();Object.assign(value.article.components,{title:{fontFamily:'mono',sizeScale:'display',colorRole:'accent'},lead:{sizeScale:'compact',colorRole:'muted'},quote:{textColorRole:'inverseText',surfaceRole:'codeBackground',borderColorRole:'accentSecondary'},list:{textColorRole:'accent',markerColorRole:'accentSecondary'},table:{headerTextColorRole:'inverseText',headerSurfaceRole:'codeBackground',borderColorRole:'accent'},code:{textColorRole:'accentSecondary',surfaceRole:'codeBackground'},imageCaption:{sizeScale:'display',colorRole:'muted'}});
  const compiled=compileArticleTheme(value);for(const [component,fields] of Object.entries(value.article.components))for(const key of Object.keys(fields))assert.ok(compiled.usageMap[`article.components.${component}.${key}`]?.length,`${component}.${key}`);
  const html=markdownToHtml('# 标题\n\n导语。\n\n> 引用\n\n- 列表\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x=1;\n```\n\n![图注](https://example.com/a.png)',{themeDefinition:value});
  assert.match(html,/font-family:Consolas[^>]*font-size:33px[^>]*color:#76533B/i);assert.match(html,/color:#FFFFFF[^>]*background:#241D18/i);assert.match(html,/<small style="[^"]*font-size:14px[^>]*>图注<\/small>/);
});

test('P4 AI、正式预览和发布门禁识别文章组件属性',()=>{
  const base=articleThemeDefinition('magazine-warm'),candidate={label:'文章组件主题',description:'验证文章组件安全枚举',tags:['test'],tokens:structuredClone(base.tokens),targetConfig:structuredClone(base.article),designSummary:[{title:'组件细节',description:'文章组件白名单'}]};candidate.targetConfig.components={title:{fontFamily:'url(x)',sizeScale:'huge',colorRole:'inverseText'}};
  const normalized=normalizeAiThemeCandidate(candidate,{target:'article'}).candidate.targetConfig.components;assert.deepEqual(Object.keys(normalized),Object.keys(ARTICLE_COMPONENT_CATALOG));assert.equal(normalized.title.fontFamily,'inherit');
  assert.match(buildAiThemeMessages({target:'article',prompt:'创建一套结构清晰且引用与代码层次明确的文章主题',preferences:{}})[0].content,/文章主标题/);
  const value=articleTheme(),preview=compileThemePreview({target:'article',definition:value,highlightField:'article.components.quote.surfaceRole'}).html;assert.match(preview,/blockquote,section\{outline:3px solid/);
  value.article.components.title.colorRole='inverseText';const report=auditThemeForPublish(value,{target:'article'});assert.ok(report.issues.some((item)=>item.field==='article.components.title.colorRole'&&item.code==='LOW_COMPONENT_CONTRAST'));
});

test('P4 旧文章主题缺少 components 时保持原渲染且不显示图片说明',()=>{
  const legacy=structuredClone(articleThemeDefinition('magazine-warm'));delete legacy.hash;delete legacy.file;delete legacy.article.components;assert.doesNotThrow(()=>validateThemeDefinition(legacy,{expectedTarget:'article'}));assert.equal(resolveArticleComponents(legacy).title.colorRole,'text');const html=markdownToHtml('![仅替代文本](https://example.com/a.png)',{themeDefinition:legacy});assert.doesNotMatch(html,/<small/);
});
