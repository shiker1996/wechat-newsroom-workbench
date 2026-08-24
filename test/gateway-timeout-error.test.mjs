import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ModelGateway } from '../server/platform/llm/gateway.mjs';
import { testConfigurationResolver } from './helpers/gateway-configuration.mjs';

// 回归：AbortController 超时曾被 response.json() 兜底吞掉，误报「未返回文本内容」。
// 现在必须抛出明确的超时错误，并提示如何调大 requestTimeoutMs。
test('request timeout surfaces a clear timeout error instead of a misleading empty-content error', async () => {
  process.env.TEST_TIMEOUT_KEY = 'secret';
  const server = http.createServer((req, res) => {
    // 永不响应，迫使客户端超时
    req.resume();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const gateway = new ModelGateway({
    llm: {
      defaultProvider: 'test',
      requestTimeoutMs: 300,
      safetyReserveTokens: 32,
      recentMessageCount: 8,
      providers: {
        test: {
          label: 'Test',
          baseUrl: `http://127.0.0.1:${port}`,
          model: 'mock',
          apiKeyEnv: 'TEST_TIMEOUT_KEY',
          contextWindow: 32000,
          maxOutputTokens: 1200,
        },
      },
    },
  }, { recordModelCall() { return 1; } }, testConfigurationResolver);
  try {
    await assert.rejects(
      gateway.complete({ purpose: 'daily-review', messages: [{ role: 'user', content: 'hi' }] }),
      /请求超时（300ms）[\s\S]*requestTimeoutMs/,
    );
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    delete process.env.TEST_TIMEOUT_KEY;
  }
});
