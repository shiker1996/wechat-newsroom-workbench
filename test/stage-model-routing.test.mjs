import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelGateway } from '../server/platform/llm/gateway.mjs';
import { createGenerationSnapshot } from '../server/platform/skills/registry.mjs';
import { resolveStageModelProvider, stageForPurpose, stageModelsFromProfiles, stageModelsFromUiFields } from '../server/platform/llm/stage-model-routing.mjs';

function makeGateway(stageModels = {}, snapshot = null, modelProfiles = {}) {
  const config = { llm: {
    defaultProvider: 'base', stageModels, modelProfiles,
    providers: {
      base: { label:'Base', baseUrl:'https://base.example/v1', model:'base-model', apiKeyEnv:'BASE_KEY', maxOutputTokens:4000, contextWindow:16000 },
      fast: { label:'Fast', baseUrl:'https://fast.example/v1', model:'fast-model', apiKeyEnv:'FAST_KEY', maxOutputTokens:2000, contextWindow:16000 },
      quality: { label:'Quality', baseUrl:'https://quality.example/v1', model:'quality-model', apiKeyEnv:'QUALITY_KEY', maxOutputTokens:8000, contextWindow:32000 },
    },
  }};
  const store = {
    getGenerationSnapshot: () => snapshot,
    recordModelCall: () => 1,
  };
  return new ModelGateway(config, store, (name) => ({ configured:true, values:{ apiKey:`${name}-secret` } }));
}

test('阶段模型按 purpose 路由，未配置时保持调用方 provider', () => {
  const gateway = makeGateway({ tagging:'fast', 'research.event-analysis':'quality' });
  assert.equal(stageForPurpose('hotspot-tagging'), 'tagging');
  assert.equal(gateway.resolveForInput({ provider:'base', purpose:'hotspot-tagging' }).providerName, 'fast');
  assert.equal(gateway.resolveForInput({ provider:'base', purpose:'event-research-analysis' }).providerName, 'base');
  assert.equal(gateway.resolveForInput({ provider:'base', purpose:'article-drafting-pipeline' }).providerName, 'base');
  assert.equal(gateway.resolveForInput({ provider:'base', purpose:'custom-social-chat' }).providerName, 'base');
});

test('四档模型配置通过网关生效，未配档位时保持旧行为', () => {
  const gateway = makeGateway({}, null, { fast:'fast', quality:'quality' });
  assert.equal(gateway.resolveForInput({ provider:'base', purpose:'hotspot-tagging' }).providerName, 'fast');
  assert.equal(gateway.resolveForInput({ provider:'base', purpose:'editorial-room' }).providerName, 'quality');
  assert.equal(gateway.resolveForInput({ provider:'base', purpose:'custom-social-chat' }).providerName, 'base');
});

test('页面只配置四档模型，流程节点由程序按档位映射', () => {
  const stageModels = stageModelsFromProfiles({ fast:'fast', balanced:'base', quality:'quality', deterministic:'deterministic' });
  assert.equal(stageModels.tagging, 'fast');
  assert.equal(stageModels['research.brainstorm'], 'base');
  assert.equal(stageModels.research, 'quality');
  assert.equal(stageModels.typeset, 'deterministic');
  assert.equal(stageModels['graphic-generation.layout-repair'], 'fast');
});

test('阶段子配置优先于父节点配置', () => {
  const gateway = makeGateway({ research:'fast', 'research.event-analysis':'quality' });
  assert.equal(gateway.resolveForInput({ provider:'base', purpose:'event-research-analysis' }).providerName, 'base', '未登记 purpose 不应误路由到 research');
  assert.equal(gateway.resolveForInput({ provider:'base', stage:'research.event-analysis', purpose:'discussion-research' }).providerName, 'quality');
  assert.equal(gateway.resolveForInput({ provider:'base', stage:'research.brainstorm', purpose:'hotspot-brainstorm-explore' }).providerName, 'fast');
});

test('deterministic 阶段显式阻止模型调用', () => {
  const gateway = makeGateway({ 'typeset.html-llm':'deterministic' });
  assert.throws(() => gateway.resolveForInput({ provider:'base', purpose:'typeset-html' }), /不调用模型/);
  const resolved = resolveStageModelProvider({ stage:'typeset.html-llm', providers:gateway.config.providers, stageModels:{ 'typeset.html-llm':'deterministic' }, fallbackProvider:'base' });
  assert.equal(resolved.disabled, true);
});

test('阶段模型路由优先使用历史快照，避免重试时读取新配置', () => {
  const snapshot = { snapshot:{ modelProvider:'base', stageModels:{ tagging:'quality' }, stageModelsResolved:{ tagging:{ provider:'fast', model:'fast-model', disabled:false } } } };
  const gateway = makeGateway({ tagging:'quality' }, snapshot);
  assert.equal(gateway.resolveForInput({ provider:'base', purpose:'hotspot-tagging', generationSnapshotId:'snapshot-1' }).providerName, 'fast');
});

test('UI 阶段字段转换为稳定子阶段 ID', () => {
  assert.deepEqual(stageModelsFromUiFields({ tagging:'fast', draftingBody:'quality', typesetDesign:'fast', unknown:'quality' }), {
    tagging:'fast', 'drafting.body':'quality', 'typeset.design':'fast',
  });
});

test('生成快照保存阶段模型配置和解析结果', () => {
  const snapshot = createGenerationSnapshot({ skillBundles:[], provider:'base', model:'base-model', purpose:'article', stageModels:{ tagging:'fast' }, stageModelsResolved:{ tagging:{ provider:'fast', model:'fast-model', disabled:false } } });
  assert.deepEqual(snapshot.stageModels, { tagging:'fast' });
  assert.deepEqual(snapshot.stageModelsResolved.tagging, { provider:'fast', model:'fast-model', disabled:false });
});
