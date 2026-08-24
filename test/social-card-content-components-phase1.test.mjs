import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditSocialCardJointPacking,
  buildSocialCardComponentPackingOperations,
  buildSocialCardContinuationPackingOperations,
  buildSocialCardContentComponents,
  buildSocialCardPageComponentCandidates,
  estimateSocialCardContentComponent,
  compactSocialCardText,
  isSocialCardFactComponentCompatibleWithSlot,
  renderSocialCardContentComponent,
  sanitizeSocialCardPlanFactBindings,
  selectBestSocialCardJointPackingOperations,
  validateSocialCardContentComponents,
} from '../server/shared/rendering/social-card-content-components.mjs';
import { validateSocialCardRestructureOperations } from '../server/shared/rendering/social-card-repair-policy.mjs';

const capacity = {
  structural: { maxBlocks: 4, maxItems: 9 },
  visual: { bodyHeightPx: 420, maxTitleLines: 3 },
};

test('阶段 1 事实候选转换为可组合补充组件，并保留多种渲染候选', () => {
  const snapshot = buildSocialCardContentComponents({
    contentType: 'repository',
    cardPlan: [],
    factIndex: {
      candidates: [{
        id: 'fact-run-1',
        index: 1,
        label: '使用方式',
        text: '打开文件后点击 Send，将反馈一次性发送给 AI。',
        tags: ['run', 'platform'],
        priority: 'core',
        source_status: 'provided',
        source_refs: ['README:Usage'],
      }],
    },
  });
  assert.equal(snapshot.supplements.length, 1);
  assert.deepEqual(snapshot.supplements[0].factIds, ['fact-run-1']);
  assert.ok(snapshot.supplements[0].renderCandidates.includes('note'));
  assert.ok(snapshot.supplements[0].renderCandidates.includes('steps'));
  assert.equal(validateSocialCardContentComponents(snapshot).valid, true);
  assert.deepEqual(snapshot.supplements[0].sizeVariants.map((variant) => variant.id), ['normal', 'typography-106', 'typography-112']);
});

test('fenced code 事实即使请求 list 也归一化为 code block', () => {
  const block = renderSocialCardContentComponent({
    id: 'component-install',
    preferredRender: 'list',
    renderCandidates: ['list', 'code'],
    content: { title: '安装命令', text: '```bash\ncurl -fsSl https://example.com/install | bash\n```' },
  }, 'list');
  assert.equal(block.type, 'code');
  assert.equal(block.content, 'curl -fsSl https://example.com/install | bash');
});

test('阶段 2 程序化压缩保留句意和技术 token，代码/命令不做字符截断', () => {
  const long = '先打开项目设置并确认运行环境，然后执行下面的命令完成初始化，最后回到页面点击发送反馈。https://example.com/docs/setup';
  const compact = compactSocialCardText(long, { ratio: .55, minChars: 30 });
  assert.ok(compact.length < long.length);
  assert.match(compact, /https:\/\/example\.com\/docs\/setup/);
  const command = '先准备环境，再执行 npm install --save-dev demo-package，最后检查输出。';
  assert.equal(compactSocialCardText(command, { ratio: .45, minChars: 20 }), command);
});

test('阶段 2 尺寸变体与容量预估共享 font_scale，放大变体不会被错误当成普通高度', () => {
  const component = {
    id: 'component-fact',
    renderCandidates: ['note'],
    content: { title: '说明', text: '这是一个足够长的说明文本，用于测试字体放大后页面高度会同步增加。' },
    sizeVariants: [
      { id: 'normal', mode: 'normal', fontScale: 1, content: { title: '说明', text: '这是一个足够长的说明文本，用于测试字体放大后页面高度会同步增加。' } },
      { id: 'typography-112', mode: 'typography', fontScale: 1.12, content: { title: '说明', text: '这是一个足够长的说明文本，用于测试字体放大后页面高度会同步增加。' } },
    ],
    factIds: ['fact-1'],
    sourceRefs: ['README:test'],
  };
  const page = { kind: 'content', role: 'feature', title: '能力', content_blocks: [] };
  const normal = estimateSocialCardContentComponent(component, { page, capacity, renderType: 'note', variantId: 'normal' });
  const expanded = estimateSocialCardContentComponent(component, { page, capacity, renderType: 'note', variantId: 'typography-112' });
  assert.ok(expanded.estimatedHeightPx > normal.estimatedHeightPx);
  assert.equal(renderSocialCardContentComponent(component, 'note', { variantId: 'typography-112' }).font_scale, 1.12);
});

test('阶段 3 拆页后的补充装箱按整体利用率评分，跳过会把页面推溢出的局部候选', () => {
  const pages = [
    { kind: 'content', role: 'feature', title: '能力一', content_blocks: [] },
    { kind: 'content', role: 'feature', title: '能力二', continuation_index: 2, content_blocks: [] },
  ];
  const operations = [
    { op: 'add_fact_block', page: 1, slot_id: 'capability', component_id: 'fact-long', fact_ids: ['fact-long'], source_refs: ['README:long'], block: { type: 'note', title: '长说明', content: '过长内容'.repeat(180), fact_ids: ['fact-long'], source_refs: ['README:long'] } },
    { op: 'add_fact_block', page: 2, slot_id: 'capability', component_id: 'fact-short', fact_ids: ['fact-short'], source_refs: ['README:short'], block: { type: 'note', title: '验证', content: '支持导出 PNG。', fact_ids: ['fact-short'], source_refs: ['README:short'] } },
  ];
  const selected = selectBestSocialCardJointPackingOperations(pages, operations, { capacityProfile: { roles: { feature: capacity } }, maxOperations: 2 });
  assert.equal(selected.improved, true);
  assert.deepEqual(selected.operations.map((operation) => operation.page), [2]);
  assert.ok(selected.score > selected.baselineScore);
});

test('阶段 4 记录静态容量预估与浏览器审计的偏差，不替代浏览器门禁', () => {
  const pages = [{ kind: 'content', role: 'feature', title: '能力', content_blocks: [{ type: 'note', content: '短说明' }] }];
  const audit = auditSocialCardJointPacking({
    cardPlan: pages,
    capacityProfile: { roles: { feature: capacity } },
    report: { pages: [{ page: 1, utilization: 58, valid: true, issues: [] }] },
  });
  assert.equal(audit.schemaVersion, 1);
  assert.equal(audit.pages.length, 1);
  assert.equal(audit.pages[0].actualUtilization, 0.58);
  assert.equal(typeof audit.pages[0].predictedUtilization, 'number');
  assert.equal(audit.summary.mismatchCount, 0);
});

test('阶段 1 核心故事板原子转换为核心组件且保留原渲染形式', () => {
  const snapshot = buildSocialCardContentComponents({
    cardPlan: [{
      kind: 'quickstart',
      role: 'steps',
      title: '快速开始',
      evidence: ['README:Usage'],
      content_blocks: [{ type: 'steps', title: '操作', items: [{ title: '打开文件', content: '输入命令' }] }],
    }],
    factIndex: { candidates: [] },
  });
  assert.equal(snapshot.core.length, 1);
  assert.equal(snapshot.core[0].preferredRender, 'steps');
  assert.equal(snapshot.core[0].splitPolicy, 'item');
  assert.ok(snapshot.core[0].semanticTags.includes('steps'));
  assert.equal(snapshot.core[0].sourceStatus, 'provided');
});

test('阶段 1 同一事实可以在装箱时选择 note 或 steps 形式', () => {
  const component = {
    id: 'component-fact-run-1',
    preferredRender: 'steps',
    renderCandidates: ['steps', 'note'],
    content: { title: '运行流程', text: '打开页面并点击 Send。' },
    factIds: ['fact-run-1'],
    sourceRefs: ['README:Usage'],
  };
  const note = renderSocialCardContentComponent(component, 'note');
  const steps = renderSocialCardContentComponent(component, 'steps');
  assert.equal(note.type, 'note');
  assert.equal(note.content, '打开页面并点击 Send。');
  assert.equal(steps.type, 'steps');
  assert.equal(steps.items.length, 1);
  assert.deepEqual(steps.fact_ids, ['fact-run-1']);
});

test('阶段 1 高度预估随渲染形式和页面现有内容计算', () => {
  const component = {
    id: 'component-fact-run-1',
    preferredRender: 'note',
    renderCandidates: ['note', 'steps'],
    content: { title: '运行说明', text: '打开页面并点击 Send。' },
    factIds: ['fact-run-1'],
    sourceRefs: ['README:Usage'],
  };
  const page = { kind: 'content', role: 'steps', title: '快速开始', content_blocks: [] };
  const note = estimateSocialCardContentComponent(component, { page, capacity, renderType: 'note' });
  const steps = estimateSocialCardContentComponent(component, { page, capacity, renderType: 'steps' });
  assert.ok(Number.isFinite(note.estimatedHeightPx));
  assert.ok(Number.isFinite(steps.estimatedHeightPx));
  assert.ok(steps.estimatedHeightPx >= note.estimatedHeightPx);
  assert.equal(note.componentId, 'component-fact-run-1');
  assert.equal(note.bodyHeightPx, 420);
});

test('阶段 1 组件快照允许旧故事板的兼容来源', () => {
  const snapshot = buildSocialCardContentComponents({
    cardPlan: [{ kind: 'content', role: 'concept', title: '说明', content_blocks: [{ type: 'text', content: '旧内容' }] }],
    factIndex: { candidates: [] },
  });
  const validation = validateSocialCardContentComponents(snapshot);
  assert.equal(validation.valid, true);
  assert.equal(snapshot.summary.sourceStatus['legacy-fallback'], 1);
});

test('阶段 2 组件装箱逐个尝试候选，不因首个长事实失败而阻塞后续候选', () => {
  const cardPlan = [{ kind: 'content', role: 'feature', title: '能力', content_blocks: [{ type: 'text', content: '核心能力' }] }];
  const snapshot = buildSocialCardContentComponents({ cardPlan, factIndex: { candidates: [
    { id: 'fact-long', label: '长事实', text: '很长的事实'.repeat(80), tags: ['capability'], priority: 'core', source_status: 'provided', source_refs: ['README:long'] },
    { id: 'fact-short', label: '短事实', text: '支持导出 PNG。', tags: ['capability'], priority: 'supporting', source_status: 'provided', source_refs: ['README:short'] },
  ] } });
  const operations = buildSocialCardComponentPackingOperations(cardPlan, [{ page: 1, utilization: 0.4, issues: ['underfilled'] }], snapshot, {
    maxOperations: 2,
    maxComponentsPerPage: 1,
    allowedBlockTypes: ['note', 'text', 'list'],
    canApply: ({ operation }) => operation.component_id !== 'fact-long',
  });
  assert.equal(operations.length, 1);
  assert.equal(operations[0].component_id, 'fact-short');
  assert.equal(operations[0].page, 1);
});

test('阶段 2 单页补充上限生效，同时允许事实组件的语义渲染候选', () => {
  const plan = [{ kind: 'content', role: 'steps', title: '运行', content_blocks: [] }];
  const operation = { op: 'add_fact_block', page: 1, slot_id: 'run', component_id: 'fact-run', fact_ids: ['fact-run'], source_refs: ['README:run'], block: { type: 'note', title: '运行说明', content: '点击发送', fact_ids: ['fact-run'], source_refs: ['README:run'], supplement_slot_id: 'run' } };
  const first = validateSocialCardRestructureOperations(plan, [operation], { maxFactBlocksAdded: 2, maxFactBlocksPerPage: 1, factIndex: { candidates: [{ id: 'fact-run', text: '点击发送', tags: ['run'], source_status: 'provided', source_refs: ['README:run'] }] }, knownSourceRefs: ['README:run'] });
  assert.equal(first.valid, true);
  const duplicate = validateSocialCardRestructureOperations(plan, [operation, { ...operation }], { maxFactBlocksAdded: 2, maxFactBlocksPerPage: 1, factIndex: { candidates: [{ id: 'fact-run', text: '点击发送', tags: ['run'], source_status: 'provided', source_refs: ['README:run'] }] }, knownSourceRefs: ['README:run'] });
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.issues.some((issue) => issue.includes('单页上限')));
});

test('阶段 5 静态预估接近上限时仍保留候选，交给浏览器审计最终裁决', () => {
  const page = { kind: 'content', role: 'feature', title: '能力', content_blocks: [{ type: 'text', content: '核心说明'.repeat(20) }] };
  const component = {
    id: 'component-fact-capability', componentId: 'component-fact-capability', path: 'facts.readme.sections[6]',
    factIds: ['fact-capability'], sourceRefs: ['README:capability'], sourceStatus: 'provided',
    semanticTags: ['capability'], preferredRender: 'note', renderCandidates: ['note'],
    sizeVariants: [{ id: 'normal', mode: 'normal', fontScale: 1, content: { title: '补充', text: '补充说明' } }],
    content: { title: '补充', text: '补充说明' },
  };
  const pageCandidates = buildSocialCardPageComponentCandidates([page], { supplements: [component], core: [] }, {
    capacityProfile: { roles: { feature: { bodyHeightPx: 120, maxTitleLines: 3, maxTextChars: 300, maxListItemLines: 2 } } },
  });
  assert.ok(pageCandidates['1'].supplements.length > 0);
  // 候选记录容量风险而不是因为 92% 软门禁直接丢失；若当前估算过高，
  // 仍允许在 softFitRatio 范围内交给后续装箱/浏览器审计。
  assert.ok(['safe', 'near-limit', 'soft-limit'].includes(pageCandidates['1'].supplements[0].capacityRisk));
});

test('同页已有来源核验职责时，来源补充候选在装箱前被排除', () => {
  const plan = [{ kind: 'evidence', role: 'evidence', title: '信息来源与核验', content_blocks: [
    { type: 'list', title: '来源清单', items: ['来源一', '来源二'] },
    { type: 'note', title: '核验状态', content: '部分信息尚未获官方确认。' },
  ] }];
  const component = {
    id: 'component-fact-source', componentId: 'component-fact-source', path: 'facts.sourceAudit.status',
    factIds: ['fact-source'], sourceRefs: ['README:source'], sourceStatus: 'provided',
    semanticIntent: 'source', semanticIntentCandidates: ['source'], semanticTags: ['source'],
    preferredRender: 'note', renderCandidates: ['note'],
    content: { title: '来源证据', text: '四起事件均有来源支持。' },
    sizeVariants: [{ id: 'normal', mode: 'normal', fontScale: 1, content: { title: '来源证据', text: '四起事件均有来源支持。' } }],
  };
  const candidates = buildSocialCardPageComponentCandidates(plan, { supplements: [component], core: [] }, {
    capacityProfile: { roles: { evidence: { bodyHeightPx: 420, maxTitleLines: 3, maxTextChars: 300, maxListItemLines: 2 } } },
  });
  assert.equal(candidates['1'].supplements.length, 0);
  assert.ok(candidates['1'].summary.rejectedBySemanticIntent > 0);
});

test('slot-fit 摘要不会把普通说明误渲染成 code block', () => {
  const component = {
    id: 'component-summary', factIds: ['fact-summary'], sourceRefs: ['README:summary'], sourceStatus: 'provided',
    semanticTags: ['run'], renderCandidates: ['code', 'steps', 'note'], preferredRender: 'steps',
    content: { title: '运行说明', text: '先打开终端，再检查快捷键冲突并确认页面可以接收输入。' },
    sizeVariants: [{ id: 'slot-fit', mode: 'slot-fit', fontScale: 1, content: { title: '运行说明', text: '先打开终端，再检查快捷键冲突并确认页面可以接收输入。' } }],
  };
  const plan = [{ kind: 'content', role: 'steps', title: '运行', content_blocks: [] }];
  const operations = buildSocialCardComponentPackingOperations(plan, [{ page: 1, utilization: 0.5, issues: ['underfilled_target'] }], { supplements: [component], pageCandidates: { '1': { supplements: [component] } } }, { maxOperations: 1, maxComponentsPerPage: 1, allowedBlockTypes: ['code', 'steps', 'note'], canApply: () => true });
  assert.equal(operations.length, 1);
  assert.notEqual(operations[0].block.type, 'code');
});

test('阶段 3 拆页续页继承故事线并重新装箱剩余事实组件', () => {
  const cardPlan = [
    { kind: 'content', role: 'feature', title: '能力', page_group_id: 'story-1', continuation_of: 1, continuation_index: 1, content_blocks: [{ type: 'text', content: '核心能力', fact_ids: ['fact-core'], source_refs: ['README:core'] }] },
    { kind: 'content', role: 'feature', title: '能力（续）', page_group_id: 'story-1', continuation_of: 1, continuation_index: 2, content_blocks: [{ type: 'code', content: 'run --check' }] },
  ];
  const snapshot = buildSocialCardContentComponents({ cardPlan, factIndex: { candidates: [{ id: 'fact-short', label: '输出', text: '支持导出结果文件。', tags: ['capability'], priority: 'supporting', source_status: 'provided', source_refs: ['README:output'] }] } });
  const operations = buildSocialCardContinuationPackingOperations(cardPlan, snapshot, {
    capacityProfile: { roles: { feature: capacity } },
    underfillThreshold: 0.8,
    maxOperations: 1,
    maxComponentsPerPage: 1,
    allowedBlockTypes: ['note', 'text', 'list'],
  });
  assert.equal(operations.length, 1);
  assert.equal(operations[0].page, 2);
  assert.equal(operations[0].slot_id, 'capability');
  assert.equal(cardPlan[1].page_group_id, cardPlan[0].page_group_id);
});

test('阶段 4 事实槽位过滤掉状态元数据和 README 标题候选', () => {
  assert.equal(isSocialCardFactComponentCompatibleWithSlot({ id: 'maturity', path: 'facts.maturity', tags: ['maturity'] }, 'concept', 'conclusion'), false);
  assert.equal(isSocialCardFactComponentCompatibleWithSlot({ id: 'maturity-release', path: 'facts.maturity', tags: ['release', 'maturity'] }, 'concept', 'conclusion'), false);
  assert.equal(isSocialCardFactComponentCompatibleWithSlot({ id: 'release-version', path: 'facts.latestRelease.version', tags: ['release'] }, 'concept', 'conclusion'), false);
  assert.equal(isSocialCardFactComponentCompatibleWithSlot({ id: 'topic', path: 'facts.topics[4]', tags: ['platform'] }, 'steps', 'prerequisite'), false);
  assert.equal(isSocialCardFactComponentCompatibleWithSlot({ id: 'forks', path: 'facts.forks.value', tags: ['metric'] }, 'steps', 'verify'), false);
  assert.equal(isSocialCardFactComponentCompatibleWithSlot({ id: 'topic-capability', path: 'facts.coreCapabilities[13]', label: 'coreCapabilities', text: '项目主题：ai-agents', tags: ['capability'] }, 'feature', 'capability'), false);
  assert.equal(isSocialCardFactComponentCompatibleWithSlot({ id: 'title', path: 'facts.readme.sections[5].title', tags: ['capability', 'source'] }, 'feature', 'capability'), false);
  assert.equal(isSocialCardFactComponentCompatibleWithSlot({ id: 'run', path: 'facts.readme.sections[3]', tags: ['run', 'source'] }, 'steps', 'run'), true);

  const plan = [
    { kind: 'content', role: 'concept', content_blocks: [{ type: 'text', supplement_slot_id: 'conclusion', fact_ids: ['maturity'], content: 'released' }] },
    { kind: 'content', role: 'feature', content_blocks: [{ type: 'text', supplement_slot_id: 'capability', fact_ids: ['title'], content: 'What’s inside' }] },
  ];
  const result = sanitizeSocialCardPlanFactBindings(plan, { candidates: [
    { id: 'maturity', path: 'facts.maturity', tags: ['maturity'] },
    { id: 'title', path: 'facts.readme.sections[5].title', tags: ['capability', 'source'] },
  ] });
  assert.equal(result.removed.length, 2);
  assert.equal(result.pages.every((page) => page.content_blocks.length === 0), true);
});
