import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/core/store.mjs';
import { batchTopicsDir } from '../lib/core/workspace-paths.mjs';
import { runEventResolutionBackfill, writeEventResolutionBackfillReport } from '../lib/domain/event-resolution-backfill.mjs';

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'event-resolution-backfill-'));
  return { root, db: path.join(root, 'data.db') };
}

function taggedItem(id, title, what, date) {
  return { id: `source-${id}`, title, url: `https://example.com/${id}`, publishedAt: `${date}T08:00:00Z`,
    score: 80, aiTags: { eventKey: `张丹丹|${what}`, keywords: ['灵活就业', '社保'],
      eventParts: { who: '张丹丹', what, actionType: '争议回应', object: '灵活就业社保' } } };
}

test('阶段B回填默认dry-run：按批次顺序生成报告但不写事件表', () => {
  const { root, db } = tempWorkspace();
  let store;
  try {
    store = new Store(db);
    const oldBatch = store.createBatch({ date: '2026-08-21', title: '旧批次' });
    const newBatch = store.createBatch({ date: '2026-08-22', title: '新批次' });
    store.addHotspots(oldBatch.id, 'rsshub', [taggedItem(1, '称灵活就业是福利', '称灵活就业是福利引发争议', '2026-08-21')]);
    store.addHotspots(newBatch.id, 'rsshub', [taggedItem(2, '张丹丹争议回应', '灵活就业争议回应', '2026-08-22')]);
    const report = runEventResolutionBackfill({ store, workspaceRoot: root, limit: 2 });
    assert.equal(report.mode, 'dry-run');
    assert.equal(report.batch_count, 2);
    assert.equal(report.totals.conservation_ok, true);
    assert.equal(report.batches[0].batch_id, oldBatch.id);
    assert.equal(store.listEventRecords().length, 0);
    const reportFile = path.join(root, 'topics', 'event-resolution-backfill.json');
    writeEventResolutionBackfillReport(root, report);
    assert.equal(fs.existsSync(reportFile), true);
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('阶段B apply：写入事件表并生成稳定事件卡旁路产物', () => {
  const { root, db } = tempWorkspace();
  let store;
  try {
    store = new Store(db);
    const batch = store.createBatch({ date: '2026-08-22', title: '事件卡迁移' });
    store.addHotspots(batch.id, 'rsshub', [taggedItem(3, '张丹丹争议', '灵活就业争议回应', '2026-08-22')]);
    const fullBatch = store.getBatch(batch.id);
    const [hotspot] = fullBatch.hotspots;
    const dir = path.join(batchTopicsDir(root, fullBatch), 'sources');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'event-clusters.json'), JSON.stringify({ events: [{ event_id: 'EOLD', articles: [{ hotspot_id: hotspot.id }] }] }));
    fs.writeFileSync(path.join(dir, 'event-cards.json'), JSON.stringify({ items: [{ event_id: 'EOLD', title: '事件卡' }] }));
    const report = runEventResolutionBackfill({ store, workspaceRoot: root, limit: 1, apply: true });
    assert.equal(report.mode, 'apply');
    assert.equal(report.batches[0].persisted, true);
    assert.equal(store.listEventRecords().length, 1);
    const stablePath = report.batches[0].event_card_migration.path;
    const stable = JSON.parse(fs.readFileSync(stablePath, 'utf8'));
    assert.equal(stable.schema_version, 2);
    assert.match(stable.items[0].event_id, /^S/);
    assert.equal(stable.items[0].legacy_event_id, 'EOLD');
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
