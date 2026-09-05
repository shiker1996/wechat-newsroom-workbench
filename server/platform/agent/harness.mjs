import { runConversationAgent } from './conversation-agent.mjs';
import { AgentContractError } from './tool-protocol.mjs';
import { resolveSkillRuntime } from '../skills/resolver.mjs';
export { SKILL_RUN_KINDS } from '../skills/runtime-definition.mjs';
import { SKILL_RUN_KINDS } from '../skills/runtime-definition.mjs';
import { resolveSkillGates } from '../skills/gates.mjs';
import { readAgentSnapshot, prepareAgentRun, bindAgentGateway } from './run-preparation.mjs';


/**
 * @typedef {Object} SkillDefinition
 * @property {string} id
 * @property {'prompt-skill'|'stage-skill'|'agent-skill'} kind
 * @property {string[]} [entryPoints]
 * @property {string} [inputContract]
 * @property {string} [outputContract]
 * @property {string[]} [requiredCapabilities]
 * @property {Object} [budget]
 *
 * @typedef {{allowedCapabilities?: string[]}} RunPolicy
 * @typedef {Partial<typeof import('./contracts.mjs').CONVERSATION_AGENT_BUDGET_DEFAULTS>} RunBudget
 * @typedef {{agentRunId: string, type: string, assistantReply?: string, output?: Object, modelSteps: number, toolCalls: number}} AgentRunResult
 * @typedef {{capability: string, inputSchema: Object, implementations?: Object[]}} ToolDefinition
 *
 * @typedef {Object} AgentRunRequest
 * @property {string} skillId
 * @property {string} entryPoint
 * @property {*} [input]
 * @property {Object} [context] Runtime dependencies; callbacks are never serialized.
 * @property {SkillDefinition} [definition] Resolved definition supplied by the entry/workflow.
 * @property {{allowedCapabilities?: string[]}} [policy] Can only narrow the supplied catalog.
 * @property {Object} [budget]
 * @property {string} [snapshotId] Requires context.resolveSnapshot; never silently uses live config.
 *
 * Agent results and events are returned unchanged. Prompt and stage results retain
 * their Gateway/Workflow contracts. This facade does not invent a second tool loop.
 */

function fail(code, message) { throw new AgentContractError(code, message); }

function validateStringList(value, field) {
  if (value != null && (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item))) {
    fail('INVALID_SKILL_RUN', `${field} 必须是字符串数组`);
  }
}

function scopedCatalog(catalog = [], scopes = []) {
  return Object.freeze(catalog.filter((tool) => scopes.every((scope) => scope.includes(tool.capability))));
}

/** @param {AgentRunRequest} request */
export async function runSkill(request = {}) {
  // Top-level engine options remain accepted during the adapter migration.
  const runtime = { ...request, ...request.context };
  let resumeClaim = null;
  const releaseResume = () => {
    if (!resumeClaim) return;
    runtime.store?.releaseAgentResume?.(resumeClaim.runId, resumeClaim.token);
    resumeClaim = null;
  };
  try {
  if (request.resumeFrom != null) {
    const checkpoint = runtime.store?.getLatestAgentCheckpoint?.(String(request.resumeFrom));
    if (!checkpoint?.state?.resumable) fail('RESUME_NOT_AVAILABLE', '没有可安全恢复的 Agent checkpoint');
    const token = `resume-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    if (!runtime.store?.claimAgentResume?.(String(request.resumeFrom), token, request.resumeLeaseMs)) fail('RESUME_CONFLICT', 'Agent checkpoint 已被其他恢复任务占用');
    resumeClaim = { runId: String(request.resumeFrom), token };
    runtime.resumeState = checkpoint.state;
    runtime.toolContext = {
      ...runtime.toolContext,
      ...(runtime.toolContext?.rootRunId == null && checkpoint.state.rootRunId != null ? { rootRunId: checkpoint.state.rootRunId } : {}),
      ...(runtime.toolContext?.workflowRunId == null && checkpoint.state.workflowRunId != null ? { workflowRunId: checkpoint.state.workflowRunId } : {}),
      ...(runtime.toolContext?.stageId == null && checkpoint.state.stageId != null ? { stageId: checkpoint.state.stageId } : {}),
      ...(runtime.toolContext?.parentRunId == null && checkpoint.state.parentRunId != null ? { parentRunId: checkpoint.state.parentRunId } : {}),
    };
    request = { ...request, snapshotId: request.snapshotId ?? checkpoint.state.generationSnapshotId };
    if (typeof runtime.restoreState === 'function') {
      try { runtime.restoredState = await runtime.restoreState(checkpoint.state); }
      catch (error) { releaseResume(); fail('RUN_STATE_RESTORE_FAILED', `业务状态恢复失败：${error.message}`); }
      if (runtime.restoredState === false) { releaseResume(); fail('RUN_STATE_RESTORE_FAILED', '业务状态恢复回调拒绝当前 checkpoint'); }
    }
  }
  const skillId = request.skillId || runtime.toolContext?.skillId;
  const entryPoint = request.entryPoint || runtime.entryPoint;
  if (typeof skillId !== 'string' || !skillId.trim() || typeof entryPoint !== 'string' || !entryPoint.trim()) fail('INVALID_SKILL_RUN', 'runSkill 必须指定 skillId 和 entryPoint');
  let definition = request.definition || { id: skillId, kind: 'agent-skill' };
  if (!request.definition && request.snapshotId == null && runtime.toolContext?.workspaceRoot) {
    const resolved = resolveSkillRuntime({ workspaceRoot: runtime.toolContext.workspaceRoot, skillId, kind: 'agent-skill' });
    definition = resolved.definition;
    runtime.resolvedSkillBundle = resolved.bundle;
    runtime.skillConfig = resolved.bundle.config || null;
  }
  let frozenRuntime = {};
  let frozenGateBindings = null, historicalSnapshot = null;
  if (request.snapshotId != null) {
    if (typeof runtime.resolveSnapshot !== 'function' && typeof runtime.store?.getGenerationSnapshot !== 'function') fail('SKILL_SNAPSHOT_UNAVAILABLE', '指定 snapshotId 时必须提供快照存储或 resolveSnapshot');
    const snapshot = typeof runtime.resolveSnapshot === 'function' ? await runtime.resolveSnapshot(request.snapshotId)
      : readAgentSnapshot({ store: runtime.store, snapshotId: request.snapshotId, skillId, entryPoint, toolContext: runtime.toolContext });
    if (!snapshot || snapshot.skillId !== skillId || snapshot.entryPoint !== entryPoint) {
      fail('SKILL_SNAPSHOT_MISMATCH', '运行快照不存在或与当前技能、入口不匹配');
    }
    if (!snapshot.definition) fail('SKILL_SNAPSHOT_MISMATCH', '运行快照缺少技能定义');
    definition = snapshot.definition;
    frozenRuntime = structuredClone(snapshot.runtime || {});
    frozenGateBindings = snapshot.gateBindings ?? null;
    historicalSnapshot = snapshot.snapshot ?? null;
  }
  definition = structuredClone(definition);
  if (definition.id !== skillId || !SKILL_RUN_KINDS.includes(definition.kind)) fail('INVALID_SKILL_RUN', '技能 ID 或运行类型不合法');
  validateStringList(definition.entryPoints, 'definition.entryPoints');
  validateStringList(definition.requiredCapabilities, 'definition.requiredCapabilities');
  validateStringList(request.policy?.allowedCapabilities, 'policy.allowedCapabilities');
  validateStringList(request.confirmedCapabilities, 'confirmedCapabilities');
  validateStringList(runtime.toolContext?.allowedCapabilities, 'toolContext.allowedCapabilities');
  validateStringList(frozenRuntime.toolContext?.allowedCapabilities, 'snapshot.allowedCapabilities');
  if (definition.entryPoints?.length && !definition.entryPoints.includes(entryPoint)) fail('SKILL_ENTRY_NOT_ALLOWED', `技能 ${skillId} 不支持入口 ${entryPoint}`);
  const execution = { ...runtime, ...frozenRuntime };
  const scopes = [runtime.catalog?.map((tool) => tool.capability), runtime.toolContext?.allowedCapabilities, request.policy?.allowedCapabilities, frozenRuntime.toolContext?.allowedCapabilities].filter(Array.isArray);
  const catalog = scopedCatalog(execution.catalog, scopes);
  const missing = (definition.requiredCapabilities || []).filter((capability) => !catalog.some((tool) => tool.capability === capability));
  if (missing.length) fail('SKILL_CAPABILITY_MISSING', `技能 ${skillId} 缺少必需能力：${missing.join('、')}`);
  const budget = { ...definition.budget, ...runtime.budget, ...frozenRuntime.budget };
  // A historical snapshot must not replace current resource/path authorization.
  const toolContext = { ...runtime.toolContext, skillId, allowedCapabilities: catalog.map((tool) => tool.capability) };
  if (Array.isArray(request.confirmedCapabilities)) toolContext.confirmedCapabilities = [...new Set(request.confirmedCapabilities)];
  if (request.snapshotId != null) toolContext.generationSnapshotId = request.snapshotId;
  const gates = resolveSkillGates(definition.gates, runtime.gateHandlers, frozenGateBindings);
  const gateContext = { input: request.input, definition, context: { ...execution, catalog, toolContext } };
  await gates.run('input', gateContext);
  if (definition.kind === 'agent-skill') {
    if (typeof execution.modelStep !== 'function') fail('INVALID_SKILL_RUN', 'agent-skill 必须提供 modelStep');
    const prepared = prepareAgentRun({ runtime: execution, skillId, entryPoint, definition, catalog, budget, toolContext,
      gateBindings: gates.bindings, historical: historicalSnapshot, snapshotId: request.snapshotId });
    if (prepared.snapshotId != null) toolContext.generationSnapshotId = prepared.snapshotId;
    try { return await runConversationAgent({ ...execution, entryPoint, catalog, budget, toolContext,
      checkpointing: execution.checkpointing ?? (prepared.snapshotId != null),
      modelStep: (turn) => execution.modelStep({ ...turn, state: runtime.restoredState, gateway: bindAgentGateway(prepared, catalog, turn.signal, { agentRunId: turn.agentRunId, agentStep: turn.step, workflowRunId: turn.workflowRunId || toolContext.workflowRunId, rootRunId: turn.rootRunId || toolContext.rootRunId, stageId: turn.stageId || toolContext.stageId }), generationSnapshotId: prepared.snapshotId }),
      resumeState: runtime.resumeState,
      validateFinal: async (result) => { await gates.run('output', { ...gateContext, result }); await execution.validateFinal?.(result); },
    }); } finally { releaseResume(); }
  }
  if (definition.kind === 'stage-skill') {
    if (typeof runtime.executeStage !== 'function') fail('INVALID_SKILL_RUN', 'stage-skill 必须提供 Workflow 阶段执行函数 executeStage');
    // Pipeline stages use the same persisted Run lifecycle as conversational
    // agents when a Store is available.  The stage output contract remains
    // unchanged; persistence is an implementation detail of the Harness.
    const persist = runtime.persistRun !== false && typeof runtime.store?.startAgentRun === 'function';
    const stageRunId = runtime.agentRunId || `stage-${entryPoint}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const traceContext = {
      rootRunId: toolContext.rootRunId || stageRunId,
      workflowRunId: toolContext.workflowRunId || toolContext.rootRunId || stageRunId,
      stageId: toolContext.stageId || entryPoint,
      parentRunId: toolContext.parentRunId || null,
    };
    if (persist) {
      runtime.store.startAgentRun({ id: stageRunId, entryPoint, skillId, batchId: toolContext.batchId, candidateId: toolContext.candidateId,
        provider: toolContext.provider || execution.provider, allowedCapabilities: catalog.map((tool) => tool.capability),
        generationSnapshotId: request.snapshotId || toolContext.generationSnapshotId, ...traceContext });
      runtime.store.appendAgentRunEvent?.(stageRunId, { type: 'run.started', entryPoint, skillId, stageId: traceContext.stageId });
      runtime.store.saveAgentStep?.({ agentRunId: stageRunId, step: 0, phase: 'stage_started', summary: { entryPoint, skillId } });
      runtime.onRunCreated?.(stageRunId);
    }
    try {
      const result = await runtime.executeStage({ skillId, entryPoint, input: request.input, definition,
        context: { ...execution, catalog, toolContext: { ...toolContext, ...traceContext, agentRunId: stageRunId } },
        budget, snapshotId: request.snapshotId, agentRunId: stageRunId, signal: runtime.signal });
      await gates.run('output', { ...gateContext, result });
      if (persist) {
        runtime.store.saveAgentStep?.({ agentRunId: stageRunId, step: 0, phase: 'stage_completed', summary: { outputType: typeof result } });
        runtime.store.appendAgentRunEvent?.(stageRunId, { type: 'run.completed', stageId: traceContext.stageId });
        runtime.store.finishAgentRun(stageRunId, { status: 'completed', modelSteps: 1, toolCalls: 0 });
      }
      return result;
    } catch (error) {
      if (persist) {
        const cancelled = error?.name === 'AbortError' || runtime.signal?.aborted;
        runtime.store.appendAgentRunEvent?.(stageRunId, { type: cancelled ? 'run.cancelled' : 'run.failed', error: error?.message || String(error), stageId: traceContext.stageId });
        runtime.store.finishAgentRun(stageRunId, { status: cancelled ? 'cancelled' : 'failed', modelSteps: 1, toolCalls: 0, error: error?.message || String(error) });
      }
      throw error;
    }
  }
  if (typeof runtime.gateway?.complete !== 'function') fail('INVALID_SKILL_RUN', 'prompt-skill 必须提供 LLM Gateway');
  if (!Array.isArray(execution.messages)) fail('INVALID_SKILL_RUN', 'prompt-skill 必须提供已解析的 messages');
  const result = await runtime.gateway.complete({ ...execution.modelInput, messages: execution.messages, signal: runtime.signal });
  await gates.run('output', { ...gateContext, result });
  return result;
  } finally {
    releaseResume();
  }
}
