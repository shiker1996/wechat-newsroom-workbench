import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/core/store.mjs';
import { aggregateSocialTemplateMetricsByDimension, buildSocialTemplateCalibrationReport, summarizeSocialTemplateRun } from '../lib/rendering/social-card-template-metrics.mjs';

test('Phase 5 按模板、主题和页面角色输出容量校准建议', () => {
  const rows = [
    summarizeSocialTemplateRun({ requestedTemplate: { id: 'brutalist-v1' }, themeId: 'brutalist', report: { valid: false, pages: [{ valid: false, issues: ['overflow'] }, { valid: true, issues: [] }] }, pageRoleStats: { feature: { pages: 2, layoutPass: 1, underfilledPages: 0, overflowPages: 1 } }, structuralReflowAttempted: true, structuralReflowSuccess: false, pagesAdded: 1, planOperations: [{ op: 'split_block' }, { op: 'merge_pages' }] }),
    summarizeSocialTemplateRun({ requestedTemplate: { id: 'brutalist-v1' }, themeId: 'brutalist', report: { valid: false, pages: [{ valid: false, issues: ['overflow'] }, { valid: true, issues: [] }] }, pageRoleStats: { feature: { pages: 2, layoutPass: 1, underfilledPages: 0, overflowPages: 1 } }, structuralReflowAttempted: true, structuralReflowSuccess: false, pagesAdded: 1 }),
    summarizeSocialTemplateRun({ requestedTemplate: { id: 'brutalist-v1' }, themeId: 'brutalist', report: { valid: true, pages: [{ valid: true, issues: [] }, { valid: true, issues: ['underfilled'] }] }, pageRoleStats: { feature: { pages: 2, layoutPass: 2, underfilledPages: 1, overflowPages: 0 } } })
  ];
  const dimensions = aggregateSocialTemplateMetricsByDimension(rows);
  assert.equal(dimensions.length, 1);
  assert.equal(dimensions[0].templatePackId, 'brutalist-v1');
  assert.equal(dimensions[0].themeId, 'brutalist');
  assert.equal(dimensions[0].role, 'feature');
  const report = buildSocialTemplateCalibrationReport(rows, { minSamples: 1 });
  assert.equal(report.dimensions[0].recommendation, 'decrease-capacity');
  assert.equal(report.rendererExtensionNeeded, false);
  assert.match(report.note, /结构原语/);
  assert.equal(rows[0].pagesSplit, 1);
  assert.equal(rows[0].pagesMerged, 1);
});

test('Phase 5 指标落库并可按主题查询维度报告', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'social-template-calibration-'));
  const store = new Store(path.join(root, 'test.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.recordSocialTemplateMetric({ operation: 'generation', requestedTemplate: { id: 'editorial-v1' }, renderedTemplate: { id: 'editorial-v1' }, themeId: 'paper-craft', pageCount: 2, layoutPass: true, pageRoleStats: { feature: { pages: 2, layoutPass: 2, underfilledPages: 0, overflowPages: 0 } }, pagesAdded: 1, contentPlanAdjustmentCount: 1, pagesSplit: 1, sourceAtomLossCount: 0, avgUtilization: 0.74, rolloutProfile: { mode: 'gray' } });
  const stats = store.socialTemplateMetricsStats({ templatePackId: 'editorial-v1', themeId: 'paper-craft', pageRole: 'feature' });
  assert.equal(stats.themeId, 'paper-craft');
  assert.equal(stats.roleDimensions.length, 1);
  assert.equal(stats.roleDimensions[0].role, 'feature');
  assert.equal(stats.pagesAdded, 1);
  assert.equal(stats.contentPlanAdjustmentRounds, 1);
  assert.equal(stats.sourceAtomLossCount, 0);
  assert.equal(stats.averageUtilization, 0.74);
  assert.equal(stats.rollout.variants[0].mode, 'gray');
});

test('阶段 5 联合装箱审计指标进入模板运行统计', () => {
  const row = summarizeSocialTemplateRun({
    requestedTemplate: { id: 'clean-v1' },
    report: { valid: true, pages: [{ valid: true, utilization: 0.74, issues: [] }] },
    jointPackingAudit: [{ mismatchCount: 1, browserOnlyOverflowPages: [1], staticOnlyOverflowPages: [], meanAbsoluteUtilizationDelta: 0.08 }],
  });
  assert.equal(row.jointPackingAuditAttempts, 1);
  assert.equal(row.jointPackingMismatchCount, 1);
  assert.equal(row.jointPackingBrowserOnlyOverflowPages, 1);
  assert.equal(row.jointPackingMeanAbsoluteUtilizationDelta, 0.08);
  const dimensions = aggregateSocialTemplateMetricsByDimension([row]);
  assert.equal(dimensions[0].jointPackingMismatchRate, 1);
  assert.equal(buildSocialTemplateCalibrationReport([row], { minSamples: 1 }).dimensions[0].jointPackingCalibrationNeeded, true);
});
