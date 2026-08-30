import { validateThemeDefinition, ThemeValidationError } from '../../../shared/themes/theme-validator.mjs';
import { themeNumericLimits } from '../../../shared/themes/theme-numeric-limits.mjs';
import { getBuiltinThemeRegistry, themeHash } from '../../../shared/themes/theme-registry.mjs';
import { assertThemePublishable } from './theme-publish-gate.mjs';
import { getSocialCardTemplatePack } from '../../../shared/rendering/social-card-template-registry.mjs';
import { matchSocialTemplate, templateMatchMetadata } from '../../../shared/themes/social-template-matcher.mjs';
import { normalizeThemeMetadata } from '../../../shared/themes/theme-metadata.mjs';

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
function ensureSocialTemplateBinding(definition,{source='user-selected'}={}){
  if(!definition?.targets?.includes('social')||!definition.social||typeof definition.social!=='object')return definition;
  const configured=definition.social.templatePack;
  const pack=getSocialCardTemplatePack(configured?.id);
  const customPack=Boolean(configured?.roles&&configured?.roleTemplates&&/^proposal-[a-z0-9-]+-v\d+$/.test(String(configured.id||'')));
  if(customPack){
    definition.social.templateMatch=templateMatchMetadata({templatePack:{id:configured.id,version:configured.version},source:'user-selected',confidence:'high',reason:`已绑定自定义模板包 ${configured.label||configured.id}。`,signals:['用户确认模板提案']},{source:'user-selected'});
    return definition;
  }
  const validConfigured=Boolean(pack&&Number(configured?.version)===Number(pack.version));
  if(!validConfigured){
    const match=matchSocialTemplate({definition});
    definition.social.templatePack=match.templatePack;
    definition.social.templateMatch=templateMatchMetadata(match);
    return definition;
  }
  const previous=definition.social.templateMatch;
  if(!previous||previous.packId!==pack.id){
    definition.social.templateMatch=templateMatchMetadata({
      templatePack:{id:pack.id,version:pack.version},
      source:pack.id==='standard-v1'?'compatibility':source,
      confidence:pack.id==='standard-v1'?'low':'medium',
      reason:pack.id==='standard-v1'?'已使用标准兼容模板；如需专用视觉结构，请选择其他模板包。':`已绑定 ${pack.label}，来源为${source==='inherited'?'复制源主题':'用户选择'}。`,
      signals:[],
    },{source:pack.id==='standard-v1'?'compatibility':source});
  }
  return definition;
}
export function userThemeFromRow(row,{draft=false}={}){if(!row)return null;const definition=parse(draft?row.draft_json:row.active_definition_json)||parse(row.draft_json);if(!definition)return null;return {...definition,status:row.status,source:'user',hash:draft?themeHash(definition):(row.active_hash||themeHash(definition))};}
export function resolveWorkspaceTheme(store,id,target,{publishedOnly=true}={}){const builtin=getBuiltinThemeRegistry().get(id);if(builtin?.targets.includes(target))return builtin;const row=store?.getUserTheme?.(id);if(!row||!row.active_version_id||publishedOnly&&row.status!=='published')return null;const theme=userThemeFromRow(row);return theme.targets.includes(target)?theme:null;}
export function saveThemeDraft(store,{id,target,definition,basedOn=undefined,templateBindingSource='user-selected',metadata=null}){if(!ID.test(id||'')||id.length>64)throw new Error('主题 ID 必须是小写连字符格式，且不超过 64 字符');if(getBuiltinThemeRegistry().has(id))throw new Error('用户主题不能覆盖内置主题');assertSize(definition);const existing=store.getUserTheme(id);if(existing&&existing.target!==target)throw new Error('不能修改主题适用目标');const existingDraft=existing?userThemeFromRow(existing,{draft:true}):null;if(existingDraft?.targets?.includes('social')&&!existingDraft.social?.templatePack?.id)throw new Error('历史 Social 主题仅支持只读兼容查看，请复制为新主题后再编辑和发布');const normalized=clean(definition,{id,target,version:definition.version||existing?.active_version||'0.1.0',status:'draft',basedOn});ensureSocialTemplateBinding(normalized,{source:templateBindingSource});validateThemeDefinition(normalized,{expectedTarget:target,expectedSource:'user',enforceNumericSteps:true});const previousMetadata=existing?store.getThemeMetadata?.(id):null;const resolvedMetadata=normalizeThemeMetadata(metadata||previousMetadata||{}, {creationMethod:previousMetadata?.creationMethod||'manual',basedOn:basedOn===undefined?(previousMetadata?.basedOn||normalized.basedOn):basedOn,definition:normalized});store.saveUserThemeDraft({id,target,label:normalized.label,definitionJson:JSON.stringify(normalized),metadata:resolvedMetadata});return userThemeFromRow(store.getUserTheme(id),{draft:true});}
export function cloneTheme(store,{sourceId,id,label}){const source=resolveWorkspaceTheme(store,sourceId,'article')||resolveWorkspaceTheme(store,sourceId,'social')||resolveWorkspaceTheme(store,sourceId,'cover');if(!source)throw new Error(`未知可复制主题：${sourceId}`);const target=source.targets[0],definition=snapEditorSteps({...structuredClone(source),id,label:label||`${source.label}副本`},target),sourceMetadata=store.getThemeMetadata?.(source.id)||{};delete definition.hash;delete definition.file;return saveThemeDraft(store,{id,target,definition,basedOn:{id:source.id,version:source.version},metadata:{creationMethod:'clone',basedOn:{id:source.id,version:source.version},intent:sourceMetadata.intent||{},designSummary:sourceMetadata.designSummary||[]},templateBindingSource:'inherited'});}
export function publishTheme(store,id){const row=store.getUserTheme(id);if(!row)throw new Error(`未知用户主题：${id}`);const draft=userThemeFromRow(row,{draft:true});const version=nextVersion(row.active_version);const definition=clean(draft,{id,target:row.target,version,status:'published'});assertThemePublishable(definition,{target:row.target});const hash=themeHash(definition);const metadata=normalizeThemeMetadata(store.getThemeMetadata?.(id)||{},{creationMethod:'manual',definition});store.publishUserTheme({id,version,definitionJson:JSON.stringify(definition),contentHash:hash,metadata});return userThemeFromRow(store.getUserTheme(id));}
export function restoreThemeVersion(store,id,version){const row=store.getUserThemeVersion(id,version);if(!row)throw new Error('主题历史版本不存在');const definition=parse(row.definition_json);return saveThemeDraft(store,{id,target:definition.targets[0],definition:{...definition,status:'draft'},metadata:row.metadata||store.getThemeVersionMetadata?.(row.id)||store.getThemeMetadata?.(id)||null});}
export function normalizeImportedTheme(input,{id=null}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('导入内容必须是主题 JSON 对象');assertSize(input);const warnings=[];const value=structuredClone(input),metadata=value.metadata;delete value.metadata;
  if(value.schemaVersion===undefined){value.schemaVersion=1;warnings.push({code:'SCHEMA_INFERRED',message:'缺少 schemaVersion，已按兼容的 v1 结构补为 1'});}else if(value.schemaVersion!==1)throw new Error(`不支持主题 Schema v${value.schemaVersion}；当前仅支持 v1`);
  const target=Array.isArray(value.targets)&&value.targets.length===1?value.targets[0]:null;if(!TARGETS_FOR_IMPORT.has(target))throw new Error('导入主题必须且只能指定一个 article、social 或 cover 目标');const themeId=id||value.id;const definition=clean(value,{id:themeId,target,version:'0.1.0',status:'draft',basedOn:value.basedOn||null});return {definition,target,warnings,metadata:normalizeThemeMetadata({...metadata,creationMethod:'import'},{creationMethod:'import',basedOn:value.basedOn||null,definition})};
}
const TARGETS_FOR_IMPORT=new Set(['article','social','cover']);
export function importThemeDraft(store,{definition,id=null}){const normalized=normalizeImportedTheme(definition,{id});if(store.getUserTheme(normalized.definition.id))throw new Error('同 ID 用户主题已存在，请先修改导入 ID');return {theme:saveThemeDraft(store,{id:normalized.definition.id,target:normalized.target,definition:normalized.definition,metadata:normalized.metadata}),metadata:normalized.metadata,warnings:normalized.warnings};}
export function exportWorkspaceTheme(store,id,{draft=false}={}){const builtin=getBuiltinThemeRegistry().get(id);if(builtin){const {hash,file,...definition}=builtin;return definition;}const row=store.getUserTheme(id);if(!row)throw new Error(`未知主题：${id}`);const theme=userThemeFromRow(row,{draft});const {hash,...definition}=theme;const metadata=store.getThemeMetadata?.(id);return metadata?{...definition,metadata}:definition;}
