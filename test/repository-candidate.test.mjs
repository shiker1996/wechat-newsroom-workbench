import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';
import { createRepositoryCandidate } from '../server/features/social-cards/index.mjs';

function tmpStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repository-candidate-'));
  return new Store(path.join(root, 'test.db'));
}

test('手动添加仓库图文：URL 规范化为裸仓库地址并建立工具图文候选', () => {
  const store = tmpStore();
  const batch = store.createBatch({ date: '2026-07-31', title: 't' });
  const candidate = createRepositoryCandidate({ store, batchId: batch.id, url: 'https://github.com/nvm-sh/nvm/', channel: 'wechat' });
  assert.equal(candidate.url, 'https://github.com/nvm-sh/nvm');
  const track = candidate.tracks.find((item) => item.track === 'social_cards');
  assert.equal(track.output_mode, 'wechat-tool-cards');
  assert.equal(track.pool_role, '工具图文');
  assert.equal(candidate.card_editorial.output_mode, 'wechat-tool-cards');
});

test('小红书渠道编码为 xiaohongshu-tool-cards', () => {
  const store = tmpStore();
  const batch = store.createBatch({ date: '2026-07-31', title: 't' });
  const candidate = createRepositoryCandidate({ store, batchId: batch.id, url: 'https://github.com/a/b', channel: 'xiaohongshu' });
  assert.equal(candidate.tracks.find((item) => item.track === 'social_cards').output_mode, 'xiaohongshu-tool-cards');
});

test('非 GitHub 仓库地址被拒绝', () => {
  const store = tmpStore();
  const batch = store.createBatch({ date: '2026-07-31', title: 't' });
  assert.throws(() => createRepositoryCandidate({ store, batchId: batch.id, url: 'https://example.com/a/b', channel: 'wechat' }), /GitHub 仓库地址/);
  assert.throws(() => createRepositoryCandidate({ store, batchId: batch.id, url: 'not-a-url', channel: 'wechat' }), /GitHub 仓库地址/);
});
