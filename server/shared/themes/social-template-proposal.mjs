import crypto from 'node:crypto';
import { getSocialCardTemplatePack, SOCIAL_CARD_RENDERER_BLOCK_TYPES } from '../rendering/social-card-template-registry.mjs';
import { SOCIAL_CARD_PAGE_ROLES } from '../rendering/social-card-role.mjs';

export const SOCIAL_TEMPLATE_PROPOSAL_PROMPT_VERSION='social-template-proposal-v2';
export const SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES=Object.freeze({
  INPUT_INVALID:'SOCIAL_TEMPLATE_PROPOSAL_INPUT_INVALID',
  OUTPUT_INVALID:'SOCIAL_TEMPLATE_PROPOSAL_OUTPUT_INVALID',
  OUTPUT_UNSAFE:'SOCIAL_TEMPLATE_PROPOSAL_OUTPUT_UNSAFE',
  MODEL_UNAVAILABLE:'SOCIAL_TEMPLATE_PROPOSAL_MODEL_UNAVAILABLE',
  MODEL_OUTPUT_INVALID:'SOCIAL_TEMPLATE_PROPOSAL_MODEL_OUTPUT_INVALID',
  EXPIRED:'SOCIAL_TEMPLATE_PROPOSAL_EXPIRED',
  RATE_LIMITED:'SOCIAL_TEMPLATE_PROPOSAL_RATE_LIMITED',
  GENERATION_CANCELLED:'SOCIAL_TEMPLATE_PROPOSAL_GENERATION_CANCELLED',
});

const REQUEST_FIELDS=new Set(['prompt','baseTemplatePack','baseThemeId','draftMode']);
const DRAFT_MODES=new Set(['json','html-css']);
const SYSTEM_FIELDS=new Set(['schemaVersion','proposalId','target','id','version','status','source','provenance','targets','themeId']);
const CANDIDATE_FIELDS=new Set(['label','description','visualDirection','baseTemplatePack','roles','surface','draft']);
const SURFACE_DENSITIES=new Set(['compact','standard','airy']);
const DECORATIONS=new Set(['none','grid-line','orbit','stamp','index-line','paper-rule','accent-edge']);
const HEADING_TREATMENTS=new Set(['plain','accent-bar','highlight-block','underline','numbered']);
const DENSITY_ALIASES=new Map([
  ['dense','compact'],['high-density','compact'],['high','compact'],['紧凑','compact'],['高密度','compact'],
  ['normal','standard'],['medium','standard'],['balanced','standard'],['default','standard'],['标准','standard'],['适中','standard'],
  ['comfortable','airy'],['loose','airy'],['spacious','airy'],['low-density','airy'],['宽松','airy'],['留白','airy'],
]);
const DECORATION_ALIASES=new Map([
  ['grid','grid-line'],['gridline','grid-line'],['grid-lines','grid-line'],['网格','grid-line'],['网格线','grid-line'],
  ['circular','orbit'],['ring','orbit'],['circle','orbit'],['圆环','orbit'],
  ['badge','stamp'],['label','stamp'],['印章','stamp'],
  ['index','index-line'],['索引','index-line'],['索引线','index-line'],
  ['paper','paper-rule'],['rule','paper-rule'],['纸张','paper-rule'],['纸线','paper-rule'],
  ['edge','accent-edge'],['accent-border','accent-edge'],['accent','accent-edge'],['强调边','accent-edge'],
  ['minimal','none'],['clean','none'],['无','none'],
]);
const HEADING_ALIASES=new Map([
  ['simple','plain'],['default','plain'],['普通','plain'],['无','plain'],
  ['bar','accent-bar'],['accent','accent-bar'],['side-bar','accent-bar'],['强调条','accent-bar'],
  ['highlight','highlight-block'],['highlight-box','highlight-block'],['高亮','highlight-block'],['高亮块','highlight-block'],
  ['line','underline'],['underlined','underline'],['下划线','underline'],
  ['number','numbered'],['序号','numbered'],
]);
const LAYOUT=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UNSAFE=/<\/?[a-z][^>]*>|```|javascript\s*:|https?:\/\/|@import|url\s*\(|data\s*:/i;
const HTML_UNSAFE=/<\s*(?:script|iframe|object|embed|link|meta|base)\b|\bon[a-z]+\s*=|javascript\s*:|https?:\/\/|data\s*:/i;

export class SocialTemplateProposalError extends Error {
  constructor(code,message,issues=[]){super(message);this.name='SocialTemplateProposalError';this.code=code;this.issues=issues;}
}

function object(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function issue(field,code,message){return {field,code,message};}
function unknownFields(value,allowed,prefix=''){return Object.keys(value||{}).filter((key)=>!allowed.has(key)).map((key)=>issue(prefix?`${prefix}.${key}`:key,'UNKNOWN_FIELD','未知字段'));}
function text(value,min,max,field,issues,{unsafe=true}={}){
  if(typeof value!=='string'||[...value.trim()].length<min||[...value.trim()].length>max)issues.push(issue(field,'LENGTH',`必须为 ${min}–${max} 个字符`));
  else if(unsafe&&UNSAFE.test(value))issues.push(issue(field,'UNSAFE_TEXT','不得包含 HTML、代码、URL 或样式表达式'));
}
function throwIssues(code,message,issues){if(issues.length)throw new SocialTemplateProposalError(code,message,issues);}
function packId(value){return typeof value==='string'?value.trim():String(value?.id||'').trim();}

export function validateSocialTemplateProposalRequest(input){
  const issues=[];
  if(!object(input))throw new SocialTemplateProposalError(SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.INPUT_INVALID,'Social 模板提案请求无效',[issue('request','TYPE','必须是对象')]);
  issues.push(...unknownFields(input,REQUEST_FIELDS));
  text(input.prompt,20,800,'prompt',issues);
  if(input.baseTemplatePack!==undefined){
    const id=packId(input.baseTemplatePack),pack=getSocialCardTemplatePack(id);
    if(!pack)issues.push(issue('baseTemplatePack','ENUM','必须是已登记的 Social 模板包'));
  }
  if(input.baseThemeId!==undefined&&(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(input.baseThemeId))||String(input.baseThemeId).length>64))issues.push(issue('baseThemeId','FORMAT','必须是合法主题 ID'));
  if(input.draftMode!==undefined&&!DRAFT_MODES.has(input.draftMode))issues.push(issue('draftMode','ENUM','必须是 json 或 html-css'));
  throwIssues(SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.INPUT_INVALID,'Social 模板提案请求无效',issues);
  return {prompt:input.prompt.trim(),baseTemplatePack:input.baseTemplatePack?packId(input.baseTemplatePack):'',baseThemeId:input.baseThemeId?String(input.baseThemeId):'',draftMode:input.draftMode||'json'};
}

function validateRole(value,role,issues){
  if(!object(value)){issues.push(issue(`roles.${role}`,'TYPE','角色提案必须是对象'));return;}
  issues.push(...unknownFields(value,new Set(['layout','maxBlocks','maxItems','supportedBlocks','notes']),`roles.${role}`));
  if(typeof value.layout!=='string'||!LAYOUT.test(value.layout)||value.layout.length>64)issues.push(issue(`roles.${role}.layout`,'FORMAT','必须是安全的 kebab-case 版式 ID'));
  if(!Number.isInteger(value.maxBlocks)||value.maxBlocks<1||value.maxBlocks>6)issues.push(issue(`roles.${role}.maxBlocks`,'RANGE','必须是 1–6 的整数'));
  if(!Number.isInteger(value.maxItems)||value.maxItems<1||value.maxItems>12)issues.push(issue(`roles.${role}.maxItems`,'RANGE','必须是 1–12 的整数'));
  if(!Array.isArray(value.supportedBlocks)||value.supportedBlocks.length<1||value.supportedBlocks.length>10||new Set(value.supportedBlocks).size!==value.supportedBlocks.length||value.supportedBlocks.some((item)=>!SOCIAL_CARD_RENDERER_BLOCK_TYPES.includes(item)))issues.push(issue(`roles.${role}.supportedBlocks`,'ENUM','必须是受控且不重复的内容块类型'));
  if(value.notes!==undefined)text(value.notes,0,160,`roles.${role}.notes`,issues);
}

export function validateSocialTemplateProposal(candidate,{allowSystemFields=false}={}){
  const issues=[];
  if(!object(candidate))throw new SocialTemplateProposalError(SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.OUTPUT_INVALID,'Social 模板提案无效',[issue('proposal','TYPE','必须是对象')]);
  if(!allowSystemFields){const forbidden=Object.keys(candidate).filter((key)=>SYSTEM_FIELDS.has(key));if(forbidden.length)throw new SocialTemplateProposalError(SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.OUTPUT_INVALID,'Social 模板提案包含由服务端生成的系统字段',forbidden.map((field)=>issue(field,'SYSTEM_FIELD_FORBIDDEN','由服务端生成，不接受模型设置')));}
  const allowedFields=new Set(CANDIDATE_FIELDS);if(allowSystemFields)for(const field of SYSTEM_FIELDS)allowedFields.add(field);
  issues.push(...unknownFields(candidate,allowedFields));
  if(allowSystemFields){
    if(candidate.schemaVersion!==1)issues.push(issue('schemaVersion','ENUM','必须为 1'));
    if(candidate.target!=='social')issues.push(issue('target','ENUM','必须为 social'));
    if(typeof candidate.proposalId!=='string'||!/^proposal-social-[a-z0-9-]{4,64}$/.test(candidate.proposalId))issues.push(issue('proposalId','FORMAT','必须是合法的 Social 提案 ID'));
    if(!new Set(['draft','preview-only','ready','published','rejected']).has(candidate.status))issues.push(issue('status','ENUM','提案状态不受支持'));
    if(!new Set(['ai-proposal','ai-html-draft','user-authored','inherited']).has(candidate.source))issues.push(issue('source','ENUM','提案来源不受支持'));
    if(!object(candidate.provenance))issues.push(issue('provenance','TYPE','必须是来源元数据对象'));
    else for(const field of ['model','promptVersion','baseThemeId'])if(candidate.provenance[field]!==undefined&&typeof candidate.provenance[field]!=='string')issues.push(issue(`provenance.${field}`,'TYPE','来源元数据必须是字符串'));
    if(candidate.draft?.html||candidate.draft?.css){if(candidate.draft.sanitized!==true)issues.push(issue('draft.sanitized','CONST','草稿必须标记为已清理'));if(candidate.draft.sandboxOnly!==true)issues.push(issue('draft.sandboxOnly','CONST','草稿必须标记为仅隔离预览'));}
  }
  text(candidate.label,1,30,'label',issues);text(candidate.description,1,240,'description',issues);
  if(!Array.isArray(candidate.visualDirection)||candidate.visualDirection.length<1||candidate.visualDirection.length>12||new Set(candidate.visualDirection).size!==candidate.visualDirection.length||candidate.visualDirection.some((value)=>typeof value!=='string'||[...value.trim()].length<1||[...value.trim()].length>32||UNSAFE.test(value)))issues.push(issue('visualDirection','FORMAT','必须是不重复的安全视觉关键词数组，最多 12 项'));
  if(candidate.baseTemplatePack!==undefined&&!getSocialCardTemplatePack(packId(candidate.baseTemplatePack)))issues.push(issue('baseTemplatePack','ENUM','基础模板包不存在'));
  if(!object(candidate.roles))issues.push(issue('roles','TYPE','必须包含十个页面角色'));else{
    issues.push(...unknownFields(candidate.roles,new Set(SOCIAL_CARD_PAGE_ROLES),'roles'));
    for(const role of SOCIAL_CARD_PAGE_ROLES)validateRole(candidate.roles[role],role,issues);
  }
  if(!object(candidate.surface))issues.push(issue('surface','TYPE','必须包含 surface 配置'));else{
    issues.push(...unknownFields(candidate.surface,new Set(['density','decoration','headingTreatment']),'surface'));
    if(!SURFACE_DENSITIES.has(candidate.surface.density))issues.push(issue('surface.density','ENUM','密度不受支持'));
    if(!DECORATIONS.has(candidate.surface.decoration))issues.push(issue('surface.decoration','ENUM','装饰不受支持'));
    if(!HEADING_TREATMENTS.has(candidate.surface.headingTreatment))issues.push(issue('surface.headingTreatment','ENUM','标题处理不受支持'));
  }
  if(candidate.draft!==undefined){
    if(!object(candidate.draft))issues.push(issue('draft','TYPE','草稿必须是对象'));else{
      issues.push(...unknownFields(candidate.draft,new Set(['html','css','sanitized','sandboxOnly']),'draft'));
      for(const key of ['html','css'])if(candidate.draft[key]!==undefined)text(candidate.draft[key],0,300000,`draft.${key}`,issues,{unsafe:false});
      if(candidate.draft.sanitized!==undefined&&typeof candidate.draft.sanitized!=='boolean')issues.push(issue('draft.sanitized','TYPE','必须是布尔值'));
      if(candidate.draft.sandboxOnly!==undefined&&typeof candidate.draft.sandboxOnly!=='boolean')issues.push(issue('draft.sandboxOnly','TYPE','必须是布尔值'));
    }
  }
  const unsafe=issues.find((item)=>item.code==='UNSAFE_TEXT');
  if(unsafe)throw new SocialTemplateProposalError(SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.OUTPUT_UNSAFE,'Social 模板提案包含不安全字段',issues);
  throwIssues(SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.OUTPUT_INVALID,'Social 模板提案未通过 Schema 校验',issues);
  return structuredClone(candidate);
}

function cleanText(value,repairs,field,max){
  if(typeof value!=='string')return value;
  const before=value,after=value.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,'').replace(/(?:javascript\s*:|https?:\/\/|data\s*:|@import|url\s*\()/gi,'').trim().slice(0,max);
  if(before!==after)repairs.push({field,before,after,reason:'移除 HTML、URL 与样式表达式'});
  return after;
}

function fallbackRole(pack,role){
  const capability=pack?.roles?.[role]||{};
  return {
    layout:typeof capability.template==='string'&&LAYOUT.test(capability.template)?capability.template:`${role}-layout`,
    maxBlocks:Number.isInteger(capability.maxBlocks)?capability.maxBlocks:4,
    maxItems:Number.isInteger(capability.maxItems)?capability.maxItems:9,
    supportedBlocks:Array.isArray(capability.supportedBlocks)&&capability.supportedBlocks.length?[...capability.supportedBlocks]:['text'],
    ...(capability.notes?{notes:String(capability.notes).slice(0,160)}:{}),
  };
}

function normalizeVisualDirection(value,repairs){
  const before=value;
  let items=Array.isArray(value)?value:typeof value==='string'?value.split(/[\n,，、;；/|]+/):[];
  items=items.filter((item)=>typeof item==='string').map((item,index)=>cleanText(item,repairs,`visualDirection.${index}`,32)).filter(Boolean);
  const seen=new Set();items=items.filter((item)=>{const key=item.toLocaleLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).slice(0,12);
  if(!items.length){items=['structured'];repairs.push({field:'visualDirection',before:before===undefined?'missing':before,after:items,reason:'模型未提供可用关键词，使用安全默认关键词'});}
  else if(typeof before!=='object'||(Array.isArray(before)&&before.length!==items.length)){repairs.push({field:'visualDirection',before,after:items,reason:'归一化为不重复的关键词数组'});}
  return items;
}

function normalizeEnum(value,allowed,aliases,fallback,field,repairs){
  const raw=typeof value==='string'?value.trim().toLowerCase():'';
  if(allowed.has(raw))return raw;
  const mapped=aliases.get(raw);
  if(mapped){repairs.push({field,before:value,after:mapped,reason:'将模型使用的语义别名归一化为受控枚举'});return mapped;}
  repairs.push({field,before:value===undefined?'missing':value,after:fallback,reason:'使用受控默认枚举值'});
  return fallback;
}

function normalizeInteger(value,fallback,min,max,field,repairs){
  const parsed=Number(value);
  if(Number.isInteger(parsed)&&parsed>=min&&parsed<=max)return parsed;
  repairs.push({field,before:value===undefined?'missing':value,after:fallback,reason:'使用基础模板包的安全容量'});
  return fallback;
}

function normalizeRole(value,role,pack,repairs){
  const fallback=fallbackRole(pack,role);
  if(!object(value)){
    repairs.push({field:`roles.${role}`,before:value===undefined?'missing':value,after:'base-template-role',reason:'模型未提供完整角色，沿用基础模板包能力'});
    return fallback;
  }
  const normalized={};
  const rawLayout=value.layout??value.template;
  const layout=typeof rawLayout==='string'?rawLayout.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64):'';
  normalized.layout=layout&&LAYOUT.test(layout)?layout:fallback.layout;
  if(normalized.layout!==rawLayout)repairs.push({field:`roles.${role}.layout`,before:rawLayout===undefined?'missing':rawLayout,after:normalized.layout,reason:'归一化为安全 kebab-case 版式 ID'});
  normalized.maxBlocks=normalizeInteger(value.maxBlocks,fallback.maxBlocks,1,6,`roles.${role}.maxBlocks`,repairs);
  normalized.maxItems=normalizeInteger(value.maxItems,fallback.maxItems,1,12,`roles.${role}.maxItems`,repairs);
  const supported=Array.isArray(value.supportedBlocks)?[...new Set(value.supportedBlocks.filter((item)=>SOCIAL_CARD_RENDERER_BLOCK_TYPES.includes(item)))]:[];
  normalized.supportedBlocks=supported.length?supported:fallback.supportedBlocks;
  if(!Array.isArray(value.supportedBlocks)||supported.length!==value.supportedBlocks.length)repairs.push({field:`roles.${role}.supportedBlocks`,before:value.supportedBlocks===undefined?'missing':value.supportedBlocks,after:normalized.supportedBlocks,reason:'过滤不支持或重复的内容块类型'});
  if(value.notes!==undefined)normalized.notes=cleanText(value.notes,repairs,`roles.${role}.notes`,160);
  return normalized;
}

function normalizeRoles(value,pack,repairs){
  const source=object(value)?value:{};
  const normalized={};
  for(const role of SOCIAL_CARD_PAGE_ROLES)normalized[role]=normalizeRole(source[role],role,pack,repairs);
  for(const role of Object.keys(source))if(!SOCIAL_CARD_PAGE_ROLES.includes(role))repairs.push({field:`roles.${role}`,before:'unknown-role',after:null,reason:'移除不在十个页面角色契约内的字段'});
  if(!object(value))repairs.push({field:'roles',before:value===undefined?'missing':value,after:SOCIAL_CARD_PAGE_ROLES,reason:'补齐十个页面角色'});
  return normalized;
}

function normalizeSurface(value,repairs){
  const source=object(value)?value:{};
  const normalized={
    density:normalizeEnum(source.density,SURFACE_DENSITIES,DENSITY_ALIASES,'standard','surface.density',repairs),
    decoration:normalizeEnum(source.decoration,DECORATIONS,DECORATION_ALIASES,'none','surface.decoration',repairs),
    headingTreatment:normalizeEnum(source.headingTreatment,HEADING_TREATMENTS,HEADING_ALIASES,'plain','surface.headingTreatment',repairs),
  };
  for(const field of Object.keys(source))if(!['density','decoration','headingTreatment'].includes(field))repairs.push({field:`surface.${field}`,before:'unknown-field',after:null,reason:'移除不在 surface 契约内的字段'});
  if(!object(value))repairs.push({field:'surface',before:value===undefined?'missing':value,after:normalized,reason:'补齐受控 surface 配置'});
  return normalized;
}

function sanitizeDraft(draft,repairs){
  if(!object(draft))return draft;
  const value={};
  if(typeof draft.html==='string')value.html=draft.html.replace(/<\s*script[\s\S]*?<\/\s*script\s*>/gi,'').replace(/<\s*(?:iframe|object|embed|link|meta|base)\b[^>]*>/gi,'').replace(/\bon[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'').replace(/(?:javascript\s*:|https?:\/\/|data\s*:)/gi,'').trim().slice(0,300000);
  if(typeof draft.css==='string')value.css=draft.css.replace(/@import[^;]+;?/gi,'').replace(/url\s*\([^)]*\)/gi,'').replace(/https?:\/\/[^\s)]+/gi,'').replace(/expression\s*\([^)]*\)/gi,'').trim().slice(0,300000);
  if(value.html!==draft.html||value.css!==draft.css)repairs.push({field:'draft',before:'unsafe-html-css',after:'sanitized',reason:'移除脚本、事件属性、外部资源和网络请求'});
  if(value.html!==undefined||value.css!==undefined){value.sanitized=true;value.sandboxOnly=true;}
  return value;
}

export function sanitizeSocialTemplateProposal(input,{draftMode='json',basePack=null}={}){
  if(!object(input))throw new SocialTemplateProposalError(SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.OUTPUT_INVALID,'Social 模板提案必须是对象');
  const repairs=[],value=structuredClone(input),pack=basePack||getSocialCardTemplatePack(packId(value.baseTemplatePack))||getSocialCardTemplatePack('standard-v1');
  for(const field of SYSTEM_FIELDS)if(Object.hasOwn(value,field)){delete value[field];repairs.push({field,before:'model-field',after:null,reason:'移除服务端系统字段'});}
  for(const field of ['label','description'])if(value[field]!==undefined)value[field]=cleanText(value[field],repairs,field,field==='label'?30:240);
  value.visualDirection=normalizeVisualDirection(value.visualDirection,repairs);
  value.roles=normalizeRoles(value.roles,pack,repairs);
  value.surface=normalizeSurface(value.surface,repairs);
  if(draftMode==='json'&&value.draft!==undefined){delete value.draft;repairs.push({field:'draft',before:'model-draft',after:null,reason:'JSON 模式不接受 HTML/CSS 草稿'});}
  if(draftMode==='html-css'&&value.draft)value.draft=sanitizeDraft(value.draft,repairs);
  if(draftMode==='html-css'&&value.draft&&!value.draft.html&&!value.draft.css){delete value.draft;repairs.push({field:'draft',before:'empty',after:null,reason:'空草稿不进入提案'});}
  validateSocialTemplateProposal(value);
  if(value.draft){value.draft.sanitized=true;value.draft.sandboxOnly=true;}
  return {proposal:value,repairs};
}

function rolePrompt(pack){return Object.entries(pack.roles).map(([role,value])=>`- ${role}：${value.template}；支持 ${value.supportedBlocks.join('、')}；块上限 ${value.maxBlocks}；条目上限 ${value.maxItems}`).join('\n');}
function themePrompt(theme){if(!theme)return '';return `\n参考主题方向（只用于理解，不要输出主题 Token）：${JSON.stringify({label:theme.label,description:theme.description,tags:theme.tags||[],recipes:theme.social?.recipes||{},effects:theme.social?.effects||{}})}`;}

export function buildSocialTemplateProposalMessages(request,{basePack,baseTheme=null}={}){
  const pack=basePack||getSocialCardTemplatePack(request.baseTemplatePack)||getSocialCardTemplatePack('standard-v1');
  const roleShape=Object.fromEntries(SOCIAL_CARD_PAGE_ROLES.map((role)=>[role,{layout:pack.roles[role].template,maxBlocks:pack.roles[role].maxBlocks,maxItems:pack.roles[role].maxItems,supportedBlocks:pack.roles[role].supportedBlocks.slice(0,3),notes:'该页面角色的可复用承载建议'}]));
  const outputShape={label:'差异化模板名称',description:'说明适用的内容承载方式与阅读气质',visualDirection:['terminal','grid','mono'],baseTemplatePack:pack.id,roles:roleShape,surface:{density:'standard',decoration:'grid-line',headingTreatment:'accent-bar'}};
  const draftLine=request.draftMode==='html-css'?'可选输出 draft.html 与 draft.css；它们只用于隔离预览，必须设置在 draft 对象内，不得输出脚本、事件属性、外链资源或网络请求。':'不要输出 draft、HTML、CSS、脚本、URL 或任何网页代码。';
  return [
    {role:'system',protected:true,content:`你是 Social 图文模板提案设计器。只返回一个严格 JSON 对象，不要 Markdown、代码围栏或解释。顶层只能包含 label、description、visualDirection、baseTemplatePack、roles、surface${request.draftMode==='html-css'?',draft':''}。不得输出 proposalId、status、source、provenance、id、version、targets 或主题 Token。目标固定为 Social 图文；模板提案描述的是可复用的页面角色版式，不是故事板内容，也不是固定卡片数量。\n基础模板包：${pack.id} v${pack.version}（${pack.label}）。请在其基础上形成差异化但可实现的版式建议。\n当前能力：\n${rolePrompt(pack)}\n${draftLine}\n输出结构示例（必须保留全部字段和全部十个角色，只替换示例值）：${JSON.stringify(outputShape)}\n硬性契约：visualDirection 必须是不重复的 1–12 项字符串数组，不能返回单个字符串；十个角色必须全部出现，roles 必须是且只能是这十个角色的对象：${SOCIAL_CARD_PAGE_ROLES.join('、')}，每个角色都必须包含 layout、maxBlocks、maxItems、supportedBlocks；supportedBlocks 只能使用：${SOCIAL_CARD_RENDERER_BLOCK_TYPES.join('、')}；layout 只能是安全 kebab-case ID；maxBlocks 1–6；maxItems 1–12；surface.density 只能是 compact、standard 或 airy，surface.decoration 和 surface.headingTreatment 也只能使用契约枚举。${themePrompt(baseTheme)}`},
    {role:'user',protected:true,content:`模板提案意图：${request.prompt}\n基础模板包：${pack.id}\n${baseTheme?.label?`当前主题：${baseTheme.label}`:''}`},
  ];
}

function parseJson(content){if(typeof content!=='string')throw new Error('模型未返回文本');return JSON.parse(content);}
async function parseWithRepair(gateway,result,{provider,signal}){
  try{return {candidate:parseJson(result.content),formatRepaired:false,result};}
  catch(firstError){
    if(signal?.aborted)throw new SocialTemplateProposalError(SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.GENERATION_CANCELLED,'Social 模板提案生成已取消');
    const repaired=await gateway.complete({provider,purpose:'social-template-proposal-format-repair',jsonMode:true,thinking:false,temperature:0,maxOutputTokens:7000,signal,messages:[{role:'system',protected:true,content:'将输入修复为严格 JSON 对象，只修复 JSON 格式，不改变语义，不新增 HTML/CSS、脚本或解释。'},{role:'user',protected:true,content:String(result.content||'').slice(0,40000)}]});
    try{return {candidate:parseJson(repaired.content),formatRepaired:true,result:repaired};}catch{throw new SocialTemplateProposalError(SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.MODEL_OUTPUT_INVALID,'模型未返回有效的 Social 模板提案 JSON',[issue('proposal','INVALID_JSON',firstError.message)]);}
  }
}

export async function generateSocialTemplateProposal({gateway,request,candidateStore,basePack,baseTheme=null,signal}={}){
  const input=validateSocialTemplateProposalRequest(request),pack=basePack||getSocialCardTemplatePack(input.baseTemplatePack)||getSocialCardTemplatePack('standard-v1'),provider=request.provider||gateway?.config?.defaultProvider,providerConfig=gateway?.config?.providers?.[provider];
  if(!providerConfig)throw new SocialTemplateProposalError(SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.MODEL_UNAVAILABLE,'没有可用的 AI 模板提案模型');
  if(signal?.aborted)throw new SocialTemplateProposalError(SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.GENERATION_CANCELLED,'Social 模板提案生成已取消');
  let generated;
  try{generated=await gateway.complete({provider,purpose:'social-template-proposal',jsonMode:true,thinking:false,temperature:.35,maxOutputTokens:Math.min(7000,providerConfig.maxOutputTokens||7000),signal,messages:buildSocialTemplateProposalMessages(input,{basePack:pack,baseTheme})});}
  catch(error){if(error instanceof SocialTemplateProposalError)throw error;throw new SocialTemplateProposalError(SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.MODEL_UNAVAILABLE,`Social 模板提案生成失败：${error.message}`,[issue('model','CALL_FAILED',error.message)]);}
  const parsed=await parseWithRepair(gateway,generated,{provider,signal}),sanitized=sanitizeSocialTemplateProposal(parsed.candidate,{draftMode:input.draftMode,basePack:pack}),proposal={schemaVersion:1,proposalId:`proposal-social-${crypto.randomUUID().slice(0,12)}`,target:'social',label:sanitized.proposal.label,description:sanitized.proposal.description,visualDirection:sanitized.proposal.visualDirection,baseTemplatePack:pack.id,roles:sanitized.proposal.roles,surface:sanitized.proposal.surface,...sanitized.proposal.draft?{draft:sanitized.proposal.draft}:{},status:input.draftMode==='html-css'&&sanitized.proposal.draft?'preview-only':'draft',source:input.draftMode==='html-css'&&sanitized.proposal.draft?'ai-html-draft':'ai-proposal',provenance:{model:parsed.result.model||providerConfig.model||'',promptVersion:SOCIAL_TEMPLATE_PROPOSAL_PROMPT_VERSION,createdAt:new Date().toISOString(),...(input.baseThemeId?{baseThemeId:input.baseThemeId}:{} )}};
  validateSocialTemplateProposal(proposal,{allowSystemFields:true});
  if(signal?.aborted)throw new SocialTemplateProposalError(SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.GENERATION_CANCELLED,'Social 模板提案生成已取消');
  return candidateStore.put({proposal,repairs:[...(parsed.formatRepaired?[{field:'proposal',before:'invalid-json',after:'valid-json',reason:'执行一次模型格式修复'}]:[]),...sanitized.repairs],request:input,model:{serviceId:parsed.result.provider||provider,model:parsed.result.model||providerConfig.model||'',callId:parsed.result.callId||null},promptVersion:SOCIAL_TEMPLATE_PROPOSAL_PROMPT_VERSION});
}
