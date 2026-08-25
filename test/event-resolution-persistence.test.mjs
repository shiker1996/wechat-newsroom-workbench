import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'event-resolution-store-'));
  return { root, db: path.join(root, 'test.db') };
}

function shadow(eventId, hotspotIds, legacyIds = []) {
  return {
    schema_version: 1, resolver_version: 'shadow-v1', algorithm_version: 'structured-v1',
    events: [{ event_id: eventId, title: '事件', canonical_key: '主体|对象|事实',
      normalized: { whoKey: '主体', objectKey: '对象', actionType: '发布' },
      hotspot_ids: hotspotIds, legacy_event_ids: legacyIds, first_seen_at: '2026-08-23T08:00:00Z',
      last_seen_at: '2026-08-23T08:00:00Z', historical_match: null, event_state: 'new_event', update_type: 'new_event',
      new_information_hotspot_ids: hotspotIds }],
  };
}

test('事件归并双写：事件记录和报道归属可幂等写入并保留 legacy ID', () => {
  const { root, db } = workspace();
  let store;
  try {
    store = new Store(db);
    const batch = store.createBatch({ date: '2026-08-23', title: '事件归并测试' });
    store.addHotspots(batch.id, 'rsshub', [
      { id: 'source-1', title: '报道一', url: 'https://example.com/1', publishedAt: '2026-08-23T08:00:00Z' },
      { id: 'source-2', title: '报道二', url: 'https://example.com/2', publishedAt: '2026-08-23T08:01:00Z' },
    ]);
    const [first, second] = store.getBatch(batch.id).hotspots;
    const result = shadow('S-EVENT-1', [first.id, second.id], ['E-OLD-1', 'E-OLD-2']);
    assert.deepEqual(store.saveEventResolutionShadow(batch.id, result), { events: 1, memberships: 2, skipped: false });
    assert.deepEqual(store.saveEventResolutionShadow(batch.id, result), { events: 1, memberships: 2, skipped: false });
    const record = store.getEventRecord('S-EVENT-1');
    assert.equal(record.event_state, 'new_event');
    assert.deepEqual(record.legacy_ids, ['E-OLD-1', 'E-OLD-2']);
    const classified = store.saveEventClassification('S-EVENT-1', {
      content_class: 'github_project', confidence: 0.96, status: 'auto', reason: '仓库项目资料',
      evidence: [{ sourceId: 'hotspot:1', role: 'project_signal', claim: 'GitHub 仓库' }],
      features: { hasGithubRepository: true }, missing_evidence: ['技术机制证据'],
      article_eligible: false, social_eligible: true, default_route: 'social_cards',
    });
    assert.equal(classified.content_class, 'github_project');
    assert.equal(classified.article_eligible, false);
    assert.deepEqual(classified.classification_missing_evidence, ['技术机制证据']);
    assert.equal(store.listEventRecords().length, 1);
    assert.equal(store.listEventHotspots({ batchId: batch.id }).length, 2);
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('事件归并双写：历史事件的新事实保留 new_update、增量标记和最近更新时间', () => {
  const { root, db } = workspace();
  let store;
  try {
    store = new Store(db);
    const first = store.createBatch({ date: '2026-08-22', title: '历史批次' });
    const second = store.createBatch({ date: '2026-08-23', title: '当前批次' });
    store.addHotspots(first.id, 'rsshub', [{ id: 'source-1', title: '旧报道', url: 'https://example.com/old', publishedAt: '2026-08-22T08:00:00Z' }]);
    store.addHotspots(second.id, 'rsshub', [{ id: 'source-2', title: '新回应', url: 'https://example.com/new', publishedAt: '2026-08-23T08:00:00Z' }]);
    const [oldHotspot] = store.getBatch(first.id).hotspots;
    const [newHotspot] = store.getBatch(second.id).hotspots;
    store.saveEventResolutionShadow(first.id, shadow('S-HISTORY', [oldHotspot.id]));
    store.saveEventResolutionShadow(second.id, {
      schema_version: 1, resolver_version: 'shadow-v1', algorithm_version: 'structured-v1',
      events: [{ ...shadow('S-HISTORY', [newHotspot.id]).events[0], historical_match: { event_id: 'S-HISTORY', score: 90, method: 'structured' }, event_state: 'new_update', update_type: 'new_fact', new_information_hotspot_ids: [newHotspot.id], last_seen_at: '2026-08-23T08:00:00Z' }],
    });
    const record = store.getEventRecord('S-HISTORY');
    assert.equal(record.event_state, 'new_update');
    assert.equal(record.last_update_at, '2026-08-23T08:00:00Z');
    assert.equal(store.listEventHotspots({ batchId: second.id })[0].is_new_information, 1);
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('事件归并双写：同批次报道改判时移除旧归属，避免一条报道挂两个主事件', () => {
  const { root, db } = workspace();
  let store;
  try {
    store = new Store(db);
    const batch = store.createBatch({ date: '2026-08-23', title: '事件归并改判测试' });
    store.addHotspots(batch.id, 'rsshub', [{ id: 'source-1', title: '报道一', url: 'https://example.com/1' }]);
    const [hotspot] = store.getBatch(batch.id).hotspots;
    store.saveEventResolutionShadow(batch.id, shadow('S-OLD', [hotspot.id]));
    store.saveEventResolutionShadow(batch.id, shadow('S-NEW', [hotspot.id]));
    const memberships = store.listEventHotspots({ batchId: batch.id });
    assert.equal(memberships.length, 1);
    assert.equal(memberships[0].event_id, 'S-NEW');
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
