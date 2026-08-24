import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOCIAL_CARD_PAGE_COMPONENT_SCHEMA_VERSION,
  SOCIAL_CARD_SLOT_SEMANTIC_TAGS,
  displayLabelForSocialCardFact,
  normalizeSocialCardPageComponent,
  semanticIntentCandidatesForTags,
} from '../server/shared/rendering/social-card-page-component-contract.mjs';
import { buildSocialCardContentComponents } from '../server/shared/rendering/social-card-content-components.mjs';
import { selectSocialCardFactCandidates } from '../server/shared/rendering/social-card-fact-index.mjs';

test('阶段 0 页面组件契约冻结核心/补充字段，并不改变旧 id', () => {
  const snapshot = buildSocialCardContentComponents({
    cardPlan: [{ kind: 'content', role: 'steps', title: '运行', content_blocks: [{ type: 'code', title: '启动', content: 'run --local' }] }],
    factIndex: { candidates: [{ id: 'fact-run', path: 'facts.readme.sections[3]', label: 'sections', text: '打开本地页面并点击 Send。', tags: ['run', 'source'], priority: 'core', source_status: 'provided', source_refs: ['README:run'] }] },
  });
  const core = snapshot.core[0];
  const supplement = snapshot.supplements[0];
  assert.equal(core.kind, 'core');
  assert.equal(core.componentId, core.id);
  assert.equal(core.schemaVersion, SOCIAL_CARD_PAGE_COMPONENT_SCHEMA_VERSION);
  assert.equal(supplement.kind, 'supplement');
  assert.equal(supplement.componentId, supplement.id);
  assert.equal(supplement.page, null);
  assert.equal(supplement.displayLabel, '使用说明');
  assert.ok(supplement.semanticIntentCandidates.includes('run'));
});

test('阶段 0 槽位语义只有一个来源，事实索引与组件层使用相同规则', () => {
  assert.deepEqual(SOCIAL_CARD_SLOT_SEMANTIC_TAGS['steps.verify'], ['output', 'run']);
  assert.deepEqual(semanticIntentCandidatesForTags(['run', 'source']), ['run', 'source']);
  const index = { candidates: [{ id: 'fact-run', path: 'facts.readme.sections[3]', label: 'sections', text: '打开并运行', tags: ['run'], priority: 'core', source_status: 'provided', source_refs: ['README:run'] }] };
  assert.equal(selectSocialCardFactCandidates(index, { role: 'steps', slotId: 'verify', limit: 1 })[0].id, 'fact-run');
});

test('阶段 0 字段名仅保留在审计路径，不作为展示标签', () => {
  assert.equal(displayLabelForSocialCardFact({ path: 'facts.coreCapabilities[0]', label: 'coreCapabilities' }), '具体能力');
  assert.equal(displayLabelForSocialCardFact({ path: 'facts.readme.sections[3]', label: 'sections' }), '使用说明');
  const normalized = normalizeSocialCardPageComponent({ id: 'x', kind: 'supplement', page: '6', role: 'steps', semantic_intent: 'run', display_label: '运行方式', render_candidates: ['note'], preferred_render: 'note' });
  assert.deepEqual({ componentId: normalized.componentId, page: normalized.page, semanticIntent: normalized.semanticIntent, displayLabel: normalized.displayLabel, preferredRender: normalized.preferredRender }, { componentId: 'x', page: 6, semanticIntent: 'run', displayLabel: '运行方式', preferredRender: 'note' });
});
