import { markdownToHtml } from '../llm/typeset-pipeline.mjs';
import { renderStoryboardHtml } from '../llm/social-card-pipeline.mjs';
import { compileArticleTheme } from './article-theme-compiler.mjs';
import { compileSocialTheme } from './social-theme-compiler.mjs';
import { validateThemeDefinition } from './theme-validator.mjs';

export const ARTICLE_THEME_SPECIMEN=`# 主题样稿：把复杂内容讲清楚

这是一段用于检查正文、行高与 **重点信息** 的固定导语。

## 核心判断

普通正文包含 [链接](https://example.com) 和 \`inline code\`。

> 好的主题服务于内容层级，而不是抢走注意力。

- **重点：** 第一条固定要点
- 第二条固定要点

| 指标 | 当前值 | 变化 |
| --- | --- | --- |
| 速度 | 2.4x | +18% |
| 成本 | ¥0.08 | -12% |

\`\`\`js
const theme = 'production-preview';
\`\`\`

---

## 下一步

收束段落用于检查章节间距和分隔样式。`;

export const SOCIAL_THEME_SPECIMEN={
  topic:'主题样稿：把复杂内容讲清楚',repository:'example/production-preview',contentType:'repository',sourceLabel:'固定主题样稿',channelMode:'xiaohongshu',layoutStyle:'auto',compositionMode:'template',
  pages:[
    {kind:'cover',title:'把复杂内容讲清楚',goal:'观察封面标题、眉题与装饰'},
    {kind:'content',title:'关键指标与判断',goal:'覆盖常用内容块',content_blocks:[
      {type:'stats',title:'关键数字',items:[{num:'2.4x',label:'速度'},{num:'-12%',label:'成本'}]},
      {type:'list',title:'核心要点',items:['第一条固定要点','第二条固定要点']},
      {type:'note',title:'提示',content:'用于观察强调面板、边框和正文对比度。'},
      {type:'code',title:'代码',content:"const theme = 'preview';"},
    ]},
    {kind:'ending',title:'下一步',goal:'观察结尾页反色与品牌区域'},
  ],
};

const selectors={
  article:{colors:'article',typography:'article',spacing:'article',shape:'blockquote,pre,table',surface:'blockquote,li,td',accentSecondary:'small,li::marker',line:'blockquote,pre,table,th,td,hr',inverseText:'h1,blockquote,th',codeBackground:'code,pre'},
  social:{colors:'.page',typography:'.page',spacing:'.page-inner,.page-content-stack',shape:'.page,.content-block,.code-block',surface:'.page',accentSecondary:'.eyebrow,.stat-row',line:'.page,.content-block,li',inverseText:'.page-ending,.page-ending *',codeBackground:'.code-block pre'},
};
const recipeSelectors={article:{frame:'article',kicker:'small',h1:'h1',h2:'h2',lead:'article>p:first-of-type',quote:'section',divider:'hr',list:'ul,ol',table:'table',image:'img'},social:{surface:'.page-content-stack',frame:'.page',decoration:'.page:after',eyebrow:'.eyebrow',ending:'.page-ending',list:'.page li',code:'.code-block pre'}};

function highlightSelector(target,field=''){
  if(!field)return '';
  const parts=field.split('.'),leaf=parts.at(-1),group=parts[1];
  if(parts.includes('recipes'))return recipeSelectors[target][leaf]||'';
  if(parts.includes('effects')||parts.includes('behavior'))return target==='social'?'.page':selectors.article.typography;
  return selectors[target][leaf]||selectors[target][group]||'';
}

function previewStyle(target,field){
  const selector=highlightSelector(target,field);
  const highlight=selector?`${selector}{outline:3px solid #E43D30!important;outline-offset:3px!important}`:'';
  return `<style data-theme-preview-shell>html{background:#d8d6cf}body{margin:0;padding:24px;box-sizing:border-box}${target==='article'?'body>article{max-width:720px;margin:auto;box-shadow:0 10px 30px rgba(0,0,0,.16)}':''}${highlight}</style>`;
}

export function compileThemePreview({target,definition,highlightField=''}){
  if(!['article','social'].includes(target))throw new Error('target 必须是 article 或 social');
  const clean=structuredClone(definition||{});delete clean.hash;delete clean.file;
  validateThemeDefinition(clean,{expectedTarget:target,expectedSource:clean.source||'user'});
  const compiled=target==='article'?compileArticleTheme(clean):compileSocialTheme(clean);
  const productionHtml=target==='article'
    ?markdownToHtml(ARTICLE_THEME_SPECIMEN,{themeDefinition:clean,kicker:'PRODUCTION SPECIMEN'})
    :renderStoryboardHtml({...SOCIAL_THEME_SPECIMEN,visualStyle:clean.id,themeDefinition:clean});
  const style=previewStyle(target,highlightField);
  const html=target==='article'
    ?`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${style}</head><body>${productionHtml}</body></html>`
    :productionHtml.replace('</head>',`${style}</head>`);
  return {schemaVersion:1,target,html,usageMap:compiled.usageMap,highlightField,theme:{id:compiled.id,label:compiled.label,version:compiled.version,hash:compiled.hash}};
}
