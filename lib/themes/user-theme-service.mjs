import { validateThemeDefinition, ThemeValidationError } from './theme-validator.mjs';
import { themeNumericLimits } from './theme-numeric-limits.mjs';
import { getBuiltinThemeRegistry, themeHash } from './theme-registry.mjs';
import { assertThemePublishable } from './theme-publish-gate.mjs';

const MAX_BYTES=64*1024,ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function parse(value,fallback=null){try{return JSON.parse(value)}catch{return fallback}}
function assertSize(value){if(Buffer.byteLength(JSON.stringify(value),'utf8')>MAX_BYTES)throw new ThemeValidationError([{field:'theme',code:'TOO_LARGE',message:'主题 JSON 不能超过 64KB'}]);}
function clean(input,{id,target,version='0.1.0',status='draft',basedOn=null}={}){
  const value=structuredClone(input||{});for(const key of ['hash','file','owner_scope','active_version_id','created_at','updated_at'])delete value[key];
  return {...value,schemaVersion:1,id,label:String(value.label||'我的主题').trim(),version,targets:[target],status,source:'user',basedOn:basedOn??value.basedOn??null};
}
function nextVersion(current){const match=String(current||'0.0.0').match(/^(\d+)\.(\d+)\.(\d+)$/);return match?`${match[1]}.${Number(match[2])+1}.0`:'1.0.0';}
function snapEditorSteps(definition,target){
  for(const [field,[min,,step]] of Object.entries(themeNumericLimits({target,source:'user'}))){const parts=field.split('.'),key=parts.pop(),parent=parts.reduce((value,part)=>value?.[part],definition);if(Number.isFinite(parent?.[key]))parent[key]=Number((min+Math.round((parent[key]-min)/step)*step).toFixed(6));}
  if(target==='social'){const effects=definition.social?.effects;if(Number.isFinite(effects?.decorationOpacity))effects.decorationOpacity=Number((Math.round(effects.decorationOpacity/.05)*.05).toFixed(2));if(Number.isFinite(effects?.contentTiltDeg))effects.contentTiltDeg=Number((Math.round(effects.contentTiltDeg/.1)*.1).toFixed(1));}
  return definition;
}
export function userThemeFromRow(row,{draft=false}={}){if(!row)return null;const definition=parse(draft?row.draft_json:row.active_definition_json)||parse(row.draft_json);if(!definition)return null;return {...definition,status:row.status,source:'user',hash:draft?themeHash(definition):(row.active_hash||themeHash(definition))};}
export function resolveWorkspaceTheme(store,id,target,{publishedOnly=true}={}){const builtin=getBuiltinThemeRegistry().get(id);if(builtin?.targets.includes(target))return builtin;const row=store?.getUserTheme?.(id);if(!row||!row.active_version_id||publishedOnly&&row.status!=='published')return null;const theme=userThemeFromRow(row);return theme.targets.includes(target)?theme:null;}
export function saveThemeDraft(store,{id,target,definition,basedOn=null}){if(!ID.test(id||'')||id.length>64)throw new Error('主题 ID 必须是小写连字符格式，且不超过 64 字符');if(getBuiltinThemeRegistry().has(id))throw new Error('用户主题不能覆盖内置主题');assertSize(definition);const existing=store.getUserTheme(id);if(existing&&existing.target!==target)throw new Error('不能修改主题适用目标');const normalized=clean(definition,{id,target,version:definition.version||existing?.active_version||'0.1.0',status:'draft',basedOn});validateThemeDefinition(normalized,{expectedTarget:target,expectedSource:'user',enforceNumericSteps:true});store.saveUserThemeDraft({id,target,label:normalized.label,definitionJson:JSON.stringify(normalized)});return userThemeFromRow(store.getUserTheme(id),{draft:true});}
export function cloneTheme(store,{sourceId,id,label}){const source=resolveWorkspaceTheme(store,sourceId,'article')||resolveWorkspaceTheme(store,sourceId,'social')||resolveWorkspaceTheme(store,sourceId,'cover');if(!source)throw new Error(`未知可复制主题：${sourceId}`);const target=source.targets[0],definition=snapEditorSteps({...structuredClone(source),id,label:label||`${source.label}副本`},target);delete definition.hash;delete definition.file;return saveThemeDraft(store,{id,target,definition,basedOn:{id:source.id,version:source.version}});}
export function publishTheme(store,id){const row=store.getUserTheme(id);if(!row)throw new Error(`未知用户主题：${id}`);const draft=userThemeFromRow(row,{draft:true});const version=nextVersion(row.active_version);const definition=clean(draft,{id,target:row.target,version,status:'published'});assertThemePublishable(definition,{target:row.target});const hash=themeHash(definition);store.publishUserTheme({id,version,definitionJson:JSON.stringify(definition),contentHash:hash});return userThemeFromRow(store.getUserTheme(id));}
export function restoreThemeVersion(store,id,version){const row=store.getUserThemeVersion(id,version);if(!row)throw new Error('主题历史版本不存在');const definition=parse(row.definition_json);return saveThemeDraft(store,{id,target:definition.targets[0],definition:{...definition,status:'draft'}});}
export function normalizeImportedTheme(input,{id=null}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('导入内容必须是主题 JSON 对象');assertSize(input);const warnings=[];const value=structuredClone(input);
  if(value.schemaVersion===undefined){value.schemaVersion=1;warnings.push({code:'SCHEMA_INFERRED',message:'缺少 schemaVersion，已按兼容的 v1 结构补为 1'});}else if(value.schemaVersion!==1)throw new Error(`不支持主题 Schema v${value.schemaVersion}；当前仅支持 v1`);
  const target=Array.isArray(value.targets)&&value.targets.length===1?value.targets[0]:null;if(!TARGETS_FOR_IMPORT.has(target))throw new Error('导入主题必须且只能指定一个 article、social 或 cover 目标');const themeId=id||value.id;return {definition:clean(value,{id:themeId,target,version:'0.1.0',status:'draft',basedOn:value.basedOn||null}),target,warnings};
}
const TARGETS_FOR_IMPORT=new Set(['article','social','cover']);
export function importThemeDraft(store,{definition,id=null}){const normalized=normalizeImportedTheme(definition,{id});if(store.getUserTheme(normalized.definition.id))throw new Error('同 ID 用户主题已存在，请先修改导入 ID');return {theme:saveThemeDraft(store,{id:normalized.definition.id,target:normalized.target,definition:normalized.definition}),warnings:normalized.warnings};}
export function exportWorkspaceTheme(store,id,{draft=false}={}){const builtin=getBuiltinThemeRegistry().get(id);if(builtin){const {hash,file,...definition}=builtin;return definition;}const row=store.getUserTheme(id);if(!row)throw new Error(`未知主题：${id}`);const theme=userThemeFromRow(row,{draft});const {hash,...definition}=theme;return definition;}
