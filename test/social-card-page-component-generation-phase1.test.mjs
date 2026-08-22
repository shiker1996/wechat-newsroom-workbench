import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSocialCardFactCandidatePrompt,
  buildSocialCardFactIndex,
} from '../lib/rendering/social-card-fact-index.mjs';
import {
  buildSocialCardContentComponents,
  isSocialCardFactComponentCompatibleWithSlot,
} from '../lib/rendering/social-card-content-components.mjs';

test('阶段 1 事实索引写入自然展示标签、语义意图和组件资格', () => {
  const index = buildSocialCardFactIndex({
    sourceUrl: 'https://example.com/readme',
    language: 'JavaScript',
    topics: ['ai-agents'],
    forks: 78,
    coreCapabilities: ['项目主题：ai-agents', '支持导出反馈结果'],
    installation: ['npm install demo'],
  });
  const topic = index.candidates.find((item) => item.text === 'ai-agents');
  const forks = index.candidates.find((item) => item.text === '78');
  const capability = index.candidates.find((item) => item.text === '支持导出反馈结果');
  assert.equal(topic.component_eligible, false);
  assert.equal(forks.component_eligible, false);
  assert.equal(capability.component_eligible, true);
  assert.equal(capability.display_label, '具体能力');
  assert.ok(capability.semantic_intent_candidates.includes('capability'));
});

test('阶段 1 补充组件池过滤元数据，并使用自然标题', () => {
  const snapshot = buildSocialCardContentComponents({
    cardPlan: [],
    factIndex: {
      candidates: [
        { id: 'topic', path: 'facts.topics[0]', label: 'topics', text: 'ai-agents', tags: ['platform'], source_status: 'provided', source_refs: ['README'] },
        { id: 'run', path: 'facts.readme.sections[2]', label: 'sections', text: '打开页面并点击 Send。', tags: ['run'], source_status: 'provided', source_refs: ['README'] },
      ],
    },
  });
  assert.deepEqual(snapshot.supplements.map((item) => item.id), ['component-run']);
  assert.equal(snapshot.supplements[0].content.title, '使用说明');
});

test('阶段 1 事实候选提示不再向模型暴露元数据候选', () => {
  const index = buildSocialCardFactIndex({
    sourceUrl: 'https://example.com',
    topics: ['metadata-only'],
    coreCapabilities: ['支持导出 PNG'],
  });
  const prompt = JSON.parse(buildSocialCardFactCandidatePrompt(index));
  assert.equal(prompt.candidates.some((item) => item.text === 'metadata-only'), false);
  const capability = prompt.candidates.find((item) => item.text === '支持导出 PNG');
  assert.equal(capability.display_label, '具体能力');
  assert.ok(capability.semantic_intent_candidates.includes('capability'));
});

test('阶段 1 槽位兼容性统一读取组件资格标记', () => {
  assert.equal(isSocialCardFactComponentCompatibleWithSlot({ id: 'excluded', component_eligible: false, tags: ['run'] }, 'steps', 'run'), false);
  assert.equal(isSocialCardFactComponentCompatibleWithSlot({ id: 'run', component_eligible: true, tags: ['run'] }, 'steps', 'run'), true);
});
