import { markdownToHtml } from '../../../features/articles/index.mjs';
import { renderStoryboardHtml } from '../../../features/social-cards/index.mjs';
import { compileArticleTheme } from '../../../shared/themes/article-theme-compiler.mjs';
import { compileSocialTheme } from '../../../shared/themes/social-theme-compiler.mjs';
import { buildCoverHtml } from '../../../shared/themes/cover-theme-compiler.mjs';
import { coverSpecFromTheme } from '../../../shared/themes/cover-components.mjs';
import { validateThemeDefinition } from '../../../shared/themes/theme-validator.mjs';
import { getSocialCardTemplateCapabilities, resolveSocialCardTemplateContext } from '../../../shared/rendering/social-card-template-resolver.mjs';

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

![固定样稿图片说明](https://example.com/theme-specimen.png)

---

## 下一步

收束段落用于检查章节间距和分隔样式。`;

export const SOCIAL_THEME_SPECIMEN={
  topic:'主题样稿：把复杂内容讲清楚',repository:'example/production-preview',contentType:'repository',sourceLabel:'固定主题样稿',channelMode:'xiaohongshu',layoutStyle:'auto',compositionMode:'template',
  pages:[
    {kind:'cover',title:'如何把复杂的技术内容讲得清楚又准确',goal:'观察长封面标题、眉题与装饰'},
    {kind:'content',title:'关键指标与判断',goal:'覆盖常用内容块',content_blocks:[
      {type:'stats',title:'关键数字',items:[{num:'2.4x',label:'速度'},{num:'-12%',label:'成本'}]},
      {type:'list',title:'核心要点',items:['第一条固定要点','第二条固定要点']},
      {type:'note',title:'提示',content:'用于观察强调面板、边框和正文对比度。'},
      {type:'code',title:'代码',content:"const theme = 'preview';"},
    ]},
    {kind:'content',title:'三步完成主题配置',goal:'覆盖步骤标题、正文与序号',content_blocks:[
      {type:'steps',title:'执行步骤',items:[{title:'选择配方',content:'先确定整体造型与内容节奏。'},{title:'调整细节',content:'再微调文字、表面和边框。'},{title:'检查样稿',content:'最后确认固定画布没有溢出。'}]},
      {type:'list',title:'检查清单',items:['配方与骨架符合主题定位','对比度与密度均在预算内']},
      {type:'note',title:'提示',content:'步骤块用于观察序号、标题与正文的层级。'},
    ]},
    {kind:'content',title:'方案前后对比',goal:'覆盖对比表头、正文与边线',content_blocks:[
      {type:'compare',title:'关键差异',headers:['维度','调整前','调整后'],rows:[['控制范围','固定样式','组件级'],['AI 空间','较窄','可组合']]},
      {type:'list',title:'适用场景',items:['固定样稿对比','主题发布前检查']},
      {type:'note',title:'备注',content:'对比块用于观察表头、边框与行高。'},
    ]},
    {kind:'ending',title:'下一步',goal:'观察结尾页反色与品牌区域',content_blocks:[
      {type:'list',title:'行动提示',items:['收藏本主题样稿','在编辑器中切换配方对比']},
      {type:'note',title:'品牌区',content:'example/production-preview · 固定主题样稿'},
    ]},
  ],
};
SOCIAL_THEME_SPECIMEN.pages[0].lead='用一页讲清关键判断，再决定是否深入细节。';

// 封面固定样稿：覆盖全部组件种类（画布+色块+标签+标题高亮+副标题+信息行+装饰）
export const COVER_THEME_SPECIMEN={components:[
  {type:'canvas',colorRole:'page'},
  {type:'color-block',position:'left-third',shape:'rect',colorRole:'accent'},
  {type:'eyebrow',form:'badge',text:'主题样稿'},
  {type:'title',lines:['把复杂内容','讲得清楚'],highlights:['清楚'],align:'left'},
  {type:'subtitle',text:'固定封面样稿，用于检查配色与字阶',withBar:true},
  {type:'meta',text:'example · 2026.08'},
  {type:'decoration',kind:'dots',position:'bottom-right'},
]};

const selectors={
  article:{colors:'article',typography:'article',spacing:'article',shape:'blockquote,pre,table',surface:'blockquote,li,td',accentSecondary:'small,li::marker',line:'blockquote,pre,table,th,td,hr',inverseText:'h1,blockquote,th',codeBackground:'code,pre'},
  social:{colors:'.page',typography:'.page',spacing:'.page-inner,.page-content-stack',shape:'.page,.content-block,.code-block',surface:'.page',accentSecondary:'.eyebrow,.stat-row',line:'.page,.content-block,li',inverseText:'.page-ending,.page-ending *',codeBackground:'.code-block pre'},
  cover:{colors:'.cover',typography:'.cover-title',spacing:'.cover-main',shape:'.eyebrow-badge',page:'.cover',text:'.cover-title',muted:'.cover-subtitle',accent:'.cover-block,.cover-deco',accentSecondary:'.cover-eyebrow',inverseText:'.eyebrow-badge',codeBackground:'.cover-block',titlePx:'.cover-title',titleLineHeight:'.cover-title',eyebrowPx:'.cover-eyebrow',subtitlePx:'.cover-subtitle',metaPx:'.cover-meta',metaBottomPx:'.cover-meta',badgeRadiusPx:'.eyebrow-badge'},
};
const recipeSelectors={article:{frame:'article',rhythm:'article',kicker:'small',h1:'h1',h2:'h2',lead:'article>p:first-of-type',quote:'section',divider:'hr',list:'ul,ol',table:'table',image:'img'},social:{surface:'.page-content-stack',frame:'.page',decoration:'.page:after',eyebrow:'.eyebrow',coverTitle:'.page-cover h1',skeleton:'.page',coverSupport:'.page-cover .cover-support',ending:'.page-ending',list:'.page li',code:'.code-block pre'}};
const componentSelectors={article:{title:'h1',lead:'article>p:first-of-type',quote:'blockquote,section',list:'ul,ol',table:'table',code:'code,pre',imageCaption:'img+small'},social:{coverTitle:'.page-cover h1',eyebrow:'.eyebrow',lead:'.page-cover .lead',statValue:'.stat b',statLabel:'.stat span',step:'.step',compareTable:'.compare-block table',list:'.page li',note:'.note-block',contentTitle:'.page:not(.page-cover):not(.page-ending) h1',endingTitle:'.page-ending h1'}};

function highlightSelector(target,field=''){
  if(!field)return '';
  const parts=field.split('.'),leaf=parts.at(-1),group=parts[1];
  if(parts.includes('recipes'))return recipeSelectors[target]?.[leaf]||'';
  if(parts.includes('components'))return componentSelectors[target]?.[parts[2]]||'';
  if(parts.includes('effects')||parts.includes('behavior'))return target==='social'?'.page':selectors.article.typography;
  return selectors[target]?.[leaf]||selectors[target]?.[group]||'';
}

function previewStyle(target,field){
  const selector=highlightSelector(target,field);
  const highlight=selector?`${selector}{outline:3px solid #E43D30!important;outline-offset:3px!important}`:'';
  return `<style data-theme-preview-shell>html{background:#d8d6cf}body{margin:0;padding:24px;box-sizing:border-box}${target==='article'?'body>article{max-width:720px;margin:auto;box-shadow:0 10px 30px rgba(0,0,0,.16)}':''}${highlight}</style>`;
}

export function compileThemePreview({target,definition,highlightField=''}){
  if(!['article','social','cover'].includes(target))throw new Error('target 必须是 article、social 或 cover');
  const clean=structuredClone(definition||{});delete clean.hash;delete clean.file;
  validateThemeDefinition(clean,{expectedTarget:target,expectedSource:clean.source||'user'});
  if(target==='cover'){
    // 主题带内置构图时按构图预览（样稿文案填充），否则用固定样稿构图
    const themed=clean.cover?.spec?coverSpecFromTheme(clean.cover.spec,{title:'把复杂内容讲得清楚',subtitle:'固定封面样稿，用于检查配色与字阶',brand:'example · 2026.08',theme:clean}):null;
    const {html:coverHtml}=buildCoverHtml({theme:clean,spec:themed||COVER_THEME_SPECIMEN});
    const style=previewStyle(target,highlightField);
    return {schemaVersion:1,target,html:coverHtml.replace('</head>',`${style}</head>`),usageMap:{},highlightField,theme:{id:clean.id,label:clean.label,version:clean.version}};
  }
  const compiled=target==='article'?compileArticleTheme(clean):compileSocialTheme(clean);
  const productionHtml=target==='article'
    ?markdownToHtml(ARTICLE_THEME_SPECIMEN,{themeDefinition:clean,kicker:'PRODUCTION SPECIMEN'})
    :renderStoryboardHtml({...SOCIAL_THEME_SPECIMEN,visualStyle:clean.id,themeDefinition:clean});
  const style=previewStyle(target,highlightField);
  // 文章和图文生产渲染器都已经返回完整 HTML 文档，不能再把它嵌套到另一层 body 中。
  const html=productionHtml.replace('</head>',`${style}</head>`);
  const templateContext=target==='social'?resolveSocialCardTemplateContext({themeDefinition:clean,channelMode:clean.channelMode||'xiaohongshu'}):null;
  return {schemaVersion:1,target,html,usageMap:compiled.usageMap,highlightField,theme:{id:compiled.id,label:compiled.label,version:compiled.version,hash:compiled.hash},template:templateContext?{...getSocialCardTemplateCapabilities({themeDefinition:clean,channelMode:'xiaohongshu'}),pack:templateContext.pack.id,version:templateContext.pack.version,label:templateContext.pack.label,source:templateContext.source,compatibility:templateContext.pack.id==='standard-v1'||templateContext.fallback,roleTemplates:{...templateContext.pack.roleTemplates},matching:clean.social?.templateMatch||null}:null};
}
