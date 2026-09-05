import test from 'node:test';
import assert from 'node:assert/strict';
import { executeBrokerTool } from '../server/platform/agent/tool-broker.mjs';
import { buildConversationToolCatalog } from '../server/platform/agent/tool-catalog.mjs';
import { runConversationAgent } from '../server/platform/agent/conversation-agent.mjs';
import { normalizeModelTurn } from '../server/platform/agent/model-events.mjs';

const capability = 'cap_test_read';
const request = { requestId: 'tr_test', capability, arguments: { query: 'hello' }, reason: 'test' };
const tool = { capability, inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } }, outputSchema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } } };
const ok = () => ({ status: 'ok', data: { answer: 'ok' } });
function options(handler = ok, extra = {}) { return { catalog: [tool], context: { toolHandlers: { [capability]: handler } }, ...extra }; }

test('Broker handler 执行前校验输入、授权与路径，失败不执行', async () => {
  let called = 0;
  const opts = options(() => { called++; return ok(); });
  assert.equal((await executeBrokerTool({ ...request, arguments: {} }, opts)).error.code, 'INVALID_TOOL_ARGUMENTS');
  assert.equal((await executeBrokerTool(request, { ...opts, context: { ...opts.context, allowedCapabilities: [] } })).error.code, 'CAPABILITY_NOT_VISIBLE');
  assert.equal((await executeBrokerTool(request, { ...opts, catalog: [{ ...tool, pathInputs: ['path'] }], resolveArguments: () => ({ path: '/outside' }) })).error.code, 'TOOL_PERMISSION_DENIED');
  assert.equal(called, 0);
});

test('Broker handler 与缓存均校验输出且留下摘要审计', async () => {
  const logs = [];
  const opts = options(() => ({ status: 'ok', data: { answer: 12 } }));
  opts.context.executionLog = (record) => logs.push(record);
  assert.equal((await executeBrokerTool(request, opts)).error.code, 'TOOL_OUTPUT_INVALID');
  assert.equal((await executeBrokerTool(request, { ...opts, cacheLookup: () => ({ status: 'ok', data: {} }) })).error.code, 'TOOL_OUTPUT_INVALID');
  assert.equal(logs.length, 2);
  assert.deepEqual(logs[0].inputKeys, ['query']);
  assert.equal(logs[1].plugin, 'agent-cache');
  assert.equal(JSON.stringify(logs).includes('hello'), false);
  const cachedResult = await executeBrokerTool(request, { ...opts, cacheLookup: () => ({ ...ok(), provenance: { provider: 'source-cache' } }) });
  assert.equal(cachedResult.provenance.provider, 'source-cache');
});

test('Broker 确认门禁无法由 context 绕过，本地副作用不读取缓存', async () => {
  let calls = 0, cache = 0;
  const opts = options(() => { calls++; return ok(); });
  opts.context.authorizedExternalWrite = true;
  const events = [];
  const blocked = await executeBrokerTool(request, { ...opts, catalog: [{ ...tool, riskLevel: 'external-write' }], onEvent: (type) => events.push(type) });
  assert.equal(blocked.error.code, 'TOOL_CONFIRMATION_REQUIRED');
  assert.deepEqual(events, ['tool.needs_confirmation']);
  assert.equal(calls, 0);
  await executeBrokerTool(request, { ...opts, catalog: [{ ...tool, riskLevel: 'local-write' }], cacheLookup: () => { cache++; return ok(); } });
  assert.equal(calls, 1); assert.equal(cache, 0);
  const confirmed = await executeBrokerTool(request, { ...opts, catalog: [{ ...tool, riskLevel: 'external-write' }], context: { ...opts.context, confirmedCapabilities: [capability] } });
  assert.equal(confirmed.status, 'ok'); assert.equal(calls, 2);
});

test('Broker 超时和取消传递 AbortSignal，停止后续执行', async () => {
  let passedSignal;
  const logs = [];
  const opts = options((_input, context) => { passedSignal = context.signal; return new Promise(() => {}); });
  opts.context.executionLog = (record) => logs.push(record);
  const timedOut = await executeBrokerTool(request, { ...opts, catalog: [{ ...tool, timeoutMs: 10 }] });
  assert.equal(timedOut.error.code, 'TOOL_TIMEOUT'); assert.equal(passedSignal.aborted, true);
  assert.equal(logs[0].errorCode, 'TOOL_TIMEOUT');
  const controller = new AbortController(); controller.abort();
  let called = false;
  const cancelled = await executeBrokerTool(request, options(() => { called = true; return ok(); }, { context: { signal: controller.signal } }));
  assert.equal(cancelled.error.code, 'AGENT_ABORTED'); assert.equal(called, false);
});

test('Broker 对幂等只读工具仅在同一 Run 复用已完成结果', async () => {
  const saved = new Map(), store = {
    getAgentIdempotentResult: ({ key, capability, plugin, version }) => {
      const value = saved.get(`${key}:${capability}`);
      return value && (!plugin || value.plugin === plugin) && (!version || value.version === version) ? { result: value.result } : null;
    },
    saveAgentIdempotentResult: ({ key, capability, plugin, version, result }) => { saved.set(`${key}:${capability}`, { plugin, version, result }); },
  };
  let calls = 0;
  const first = await executeBrokerTool(request, { catalog: [{ ...tool, implementations: [{ plugin: 'reader', version: '1.0.0' }] }], context: { store, agentRunId: 'same-run', idempotencyKey: 'fixed-key', toolHandlers: { [capability]: () => { calls += 1; return ok(); } } } });
  const second = await executeBrokerTool(request, { catalog: [{ ...tool, implementations: [{ plugin: 'reader', version: '1.0.0' }] }], context: { store, agentRunId: 'same-run', idempotencyKey: 'fixed-key', toolHandlers: { [capability]: () => { calls += 1; throw new Error('should not execute'); } } } });
  assert.equal(first.status, 'ok'); assert.equal(second.status, 'ok'); assert.equal(calls, 1);
});

test('Broker 不会因 Manifest 误标幂等而自动重放外部写入', async () => {
  const saved = new Map(), store = {
    getAgentIdempotentResult: () => saved.get('fixed'),
    saveAgentIdempotentResult: ({ result }) => saved.set('fixed', { result }),
  };
  let calls = 0;
  const writeTool = { ...tool, riskLevel: 'external-write', sideEffect: 'external-write', idempotent: true, requiresConfirmation: true };
  const context = { store, idempotencyKey: 'fixed', confirmedCapabilities: [capability], toolHandlers: { [capability]: () => { calls += 1; return ok(); } } };
  await executeBrokerTool(request, { catalog: [writeTool], context });
  await executeBrokerTool(request, { catalog: [writeTool], context });
  assert.equal(calls, 2); assert.equal(saved.size, 0);
});

test('工具目录补齐风险、副作用、超时、幂等与输出契约', () => {
  const catalog = buildConversationToolCatalog({ registry: { listCapabilities: () => [] }, applicationTools: [{ ...tool, riskLevel: 'local-write' }] });
  assert.equal(catalog[0].idempotent, false); assert.equal(catalog[0].sideEffect, 'local-write');
  assert.equal(catalog[0].timeoutMs, 30000); assert.deepEqual(catalog[0].outputSchema, tool.outputSchema);
});

test('Responses 与 Chat Completions 工具调用经过同一循环，内部事件不改变页面事件', async () => {
  for (const turn of [
    { output: [{ type: 'function_call', call_id: 'call_1', name: capability, arguments: '{"query":"hello"}' }] },
    { tool_calls: [{ id: 'call_1', function: { name: capability, arguments: '{"query":"hello"}' } }] },
  ]) {
    const internal = [], wire = [];
    const result = await runConversationAgent({ entryPoint: 'test', catalog: [tool], toolContext: options().context,
      onEvent: (event) => wire.push(event), onInternalEvent: (event) => internal.push(event),
      modelStep: ({ step, messages }) => {
        if (!step) return turn;
        assert.equal(messages.at(-1).tool_call_id, 'call_1');
        return { type: 'final', assistantReply: 'done', output: {} };
      } });
    assert.equal(result.toolCalls, 1); assert.equal(internal.at(-1).type, 'run.completed');
    assert.equal(wire.at(-1).type, 'done'); assert.equal(wire.at(-1).schemaVersion, undefined);
  }
  assert.throws(() => normalizeModelTurn({ toolCalls: [{ name: capability, arguments: '{' }] }), { code: 'INVALID_TOOL_ARGUMENTS' });
});
