import { validateThemeDefinition, ThemeValidationError } from './theme-validator.mjs';

export const AI_THEME_ERROR_CODES=Object.freeze({
  INPUT_INVALID:'AI_THEME_INPUT_INVALID',
  OUTPUT_INVALID:'AI_THEME_OUTPUT_INVALID',
  SYSTEM_FIELD_FORBIDDEN:'AI_THEME_SYSTEM_FIELD_FORBIDDEN',
  TARGET_MISMATCH:'AI_THEME_TARGET_MISMATCH',
  OUTPUT_UNSAFE:'AI_THEME_OUTPUT_UNSAFE',
  MODEL_UNAVAILABLE:'AI_THEME_MODEL_UNAVAILABLE',
  MODEL_OUTPUT_INVALID:'AI_THEME_MODEL_OUTPUT_INVALID',
  CANDIDATE_EXPIRED:'AI_THEME_CANDIDATE_EXPIRED',
  RATE_LIMITED:'AI_THEME_RATE_LIMITED',
  GENERATION_CANCELLED:'AI_THEME_GENERATION_CANCELLED',
});

const TARGETS=new Set(['article','social','cover']);
const REQUEST_FIELDS=new Set(['target','prompt','preferences']);
const PREFERENCE_FIELDS=new Set(['scene','tone','brightness','accentColor','readingPriority']);
const TONES=new Set(['restrained','editorial','playful','bold','warm','futuristic']);
const BRIGHTNESS=new Set(['auto','light','dark']);
const READING_PRIORITIES=new Set(['long-form','density','impact']);
const CANDIDATE_FIELDS=new Set(['label','description','tags','tokens','targetConfig','designSummary']);
const SYSTEM_FIELDS=new Set(['schemaVersion','id','version','targets','status','source','basedOn','hash','file','owner_scope','active_version_id','created_at','updated_at','article','social']);
const SUMMARY_FIELDS=new Set(['title','description']);
const HEX=/^#[0-9a-f]{6}$/i;
const UNSAFE_TEXT=/<\/?[a-z][^>]*>|```|javascript\s*:|https?:\/\/|@import|url\s*\(/i;

export class AiThemeContractError extends Error {
  constructor(code,message,issues=[]){super(message);this.name='AiThemeContractError';this.code=code;this.issues=issues;}
}

function object(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function issue(field,code,message){return {field,code,message};}
function unknownFields(value,allowed,prefix=''){
  return Object.keys(value||{}).filter((key)=>!allowed.has(key)).map((key)=>issue(prefix?`${prefix}.${key}`:key,'UNKNOWN_FIELD','未知字段'));
}
function throwIssues(code,message,issues){if(issues.length)throw new AiThemeContractError(code,message,issues);}
function safeText(value,min,max,field,issues){
  if(typeof value!=='string'||[...value.trim()].length<min||[...value.trim()].length>max)issues.push(issue(field,'LENGTH',`必须为 ${min}–${max} 个字符`));
  else if(UNSAFE_TEXT.test(value))issues.push(issue(field,'UNSAFE_TEXT','不得包含 HTML、代码、URL 或样式表达式'));
}

export function validateAiThemeRequest(input){
  const issues=[];
  if(!object(input))throw new AiThemeContractError(AI_THEME_ERROR_CODES.INPUT_INVALID,'AI 主题创建请求无效',[issue('request','TYPE','必须是对象')]);
  issues.push(...unknownFields(input,REQUEST_FIELDS));
  if(!TARGETS.has(input.target))issues.push(issue('target','ENUM','必须为 article、social 或 cover'));
  safeText(input.prompt,20,500,'prompt',issues);
  const preferences=input.preferences??{};
  if(!object(preferences))issues.push(issue('preferences','TYPE','必须是对象'));
  else {
    issues.push(...unknownFields(preferences,PREFERENCE_FIELDS,'preferences'));
    if(preferences.scene!==undefined)safeText(preferences.scene,1,40,'preferences.scene',issues);
    if(preferences.tone!==undefined&&(!Array.isArray(preferences.tone)||preferences.tone.length>3||new Set(preferences.tone).size!==preferences.tone.length||preferences.tone.some((value)=>!TONES.has(value))))issues.push(issue('preferences.tone','ENUM','最多选择 3 个受支持的视觉气质'));
    if(preferences.brightness!==undefined&&!BRIGHTNESS.has(preferences.brightness))issues.push(issue('preferences.brightness','ENUM','明暗倾向不受支持'));
    if(preferences.accentColor!==undefined&&!HEX.test(preferences.accentColor))issues.push(issue('preferences.accentColor','FORMAT','必须是六位十六进制颜色'));
    if(preferences.readingPriority!==undefined&&!READING_PRIORITIES.has(preferences.readingPriority))issues.push(issue('preferences.readingPriority','ENUM','阅读优先级不受支持'));
  }
  throwIssues(AI_THEME_ERROR_CODES.INPUT_INVALID,'AI 主题创建请求无效',issues);
  return {target:input.target,prompt:input.prompt.trim(),preferences:structuredClone(preferences)};
}

export function validateAiThemeCandidate(candidate,{target}={}){
  const issues=[];
  if(!TARGETS.has(target))throw new AiThemeContractError(AI_THEME_ERROR_CODES.TARGET_MISMATCH,'AI 主题目标无效',[issue('target','ENUM','必须为 article、social 或 cover')]);
  if(!object(candidate))throw new AiThemeContractError(AI_THEME_ERROR_CODES.OUTPUT_INVALID,'AI 主题候选无效',[issue('candidate','TYPE','必须是对象')]);
  const forbidden=Object.keys(candidate).filter((key)=>SYSTEM_FIELDS.has(key));
  if(forbidden.length)throw new AiThemeContractError(AI_THEME_ERROR_CODES.SYSTEM_FIELD_FORBIDDEN,'AI 不得设置主题系统字段',forbidden.map((field)=>issue(field,'SYSTEM_FIELD_FORBIDDEN','由系统生成，不接受模型设置')));
  issues.push(...unknownFields(candidate,CANDIDATE_FIELDS));
  safeText(candidate.label,1,30,'label',issues);
  safeText(candidate.description,1,160,'description',issues);
  if(!Array.isArray(candidate.tags)||candidate.tags.length>12||new Set(candidate.tags).size!==candidate.tags.length||candidate.tags.some((value)=>typeof value!=='string'||!value.trim()||[...value].length>24||UNSAFE_TEXT.test(value)))issues.push(issue('tags','FORMAT','必须是不重复的安全短字符串数组，最多 12 项'));
  if(!object(candidate.tokens))issues.push(issue('tokens','TYPE','必须是完整 token 对象'));
  // 封面主题是纯 token 主题：targetConfig 允许缺省或为空对象
  if(target==='cover'?candidate.targetConfig!==undefined&&!object(candidate.targetConfig):!object(candidate.targetConfig))issues.push(issue('targetConfig','TYPE',target==='cover'?'必须省略或为空对象':'必须是目标配置对象'));
  if(!Array.isArray(candidate.designSummary)||candidate.designSummary.length<1||candidate.designSummary.length>6)issues.push(issue('designSummary','LENGTH','必须包含 1–6 条设计摘要'));
  else candidate.designSummary.forEach((item,index)=>{
    if(!object(item)){issues.push(issue(`designSummary.${index}`,'TYPE','必须是对象'));return;}
    issues.push(...unknownFields(item,SUMMARY_FIELDS,`designSummary.${index}`));
    safeText(item.title,1,20,`designSummary.${index}.title`,issues);
    safeText(item.description,1,100,`designSummary.${index}.description`,issues);
  });
  const unsafeIssue=issues.find((item)=>item.code==='UNSAFE_TEXT');
  if(unsafeIssue)throw new AiThemeContractError(AI_THEME_ERROR_CODES.OUTPUT_UNSAFE,'AI 主题候选包含不安全文本',issues);
  throwIssues(AI_THEME_ERROR_CODES.OUTPUT_INVALID,'AI 主题候选无效',issues);
  return structuredClone(candidate);
}

export function composeAiThemeDefinition(candidate,{target,id,version='0.1.0'}={}){
  const value=validateAiThemeCandidate(candidate,{target});
  const definition={
    schemaVersion:1,
    id,
    label:value.label.trim(),
    version,
    description:value.description.trim(),
    targets:[target],
    status:'draft',
    source:'user',
    basedOn:null,
    tags:value.tags.map((tag)=>tag.trim()),
    tokens:value.tokens,
    ...(target==='cover'?{}:{[target]:value.targetConfig}),
  };
  try{validateThemeDefinition(definition,{expectedTarget:target,expectedSource:'user'});}
  catch(error){
    if(error instanceof ThemeValidationError)throw new AiThemeContractError(AI_THEME_ERROR_CODES.OUTPUT_INVALID,'AI 主题候选不符合主题契约',error.issues);
    throw error;
  }
  return {definition,designSummary:structuredClone(value.designSummary)};
}
