import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ModelGateway, runWithThinkingSink } from '../server/platform/llm/gateway.mjs';
import { testConfigurationResolver } from './helpers/gateway-configuration.mjs';

function makeGateway(port, extraProvider = {}) {
  process.env.TEST_COMPAT_KEY = 'secret';
  return new ModelGateway({
    llm: {
      defaultProvider: 'test',
      requestTimeoutMs: 5000,
      safetyReserveTokens: 32,
      recentMessageCount: 8,
      providers: {
        test: {
          label: 'Test',
          baseUrl: `http://127.0.0.1:${port}`,
          model: 'mock',
          apiKeyEnv: 'TEST_COMPAT_KEY',
          contextWindow: 32000,
          maxOutputTokens: 1200,
          supportsThinkingToggle: true,
          ...extraProvider,
        },
      },
    },
  }, { recordModelCall() { return 1; } }, testConfigurationResolver);
}

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await fn(server.address().port); } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    delete process.env.TEST_COMPAT_KEY;
  }
}

test('reasoningEffort provider 配置在 thinking 开启时透传，关闭时不发送', async () => {
  const payloads = [];
  await withServer((req, res) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      payloads.push(JSON.parse(body));
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} }));
    });
  }, async (port) => {
    const gateway = makeGateway(port, { reasoningEffort: 'low' });
    await gateway.complete({ purpose: 'editorial-room', messages: [{ role: 'user', content: 'hi' }] });
    await gateway.complete({ purpose: 'hotspot-tagging', messages: [{ role: 'user', content: 'hi' }] });
  });
  assert.deepEqual(payloads[0].thinking, { type: 'enabled', reasoning_effort: 'low' });
  assert.deepEqual(payloads[1].thinking, { type: 'disabled' });
});

test('content_filter 与 insufficient_system_resource 报出明确错误', async () => {
  for (const [finishReason, pattern] of [
    ['content_filter', /内容过滤/],
    ['insufficient_system_resource', /资源不足/],
  ]) {
    await withServer((req, res) => {
      req.resume();
      req.on('end', () => res.end(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: finishReason }], usage: {} })));
    }, async (port) => {
      const gateway = makeGateway(port);
      await assert.rejects(
        gateway.complete({ purpose: 'daily-review', messages: [{ role: 'user', content: 'hi' }] }),
        pattern,
      );
    });
  }
});

test('finish_reason=length 且内容为空时按截断报错，不把空串传给下游', async () => {
  await withServer((req, res) => {
    req.resume();
    req.on('end', () => res.end(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: {} })));
  }, async (port) => {
    const gateway = makeGateway(port);
    await assert.rejects(
      gateway.complete({ purpose: 'article-drafting-pipeline', messages: [{ role: 'user', content: 'hi' }] }),
      /输出达到上限且未返回内容/,
    );
  });
});

test('非流式 complete 采集并透传 reasoning_content', async () => {
  await withServer((req, res) => {
    req.resume();
    req.on('end', () => res.end(JSON.stringify({
      choices: [{ message: { content: 'ok', reasoning_content: '先判断体裁，再组织提纲' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 5 },
    })));
  }, async (port) => {
    const gateway = makeGateway(port);
    const result = await gateway.complete({ purpose: 'editorial-room', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(result.reasoning, '先判断体裁，再组织提纲');
    assert.equal(result.content, 'ok');
  });
});

test('流式 streamComplete 逐段透传 thinking 并累计返回 reasoning', async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"reasoning_content":"先"}}]}\n\n',
    'data: {"choices":[{"delta":{"reasoning_content":"看事实边界"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ];
  await withServer((req, res) => {
    req.resume();
    req.on('end', () => { res.writeHead(200, { 'content-type': 'text/event-stream' }); chunks.forEach((c) => res.write(c)); res.end(); });
  }, async (port) => {
    const gateway = makeGateway(port);
    const thinking = [];
    const result = await gateway.streamComplete(
      { purpose: 'editorial-room', messages: [{ role: 'user', content: 'hi' }] },
      () => {},
      (delta) => thinking.push(delta),
    );
    assert.equal(thinking.join(''), '先看事实边界');
    assert.equal(result.reasoning, '先看事实边界');
    assert.equal(result.content, '你好');
  });
});

test('runWithThinkingSink 下 complete 自动转流式并实时转发 thinking', async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"reasoning_content":"实时"}}]}\n\n',
    'data: {"choices":[{"delta":{"reasoning_content":"思考中"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"成稿"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ];
  await withServer((req, res) => {
    req.resume();
    req.on('end', () => { res.writeHead(200, { 'content-type': 'text/event-stream' }); chunks.forEach((c) => res.write(c)); res.end(); });
  }, async (port) => {
    const gateway = makeGateway(port);
    const thinking = [];
    const result = await runWithThinkingSink((delta) => thinking.push(delta), async () => {
      return gateway.complete({ purpose: 'article-drafting-pipeline', messages: [{ role: 'user', content: 'hi' }] });
    });
    assert.equal(thinking.join(''), '实时思考中');
    assert.equal(result.reasoning, '实时思考中');
    assert.equal(result.content, '成稿');
  });
});

test('runWithThinkingSink 下禁用 thinking 的用途仍走非流式', async () => {
  const receivedStream = [];
  await withServer((req, res) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      receivedStream.push(JSON.parse(body).stream === true);
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok', reasoning_content: '不该出现' }, finish_reason: 'stop' }], usage: {} }));
    });
  }, async (port) => {
    const gateway = makeGateway(port);
    const thinking = [];
    const result = await runWithThinkingSink((delta) => thinking.push(delta), async () => {
      return gateway.complete({ purpose: 'hotspot-tagging', messages: [{ role: 'user', content: 'hi' }] });
    });
    assert.equal(receivedStream[0], false);
    assert.equal(thinking.length, 0);
    assert.equal(result.reasoning, '不该出现');
    assert.equal(result.content, 'ok');
  });
});
