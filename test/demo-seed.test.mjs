import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/core/store.mjs';
import { seedDemoData } from '../lib/demo/seed.mjs';

function setup() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-demo-seed-'));
  const store = new Store(path.join(tempRoot, 'demo.db'));
  return { tempRoot, store };
}

function teardown({ tempRoot, store }) {
  store?.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function taggedHotspots(store, batchId) {
  return store.getBatch(batchId).hotspots.filter((item) => {
    try {
      const tags = JSON.parse(item.raw_json).aiTags;
      return Boolean(tags?.eventKey && tags?.preScores && tags?.keywords?.length);
    } catch { return false; }
  });
}

test('演示数据种子：无数据时写入两个批次并保持幂等', () => {
  const ctx = setup();
  try {
    const first = seedDemoData(ctx.store, { root: ctx.tempRoot });
    assert.equal(first.seeded, true);
    const overview = ctx.store.overview();
    assert.equal(overview.batches, 2);
    assert.ok(overview.hotspots >= 10);
    assert.ok(overview.latest);
    assert.ok(overview.articleCandidates >= 4);
    assert.ok(overview.socialCandidates >= 3);
    const second = seedDemoData(ctx.store, { root: ctx.tempRoot });
    assert.equal(second.seeded, false);
    assert.equal(ctx.store.overview().batches, 2);
  } finally { teardown(ctx); }
});

test('演示数据种子：打标热点可被聚类且评分非零', () => {
  const ctx = setup();
  try {
    seedDemoData(ctx.store, { root: ctx.tempRoot });
    const batch = ctx.store.latestActiveBatch();
    const tagged = taggedHotspots(ctx.store, batch.id);
    assert.ok(tagged.length >= 6, '演示批次应有可聚类的已打标热点');
    const keys = new Set(tagged.map((item) => JSON.parse(item.raw_json).aiTags.eventKey));
    assert.ok(keys.size >= 4, '演示批次应覆盖多个事件聚簇');
    for (const item of tagged) {
      const scores = JSON.parse(item.raw_json).aiTags.preScores;
      const base = ['conflict','audience','informationGain','emotion','timeliness','impact','sourceReliability']
        .reduce((sum, key) => sum + (scores[key] || 0), 0);
      assert.ok(base > 20, `演示热点应有非零预评分（${item.title}）`);
    }
  } finally { teardown(ctx); }
});

test('演示数据种子：两个批次均有产物与完成的 AI 任务', () => {
  const ctx = setup();
  try {
    seedDemoData(ctx.store, { root: ctx.tempRoot });
    const batches = ctx.store.listBatches();
    for (const batch of batches) {
      const full = ctx.store.getBatch(batch.id);
      assert.ok(full.ai_runs.some((run) => run.status === 'completed'), '每个演示批次应有已完成 AI 任务');
    }
    const artifacts = ctx.store.listArtifacts();
    assert.ok(artifacts.length >= 2, '演示数据应包含产物记录');
    for (const artifact of artifacts) {
      assert.equal(fs.existsSync(artifact.file_path), true, `演示产物文件应真实存在（${artifact.file_path}）`);
    }
  } finally { teardown(ctx); }
});
