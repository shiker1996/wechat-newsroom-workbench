import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ModelGateway } from '../lib/llm/gateway.mjs';

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
  }, { recordModelCall() { return 1; } });
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
