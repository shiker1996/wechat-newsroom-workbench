import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/core/store.mjs';
import { buildBatchPipelineStatus } from '../lib/domain/batch-pipeline-status.mjs';
import { isResearchEligibleHotspot } from '../lib/domain/hotspot-pipeline-scope.mjs';

test('autonomous writing placeholders are excluded from research progress', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-scope-'));
  const store = new Store(path.join(root, 'test.db'));
  try {
    const batch = store.createBatch({ date:'2026-07-28', title:'scope' });
    store.addHotspots(batch.id, 'rsshub', [{ title:'真实热点' }]);
    store.addManualHotspot(batch.id, { title:'自主写作', researchEligible:false });
    const hotspots = store.getBatch(batch.id).hotspots;
    assert.equal(hotspots.filter(isResearchEligibleHotspot).length, 1);
    assert.equal(hotspots.find((item)=>item.title === '自主写作').research_eligible, 0);
  } finally {
    store.close();
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('completed research keeps all previous steps completed', () => {
  const pipeline = buildBatchPipelineStatus({
    hotspotCount:317,
    tagged:313,
    total:317,
    cardsCount:301,
    cardsTotal:301,
    latestResearch:{ status:'completed' },
  });
  assert.deepEqual(Object.values(pipeline.steps).map((step)=>step.status), [
    'completed', 'completed', 'completed', 'completed',
  ]);
});
