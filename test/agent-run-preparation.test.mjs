import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';
import { runSkill } from '../server/platform/agent/harness.mjs';
import { ToolRegistry } from '../server/platform/tools/registry.mjs';
import { executeBrokerTool } from '../server/platform/agent/tool-broker.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-preparation-'));
  const filename = path.join(root, 'test.db');
  let store = new Store(filename);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { get store() { return store; }, reopen() { store.close(); store = new Store(filename); return store; } };
}
const definition = { id: 'demo', kind: 'agent-skill', gates: ['assistant-reply'], requiredCapabilities: [] };
function gateway() {
  return { config: { defaultProvider: 'mock', providers: { mock: { model: 'model-1', apiKey: 'credential-must-not-persist' } } },
    async complete(input) { return { nativeTools: true, content: input.messages[0].content }; } };
}
function request(store, extra = {}) {
  return { skillId: 'demo', entryPoint: 'test', definition, store, gateway: gateway(), catalog: [],
    messages: [{ role: 'user', content: 'frozen input' }],
    modelStep: ({ gateway: model, messages }) => model.complete({ messages, nativeTools: true, tools: [{ name: 'not-authorized' }] }), ...extra };
}

test('统一准备绑定模型快照，Run/Step/Event/Checkpoint 可跨连接查询', async (t) => {
  const f = fixture(t), seen = [];
  const model = gateway(); model.complete = async (input) => { seen.push(input); return { nativeTools: true, content: '完成' }; };
  const result = await runSkill(request(f.store, { gateway: model }));
  const row = f.store.getAgentRun(result.agentRunId);
  assert.equal(row.generation_snapshot_id, seen[0].generationSnapshotId);
  assert.ok(row.generation_snapshot_id); assert.deepEqual(seen[0].tools, []);
  const snapshot = f.store.getGenerationSnapshot(row.generation_snapshot_id).snapshot;
  assert.equal(snapshot.harness.messages[0].content, 'frozen input');
  assert.deepEqual(snapshot.harness.gateBindings, [{ name: 'assistant-reply', version: '1', phase: 'output' }]);
  assert.equal(JSON.stringify(snapshot).includes('credential-must-not-persist'), false);
  f.reopen();
  assert.equal(f.store.getAgentRun(result.agentRunId).status, 'completed');
  assert.deepEqual(f.store.listAgentSteps(result.agentRunId).map((step) => step.phase), ['model_completed', 'completed']);
  const events = f.store.listAgentRunEvents(result.agentRunId);
  assert.equal(events.at(-1).event.type, 'run.completed');
  assert.deepEqual(f.store.listAgentRunEvents(result.agentRunId, { afterSequence: events.at(-1).sequence }), []);
  const checkpoint = f.store.getLatestAgentCheckpoint(result.agentRunId).state;
  assert.equal(checkpoint.phase, 'completed'); assert.equal(checkpoint.result.assistantReply, '完成');
  assert.equal(checkpoint.resumable, false);
});

test('读取历史 Agent 快照恢复输入、拒绝任务错配及模型版本漂移', async (t) => {
  const f = fixture(t);
  const first = await runSkill(request(f.store));
  const snapshotId = f.store.getAgentRun(first.agentRunId).generation_snapshot_id;
  const restored = await runSkill(request(f.store, { snapshotId, messages: [{ role: 'user', content: 'live input' }] }));
  assert.equal(restored.assistantReply, 'frozen input');
  assert.notEqual(restored.agentRunId, first.agentRunId); // Snapshot reuse is a new run, not checkpoint resume.
  await assert.rejects(runSkill(request(f.store, { snapshotId, toolContext: { batchId: 'another-task' } })), { code: 'SKILL_SNAPSHOT_MISMATCH' });
  const changed = gateway(); changed.config.providers.mock.model = 'model-2';
  await assert.rejects(runSkill(request(f.store, { snapshotId, gateway: changed })), { code: 'SKILL_SNAPSHOT_MISMATCH' });
});

for (const mode of ['legacy', 'text', 'finish']) {
  test(`输出门禁拒绝 ${mode} 结果时不会先保存 completed 或发送 done`, async (t) => {
    const f = fixture(t), events = [];
    const capability = 'cap_agent_conversation_finish';
    const req = request(f.store, { definition: { ...definition, gates: ['domain-ready'] },
      gateHandlers: { 'domain-ready': { version: '1', phase: 'output', check: () => ({ ok: false, message: '领域门禁失败' }) } },
      catalog: mode === 'finish' ? [{ capability }] : [],
      toolContext: { toolHandlers: { [capability]: () => ({ status: 'ok', data: { assistantReply: '完成' } }) } },
      onEvent: (event) => events.push(event),
      modelStep: () => mode === 'legacy' ? { type: 'final', assistantReply: '完成' } : mode === 'text' ? { nativeTools: true, content: '完成' }
        : { nativeTools: true, toolCalls: [{ id: 'finish', name: capability, input: {} }] },
    });
    await assert.rejects(runSkill(req), { code: 'SKILL_GATE_FAILED' });
    assert.equal(events.some((event) => event.type === 'done'), false);
    assert.equal(events.at(-1).type, 'error');
    assert.equal(f.store.listAgentRuns()[0].status, 'failed');
    assert.equal(f.store.listAgentRuns()[0].model_steps, 1);
  });
}

test('缺失门禁在模型执行前失败，历史门禁版本变更不能静默替代', async (t) => {
  const f = fixture(t);
  await assert.rejects(runSkill(request(f.store, { definition: { ...definition, gates: ['missing'] } })), { code: 'SKILL_GATE_UNAVAILABLE' });
  assert.equal(f.store.listAgentRuns().length, 0);
  const original = await runSkill(request(f.store));
  const snapshotId = f.store.getAgentRun(original.agentRunId).generation_snapshot_id;
  await assert.rejects(runSkill(request(f.store, { snapshotId,
    gateHandlers: { 'assistant-reply': { version: '2', phase: 'output', check: () => true } },
  })), { code: 'SKILL_SNAPSHOT_MISMATCH' });
  const gateDefinition = { ...definition, gates: ['configured-gate'] };
  const gateHandlers = { 'configured-gate': { version: '1', phase: 'input', check: ({ context }) => context.skillConfig?.mode === 'frozen' } };
  const configured = await runSkill(request(f.store, { definition: gateDefinition, gateHandlers, skillConfig: { mode: 'frozen' } }));
  const configuredSnapshot = f.store.getAgentRun(configured.agentRunId).generation_snapshot_id;
  await runSkill(request(f.store, { snapshotId: configuredSnapshot, gateHandlers, skillConfig: { mode: 'live' } }));
});

test('v37 数据库迁移保留已有 Run，可重复打开', (t) => {
  const f = fixture(t);
  f.store.startAgentRun({ id: 'existing', entryPoint: 'test' });
  f.store.db.exec(`DROP TABLE agent_run_events; DROP TABLE agent_steps; DROP TABLE agent_checkpoints;
    ALTER TABLE agent_runs DROP COLUMN generation_snapshot_id;
    DELETE FROM schema_migrations WHERE version=38;`);
  f.reopen();
  assert.equal(f.store.getAgentRun('existing').status, 'running');
  assert.equal(f.store.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 43);
  f.store.appendAgentRunEvent('existing', { type: 'run.failed' });
  f.reopen();
  assert.equal(f.store.listAgentRunEvents('existing')[0].event.type, 'run.failed');
});

test('冻结的工具目录不执行后来替换的插件版本', async () => {
  let called = false;
  const registry = new ToolRegistry();
  registry.register({ manifest: { id: 'reader', version: '2.0.0', capabilities: ['cap_test_read'], riskLevel: 'read-only' },
    adapter: { execute: () => { called = true; return { status: 'ok', data: {} }; } } });
  const result = await executeBrokerTool({ requestId: 'tr_frozen', capability: 'cap_test_read', arguments: {} }, {
    registry, catalog: [{ capability: 'cap_test_read', implementations: [{ plugin: 'reader', version: '1.0.0' }] }],
  });
  assert.equal(result.error.code, 'TOOL_DEPENDENCY_MISSING');
  assert.equal(called, false);
});

test('可恢复 checkpoint 原子占用并从下一模型步骤继续，重复恢复被拒绝', async (t) => {
  const f = fixture(t), capability = 'cap_resume_read';
  const tool = { capability, inputSchema: { type: 'object', properties: { query: { type: 'string' } } }, outputSchema: { type: 'object' } };
  const registry = { execute: async () => ({ status: 'ok', data: { text: '恢复资料' }, artifacts: [], warnings: [], provenance: {} }) };
  await assert.rejects(runSkill({ skillId: 'demo', entryPoint: 'test', definition, store: f.store,
    gateway: gateway(), registry, catalog: [tool], messages: [{ role: 'user', content: 'resume' }], budget: { maxModelSteps: 2 },
    modelStep: ({ step }) => step === 0 ? ({ type: 'tool_requests', requests: [{ requestId: 'tr_resume', capability, arguments: { query: 'q' }, reason: '读取' }] }) : (() => { throw Object.assign(new Error('模拟中断'), { code: 'AGENT_ABORTED' }); })(),
  }), { code: 'AGENT_ABORTED' });
  const first = f.store.listAgentRuns()[0];
  const checkpoint = f.store.getLatestAgentCheckpoint(first.id);
  assert.equal(checkpoint.state.resumable, true); assert.equal(checkpoint.state.nextStep, 1);
  assert.equal(f.store.claimAgentResume(first.id, 'other-claim', 60000), true);
  await assert.rejects(runSkill({ skillId: 'demo', entryPoint: 'test', definition, store: f.store, resumeFrom: first.id, modelStep: () => ({ type: 'final', assistantReply: 'done' }) }), { code: 'RESUME_CONFLICT' });
  assert.equal(f.store.releaseAgentResume(first.id, 'other-claim'), true);
  const resumed = await runSkill({ skillId: 'demo', entryPoint: 'test', definition, store: f.store, resumeFrom: first.id,
    gateway: gateway(), registry, catalog: [tool], modelStep: ({ step, messages }) => { assert.equal(step, 1); assert.match(messages.at(-1).content, /恢复资料/); return { type: 'final', assistantReply: '已恢复' }; },
  });
  assert.equal(resumed.assistantReply, '已恢复'); assert.notEqual(resumed.agentRunId, first.agentRunId);
  assert.equal(f.store.getAgentRun(resumed.agentRunId).status, 'completed');
});

test('等待确认的 checkpoint 可安全恢复，确认能力只对指定工具生效', async (t) => {
  const f = fixture(t), capability = 'cap_resume_write';
  const tool = { capability, riskLevel: 'external-write', inputSchema: { type: 'object' }, outputSchema: { type: 'object' } };
  const registry = { execute: async () => ({ status: 'ok', data: { written: true }, artifacts: [], warnings: [], provenance: {} }) };
  await assert.rejects(runSkill({ skillId: 'demo', entryPoint: 'test', definition, store: f.store, gateway: gateway(), registry, catalog: [tool], budget: { maxModelSteps: 2 },
    modelStep: ({ step }) => step === 0 ? ({ type: 'tool_requests', requests: [{ requestId: 'tr_confirm', capability, arguments: {}, reason: '写入' }] }) : (() => { throw Object.assign(new Error('中断'), { code: 'AGENT_ABORTED' }); })(),
  }), { code: 'AGENT_ABORTED' });
  const first = f.store.listAgentRuns()[0];
  const pending = f.store.getLatestAgentCheckpoint(first.id);
  assert.equal(pending.state.phase, 'waiting_confirmation'); assert.equal(pending.state.resumable, true);
  const resumed = await runSkill({ skillId: 'demo', entryPoint: 'test', definition, store: f.store, resumeFrom: first.id, confirmedCapabilities: [capability], gateway: gateway(), registry, catalog: [tool],
    modelStep: ({ step }) => { assert.equal(step, 1); return { type: 'final', assistantReply: '已确认写入' }; },
  });
  assert.equal(resumed.assistantReply, '已确认写入');
});

test('恢复前调用业务状态重建，失败会释放租约并拒绝运行', async (t) => {
  const f = fixture(t);
  // Build a resumable checkpoint using the common fixture, then verify callback visibility.
  const capability = 'cap_restore_read', tool = { capability, inputSchema: { type: 'object' }, outputSchema: { type: 'object' } };
  await assert.rejects(runSkill({ skillId: 'demo', entryPoint: 'test', definition, store: f.store, gateway: gateway(), registry: { execute: async () => ({ status: 'ok', data: {} }) }, catalog: [tool], budget: { maxModelSteps: 2 },
    modelStep: ({ step }) => step === 0 ? ({ type: 'tool_requests', requests: [{ requestId: 'tr_restore', capability, arguments: {}, reason: '读取' }] }) : (() => { throw Object.assign(new Error('中断'), { code: 'AGENT_ABORTED' }); })(),
  }), { code: 'AGENT_ABORTED' });
  const first = f.store.listAgentRuns()[0]; let seenState;
  await assert.rejects(runSkill({ skillId: 'demo', entryPoint: 'test', definition, store: f.store, resumeFrom: first.id, restoreState: (state) => { seenState = state; return false; }, gateway: gateway(), catalog: [tool], modelStep: () => ({ type: 'final', assistantReply: 'no' }) }), { code: 'RUN_STATE_RESTORE_FAILED' });
  assert.equal(seenState.phase, 'tools_completed');
  assert.equal(f.store.claimAgentResume(first.id, 'after-release', 1000), true);
  f.store.releaseAgentResume(first.id, 'after-release');
});
