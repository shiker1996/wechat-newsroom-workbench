import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ModelGateway } from '../server/platform/llm/gateway.mjs';
import { testConfigurationResolver } from './helpers/gateway-configuration.mjs';

function makeGateway(port, store = { recordModelCall() { return 1; } }) {
  process.env.TEST_EVENT_KEY = 'secret';
  return new ModelGateway({
    llm: {
      defaultProvider: 'test', requestTimeoutMs: 2000, safetyReserveTokens: 32, recentMessageCount: 8,
      providers: {
        test: {
          label: 'Test', baseUrl: `http://127.0.0.1:${port}`, model: 'mock', apiKeyEnv: 'TEST_EVENT_KEY',
          contextWindow: 32000, maxOutputTokens: 1200, supportsThinkingToggle: true,
        },
      },
    },
  }, store, testConfigurationResolver);
}

async function withServer(chunks, fn) {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const chunk of chunks) res.write(chunk);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await fn(server.address().port); } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    delete process.env.TEST_EVENT_KEY;
  }
}

test('streamEvents 将文本、推理和结束状态转换为有序 LLMEvent', async () => {
  await withServer([
    'data: {"id":"resp-1","choices":[{"delta":{"reasoning_content":"先"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":3}}\n\n',
    'data: [DONE]\n\n',
  ], async (port) => {
    const gateway = makeGateway(port);
    const events = [];
    for await (const event of gateway.streamEvents({ purpose: 'connection-test', thinking: true, messages: [{ role: 'user', content: 'hi' }] })) events.push(event);
    assert.deepEqual(events.map((event) => event.type), [
      'turn-start', 'reasoning-start', 'reasoning-delta', 'text-start', 'text-delta', 'text-end', 'reasoning-end', 'usage', 'finish',
    ]);
    assert.equal(events.find((event) => event.type === 'text-delta').text, '你好');
    assert.equal(events.find((event) => event.type === 'finish').reason, 'stop');
    assert.deepEqual(events.map((event) => event.seq), events.map((_, index) => index + 1));
  });
});

test('streamComplete 接受无文本但有工具调用的正常轮次', async () => {
  await withServer([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"content_url_fetch","arguments":"{\\"resourceId\\":"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"material:001\\"}"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ], async (port) => {
    const gateway = makeGateway(port);
    const events = [];
    const result = await gateway.streamComplete(
      { purpose: 'connection-test', thinking: false, messages: [{ role: 'user', content: 'read it' }] },
      () => {},
      () => {},
      (event) => events.push(event),
    );
    assert.equal(result.content, '');
    assert.deepEqual(result.toolCalls, [{ id: 'call_1', name: 'content_url_fetch', input: { resourceId: 'material:001' }, providerExecuted: false }]);
    assert.ok(events.some((event) => event.type === 'tool-call'));
    assert.equal(events.at(-1).type, 'finish');
  });
});

test('streamComplete 将缺少终止事件的流标记为不完整', async () => {
  await withServer([
    'data: {"choices":[{"delta":{"content":"半截"}}]}\n\n',
    'data: [DONE]\n\n',
  ], async (port) => {
    const gateway = makeGateway(port);
    await assert.rejects(
      gateway.streamComplete({ purpose: 'connection-test', thinking: false, messages: [{ role: 'user', content: 'hi' }] }),
      /流式响应结束前未收到终止事件/,
    );
  });
});

test('complete 保留原生工具 schema 与 tool_call 历史，不发送伪 JSON 模式', async () => {
  process.env.TEST_EVENT_KEY = 'secret';
  let requestBody;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requestBody = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'resp-native', choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'cap_content_demo_read', arguments: '{"query":"x"}' } }] } }], usage: {} }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const gateway = makeGateway(server.address().port);
    const result = await gateway.complete({ purpose: 'connection-test', thinking: false, jsonMode: true, nativeTools: true,
      tools: [{ type: 'function', function: { name: 'cap_content_demo_read', parameters: { type: 'object' } } }],
      messages: [{ role: 'assistant', content: null, tool_calls: [{ id: 'call_old', type: 'function', function: { name: 'cap_content_demo_read', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call_old', content: '{"status":"ok"}' }] });
    assert.equal(result.toolCalls[0].input.query, 'x');
    assert.equal(requestBody.response_format, undefined);
    assert.deepEqual(requestBody.messages.map((message) => message.role), ['assistant', 'tool']);
    assert.equal(requestBody.messages[1].tool_call_id, 'call_old');
    assert.deepEqual(requestBody.tools, [{ type: 'function', function: { name: 'cap_content_demo_read', parameters: { type: 'object' } } }]);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    delete process.env.TEST_EVENT_KEY;
  }
});

test('Chat Completions 将协议无关的 function tool_choice 转为 Chat 格式', async () => {
  process.env.TEST_EVENT_KEY = 'secret';
  let requestBody;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requestBody = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'resp-choice', choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'call-choice', type: 'function', function: { name: 'decision.quality_gate', arguments: '{"pass":true}' } }] } }], usage: {} }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const model = makeGateway(server.address().port);
    const result = await model.complete({ purpose: 'connection-test', thinking: false,
      tools: [{ type: 'function', function: { name: 'decision.quality_gate', parameters: { type: 'object' } } }],
      toolChoice: { type: 'function', name: 'decision.quality_gate' },
      messages: [{ role: 'user', content: '检查' }],
    });
    assert.equal(result.toolCalls[0].name, 'decision.quality_gate');
    assert.deepEqual(requestBody.tool_choice, { type: 'function', function: { name: 'decision.quality_gate' } });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    delete process.env.TEST_EVENT_KEY;
  }
});

test('Chat Completions 原生工具参数解析失败时记录 invalid_output', async () => {
  process.env.TEST_EVENT_KEY = 'secret';
  const audit = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'resp-invalid-tool', choices: [{ finish_reason: 'tool_calls', message: {
        content: null,
        tool_calls: [{ id: 'call-invalid', type: 'function', function: { name: 'decision.quality_gate', arguments: '{"pass":' } }],
      } }], usage: {} }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const model = makeGateway(server.address().port, {
      recordModelCall(input) { audit.push(input); return 1; },
    });
    await assert.rejects(
      model.complete({ purpose: 'connection-test', thinking: false, messages: [{ role: 'user', content: '检查' }] }),
      /参数不是合法 JSON/,
    );
    assert.equal(audit.at(-1).status, 'invalid_output');
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    delete process.env.TEST_EVENT_KEY;
  }
});
