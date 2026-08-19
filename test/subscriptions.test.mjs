import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/core/store.mjs';
import { addSubscription, listSubscriptions, removeSubscription, subscriptionTestInput, updateSubscription } from '../lib/integrations/subscriptions.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'write-assistant-subscriptions-'));
  const store = new Store(path.join(root, 'workbench.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { store, repository: store.repositories.collectionSources };
}

test('订阅源经兼容层新增到 collection_sources 并可暂停', (t) => {
  const { repository } = fixture(t);
  addSubscription(repository, { kind: 'twitter', value: '@OpenAI' });
  addSubscription(repository, { kind: 'direct', value: 'https://example.com/feed.xml', label: '示例 Feed' });
  addSubscription(repository, { kind: 'rsshub', value: '/readhub?limit=30' });
  updateSubscription(repository, { kind: 'twitter', value: '/twitter/user/OpenAI?limit=30', enabled: false });
  const listed = listSubscriptions(repository);
  assert.equal(listed.summary.total, 3);
  assert.equal(listed.summary.twitter, 1);
  assert.equal(listed.summary.rsshub, 1);
  assert.equal(listed.summary.direct, 1);
  assert.equal(listed.items.find((item) => item.kind === 'twitter').enabled, false);
  assert.equal(listed.items.find((item) => item.kind === 'twitter').value, '/twitter/user/OpenAI?limit=30');
  assert.equal(repository.list().length, 3, '数据落在 collection_sources 表');
});

test('删除订阅从 collection_sources 移除', (t) => {
  const { repository } = fixture(t);
  addSubscription(repository, { kind: 'rsshub', value: '/readhub?limit=30' });
  assert.equal(repository.list().length, 1);
  removeSubscription(repository, { kind: 'rsshub', value: '/readhub?limit=30' });
  assert.equal(repository.list().length, 0);
  assert.throws(() => removeSubscription(repository, { kind: 'rsshub', value: '/readhub?limit=30' }), /订阅不存在/);
});

test('订阅台账把 GitHub Search 作为只读采集入口展示', (t) => {
  const { repository } = fixture(t);
  addSubscription(repository, { kind: 'github', value: '/github/trending/daily/any?limit=30' });
  repository.upsert({ pluginId: 'github-discovery-collector', pluginVersion: 'builtin', sourceType: 'github', sourceKey: 'github:search', label: 'GitHub Search', config: { createdWithinDays: 30, minStars: 1000, limit: 30 }, enabled: true, managed: true, origin: 'legacy-config' });
  const result = listSubscriptions(repository);
  const search = result.items.find((item) => item.value === 'github:search');
  assert.equal(search.kind, 'github');
  assert.equal(search.managed, true);
  assert.equal(result.summary.github, 2);
});

test('X 订阅测试同时兼容表单用户名和列表中的已保存路由', () => {
  assert.deepEqual(subscriptionTestInput({ kind: 'twitter', value: '@OpenAI' }), { kind: 'twitter', value: '/twitter/user/OpenAI?limit=3' });
  assert.deepEqual(subscriptionTestInput({ kind: 'twitter', value: '/twitter/user/Alibaba_Qwen?limit=30' }), { kind: 'twitter', value: '/twitter/user/Alibaba_Qwen?limit=3' });
  assert.throws(() => subscriptionTestInput({ kind: 'twitter', value: '/readhub?limit=30' }), /有效的 X 用户名/);
});
