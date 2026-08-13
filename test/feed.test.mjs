import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRecentItems, parseFeed } from '../plugins/feed/collector.mjs';

test('Feed 插件独立解析 RSS 与 CDATA', () => {
  const xml = '<rss><channel><item><guid>x1</guid><title><![CDATA[AI &amp; 开源]]></title><link>https://example.com/a</link><pubDate>Sun, 19 Jul 2026 08:00:00 GMT</pubDate></item></channel></rss>';
  const items = parseFeed(xml, 'https://example.com/feed.xml');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'AI & 开源');
  assert.equal(items[0].url, 'https://example.com/a');
  assert.equal(items[0].publishedAt, '2026-07-19T08:00:00.000Z');
});

test('Feed 插件独立解析 Atom link href', () => {
  const xml = '<feed><entry><id>a1</id><title>更新</title><link href="https://example.com/b"/><updated>2026-07-19T08:00:00Z</updated></entry></feed>';
  assert.equal(parseFeed(xml, 'https://example.com/atom.xml')[0].url, 'https://example.com/b');
});

test('Feed 插件独立过滤时间窗口', () => {
  const items = [{ title: '新', publishedAt: '2026-07-19T08:00:00Z' }, { title: '旧', publishedAt: '2026-07-01T08:00:00Z' }, { title: '无日期', publishedAt: null }];
  const result = filterRecentItems(items, { maxAgeHours: 168, allowUndated: true }, Date.parse('2026-07-19T10:00:00Z'));
  assert.deepEqual(result.kept.map((item) => item.title), ['新', '无日期']);
  assert.deepEqual(result.stale.map((item) => item.title), ['旧']);
});
