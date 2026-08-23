import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/core/store.mjs';
import { batchTopicsDir } from '../lib/core/workspace-paths.mjs';
import { buildTopicScoreOperationsMetrics } from '../lib/domain/topic-score-operations.mjs';

function writeDualRun(root, batch, summary) {
  const file = path.join(batchTopicsDir(root, batch), 'sources', 'score-dual-run.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, summary, items: [] }), 'utf8');
}

test('阶段7 聚合多个批次的评分双跑并给出校准状态', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'topic-score-ops-'));
  let store;
  try {
    store = new Store(path.join(root, 'workbench.db'));
    const first = store.createBatch({ date: '2026-08-22', title: '昨日批次' });
    const second = store.createBatch({ date: '2026-08-23', title: '今日批次' });
    writeDualRun(root, first, { candidateCount: 10, legacyDraftableCount: 6, currentDraftableCount: 7, poolChangedCount: 2, rankChangedCount: 4,
      meanDelta: 8, highTLowACount: 1, lowTHighACount: 2, repeatPenaltyCount: 3, readerStakeMissingCount: 1 });
    writeDualRun(root, second, { candidateCount: 10, legacyDraftableCount: 6, currentDraftableCount: 6, poolChangedCount: 1, rankChangedCount: 3,
      meanDelta: 4, highTLowACount: 2, lowTHighACount: 1, repeatPenaltyCount: 2, readerStakeMissingCount: 2 });
    const metrics = buildTopicScoreOperationsMetrics({ store, workspaceRoot: root, days: 7 });
    assert.equal(metrics.batchCount, 2);
    assert.equal(metrics.totals.candidateCount, 20);
    assert.equal(metrics.totals.poolChangedCount, 3);
    assert.equal(metrics.rates.poolChanged, 0.15);
    assert.equal(metrics.totals.meanDelta, 6);
    assert.equal(metrics.calibration.status, 'observe');
    assert.equal(metrics.calibration.ready, true);
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
