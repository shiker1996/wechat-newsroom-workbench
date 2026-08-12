import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelGateway } from '../lib/llm/gateway.mjs';

function config(){return {llm:{defaultProvider:'demo',providers:{demo:{label:'Legacy',baseUrl:'https://legacy.example/v1',model:'legacy',apiKeyEnv:'DEMO_DYNAMIC_KEY',contextWindow:8000,maxOutputTokens:1000}}}};}

test('ModelGateway 优先使用统一配置解析结果',()=>{
  const gateway=new ModelGateway(config(),{},()=>({configured:true,values:{label:'New',baseUrl:'https://new.example/v1',model:'new-model',apiKey:'stored-secret',contextWindow:16000,maxOutputTokens:2000,enabled:true}}));
  const result=gateway.resolve('demo');
  assert.equal(result.apiKey,'stored-secret');assert.equal(result.provider.model,'new-model');assert.equal(result.provider.baseUrl,'https://new.example/v1');
  assert.equal(gateway.listProviders().providers[0].configured,true);
});

test('ModelGateway 未注入解析器时继续兼容旧环境变量',()=>{
  process.env.DEMO_DYNAMIC_KEY='legacy-secret';
  try{const result=new ModelGateway(config(),{}).resolve('demo');assert.equal(result.apiKey,'legacy-secret');assert.equal(result.provider.model,'legacy');}
  finally{delete process.env.DEMO_DYNAMIC_KEY;}
});

test('模型凭据缺失时提示前往配置中心',()=>{
  const gateway=new ModelGateway(config(),{},()=>({configured:false,values:{}}));
  assert.throws(()=>gateway.resolve('demo'),/系统与配置中心/);
});
