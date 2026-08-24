import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSocialCardDynamicFillAuditWithFinalReport } from '../server/features/social-cards/application/social-card-pipeline.mjs';

test('阶段 5 动态填充审计以最终布局利用率覆盖估算达标结果', () => {
  const audit = {
    changed: true,
    pages: [
      {
        page: 3,
        role: 'timeline',
        stopReason: 'target_utilization_reached',
        acceptedOperations: 0,
        rejectedOperations: [],
        utilizationBefore: 0.516,
        utilizationAfter: 0.86,
        estimatedUtilization: 0.86,
        targetUtilization: 0.68,
      },
    ],
    stopReason: 'target_utilization_reached',
  };
  const result = reconcileSocialCardDynamicFillAuditWithFinalReport(audit, {
    pages: [{ page: 3, utilization: 51.6, valid: true, issues: [] }],
  });
  assert.equal(result.pages[0].estimatedUtilization, 0.86);
  assert.equal(result.pages[0].observedUtilization, 0.516);
  assert.equal(result.pages[0].utilizationAfter, 0.516);
  assert.equal(result.pages[0].stopReason, 'no_safe_candidate');
  assert.equal(result.pages[0].stopReasonSource, 'final-layout-report');
  assert.equal(result.stopReason, 'no_safe_candidate');
});

test('阶段 5 动态填充审计保留未达目标且已新增内容的继续信号', () => {
  const result = reconcileSocialCardDynamicFillAuditWithFinalReport({
    pages: [{ page: 4, acceptedOperations: 1, rejectedOperations: [], utilizationAfter: 1.02, targetUtilization: 0.7 }],
    stopReason: 'target_utilization_reached',
  }, { pages: [{ page: 4, utilization: 68.9 }] });
  assert.equal(result.pages[0].stopReason, 'continue_next_round');
  assert.equal(result.stopReason, 'continue_next_round');
});
