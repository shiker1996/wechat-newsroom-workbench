import crypto from 'node:crypto';
import { AI_THEME_ERROR_CODES, AiThemeContractError, composeAiThemeDefinition, validateAiThemeRequest } from './ai-theme-contract.mjs';
import { AiThemeCandidateStore } from './ai-theme-candidate-store.mjs';
import { THEME_RECIPE_CATALOG, themeRecipeEditorCatalog } from './recipe-catalog.mjs';
import { auditThemeForPublish } from './theme-publish-gate.mjs';
import { compileThemePreview } from './theme-preview.mjs';
import { colorContrast } from './theme-validator.mjs';
import { getBuiltinThemeRegistry } from './theme-registry.mjs';
import { compactThemeSignatures, compareAiThemeCandidate } from './ai-theme-quality.mjs';
import { SOCIAL_DENSITY_MAX_HIGH_VALUES, SOCIAL_DENSITY_THRESHOLDS, socialDensityHighFields, themeNumericLimits } from './theme-numeric-limits.mjs';
import { ARTICLE_COMPONENT_CATALOG, articleComponentDefaults, articleComponentEditorCatalog, SOCIAL_COMPONENT_CATALOG, socialComponentDefaults, socialComponentEditorCatalog } from './component-catalog.mjs';
import { validateCoverThemeSpec, sanitizeCoverThemeSpec } from './cover-components.mjs';

// 默认构图：素底回退也要保持基本的版式层次（色块 + 副标题 + 信息行），避免裸标题的简陋观感
const DEFAULT_COVER_THEME_SPEC={components:[{type:'canvas',colorRole:'page'},{type:'color-block',position:'left-third',shape:'rect',colorRole:'accent'},{type:'title',align:'left'},{type:'subtitle',withBar:true},{type:'meta'}]};

export const AI_THEME_PROMPT_VERSION='theme-create-v2';
const EFFECT_NUMBERS={'social.effects.decorationOpacity':[0,1,.05],'social.effects.contentTiltDeg':[-2,2,.1]};
const HEX3=/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i,HEX6=/^#[0-9a-f]{6}$/i;
const DEFAULTS={
  colors:{background:'#FFFFFF',surface:'#F7F3EA',text:'#1F2937',muted:'#6B7280',accent:'#C53A2E',accentSecondary:'#D89B55',line:'#D1D5DB',inverseText:'#FFFFFF',codeBackground:'#111827'},
  // 封面主题的颜色契约收敛为画布构图实际消费的角色：画布底色、标题/弱化文字、双强调、反白与深色块
  coverColors:{page:'#111827',text:'#F9FAFB',muted:'#9CA3AF',accent:'#38BDF8',accentSecondary:'#A78BFA',inverseText:'#FFFFFF',codeBackground:'#020617'},
  article:{typography:{family:'sans',headingFamily:'serif',bodyPx:16,h1Px:32,h2Px:22,captionPx:13,lineHeight:1.8,letterSpacingEm:.025},spacing:{articlePaddingPx:18,sectionPx:30,paragraphPx:16,cardGapPx:12},shape:{radiusPx:8,borderWidthPx:1,shadow:'none'},behavior:{justify:true,numberSections:false,highlightStrong:'accent'}},
  social:{typography:{family:'sans',headingFamily:'sans',bodyPx:11,h1Px:34,h2Px:12,captionPx:9,codePx:11,lineHeight:1.45,letterSpacingEm:0},spacing:{articlePaddingPx:18,sectionPx:24,paragraphPx:12,cardGapPx:12},shape:{radiusPx:18,borderWidthPx:1,shadow:'soft'},effects:{texture:'none',decorationOpacity:.35,contentTiltDeg:0}},
  cover:{typography:{family:'sans',headingFamily:'sans',titlePx:48,titleLineHeight:1.32,eyebrowPx:20,subtitlePx:21,metaPx:18},spacing:{paddingXPx:48,paddingYPx:44,gapPx:18,metaBottomPx:28},shape:{badgeRadiusPx:4}},
};
// 旧版封面 token（文章字段集）→ 新版封面字段的迁移映射；未映射的旧字段直接移除
const COVER_LEGACY_TYPE_MAP={h1Px:'titlePx',lineHeight:'titleLineHeight',captionPx:'metaPx'};
const COVER_LEGACY_FIELDS={typography:['bodyPx','h1Px','h2Px','captionPx','codePx','lineHeight','letterSpacingEm'],spacing:['articlePaddingPx','sectionPx','paragraphPx','cardGapPx'],shape:['radiusPx','borderWidthPx','shadow']};

function get(root,path){return path.split('.').reduce((value,key)=>value?.[key],root);}
function set(root,path,value){const parts=path.split('.'),leaf=parts.pop(),parent=parts.reduce((value,key)=>value?.[key],root);if(parent)parent[leaf]=value;}
function repair(repairs,field,before,after,reason){if(Object.is(before,after))return;set(repairs.value,field,after);repairs.items.push({field,before,after,reason});}
function remove(repairs,path,reason){const parts=path.split('.'),leaf=parts.pop(),parent=parts.reduce((value,key)=>value?.[key],repairs.value);if(!parent||!Object.hasOwn(parent,leaf))return;const before=parent[leaf];delete parent[leaf];repairs.items.push({field:path,before,after:null,reason});}
function ensureObject(root,key){if(!root[key]||typeof root[key]!=='object'||Array.isArray(root[key]))root[key]={};return root[key];}
function bestContrast(foreground,backgrounds){return ['#111111','#FFFFFF'].sort((a,b)=>Math.min(...backgrounds.map((bg)=>colorContrast(b,bg)))-Math.min(...backgrounds.map((bg)=>colorContrast(a,bg))))[0]||foreground;}
function mixHex(from,to,ratio){
  const parse=(value)=>[1,3,5].map((index)=>Number.parseInt(value.slice(index,index+2),16));
  const left=parse(from),right=parse(to);
  return `#${left.map((value,index)=>Math.round(value+(right[index]-value)*ratio).toString(16).padStart(2,'0')).join('').toUpperCase()}`;
}
function contrastSafeBackground(foreground,background,minimum){
  if(colorContrast(foreground,background)>=minimum)return background;
  const target=colorContrast(foreground,'#000000')>=colorContrast(foreground,'#FFFFFF')?'#000000':'#FFFFFF';
  for(let step=1;step<=100;step+=1){const candidate=mixHex(background,target,step/100);if(colorContrast(foreground,candidate)>=minimum)return candidate;}
  return target;
}

export function normalizeAiThemeCandidate(input,{target}){
  const state={value:structuredClone(input||{}),items:[]};
  const tokens=ensureObject(state.value,'tokens'),colors=ensureObject(tokens,'colors'),typography=ensureObject(tokens,'typography'),spacing=ensureObject(tokens,'spacing'),shape=ensureObject(tokens,'shape'),targetDefaults=DEFAULTS[target]||DEFAULTS.article;
  // 封面主题：tokens + 内置构图（spec），无 recipes/components 配方
  const targetConfig=ensureObject(state.value,'targetConfig'),recipes=target==='cover'?{}:ensureObject(targetConfig,'recipes');
  if(target==='cover'){
    const result=validateCoverThemeSpec(targetConfig.spec);
    if(result.ok)targetConfig.spec=result.spec;
    else {
      // 整组校验失败时逐组件抢救：保留合规组件，只丢弃笔误组件；什么都没剩下才回退默认构图
      const before=targetConfig.spec,salvaged=sanitizeCoverThemeSpec(before);
      const meaningful=salvaged.spec.components.filter((component)=>!['canvas','title'].includes(component.type));
      if(meaningful.length){
        targetConfig.spec=salvaged.spec;
        state.items.push({field:'targetConfig.spec',before,after:salvaged.spec,reason:`构图中 ${salvaged.dropped.length} 个组件不合规已丢弃，保留 ${salvaged.kept} 个合规组件`});
      }else{
        targetConfig.spec=structuredClone(DEFAULT_COVER_THEME_SPEC);
        state.items.push({field:'targetConfig.spec',before,after:targetConfig.spec,reason:before===undefined?'未提供构图，使用默认构图（色块 + 标题 + 副标题 + 信息行）':'构图整体不合规，回退到默认构图（色块 + 标题 + 副标题 + 信息行）'});
      }
    }
  }
  for(const [alias,canonical] of [['border','line'],['codeText','inverseText']])if(colors[alias]!==undefined){if(colors[canonical]===undefined)repair(state,`tokens.colors.${canonical}`,undefined,colors[alias],`将常见别名 ${alias} 映射为 ${canonical}`);remove(state,`tokens.colors.${alias}`,`移除已映射的非 Schema 字段 ${alias}`);}
  if(target==='cover'){
    // 封面颜色契约：page 是画布底色；background 映射为 page，surface/line 不被封面编译器消费
    if(colors.page===undefined&&colors.background!==undefined)repair(state,'tokens.colors.page',undefined,colors.background,'将背景色映射为封面画布底色');
    for(const [key,value] of Object.entries(DEFAULTS.coverColors))if(colors[key]===undefined)repair(state,`tokens.colors.${key}`,undefined,value,'补齐封面安全颜色默认值');
    for(const key of ['background','surface','line'])if(colors[key]!==undefined)remove(state,`tokens.colors.${key}`,'封面主题不消费该颜色字段，已移除');
  }else{
    for(const [key,value] of Object.entries(DEFAULTS.colors))if(colors[key]===undefined)repair(state,`tokens.colors.${key}`,undefined,value,'补齐安全颜色默认值');
    // page 颜色只有图文编译器消费；文章主题携带它必然触发「未被消费」门禁，直接移除
    if(target!=='social'&&colors.page!==undefined)remove(state,'tokens.colors.page','移除文章主题不消费的 page 颜色');
  }
  if(target==='cover'){
    // AI 沿用文章字段集输出时，把可映射的旧字段搬进封面契约，其余移除
    for(const [group,keys] of Object.entries(COVER_LEGACY_FIELDS)){
      const bucket=group==='typography'?typography:group==='spacing'?spacing:shape;
      for(const key of keys){
        if(bucket[key]===undefined)continue;
        const mapped=group==='typography'?COVER_LEGACY_TYPE_MAP[key]:undefined;
        if(mapped&&bucket[mapped]===undefined)repair(state,`tokens.${group}.${mapped}`,undefined,bucket[key],`将旧版 ${key} 映射为封面字段 ${mapped}`);
        remove(state,`tokens.${group}.${key}`,'封面主题不消费该文章字段，已移除');
      }
    }
  }
  for(const [key,value] of Object.entries(targetDefaults.typography))if(typography[key]===undefined)repair(state,`tokens.typography.${key}`,undefined,value,'补齐目标排版默认值');
  for(const [key,value] of Object.entries(targetDefaults.spacing))if(spacing[key]===undefined)repair(state,`tokens.spacing.${key}`,undefined,value,'补齐目标间距默认值');
  for(const [key,value] of Object.entries(targetDefaults.shape))if(shape[key]===undefined)repair(state,`tokens.shape.${key}`,undefined,value,'补齐目标形状默认值');
  if(!['sans','serif','mono'].includes(typography.family))repair(state,'tokens.typography.family',typography.family,targetDefaults.typography.family,'回退到受支持的正文字体角色');
  if(!['sans','serif','mono'].includes(typography.headingFamily))repair(state,'tokens.typography.headingFamily',typography.headingFamily,targetDefaults.typography.headingFamily,'回退到受支持的标题字体角色');
  if(target!=='cover'&&!['none','soft','hard','glow'].includes(shape.shadow))repair(state,'tokens.shape.shadow',shape.shadow,targetDefaults.shape.shadow,'回退到受支持的阴影配方');
  const recipeDefaults={article:{rhythm:'standard'},social:{skeleton:'stacked',coverSupport:'lead'}};
  for(const [key,allowed] of Object.entries(THEME_RECIPE_CATALOG[target]||{})){const fallback=recipeDefaults[target]?.[key]||allowed[0];if(!allowed.includes(recipes[key]))repair(state,`targetConfig.recipes.${key}`,recipes[key],fallback,'回退到受支持的组件配方');}
  if(target==='article'){
    const behavior=ensureObject(targetConfig,'behavior');for(const key of ['readingPriority','codeTheme','brightness'])remove(state,`targetConfig.behavior.${key}`,'偏好字段不属于文章主题行为配置');
    for(const [key,value] of Object.entries(targetDefaults.behavior))if(behavior[key]===undefined)repair(state,`targetConfig.behavior.${key}`,undefined,value,'补齐文章行为默认值');
    if(typeof behavior.justify!=='boolean')repair(state,'targetConfig.behavior.justify',behavior.justify,true,'正文对齐必须为布尔值');if(typeof behavior.numberSections!=='boolean')repair(state,'targetConfig.behavior.numberSections',behavior.numberSections,false,'章节编号必须为布尔值');if(!['accent','ink'].includes(behavior.highlightStrong))repair(state,'targetConfig.behavior.highlightStrong',behavior.highlightStrong,'accent','回退到受支持的重点色策略');
    const components=ensureObject(targetConfig,'components'),defaults=articleComponentDefaults(recipes);for(const [component,meta] of Object.entries(ARTICLE_COMPONENT_CATALOG)){const value=ensureObject(components,component);for(const [key,fieldMeta] of Object.entries(meta.fields)){const allowed=fieldMeta.options.map((option)=>option.value),fallback=defaults[component][key];if(!allowed.includes(value[key]))repair(state,`targetConfig.components.${component}.${key}`,value[key],fallback,'回退到受支持的文章组件属性');}}
  }else if(target==='social'){
    const effects=ensureObject(targetConfig,'effects');for(const [key,value] of Object.entries(targetDefaults.effects))if(effects[key]===undefined)repair(state,`targetConfig.effects.${key}`,undefined,value,'补齐图文效果默认值');if(!['none','grid','scanlines','paper-grain'].includes(effects.texture))repair(state,'targetConfig.effects.texture',effects.texture,'none','回退到受支持的纹理配方');
    const components=ensureObject(targetConfig,'components'),defaults=socialComponentDefaults(recipes);
    for(const [component,meta] of Object.entries(SOCIAL_COMPONENT_CATALOG)){
      const value=ensureObject(components,component);
      for(const [key,fieldMeta] of Object.entries(meta.fields)){
        const allowed=fieldMeta.options.map((option)=>option.value),fallback=defaults[component][key];
        if(!allowed.includes(value[key]))repair(state,`targetConfig.components.${component}.${key}`,value[key],fallback,'回退到受支持的组件属性');
      }
    }
  }
  for(const field of ['label','description']){const value=get(state.value,field);if(typeof value==='string')repair(state,field,value,value.trim(),'去除首尾空白');}
  if(Array.isArray(state.value.tags)){const value=state.value.tags,after=[...new Set(value.filter((tag)=>typeof tag==='string').map((tag)=>tag.trim()).filter(Boolean))];if(JSON.stringify(value)!==JSON.stringify(after)){state.value.tags=after;state.items.push({field:'tags',before:value,after,reason:'清理并去重标签'});}}
  // designSummary 契约是 1–6 条 {title 1–20 字, description 1–100 字}；AI 常见缺失、超长或混入非对象项。
  // 这类字段用户无法直接控制，归一化阶段自动修正而不是交给门禁报错。
  {
    const before=state.value.designSummary,source=Array.isArray(before)?before:[];
    const items=source.filter((item)=>item&&typeof item==='object').map((item)=>({title:typeof item.title==='string'?item.title.trim().slice(0,20):'',description:typeof item.description==='string'?item.description.trim().slice(0,100):''})).filter((item)=>item.title||item.description).slice(0,6);
    for(const item of items){if(!item.title)item.title='设计说明';if(!item.description)item.description=item.title;}
    if(items.length===0){const description=typeof state.value.description==='string'?state.value.description.trim():'',label=typeof state.value.label==='string'?state.value.label.trim():'';items.push({title:'设计说明',description:(description||label||'按主题意图生成的视觉方案').slice(0,100)});}
    if(JSON.stringify(before)!==JSON.stringify(items)){state.value.designSummary=items;state.items.push({field:'designSummary',before,after:items,reason:'设计摘要不合契约（缺失、超长或格式异常），已自动修正'});}
  }
  for(const [key,value] of Object.entries(state.value.tokens?.colors||{})){let after=value;if(typeof value==='string'){after=value.trim().toUpperCase();const match=after.match(HEX3);if(match)after=`#${match[1]}${match[1]}${match[2]}${match[2]}${match[3]}${match[3]}`;}repair(state,`tokens.colors.${key}`,value,after,'规范化为六位十六进制颜色');}
  const numericLimits={...themeNumericLimits({target,source:'user'}),...(target==='social'?EFFECT_NUMBERS:{})};
  for(const [field,[min,max,step]] of Object.entries(numericLimits)){const mapped=field.startsWith('social.')?`targetConfig.${field.slice(7)}`:field;const value=get(state.value,mapped);if(!Number.isFinite(value))continue;const precision=Math.max(0,(String(step).split('.')[1]||'').length),after=Number((Math.min(max,Math.max(min,min+Math.round((value-min)/step)*step))).toFixed(precision));repair(state,mapped,value,after,'吸附到主题允许的范围与步进');}
  if(target==='social'){
    const densityOrder=['tokens.spacing.paragraphPx','tokens.spacing.cardGapPx','tokens.spacing.sectionPx','tokens.spacing.articlePaddingPx','tokens.typography.lineHeight','tokens.typography.captionPx','tokens.typography.bodyPx','tokens.typography.h2Px','tokens.typography.h1Px'];
    for(const field of densityOrder){if(socialDensityHighFields(state.value).length<=SOCIAL_DENSITY_MAX_HIGH_VALUES)break;const value=get(state.value,field),after=SOCIAL_DENSITY_THRESHOLDS[field];if(Number.isFinite(value)&&value>after)repair(state,field,value,after,'降低图文字号与留白的组合密度，避免固定画布溢出');}
    const scalableComponents=['lead','coverTitle','contentTitle','endingTitle'];for(const component of scalableComponents){const field=`targetConfig.components.${component}.sizeScale`;if(socialDensityHighFields(state.value).length+scalableComponents.filter((name)=>get(state.value,`targetConfig.components.${name}.sizeScale`)==='display').length<=SOCIAL_DENSITY_MAX_HIGH_VALUES)break;if(get(state.value,field)==='display')repair(state,field,'display','standard','降低组件展示字号，保持固定画布密度预算');}
  }
  if(colors&&Object.values(colors).every((value)=>typeof value==='string')){
    // 封面文字落在画布底色 page 上；文章/图文落在 background/surface 上
    const surfaceColors=target==='cover'?[colors.page]:[colors.background,colors.surface];
    if(HEX6.test(colors.text)&&surfaceColors.every((value)=>HEX6.test(value))&&Math.min(...surfaceColors.map((value)=>colorContrast(colors.text,value)))<4.5)repair(state,'tokens.colors.text',colors.text,bestContrast(colors.text,surfaceColors),target==='cover'?'修复标题文字与画布对比度':'修复正文对比度');
    if(HEX6.test(colors.muted)&&HEX6.test(surfaceColors[0])&&colorContrast(colors.muted,surfaceColors[0])<3)repair(state,'tokens.colors.muted',colors.muted,bestContrast(colors.muted,[surfaceColors[0]]),'修复弱化文字对比度');
    if(HEX6.test(colors.inverseText)&&[colors.codeBackground,colors.accent].every((value)=>HEX6.test(value))){
      const inverse=bestContrast(colors.inverseText,[colors.codeBackground]);
      if(colorContrast(colors.inverseText,colors.codeBackground)<4.5||colorContrast(colors.inverseText,colors.accent)<3)repair(state,'tokens.colors.inverseText',colors.inverseText,inverse,'优先保证代码区域的反白文字可读');
      const codeBackground=contrastSafeBackground(colors.inverseText,colors.codeBackground,4.5);
      repair(state,'tokens.colors.codeBackground',colors.codeBackground,codeBackground,'调整代码背景以满足反白文字 4.5:1 对比度');
      const accent=contrastSafeBackground(colors.inverseText,colors.accent,3);
      repair(state,'tokens.colors.accent',colors.accent,accent,'保留强调色色相并调整明度，使反白组件达到 3:1 对比度');
    }
    if(target==='social'){
      const roleValue=(role)=>colors[role],surfaceValue=(role,fallback=colors.surface)=>role==='inherit'||role==='transparent'?fallback:colors[role],components=state.value.targetConfig.components,coverBackground=recipes.coverTitle==='highlight-block'?colors.accent:colors.surface;
      for(const [path,background,minimum] of [['coverTitle.colorRole',coverBackground,3],['eyebrow.colorRole',colors.surface,4.5],['lead.colorRole',colors.surface,4.5]]){
        const [component,key]=path.split('.'),role=components[component][key];if(!HEX6.test(background)||!HEX6.test(roleValue(role)))continue;
        if(colorContrast(roleValue(role),background)<minimum){const safe=['text','muted','accent','accentSecondary','inverseText'].sort((a,b)=>colorContrast(roleValue(b),background)-colorContrast(roleValue(a),background))[0];repair(state,`targetConfig.components.${component}.${key}`,role,safe,`修复${component}文字与实际表面的对比度`);}
      }
      const endingBackground=recipes.surface==='base'||recipes.ending==='dark-fill'?colors.codeBackground:colors.accent,textChecks=[['statValue','colorRole',colors.surface,3],['statLabel','colorRole',colors.surface,4.5],['step','titleColorRole',colors.surface,4.5],['step','bodyColorRole',colors.surface,4.5],['compareTable','headerTextColorRole',surfaceValue(components.compareTable.headerSurfaceRole,colors.accent),4.5],['compareTable','bodyTextColorRole',colors.surface,4.5],['list','textColorRole',surfaceValue(components.list.surfaceRole),4.5],['note','textColorRole',surfaceValue(components.note.surfaceRole),4.5],['contentTitle','colorRole',colors.surface,4.5],['endingTitle','colorRole',endingBackground,3]];
      for(const [component,key,background,minimum] of textChecks){const selected=components[component][key];if(!HEX6.test(background)||!HEX6.test(roleValue(selected))||colorContrast(roleValue(selected),background)>=minimum)continue;const safe=['text','muted','accent','accentSecondary','inverseText'].sort((a,b)=>colorContrast(roleValue(b),background)-colorContrast(roleValue(a),background))[0];repair(state,`targetConfig.components.${component}.${key}`,selected,safe,`修复${component}文字与实际表面的对比度`);}
    }
    if(target==='article'){const components=state.value.targetConfig.components,roleValue=(role)=>colors[role],surfaceValue=(role,fallback=colors.surface)=>role==='inherit'||role==='transparent'?fallback:colors[role],checks=[['title','colorRole',colors.background,4.5],['lead','colorRole',colors.background,4.5],['quote','textColorRole',surfaceValue(components.quote.surfaceRole),4.5],['list','textColorRole',colors.background,4.5],['table','headerTextColorRole',surfaceValue(components.table.headerSurfaceRole),4.5],['code','textColorRole',surfaceValue(components.code.surfaceRole,colors.codeBackground),4.5],['imageCaption','colorRole',colors.background,3]];for(const [component,key,background,minimum] of checks){const selected=components[component][key];if(!HEX6.test(background)||!HEX6.test(roleValue(selected))||colorContrast(roleValue(selected),background)>=minimum)continue;const safe=['text','muted','accent','accentSecondary','inverseText'].sort((a,b)=>colorContrast(roleValue(b),background)-colorContrast(roleValue(a),background))[0];repair(state,`targetConfig.components.${component}.${key}`,selected,safe,`修复${component}文字与实际表面的对比度`);}}
  }
  return {candidate:state.value,repairs:state.items};
}

export function buildAiThemeMessages(request){
  const isCover=request.target==='cover',catalog=isCover?null:themeRecipeEditorCatalog(request.target),componentCatalog=isCover?null:request.target==='social'?socialComponentEditorCatalog().groups:articleComponentEditorCatalog().groups,ranges={...themeNumericLimits({target:request.target,source:'user'}),...(request.target==='social'?EFFECT_NUMBERS:{})},signatures=compactThemeSignatures(getBuiltinThemeRegistry().list({target:request.target}),request.target),targetDirection=isCover?'封面主题是 900×383 固定画布的配色、字阶、留白与固定构图：page 是画布底色，text/muted 服务标题与副标题，两个强调色必须在深浅底上都有辨识度，反白文字与深色色块对比度要足。字阶为大标题服务：titlePx 是标题自适应上限（建议 44–56），eyebrowPx/subtitlePx/metaPx 依次递减形成层级；间距只表达内容区内边距与元素间距，宁克制勿松散。构图（targetConfig.spec）在创建主题时一次定型，生成封面时不再重新设计：先在五套骨架（layout）中选一套，再只在该骨架约束内组合组件；不选骨架则自由组合。几何层次可用斜切（diagonal）或半屏色块、背景大字（giant-char）与网格/十字/裁切角标装饰营造杂志感；描边内框（frame）适合编辑画册调性，画布纹理与渐变默认保持 none，需要质感时择一即可。每类至多一处，宁少勿堆砌。构图组件只能带契约列出的字段：title 只带 align（不要输出 lines/highlights，断行在生成时确定）；eyebrow 必须带 1–12 字静态文案（如栏目名）；subtitle 只带 withBar；meta 不带任何字段。color-block 的 text 字段决定文字与色块的关系：span 表示标题跨缝双色，hold 表示文字入块换色，不填表示文字避开色块；色块位置占半幅（left-half / right-half）时 text 必须为 span，窄色块（left-third / right-panel / top-band）才可用 hold。':request.target==='article'?'文章主题以长时间阅读为先：正文建议 15–18px、行高 1.65–2.0，标题层级清楚，引用、表格和代码必须克制且可读。':'图文主题以 375×667 画布的信息识别为先：正文建议 11–13px、一级标题 26–34px、二级标题 12–18px、行高 1.35–1.55；字号、行高、内边距和间距中最多只允许 3 项同时超过舒适值，装饰不得挤压内容或干扰代码。',exactContract={tokens:isCover?{colors:['page','text','muted','accent','accentSecondary','inverseText','codeBackground'],typography:{required:['family','headingFamily','titlePx','titleLineHeight','eyebrowPx','subtitlePx','metaPx'],family:['sans','serif','mono'],headingFamily:['sans','serif','mono']},spacing:['paddingXPx','paddingYPx','gapPx','metaBottomPx'],shape:{required:['badgeRadiusPx']}}:{colors:['background','surface','text','muted','accent','accentSecondary','line','inverseText','codeBackground','page（仅图文可选）'],typography:{required:['family','headingFamily','bodyPx','h1Px','h2Px','captionPx','lineHeight','letterSpacingEm'],family:['sans','serif','mono'],headingFamily:['sans','serif','mono']},spacing:['articlePaddingPx','sectionPx','paragraphPx','cardGapPx'],shape:{required:['radiusPx','borderWidthPx','shadow'],shadow:['none','soft','hard','glow']}},targetConfig:isCover?({spec:{layout:'可选构图骨架：left-panel 左栏面板 / top-band 顶部色带 / diagonal-split 斜切分割 / centered-frame 居中框景（必须含 frame，禁色块与大字）/ minimal 极简大字（禁色块与 frame）。选了就只在该骨架约束内组合组件',components:{canvas:{required:true,colorRole:['page','ink','accent'],texture:['none','grid','scanlines（默认 none，至多选一种）'],gradient:['none','diagonal','radial（默认 none）']},frame:{max:1,style:['single','double'],colorRole:['ink','accent','muted']},'color-block':{max:1,position:['left-third','left-half','right-half','right-panel','top-band','full'],shape:['rect','arrow','diagonal'],colorRole:['accent','ink','code'],text:['hold（文字落进色块，自动换色块上的对比角色）','span（标题横跨色块分界线，块上/画布两种颜色；仅侧边色块可用）']},title:{align:['left','center']},eyebrow:{max:1,form:['text','badge','numbering'],text:'1–12 字静态栏目标签'},subtitle:{max:1,withBar:'boolean'},meta:{max:1},'giant-char':{max:1,text:'1–4 字静态字符（可省略，生成时取标题首字）',position:['left','right','center'],colorRole:['ink','accent','accentSecondary','inverseText']},decoration:{max:2,kind:['bar','dots','ring','cross','grid','corner-marks'],position:['top-left','top-center','top-right','middle-left','middle-right','bottom-left','bottom-center','bottom-right']}}}}):request.target==='article'?{required:['recipes','behavior','components'],components:{required:Object.keys(componentCatalog)},behavior:{justify:'boolean',numberSections:'boolean',highlightStrong:['accent','ink']}}:{required:['recipes','effects','components'],effects:{texture:['none','grid','scanlines','paper-grain'],decorationOpacity:'number',contentTiltDeg:'number'},components:{required:['coverTitle','eyebrow','lead']}}};
  const coverTitleConstraint=request.target==='social'?' coverTitle 必须显式选择一个白名单配方，只描述封面标题外观；不得用它表达选择器、CSS、字号、定位或布局参数。':'';
  const recipeSegment=catalog?`配方目录：${JSON.stringify(catalog)}。配方 ID 必须取 options.value。`:'';
  const differenceHint=isCover?'新候选应在配色、字阶或形状维度形成明确差异':'新候选应在配色、字阶、形状或至少两个组件配方维度形成明确差异';
  return [
    {role:'system',protected:true,content:`你是受约束的主题设计生成器。只返回单个 JSON 对象，不要 Markdown、代码围栏或解释。\n输出顶层只能包含 label、description、tags、tokens、targetConfig、designSummary。不得输出 id、version、targets、status、source、basedOn、CSS、HTML、URL、字体文件或脚本。\n目标：${request.target}。${targetDirection}${coverTitleConstraint}\n这是必须逐键遵守的精确契约，不得发明 codeText、border、codeTheme、brightness、readingPriority 等字段：${JSON.stringify(exactContract)}。\n数值范围与步进：${JSON.stringify(ranges)}。${recipeSegment}${componentCatalog?`组件属性目录：${JSON.stringify(componentCatalog)}。组件属性必须逐字段使用 options.value，不得输出任意字体、颜色或尺寸。`:''}designSummary 为 1–6 条 {title,description}。颜色只使用六位 HEX，并保证正文、弱化文字、反白文字和代码区域可读。\n以下是内置主题的紧凑视觉签名，只用于避免直接复刻；${differenceHint}：${JSON.stringify(signatures)}`},
    {role:'user',protected:true,content:`主题意图：${request.prompt}\n补充偏好：${JSON.stringify(request.preferences)}`},
  ];
}

function parseJson(content){if(typeof content!=='string')throw new Error('模型未返回文本');return JSON.parse(content);}
async function parseWithOneRepair(gateway,result,input){
  try{return {candidate:parseJson(result.content),formatRepaired:false,result};}
  catch(firstError){
    const repairResult=await gateway.complete({provider:input.provider,purpose:'theme-create-format-repair',jsonMode:true,thinking:false,temperature:0,maxOutputTokens:5000,messages:[{role:'system',protected:true,content:'把输入修复为一个严格 JSON 对象。只修复 JSON 格式，不增加、删除或改写语义；不要代码围栏或解释。'},{role:'user',protected:true,content:String(result.content||'').slice(0,30000)}]});
    try{return {candidate:parseJson(repairResult.content),formatRepaired:true,result:repairResult};}catch{throw new AiThemeContractError(AI_THEME_ERROR_CODES.MODEL_OUTPUT_INVALID,'模型未返回有效的主题 JSON',[{field:'candidate',code:'INVALID_JSON',message:firstError.message}]);}
  }
}

export async function generateAiThemeCandidate({gateway,input,candidateStore=new AiThemeCandidateStore(),signal,referenceThemes=[]}={}){
  const request=validateAiThemeRequest(input),provider=input.provider||gateway.config?.defaultProvider,providerConfig=gateway.config?.providers?.[provider];
  if(!providerConfig)throw new AiThemeContractError(AI_THEME_ERROR_CODES.MODEL_UNAVAILABLE,'没有可用的 AI 主题生成模型',[{field:'model','code':'UNAVAILABLE',message:'请在运行与配置中启用默认文本模型'}]);
  if(signal?.aborted)throw new AiThemeContractError(AI_THEME_ERROR_CODES.GENERATION_CANCELLED,'AI 主题生成已取消');
  let generated;
  try{generated=await gateway.complete({provider,purpose:'theme-create',jsonMode:true,thinking:false,temperature:.35,maxOutputTokens:Math.min(5000,providerConfig.maxOutputTokens||5000),messages:buildAiThemeMessages(request)});}
  catch(error){if(error instanceof AiThemeContractError)throw error;throw new AiThemeContractError(AI_THEME_ERROR_CODES.MODEL_UNAVAILABLE,`AI 主题生成失败：${error.message}`,[{field:'model',code:'CALL_FAILED',message:error.message}]);}
  const parsed=await parseWithOneRepair(gateway,generated,{provider});
  const normalized=normalizeAiThemeCandidate(parsed.candidate,{target:request.target}),temporaryId=`ai-candidate-${crypto.randomUUID().slice(0,12)}`;
  let composed;try{composed=composeAiThemeDefinition(normalized.candidate,{target:request.target,id:temporaryId});}catch(error){if(error instanceof AiThemeContractError)throw error;throw new AiThemeContractError(AI_THEME_ERROR_CODES.MODEL_OUTPUT_INVALID,error.message,error.issues||[]);}
  const audit=auditThemeForPublish(composed.definition,{target:request.target});
  if(!audit.valid)throw new AiThemeContractError(AI_THEME_ERROR_CODES.MODEL_OUTPUT_INVALID,'AI 主题候选未通过发布门禁',audit.issues);
  if(signal?.aborted)throw new AiThemeContractError(AI_THEME_ERROR_CODES.GENERATION_CANCELLED,'AI 主题生成已取消');
  const preview=compileThemePreview({target:request.target,definition:composed.definition});
  const references=[...getBuiltinThemeRegistry().list({target:request.target}),...referenceThemes],comparison=compareAiThemeCandidate(composed.definition,references);
  const stored=candidateStore.put({target:request.target,definition:composed.definition,designSummary:composed.designSummary,repairs:[...(parsed.formatRepaired?[{field:'candidate',before:'invalid-json',after:'valid-json',reason:'执行一次模型格式修复'}]:[]),...normalized.repairs],audit,preview,comparison,model:{serviceId:parsed.result.provider||provider,model:parsed.result.model||providerConfig.model||'',callId:parsed.result.callId||null},promptVersion:AI_THEME_PROMPT_VERSION,request:{prompt:request.prompt,preferences:request.preferences}});
  return stored;
}
