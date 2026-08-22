import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSocialCardContentComponents,
  buildSocialCardPageComponentCandidates,
  buildSocialCardComponentPackingOperations,
} from '../lib/rendering/social-card-content-components.mjs';

const capacity = {
  structural: { maxBlocks: 4, maxItems: 9 },
  visual: { bodyHeightPx: 420, maxTitleLines: 3 },
};

test('阶段 2 页面专属组件绑定 page、role、slot 和渲染形式', () => {
  const cardPlan = [{ kind: 'content', role: 'steps', title: '快速开始', content_blocks: [{ type: 'steps', title: '安装', items: [{ title: '安装', content: 'npm install demo' }] }] }];
  const snapshot = buildSocialCardContentComponents({
    cardPlan,
    capacityProfile: { roles: { steps: capacity } },
    factIndex: { candidates: [
      { id: 'run', path: 'facts.readme.usage[0]', label: 'usage', text: '运行 demo 并打开本地页面。', tags: ['run'], priority: 'core', source_status: 'provided', source_refs: ['README:usage'] },
      { id: 'metric', path: 'facts.stats[0]', label: 'stars', text: '获得 120 个收藏。', tags: ['metric'], priority: 'supporting', source_status: 'provided', source_refs: ['README:stats'] },
    ] },
  });
  const page = snapshot.pageCandidates['1'];
  assert.equal(page.page, 1);
  assert.equal(page.role, 'steps');
  assert.ok(page.supplements.length > 0);
  assert.ok(page.supplements.every((component) => component.page === 1 && component.role === 'steps'));
  assert.ok(page.supplements.every((component) => component.slotId === 'run' || component.slotId === 'verify'));
  assert.ok(page.supplements.every((component) => component.preferredRender));
  assert.equal(page.supplements.some((component) => component.factIds.includes('metric')), false);
});

test('阶段 2 页面候选按现有容量预估过滤，避免先生成再溢出', () => {
  const cardPlan = [{ kind: 'content', role: 'feature', title: '能力', content_blocks: [{ type: 'text', content: '核心能力' }] }];
  const base = buildSocialCardContentComponents({
    cardPlan,
    factIndex: { candidates: [
      { id: 'long', path: 'facts.capability.long', label: 'capability', text: '很长的内容。'.repeat(300), tags: ['capability'], priority: 'core', source_status: 'provided', source_refs: ['README:long'] },
      { id: 'short', path: 'facts.capability.short', label: 'capability', text: '支持导出 PNG。', tags: ['capability'], priority: 'supporting', source_status: 'provided', source_refs: ['README:short'] },
    ] },
  });
  const candidates = buildSocialCardPageComponentCandidates(cardPlan, base, { capacityProfile: { roles: { feature: capacity } } });
  const ids = candidates['1'].supplements.map((component) => component.factIds[0]);
  assert.ok(ids.includes('short'));
  assert.equal(ids.includes('long'), false);
  assert.ok(candidates['1'].supplements.every((component) => component.capacityEstimate.fits));
});

test('阶段 2 装箱优先使用页面候选，不把其他页面的事实跨页装入', () => {
  const cardPlan = [
    { kind: 'content', role: 'feature', content_blocks: [{ type: 'text', content: '能力' }] },
    { kind: 'content', role: 'steps', content_blocks: [{ type: 'text', content: '步骤' }] },
  ];
  const snapshot = {
    supplements: [{ id: 'component-global', factIds: ['global'], sourceRefs: ['README:global'], sourceStatus: 'provided', semanticTags: ['capability'], priority: 'core', renderCandidates: ['text'], preferredRender: 'text', content: { title: '全局', text: '不应跨页' } }],
    pageCandidates: {
      '1': { supplements: [{ id: 'component-page-1', factIds: ['page-1'], sourceRefs: ['README:page-1'], sourceStatus: 'provided', semanticTags: ['capability'], priority: 'core', renderCandidates: ['text'], preferredRender: 'text', page: 1, role: 'feature', slotId: 'capability', content: { title: '能力', text: '页面一专属' } }] },
      '2': { supplements: [] },
    },
  };
  const operations = buildSocialCardComponentPackingOperations(cardPlan, [{ page: 1, utilization: 0.4, issues: ['underfilled'] }, { page: 2, utilization: 0.4, issues: ['underfilled'] }], snapshot, { maxOperations: 2, maxComponentsPerPage: 1, allowedBlockTypes: ['text'] });
  assert.equal(operations.length, 1);
  assert.equal(operations[0].component_id, 'page-1');
  assert.equal(operations[0].page, 1);
});
