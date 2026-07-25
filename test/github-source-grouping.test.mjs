import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionScopeAllows } from '../collectors/rsshub.mjs';

test('采集触发层把 GitHub Trending 与普通 RSSHub 路由分组',()=>{
  const github={kind:'route',value:'/github/trending/daily/any?limit=30'};
  const rss={kind:'route',value:'/readhub?limit=30'};
  const direct={kind:'direct',value:{url:'https://example.com/feed.xml'}};
  assert.equal(collectionScopeAllows('github',github),true);
  assert.equal(collectionScopeAllows('github',rss),false);
  assert.equal(collectionScopeAllows('rsshub',github),false);
  assert.equal(collectionScopeAllows('rsshub',rss),true);
  assert.equal(collectionScopeAllows('rsshub',direct),true);
});
