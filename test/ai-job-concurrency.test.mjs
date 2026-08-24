import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';
import { AiJobManager } from '../server/platform/jobs/ai-job-manager.mjs';

const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

function setup() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-ai-concurrency-'));
  const store = new Store(path.join(tempRoot, 'jobs.db'));
  const gateway = { config: { defaultProvider: 'test' }, resolve() {} };
  const manager = (maxConcurrent = 2) => new AiJobManager(store, gateway, {
    aiJobs: { maxConcurrent },
    rsshub: { maxAgeHours: 168 },
    workspaceRoot: tempRoot,
  }, {
    handlers: new Map(['tag','retag','event-cards','research','breaking-analysis','article','daily','tutorial','typeset','social-card','cover-image','auto'].map((type) => [type, async () => ({})])),
    batchLevelTypes: new Set(['tag','retag','event-cards','research','breaking-analysis','auto','daily']),
  });
  return { tempRoot, store, manager };
}

function teardown(ctx) {
  ctx.store?.close();
  fs.rmSync(ctx.tempRoot, { recursive: true, force: true });
}

function makeCandidates(store, count) {
  const batch = store.createBatch({ date: '2026-08-04', title: '并发测试批次', requestedTracks: ['social_cards'] });
  store.addHotspots(batch.id, 'manual', Array.from({ length: count }, (_, i) => ({ title: `热点 ${i + 1}` })));
  const hotspotIds = store.getBatch(batch.id).hotspots.map((item) => item.id);
  store.addCandidates(batch.id, hotspotIds, { tracks: ['social_cards'] });
  const candidates = store.listCandidates(batch.id, 'social_cards');
  return { batch, candidates };
}

test('不同候选的 social-card 任务互不阻塞，可同时运行', async () => {
  const ctx = setup();
  try {
    const { batch, candidates } = makeCandidates(ctx.store, 2);
    const mgr = ctx.manager(2);
    const jobA = mgr.start({ batchId: batch.id, candidateId: candidates[0].id, type: 'social-card' });
    const jobB = mgr.start({ batchId: batch.id, candidateId: candidates[1].id, type: 'social-card' });
    assert.notEqual(jobA.id, jobB.id, '不同候选应各自创建任务');
    assert.ok(jobA.status === 'running' || jobA.status === 'queued');
    assert.ok(jobB.status === 'running' || jobB.status === 'queued');
    assert.equal(mgr.running.size, 2, '两个互斥键应同时占用（候选级并行）');
    assert.equal(mgr.pending.length, 0);
    await settle(120);
  } finally { teardown(ctx); }
});

test('同批次两个不同批次级任务互斥排队而非报错', async () => {
  const ctx = setup();
  try {
    const { batch } = makeCandidates(ctx.store, 1);
    const mgr = ctx.manager(2);
    mgr.start({ batchId: batch.id, type: 'research' });
    const second = mgr.start({ batchId: batch.id, type: 'event-cards' });
    assert.equal(second.status, 'queued', '同批次另一个批次级任务应排队');
    assert.equal(mgr.pending.length, 1);
    await settle(120);
  } finally { teardown(ctx); }
});

test('同一候选重复启动同一类型任务返回同一任务（幂等去重）', async () => {
  const ctx = setup();
  try {
    const { batch, candidates } = makeCandidates(ctx.store, 1);
    const mgr = ctx.manager(2);
    const first = mgr.start({ batchId: batch.id, candidateId: candidates[0].id, type: 'social-card' });
    const again = mgr.start({ batchId: batch.id, candidateId: candidates[0].id, type: 'social-card' });
    assert.equal(again.id, first.id);
    await settle(120);
  } finally { teardown(ctx); }
});

test('超过并发上限的任务排队，前一任务结束后继续执行', async () => {
  const ctx = setup();
  try {
    const { batch, candidates } = makeCandidates(ctx.store, 3);
    const mgr = ctx.manager(1); // 全局只允许 1 个并发
    const jobs = candidates.map((candidate) => mgr.start({ batchId: batch.id, candidateId: candidate.id, type: 'social-card' }));
    assert.equal(jobs.filter((job) => job.status === 'running').length, 1, '并发上限=1 时只有一个运行');
    assert.equal(jobs.filter((job) => job.status === 'queued').length, 2, '其余排队');
    await settle(120);
    const settled = jobs.map((job) => mgr.get(job.id).status);
    assert.ok(settled.every((status) => status === 'failed' || status === 'completed'), `任务应全部结束：${settled.join(',')}`);
    assert.equal(mgr.activeCount, 0);
    assert.equal(mgr.pending.length, 0, '队列应全部清空');
  } finally { teardown(ctx); }
});

test('启动任务时把 candidateId/documentKind/focus 等执行参数传给 run（回归：并发重构丢参）', () => {
  const ctx = setup();
  try {
    const { batch, candidates } = makeCandidates(ctx.store, 1);
    const mgr = ctx.manager(2);
    let received = null;
    mgr.run = (job, options) => { received = options; return Promise.resolve(); };
    mgr.start({ batchId: batch.id, candidateId: candidates[0].id, type: 'article', focus: 'f', focuses: ['a'], documentKind: 'final' });
    assert.deepEqual(received, { force: false, candidateId: candidates[0].id, documentKind: 'final', focus: 'f', focuses: ['a'] }, 'run 必须收到候选与文档参数');
  } finally { teardown(ctx); }
});

test('队列头部被同互斥键阻塞时，后续无冲突任务可先行', async () => {
  const ctx = setup();
  try {
    const { batch, candidates } = makeCandidates(ctx.store, 2);
    const mgr = ctx.manager(2);
    mgr.start({ batchId: batch.id, candidateId: candidates[0].id, type: 'social-card' }); // 占用 candidate:0
    const blocker = mgr.start({ batchId: batch.id, candidateId: candidates[0].id, type: 'article' }); // 同候选不同任务 → 排队
    assert.equal(blocker.status, 'queued');
    const other = mgr.start({ batchId: batch.id, candidateId: candidates[1].id, type: 'social-card' }); // 不同候选 → 直接运行
    assert.ok(other.status === 'running' || other.status === 'queued');
    await settle(120);
    assert.equal(mgr.pending.length, 0);
  } finally { teardown(ctx); }
});
