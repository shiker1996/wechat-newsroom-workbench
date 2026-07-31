import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { attachInformationSearch, wantsInformationSearch } from '../lib/integrations/information-search.mjs';

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

test('wantsInformationSearch only triggers on explicit flags', () => {
  assert.equal(wantsInformationSearch({}), false);
  assert.equal(wantsInformationSearch({ enableWebSearch: 'false' }), false);
  assert.equal(wantsInformationSearch({ enableWebSearch: 'true' }), true);
  assert.equal(wantsInformationSearch({ enableNewsSearch: true }), true);
});

test('without flags the fact sheet stays untouched', async () => {
  const { root, cleanup } = tempRoot();
  try {
    const fact = { topic: '离线笔记方法' };
    const result = await attachInformationSearch({ fact, input: {}, root, toolContext: {} });
    assert.deepEqual(result, { attached: [], notes: [] });
    assert.equal('web_search' in fact, false);
    assert.equal('news_search' in fact, false);
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
        const result = await attachInformationSearch({ fact, input: { enableWebSearch: 'true' }, root, toolContext: {} });
        assert.deepEqual(result.attached, ['web_search']);
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
        const result = await attachInformationSearch({ fact, input: { enableNewsSearch: true }, root, toolContext: {} });
        assert.deepEqual(result.attached, ['news_search']);
        assert.equal(capture.body.topic, 'news');
        assert.ok(fact.news_search.warnings.some((item) => /缺少发布时间/.test(item)));
      } finally { restore(); }
    });
  } finally { cleanup(); }
});

test('search failure is recorded as a note instead of failing creation', async () => {
  const { root, cleanup } = tempRoot();
  try {
    await withKey(undefined, async () => {
      const fact = { topic: '离线笔记方法' };
      const result = await attachInformationSearch({ fact, input: { enableWebSearch: true }, root, toolContext: {} });
      assert.deepEqual(result.attached, []);
      assert.equal(result.notes.length, 1);
      assert.match(result.notes[0], /TAVILY_API_KEY/);
      assert.match(result.notes[0], /不阻止创建/);
      assert.deepEqual(fact.search_notes, result.notes);
      assert.equal('web_search' in fact, false);
    });
  } finally { cleanup(); }
});

test('creation chains wire search flags into both autonomous writing and custom cards', () => {
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const occurrences = server.match(/attachInformationSearch\(\{ ?fact, ?input/g) || [];
  assert.equal(occurrences.length, 2);
  assert.match(server, /skillId: 'custom-card-storyboard'/);
  assert.match(server, /skillId: ?skillSelection\.selectedSkill/);
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /name="enableWebSearch"/);
  assert.match(html, /name="enableNewsSearch"/);
  assert.match(html, /name="enableDocumentSearch"/);
  assert.match(html, /id="custom-enable-web-search"/);
  assert.match(html, /id="custom-enable-news-search"/);
  assert.match(html, /id="custom-enable-document-search"/);
  const socialEditor = fs.readFileSync(new URL('../public/src/views/social-editor.js', import.meta.url), 'utf8');
  assert.match(socialEditor, /enableWebSearch:document\.getElementById\('custom-enable-web-search'\)\.checked/);
  assert.match(socialEditor, /enableDocumentSearch:document\.getElementById\('custom-enable-document-search'\)\.checked/);
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
