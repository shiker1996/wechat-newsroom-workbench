import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSocialCardPlanBaseline,
  summarizeSocialCardLayoutReport,
  summarizeSocialCardPlan,
} from '../lib/rendering/social-card-plan-baseline.mjs';

const plan = [
  { kind: 'cover', role: 'cover', title: '封面', content_blocks: [{ type: 'text', content: '标题说明' }] },
  { kind: 'capability', role: 'feature', title: '能力', page_group_id: 'storyboard-page-2', continuation_of: 2, continuation_index: 1, content_blocks: [{ type: 'list', items: ['条目一', '条目二'] }] },
];

test('阶段 0 基线按页记录角色、块数、条目数和续页关系', () => {
  const summary = summarizeSocialCardPlan(plan);
  assert.equal(summary.pageCount, 2);
  assert.equal(summary.blockCount, 2);
  assert.equal(summary.itemCount, 2);
  assert.equal(summary.pages[1].pageGroupId, 'storyboard-page-2');
  assert.equal(summary.pages[1].continuationIndex, 1);
  assert.equal(summary.pages[1].blocks[0].splittable, true);
});

test('阶段 0 基线记录计划变化、操作计数、模板容量和审计问题', () => {
  const finalPlan = [...plan, { kind: 'capability', role: 'feature', title: '能力（续）', page_group_id: 'storyboard-page-2', continuation_of: 2, continuation_index: 2, content_blocks: [{ type: 'list', items: ['条目三'] }] }];
  const report = { valid: false, pages: [{ page: 1, kind: 'cover', valid: true, issues: [], utilization: 70 }, { page: 2, kind: 'content', valid: false, issues: ['underfilled'], utilization: 42 }] };
  const baseline = buildSocialCardPlanBaseline({
    originalPlan: plan,
    finalPlan,
    template: { requested: { id: 'clean-v1', version: 1 }, rendered: { id: 'clean-v1', version: 1 }, themeId: 'solarized', capacityProfileVersion: 1 },
    capacityProfile: { roles: { feature: { visual: { bodyHeightPx: 410 }, structural: { maxBlocks: 4, maxItems: 9 } } } },
    operations: [{ op: 'split_block', page: 2 }, { op: 'merge_pages', pages: [2, 3] }],
    report,
    auditAttempts: [{ attempt: 1, valid: false }],
    repair: {
      structuralReflowAttempted: true,
      structureRepairCount: 1,
      textRepairCount: 2,
      relaxedDensityPages: [1],
      fitContentPages: [1],
      phaseHistory: [{ attempt: 1, phase: 'structure', action: 'split-page', changed: true }],
    },
  });
  assert.equal(baseline.changes.pageDelta, 1);
  assert.deepEqual(baseline.changes.operations.counts, { split_block: 1, merge_pages: 1 });
  assert.equal(baseline.template.capacityProfile.roles.feature.visual.bodyHeightPx, 410);
  assert.equal(baseline.audits.final.pages[1].utilization, 42);
  assert.equal(baseline.repairs.textRepairCount, 2);
  assert.deepEqual(baseline.repairs.fitContentPages, [1]);
  assert.equal(baseline.repairs.phaseHistory[0].phase, 'structure');
});

test('阶段 0 布局摘要不携带完整页面正文', () => {
  const summary = summarizeSocialCardLayoutReport({ valid: true, pages: [{ page: 1, valid: true, issues: [], content: '不应进入摘要' }] });
  assert.equal(summary.valid, true);
  assert.equal(Object.hasOwn(summary.pages[0], 'content'), false);
});
