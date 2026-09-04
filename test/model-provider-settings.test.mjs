import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createModelConnection, createModelProvider, deleteModelConnection, deleteModelProvider, modelProviderIdFor, normalizeProviderInput, saveModelProvider, syncModelProvidersToDatabase } from '../server/platform/integrations/model-provider-settings.mjs';

test('OpenAI 兼容模型配置校验并生成独立密钥变量',()=>{
  const result=normalizeProviderInput({label:'自定义',baseUrl:'https://api.example.com/v1/',model:'model-a'});
  assert.match(result.id,/^custom-/);
  assert.equal(result.provider.baseUrl,'https://api.example.com/v1');
  assert.match(result.provider.apiKeyEnv,/^MODEL_PROVIDER_CUSTOM_/);
  assert.throws(()=>normalizeProviderInput({label:'',baseUrl:'bad',model:''}),/配置名称/);
});

test('新模型默认按供应商和模型生成可读配置 ID，并处理冲突与长度',()=>{
  assert.equal(modelProviderIdFor({supplier:'OpenRouter',model:'deepseek/deepseek-v4-flash-0731'}),'openrouter-deepseek-deepseek-v4-flash-0731');
  assert.equal(modelProviderIdFor({supplier:'Qwen',model:'qwen3.8-flash',existingIds:['qwen-qwen3-8-flash']}),'qwen-qwen3-8-flash-2');
  const id=modelProviderIdFor({supplier:'供应商',supplierId:'custom-61b5768a',model:'a-model-with-a-very-long-name-that-must-be-truncated',existingIds:[]});
  assert.match(id,/^custom-61b5768a-a-model/);
  assert.ok(id.length<=48);
});

test('模型配置分别持久化非敏感参数和 API Key，并即时更新运行配置',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'model-config-'));
  fs.writeFileSync(path.join(root,'config.local.json'),'{}','utf8');
  fs.writeFileSync(path.join(root,'.env'),'EXISTING=value\n','utf8');
  const config={llm:{defaultProvider:'legacy',providers:{legacy:{label:'Legacy',enabled:true,apiKeyEnv:'LEGACY_KEY'}}}};
  const id=saveModelProvider(root,config,{id:'my-model',label:'我的模型',baseUrl:'http://127.0.0.1:8000/v1',model:'local-model',apiKey:'secret',makeDefault:true});
  assert.equal(id,'my-model');
  assert.equal(config.llm.defaultProvider,'my-model');
  assert.equal(config.llm.providers[id].model,'local-model');
  const local=JSON.parse(fs.readFileSync(path.join(root,'config.local.json'),'utf8'));
  assert.equal(local.llm.providers[id].apiKeyEnv,'MODEL_PROVIDER_MY_MODEL_API_KEY');
  assert.doesNotMatch(JSON.stringify(local),/secret/);
  assert.match(fs.readFileSync(path.join(root,'.env'),'utf8'),/MODEL_PROVIDER_MY_MODEL_API_KEY=secret/);
  deleteModelProvider(root,config,id);
  assert.equal(config.llm.defaultProvider,'legacy');
  assert.equal(config.llm.providers[id],undefined);
});

test('网关接受 Base URL 或完整 chat completions 地址',()=>{
  const source=fs.readFileSync(new URL('../server/platform/llm/gateway.mjs',import.meta.url),'utf8');
  assert.ok(source.includes('/\\/chat\\/completions$/i.test(value)'));
});

test('创建模型仅注册 config.local.json，不写环境文件',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'model-create-'));
  fs.writeFileSync(path.join(root,'config.local.json'),'{}','utf8');
  fs.writeFileSync(path.join(root,'.env'),'EXISTING=value\n','utf8');
  const config={llm:{providers:{}}};
  const id=createModelProvider(root,config,{id:'openai-main',label:'主力',baseUrl:'https://api.openai.com/v1/',model:'gpt-4.1',contextWindow:128000,maxOutputTokens:8192});
  assert.equal(id,'openai-main');
  assert.equal(config.llm.providers['openai-main'].model,'gpt-4.1');
  const local=JSON.parse(fs.readFileSync(path.join(root,'config.local.json'),'utf8'));
  assert.equal(local.llm.providers['openai-main'].baseUrl,'https://api.openai.com/v1');
  assert.equal(local.llm.providers['openai-main'].maxOutputTokens,8192);
  assert.equal(fs.readFileSync(path.join(root,'.env'),'utf8'),'EXISTING=value\n');
  assert.throws(()=>createModelProvider(root,config,{id:'openai-main',label:'重复',baseUrl:'https://x/v1',model:'m'}),/已存在/);
});

test('同一供应商的多个模型共享连接配置与凭据',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'model-connection-'));fs.mkdirSync(path.join(root,'data'));
  const rows=new Map();
  const repository={
    list:(type)=>[...rows.values()].filter((row)=>row.extension_type===type),
    get:(type,id)=>rows.get(`${type}:${id}`)||null,
    save:(input)=>{const row={extension_type:input.extensionType,extension_id:input.extensionId,value:structuredClone(input.value),configured:input.configured,status:input.status,updated_at:new Date().toISOString()};rows.set(`${input.extensionType}:${input.extensionId}`,row);return row;},
    remove:(type,id)=>rows.delete(`${type}:${id}`),
  };
  try{
    const config={llm:{defaultProvider:'',providers:{},connections:{}}};
    createModelConnection(root,config,{id:'openai',label:'OpenAI',baseUrl:'https://api.openai.com/v1'},{repository});
    createModelProvider(root,config,{id:'gpt-fast',label:'GPT Fast',connectionId:'openai',model:'gpt-4.1-mini',contextWindow:128000,maxOutputTokens:4096},{repository});
    createModelProvider(root,config,{id:'gpt-quality',label:'GPT Quality',connectionId:'openai',model:'gpt-4.1',contextWindow:256000,maxOutputTokens:8192},{repository});
    assert.equal(repository.list('model-connection').length,1);
    assert.deepEqual(Object.keys(repository.get('model-connection','openai').value).sort(),['baseUrl','label','protocol']);
    assert.deepEqual(Object.keys(repository.get('model-provider','gpt-fast').value).sort(),['connectionId','contextWindow','enabled','label','maxOutputTokens','maxTokensField','model','responsesReasoningToggle','supportsJsonMode','supportsNativeTools','supportsThinkingToggle','supportsToolCallStreaming','taggingChunkSize','taggingConcurrency','thinkingReserveTokens']);
    assert.equal(repository.get('model-provider','gpt-fast').value.taggingChunkSize,6);
    assert.equal(config.llm.providers['gpt-fast'].baseUrl,'https://api.openai.com/v1');
    assert.equal(config.llm.providers['gpt-quality'].baseUrl,'https://api.openai.com/v1');
    assert.equal(config.llm.providers['gpt-fast'].connectionId,'openai');
    assert.throws(()=>createModelProvider(root,config,{id:'gpt-duplicate',label:'重复模型',connectionId:'openai',model:'gpt-4.1'},{repository}),/模型唯一标识 openai\/gpt-4.1 已存在/);
    assert.throws(()=>deleteModelConnection(root,config,'openai',{repository}),/仍被 2 个模型引用/);
    const removable={llm:{defaultProvider:'',providers:{},connections:{}}};
    createModelConnection(root,removable,{id:'unused',label:'Unused',baseUrl:'https://unused.example.com'},{repository});
    deleteModelConnection(root,removable,'unused',{repository});
    assert.equal(repository.get('model-connection','unused'),null);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('创建模型未提供 ID 时自动使用供应商-模型命名',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'model-auto-id-'));fs.mkdirSync(path.join(root,'data'));
  const rows=new Map();
  const repository={
    list:(type)=>[...rows.values()].filter((row)=>row.extension_type===type),
    get:(type,id)=>rows.get(`${type}:${id}`)||null,
    save:(input)=>{const row={extension_type:input.extensionType,extension_id:input.extensionId,value:structuredClone(input.value),configured:input.configured,status:input.status,updated_at:new Date().toISOString()};rows.set(`${input.extensionType}:${input.extensionId}`,row);return row;},
  };
  try{
    const config={llm:{defaultProvider:'',providers:{},connections:{}}};
    createModelConnection(root,config,{id:'openrouter',label:'OpenRouter',baseUrl:'https://openrouter.ai/api/v1'},{repository});
    const id=createModelProvider(root,config,{label:'DeepSeek via OpenRouter',connectionId:'openrouter',model:'deepseek/deepseek-v4-flash-0731'},{repository});
    assert.equal(id,'openrouter-deepseek-deepseek-v4-flash-0731');
    assert.equal(config.llm.providers[id].model,'deepseek/deepseek-v4-flash-0731');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('模型旧配置启动时迁移到统一数据库来源并清理旧字段',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'model-db-migration-'));
  fs.mkdirSync(path.join(root,'data'));
  fs.writeFileSync(path.join(root,'config.local.json'),JSON.stringify({llm:{defaultProvider:'custom',providers:{custom:{label:'旧模型',baseUrl:'https://example.com/v1',model:'old',apiKeyEnv:'CUSTOM_KEY'}}},tavily:{enabled:true}}));
  fs.writeFileSync(path.join(root,'.env'),'CUSTOM_KEY=legacy-secret\nOTHER=value\n');
  const rows=new Map();
  const repository={
    list:(type)=>[...rows.values()].filter((row)=>row.extension_type===type),
    get:(type,id)=>rows.get(`${type}:${id}`)||null,
    save:(input)=>{const row={extension_type:input.extensionType,extension_id:input.extensionId,value:input.value,configured:input.configured,status:input.status,updated_at:new Date().toISOString()};rows.set(`${input.extensionType}:${input.extensionId}`,row);return row;},
  };
  const config={llm:{defaultProvider:'custom',providers:{custom:{label:'旧模型',baseUrl:'https://example.com/v1',model:'old',apiKeyEnv:'CUSTOM_KEY'}}}};
  syncModelProvidersToDatabase({root,config,repository});
  assert.equal(repository.get('model-provider','custom').value.model,'old');
  assert.equal(repository.get('system','llm-runtime').value.defaultProvider,'custom');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'config.local.json'))).llm,undefined);
  assert.match(fs.readFileSync(path.join(root,'.env'),'utf8'),/OTHER=value/);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'.env'),'utf8'),/CUSTOM_KEY/);
  assert.equal(config.llm.providers.custom.model,'old');
});

test('模型统一接入统一配置资源，模型运行只负责诊断与观测',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const styles=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
  const modelsView=fs.readFileSync(new URL('../public/src/views/models.js',import.meta.url),'utf8');
  const systemView=fs.readFileSync(new URL('../public/src/views/system.js',import.meta.url),'utf8');
  const modelRoutes=fs.readFileSync(new URL('../server/platform/http/routes/model-routes.mjs',import.meta.url),'utf8');
  const systemRoutes=fs.readFileSync(new URL('../server/platform/http/routes/system-routes.mjs',import.meta.url),'utf8');
  const settingsModule=fs.readFileSync(new URL('../server/platform/integrations/model-provider-settings.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(html,/id="model-base-url"|id="model-config-form"/);
  assert.match(html,/id="add-model-provider"/);
  assert.doesNotMatch(html,/data-config-tab="models"/);
  assert.match(html,/id="system-extension-list"/);
  assert.doesNotMatch(html,/模型接入配置/);
  assert.match(systemView,/model-provider/);
  assert.match(html,/data-view="models">[\s\S]*?<b>模型运行<\/b>/);
  assert.match(systemView,/\/api\/system\/configuration\/model-provider/);
  assert.match(systemView,/method: ?"DELETE"/);
  assert.match(systemRoutes,/\/api\/system\/configuration\/model-provider/);
  assert.match(settingsModule,/createModelProvider/);
  assert.doesNotMatch(modelsView,/modelFormPayload|saveModelConfig|deleteModelConfig/);
  assert.doesNotMatch(html,/id="ai-tag-batch"|id="tag-limit"/);
  assert.doesNotMatch(modelsView,/aiTagBatch|\/ai\/tag/);
  assert.match(modelsView,/filter\(\(provider\)=>provider\.enabled!==false&&provider\.configured\)/);
  assert.match(styles,/\.model-layout \{ display:grid; grid-template-columns:minmax\(0,1fr\) minmax\(250px,270px\)/);
  assert.match(styles,/@media \(max-width:1280px\) \{ \.model-layout \{ grid-template-columns:minmax\(0,1fr\)/);
  assert.doesNotMatch(styles,/grid-template-columns:minmax\(180px,.7fr\) minmax\(220px,1fr\) minmax\(290px,1.3fr\)/);
  assert.match(modelRoutes,/saveModelProvider/);
  assert.match(modelRoutes,/deleteModelProvider/);
});
