import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSocialCardFactBlockFromCandidates,
  buildSocialCardFactCandidatePrompt,
  buildSocialCardFactIndex,
  buildDeterministicSocialCardFactSupplementOperations,
  knownSourceRefsFromSocialCardFactIndex,
  selectSocialCardFactCandidates,
} from '../lib/rendering/social-card-fact-index.mjs';
import { validateSocialCardContentPlannerOperations } from '../lib/rendering/social-card-content-planner.mjs';

test('事实候选索引保留来源并排除未核实主张', () => {
  const index = buildSocialCardFactIndex({
    sourceUrl: 'https://github.com/acme/tool',
    description: '自动生成发布说明',
    coreCapabilities: ['从提交记录生成 changelog'],
    installation: ['npm install acme-tool'],
    claims: [{ claim: '据称支持所有平台', sourceIds: ['claim:1'] }],
    limitations: ['需要 Node.js 18'],
  });
  assert.ok(index.candidateCount >= 4);
  assert.ok(index.candidates.some((item) => item.text.includes('npm install')));
  assert.equal(index.candidates.some((item) => item.text.includes('所有平台')), false);
  assert.deepEqual(knownSourceRefsFromSocialCardFactIndex(index), ['https://github.com/acme/tool']);
});

test('事实候选按角色槽位匹配并可编译为带来源的补充块', () => {
  const index = buildSocialCardFactIndex({
    sourceUrl: 'https://example.com/readme',
    coreCapabilities: ['生成 changelog'],
    installation: ['npm install demo'],
    limitations: ['需要网络访问'],
  });
  const selected = selectSocialCardFactCandidates(index, { role: 'steps', slotId: 'install', blockType: 'code', limit: 2 });
  assert.ok(selected.length >= 1);
  assert.ok(selected[0].tags.includes('install'));
  const block = buildSocialCardFactBlockFromCandidates(index, { role: 'steps', slotId: 'install', blockType: 'code', factIds: selected.map((item) => item.id) });
  assert.equal(block.type, 'code');
  assert.equal(block.supplement_slot_id, 'install');
  assert.ok(block.source_refs.includes('https://example.com/readme'));
  assert.equal(block.fact_ids.length, selected.length);
});

test('完整 fenced code 在事实索引中保留换行', () => {
  const index = buildSocialCardFactIndex({
    sourceUrl: 'https://example.com/readme',
    readme: { sections: [{ title: 'Install', content: '```bash\ncurl -fsSl https://example.com/install | bash\n```' }] },
  });
  const candidate = index.candidates.find((item) => item.path.endsWith('sections[0]'));
  assert.equal(candidate.text, '```bash\ncurl -fsSl https://example.com/install | bash\n```');
});

test('事实候选提示只暴露候选 id、文本、标签和来源', () => {
  const index = buildSocialCardFactIndex({ sourceUrl: 'https://example.com', description: '工具简介' });
  const prompt = JSON.parse(buildSocialCardFactCandidatePrompt(index));
  assert.equal(prompt.schemaVersion, 1);
  assert.ok(prompt.candidates[0].id);
  assert.equal('path' in prompt.candidates[0], false);
  assert.equal('source_status' in prompt.candidates[0], false);
});

test('内容不足时程序可按角色槽位生成一条有来源的补充操作', () => {
  const index = buildSocialCardFactIndex({ sourceUrl: 'https://example.com', coreCapabilities: ['提供可核验的能力说明'] });
  const plan = [{ kind: 'content', role: 'feature', content_blocks: [{ type: 'text', content: '已有内容', source_refs: ['https://example.com'] }] }];
  const operations = buildDeterministicSocialCardFactSupplementOperations(plan, [{ page: 1, issues: ['underfilled'] }], index, { maxBlocksByRole: { feature: 4 }, allowedBlockTypes: ['text', 'note'] });
  assert.equal(operations.length, 1);
  assert.equal(operations[0].op, 'add_fact_block');
  assert.equal(operations[0].slot_id, 'capability');
  assert.ok(operations[0].fact_ids.length >= 1);
  assert.deepEqual(operations[0].source_refs, ['https://example.com']);
});

test('add_component 的 fact_ids 必须能回指候选及其来源', () => {
  const index = buildSocialCardFactIndex({ sourceUrl: 'https://example.com', coreCapabilities: ['提供能力说明'] });
  const candidate = index.candidates.find((item) => item.tags.includes('capability'));
  const plan = [{ kind: 'content', role: 'feature', page_group_id: 'g1', content_blocks: [{ type: 'text', content: '已有', source_refs: ['https://example.com'] }] }];
  const component = { id: `component-${candidate.id}`, componentId: `component-${candidate.id}`, page: 1, role: 'feature', slotId: 'capability', factIds: [candidate.id], sourceRefs: candidate.source_refs, sourceStatus: 'provided', semanticTags: candidate.tags, preferredRender: 'text', renderCandidates: ['text'], content: { title: '具体能力', text: candidate.text } };
  const componentOptions = { factIndex: index, contentComponents: { supplements: [component], pageCandidates: { '1': { supplements: [component] } } } };
  const valid = validateSocialCardContentPlannerOperations(plan, { operations: [{ op: 'add_component', page: 1, component_id: component.id, render_type: 'text', fact_ids: [candidate.id], source_refs: candidate.source_refs, block: { type: 'text', content: candidate.text, fact_ids: [candidate.id] } }] }, componentOptions);
  assert.equal(valid.valid, true);
  const invalid = validateSocialCardContentPlannerOperations(plan, { operations: [{ op: 'add_component', page: 1, component_id: component.id, render_type: 'text', fact_ids: ['fact-unknown'], source_refs: candidate.source_refs, block: { type: 'text', content: '伪造', fact_ids: ['fact-unknown'] } }] }, componentOptions);
  assert.equal(invalid.valid, false);
  assert.match(invalid.issues.join('；'), /未知事实候选/);
});
