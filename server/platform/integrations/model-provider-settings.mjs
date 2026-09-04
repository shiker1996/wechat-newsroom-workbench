import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from '../core/env.mjs';
import { atomicWriteJson } from '../core/atomic-file.mjs';
import { applyModelProviderConfiguration } from '../extensions/model-provider-configuration.mjs';
import { clearRemoteCredential, credentialFieldsStatus, setCredentialFields } from '../tools/remote-credentials.mjs';

const LEGACY_ENV = Object.freeze({
  deepseek: 'DEEPSEEK_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  kimi: 'MOONSHOT_API_KEY',
});

const MODEL_PROVIDER_EXTENSION_TYPE='model-provider';
const MODEL_RUNTIME_EXTENSION_TYPE='system';
const MODEL_RUNTIME_EXTENSION_ID='llm-runtime';
const MODEL_PROVIDER_FIELDS=['label','baseUrl','model','protocol','contextWindow','maxOutputTokens','maxTokensField','taggingChunkSize','taggingConcurrency','supportsJsonMode','supportsNativeTools','supportsToolCallStreaming','supportsThinkingToggle','responsesReasoningToggle','thinkingReserveTokens','reasoningEffort','enabled'];

export function apiKeyEnvForProvider(id) {
  const name=String(id||'').trim().toLowerCase();
  return LEGACY_ENV[name]||`MODEL_PROVIDER_${name.replace(/[^a-z0-9]/g,'_').toUpperCase()}_API_KEY`;
}

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

function removeEnvKeys(filePath,keys) {
  if(!fs.existsSync(filePath)||!keys.size)return;
  const current=fs.readFileSync(filePath,'utf8');
  const kept=current.split(/\r?\n/).filter((line)=>{
    const match=line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    return !match||!keys.has(match[1]);
  }).join('\n').replace(/^\n+|\n+$/g,'');
  fs.writeFileSync(filePath,kept?`${kept}\n`:'','utf8');
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
  const apiKeyEnv=apiKeyEnvForProvider(id);
  return {id,provider:{
    label,baseUrl,model,apiKeyEnv,
    protocol:input.protocol==='responses'?'responses':'chat_completions',
    contextWindow:integer(input.contextWindow,128000,4096,4000000),
    maxOutputTokens:integer(input.maxOutputTokens,16384,256,200000),
    maxTokensField:input.maxTokensField==='max_completion_tokens'?'max_completion_tokens':'max_tokens',
    taggingChunkSize:integer(input.taggingChunkSize,6,1,20),
    taggingConcurrency:integer(input.taggingConcurrency,4,1,20),
    supportsJsonMode:input.supportsJsonMode!==false,
    supportsNativeTools:input.supportsNativeTools===true,
    supportsToolCallStreaming:input.supportsToolCallStreaming===true,
    enabled:input.enabled!==false,
  }};
}

function ordinaryProviderValues(provider={}) {
  const values=Object.fromEntries(MODEL_PROVIDER_FIELDS.flatMap((key)=>provider[key]===undefined?[]:[[key,provider[key]]]));
  if(provider.webSearchConfig?.payloadKey){
    values.webSearchPayloadKey=provider.webSearchConfig.payloadKey;
    values.webSearchPayloadValue=String(provider.webSearchConfig.payloadValue);
  }
  return values;
}

function providerFromRecord(id,record,declared={}) {
  const base={...declared,apiKeyEnv:declared.apiKeyEnv||apiKeyEnvForProvider(id)};
  return applyModelProviderConfiguration(base,record?.value||{});
}

function persistProviderRecord(root,repository,id,provider,apiKey='') {
  if(apiKey) setCredentialFields(root,id,`model-provider-${id}`,{apiKey});
  const credential=credentialFieldsStatus(root,`model-provider-${id}`,['apiKey']);
  return repository.save({extensionType:MODEL_PROVIDER_EXTENSION_TYPE,extensionId:id,value:ordinaryProviderValues(provider),configured:credential.configured,status:credential.configured?'ready':'needs_configuration'});
}

function persistDefaultProvider(repository,id) {
  repository.save({extensionType:MODEL_RUNTIME_EXTENSION_TYPE,extensionId:MODEL_RUNTIME_EXTENSION_ID,value:{defaultProvider:id},configured:Boolean(id),status:'ready'});
}

export function syncModelProvidersToDatabase({root,config,repository,cleanupLegacy=true}={}) {
  if(!repository||!config?.llm)return config;
  const declared={...config.llm.providers};
  const legacyEnvPath=path.join(root,'.env');
  const legacyEnv=fs.existsSync(legacyEnvPath)?parseEnv(fs.readFileSync(legacyEnvPath,'utf8')):{};
  const migratedLegacyKeys=new Set();
  const records=new Map(repository.list(MODEL_PROVIDER_EXTENSION_TYPE).map((item)=>[item.extension_id,item]));

  // 首次启动把 config.local.json 中的模型声明和旧 .env 密钥迁入统一配置中心。
  for(const [id,provider] of Object.entries(declared)){
    const record=records.get(id);
    const legacyKey=legacyEnv[provider.apiKeyEnv];
    if(legacyKey)migratedLegacyKeys.add(provider.apiKeyEnv);
    if(!record){
      const created=persistProviderRecord(root,repository,id,provider,legacyKey||'');
      records.set(id,created);
    }else if(legacyKey&&!credentialFieldsStatus(root,`model-provider-${id}`,['apiKey']).configured){
      setCredentialFields(root,id,`model-provider-${id}`,{apiKey:legacyKey});
    }
  }

  // 数据库中存在、但本地配置文件已没有声明的自定义模型，也必须恢复到运行时注册表。
  for(const [id,record] of records){
    config.llm.providers[id]=providerFromRecord(id,record,declared[id]||{});
  }
  const runtime=repository.get(MODEL_RUNTIME_EXTENSION_TYPE,MODEL_RUNTIME_EXTENSION_ID);
  let defaultProvider=runtime?.value?.defaultProvider||config.llm.defaultProvider;
  if(!config.llm.providers[defaultProvider]||config.llm.providers[defaultProvider].enabled===false){
    defaultProvider=Object.entries(config.llm.providers).find(([,provider])=>provider.enabled!==false)?.[0]||'';
  }
  config.llm.defaultProvider=defaultProvider;
  if(!runtime||runtime.value?.defaultProvider!==defaultProvider)persistDefaultProvider(repository,defaultProvider);

  if(cleanupLegacy){
    removeEnvKeys(legacyEnvPath,migratedLegacyKeys);
    const localPath=path.join(root,'config.local.json');
    if(fs.existsSync(localPath)){
      const local=JSON.parse(fs.readFileSync(localPath,'utf8'));
      if(local.llm&&(!Object.keys(local.llm).length||'providers' in local.llm||'defaultProvider' in local.llm)){
        delete local.llm.providers;
        delete local.llm.defaultProvider;
        if(!Object.keys(local.llm).length)delete local.llm;
        writeJsonAtomic(localPath,local);
      }
    }
  }
  return config;
}

export function syncModelProviderFromDatabase(config,repository,id) {
  const record=repository?.get?.(MODEL_PROVIDER_EXTENSION_TYPE,id);
  if(!record)return config?.llm?.providers?.[id];
  const provider=providerFromRecord(id,record,config.llm.providers[id]||{});
  config.llm.providers[id]=provider;
  return provider;
}

export function createModelProvider(root,config,input={},options={}) {
  const {id,provider}=normalizeProviderInput(input);
  if(config.llm?.providers?.[id])throw new Error(`模型配置 ${id} 已存在`);
  if(options.repository){
    config.llm.providers[id]=provider;
    persistProviderRecord(root,options.repository,id,provider,typeof input.apiKey==='string'?input.apiKey.trim():'');
    if(input.makeDefault===true||!config.llm.providers[config.llm.defaultProvider]){
      config.llm.defaultProvider=id;
      persistDefaultProvider(options.repository,id);
    }
    return id;
  }
  const localPath=path.join(root,'config.local.json');
  const local=fs.existsSync(localPath)?JSON.parse(fs.readFileSync(localPath,'utf8')):{};
  local.llm=local.llm||{};local.llm.providers=local.llm.providers||{};
  local.llm.providers[id]=provider;
  config.llm.providers[id]=provider;
  writeJsonAtomic(localPath,local);
  return id;
}

export function saveModelProvider(root,config,input={},options={}) {
  const existingId=String(input.existingId||'').trim().toLowerCase();
  const {id,provider}=normalizeProviderInput(input,existingId);
  const previous=config.llm.providers[existingId||id];
  if(previous?.webSearchConfig)provider.webSearchConfig=previous.webSearchConfig;
  if(input.protocol==null&&previous?.protocol)provider.protocol=previous.protocol;
  if(previous?.supportsThinkingToggle)provider.supportsThinkingToggle=true;
  if(previous?.supportsNativeTools)provider.supportsNativeTools=true;
  if(previous?.supportsToolCallStreaming)provider.supportsToolCallStreaming=true;
  if(previous?.thinkingReserveTokens!=null)provider.thinkingReserveTokens=previous.thinkingReserveTokens;
  if(previous?.reasoningEffort)provider.reasoningEffort=previous.reasoningEffort;
  if(existingId&&existingId!==id&&config.llm.providers[id])throw new Error(`模型配置 ${id} 已存在`);
  if(options.repository){
    if(existingId&&existingId!==id){
      options.repository.remove(MODEL_PROVIDER_EXTENSION_TYPE,existingId);
      try{clearRemoteCredentialCompat(root,existingId);}catch{}
      delete config.llm.providers[existingId];
    }
    config.llm.providers[id]=provider;
    persistProviderRecord(root,options.repository,id,provider,typeof input.apiKey==='string'?input.apiKey.trim():'');
    if(input.makeDefault===true||!config.llm.providers[config.llm.defaultProvider])config.llm.defaultProvider=id;
    if(provider.enabled===false&&config.llm.defaultProvider===id){
      const replacement=Object.entries(config.llm.providers).find(([name,item])=>name!==id&&item.enabled!==false);
      if(!replacement)throw new Error('默认模型不能停用；请先启用或新增另一个模型');
      config.llm.defaultProvider=replacement[0];
    }
    persistDefaultProvider(options.repository,config.llm.defaultProvider);
    return id;
  }
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

export function deleteModelProvider(root,config,id,options={}) {
  const name=String(id||'').trim().toLowerCase();
  if(!config.llm.providers[name])throw new Error('模型配置不存在');
  const remaining=Object.entries(config.llm.providers).find(([key,item])=>key!==name&&item.enabled!==false);
  if(config.llm.defaultProvider===name&&!remaining)throw new Error('至少保留一个启用的模型配置');
  if(options.repository){
    if(Object.hasOwn(LEGACY_ENV,name)){
      const disabled={...config.llm.providers[name],enabled:false};
      persistProviderRecord(root,options.repository,name,disabled);
    }else options.repository.remove(MODEL_PROVIDER_EXTENSION_TYPE,name);
    delete config.llm.providers[name];
    if(config.llm.defaultProvider===name){
      config.llm.defaultProvider=remaining?.[0]||'';
      persistDefaultProvider(options.repository,config.llm.defaultProvider);
    }
    try{clearRemoteCredentialCompat(root,name);}catch{}
    return name;
  }
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

function clearRemoteCredentialCompat(root,id){
  clearRemoteCredential(root,id,`model-provider-${id}`);
}

export function modelSecretConfigured(root,provider) {
  const values=parseEnv(fs.existsSync(path.join(root,'.env'))?fs.readFileSync(path.join(root,'.env'),'utf8'):'');
  return Boolean(values[provider.apiKeyEnv]||process.env[provider.apiKeyEnv]);
}
