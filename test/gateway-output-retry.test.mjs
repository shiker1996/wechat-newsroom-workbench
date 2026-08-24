import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelGateway } from '../server/platform/llm/gateway.mjs';
import { testConfigurationResolver } from './helpers/gateway-configuration.mjs';

test('complete retries a truncated structured stage once with expanded budget', async () => {
  process.env.TEST_RETRY_KEY = 'secret';
  const calls = [];
  const records = [];
  const gateway = new ModelGateway({
    llm: {
      defaultProvider: 'test',
      requestTimeoutMs: 2000,
      safetyReserveTokens: 32,
      recentMessageCount: 8,
      providers: {
        test: {
          label: 'Test',
          baseUrl: 'http://unused.test/v1',
          model: 'mock',
          apiKeyEnv: 'TEST_RETRY_KEY',
          contextWindow: 32000,
          maxOutputTokens: 12000,
        },
      },
    },
  }, {
    recordModelCall(input) { records.push(input); return 9; },
  }, testConfigurationResolver);
  gateway.rawComplete = async (input) => {
    calls.push(input);
    return calls.length === 1
      ? { content: '{"outline":', usage: { prompt_tokens: 10, completion_tokens: 6000 }, finishReason: 'length' }
      : { content: '{"outline":[]}', usage: { prompt_tokens: 12, completion_tokens: 20 }, finishReason: 'stop' };
  };
  try {
    const result = await gateway.complete({
      purpose: 'article-planning',
      jsonMode: true,
      messages: [{ role: 'user', content: 'plan' }],
    });
    assert.equal(calls.length, 2);
    // article-planning 已关闭 thinking，不再追加推理余量，预算即输出预算本身
    assert.equal(calls[0].maxOutputTokens, 6000);
    assert.equal(calls[1].maxOutputTokens, 10000);
    assert.match(calls[1].messages[0].content, /上一次输出因长度达到上限/);
    assert.deepEqual(result.outputBudget, {
      initial: 6000, retry: 10000, adaptive: true, providerMax: 12000, used: 10000, attempts: 2,
    });
    assert.equal(records[0].completionTokens, 6020);
    assert.equal(records[0].outputBudget.source,'purpose-profile');
    assert.equal(records[0].outputBudget.thinkingReserve,0);
  } finally {
    delete process.env.TEST_RETRY_KEY;
  }
});
