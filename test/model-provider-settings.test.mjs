import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deleteModelProvider, normalizeProviderInput, saveModelProvider } from '../lib/integrations/model-provider-settings.mjs';

test('OpenAI 兼容模型配置校验并生成独立密钥变量',()=>{
  const result=normalizeProviderInput({label:'自定义',baseUrl:'https://api.example.com/v1/',model:'model-a'});
  assert.match(result.id,/^custom-/);
  assert.equal(result.provider.baseUrl,'https://api.example.com/v1');
  assert.match(result.provider.apiKeyEnv,/^MODEL_PROVIDER_CUSTOM_/);
  assert.throws(()=>normalizeProviderInput({label:'',baseUrl:'bad',model:''}),/配置名称/);
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
  const source=fs.readFileSync(new URL('../lib/llm/gateway.mjs',import.meta.url),'utf8');
  assert.ok(source.includes('/\\/chat\\/completions$/i.test(value)'));
});

test('运行配置承载模型增删改，模型中心只展示可用模型',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const styles=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
  const modelsView=fs.readFileSync(new URL('../public/src/views/models.js',import.meta.url),'utf8');
  const systemView=fs.readFileSync(new URL('../public/src/views/system.js',import.meta.url),'utf8');
  const modelRoutes=fs.readFileSync(new URL('../lib/http/routes/model-routes.mjs',import.meta.url),'utf8');
  for(const id of ['model-base-url','model-name','model-api-key','model-max-token-field','model-json-mode'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/data-config-tab="models"/);
  assert.match(systemView,/method: "POST"[\s\S]*modelFormPayload/);
  assert.match(systemView,/method: "DELETE"/);
  assert.doesNotMatch(modelsView,/modelFormPayload|saveModelConfig|deleteModelConfig/);
  assert.match(modelsView,/filter\(\(provider\)=>provider\.enabled!==false&&provider\.configured\)/);
  assert.match(styles,/\.model-layout \{ display:grid; grid-template-columns:minmax\(0,1fr\) minmax\(250px,270px\)/);
  assert.match(styles,/@media \(max-width:1280px\) \{ \.model-layout \{ grid-template-columns:minmax\(0,1fr\)/);
  assert.doesNotMatch(styles,/grid-template-columns:minmax\(180px,.7fr\) minmax\(220px,1fr\) minmax\(290px,1.3fr\)/);
  assert.match(modelRoutes,/saveModelProvider/);
  assert.match(modelRoutes,/deleteModelProvider/);
});
