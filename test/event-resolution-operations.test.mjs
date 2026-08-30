import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';
import { batchTopicsDir } from '../server/platform/core/workspace-paths.mjs';
import { buildEventResolutionOperationsMetrics, readEventResolutionReview } from '../server/features/research/index.mjs';

function writeDiff(root, batch, diff) {
  const file = path.join(batchTopicsDir(root, batch), 'sources', 'event-resolution-shadow-diff.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(diff), 'utf8');
}

function shadow(eventId, hotspotId, state = null) {
  return { events: [{ event_id: eventId, title: '事件', canonical_key: '主体|对象|事实',
    normalized: { whoKey: '主体', objectKey: '对象', actionType: '发布' }, hotspot_ids: [hotspotId],
    legacy_event_ids: [], historical_match: state ? { event_id: eventId, score: 90, method: 'exact' } : null,
    last_seen_at: '2026-08-23T08:00:00Z' }] };
}

function batchDate(offsetDays = 0) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

test('阶段 E 记录人工校正并计算近期开环指标', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'event-resolution-ops-'));
  let store;
  try {
    store = new Store(path.join(root, 'workbench.db'));
    const older = store.createBatch({ date: batchDate(-1), title: '昨日批次' });
    const current = store.createBatch({ date: batchDate(), title: '今日批次' });
    store.addHotspots(older.id, 'rsshub', [{ id: 'old', title: '旧报道', url: 'https://example.com/old' }]);
    store.addHotspots(current.id, 'rsshub', [{ id: 'new', title: '新报道', url: 'https://example.com/new' }]);
    const oldHotspot = store.getBatch(older.id).hotspots[0];
    const newHotspot = store.getBatch(current.id).hotspots[0];
    store.saveEventResolutionShadow(older.id, shadow('S-REPEAT', oldHotspot.id));
    store.saveEventResolutionShadow(current.id, shadow('S-REPEAT', newHotspot.id, true));
    store.addCandidates(older.id, [oldHotspot.id]);
    store.addCandidates(current.id, [newHotspot.id]);
    writeDiff(root, older, { input_count: 2, legacy: { event_count: 2 }, shadow: { event_count: 1 }, differences: { merges: [{ event_id: 'S-REPEAT' }], splits: [], review_queue: [] } });
    writeDiff(root, current, { input_count: 2, legacy: { event_count: 2 }, shadow: { event_count: 2 }, differences: { merges: [], splits: [], review_queue: [{ hotspotId: newHotspot.id }] } });
    const decision = store.recordEventResolutionDecision({ batchId: current.id, eventId: 'S-REPEAT', decisionType: 'misreport', hotspotIds: [newHotspot.id], reason: '示例复核' });
    assert.equal(decision.decision_type, 'misreport');
    assert.deepEqual(store.listEventResolutionDecisions({ batchId: current.id })[0].hotspot_ids, [newHotspot.id]);
    const metrics = buildEventResolutionOperationsMetrics({ store, workspaceRoot: root, days: 7 });
    assert.equal(metrics.batchCount, 2);
    assert.equal(metrics.totals.reviewQueue, 1);
    assert.equal(metrics.manualCorrections, 1);
    assert.equal(metrics.duplicateEventRate, 1 / 4);
    assert.equal(metrics.crossBatchRepeatPoolRate, 0.5);
    assert.equal(readEventResolutionReview({ store, workspaceRoot: root, batch: current }).decisions.length, 1);
    assert.ok(store.revertEventResolutionDecision(decision.id));
    assert.equal(store.listEventResolutionDecisions({ batchId: current.id, activeOnly: true }).length, 0);
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
