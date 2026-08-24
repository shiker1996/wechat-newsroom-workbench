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

function batchSummary(workspaceRoot, batch) {
  const file = path.join(batchTopicsDir(workspaceRoot, batch), 'sources', 'score-dual-run.json');
  const payload = readJson(file);
  if (!payload?.summary || !Array.isArray(payload.items)) return null;
  const summary = payload.summary;
  return {
    batchId: batch.id,
    batchDate: batch.batch_date,
    generatedAt: payload.generatedAt || null,
    candidateCount: Number(summary.candidateCount || payload.items.length || 0),
    legacyDraftableCount: Number(summary.legacyDraftableCount || 0),
    currentDraftableCount: Number(summary.currentDraftableCount || 0),
    poolChangedCount: Number(summary.poolChangedCount || 0),
    rankChangedCount: Number(summary.rankChangedCount || 0),
    meanDelta: Number(summary.meanDelta || 0),
    highTLowACount: Number(summary.highTLowACount || 0),
    lowTHighACount: Number(summary.lowTHighACount || 0),
    repeatPenaltyCount: Number(summary.repeatPenaltyCount || 0),
    readerStakeMissingCount: Number(summary.readerStakeMissingCount || 0),
  };
}

function ratio(value, denominator) { return denominator ? Number((value / denominator).toFixed(4)) : 0; }

export function buildTopicScoreOperationsMetrics({ store, workspaceRoot, days = 7 } = {}) {
  const windowDays = Math.max(1, Math.min(90, Number(days) || 7));
  const windowStart = dayOffset(windowDays);
  const batches = (store?.listBatches?.(500) || [])
    .filter((batch) => String(batch.batch_date || '') >= windowStart)
    .map((batch) => batchSummary(workspaceRoot, batch))
    .filter(Boolean);
  const totals = batches.reduce((acc, item) => {
    for (const key of ['candidateCount', 'legacyDraftableCount', 'currentDraftableCount', 'poolChangedCount', 'rankChangedCount',
      'highTLowACount', 'lowTHighACount', 'repeatPenaltyCount', 'readerStakeMissingCount']) acc[key] += item[key];
    acc.meanDeltaWeighted += item.meanDelta * item.candidateCount;
    return acc;
  }, { candidateCount: 0, legacyDraftableCount: 0, currentDraftableCount: 0, poolChangedCount: 0, rankChangedCount: 0,
    highTLowACount: 0, lowTHighACount: 0, repeatPenaltyCount: 0, readerStakeMissingCount: 0, meanDeltaWeighted: 0 });
  const candidateCount = totals.candidateCount;
  const rates = {
    poolChanged: ratio(totals.poolChangedCount, candidateCount),
    rankChanged: ratio(totals.rankChangedCount, candidateCount),
    highTLowA: ratio(totals.highTLowACount, candidateCount),
    lowTHighA: ratio(totals.lowTHighACount, candidateCount),
    repeatPenalty: ratio(totals.repeatPenaltyCount, candidateCount),
    readerStakeMissing: ratio(totals.readerStakeMissingCount, candidateCount),
  };
  const reasons = [];
  if (batches.length < 2) reasons.push('至少需要 2 个完成双跑的批次再做切换判断');
  if (rates.poolChanged > 0.30) reasons.push('新旧公式导致超过 30% 候选改变成稿线结果');
  if (Math.abs(ratio(totals.meanDeltaWeighted, candidateCount)) > 12) reasons.push('新旧公式平均分差超过 12 分');
  if (rates.repeatPenalty > 0.40) reasons.push('重复事件扣分样本比例偏高，需检查跨日归并');
  if (rates.readerStakeMissing > 0.30) reasons.push('超过 30% 候选缺少具体读者利益');
  const ready = batches.length >= 2;
  const status = reasons.some((reason) => !reason.includes('至少需要')) ? 'review' : ready ? 'observe' : 'insufficient_sample';
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    windowDays,
    windowStart,
    batchCount: batches.length,
    calibration: { status, ready, recommendation: status === 'review' ? '暂不调整权重，先处理异常样本' : ready ? '继续观察至 2–3 个批次后确认' : '继续积累双跑批次', reasons },
    totals: { ...totals, meanDelta: Number(ratio(totals.meanDeltaWeighted, candidateCount).toFixed(1)) },
    rates,
    batches,
  };
}
