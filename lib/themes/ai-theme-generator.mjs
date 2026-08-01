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

export const AI_THEME_PROMPT_VERSION='theme-create-v2';
const EFFECT_NUMBERS={'social.effects.decorationOpacity':[0,1,.05],'social.effects.contentTiltDeg':[-2,2,.1]};
const HEX3=/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i,HEX6=/^#[0-9a-f]{6}$/i;
const DEFAULTS={
  colors:{background:'#FFFFFF',surface:'#F7F3EA',text:'#1F2937',muted:'#6B7280',accent:'#C53A2E',accentSecondary:'#D89B55',line:'#D1D5DB',inverseText:'#FFFFFF',codeBackground:'#111827'},
  article:{typography:{family:'sans',headingFamily:'serif',bodyPx:16,h1Px:32,h2Px:22,captionPx:13,lineHeight:1.8,letterSpacingEm:.025},spacing:{articlePaddingPx:18,sectionPx:30,paragraphPx:16,cardGapPx:12},shape:{radiusPx:8,borderWidthPx:1,shadow:'none'},behavior:{justify:true,numberSections:false,highlightStrong:'accent'}},
  social:{typography:{family:'sans',headingFamily:'sans',bodyPx:11,h1Px:34,h2Px:12,captionPx:9,lineHeight:1.45,letterSpacingEm:0},spacing:{articlePaddingPx:18,sectionPx:24,paragraphPx:12,cardGapPx:12},shape:{radiusPx:18,borderWidthPx:1,shadow:'soft'},effects:{texture:'none',decorationOpacity:.35,contentTiltDeg:0}},
};

function get(root,path){return path.split('.').reduce((value,key)=>value?.[key],root);}
function set(root,path,value){const parts=path.split('.'),leaf=parts.pop(),parent=parts.reduce((value,key)=>value?.[key],root);if(parent)parent[leaf]=value;}
function repair(repairs,field,before,after,reason){if(Object.is(before,after))return;set(repairs.value,field,after);repairs.items.push({field,before,after,reason});}
function remove(repairs,path,reason){const parts=path.split('.'),leaf=parts.pop(),parent=parts.reduce((value,key)=>value?.[key],repairs.value);if(!parent||!Object.hasOwn(parent,leaf))return;const before=parent[leaf];delete parent[leaf];repairs.items.push({field:path,before,after:null,reason});}
function ensureObject(root,key){if(!root[key]||typeof root[key]!=='object'||Array.isArray(root[key]))root[key]={};return root[key];}
function bestContrast(foreground,backgrounds){return ['#111111','#FFFFFF'].sort((a,b)=>Math.min(...backgrounds.map((bg)=>colorContrast(b,bg)))-Math.min(...backgrounds.map((bg)=>colorContrast(a,bg))))[0]||foreground;}

export function normalizeAiThemeCandidate(input,{target}){
  const state={value:structuredClone(input||{}),items:[]};
  const tokens=ensureObject(state.value,'tokens'),colors=ensureObject(tokens,'colors'),typography=ensureObject(tokens,'typography'),spacing=ensureObject(tokens,'spacing'),shape=ensureObject(tokens,'shape'),targetConfig=ensureObject(state.value,'targetConfig'),recipes=ensureObject(targetConfig,'recipes'),targetDefaults=DEFAULTS[target]||DEFAULTS.article;
  for(const [alias,canonical] of [['border','line'],['codeText','inverseText']])if(colors[alias]!==undefined){if(colors[canonical]===undefined)repair(state,`tokens.colors.${canonical}`,undefined,colors[alias],`将常见别名 ${alias} 映射为 ${canonical}`);remove(state,`tokens.colors.${alias}`,`移除已映射的非 Schema 字段 ${alias}`);}
  for(const [key,value] of Object.entries(DEFAULTS.colors))if(colors[key]===undefined)repair(state,`tokens.colors.${key}`,undefined,value,'补齐安全颜色默认值');
  for(const [key,value] of Object.entries(targetDefaults.typography))if(typography[key]===undefined)repair(state,`tokens.typography.${key}`,undefined,value,'补齐目标排版默认值');
  for(const [key,value] of Object.entries(targetDefaults.spacing))if(spacing[key]===undefined)repair(state,`tokens.spacing.${key}`,undefined,value,'补齐目标间距默认值');
  for(const [key,value] of Object.entries(targetDefaults.shape))if(shape[key]===undefined)repair(state,`tokens.shape.${key}`,undefined,value,'补齐目标形状默认值');
  if(!['sans','serif','mono'].includes(typography.family))repair(state,'tokens.typography.family',typography.family,targetDefaults.typography.family,'回退到受支持的正文字体角色');
  if(!['sans','serif','mono'].includes(typography.headingFamily))repair(state,'tokens.typography.headingFamily',typography.headingFamily,targetDefaults.typography.headingFamily,'回退到受支持的标题字体角色');
  if(!['none','soft','hard','glow'].includes(shape.shadow))repair(state,'tokens.shape.shadow',shape.shadow,targetDefaults.shape.shadow,'回退到受支持的阴影配方');
  for(const [key,allowed] of Object.entries(THEME_RECIPE_CATALOG[target]||{}))if(!allowed.includes(recipes[key]))repair(state,`targetConfig.recipes.${key}`,recipes[key],allowed[0],'回退到受支持的组件配方');
  if(target==='article'){
    const behavior=ensureObject(targetConfig,'behavior');for(const key of ['readingPriority','codeTheme','brightness'])remove(state,`targetConfig.behavior.${key}`,'偏好字段不属于文章主题行为配置');
    for(const [key,value] of Object.entries(targetDefaults.behavior))if(behavior[key]===undefined)repair(state,`targetConfig.behavior.${key}`,undefined,value,'补齐文章行为默认值');
    if(typeof behavior.justify!=='boolean')repair(state,'targetConfig.behavior.justify',behavior.justify,true,'正文对齐必须为布尔值');if(typeof behavior.numberSections!=='boolean')repair(state,'targetConfig.behavior.numberSections',behavior.numberSections,false,'章节编号必须为布尔值');if(!['accent','ink'].includes(behavior.highlightStrong))repair(state,'targetConfig.behavior.highlightStrong',behavior.highlightStrong,'accent','回退到受支持的重点色策略');
  }else{
    const effects=ensureObject(targetConfig,'effects');for(const [key,value] of Object.entries(targetDefaults.effects))if(effects[key]===undefined)repair(state,`targetConfig.effects.${key}`,undefined,value,'补齐图文效果默认值');if(!['none','grid','scanlines','paper-grain'].includes(effects.texture))repair(state,'targetConfig.effects.texture',effects.texture,'none','回退到受支持的纹理配方');
  }
  for(const field of ['label','description']){const value=get(state.value,field);if(typeof value==='string')repair(state,field,value,value.trim(),'去除首尾空白');}
  if(Array.isArray(state.value.tags)){const value=state.value.tags,after=[...new Set(value.filter((tag)=>typeof tag==='string').map((tag)=>tag.trim()).filter(Boolean))];if(JSON.stringify(value)!==JSON.stringify(after)){state.value.tags=after;state.items.push({field:'tags',before:value,after,reason:'清理并去重标签'});}}
  if(Array.isArray(state.value.designSummary))state.value.designSummary.forEach((item,index)=>{for(const key of ['title','description']){const value=item?.[key];if(typeof value==='string')repair(state,`designSummary.${index}.${key}`,value,value.trim(),'去除首尾空白');}});
  for(const [key,value] of Object.entries(state.value.tokens?.colors||{})){let after=value;if(typeof value==='string'){after=value.trim().toUpperCase();const match=after.match(HEX3);if(match)after=`#${match[1]}${match[1]}${match[2]}${match[2]}${match[3]}${match[3]}`;}repair(state,`tokens.colors.${key}`,value,after,'规范化为六位十六进制颜色');}
  const numericLimits={...themeNumericLimits({target,source:'user'}),...(target==='social'?EFFECT_NUMBERS:{})};
  for(const [field,[min,max,step]] of Object.entries(numericLimits)){const mapped=field.startsWith('social.')?`targetConfig.${field.slice(7)}`:field;const value=get(state.value,mapped);if(!Number.isFinite(value))continue;const precision=Math.max(0,(String(step).split('.')[1]||'').length),after=Number((Math.min(max,Math.max(min,min+Math.round((value-min)/step)*step))).toFixed(precision));repair(state,mapped,value,after,'吸附到主题允许的范围与步进');}
  if(target==='social'){
    const densityOrder=['tokens.spacing.paragraphPx','tokens.spacing.cardGapPx','tokens.spacing.sectionPx','tokens.spacing.articlePaddingPx','tokens.typography.lineHeight','tokens.typography.captionPx','tokens.typography.bodyPx','tokens.typography.h2Px','tokens.typography.h1Px'];
    for(const field of densityOrder){if(socialDensityHighFields(state.value).length<=SOCIAL_DENSITY_MAX_HIGH_VALUES)break;const value=get(state.value,field),after=SOCIAL_DENSITY_THRESHOLDS[field];if(Number.isFinite(value)&&value>after)repair(state,field,value,after,'降低图文字号与留白的组合密度，避免固定画布溢出');}
  }
  if(colors&&Object.values(colors).every((value)=>typeof value==='string')){
    if(HEX6.test(colors.text)&&[colors.background,colors.surface].every((value)=>HEX6.test(value))&&Math.min(colorContrast(colors.text,colors.background),colorContrast(colors.text,colors.surface))<4.5)repair(state,'tokens.colors.text',colors.text,bestContrast(colors.text,[colors.background,colors.surface]),'修复正文对比度');
    if(HEX6.test(colors.muted)&&HEX6.test(colors.background)&&colorContrast(colors.muted,colors.background)<3)repair(state,'tokens.colors.muted',colors.muted,bestContrast(colors.muted,[colors.background]),'修复弱化文字对比度');
    if(HEX6.test(colors.inverseText)&&[colors.codeBackground,colors.accent].every((value)=>HEX6.test(value))&&Math.min(colorContrast(colors.inverseText,colors.codeBackground),colorContrast(colors.inverseText,colors.accent))<3)repair(state,'tokens.colors.inverseText',colors.inverseText,bestContrast(colors.inverseText,[colors.codeBackground,colors.accent]),'修复反白文字对比度');
  }
  return {candidate:state.value,repairs:state.items};
}

export function buildAiThemeMessages(request){
  const catalog=themeRecipeEditorCatalog(request.target),ranges={...themeNumericLimits({target:request.target,source:'user'}),...(request.target==='social'?EFFECT_NUMBERS:{})},signatures=compactThemeSignatures(getBuiltinThemeRegistry().list({target:request.target}),request.target),targetDirection=request.target==='article'?'文章主题以长时间阅读为先：正文建议 15–18px、行高 1.65–2.0，标题层级清楚，引用、表格和代码必须克制且可读。':'图文主题以 375×667 画布的信息识别为先：正文建议 11–13px、一级标题 26–34px、二级标题 12–18px、行高 1.35–1.55；字号、行高、内边距和间距中最多只允许 3 项同时超过舒适值，装饰不得挤压内容或干扰代码。',exactContract={tokens:{colors:['background','surface','text','muted','accent','accentSecondary','line','inverseText','codeBackground','page（仅图文可选）'],typography:{required:['family','headingFamily','bodyPx','h1Px','h2Px','captionPx','lineHeight','letterSpacingEm'],family:['sans','serif','mono'],headingFamily:['sans','serif','mono']},spacing:['articlePaddingPx','sectionPx','paragraphPx','cardGapPx'],shape:{required:['radiusPx','borderWidthPx','shadow'],shadow:['none','soft','hard','glow']}},targetConfig:request.target==='article'?{required:['recipes','behavior'],behavior:{justify:'boolean',numberSections:'boolean',highlightStrong:['accent','ink']}}:{required:['recipes','effects'],effects:{texture:['none','grid','scanlines','paper-grain'],decorationOpacity:'number',contentTiltDeg:'number'}}};
  return [
    {role:'system',protected:true,content:`你是受约束的主题设计生成器。只返回单个 JSON 对象，不要 Markdown、代码围栏或解释。\n输出顶层只能包含 label、description、tags、tokens、targetConfig、designSummary。不得输出 id、version、targets、status、source、basedOn、CSS、HTML、URL、字体文件或脚本。\n目标：${request.target}。${targetDirection}\n这是必须逐键遵守的精确契约，不得发明 codeText、border、codeTheme、brightness、readingPriority 等字段：${JSON.stringify(exactContract)}。\n数值范围与步进：${JSON.stringify(ranges)}。配方目录：${JSON.stringify(catalog)}。配方 ID 必须取 options.value。designSummary 为 1–6 条 {title,description}。颜色只使用六位 HEX，并保证正文、弱化文字、反白文字和代码区域可读。\n以下是内置主题的紧凑视觉签名，只用于避免直接复刻；新候选应在配色、字阶、形状或至少两个组件配方维度形成明确差异：${JSON.stringify(signatures)}`},
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
