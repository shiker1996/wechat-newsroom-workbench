import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.mjs';

test('批次、热点和概览可持久化', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-store-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-19', title: '测试批次' });
    store.addHotspots(batch.id, 'reddit', [{ id: 't3_1', title: '测试热点', url: 'https://example.com' }]);
    assert.equal(store.getBatch(batch.id).hotspots.length, 1);
    assert.equal(store.overview().hotspots, 1);
    assert.equal(store.listHotspots({ q: '测试' }).length, 1);
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('同一批次同来源同标题会更新而不重复', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-store-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-19', title: '测试批次' });
    store.addHotspots(batch.id, 'rsshub', [{ title: '同一条', url: 'https://one.example' }]);
    store.addHotspots(batch.id, 'rsshub', [{ title: '同一条', url: 'https://two.example' }]);
    const items = store.getBatch(batch.id).hotspots;
    assert.equal(items.length, 1);
    assert.equal(items[0].url, 'https://two.example');
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('不同具体订阅源的同标题热点不会互相覆盖', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-store-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-19', title: '来源身份测试' });
    store.addHotspots(batch.id, 'rsshub', [{ title:'同名发布',url:'https://one.example',sourceKey:'twitter:/twitter/user/OpenAI',sourceType:'twitter',sourceName:'@OpenAI' }]);
    store.addHotspots(batch.id, 'rsshub', [{ title:'同名发布',url:'https://two.example',sourceKey:'direct:https://two.example/feed.xml',sourceType:'direct',sourceName:'公众号二号' }]);
    const items = store.getBatch(batch.id).hotspots;
    assert.equal(items.length, 2);
    assert.deepEqual(new Set(items.map((item) => item.source)), new Set(['twitter:/twitter/user/OpenAI','direct:https://two.example/feed.xml']));
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('单源健康状态持久化且重启恢复悬空任务', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-store-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-19', title: '恢复测试' });
    store.updateBatch(batch.id,{status:'running'});
    const sourceRunId=store.startSourceRun(batch.id,'rsshub');
    store.createAiRun({id:'ai-running',batchId:batch.id,type:'tag',provider:'deepseek'});
    store.recordSubscriptionRun(batch.id,{sourceGroup:'rsshub',sourceType:'twitter',sourceKey:'twitter:/twitter/user/OpenAI',sourceName:'@OpenAI',status:'running',startedAt:'2026-07-19T00:00:00.000Z'});
    const recovered=store.recoverInterruptedWork();
    assert.deepEqual(recovered,{aiRuns:1,sourceRuns:1,subscriptionRuns:1,batches:1});
    assert.equal(store.getAiRun('ai-running').status,'interrupted');
    assert.equal(store.getBatch(batch.id).sources.find((item)=>item.id===sourceRunId).status,'interrupted');
    assert.equal(store.listSubscriptionHealth()[0].status,'interrupted');
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('候选、编辑决策与文稿形成连续状态', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-store-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-19', title: '生产链测试' });
    store.addHotspots(batch.id, 'reddit', [{ title: '值得讨论的热点', url: 'https://example.com/topic' }]);
    const hotspot = store.getBatch(batch.id).hotspots[0];
    const candidate = store.addCandidates(batch.id, [hotspot.id])[0];
    store.updateCandidate(candidate.id, { thesis: '这是一条明确命题', angle: '从开发者影响切入' });
    store.saveEditorial(candidate.id, { next_action: 'WRITE_NOW', confirmed_facts: '事实 A 已确认' });
    const restored = store.getCandidate(candidate.id);
    assert.equal(restored.thesis, '这是一条明确命题');
    assert.equal(restored.editorial.next_action, 'WRITE_NOW');
    store.saveHotspotSource(hotspot.id,{url:hotspot.url,status:'ok',title:'来源标题',content:'可核验正文',content_chars:5,fetched_at:'2026-07-19T08:00:00Z'});
    assert.equal(store.getCandidate(candidate.id).source_document.title,'来源标题');
    const document = store.saveDocument({ batchId: batch.id, candidateId: candidate.id, kind: 'draft', content: '# 标题\n\n正文。' });
    assert.equal(document.visible_chars, 3);
    assert.equal(store.listDocuments(batch.id).length, 1);
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
