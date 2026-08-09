import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { attachInformationSearch } from '../lib/integrations/information-search.mjs';

function withKey(value, run) {
  const original = process.env.TAVILY_API_KEY;
  if (value === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = value;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (original === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = original;
    });
}

function stubFetch(payload, capture = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capture.body = JSON.parse(options.body);
    return { ok: true, json: async () => payload };
  };
  return () => { globalThis.fetch = original; };
}

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'information-search-'));
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('search runs unconditionally; without API key it records notes instead of failing', async () => {
  const { root, cleanup } = tempRoot();
  try {
    await withKey(undefined, async () => {
      const fact = { topic: '离线笔记方法' };
      const result = await attachInformationSearch({ fact, input: {}, root, toolContext: {} });
      assert.deepEqual(result.attached, []);
      assert.equal('web_search' in fact, false);
      assert.equal('news_search' in fact, false);
      assert.ok(result.notes.some((item) => /TAVILY_API_KEY/.test(item)));
      assert.ok(result.notes.some((item) => /不阻止创建/.test(item)));
      assert.ok(result.notes.some((item) => /未配置授权知识库目录|无可用实现/.test(item)));
      assert.deepEqual(fact.search_notes, result.notes);
    });
  } finally { cleanup(); }
});

test('web search attaches normalized findings to the fact sheet', async () => {
  const { root, cleanup } = tempRoot();
  try {
    await withKey('test-key', async () => {
      const restore = stubFetch({
        answer: '摘要',
        results: [{ title: '示例', url: 'https://example.com/a', content: '片段', published_date: '2026-07-30' }],
      });
      try {
        const fact = { topic: '离线笔记方法' };
        const result = await attachInformationSearch({ fact, input: {}, root, toolContext: {} });
        assert.deepEqual(result.attached, ['web_search', 'news_search']);
        assert.equal(fact.web_search.query, '离线笔记方法');
        assert.equal(fact.web_search.provider, 'tavily');
        assert.equal(fact.web_search.results.length, 1);
        assert.equal(fact.web_search.results[0].source, 'example.com');
        assert.equal(fact.web_search.results[0].publishedAt, '2026-07-30');
        assert.ok(fact.web_search.searched_at);
      } finally { restore(); }
    });
  } finally { cleanup(); }
});

test('news search requests news topic and keeps provider warnings', async () => {
  const { root, cleanup } = tempRoot();
  try {
    await withKey('test-key', async () => {
      const capture = {};
      const restore = stubFetch({ results: [{ title: '快讯', url: 'https://news.example.com/1', content: '内容' }] }, capture);
      try {
        const fact = { topic: 'AI 行业动态' };
        const result = await attachInformationSearch({ fact, input: {}, root, toolContext: {} });
        assert.deepEqual(result.attached, ['web_search', 'news_search']);
        assert.equal(capture.body.topic, 'news');
        assert.ok(fact.news_search.warnings.some((item) => /缺少发布时间/.test(item)));
      } finally { restore(); }
    });
  } finally { cleanup(); }
});

test('creation chains wire search flags into both autonomous writing and custom cards', () => {
  const server = `${fs.readFileSync(new URL('../lib/http/routes/candidate-routes.mjs', import.meta.url), 'utf8')}\n${fs.readFileSync(new URL('../lib/http/routes/task-routes.mjs', import.meta.url), 'utf8')}`;
  const occurrences = server.match(/attachInformationSearch\(\{ ?fact, ?input/g) || [];
  assert.equal(occurrences.length, 2);
  assert.match(server, /skillId: 'custom-card-storyboard'/);
  assert.match(server, /skillId: ?skillSelection\.selectedSkill/);
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.equal(html.includes('enableWebSearch'), false, 'creation forms should not carry per-form search toggles');
  assert.equal(html.includes('custom-enable-web-search'), false);
  assert.match(html, /信息工具」统一启停/);
  const socialEditor = fs.readFileSync(new URL('../public/src/views/social-editor.js', import.meta.url), 'utf8');
  assert.equal(socialEditor.includes('custom-enable-web-search'), false);
});

test('writer and storyboard skills declare search capabilities and material boundaries', () => {
  for (const id of ['wechat-mp-tutorial', 'wechat-mp-personal-writing', 'custom-card-storyboard']) {
    const manifest = JSON.parse(fs.readFileSync(new URL(`../skills/${id}/skill.json`, import.meta.url), 'utf8'));
    assert.ok(manifest.optionalCapabilities.includes('content.web.search'), `${id} 缺少 content.web.search`);
    assert.ok(manifest.optionalCapabilities.includes('content.news.search'), `${id} 缺少 content.news.search`);
    assert.ok(manifest.optionalCapabilities.includes('content.document.search'), `${id} 缺少 content.document.search`);
    const skill = fs.readFileSync(new URL(`../skills/${id}/SKILL.md`, import.meta.url), 'utf8');
    assert.match(skill, /web_search/);
    assert.match(skill, /document_search/);
    assert.match(skill, /来源/);
  }
});
