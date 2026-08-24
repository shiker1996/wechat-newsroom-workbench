import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ModelGateway } from '../server/platform/llm/gateway.mjs';
import { testConfigurationResolver } from './helpers/gateway-configuration.mjs';

test('模型网关逐段解析 OpenAI 兼容 SSE 并记录成功调用', async () => {
  const server=http.createServer(async(request,response)=>{
    let body='';for await(const chunk of request)body+=chunk;
    const payload=JSON.parse(body);assert.equal(payload.stream,true);assert.deepEqual(payload.response_format,{type:'json_object'});
    response.writeHead(200,{'content-type':'text/event-stream'});
    response.write('data: {"id":"call-1","choices":[{"delta":{"content":"{\\"assistantReply\\":\\"你"}}]}\n\n');
    setTimeout(()=>{response.write('data: {"choices":[{"delta":{"content":"好\\"}"},"finish_reason":"stop"}],"usage":{"completion_tokens":3}}\n\n');response.end('data: [DONE]\n\n');},10);
  });
  await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();const calls=[];process.env.TEST_STREAM_KEY='secret';
  try {
    const gateway=new ModelGateway({llm:{defaultProvider:'test',requestTimeoutMs:2000,safetyReserveTokens:32,recentMessageCount:4,providers:{test:{label:'Test',baseUrl:`http://127.0.0.1:${address.port}`,model:'mock',apiKeyEnv:'TEST_STREAM_KEY',contextWindow:4096,maxOutputTokens:256,maxTokensField:'max_tokens',supportsJsonMode:true}}}},
      {recordModelCall(input){calls.push(input);return 7;}},testConfigurationResolver);
    const deltas=[];const result=await gateway.streamComplete({purpose:'editorial-room',jsonMode:true,maxOutputTokens:128,messages:[{role:'user',content:'开始'}]},(delta)=>deltas.push(delta));
    assert.deepEqual(deltas,['{"assistantReply":"你','好"}']);
    assert.equal(result.content,'{"assistantReply":"你好"}');assert.equal(result.callId,7);assert.equal(calls[0].status,'completed');
  } finally {
    delete process.env.TEST_STREAM_KEY;
    await new Promise((resolve)=>server.close(resolve));
  }
});
