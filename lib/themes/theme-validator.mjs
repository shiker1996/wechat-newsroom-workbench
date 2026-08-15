import { THEME_RECIPE_CATALOG } from './recipe-catalog.mjs';
import { SOCIAL_DENSITY_MAX_HIGH_VALUES, socialDensityHighFields, themeNumericLimits } from './theme-numeric-limits.mjs';
import { ARTICLE_COMPONENT_CATALOG, SOCIAL_COMPONENT_CATALOG } from './component-catalog.mjs';
import { validateCoverThemeSpec } from './cover-components.mjs';
import { colorContrast } from './color-utils.mjs';
export { colorContrast } from './color-utils.mjs';

const TOP_FIELDS=new Set(['schemaVersion','id','label','version','description','targets','status','source','basedOn','tags','tokens','article','social','cover']);
// 可选 token：page（仅图文背景）、codePx（代码块字号，缺省回退 captionPx）——存在时校验，缺失不报错
const OPTIONAL_TOKEN_KEYS=new Set(['page','codePx']);
const TOKEN_FIELDS={colors:new Set(['background','surface','page','text','muted','accent','accentSecondary','line','inverseText','codeBackground']),typography:new Set(['family','headingFamily','bodyPx','h1Px','h2Px','captionPx','codePx','lineHeight','letterSpacingEm']),spacing:new Set(['articlePaddingPx','sectionPx','paragraphPx','cardGapPx']),shape:new Set(['radiusPx','borderWidthPx','shadow'])};
// 封面主题的 token 面向 900×383 固定画布构图：画布底色、标题/眉题/副标题/信息行字阶、内容区留白与 badge 圆角
const COVER_TOKEN_FIELDS={colors:new Set(['page','text','muted','accent','accentSecondary','inverseText','codeBackground']),typography:new Set(['family','headingFamily','titlePx','titleLineHeight','eyebrowPx','subtitlePx','metaPx']),spacing:new Set(['paddingXPx','paddingYPx','gapPx','metaBottomPx']),shape:new Set(['badgeRadiusPx'])};
const TARGETS=new Set(['article','social','cover']), STATUSES=new Set(['draft','published','disabled','archived']), SOURCES=new Set(['builtin','user']);
const FONTS=new Set(['sans','serif','mono']), SHADOWS=new Set(['none','soft','hard','glow']);
const HEX=/^#[0-9a-f]{6}$/i, ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/, VERSION=/^\d+\.\d+\.\d+$/;
const COMPATIBLE_OPTIONAL_RECIPES=Object.freeze({article:new Set(['rhythm']),social:new Set(['coverTitle','skeleton','coverSupport'])});

export class ThemeValidationError extends Error {
  constructor(issues, filePath=''){super(`主题定义无效${filePath?`（${filePath}）`:''}：${issues.map((item)=>`${item.field} ${item.message}`).join('；')}`);this.name='ThemeValidationError';this.code='THEME_INVALID';this.issues=issues;this.filePath=filePath;}
}

function unknown(input, allowed, field, issues){for(const key of Object.keys(input||{}))if(!allowed.has(key))issues.push({field:`${field}.${key}`,code:'UNKNOWN_FIELD',message:'未知字段'});}
function numberIn(value,min,max,field,issues,step=null){
  if(!Number.isFinite(value)||value<min||value>max){issues.push({field,code:'OUT_OF_RANGE',message:`必须是 ${min}–${max} 之间的有限数值`});return;}
  if(step&&Math.abs((value-min)/step-Math.round((value-min)/step))>1e-8)issues.push({field,code:'STEP_MISMATCH',message:`必须按 ${step} 的步长递增`});
}
export function validateThemeDefinition(input,{filePath='',expectedTarget=null,expectedSource=null,enforceNumericSteps=false}={}){
  const issues=[];
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ThemeValidationError([{field:'theme',code:'TYPE',message:'必须是对象'}],filePath);
  unknown(input,TOP_FIELDS,'theme',issues);
  if(input.schemaVersion!==1)issues.push({field:'schemaVersion',code:'UNSUPPORTED_SCHEMA',message:'必须为 1'});
  if(!ID.test(input.id||'')||(input.id||'').length>64)issues.push({field:'id',code:'FORMAT',message:'必须是小写连字符 ID，且不超过 64 字符'});
  if(typeof input.label!=='string'||!input.label.trim()||[...input.label].length>30)issues.push({field:'label',code:'LENGTH',message:'必须为 1–30 个字符'});
  if(!VERSION.test(input.version||''))issues.push({field:'version',code:'FORMAT',message:'必须使用 SemVer x.y.z'});
  if(typeof input.description!=='string'||!input.description.trim()||[...input.description].length>160)issues.push({field:'description',code:'LENGTH',message:'必须为 1–160 个字符'});
  if(!Array.isArray(input.targets)||!input.targets.length||new Set(input.targets).size!==input.targets.length||input.targets.some((v)=>!TARGETS.has(v)))issues.push({field:'targets',code:'ENUM',message:'必须是不重复的 article/social/cover 数组'});
  if(expectedTarget&&!input.targets?.includes(expectedTarget))issues.push({field:'targets',code:'TARGET_MISMATCH',message:`目录要求包含 ${expectedTarget}`});
  if(!STATUSES.has(input.status))issues.push({field:'status',code:'ENUM',message:'状态不受支持'});
  if(!SOURCES.has(input.source))issues.push({field:'source',code:'ENUM',message:'来源不受支持'});
  if(expectedSource&&input.source!==expectedSource)issues.push({field:'source',code:'SOURCE_MISMATCH',message:`必须为 ${expectedSource}`});
  if(input.basedOn!==null&&(!input.basedOn||typeof input.basedOn!=='object'||Array.isArray(input.basedOn)))issues.push({field:'basedOn',code:'TYPE',message:'必须为 null 或对象'});
  if(!Array.isArray(input.tags)||input.tags.length>12||new Set(input.tags).size!==input.tags.length||input.tags.some((v)=>typeof v!=='string'||!v.trim()||[...v].length>24))issues.push({field:'tags',code:'FORMAT',message:'必须是不重复的短字符串数组，最多 12 项'});
  const tokens=input.tokens;
  if(!tokens||typeof tokens!=='object'||Array.isArray(tokens))issues.push({field:'tokens',code:'TYPE',message:'必须是对象'});
  else {
    unknown(tokens,new Set(['colors','typography','spacing','shape']),'tokens',issues);
    const isCover=input.targets?.includes('cover'),tokenFields=isCover?COVER_TOKEN_FIELDS:TOKEN_FIELDS;
    for(const [group,fields] of Object.entries(tokenFields)){
      const value=tokens[group];
      if(!value||typeof value!=='object'||Array.isArray(value)){issues.push({field:`tokens.${group}`,code:'TYPE',message:'必须是对象'});continue;}
      unknown(value,fields,`tokens.${group}`,issues);
      for(const key of fields)if((isCover||!OPTIONAL_TOKEN_KEYS.has(key))&&value[key]===undefined)issues.push({field:`tokens.${group}.${key}`,code:'REQUIRED',message:'不能为空'});
    }
    for(const [key,value] of Object.entries(tokens.colors||{}))if(!HEX.test(value||''))issues.push({field:`tokens.colors.${key}`,code:'FORMAT',message:'必须是六位十六进制颜色'});
    // 封面标题文字落在画布底色上；文章/图文正文落在背景上
    const baseSurface=isCover?tokens.colors?.page:tokens.colors?.background;
    if(HEX.test(tokens.colors?.text||'')&&HEX.test(baseSurface||'')&&colorContrast(tokens.colors.text,baseSurface)<4.5)issues.push({field:'tokens.colors.text',code:'LOW_CONTRAST',message:`${isCover?'标题文字与画布':'正文与背景'}对比度必须至少为 4.5:1`,details:{foreground:tokens.colors.text,background:baseSurface,minimum:4.5}});
    if(!FONTS.has(tokens.typography?.family))issues.push({field:'tokens.typography.family',code:'ENUM',message:'字体角色不受支持'});
    if(!FONTS.has(tokens.typography?.headingFamily))issues.push({field:'tokens.typography.headingFamily',code:'ENUM',message:'标题字体角色不受支持'});
    const target=input.targets?.includes('social')?'social':input.targets?.[0],limits=themeNumericLimits({target,source:input.source});
    for(const [field,[min,max,step]] of Object.entries(limits)){const path=field.split('.'),group=path[1],key=path[2];if(OPTIONAL_TOKEN_KEYS.has(key)&&tokens[group]?.[key]===undefined)continue;if(tokens[group]&&tokenFields[group]&&!tokenFields[group].has(key))continue;numberIn(tokens[group]?.[key],min,max,field,issues,enforceNumericSteps?step:null);}
    if(!isCover&&!SHADOWS.has(tokens.shape?.shadow))issues.push({field:'tokens.shape.shadow',code:'ENUM',message:'阴影配方不受支持'});
    if(target==='social'&&input.source!=='builtin'){
      const highFields=socialDensityHighFields(input);
      if(highFields.length>SOCIAL_DENSITY_MAX_HIGH_VALUES)for(const field of highFields)issues.push({field,code:'SOCIAL_DENSITY_BUDGET',message:`字号、行高与留白不能同时偏大；有 ${highFields.length} 项超过舒适值，最多允许 ${SOCIAL_DENSITY_MAX_HIGH_VALUES} 项`});
    }
  }
  for(const target of ['article','social']){
    const config=input[target];
    if(input.targets?.includes(target)&&(!config||typeof config!=='object'||Array.isArray(config)))issues.push({field:target,code:'REQUIRED',message:`${target} 目标需要对应配置`});
    if(!config)continue;
    unknown(config,new Set(target==='article'?['recipes','behavior','components']:['recipes','effects','components']),target,issues);
    if(!config.recipes||typeof config.recipes!=='object'||Array.isArray(config.recipes))issues.push({field:`${target}.recipes`,code:'TYPE',message:'必须是对象'});
    else {
      const catalog=THEME_RECIPE_CATALOG[target]; unknown(config.recipes,new Set(Object.keys(catalog)),`${target}.recipes`,issues);
      for(const [key,allowed] of Object.entries(catalog))if(config.recipes[key]===undefined){if(!COMPATIBLE_OPTIONAL_RECIPES[target]?.has(key))issues.push({field:`${target}.recipes.${key}`,code:'REQUIRED',message:'不能为空'});}else if(!allowed.includes(config.recipes[key]))issues.push({field:`${target}.recipes.${key}`,code:'ENUM',message:'配方不受支持'});
    }
    if(target==='article'&&!config.behavior)issues.push({field:'article.behavior',code:'REQUIRED',message:'不能为空'});
    if(target==='article'&&config.behavior){
      unknown(config.behavior,new Set(['justify','highlightStrong','numberSections']),'article.behavior',issues);
      if(typeof config.behavior.justify!=='boolean'||typeof config.behavior.numberSections!=='boolean')issues.push({field:'article.behavior',code:'TYPE',message:'justify 和 numberSections 必须为布尔值'});
      if(!['accent','ink'].includes(config.behavior.highlightStrong))issues.push({field:'article.behavior.highlightStrong',code:'ENUM',message:'重点色策略不受支持'});
    }
    if(target==='social'&&!config.effects)issues.push({field:'social.effects',code:'REQUIRED',message:'不能为空'});
    if(target==='social'&&config.effects){
      unknown(config.effects,new Set(['texture','decorationOpacity','contentTiltDeg']),'social.effects',issues);
      if(!['none','grid','scanlines','paper-grain'].includes(config.effects.texture))issues.push({field:'social.effects.texture',code:'ENUM',message:'纹理配方不受支持'});
      numberIn(config.effects.decorationOpacity,0,1,'social.effects.decorationOpacity',issues,enforceNumericSteps?.05:null);
      numberIn(config.effects.contentTiltDeg,-2,2,'social.effects.contentTiltDeg',issues,enforceNumericSteps?.1:null);
    }
    if(config.components!==undefined){
      const components=config.components;
      if(!components||typeof components!=='object'||Array.isArray(components))issues.push({field:`${target}.components`,code:'TYPE',message:'必须是对象'});
      else {
        const componentCatalog=target==='article'?ARTICLE_COMPONENT_CATALOG:SOCIAL_COMPONENT_CATALOG,shapes=Object.fromEntries(Object.entries(componentCatalog).map(([component,metadata])=>[component,Object.fromEntries(Object.entries(metadata.fields).map(([key,field])=>[key,field.options.map((option)=>option.value)]))]));
        unknown(components,new Set(Object.keys(shapes)),`${target}.components`,issues);
        for(const [component,shape] of Object.entries(shapes)){
          const value=components[component];if(value===undefined)continue;
          if(!value||typeof value!=='object'||Array.isArray(value)){issues.push({field:`${target}.components.${component}`,code:'TYPE',message:'必须是对象'});continue;}
          unknown(value,new Set(Object.keys(shape)),`${target}.components.${component}`,issues);
          for(const [key,allowed] of Object.entries(shape))if(value[key]===undefined)issues.push({field:`${target}.components.${component}.${key}`,code:'REQUIRED',message:'不能为空'});else if(!allowed.includes(value[key]))issues.push({field:`${target}.components.${component}.${key}`,code:'ENUM',message:'组件属性不受支持'});
        }
        if(target==='social'){const displayFields=['coverTitle','lead','contentTitle','endingTitle'].filter((component)=>components[component]?.sizeScale==='display').map((component)=>`social.components.${component}.sizeScale`),densityTotal=socialDensityHighFields(input).length+displayFields.length;if(densityTotal>SOCIAL_DENSITY_MAX_HIGH_VALUES)for(const field of displayFields)issues.push({field,code:'SOCIAL_COMPONENT_DENSITY_BUDGET',message:`展示字号与全局字号、行高及留白的组合过密；合计 ${densityTotal} 项偏大，最多允许 ${SOCIAL_DENSITY_MAX_HIGH_VALUES} 项`});}
      }
    }
  }
  // 封面主题的可选内置构图：cover.spec 在创建主题时固化组件搭配，生成封面时直接使用
  if(input.cover!==undefined){
    if(!input.targets?.includes('cover'))issues.push({field:'cover',code:'TARGET_MISMATCH',message:'仅 cover 目标主题可携带构图'});
    else if(!input.cover||typeof input.cover!=='object'||Array.isArray(input.cover))issues.push({field:'cover',code:'TYPE',message:'必须是对象'});
    else {
      unknown(input.cover,new Set(['spec']),'cover',issues);
      const result=validateCoverThemeSpec(input.cover.spec);
      if(!result.ok)for(const item of result.issues)issues.push({field:`cover.spec.${item.field}`,code:item.code,message:item.message});
    }
  }
  if(issues.length)throw new ThemeValidationError(issues,filePath);
  return input;
}
