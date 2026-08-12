import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/core/store.mjs';
import { fetchCandidateSourceImplementation } from '../plugins/url-fetch/implementation.mjs';
import { eventGroupsForCandidate } from '../lib/domain/event-fact-base.mjs';

function createStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-sources-'));
  return { root, store: new Store(path.join(root, 'test.db')) };
}

function okFetch({ targetUrl }) {
  return {
    status: 'ok', url: targetUrl, final_url: targetUrl, title: `标题 ${targetUrl}`,
    description: '', author: '', published_at: '', content: `正文 ${targetUrl}`,
    content_chars: 10, fetched_at: new Date().toISOString(), error: '', fetch_method: 'test',
  };
}

test('candidate_sources 按候选+URL 存取与覆盖', () => {
  const { store } = createStore();
  const batch = store.createBatch({ date: '2026-08-07', title: '补充来源' });
  store.addHotspots(batch.id, 'manual', [{ title: '热点', url: 'https://example.com/h' }]);
  const candidate = store.addCandidates(batch.id, [store.getBatch(batch.id).hotspots[0].id])[0];

  store.saveCandidateSource(candidate.id, { url: 'https://a.com/1', status: 'ok', title: '甲', content: 'x'.repeat(100), content_chars: 100 });
  store.saveCandidateSource(candidate.id, { url: 'https://b.com/2', status: 'error', error: '超时' });
  let rows = store.listCandidateSources(candidate.id);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.url === 'https://a.com/1').title, '甲');
  assert.equal(rows.find((r) => r.url === 'https://b.com/2').status, 'error');

  // 同 URL 重抓覆盖而非新增
  store.saveCandidateSource(candidate.id, { url: 'https://a.com/1', status: 'ok', title: '甲-更新', content_chars: 200 });
  rows = store.listCandidateSources(candidate.id);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.url === 'https://a.com/1').title, '甲-更新');
  assert.equal(rows.find((r) => r.url === 'https://a.com/1').content_chars, 200);
});

test('urlOverrides 多链接逐个抓取并落 candidate_sources，单条失败不影响其余', async () => {
  const { root, store } = createStore();
  const batch = store.createBatch({ date: '2026-08-07', title: '补充来源' });
  store.addHotspots(batch.id, 'manual', [{ title: '热点', url: 'https://example.com/h' }]);
  const candidate = store.addCandidates(batch.id, [store.getBatch(batch.id).hotspots[0].id])[0];

  const urls = ['https://a.com/1', 'https://b.com/2', 'https://c.com/3'];
  const result = await fetchCandidateSourceImplementation({
    store, candidateId: candidate.id, root, force: true, urlOverrides: urls,
    fetchImpl: async (input) => input.targetUrl.includes('b.com')
      ? { status: 'error', url: input.targetUrl, error: '模拟失败', content_chars: 0 }
      : okFetch(input),
  });
  assert.equal(result.count, 3);
  assert.equal(result.ok, 2);
  assert.equal(result.errors, 1);
  assert.equal(result.status, 'partial');
  assert.equal(result.results.length, 3);
  assert.match(result.error, /b\.com/);

  const rows = store.listCandidateSources(candidate.id);
  assert.equal(rows.length, 3);
  assert.equal(rows.find((r) => r.url === 'https://b.com/2').status, 'error');

  // 缓存文件按候选+URL 稳定命名且互不覆盖
  const cacheDir = path.join(root, 'data', 'source-cache');
  const files = fs.readdirSync(cacheDir).filter((f) => f.startsWith(`candidate-${candidate.id}-override-`));
  assert.equal(files.length, 3);

  // 兼容旧的单链接 urlOverride 参数
  const single = await fetchCandidateSourceImplementation({
    store, candidateId: candidate.id, root, force: true, urlOverride: 'https://d.com/4', fetchImpl: okFetch,
  });
  assert.equal(single.ok, 1);
  assert.equal(store.listCandidateSources(candidate.id).length, 4);
});

test('composite 候选的补充链接同样入库并可被事实基座读回', async () => {
  const { root, store } = createStore();
  const batch = store.createBatch({ date: '2026-08-07', title: '综合批次' });
  store.addHotspots(batch.id, 'manual', [
    { title: '热点一', url: 'https://example.com/1' },
    { title: '热点二', url: 'https://example.com/2' },
  ]);
  const hotspotIds = store.getBatch(batch.id).hotspots.map((h) => h.id);
  const composite = store.createCompositeCandidate(batch.id, hotspotIds, { title: '综合选题' });

  await fetchCandidateSourceImplementation({
    store, candidateId: composite.id, root, force: true,
    urlOverrides: ['https://news.com/x', 'https://news.com/y'], fetchImpl: okFetch,
  });
  assert.equal(store.listCandidateSources(composite.id).length, 2);

  // 事实基座：补充来源作为「用户补充来源」分组注入
  const groups = eventGroupsForCandidate({ store, workspaceRoot: root, candidate: store.getCandidate(composite.id) });
  const supplied = groups.find((g) => g.event_id === 'user-supplied');
  assert.ok(supplied, '应存在用户补充来源分组');
  assert.equal(supplied.title, '用户补充来源');
  assert.equal(supplied.hotspots.length, 2);
  assert.equal(supplied.hotspots[0].sourceDoc.status, 'ok');
  assert.match(supplied.hotspots[0].sourceDoc.content, /正文/);
});

test('无补充来源时事实基座不注入分组', () => {
  const { root, store } = createStore();
  const batch = store.createBatch({ date: '2026-08-07', title: '空批次' });
  store.addHotspots(batch.id, 'manual', [{ title: '热点', url: 'https://example.com/h' }]);
  const candidate = store.addCandidates(batch.id, [store.getBatch(batch.id).hotspots[0].id])[0];
  const groups = eventGroupsForCandidate({ store, workspaceRoot: root, candidate: store.getCandidate(candidate.id) });
  assert.equal(groups.find((g) => g.event_id === 'user-supplied'), undefined);
});
