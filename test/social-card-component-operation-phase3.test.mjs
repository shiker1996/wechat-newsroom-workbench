import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySocialCardContentPlannerOperations,
  buildSocialCardContentPlannerPrompt,
  normalizeSocialCardContentPlannerResult,
  validateSocialCardContentPlannerSchema,
  validateSocialCardContentPlannerOperations,
} from '../server/features/social-cards/application/social-card-content-planner.mjs';

const sourceRefs = ['README:capability'];
const plan = [{ kind: 'content', role: 'feature', title: '能力', content_blocks: [{ type: 'text', content: '核心能力' }] }];
const factIndex = { candidates: [{ id: 'fact-export', path: 'facts.readme.features[0]', label: 'features', text: '支持导出 PNG。', tags: ['capability'], priority: 'core', source_status: 'provided', source_refs: sourceRefs }] };
const contentComponents = {
  supplements: [{
    id: 'component-fact-export@p1-capability-note',
    componentId: 'component-fact-export@p1-capability-note',
    page: 1,
    role: 'feature',
    slotId: 'capability',
    factIds: ['fact-export'],
    sourceRefs,
    sourceStatus: 'provided',
    semanticTags: ['capability'],
    preferredRender: 'note',
    renderCandidates: ['note', 'text'],
    content: { title: '具体能力', text: '支持导出 PNG。' },
  }],
  pageCandidates: {
    '1': {
      page: 1,
      role: 'feature',
      supplements: [{
        id: 'component-fact-export@p1-capability-note',
        componentId: 'component-fact-export@p1-capability-note',
        page: 1,
        role: 'feature',
        slotId: 'capability',
        factIds: ['fact-export'],
        sourceRefs,
        sourceStatus: 'provided',
        semanticTags: ['capability'],
        preferredRender: 'note',
        renderCandidates: ['note', 'text'],
        content: { title: '具体能力', text: '支持导出 PNG。' },
      }],
    },
  },
};

test('阶段 3 add_component 契约不要求 AI 返回 slot_id，但必须返回展示 block', () => {
  const raw = { operations: [{ op: 'add_component', page: 1, component_id: 'component-fact-export@p1-capability-note', render_type: 'note', fact_ids: ['fact-export'], source_refs: sourceRefs, block: { type: 'note', content: '支持导出 PNG。' } }] };
  assert.equal(validateSocialCardContentPlannerSchema(raw).valid, true);
  assert.equal('slot_id' in raw.operations[0], false);
  const prompt = buildSocialCardContentPlannerPrompt({ cardPlan: plan, contentComponents });
  assert.match(prompt, /add_component/);
  assert.match(prompt, /不要填写 slot_id/);
});

test('阶段 3 程序根据页面组件语义解析槽位并应用组件操作', () => {
  const raw = { operations: [{ op: 'add_component', page: 1, component_id: 'component-fact-export@p1-capability-note', render_type: 'note', fact_ids: ['fact-export'], source_refs: sourceRefs, block: { type: 'note', content: '支持导出 PNG。' } }] };
  const normalized = normalizeSocialCardContentPlannerResult(raw, { cardPlan: plan, contentComponents });
  assert.equal(normalized.operations[0].op, 'add_fact_block');
  assert.equal(normalized.operations[0].slot_id, 'capability');
  assert.equal(normalized.operations[0].component_id, 'fact-export');
  const options = { factIndex, contentComponents, knownSourceRefs: sourceRefs };
  assert.equal(validateSocialCardContentPlannerOperations(plan, raw, options).valid, true);
  const applied = applySocialCardContentPlannerOperations(plan, raw, options);
  assert.equal(applied.changed, true);
  assert.equal(applied.pages[0].content_blocks.at(-1).supplement_slot_id, 'capability');
  assert.equal(applied.pages[0].content_blocks.at(-1).content, '支持导出 PNG。');
});

test('阶段 3 组件内容为 fenced code 时不接受 AI 的 list 渲染覆盖', () => {
  const codeComponent = {
    id: 'component-fact-install@p1-install-list', componentId: 'component-fact-install@p1-install-list',
    page: 1, role: 'feature', slotId: 'capability', factIds: ['fact-install'], sourceRefs,
    semanticTags: ['capability'], preferredRender: 'list', renderCandidates: ['list', 'code'],
    content: { title: '安装命令', text: '```bash\ncurl -fsSl https://example.com/install | bash\n```' },
  };
  const normalized = normalizeSocialCardContentPlannerResult({ operations: [{
    op: 'add_component', page: 1, component_id: codeComponent.id, render_type: 'list',
    fact_ids: ['fact-install'], source_refs: sourceRefs,
    block: { type: 'list', title: '安装命令', content: '```bash\ncurl -fsSl https://example.com/install | bash\n```' },
  }] }, { cardPlan: plan, contentComponents: { pageCandidates: { '1': { supplements: [codeComponent] } } } });
  assert.equal(normalized.operations[0].op, 'add_fact_block');
  assert.equal(normalized.operations[0].block.type, 'code');
  assert.equal(normalized.operations[0].block.content, 'curl -fsSl https://example.com/install | bash');
});

test('阶段 3 旧 add_fact_block 不再作为内容计划输入接受', () => {
  const legacy = { operations: [{ op: 'add_fact_block', page: 1, slot_id: 'capability', source_refs: sourceRefs, block: { type: 'note' } }] };
  assert.equal(validateSocialCardContentPlannerSchema(legacy).valid, false);
  const result = validateSocialCardContentPlannerOperations(plan, legacy, { factIndex: { candidates: [] }, knownSourceRefs: sourceRefs });
  assert.equal(result.valid, false);
  assert.match(result.issues.join('；'), /不支持的结构修复操作/);
});

test('阶段 3 无法解析页面组件时不静默补槽位', () => {
  const raw = { operations: [{ op: 'add_component', page: 1, component_id: 'component-unknown', source_refs: sourceRefs, render_type: 'note' }] };
  const result = validateSocialCardContentPlannerOperations(plan, raw, { factIndex, contentComponents, knownSourceRefs: sourceRefs });
  assert.equal(result.valid, false);
  assert.match(result.issues.join('；'), /不属于当前页面候选池/);
});
