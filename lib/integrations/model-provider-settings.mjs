import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from '../core/env.mjs';
import { atomicWriteJson } from '../core/atomic-file.mjs';

const LEGACY_ENV = Object.freeze({
  deepseek: 'DEEPSEEK_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  kimi: 'MOONSHOT_API_KEY',
});

function writeJsonAtomic(filePath, value) {
  atomicWriteJson(filePath,value);
}

function quoteEnv(value) {
  const text=String(value??'');
  return /^[A-Za-z0-9_./:@-]*$/.test(text)?text:JSON.stringify(text);
}

function updateEnv(filePath,key,value) {
  const current=fs.existsSync(filePath)?fs.readFileSync(filePath,'utf8'):'';
  let found=false;
  const lines=current.split(/\r?\n/).flatMap((line)=>{
    const match=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if(match?.[1]!==key)return [line];
    found=true;
    return value?[`${key}=${quoteEnv(value)}`]:[];
  });
  if(!found&&value)lines.push(`${key}=${quoteEnv(value)}`);
  fs.writeFileSync(filePath,`${lines.join('\n').replace(/^\n+|\n+$/g,'')}\n`,'utf8');
  if(value)process.env[key]=value;else delete process.env[key];
}

function providerId(input, existingId='') {
  const requested=String(input.id||existingId||'').trim().toLowerCase();
  if(requested&&!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(requested))throw new Error('模型配置 ID 只能包含小写字母、数字、短横线和下划线');
  return requested||`custom-${crypto.randomUUID().slice(0,8)}`;
}

export function normalizeProviderInput(input={},existingId='') {
  const id=providerId(input,existingId);
  const label=String(input.label||'').trim();
  const baseUrl=String(input.baseUrl||'').trim().replace(/\/+$/,'');
  const model=String(input.model||'').trim();
  if(!label)throw new Error('请填写配置名称');
  if(!model)throw new Error('请填写模型名称');
  let parsed;try{parsed=new URL(baseUrl);}catch{throw new Error('Base URL 格式无效');}
  if(!['http:','https:'].includes(parsed.protocol))throw new Error('Base URL 仅支持 HTTP 或 HTTPS');
  const integer=(value,fallback,min,max)=>{
    const number=Number(value??fallback);
    if(!Number.isInteger(number)||number<min||number>max)throw new Error(`模型参数必须在 ${min}–${max} 之间`);
    return number;
  };
  const apiKeyEnv=LEGACY_ENV[id]||`MODEL_PROVIDER_${id.replace(/[^a-z0-9]/g,'_').toUpperCase()}_API_KEY`;
  return {id,provider:{
    label,baseUrl,model,apiKeyEnv,
    contextWindow:integer(input.contextWindow,128000,4096,4000000),
    maxOutputTokens:integer(input.maxOutputTokens,16384,256,200000),
    maxTokensField:input.maxTokensField==='max_completion_tokens'?'max_completion_tokens':'max_tokens',
    taggingChunkSize:integer(input.taggingChunkSize,6,1,20),
    taggingConcurrency:integer(input.taggingConcurrency,4,1,20),
    supportsJsonMode:input.supportsJsonMode!==false,
    enabled:input.enabled!==false,
  }};
}

export function createModelProvider(root,config,input={}) {
  const {id,provider}=normalizeProviderInput(input);
  if(config.llm?.providers?.[id])throw new Error(`模型配置 ${id} 已存在`);
  const localPath=path.join(root,'config.local.json');
  const local=fs.existsSync(localPath)?JSON.parse(fs.readFileSync(localPath,'utf8')):{};
  local.llm=local.llm||{};local.llm.providers=local.llm.providers||{};
  local.llm.providers[id]=provider;
  config.llm.providers[id]=provider;
  writeJsonAtomic(localPath,local);
  return id;
}

export function saveModelProvider(root,config,input={}) {
  const existingId=String(input.existingId||'').trim().toLowerCase();
  const {id,provider}=normalizeProviderInput(input,existingId);
  const previous=config.llm.providers[existingId||id];
  if(previous?.webSearchConfig)provider.webSearchConfig=previous.webSearchConfig;
  if(previous?.supportsThinkingToggle)provider.supportsThinkingToggle=true;
  if(previous?.thinkingReserveTokens!=null)provider.thinkingReserveTokens=previous.thinkingReserveTokens;
  if(previous?.reasoningEffort)provider.reasoningEffort=previous.reasoningEffort;
  if(existingId&&existingId!==id&&config.llm.providers[id])throw new Error(`模型配置 ${id} 已存在`);
  const localPath=path.join(root,'config.local.json');
  const local=fs.existsSync(localPath)?JSON.parse(fs.readFileSync(localPath,'utf8')):{};
  local.llm=local.llm||{};local.llm.providers=local.llm.providers||{};
  if(existingId&&existingId!==id){delete local.llm.providers[existingId];delete config.llm.providers[existingId];}
  local.llm.providers[id]=provider;
  if(input.makeDefault===true||!config.llm.providers[config.llm.defaultProvider]){
    local.llm.defaultProvider=id;config.llm.defaultProvider=id;
  }
  config.llm.providers[id]=provider;
  if(provider.enabled===false&&config.llm.defaultProvider===id){
    const replacement=Object.entries(config.llm.providers).find(([name,item])=>name!==id&&item.enabled!==false);
    if(!replacement)throw new Error('默认模型不能停用；请先启用或新增另一个模型');
    config.llm.defaultProvider=replacement[0];local.llm.defaultProvider=replacement[0];
  }
  writeJsonAtomic(localPath,local);
  const apiKey=typeof input.apiKey==='string'?input.apiKey.trim():'';
  if(apiKey)updateEnv(path.join(root,'.env'),provider.apiKeyEnv,apiKey);
  return id;
}

export function deleteModelProvider(root,config,id) {
  const name=String(id||'').trim().toLowerCase();
  if(!config.llm.providers[name])throw new Error('模型配置不存在');
  const remaining=Object.entries(config.llm.providers).find(([key,item])=>key!==name&&item.enabled!==false);
  if(config.llm.defaultProvider===name&&!remaining)throw new Error('至少保留一个启用的模型配置');
  const localPath=path.join(root,'config.local.json');
  const local=fs.existsSync(localPath)?JSON.parse(fs.readFileSync(localPath,'utf8')):{};
  local.llm=local.llm||{};local.llm.providers=local.llm.providers||{};
  if(Object.hasOwn(LEGACY_ENV,name))local.llm.providers[name]={enabled:false};
  else delete local.llm.providers[name];
  delete config.llm.providers[name];
  if(config.llm.defaultProvider===name){
    config.llm.defaultProvider=remaining[0];local.llm.defaultProvider=remaining[0];
  }
  writeJsonAtomic(localPath,local);
  return name;
}

export function modelSecretConfigured(root,provider) {
  const values=parseEnv(fs.existsSync(path.join(root,'.env'))?fs.readFileSync(path.join(root,'.env'),'utf8'):'');
  return Boolean(values[provider.apiKeyEnv]||process.env[provider.apiKeyEnv]);
}
