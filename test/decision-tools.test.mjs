import test from 'node:test';
import assert from 'node:assert/strict';
import {
  callDecisionTool,
  DECISION_TITLE_PLAN_TOOL,
  decisionToolDefinition,
  decisionToolEnabled,
  extractDecisionToolArguments,
  normalizeDecisionToolSettings,
  normalizeDecisionTitlePlan,
  providerSupportsForcedToolChoice,
  readDecisionToolSettings,
  saveDecisionToolSettings,
  supportsDecisionTools,
  validateDecisionToolArguments,
} from '../server/platform/llm/decision-tools.mjs';

function gateway(provider = {}) {
  return { config: { defaultProvider: 'mock', providers: { mock: { supportsNativeTools: true, ...provider } } } };
}

test('决策工具能力默认兼容 supportsNativeTools，显式禁用强制选择时关闭', () => {
  assert.equal(providerSupportsForcedToolChoice(gateway()), true);
  assert.equal(supportsDecisionTools(gateway()), true);
  assert.equal(supportsDecisionTools(gateway({ supportsForcedToolChoice: false })), false);
  assert.equal(supportsDecisionTools(gateway({ supportsNativeTools: false })), false);
});

test('决策工具设置默认关闭并持久化到 system 扩展设置', () => {
  const rows = new Map();
  const repository = {
    get: (type, id, scope) => rows.get(`${type}:${id}:${scope}`) || null,
    save: (input) => {
      const row = { value: input.value };
      rows.set(`${input.extensionType}:${input.extensionId}:${input.scope}`, row);
      return row;
    },
  };
  assert.deepEqual(readDecisionToolSettings(repository), { decisionToolsEnabled: false, decisionToolOverrides: {} });
  const settings = saveDecisionToolSettings(repository, {
    decisionToolsEnabled: true,
    decisionToolOverrides: { 'decision.quality_gate': true, ignored: 'yes' },
  });
  assert.deepEqual(settings, { decisionToolsEnabled: true, decisionToolOverrides: { 'decision.quality_gate': true } });
  assert.equal(decisionToolEnabled({ gateway: gateway(), repository, toolName: 'decision.quality_gate' }), true);
  assert.equal(decisionToolEnabled({ gateway: gateway(), repository, toolName: 'decision.title_plan' }), true);
  saveDecisionToolSettings(repository, { decisionToolsEnabled: true, decisionToolOverrides: { 'decision.title_plan': false } });
  assert.equal(decisionToolEnabled({ gateway: gateway(), repository, toolName: 'decision.title_plan' }), false);
  assert.deepEqual(normalizeDecisionToolSettings({ enabled: true, overrides: { x: false } }), { decisionToolsEnabled: true, decisionToolOverrides: { x: false } });
});

test('标题规划工具统一候选结构并在 selectedTitle 不匹配时确定性回退', () => {
  const plan = normalizeDecisionTitlePlan({
    selectedTitle: '不存在的标题',
    titleCandidates: ['候选一', { title: '候选一', reason: '重复' }, { title: '候选二', reason: '更具体' }],
    coreKeywords: ['AI', 'AI', '  编程  '],
  }, { fallbackTitle: '默认标题' });
  assert.equal(DECISION_TITLE_PLAN_TOOL.function.name, 'decision.title_plan');
  assert.equal(plan.selectedTitle, '候选一');
  assert.deepEqual(plan.titleCandidates, [{ title: '候选一', reason: '' }, { title: '候选二', reason: '更具体' }]);
  assert.deepEqual(plan.coreKeywords, ['AI', '编程']);
});

test('决策工具参数校验覆盖类型、必填、枚举和额外字段', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      pass: { type: 'boolean' },
      stage: { type: 'string', enum: ['draft', 'final'] },
      issues: { type: 'array', maxItems: 2, items: { type: 'string', minLength: 1 } },
    },
    required: ['pass'],
  };
  assert.equal(validateDecisionToolArguments({ pass: true, stage: 'final', issues: ['ok'] }, schema).valid, true);
  const invalid = validateDecisionToolArguments({ pass: 'true', stage: 'other', extra: 1 }, schema);
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.issues.map((item) => item.code).sort(), ['TYPE', 'ENUM', 'ADDITIONAL_PROPERTY'].sort());
});

test('决策工具调用要求恰好一个指定的应用函数工具', () => {
  const schema = { type: 'object', additionalProperties: false, properties: { pass: { type: 'boolean' } }, required: ['pass'] };
  assert.deepEqual(extractDecisionToolArguments({ toolCalls: [{ name: 'decision.quality_gate', input: { pass: true } }] }, { toolName: 'decision.quality_gate', schema }), { pass: true });
  assert.throws(() => extractDecisionToolArguments({ toolCalls: [] }, { toolName: 'decision.quality_gate', schema }), (error) => error.code === 'INVALID_TOOL_CALL_COUNT');
  assert.throws(() => extractDecisionToolArguments({ toolCalls: [{ name: 'web_search', input: {} }] }, { toolName: 'decision.quality_gate', schema }), (error) => error.code === 'INVALID_TOOL_NAME');
  assert.throws(() => extractDecisionToolArguments({ toolCalls: [{ name: 'decision.quality_gate', input: { pass: true }, providerExecuted: true }] }, { toolName: 'decision.quality_gate', schema }), (error) => error.code === 'PROVIDER_EXECUTED_TOOL');
});

test('callDecisionTool 使用工具时关闭 JSON mode，并在失败时记录 invalid_output 后回退', async () => {
  const updates = [];
  const store = { updateModelCall: (id, fields) => updates.push({ id, fields }) };
  const calls = [];
  const model = gateway();
  model.store = store;
  model.complete = async (input) => {
    calls.push(input);
    return { callId: 42, toolCalls: [{ name: 'decision.quality_gate', input: { pass: true } }] };
  };
  const definition = decisionToolDefinition({ name: 'decision.quality_gate', description: '门禁', parameters: { type: 'object', properties: { pass: { type: 'boolean' } }, required: ['pass'] } });
  const success = await callDecisionTool({ gateway: model, settings: { decisionToolsEnabled: true }, purpose: 'test-decision', definition, messages: [{ role: 'user', content: '检查' }] });
  assert.equal(success.mode, 'tool');
  assert.deepEqual(success.value, { pass: true });
  assert.equal(calls[0].jsonMode, false);
  assert.deepEqual(calls[0].toolChoice, { type: 'function', name: 'decision.quality_gate' });

  model.complete = async () => ({ callId: 43, toolCalls: [{ name: 'decision.quality_gate', input: { pass: 'yes' } }] });
  const fallback = await callDecisionTool({ gateway: model, settings: { decisionToolsEnabled: true }, purpose: 'test-decision', definition, fallback: ({ reason }) => ({ reason }) });
  assert.equal(fallback.mode, 'fallback');
  assert.equal(fallback.value.reason, 'INVALID_TOOL_ARGUMENTS');
  assert.deepEqual(updates, [{ id: 43, fields: { status: 'invalid_output', error: '[INVALID_TOOL_ARGUMENTS] 决策工具参数校验失败' } }]);
});

test('决策工具关闭时不调用模型，直接走回退', async () => {
  let called = false;
  const model = gateway();
  model.complete = async () => { called = true; throw new Error('不应调用'); };
  const result = await callDecisionTool({ gateway: model, settings: { decisionToolsEnabled: false }, purpose: 'test-decision', definition: decisionToolDefinition({ name: 'decision.test' }), fallback: 'legacy-json' });
  assert.equal(called, false);
  assert.deepEqual(result, { mode: 'fallback', value: 'legacy-json', reason: 'disabled' });
});
