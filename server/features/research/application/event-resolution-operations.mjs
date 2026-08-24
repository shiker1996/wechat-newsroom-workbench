import fs from 'node:fs';
import path from 'node:path';
import { batchTopicsDir } from '../../../platform/core/workspace-paths.mjs';

function readJson(filePath) {
  try { return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null; } catch { return null; }
}

function dayOffset(days) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - Math.max(0, Number(days || 7) - 1));
  return date.toISOString().slice(0, 10);
}

function shadowSummary(workspaceRoot, batch) {
  const file = path.join(batchTopicsDir(workspaceRoot, batch), 'sources', 'event-resolution-shadow-diff.json');
  const payload = readJson(file) || {};
  const legacy = Number(payload.legacy?.event_count || 0);
  const shadow = Number(payload.shadow?.event_count || 0);
  return {
    batchId: batch.id,
    batchDate: batch.batch_date,
    inputCount: Number(payload.input_count || 0),
    legacyEventCount: legacy,
    shadowEventCount: shadow,
    merges: Array.isArray(payload.differences?.merges) ? payload.differences.merges.length : 0,
    splits: Array.isArray(payload.differences?.splits) ? payload.differences.splits.length : 0,
    reviewQueue: Array.isArray(payload.differences?.review_queue) ? payload.differences.review_queue.length : 0,
    duplicateCount: Math.max(0, legacy - shadow),
  };
}

function crossBatchRepeatPoolRate(store, batches) {
  return store?.queries?.eventResolution?.crossBatchRepeatPoolRate?.(batches)
    || { candidateCount: 0, repeatCandidateCount: 0, rate: 0 };
}

export function buildEventResolutionOperationsMetrics({ store, workspaceRoot, days = 7 } = {}) {
  const windowDays = Math.max(1, Math.min(90, Number(days) || 7));
  const windowStart = dayOffset(windowDays);
  const batches = (store?.listBatches?.(500) || []).filter((batch) => String(batch.batch_date || '') >= windowStart);
  const summaries = batches.map((batch) => shadowSummary(workspaceRoot, batch));
  const totals = summaries.reduce((acc, item) => {
    for (const key of ['inputCount', 'legacyEventCount', 'shadowEventCount', 'merges', 'splits', 'reviewQueue', 'duplicateCount']) acc[key] += item[key];
    return acc;
  }, { inputCount: 0, legacyEventCount: 0, shadowEventCount: 0, merges: 0, splits: 0, reviewQueue: 0, duplicateCount: 0 });
  const sinceIso = `${windowStart}T00:00:00.000Z`;
  const decisions = store?.repositories?.eventResolutionReview?.list({ since: sinceIso, activeOnly: true, limit: 5000 }) || [];
  const reviewable = totals.reviewQueue + totals.merges + totals.splits;
  const repeat = crossBatchRepeatPoolRate(store, batches);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    windowDays,
    windowStart,
    batchCount: batches.length,
    totals,
    manualCorrections: decisions.length,
    manualCorrectionRate: reviewable ? Math.min(1, decisions.length / reviewable) : 0,
    duplicateEventRate: totals.legacyEventCount ? totals.duplicateCount / totals.legacyEventCount : 0,
    crossBatchRepeatPoolRate: repeat.rate,
    crossBatchRepeatPool: repeat,
    batches: summaries,
    recentDecisions: decisions.slice(0, 50),
  };
}

export function readEventResolutionReview({ store, workspaceRoot, batch } = {}) {
  if (!batch) return null;
  const file = path.join(batchTopicsDir(workspaceRoot, batch), 'sources', 'event-resolution-shadow-diff.json');
  const diff = readJson(file) || { differences: { merges: [], splits: [], review_queue: [] } };
  return {
    batchId: batch.id,
    batchDate: batch.batch_date,
    generatedAt: diff.generated_at || null,
    inputCount: Number(diff.input_count || 0),
    conservation: diff.conservation || null,
    differences: diff.differences || { merges: [], splits: [], review_queue: [] },
    decisions: store?.repositories?.eventResolutionReview?.list({ batchId: batch.id, limit: 500 }) || [],
  };
}
