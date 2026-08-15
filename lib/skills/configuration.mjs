import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWriteJson } from '../core/atomic-file.mjs';

export const SYSTEM_GATES = Object.freeze([
  'authorized_local_paths', 'authorized_external_write', 'no_arbitrary_code',
  'no_fabricated_sources', 'no_fabricated_experience',
]);

export const DEFAULT_GATES = Object.freeze({
  length:{ minVisibleChars:1300, maxVisibleChars:2000 },
  facts:{ unverifiedClaims:'error', missingAttribution:'error', modelSuggestionAsExperience:'error' },
  voice:{ firstPerson:'allow_with_author_source', personalTestClaim:'require_author_experience' },
  repair:{ enabled:true, maxAttempts:1 },
});

function activePath(workspaceRoot, skillId) {
  return path.join(workspaceRoot, 'writing-skills', skillId, 'active.json');
}

export function readActiveSkillConfig(workspaceRoot, skillId) {
  const file = activePath(workspaceRoot, skillId);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed=JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...parsed, ...normalizeSkillConfig(parsed) };
  } catch(error) {
    throw new Error(`技能 ${skillId} 的 active.json 无效：${error.message}`);
  }
}

export function writeActiveSkillConfig(workspaceRoot, skillId, config) {
  const file = activePath(workspaceRoot, skillId);
  atomicWriteJson(file,config);
  return file;
}

// 阶段 4a：active.json 版本协商与 hash 链。历史遗留文件（无 version/configHash）按 legacy 读取，
// 下次通过 writeVersionedSkillConfig 写入时自动升级为 version 1。
export function activeConfigIntegrity(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {ok:false,status:'broken',reason:'配置不是对象'};
  if(raw.version===undefined&&raw.configHash===undefined)return {ok:true,status:'legacy'};
  const {configHash:stored,...payload}=raw;
  if(typeof stored!=='string'||!stored)return {ok:false,status:'broken',reason:'缺少 configHash'};
  return configHash(payload)===stored?{ok:true,status:'verified'}:{ok:false,status:'broken',reason:'configHash 与配置内容不一致'};
}

function readRawActiveSkillConfig(workspaceRoot,skillId){
  const file=activePath(workspaceRoot,skillId);
  if(!fs.existsSync(file))return null;
  return JSON.parse(fs.readFileSync(file,'utf8'));
}

export function describeActiveSkillConfig(workspaceRoot,skillId){
  const raw=readRawActiveSkillConfig(workspaceRoot,skillId);
  if(!raw)return {config:null,version:0,configHash:'',parentHash:'',integrity:'missing'};
  return {config:readActiveSkillConfig(workspaceRoot,skillId),version:Number(raw.version)||0,
    configHash:typeof raw.configHash==='string'?raw.configHash:'',parentHash:typeof raw.parentHash==='string'?raw.parentHash:'',
    integrity:activeConfigIntegrity(raw).status};
}

export function writeVersionedSkillConfig(workspaceRoot,skillId,config,{expectedVersion}={}){
  const existing=readRawActiveSkillConfig(workspaceRoot,skillId);
  const currentVersion=Number(existing?.version)||0;
  if(expectedVersion!==undefined&&expectedVersion!==null&&Number(expectedVersion)!==currentVersion){
    const error=new Error(`技能配置已被修改：当前版本 ${currentVersion}，请求基于版本 ${expectedVersion}`);
    error.code='CONFIG_VERSION_CONFLICT';error.currentVersion=currentVersion;throw error;
  }
  if(existing&&(existing.version!==undefined||existing.configHash!==undefined)){
    const integrity=activeConfigIntegrity(existing);
    if(!integrity.ok){
      const error=new Error(`技能配置完整性校验失败：${integrity.reason}`);
      error.code='CONFIG_INTEGRITY_BROKEN';throw error;
    }
  }
  const version=currentVersion+1,parentHash=typeof existing?.configHash==='string'?existing.configHash:'';
  const payload={...config,version,parentHash};
  const stored={...payload,configHash:configHash(payload)};
  atomicWriteJson(activePath(workspaceRoot,skillId),stored);
  return {version,parentHash,configHash:stored.configHash,config:readActiveSkillConfig(workspaceRoot,skillId)};
}

export function normalizeSkillConfig(input = {}, base = {}) {
  const baseGates = base.gates || {};
  const inputGates = input.gates || {};
  const length = { ...DEFAULT_GATES.length, ...(baseGates.length || {}), ...(inputGates.length || {}) };
  // 白名单语义：未配置（无字段）→ null（全放行，既有默认）；显式空数组 → 全部禁止（SKILL_NOT_ALLOWED）
  const authorizationInput=input.capabilityAuthorization?.capabilities??input.allowedTools??base.capabilityAuthorization?.capabilities??base.allowedTools??null;
  const tools=authorizationInput===null?null:[...new Set(authorizationInput.map(String).filter(Boolean))];
  return {
    prompt:String(input.prompt ?? base.prompt ?? ''),
    defaultModel:String(input.defaultModel ?? base.defaultModel ?? ''),
    capabilityAuthorization:tools===null?null:{mode:'allow-list',capabilities:tools},allowedTools:tools,
    gates:{
      ...DEFAULT_GATES, ...baseGates, ...inputGates,
      length:{
        minVisibleChars:Number(length.minVisibleChars),
        maxVisibleChars:Number(length.maxVisibleChars),
      },
      facts:{ ...DEFAULT_GATES.facts, ...(baseGates.facts || {}), ...(inputGates.facts || {}) },
      voice:{ ...DEFAULT_GATES.voice, ...(baseGates.voice || {}), ...(inputGates.voice || {}) },
      repair:{
        enabled:inputGates.repair?.enabled ?? baseGates.repair?.enabled ?? true,
        maxAttempts:Number(inputGates.repair?.maxAttempts ?? baseGates.repair?.maxAttempts ?? 1),
      },
    },
  };
}

export function validateSkillConfig(config, availableCapabilities = []) {
  const issues = [];
  const pushEnumIssue = (field, value, allowed) => {
    if (!allowed.includes(value)) issues.push({ field, level:'error', message:`${field} 必须是以下值之一：${allowed.join('、')}` });
  };
  if (!config.prompt.trim()) issues.push({ field:'prompt', level:'error', message:'Prompt 不能为空' });
  if (config.prompt.length > 100_000) issues.push({ field:'prompt', level:'error', message:'Prompt 超过 100000 字符上限' });
  const { minVisibleChars:min, maxVisibleChars:max } = config.gates.length;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 100 || max > 20000 || min > max) {
    issues.push({ field:'gates.length', level:'error', message:'字数范围必须是 100–20000 内的整数，且最小值不能超过最大值' });
  }
  const attempts = config.gates.repair.maxAttempts;
  if (!Number.isInteger(attempts) || attempts < 0 || attempts > 3) issues.push({ field:'gates.repair.maxAttempts', level:'error', message:'自动返工次数必须为 0–3' });
  if (typeof config.gates.repair.enabled !== 'boolean') issues.push({ field:'gates.repair.enabled', level:'error', message:'自动返工开关必须是布尔值' });
  for (const key of ['unverifiedClaims','missingAttribution','modelSuggestionAsExperience']) {
    pushEnumIssue(`gates.facts.${key}`, config.gates.facts?.[key], ['error','warning','off']);
  }
  pushEnumIssue('gates.voice.firstPerson', config.gates.voice?.firstPerson, ['off','allow','allow_with_author_source']);
  pushEnumIssue('gates.voice.personalTestClaim', config.gates.voice?.personalTestClaim, ['forbid','allow','require_author_experience']);
  for (const capability of config.allowedTools||[]) {
    if (!availableCapabilities.includes(capability)) issues.push({ field:'allowedTools', level:'error', message:`工具能力不存在：${capability}` });
  }
  if (/第一人称|亲测|我测试|我的体验/.test(config.prompt) && config.gates.voice?.firstPerson === 'off') {
    issues.push({ field:'gates.voice.firstPerson', level:'error', message:'Prompt 要求第一人称，但门禁禁止第一人称' });
  }
  if (/亲测|实测|我的体验/.test(config.prompt) && config.gates.voice?.personalTestClaim === 'forbid') {
    issues.push({ field:'gates.voice.personalTestClaim', level:'error', message:'Prompt 要求亲测表达，但体验门禁禁止该表达' });
  }
  return issues;
}

export function configHash(config) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex')}`;
}

export function dryRunSkillConfig(config, factBase = {}) {
  const issues = [];
  const serialized = JSON.stringify(factBase || {});
  if (config.gates.facts?.unverifiedClaims === 'error' && /"verified"\s*:\s*false/.test(serialized)) {
    issues.push({ gate:'unverifiedClaims', level:'error', message:'测试事实基座包含未核验事实' });
  }
  if (config.gates.facts?.missingAttribution === 'error' && /"source"\s*:\s*""/.test(serialized)) {
    issues.push({ gate:'missingAttribution', level:'error', message:'测试事实基座存在空来源' });
  }
  if (config.gates.facts?.modelSuggestionAsExperience === 'error' && /model_suggestion/.test(serialized) && /第一人称|亲测|实测/.test(config.prompt)) {
    issues.push({ gate:'modelSuggestionAsExperience', level:'error', message:'模型建议不能作为作者亲身体验' });
  }
  return { pass:!issues.some((item) => item.level === 'error'), issues, systemGates:[...SYSTEM_GATES] };
}

function allObjects(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  output.push(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) allObjects(child, output);
  return output;
}

export function evaluateConfiguredGates(config, { factBase = {}, output = '', visibleChars = null } = {}) {
  if (!config?.gates) return { pass:true, issues:[], warnings:[] };
  const issues=[];const objects=allObjects(factBase);
  const add=(rule,message)=>{
    const level=rule==='off'?'off':rule==='warning'?'warning':'error';
    if(level!=='off')issues.push({level,message});
  };
  if(config.gates.facts?.unverifiedClaims!=='off'&&objects.some((item)=>item?.verified===false||item?.status==='unverified')){
    add(config.gates.facts.unverifiedClaims,'事实基座包含未核验主张');
  }
  if(config.gates.facts?.missingAttribution!=='off'&&objects.some((item)=>{
    const claimLike=typeof item?.claim==='string'||typeof item?.fact==='string';
    return claimLike&&!item.source&&!item.url&&!(Array.isArray(item.sourceIds)&&item.sourceIds.length);
  }))add(config.gates.facts.missingAttribution,'事实性条目缺少来源归属');
  const hasModelSuggestion=objects.some((item)=>item?.source_level==='model_suggestion');
  if(hasModelSuggestion&&/我(?:亲测|实测|使用|部署|体验)|我的(?:测试|体验)/.test(output)){
    add(config.gates.facts?.modelSuggestionAsExperience,'模型建议被写成作者亲身体验');
  }
  const firstPerson=/我(?:认为|觉得|看|读|用|测|体验|部署)/.test(output);
  const hasAuthorExperience=objects.some((item)=>item?.source_level==='author_experience');
  if(firstPerson&&config.gates.voice?.firstPerson==='off')add('error','配置禁止第一人称表达');
  if(firstPerson&&config.gates.voice?.firstPerson==='allow_with_author_source'&&!hasAuthorExperience)add('error','第一人称表达缺少作者来源支持');
  if(/我(?:亲测|实测|使用|部署|体验)/.test(output)&&config.gates.voice?.personalTestClaim==='require_author_experience'&&!hasAuthorExperience)add('error','亲测声明缺少作者真实体验支持');
  if(Number.isFinite(visibleChars)){
    const {minVisibleChars:min,maxVisibleChars:max}=config.gates.length||{};
    // 字数只作警告：超限可在编辑器手动删减，不阻断生成与保存
    if(Number.isFinite(min)&&visibleChars<min)add('warning',`可见字符 ${visibleChars} 少于配置下限 ${min}`);
    if(Number.isFinite(max)&&visibleChars>max)add('warning',`可见字符 ${visibleChars} 超过配置上限 ${max}`);
  }
  return {pass:!issues.some((item)=>item.level==='error'),issues:issues.filter((item)=>item.level==='error'),warnings:issues.filter((item)=>item.level==='warning')};
}

export function configuredRepairAttempts(config, fallback = 1) {
  if (!config?.gates?.repair) return fallback;
  if (config.gates.repair.enabled === false) return 0;
  return Number.isInteger(Number(config.gates.repair.maxAttempts)) ? Number(config.gates.repair.maxAttempts) : fallback;
}
