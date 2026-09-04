import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ModelGateway } from '../server/platform/llm/gateway.mjs';
import { wireResponsesInput, responsesPayload, responsesToolDefinitions } from '../server/platform/llm/responses-api.mjs';
import { testConfigurationResolver } from './helpers/gateway-configuration.mjs';

function gateway(port) {
  process.env.TEST_RESPONSES_KEY = 'secret';
  return new ModelGateway({ llm: {
    defaultProvider: 'test', requestTimeoutMs: 2000, safetyReserveTokens: 32, recentMessageCount: 8,
    providers: { test: { label: 'Test', protocol: 'responses', baseUrl: `http://127.0.0.1:${port}`, model: 'mock', apiKeyEnv: 'TEST_RESPONSES_KEY', contextWindow: 32000, maxOutputTokens: 1200, supportsJsonMode: true, reasoningEffort: 'low' } },
  } }, { recordModelCall() { return 1; } }, testConfigurationResolver);
}

test.afterEach(() => { delete process.env.TEST_RESPONSES_KEY; });

test('Responses 非流式请求转换 input、工具和 output', async () => {
  let body;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      body = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'resp-1', status: 'completed', output_text: '完成', usage: { input_tokens: 4, output_tokens: 2 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const model = gateway(server.address().port);
    const result = await model.complete({ purpose: 'connection-test', thinking: false, jsonMode: true, nativeTools: true,
      tools: [{ type: 'function', function: { name: 'cap_read', description: '读取', parameters: { type: 'object' } } }],
      messages: [
        { role: 'assistant', content: null, tool_calls: [{ id: 'call-old', type: 'function', function: { name: 'cap_read', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call-old', content: '{"ok":true}' },
        { role: 'user', content: '继续' },
      ],
    });
    assert.equal(result.content, '完成');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.usage.prompt_tokens, 4);
    assert.equal(result.usage.completion_tokens, 2);
    assert.equal(body.input[0].type, 'function_call');
    assert.equal(body.input[0].call_id, 'call-old');
    assert.deepEqual(body.input[1], { type: 'function_call_output', call_id: 'call-old', output: '{"ok":true}' });
    assert.equal(body.input[2].role, 'user');
    assert.deepEqual(body.reasoning, { effort: 'none' });
    // 原有策略与 Chat Completions 一致：有原生工具时不同时启用 JSON mode。
    assert.equal(body.text, undefined);
    assert.deepEqual(body.tools, [{ type: 'function', name: 'cap_read', description: '读取', parameters: { type: 'object' } }]);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Responses 流式事件转换为统一 LLMEvent，工具参数可增量拼接', async () => {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end([
        'event: response.created\ndata: {"type":"response.created","response":{"id":"resp-stream"}}\n\n',
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"你好"}\n\n',
        'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"id":"item-1","type":"function_call","call_id":"call-1","name":"cap_read"}}\n\n',
        'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","item_id":"item-1","delta":"{\\"q\\":"}\n\n',
        'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","item_id":"item-1","delta":"\\"x\\"}"}\n\n',
        'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp-stream","status":"completed","usage":{"input_tokens":3,"output_tokens":4}}}\n\n',
      ].join(''));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const model = gateway(server.address().port);
    const events = [];
    const result = await model.streamComplete({ purpose: 'connection-test', thinking: false, messages: [{ role: 'user', content: 'hi' }] }, () => {}, () => {}, (event) => events.push(event));
    assert.equal(result.content, '你好');
    assert.deepEqual(result.toolCalls, [{ id: 'call-1', name: 'cap_read', input: { q: 'x' }, providerExecuted: false }]);
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.usage.prompt_tokens, 3);
    assert.equal(result.usage.completion_tokens, 4);
    assert.deepEqual(events.map((event) => event.type), [
      'turn-start', 'text-start', 'text-delta', 'tool-input-start', 'tool-input-delta', 'tool-input-delta', 'text-end', 'tool-input-end', 'tool-call', 'usage', 'finish',
    ]);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Responses 工具定义与 Chat Completions 工具定义保持协议隔离', () => {
  assert.deepEqual(responsesToolDefinitions([{ type: 'function', function: { name: 'x', parameters: { type: 'object' } } }]), [
    { type: 'function', name: 'x', description: '', parameters: { type: 'object' } },
  ]);
  assert.deepEqual(responsesPayload({
    provider: { protocol: 'responses', model: 'mock', maxOutputTokens: 1000 },
    messages: [{ role: 'user', content: '检查' }], maxOutputTokens: 1000,
    tools: [{ type: 'function', function: { name: 'decision.quality_gate', parameters: { type: 'object' } } }],
    toolChoice: { type: 'function', function: { name: 'decision.quality_gate' } },
  }).tool_choice, { type: 'function', name: 'decision.quality_gate' });
  assert.deepEqual(wireResponsesInput([{ role: 'tool', tool_call_id: 'c', content: 'ok' }], { nativeTools: false }), [{ role: 'user', content: 'ok' }]);
});

test('Responses 联网搜索请求加入 DeepSeek web_search 工具并强制选择', () => {
  const body = responsesPayload({
    provider: { protocol: 'responses', model: 'deepseek-v4-flash', maxOutputTokens: 1000 },
    messages: [{ role: 'user', content: '核实这条研判' }],
    maxOutputTokens: 1000,
    tools: [{ type: 'web_search' }],
    toolChoice: { type: 'web_search' },
    jsonMode: true,
    thinking: false,
  });
  assert.deepEqual(body.tools, [{ type: 'web_search' }]);
  assert.deepEqual(body.tool_choice, { type: 'web_search' });
  assert.equal(body.text, undefined);
});

test('Responses 响应保留服务端执行的 web_search_call', async () => {
  const { normalizeResponsesResponse } = await import('../server/platform/llm/responses-api.mjs');
  const result = normalizeResponsesResponse({
    id: 'resp-search',
    status: 'completed',
    output_text: '{"ok":true}',
    output: [{ type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search', query: '测试查询' } }],
  }, 'DeepSeek');
  assert.deepEqual(result.toolCalls, [{
    id: 'ws_1', name: 'web_search', input: { type: 'search', query: '测试查询' }, providerExecuted: true, status: 'completed',
  }]);
});
