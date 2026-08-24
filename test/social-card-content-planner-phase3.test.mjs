import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySocialCardContentPlannerOperations,
  applySocialCardContentPlannerOperationsPartial,
  buildSocialCardContentPlannerPrompt,
  buildSocialCardPlannerComponentPool,
  normalizeSocialCardContentPlannerResult,
  validateSocialCardContentPlannerSchema,
  validateSocialCardContentPlannerOperations,
} from '../server/features/social-cards/application/social-card-content-planner.mjs';
import { validateSocialCardSupplementSlotCatalog } from '../server/shared/rendering/social-card-supplement-slots.mjs';
import { buildDeterministicSocialCardPageCapOperations, applySocialCardRestructureOperations } from '../server/shared/rendering/social-card-repair-policy.mjs';

const sourceRefs = ['repo:readme:overview', 'repo:readme:limits'];
const plan = [
  { kind: 'content', role: 'feature', title: '能力', page_group_id: 'g1', continuation_of: 1, continuation_index: 1, content_blocks: [
    { type: 'text', title: '概览', content: '简短概览', source_refs: [sourceRefs[0]] },
    { type: 'text', title: '边界', content: '边界说明', source_refs: [sourceRefs[1]] },
  ] },
  { kind: 'content', role: 'feature', title: '能力（续）', page_group_id: 'g1', continuation_of: 1, continuation_index: 2, content_blocks: [
    { type: 'text', title: '结论', content: '结论说明', source_refs: [sourceRefs[0]] },
  ] },
];

test('内容计划调整器 Prompt 只允许受控操作，不暴露 HTML/CSS 生成路径', () => {
  const prompt = buildSocialCardContentPlannerPrompt({ cardPlan: plan, contentAtoms: [], layoutReport: { pages: [] } });
  assert.match(prompt, /split_page、move_block、merge_pages、add_component/);
  assert.match(prompt, /只返回 JSON/);
  assert.match(prompt, /不生成 HTML、CSS/);
  assert.match(prompt, /禁止删除事实/);
  assert.match(prompt, /fact_ids/);
  assert.match(prompt, /allowedSupplementSlots/);
  assert.match(prompt, /不要使用 target_page、merge_with/);
});

test('计划超出模板页数上限时，提示优先合并续页而不是继续补充内容', () => {
  const prompt = buildSocialCardContentPlannerPrompt({
    cardPlan: Array.from({ length: 8 }, (_, index) => ({ kind: 'content', role: 'steps', title: `步骤 ${index + 1}`, page_group_id: 'steps', content_blocks: [] })),
    maxPages: 7,
    layoutReport: { pages: [{ page: 4, issues: ['underfilled'] }] },
  });
  assert.match(prompt, /超过模板允许的 7 页/);
  assert.match(prompt, /优先使用 merge_pages/);
  assert.match(prompt, /仅 add_component 不能解决超页问题/);
});

test('内容计划提示只暴露目标页候选，不暴露跨角色全局事实组件', () => {
  const globalOnly = { id: 'component-global-source-only', componentId: 'component-global-source-only', sourceStatus: 'provided', factIds: ['fact-source'], sourceRefs, semanticTags: ['source'], renderCandidates: ['note'], content: { title: '来源', text: '其他页面专属事实' } };
  const scoped = { id: 'component-fact-export@p1-capability-note', componentId: 'component-fact-export@p1-capability-note', page: 1, role: 'feature', slotId: 'capability', sourceStatus: 'provided', factIds: ['fact-export'], sourceRefs, semanticTags: ['capability'], renderCandidates: ['note'], content: { title: '具体能力', text: '支持导出 PNG。' } };
  const contentComponents = { supplements: [globalOnly, scoped], pageCandidates: { '1': { page: 1, role: 'feature', supplements: [scoped] } } };
  const pool = buildSocialCardPlannerComponentPool(contentComponents, { pages: [{ page: 1 }] });
  assert.deepEqual(pool.pageCandidates['1'].supplements.map((item) => item.id), [scoped.id]);
  const prompt = buildSocialCardContentPlannerPrompt({ cardPlan: plan, contentComponents, layoutReport: { pages: [{ page: 1 }] } });
  assert.doesNotMatch(prompt, /component-global-source-only/);
  assert.match(prompt, /component-fact-export@p1-capability-note/);
});

test('内容计划调整器支持同组完整块移动并守恒来源引用', () => {
  const operations = { operations: [{ op: 'move_block', from_page: 1, to_page: 2, block: 1 }] };
  const validation = validateSocialCardContentPlannerOperations(plan, operations, { knownSourceRefs: sourceRefs });
  assert.deepEqual(validation, { valid: true, issues: [] });
  const result = applySocialCardContentPlannerOperations(plan, operations, { knownSourceRefs: sourceRefs });
  assert.equal(result.changed, true);
  assert.equal(result.pages[0].content_blocks.length, 1);
  assert.deepEqual(result.pages[1].content_blocks.map((block) => block.title), ['边界', '结论']);
  assert.equal(result.conservation.sourceRefsPreserved, true);
});

test('补充组件必须引用已知事实来源，跨故事线合并被拒绝', () => {
  const component = { id: 'component-fact-limit', componentId: 'component-fact-limit', page: 1, role: 'feature', slotId: 'capability', factIds: ['fact-limit'], sourceRefs: [sourceRefs[1]], sourceStatus: 'provided', semanticTags: ['capability'], preferredRender: 'note', renderCandidates: ['note'], content: { title: '具体能力', text: '来源支持的限制说明' } };
  const contentComponents = { supplements: [component], pageCandidates: { '1': { supplements: [component] } } };
  const factIndex = { candidates: [{ id: 'fact-limit', path: 'facts.readme.features[0]', tags: ['capability'], text: '来源支持的限制说明', source_refs: [sourceRefs[1]], source_status: 'provided' }] };
  const add = { operations: [{ op: 'add_component', page: 1, component_id: component.id, render_type: 'note', fact_ids: ['fact-limit'], source_refs: [sourceRefs[1]], block: { type: 'note', title: '具体能力', content: '来源支持的限制说明' } }] };
  const options = { knownSourceRefs: sourceRefs, contentComponents, factIndex };
  assert.equal(validateSocialCardContentPlannerOperations(plan, add, options).valid, true);
  const applied = applySocialCardContentPlannerOperations(plan, add, options);
  assert.equal(applied.changed, true);
  assert.equal(applied.pages[0].content_blocks.at(-1).supplement_slot_id, 'capability');
  const unknown = { operations: [{ op: 'add_component', page: 1, component_id: component.id, render_type: 'note', fact_ids: ['fact-limit'], source_refs: ['invented:ref'] }] };
  assert.equal(validateSocialCardContentPlannerOperations(plan, unknown, options).valid, false);
  const otherGroup = [{ ...plan[0] }, { ...plan[1], page_group_id: 'g2' }];
  assert.equal(validateSocialCardContentPlannerOperations(otherGroup, { operations: [{ op: 'merge_pages', pages: [1, 2] }] }, { knownSourceRefs: sourceRefs }).valid, false);
});

test('第一步槽位契约：目录完整且槽位类型、页角色不越界', () => {
  assert.equal(validateSocialCardSupplementSlotCatalog().valid, true);
  const wrongComponent = { id: 'component-fact-source', componentId: 'component-fact-source', page: 1, role: 'feature', factIds: ['fact-source'], sourceRefs: [sourceRefs[0]], sourceStatus: 'provided', semanticTags: ['source'], preferredRender: 'note', renderCandidates: ['note'], content: { title: '来源', text: '错误角色槽位' } };
  const wrongSlot = { operations: [{ op: 'add_component', page: 1, component_id: wrongComponent.id, source_refs: [sourceRefs[0]], fact_ids: ['fact-source'] }] };
  const result = validateSocialCardContentPlannerOperations(plan, wrongSlot, { knownSourceRefs: sourceRefs, contentComponents: { supplements: [wrongComponent], pageCandidates: { '1': { supplements: [wrongComponent] } } }, factIndex: { candidates: [{ id: 'fact-source', path: 'facts.readme.sections[0]', tags: ['source'], source_refs: [sourceRefs[0]], source_status: 'provided' }] } });
  assert.equal(result.valid, false);
  assert.match(result.issues.join('；'), /无法从页面语义解析有效槽位/);
});

test('调整器结果兼容数组和 operations 包装', () => {
  assert.deepEqual(normalizeSocialCardContentPlannerResult([{ op: 'merge_pages', pages: [1, 2] }]), { operations: [{ op: 'merge_pages', pages: [1, 2] }] });
  assert.deepEqual(normalizeSocialCardContentPlannerResult({ operations: [] }), { operations: [] });
});

test('旧操作不再被静默转换，Schema 门禁会明确拒绝', () => {
  const result = validateSocialCardContentPlannerSchema({ operations: [{ op: 'merge_pages', target_page: 5, merge_with: 6 }] });
  assert.equal(result.valid, false);
  assert.equal(normalizeSocialCardContentPlannerResult({ operations: [{ op: 'merge_pages', target_page: 5, merge_with: 6 }] }).operations[0].pages, undefined);
});

test('旧 add_fact_block 操作在 Schema 层被拒绝', () => {
  const result = validateSocialCardContentPlannerSchema({ operations: [{ op: 'add_fact_block', page: 6, slot_id: 'source', source_refs: ['repo:readme'], block: { type: 'note' } }] });
  assert.equal(result.valid, false);
});

test('AI 补充事实块也必须经过页面容量守卫', () => {
  const component = { id: 'component-fact-output', componentId: 'component-fact-output', page: 1, role: 'feature', slotId: 'output', factIds: ['fact-output'], sourceRefs: [sourceRefs[0]], sourceStatus: 'provided', semanticTags: ['output'], preferredRender: 'note', renderCandidates: ['note'], content: { title: '输出结果', text: '可能撑爆页面的补充内容' } };
  const add = { operations: [{ op: 'add_component', page: 1, component_id: component.id, render_type: 'note', fact_ids: ['fact-output'], source_refs: [sourceRefs[0]], block: { type: 'note', content: '可能撑爆页面的补充内容' } }] };
  const result = validateSocialCardContentPlannerOperations(plan, add, {
    knownSourceRefs: sourceRefs,
    contentComponents: { supplements: [component], pageCandidates: { '1': { supplements: [component] } } },
    factIndex: { candidates: [{ id: 'fact-output', path: 'facts.output', tags: ['output'], source_refs: [sourceRefs[0]], source_status: 'provided' }] },
    operationGuard: ({ operation }) => operation.op === 'add_fact_block' ? ['预计超过模板安全容量'] : [],
  });
  assert.equal(result.valid, false);
  assert.match(result.issues.join('；'), /预计超过模板安全容量/);
});

test('阶段 4 单个坏操作不阻塞同轮可执行的步骤页补充', () => {
  const stepsPlan = [plan[0], { ...plan[1], role: 'steps' }];
  const operations = [
    { op: 'add_component', page: 1, component_id: 'component-fact-wrong', render_type: 'text', source_refs: [sourceRefs[0]], fact_ids: ['fact-wrong'], block: { type: 'text', content: '错误语义' } },
    { op: 'add_component', page: 2, component_id: 'component-fact-run', render_type: 'steps', source_refs: [sourceRefs[1]], fact_ids: ['fact-run'], block: { type: 'steps', content: '打开页面并发送反馈' } },
  ];
  const wrongComponent = { id: 'component-fact-wrong', componentId: 'component-fact-wrong', page: 1, role: 'feature', factIds: ['fact-wrong'], sourceRefs: [sourceRefs[0]], sourceStatus: 'provided', semanticTags: ['maturity'], preferredRender: 'text', renderCandidates: ['text'], content: { title: '状态', text: '错误语义' } };
  const runComponent = { id: 'component-fact-run', componentId: 'component-fact-run', page: 2, role: 'steps', slotId: 'run', factIds: ['fact-run'], sourceRefs: [sourceRefs[1]], sourceStatus: 'provided', semanticTags: ['run'], preferredRender: 'steps', renderCandidates: ['steps'], content: { title: '运行方式', text: '打开页面并发送反馈' } };
  const result = applySocialCardContentPlannerOperationsPartial(stepsPlan, operations, {
    knownSourceRefs: sourceRefs,
    maxFactBlocksAdded: 2,
    factIndex: { candidates: [
      { id: 'fact-wrong', path: 'facts.maturity', tags: ['maturity'], source_refs: [sourceRefs[0]] },
      { id: 'fact-run', path: 'facts.readme.sections[3]', tags: ['run'], source_refs: [sourceRefs[1]] },
    ] },
    contentComponents: { supplements: [wrongComponent, runComponent], pageCandidates: { '1': { supplements: [wrongComponent] }, '2': { supplements: [runComponent] } } },
  });
  assert.equal(result.changed, true);
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].page, 2);
  assert.equal(result.rejectedOperations.length, 1);
  assert.equal(result.pages[1].content_blocks.at(-1).supplement_slot_id, 'run');
});

test('页数超过模板上限时只合并相邻同故事线续页', () => {
  const pages = [
    { kind: 'cover', role: 'cover', content_blocks: [] },
    { kind: 'content', role: 'steps', page_group_id: 'steps-1', continuation_index: 1, content_blocks: [{ type: 'steps', items: ['a'] }] },
    { kind: 'content', role: 'steps', page_group_id: 'steps-1', continuation_index: 2, content_blocks: [{ type: 'steps', items: ['b'] }] },
    { kind: 'content', role: 'feature', page_group_id: 'feature-1', continuation_index: 1, content_blocks: [{ type: 'list', items: ['c'] }] },
    { kind: 'ending', role: 'ending', content_blocks: [] },
  ];
  const operations = buildDeterministicSocialCardPageCapOperations(pages, { maxPages: 4 });
  assert.deepEqual(operations.map((item) => item.pages), [[2, 3]]);
  const applied = applySocialCardRestructureOperations(pages, operations, { maxPages: 4 });
  assert.equal(applied.valid, true);
  assert.equal(applied.pages.length, 4);
});
