import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSkillDefinition } from '../server/platform/skills/runtime-definition.mjs';
import { resolveSkillDefinition } from '../server/platform/skills/resolver.mjs';
import { loadSkillBundle } from '../server/platform/llm/skill-runtime.mjs';
import { createGenerationSnapshot } from '../server/platform/skills/registry.mjs';
import { validateSkillManifest } from '../server/platform/skills/manifest.mjs';
import { prepareSkillRun } from '../server/platform/skills/pipeline-runtime.mjs';

test('Skill Resolver 保留领域角色，支持同一技能的 Agent 与阶段运行', () => {
  const bundle = loadSkillBundle({ workspaceRoot: process.cwd(), skillName: 'wechat-mp-tutorial' });
  const agent = resolveSkillDefinition({ workspaceRoot: process.cwd(), skillId: 'wechat-mp-tutorial', kind: 'agent-skill', bundle });
  assert.equal(agent.role, 'writer'); assert.equal(agent.kind, 'agent-skill');
  assert.deepEqual(agent.entryPoints, ['independent-writing']); assert.equal(agent.inputContract, 'tutorial_fact_base');
  const stage = normalizeSkillDefinition(bundle.manifest);
  assert.equal(stage.kind, 'stage-skill'); assert.equal(stage.outputContract, 'wechat_markdown');
  assert.deepEqual(validateSkillManifest(bundle.manifest), []);
  assert.throws(() => resolveSkillDefinition({ skillId: 'missing', bundle: { fallback: true } }), /技能不可用/);
});

test('Manifest 运行字段校验且不改变已有角色契约', () => {
  const bundle = loadSkillBundle({ workspaceRoot: process.cwd(), skillName: 'article-reviewer' });
  assert.equal(validateSkillManifest({ ...bundle.manifest, runtimeKind: 'unknown' }).some((issue) => issue.field === 'runtimeKind'), true);
  assert.equal(validateSkillManifest({ ...bundle.manifest, budget: { maxToolCalls: -1 } }).some((issue) => issue.field === 'budget'), true);
  assert.equal(validateSkillManifest({ ...bundle.manifest, gates: ['readiness', 'readiness'] }).some((issue) => issue.field === 'gates'), true);
});

test('generation snapshot 冻结运行类型、输入输出、能力、预算和门禁', () => {
  const bundle = loadSkillBundle({ workspaceRoot: process.cwd(), skillName: 'article-reviewer' });
  bundle.manifest = { ...bundle.manifest, budget: { maxModelSteps: 2 }, gates: ['review-ready'] };
  const snapshot = createGenerationSnapshot({ skillBundles: [bundle], tools: [], provider: 'mock', model: 'model', purpose: 'test' });
  bundle.manifest.gates.push('later');
  assert.deepEqual(snapshot.skills[0].definition.gates, ['review-ready']);
  assert.equal(snapshot.skills[0].definition.budget.maxModelSteps, 2);
  assert.equal(snapshot.skills[0].definition.outputContract, 'reviewed_markdown');
  assert.equal(snapshot.skills[0].definition.kind, 'stage-skill');
});

test('Pipeline 在保存快照和模型执行前拒绝缺失的必需能力', async () => {
  let saved = false;
  await assert.rejects(prepareSkillRun({
    gateway: { config: { defaultProvider: 'mock', providers: { mock: { model: 'mock-model' } } } },
    store: { saveGenerationSnapshot: () => { saved = true; } }, batchId: 'batch', purpose: 'test',
    bundles: [{ skillName: 'demo', manifest: { requiredCapabilities: ['cap_nonexistent_required'] }, config: { allowedTools: [] } }],
  }), /缺少必需能力/);
  assert.equal(saved, false);
});

test('恢复历史 generation snapshot 时运行定义不被当前 Manifest 替换', async () => {
  const frozen = normalizeSkillDefinition({ id: 'demo', outputContract: 'old_output', gates: ['old_gate'] });
  const bundle = { skillName: 'demo', manifest: { outputContract: 'new_output', requiredCapabilities: ['cap_missing_now'] } };
  await prepareSkillRun({
    gateway: { config: { defaultProvider: 'mock', providers: { mock: { model: 'mock-model' } } } },
    store: { getGenerationSnapshot: () => ({ id: 1, batch_id: 'batch', snapshot: {
      modelProvider: 'mock', model: 'mock-model', tools: [], skills: [{ id: 'demo', definition: frozen, prompt: 'old prompt' }],
    } }) }, batchId: 'batch', purpose: 'test', bundles: [bundle], snapshotId: 1,
  });
  assert.equal(bundle.definition.outputContract, 'old_output');
  assert.deepEqual(bundle.definition.gates, ['old_gate']);
});
