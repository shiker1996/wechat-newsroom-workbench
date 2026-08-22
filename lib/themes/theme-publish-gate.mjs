import { colorContrast, ThemeValidationError, validateThemeDefinition } from './theme-validator.mjs';
import { compileThemePreview, SOCIAL_THEME_SPECIMEN } from './theme-preview.mjs';
import { compileArticleTheme } from './article-theme-compiler.mjs';
import { compileSocialTheme } from './social-theme-compiler.mjs';
import { articleComponentDefaults, resolveArticleComponents, resolveSocialComponents, socialComponentDefaults } from './component-catalog.mjs';
import { enrichThemeIssues } from './theme-issue-suggestions.mjs';
import { COVER_TOKEN_USAGE } from './cover-theme-compiler.mjs';
import { mixHex } from './color-utils.mjs';
import { resolveSocialCardTemplateContext } from '../rendering/social-card-template-resolver.mjs';

function issue(field,code,message,specimenNode='',details=null){return {field,code,message,specimenNode,...(details?{details}:{})};}
function cleanDefinition(input){const value=structuredClone(input||{});delete value.hash;delete value.file;return value;}
function leafPaths(value,prefix=''){if(!value||typeof value!=='object'||Array.isArray(value))return prefix?[prefix]:[];return Object.entries(value).flatMap(([key,child])=>leafPaths(child,prefix?`${prefix}.${key}`:key));}
function socialContentBackground(definition){
  const colors=definition.tokens.colors,page=colors.page||colors.surface;
  // neon 配方把 91% surface 与透明色混合；合成到实际 page 后再做对比度门禁。
  return definition.social?.recipes?.surface==='neon'?mixHex(page,colors.surface,.91):colors.surface;
}
export function themeConfigLeafPaths(definition,target){return [...leafPaths(definition?.tokens,'tokens'),...(definition?.[target]?leafPaths(definition[target],target):[])];}
export function unconsumedThemeConfigFields(definition,target,usageMap={}){return themeConfigLeafPaths(definition,target).filter((field)=>!usageMap?.[field]?.length);}

export function auditThemeForPublish(input,{target=input?.targets?.[0]||''}={}){
  const definition=cleanDefinition(input),issues=[];
  try{validateThemeDefinition(definition,{expectedTarget:target,expectedSource:'user'});}catch(error){issues.push(...(error.issues||[issue('theme','INVALID',error.message)]));return {valid:false,compatible:false,target,issues:enrichThemeIssues(issues,definition),checks:{schema:false,contrast:false,coverage:false,html:false,layout:false}};}
  const legacySocial=target==='social'&&definition.source==='user'&&!definition.social?.templatePack?.id;
  if(legacySocial)issues.push(issue('social.templatePack','TEMPLATE_REQUIRED','历史 Social 主题未绑定模板包，只提供标准兼容预览；请复制为新主题后再选择模板并发布','template metadata'));
  // 封面的反白文字由编译器 pick() 动态落到达标的底上，不做 inverseText/codeBackground 硬门禁
  const colors=definition.tokens.colors,contentBackground=target==='social'?socialContentBackground(definition):colors.surface,contrasts=target==='cover'?[
    ['tokens.colors.text',colors.text,colors.page,4.5,'cover title'],['tokens.colors.muted',colors.muted,colors.page,3,'cover subtitle'],['tokens.colors.inverseText',colors.inverseText,colors.accent,3,'inverted component'],
  ]:[
    ['tokens.colors.text',colors.text,colors.background,4.5,'article'],['tokens.colors.text',colors.text,contentBackground,4.5,'content surface'],['tokens.colors.muted',colors.muted,colors.background,3,'caption'],...(target==='cover'?[]:[['tokens.colors.inverseText',colors.inverseText,colors.codeBackground,4.5,'code']]),['tokens.colors.inverseText',colors.inverseText,colors.accent,3,'inverted component'],
  ];
  for(const [field,foreground,background,minimum,node] of contrasts)if(colorContrast(foreground,background)<minimum)issues.push(issue(field,'LOW_CONTRAST',`在 ${node} 样稿节点上的对比度必须至少为 ${minimum}:1`,node,{foreground,background,minimum}));
  if(target==='social'&&definition.social?.components){
    const components=resolveSocialComponents(definition),defaults=socialComponentDefaults(definition.social.recipes),role=(name)=>colors[name],checks=[
      ['coverTitle',definition.social.recipes.coverTitle==='highlight-block'?colors.accent:contentBackground,3,'cover-title'],
      ['eyebrow',contentBackground,4.5,'eyebrow'],['lead',contentBackground,4.5,'lead'],
    ];
    for(const [component,background,minimum,node] of checks){const selected=components[component].colorRole;if(selected===defaults[component].colorRole)continue;const foreground=role(selected);if(colorContrast(foreground,background)<minimum){const hint=component==='coverTitle'&&definition.social.recipes.coverTitle==='highlight-block'?'；强调色块配方下标题文字落在强调色块上，建议把封面主标题文字颜色改为反色，或在组件细节中恢复配方推荐值':'';issues.push(issue(`social.components.${component}.colorRole`,'LOW_COMPONENT_CONTRAST',`${node} 文字与实际表面对比度必须至少为 ${minimum}:1${hint}`,node,{foreground,background,minimum}));}}
    const surface=(selected,fallback=contentBackground)=>selected==='inherit'||selected==='transparent'?fallback:colors[selected];
    const componentChecks=[
      ['statValue','colorRole',contentBackground,3,'stat-value'],['statLabel','colorRole',contentBackground,4.5,'stat-label'],
      ['step','titleColorRole',contentBackground,4.5,'step-title'],['step','bodyColorRole',contentBackground,4.5,'step-body'],
      ['compareTable','headerTextColorRole',surface(components.compareTable.headerSurfaceRole,colors.accent),4.5,'compare-header'],['compareTable','bodyTextColorRole',contentBackground,4.5,'compare-body'],
      ['list','textColorRole',surface(components.list.surfaceRole),4.5,'list'],['note','textColorRole',surface(components.note.surfaceRole),4.5,'note'],
      ['contentTitle','colorRole',contentBackground,4.5,'content-title'],['endingTitle','colorRole',definition.social.recipes.surface==='base'||definition.social.recipes.ending==='dark-fill'?colors.codeBackground:colors.accent,3,'ending-title'],
    ];
    for(const [component,key,background,minimum,node] of componentChecks){const selected=components[component][key];if(selected===defaults[component][key]&&Object.entries(components[component]).every(([name,value])=>value===defaults[component][name]))continue;if(colorContrast(role(selected),background)<minimum)issues.push(issue(`social.components.${component}.${key}`,'LOW_COMPONENT_CONTRAST',`${node} 文字与实际表面对比度必须至少为 ${minimum}:1`,node,{foreground:role(selected),background,minimum}));}
  }
  if(target==='article'&&definition.article?.components){const components=resolveArticleComponents(definition),defaults=articleComponentDefaults(definition.article.recipes),role=(name)=>colors[name],surface=(selected,fallback=colors.surface)=>selected==='inherit'||selected==='transparent'?fallback:colors[selected],checks=[['title','colorRole',colors.background,4.5,'h1'],['lead','colorRole',colors.background,4.5,'lead'],['quote','textColorRole',surface(components.quote.surfaceRole),4.5,'blockquote'],['list','textColorRole',colors.background,4.5,'list'],['table','headerTextColorRole',surface(components.table.headerSurfaceRole,colors.surface),4.5,'table'],['code','textColorRole',surface(components.code.surfaceRole,colors.codeBackground),4.5,'code'],['imageCaption','colorRole',colors.background,3,'caption']];for(const [component,key,background,minimum,node] of checks){if(components[component][key]===defaults[component][key]&&Object.entries(components[component]).every(([name,value])=>value===defaults[component][name]))continue;if(colorContrast(role(components[component][key]),background)<minimum)issues.push(issue(`article.components.${component}.${key}`,'LOW_COMPONENT_CONTRAST',`${node} 文字与实际表面对比度必须至少为 ${minimum}:1`,node,{foreground:role(components[component][key]),background,minimum}));}}
  let compiled,html='';
  if(target==='cover'){
    try{html=compileThemePreview({target,definition}).html;}catch(error){issues.push(issue('theme','COMPILE_FAILED',error.message,'fixed cover specimen'));}
    for(const field of unconsumedThemeConfigFields(definition,target,COVER_TOKEN_USAGE))issues.push(issue(field,'UNCONSUMED','字段未被正式编译器消费','usageMap'));
  }else{
    try{compiled=target==='article'?compileArticleTheme(definition):compileSocialTheme(definition);html=compileThemePreview({target,definition}).html;}catch(error){issues.push(issue('theme','COMPILE_FAILED',error.message,'fixed specimen'));}
  }
  if(compiled)for(const field of unconsumedThemeConfigFields(definition,target,compiled.usageMap))issues.push(issue(field,'UNCONSUMED','字段未被正式编译器消费','usageMap'));
  if(html){
    const productionHtml=html.replace(/<style data-theme-preview-shell>[\s\S]*?<\/style>/i,'');
    if(/<script\b|\son[a-z]+\s*=|<iframe\b|javascript:/i.test(productionHtml))issues.push(issue('theme','UNSAFE_HTML','固定样稿包含脚本、事件属性或不安全嵌入','fixed specimen'));
    if(target==='cover'&&!/width:900px;height:383px/.test(productionHtml))issues.push(issue('cover','LAYOUT_STRUCTURE','封面样稿必须保持 900×383 固定画布','cover canvas'));
    if(target==='article'&&(/<style\b/i.test(productionHtml)||/<div\b/i.test(productionHtml)))issues.push(issue('article','ILLEGAL_ARTICLE_HTML','公众号样稿包含 style 或 div','article root'));
    if(target==='article'&&!/<h1\b[\s\S]*<h2\b[\s\S]*<section\b[\s\S]*<table\b[\s\S]*<pre\b[\s\S]*<img\b/.test(productionHtml))issues.push(issue('article','INCOMPLETE_SPECIMEN','文章样稿关键节点不完整','article root'));
    if(target==='social'){
      const pages=(html.match(/<section class="page /g)||[]).length,stacks=(html.match(/class="page-content-stack"/g)||[]).length;
      const expectedPages=SOCIAL_THEME_SPECIMEN.pages.length;
      if(pages!==expectedPages||stacks!==expectedPages||!html.includes('width:375px;height:667px;overflow:hidden'))issues.push(issue('social','LAYOUT_STRUCTURE',`图文样稿必须保持 ${expectedPages} 页、每页一个内容栈及 375×667 固定画布`,'page grid'));
      const templateContext=resolveSocialCardTemplateContext({themeDefinition:definition,channelMode:'xiaohongshu',contentType:'repository'});
      if(!html.includes(`data-template-pack="${templateContext.pack.id}"`)|| (html.match(/data-template-id="[^"]+"/g)||[]).length!==expectedPages){
        issues.push(issue('social.templatePack','TEMPLATE_RENDERER_MISSING','固定样稿未记录完整的模板包与逐页模板信息','template metadata'));
      }
    }
  }
  const codes=new Set(issues.map((item)=>item.code));return {valid:issues.length===0,compatible:issues.length===0,target,legacy:legacySocial,issues:enrichThemeIssues(issues,definition),checks:{schema:true,contrast:!codes.has('LOW_CONTRAST'),coverage:!codes.has('UNCONSUMED')&&!codes.has('COMPILE_FAILED'),html:!codes.has('UNSAFE_HTML')&&!codes.has('ILLEGAL_ARTICLE_HTML')&&!codes.has('INCOMPLETE_SPECIMEN'),layout:!codes.has('LAYOUT_STRUCTURE')&&!codes.has('TEMPLATE_RENDERER_MISSING')}};
}

export function assertThemePublishable(definition,options){const report=auditThemeForPublish(definition,options);if(!report.valid)throw new ThemeValidationError(report.issues);return report;}
