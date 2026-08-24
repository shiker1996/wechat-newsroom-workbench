import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSocialCardPlanRolloutReport, getSocialCardPlanRolloutProfile, summarizeSocialCardPlanRolloutRows } from '../server/shared/rendering/social-card-plan-rollout.mjs';
import { summarizeSocialTemplateRun } from '../server/shared/rendering/social-card-template-metrics.mjs';

test('Phase 5 模板灰度档案区分默认、保守和兼容策略', () => {
  const clean = getSocialCardPlanRolloutProfile('clean-v1');
  const brutalist = getSocialCardPlanRolloutProfile('brutalist-v1');
  const unknown = getSocialCardPlanRolloutProfile('unknown-v1');
  assert.equal(clean.mode, 'gray');
  assert.equal(clean.maxPlanRounds, 3);
  assert.equal(brutalist.mode, 'conservative');
  assert.equal(brutalist.maxPlanRounds, 2);
  assert.ok(brutalist.maxOperationsPerRound < clean.maxOperationsPerRound);
  assert.equal(unknown.mode, 'compatibility');
});

test('Phase 5 灰度报告统一比较成功率、利用率、计划轮次和原子损失', () => {
  const rows = [
    ...Array.from({ length: 3 }, () => summarizeSocialTemplateRun({
      requestedTemplate: { id: 'clean-v1' }, report: { valid: true, pages: [{ valid: true, utilization: 0.72, issues: [] }] },
      contentPlanAdjustmentCount: 1, textRepairCount: 0, rolloutProfile: getSocialCardPlanRolloutProfile('clean-v1'),
    })),
    ...Array.from({ length: 3 }, () => ({
      operation: 'generation', success: true, layoutPass: true, pageCount: 1, avgUtilization: 0.7,
      contentPlanAdjustmentCount: 1, textRepairCount: 0, requested_template_id: 'clean-v1', rolloutProfile: { mode: 'legacy' },
    })),
  ];
  const summary = summarizeSocialCardPlanRolloutRows(rows.slice(0, 3));
  assert.equal(summary.sampleCount, 3);
  assert.equal(summary.sourceAtomLossCount, 0);
  assert.equal(summary.averagePlanAdjustmentRounds, 1);
  const report = buildSocialCardPlanRolloutReport(rows, { minSamples: 3 });
  const comparison = report.comparisons.find((item) => item.templatePackId === 'clean-v1');
  assert.ok(comparison);
  assert.equal(comparison.readyForPromotion, true);
  assert.equal(comparison.gates.sourceAtomLossZero, true);
});

test('Phase 5 原子损失会阻止灰度推广', () => {
  const rows = Array.from({ length: 3 }, () => ({
    operation: 'generation', success: true, layoutPass: true, pageCount: 1, requested_template_id: 'editorial-v1',
    source_atom_loss_count: 1, rollout_profile_json: JSON.stringify({ mode: 'gray' }),
  }));
  const report = buildSocialCardPlanRolloutReport(rows, { minSamples: 3 });
  const comparison = report.comparisons[0];
  assert.equal(comparison.readyForPromotion, false);
  assert.equal(comparison.gates.sourceAtomLossZero, false);
});

test('阶段 5 审计偏差变差时阻止灰度推广', () => {
  const rows = [
    ...Array.from({ length: 3 }, () => ({ operation: 'generation', success: true, layoutPass: true, pageCount: 1, requested_template_id: 'clean-v1', rolloutProfile: { mode: 'gray' }, joint_packing_audit_attempts: 1, joint_packing_mismatch_count: 1 })),
    ...Array.from({ length: 3 }, () => ({ operation: 'generation', success: true, layoutPass: true, pageCount: 1, requested_template_id: 'clean-v1', rolloutProfile: { mode: 'legacy' }, joint_packing_audit_attempts: 1, joint_packing_mismatch_count: 0 })),
  ];
  const comparison = buildSocialCardPlanRolloutReport(rows, { minSamples: 3 }).comparisons.find((item) => item.templatePackId === 'clean-v1');
  assert.equal(comparison.gates.auditAlignmentNotWorse, false);
  assert.equal(comparison.readyForPromotion, false);
});
