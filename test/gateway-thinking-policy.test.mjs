import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelGateway, thinkingEnabledFor } from '../lib/llm/gateway.mjs';

test('thinkingEnabledFor 按用途裁决：结构化抽取关闭，对话/写作/研判开启', () => {
  for (const purpose of [
    'hotspot-tagging', 'event-card', 'hotspot-brainstorm-explore',
    'article-quality-gate-drafting', 'daily-quality-gate-seo', 'tutorial-quality-gate-review',
    'article-title-generation', 'daily-title-generation', 'tutorial-title-generation',
    'article-fact-base', 'article-planning', 'article-image-plan', 'article-visual-plan', 'article-visual-plan-mobile-retry',
    'magazine-design', 'social-card-copy', 'social-card-editorial', 'social-card-layout-repair',
    'connection-test',
  ]) {
    assert.equal(thinkingEnabledFor(purpose), false, `${purpose} 应关闭 thinking`);
  }
  for (const purpose of [
    'editorial-room', 'tutorial-chat', 'custom-social-chat',
    'breaking-analysis', 'hotspot-synthesis-provisional',
    'article-drafting-pipeline', 'article-humanize', 'article-review', 'article-seo',
    'daily-drafting', 'tutorial-drafting', 'typeset-html',
  ]) {
    assert.equal(thinkingEnabledFor(purpose), true, `${purpose} 应保持 thinking`);
  }
});

function makeGateway(calls) {
  process.env.TEST_THINKING_KEY = 'secret';
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
          apiKeyEnv: 'TEST_THINKING_KEY',
          contextWindow: 32000,
          maxOutputTokens: 12000,
          supportsThinkingToggle: true,
        },
      },
    },
  }, { recordModelCall() { return 1; } });
  gateway.rawComplete = async (input) => {
    calls.push(input);
    return { content: '{}', usage: { prompt_tokens: 10, completion_tokens: 5 }, finishReason: 'stop' };
  };
  return gateway;
}

test('complete 对打标用途传 thinking:false，对编辑室用途传 thinking:true', async () => {
  const calls = [];
  const gateway = makeGateway(calls);
  try {
    await gateway.complete({ purpose: 'hotspot-tagging', jsonMode: true, messages: [{ role: 'user', content: 'tag' }] });
    await gateway.complete({ purpose: 'editorial-room', jsonMode: true, messages: [{ role: 'user', content: 'chat' }] });
    const mainCalls = calls.filter((c) => c.messages[0].role !== 'system' || !String(c.messages[0].content).includes('摘要'));
    assert.equal(calls[0].thinking, false);
    assert.equal(calls[1].thinking, true);
    assert.ok(mainCalls.length >= 1);
  } finally {
    delete process.env.TEST_THINKING_KEY;
  }
});

test('input.thinking 显式指定时覆盖用途策略', async () => {
  const calls = [];
  const gateway = makeGateway(calls);
  try {
    await gateway.complete({ purpose: 'hotspot-tagging', thinking: true, messages: [{ role: 'user', content: 'tag' }] });
    await gateway.complete({ purpose: 'editorial-room', thinking: false, messages: [{ role: 'user', content: 'chat' }] });
    assert.equal(calls[0].thinking, true);
    assert.equal(calls[1].thinking, false);
  } finally {
    delete process.env.TEST_THINKING_KEY;
  }
});

test('rawComplete 按 thinking 状态下发 thinking 参数，推理强度同时顶层与内嵌发送', async () => {
  process.env.TEST_THINKING_KEY = 'secret';
  const payloads = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    payloads.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: {} }) };
  };
  const gateway = new ModelGateway({
    llm: {
      defaultProvider: 'test', requestTimeoutMs: 2000, safetyReserveTokens: 32, recentMessageCount: 8,
      providers: {
        test: { label: 'Test', baseUrl: 'http://unused.test/v1', model: 'mock', apiKeyEnv: 'TEST_THINKING_KEY', contextWindow: 32000, maxOutputTokens: 12000, supportsThinkingToggle: true, reasoningEffort: 'low' },
        plain: { label: 'Plain', baseUrl: 'http://unused.test/v1', model: 'mock', apiKeyEnv: 'TEST_THINKING_KEY', contextWindow: 32000, maxOutputTokens: 12000 },
      },
    },
  }, { recordModelCall() { return 1; } });
  try {
    const { providerName, provider, apiKey } = gateway.resolve('test');
    await gateway.rawComplete({ providerName, provider, apiKey, thinking: false, messages: [{ role: 'user', content: 'x' }] });
    await gateway.rawComplete({ providerName, provider, apiKey, thinking: true, messages: [{ role: 'user', content: 'x' }] });
    const plain = gateway.resolve('plain');
    await gateway.rawComplete({ ...plain, thinking: false, messages: [{ role: 'user', content: 'x' }] });
    assert.deepEqual(payloads[0].thinking, { type: 'disabled' });
    assert.equal(payloads[0].reasoning_effort, undefined);
    assert.deepEqual(payloads[1].thinking, { type: 'enabled', reasoning_effort: 'low' });
    assert.equal(payloads[1].reasoning_effort, 'low', '推理强度需按 DeepSeek OpenAI SDK 用法顶层下发');
    assert.equal('thinking' in payloads[2], false, '不支持开关的 provider 不应收到 thinking 参数');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_THINKING_KEY;
  }
});

test('thinking 开启时输出预算追加推理余量，关闭时不追加', async () => {
  const calls = [];
  const gateway = makeGateway(calls);
  try {
    await gateway.complete({ purpose: 'editorial-room', messages: [{ role: 'user', content: 'chat' }] });
    await gateway.complete({ purpose: 'hotspot-tagging', maxOutputTokens: 1450, messages: [{ role: 'user', content: 'tag' }] });
    assert.equal(calls[0].maxOutputTokens, 3500 + 8000, '编辑室 initial 3500 + 默认推理余量 8000');
    assert.equal(calls[1].maxOutputTokens, 1450, '打标关闭 thinking，预算保持请求值');
  } finally {
    delete process.env.TEST_THINKING_KEY;
  }
});
