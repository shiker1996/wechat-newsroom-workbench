import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRecentItems, parseFeed, githubTrendingPeriod, normalizeGitHubTrendingItem } from '../plugins/rsshub/collector.mjs';

test('解析 RSS 与 CDATA', () => {
  const xml = `<rss><channel><item><guid>x1</guid><title><![CDATA[AI &amp; 开源]]></title><link>https://example.com/a</link><pubDate>Sun, 19 Jul 2026 08:00:00 GMT</pubDate></item></channel></rss>`;
  const items = parseFeed(xml, '/demo');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'AI & 开源');
  assert.equal(items[0].url, 'https://example.com/a');
  assert.equal(items[0].publishedAt, '2026-07-19T08:00:00.000Z');
});

test('RSS 时间窗口过滤旧闻并保留无日期条目', () => {
  const items=[{title:'新',publishedAt:'2026-07-19T08:00:00Z'},{title:'旧',publishedAt:'2026-07-01T08:00:00Z'},{title:'无日期',publishedAt:null}];
  const result=filterRecentItems(items,{maxAgeHours:168,allowUndated:true},Date.parse('2026-07-19T10:00:00Z'));
  assert.deepEqual(result.kept.map((x)=>x.title),['新','无日期']);
  assert.deepEqual(result.stale.map((x)=>x.title),['旧']);
  assert.equal(result.undated.length,1);
});

test('解析 Atom link href', () => {
  const xml = `<feed><entry><id>a1</id><title>更新</title><link href="https://example.com/b"/><updated>2026-07-19T08:00:00Z</updated></entry></feed>`;
  assert.equal(parseFeed(xml, '/atom')[0].url, 'https://example.com/b');
});

test('GitHub Trending 路由规范化为统一仓库热点',()=>{assert.equal(githubTrendingPeriod('/github/trending/weekly/any?limit=30'),'weekly');const item=normalizeGitHubTrendingItem({title:'old',url:'https://github.com/OpenAI/codex',rank:3},'/github/trending/weekly/any');assert.equal(item.sourceGroup,'github');assert.equal(item.sourceType,'trending');assert.equal(item.sourceKey,'github:trending');assert.equal(item.repository,'OpenAI/codex');assert.deepEqual(item.periods,['weekly']);assert.equal(item.rank,3);});
