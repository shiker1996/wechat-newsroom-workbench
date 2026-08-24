import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelGateway } from '../server/platform/llm/gateway.mjs';
import { testConfigurationResolver } from './helpers/gateway-configuration.mjs';

function gateway(){process.env.TEST_R4_KEY='secret';return new ModelGateway({llm:{defaultProvider:'test',requestTimeoutMs:2000,safetyReserveTokens:32,recentMessageCount:8,providers:{test:{label:'Test',baseUrl:'http://unused.test/v1',model:'mock',apiKeyEnv:'TEST_R4_KEY',contextWindow:32000,maxOutputTokens:12000}}}},{recordModelCall(){return 1;}},testConfigurationResolver);}

test('streamComplete 对截断结果执行一次扩容重试且不向客户端拼接残稿',async()=>{
  const model=gateway();const calls=[];const deltas=[];
  model.rawStreamComplete=async(input)=>{calls.push(input);if(calls.length===1){input.onDelta('半截');return {content:'半截',usage:{completion_tokens:6000},finishReason:'length'};}input.onDelta('完整');return {content:'完整',usage:{completion_tokens:10},finishReason:'stop'};};
  try{const result=await model.streamComplete({purpose:'article-planning',messages:[{role:'user',content:'plan'}]},(delta)=>deltas.push(delta));assert.equal(calls.length,2);assert.deepEqual(deltas,['完整']);assert.equal(result.outputBudget.attempts,2);assert.equal(result.outputBudget.used,10000);}finally{delete process.env.TEST_R4_KEY;}
});

test('已取消的模型请求不会进入 fetch 或重试',async()=>{
  const model=gateway();const controller=new AbortController();controller.abort();let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{calls+=1;throw new Error('不应调用');};
  try{await assert.rejects(()=>model.complete({purpose:'connection-test',maxOutputTokens:16,signal:controller.signal,messages:[{role:'user',content:'x'}]}),(error)=>error.code==='MODEL_CALL_ABORTED');assert.equal(calls,0);}finally{globalThis.fetch=original;delete process.env.TEST_R4_KEY;}
});

test('429 和 5xx 使用有限退避并在成功后停止',async()=>{
  const model=gateway();let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{calls+=1;if(calls===1)return new Response(JSON.stringify({error:{message:'busy'}}),{status:503,headers:{'content-type':'application/json'}});return new Response(JSON.stringify({choices:[{message:{content:'ok'},finish_reason:'stop'}],usage:{}}),{status:200,headers:{'content-type':'application/json'}});};
  try{const result=await model.complete({purpose:'connection-test',maxOutputTokens:16,messages:[{role:'user',content:'x'}]});assert.equal(result.content,'ok');assert.equal(calls,2);}finally{globalThis.fetch=original;delete process.env.TEST_R4_KEY;}
});
