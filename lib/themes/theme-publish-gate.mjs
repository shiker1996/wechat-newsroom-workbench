import { colorContrast, ThemeValidationError, validateThemeDefinition } from './theme-validator.mjs';
import { compileThemePreview } from './theme-preview.mjs';
import { compileArticleTheme } from './article-theme-compiler.mjs';
import { compileSocialTheme } from './social-theme-compiler.mjs';

const TOKEN_FIELDS=['colors.background','colors.surface','colors.text','colors.muted','colors.accent','colors.accentSecondary','colors.line','colors.inverseText','colors.codeBackground','typography.family','typography.headingFamily','typography.bodyPx','typography.h1Px','typography.h2Px','typography.captionPx','typography.lineHeight','typography.letterSpacingEm','spacing.articlePaddingPx','spacing.sectionPx','spacing.paragraphPx','spacing.cardGapPx','shape.radiusPx','shape.borderWidthPx','shape.shadow'];
function issue(field,code,message,specimenNode=''){return {field,code,message,specimenNode};}
function cleanDefinition(input){const value=structuredClone(input||{});delete value.hash;delete value.file;return value;}

export function auditThemeForPublish(input,{target=input?.targets?.[0]||''}={}){
  const definition=cleanDefinition(input),issues=[];
  try{validateThemeDefinition(definition,{expectedTarget:target,expectedSource:'user'});}catch(error){issues.push(...(error.issues||[issue('theme','INVALID',error.message)]));return {valid:false,compatible:false,target,issues,checks:{schema:false,contrast:false,coverage:false,html:false,layout:false}};}
  const colors=definition.tokens.colors,contrasts=[
    ['tokens.colors.text',colors.text,colors.background,4.5,'article'],['tokens.colors.text',colors.text,colors.surface,4.5,'content surface'],['tokens.colors.muted',colors.muted,colors.background,3,'caption'],['tokens.colors.inverseText',colors.inverseText,colors.codeBackground,4.5,'code'],['tokens.colors.inverseText',colors.inverseText,colors.accent,3,'inverted component'],
  ];
  for(const [field,foreground,background,minimum,node] of contrasts)if(colorContrast(foreground,background)<minimum)issues.push(issue(field,'LOW_CONTRAST',`在 ${node} 样稿节点上的对比度必须至少为 ${minimum}:1`,node));
  let compiled,html='';
  try{compiled=target==='article'?compileArticleTheme(definition):compileSocialTheme(definition);html=compileThemePreview({target,definition}).html;}catch(error){issues.push(issue('theme','COMPILE_FAILED',error.message,'fixed specimen'));}
  if(compiled){for(const field of TOKEN_FIELDS)if(!compiled.usageMap?.[`tokens.${field}`])issues.push(issue(`tokens.${field}`,'UNCONSUMED','字段未被正式编译器消费','usageMap'));for(const key of Object.keys(definition[target].recipes||{}))if(compiled.recipes?.[key]===undefined)issues.push(issue(`${target}.recipes.${key}`,'UNCONSUMED','配方未被正式编译器消费',key));}
  if(html){
    const productionHtml=html.replace(/<style data-theme-preview-shell>[\s\S]*?<\/style>/i,'');
    if(/<script\b|\son[a-z]+\s*=|<iframe\b|javascript:/i.test(productionHtml))issues.push(issue('theme','UNSAFE_HTML','固定样稿包含脚本、事件属性或不安全嵌入','fixed specimen'));
    if(target==='article'&&(/<style\b/i.test(productionHtml)||/<div\b/i.test(productionHtml)))issues.push(issue('article','ILLEGAL_ARTICLE_HTML','公众号样稿包含 style 或 div','article root'));
    if(target==='article'&&!/<h1\b[\s\S]*<h2\b[\s\S]*<section\b[\s\S]*<table\b[\s\S]*<pre\b/.test(productionHtml))issues.push(issue('article','INCOMPLETE_SPECIMEN','文章样稿关键节点不完整','article root'));
    if(target==='social'){
      const pages=(html.match(/<section class="page /g)||[]).length,stacks=(html.match(/class="page-content-stack"/g)||[]).length;
      if(pages!==3||stacks!==3||!html.includes('width:375px;height:667px;overflow:hidden'))issues.push(issue('social','LAYOUT_STRUCTURE','图文样稿必须保持 3 页、每页一个内容栈及 375×667 固定画布','page grid'));
    }
  }
  const codes=new Set(issues.map((item)=>item.code));return {valid:issues.length===0,compatible:issues.length===0,target,issues,checks:{schema:true,contrast:!codes.has('LOW_CONTRAST'),coverage:!codes.has('UNCONSUMED')&&!codes.has('COMPILE_FAILED'),html:!codes.has('UNSAFE_HTML')&&!codes.has('ILLEGAL_ARTICLE_HTML')&&!codes.has('INCOMPLETE_SPECIMEN'),layout:!codes.has('LAYOUT_STRUCTURE')}};
}

export function assertThemePublishable(definition,options){const report=auditThemeForPublish(definition,options);if(!report.valid)throw new ThemeValidationError(report.issues);return report;}
