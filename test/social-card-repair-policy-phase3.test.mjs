import test from 'node:test';
import assert from 'node:assert/strict';
import { applySocialCardRestructureOperations, buildDeterministicSocialCardRestructureOperations, cardPlanHash, classifySocialCardLayoutIssue, socialCardRepairStateSignature, structuralLayoutPages, validateSocialCardRestructureOperations } from '../lib/rendering/social-card-repair-policy.mjs';

const plan = [{ kind: 'cover', title: '封面', content_blocks: [] }, {
  kind: 'content', role: 'feature', title: '能力清单', content_blocks: [{ type: 'list', title: '要点', items: ['事实一', '事实二', '事实三', '事实四'] }],
}, { kind: 'ending', title: '结尾', content_blocks: [] }];

test('布局问题分类：结构问题不再落入纯文字修复', () => {
  assert.equal(classifySocialCardLayoutIssue({ issues: ['overflow', 'overfilled'] }).kind, 'structural');
  assert.equal(classifySocialCardLayoutIssue({ issues: ['underfilled'] }).kind, 'density');
  assert.equal(classifySocialCardLayoutIssue({ issues: ['underfilled', 'text_too_small'] }).kind, 'density');
  assert.deepEqual(structuralLayoutPages({ pages: [{ page: 4, issues: ['underfilled', 'text_too_small'] }] }), []);
  assert.equal(structuralLayoutPages({ pages: [{ page: 2, issues: ['clipped'] }, { page: 3, issues: ['underfilled'] }] }).length, 1);
});

test('受控 split_page 必须覆盖完整条目且保留页面职责', () => {
  const operations = [{ op: 'split_page', page: 2, groups: [
    { blocks: [{ block: 0, items: [0, 1] }] },
    { blocks: [{ block: 0, items: [2, 3] }] },
  ] }];
  assert.deepEqual(validateSocialCardRestructureOperations(plan, operations, { maxPages: 7 }), { valid: true, issues: [] });
  const result = applySocialCardRestructureOperations(plan, operations, { maxPages: 7 });
  assert.equal(result.changed, true);
  assert.equal(result.pages.length, 4);
  assert.equal(result.pages[0].kind, 'cover');
  assert.equal(result.pages.at(-1).kind, 'ending');
  assert.deepEqual(result.pages.slice(1, -1).flatMap((page) => page.content_blocks[0].items), ['事实一', '事实二', '事实三', '事实四']);
  assert.equal(result.pages[2].continuation_index, 2);
});

test('受控结构修复拒绝漏项、重复项和不可拆内容块', () => {
  const missing = [{ op: 'split_page', page: 2, groups: [{ blocks: [{ block: 0, items: [0] }] }, { blocks: [{ block: 0, items: [2, 3] }] }] }];
  assert.equal(validateSocialCardRestructureOperations(plan, missing).valid, false);
  const codePlan = [{ kind: 'content', role: 'feature', title: '代码', content_blocks: [{ type: 'code', content: 'npm run dev' }] }];
  const codeOps = [{ op: 'split_page', page: 1, groups: [{ blocks: [{ block: 0, items: [0] }] }, { blocks: [{ block: 0, items: [0] }] }] }];
  assert.equal(validateSocialCardRestructureOperations(codePlan, codeOps).valid, false);
  const unchanged = applySocialCardRestructureOperations(plan, [{ op: 'move_block', page: 2 }]);
  assert.equal(unchanged.changed, false);
  assert.equal(cardPlanHash(unchanged.pages), cardPlanHash(plan));
});

test('模型未返回结构修复操作时，程序可为可拆分列表生成安全兜底操作', () => {
  const operations=buildDeterministicSocialCardRestructureOperations(plan,[{page:2,issues:['overflow']}],{maxPages:7});
  assert.deepEqual(operations,[{op:'split_page',page:2,groups:[{blocks:[{block:0,items:[0,1]}]},{blocks:[{block:0,items:[2,3]}]}]}]);
  const applied=applySocialCardRestructureOperations(plan,operations,{maxPages:7});
  assert.equal(applied.valid,true);
  assert.equal(applied.changed,true);
  assert.deepEqual(applied.pages.slice(1,-1).flatMap((page)=>page.content_blocks[0].items),['事实一','事实二','事实三','事实四']);
  assert.deepEqual(buildDeterministicSocialCardRestructureOperations([{kind:'cover',content_blocks:[{type:'list',items:['a','b']}]}],[{page:1,issues:['overflow']}]),[]);
});

test('布局修复状态指纹在计划、问题和确定性变体不变时保持一致', () => {
  const input = {
    cardPlan: plan,
    report: { pages: [{ page: 2, valid: false, utilization: 42.34, issues: ['underfilled', 'text_too_small'] }] },
    densityCalibration: { pages: [{ page: 2, utilization: 42.34, target: 58 }] },
    safeCompositionPages: [1],
    relaxedDensityPages: [1],
    expandedDensityPages: [],
  };
  assert.equal(socialCardRepairStateSignature(input), socialCardRepairStateSignature({ ...input, report: { pages: [{ page: 2, valid: false, utilization: 42.33, issues: ['text_too_small', 'underfilled'] }] } }));
});

test('布局修复状态指纹在计划或已启用变体变化时变化', () => {
  const input = {
    cardPlan: plan,
    report: { pages: [{ page: 2, valid: false, utilization: 42, issues: ['underfilled'] }] },
    densityCalibration: { pages: [{ page: 2, utilization: 42, target: 58 }] },
    safeCompositionPages: [], relaxedDensityPages: [], expandedDensityPages: [],
  };
  const planChanged = socialCardRepairStateSignature({ ...input, cardPlan: [...plan, { kind: 'content', role: 'feature', content_blocks: [] }] });
  const variantChanged = socialCardRepairStateSignature({ ...input, safeCompositionPages: [1] });
  const fitContentChanged = socialCardRepairStateSignature({ ...input, fitContentPages: [1] });
  assert.notEqual(planChanged, socialCardRepairStateSignature(input));
  assert.notEqual(variantChanged, socialCardRepairStateSignature(input));
  assert.notEqual(fitContentChanged, socialCardRepairStateSignature(input));
});
