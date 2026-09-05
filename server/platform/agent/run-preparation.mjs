import { createGenerationSnapshot } from '../skills/registry.mjs';
import { resolveStageModelsSnapshot } from '../llm/stage-model-routing.mjs';
import { buildNativeToolDefinitions } from './tool-catalog.mjs';
import { AgentContractError } from './tool-protocol.mjs';

export function readAgentSnapshot({ store, snapshotId, skillId, entryPoint, toolContext = {} }) {
  const row = store?.getGenerationSnapshot?.(snapshotId);
  const run = row?.snapshot?.harness;
  if (!run || run.schemaVersion !== 1 || run.skillId !== skillId || run.entryPoint !== entryPoint
      || (row.batch_id ?? null) !== (toolContext.batchId ?? null)
      || (row.candidate_row_id ?? null) !== (toolContext.candidateId ?? null)) {
    throw new AgentContractError('SKILL_SNAPSHOT_MISMATCH', 'Agent 快照不存在或不属于当前任务、技能与入口');
  }
  const skill = row.snapshot.skills?.find((item) => item.id === skillId);
  const definition = skill?.definition;
  return { skillId, entryPoint, definition, gateBindings: run.gateBindings,
    runtime: { messages: run.messages, catalog: run.catalog, budget: run.budget, skillConfig: skill?.config || null }, snapshot: row.snapshot };
}

export function prepareAgentRun({ runtime, skillId, entryPoint, definition, catalog, budget, toolContext, gateBindings, historical = null, snapshotId = null }) {
  if (!runtime.gateway) return { gateway: null, snapshotId, snapshot: historical };
  let snapshot = historical;
  if (!snapshot) {
    const provider = toolContext.provider || runtime.gateway.config?.defaultProvider;
    const model = runtime.gateway.config?.providers?.[provider]?.model || '';
    const stageModels = runtime.gateway.stageModelConfig?.() || {};
    // Freeze exactly the assembled prompt/history used by the adapter, not a
    // second reconstruction of its domain prompt. Never persist Gateway config.
    const bundle = { ...runtime.resolvedSkillBundle, skillName: skillId, definition, hash: undefined, config: runtime.resolvedSkillBundle?.config || runtime.skillConfig || null,
      prompt: (runtime.messages || []).filter((item) => item.role === 'system').map((item) => item.content || '').join('\n\n'), files: runtime.resolvedSkillBundle?.files || [] };
    snapshot = createGenerationSnapshot({ skillBundles: [bundle],
      tools: catalog.flatMap((tool) => (tool.implementations || []).map((implementation) => ({ capability: tool.capability, ...implementation }))),
      provider, model, purpose: entryPoint, stageModels,
      stageModelsResolved: resolveStageModelsSnapshot({ stageModels, providers: runtime.gateway.config?.providers || {} }),
    });
    snapshot.harness = structuredClone({ schemaVersion: 1, skillId, entryPoint, messages: runtime.messages || [], catalog, budget, gateBindings });
    snapshot.resolutionPolicy.strictHistoricalBinding = true;
    const saved = runtime.store?.saveGenerationSnapshot?.({ batchId: toolContext.batchId ?? null, candidateId: toolContext.candidateId ?? null, purpose: entryPoint, snapshot });
    snapshotId = saved?.id ?? snapshotId;
  }
  return { gateway: runtime.gateway, snapshotId, snapshot };
}

export function bindAgentGateway(prepared, catalog, signal, traceContext = {}) {
  const { gateway, snapshot, snapshotId } = prepared;
  if (!gateway) return null;
  return new Proxy(gateway, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (['complete', 'streamComplete'].includes(key) && typeof value === 'function') return (input, ...callbacks) => {
        const provider = snapshot?.modelProvider || input.provider;
        if (snapshot?.model && target.config?.providers?.[provider]?.model !== snapshot.model) {
          throw new AgentContractError('SKILL_SNAPSHOT_MISMATCH', `历史模型版本不可用：${provider}/${snapshot.model}`);
        }
        return value.call(target, { ...input, provider, ...(snapshotId != null ? { generationSnapshotId: snapshotId } : {}),
          ...(traceContext.agentRunId != null ? { agentRunId: traceContext.agentRunId } : {}),
          ...(traceContext.agentStep != null ? { agentStep: traceContext.agentStep } : {}),
          ...(traceContext.workflowRunId != null ? { workflowRunId: traceContext.workflowRunId } : {}),
          ...(traceContext.rootRunId != null ? { rootRunId: traceContext.rootRunId } : {}),
          ...(traceContext.stageId != null ? { stageId: traceContext.stageId } : {}),
          ...(input.nativeTools ? { tools: buildNativeToolDefinitions(catalog) } : {}), signal: signal || input.signal }, ...callbacks);
      };
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
