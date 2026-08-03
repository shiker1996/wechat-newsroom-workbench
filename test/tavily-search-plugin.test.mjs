import assert from 'node:assert/strict';
import test from 'node:test';
import { getToolRegistry } from '../lib/tools/index.mjs';

function stubFetch(payload, capture) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capture.url = url;
    capture.body = JSON.parse(options.body);
    return { ok: true, json: async () => payload };
  };
  return () => { globalThis.fetch = original; };
}

function withKey(value, run) {
  const original = process.env.TAVILY_API_KEY;
  if (value === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = value;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (original === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = original;
    });
}

test('tavily-search plugin implements web and news search capabilities', async () => {
  const registry = await getToolRegistry();
  for (const capability of ['content.web.search', 'content.news.search']) {
    const plugin = registry.resolve(capability);
    assert.equal(plugin?.manifest.id, 'tavily-search');
  }
});

test('missing TAVILY_API_KEY fails explicitly instead of falling back', async () => {
  const registry = await getToolRegistry();
  await withKey(undefined, async () => {
    const result = await registry.execute('content.web.search', { query: '测试' });
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'DEPENDENCY_MISSING');
    assert.match(result.error.message, /TAVILY_API_KEY/);
  });
});

test('web search normalizes results with provenance', async () => {
  const registry = await getToolRegistry();
  await withKey('test-key', async () => {
    const capture = {};
    const restore = stubFetch({
      answer: '摘要',
      results: [
        { title: '示例', url: 'https://example.com/a', content: '正文片段', published_date: '2026-07-30' },
        { title: '无地址', url: '', content: '应被过滤' },
      ],
    }, capture);
    try {
      const result = await registry.execute('content.web.search', { query: 'AI 新闻', maxResults: 3 });
      assert.equal(result.status, 'ok');
      assert.equal(capture.body.topic, undefined);
      assert.equal(capture.body.query, 'AI 新闻');
      assert.equal(capture.body.max_results, 3);
      assert.equal(result.data.results.length, 1);
      assert.deepEqual(result.data.results[0], {
        title: '示例', url: 'https://example.com/a', snippet: '正文片段',
        source: 'example.com', publishedAt: '2026-07-30',
      });
      assert.equal(result.data.answer, '摘要');
      assert.equal(result.provenance.provider, 'tavily');
      assert.equal(result.provenance.plugin, 'tavily-search');
      assert.equal(result.provenance.topic, 'general');
    } finally { restore(); }
  });
});

test('news search requests news topic and warns on missing published date', async () => {
  const registry = await getToolRegistry();
  await withKey('test-key', async () => {
    const capture = {};
    const restore = stubFetch({
      results: [{ title: '快讯', url: 'https://news.example.com/1', content: '内容' }],
    }, capture);
    try {
      const result = await registry.execute('content.news.search', { query: '科技快讯', timeRange: 'week' });
      assert.equal(result.status, 'ok');
      assert.equal(capture.body.topic, 'news');
      assert.equal(capture.body.time_range, 'week');
      assert.equal(result.provenance.topic, 'news');
      assert.ok(result.warnings.some((item) => /缺少发布时间/.test(item)));
    } finally { restore(); }
  });
});

test('health reports missing credential with configuration action', async () => {
  const registry = await getToolRegistry();
  await withKey(undefined, async () => {
    const result = await registry.health('content.web.search');
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'DEPENDENCY_MISSING');
    assert.equal(result.error.action, '在 .env 或系统环境变量中配置 TAVILY_API_KEY');
  });
  await withKey('test-key', async () => {
    const result = await registry.health('content.web.search');
    assert.equal(result.status, 'ok');
    assert.equal(result.data.available, true);
  });
});
