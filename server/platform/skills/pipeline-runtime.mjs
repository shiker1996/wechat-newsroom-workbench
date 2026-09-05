import crypto from 'node:crypto';
import { createGenerationSnapshot } from './registry.mjs';
import { normalizeSkillDefinition } from './runtime-definition.mjs';
import { getToolRegistry } from '../tools/index.mjs';
import { readActiveSkillConfig } from './configuration.mjs';
import { resolveStageModelsSnapshot } from '../llm/stage-model-routing.mjs';
import { runSkill } from '../agent/harness.mjs';

export function bindGenerationSnapshot(gateway, generationSnapshotId) {
  if (!generationSnapshotId) return gateway;
  return new Proxy(gateway, {
    get(target, property, receiver) {
      if (property === 'complete') return (input) => target.complete({ ...input, generationSnapshotId });
      if (property === 'streamComplete') return (input, onDelta, onThinking) => target.streamComplete({ ...input, generationSnapshotId }, onDelta, onThinking);
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * Execute one deterministic Pipeline model call through the Harness.
 *
 * The surrounding Workflow still owns stage ordering and domain validation;
 * this adapter only moves the model invocation and Run lifecycle behind the
 * stage-skill Facade.  The Gateway response is returned unchanged.
 */
export async function runPipelineStage({ gateway, store, batchId = null, candidateId = null, provider = null,
  purpose, skillId = purpose, entryPoint = 'pipeline', stageId = purpose, input = null, messages = [],
  maxOutputTokens, jsonMode = false, thinking = undefined, temperature = undefined, rootRunId = null, workflowRunId = null, parentRunId = null,
  generationSnapshotId = null, signal = null, definition = null, onRunCreated = null }) {
  if (!purpose || typeof gateway?.complete !== 'function') throw new Error('Pipeline stage 缺少 purpose 或 LLM Gateway');
  const stageDefinition = definition || { id: String(skillId), kind: 'stage-skill', entryPoints: [entryPoint] };
  return runSkill({
    skillId: String(skillId), entryPoint, input,
    definition: stageDefinition,
    signal,
    persistRun: true,
    onRunCreated,
    context: {
      store,
      signal,
      provider,
      gateway,
      toolContext: { batchId, candidateId, provider, generationSnapshotId, rootRunId, workflowRunId, stageId, parentRunId },
      executeStage: async ({ agentRunId, signal: stageSignal, context }) => gateway.complete({
        provider, purpose, batchId, candidateId, jsonMode, thinking, temperature, maxOutputTokens, messages,
        agentRunId, agentStep: 0, rootRunId: context.toolContext.rootRunId, workflowRunId: context.toolContext.workflowRunId,
        stageId: context.toolContext.stageId, generationSnapshotId: context.toolContext.generationSnapshotId,
        signal: stageSignal || signal,
      }),
    },
  });
}

/**
 * Wrap a Pipeline Gateway so every `complete` call becomes a persisted
 * stage-skill Run.  Existing Pipeline code can keep its model input shape.
 */
export function bindPipelineHarnessGateway(gateway, options = {}) {
  if (!gateway) return gateway;
  return new Proxy(gateway, {
    get(target, property, receiver) {
      if (property === 'complete') return (input = {}) => {
        const { messages = [], ...modelInput } = input || {};
        const purpose = modelInput.purpose || options.purpose || 'pipeline-stage';
        return runPipelineStage({ ...options, ...modelInput, purpose, messages, gateway: target,
          skillId: modelInput.skillId || purpose, entryPoint: modelInput.entryPoint || options.entryPoint || 'pipeline',
          stageId: modelInput.stageId || purpose, generationSnapshotId: options.generationSnapshotId || modelInput.generationSnapshotId });
      };
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * Bind a short lived HTTP/application operation to a persisted Harness root.
 * One-shot routes use this instead of passing the infrastructure Gateway
 * directly into a business service. Nested complete calls become stage runs
 * and inherit the same root/workflow identifiers.
 */
export function createRequestHarnessGateway({ gateway, store = null, entryPoint = 'http', skillId = entryPoint,
  batchId = null, candidateId = null, provider = null, stageId = entryPoint } = {}) {
  if (!gateway) return { gateway, rootRunId: null, workflowRunId: null, finish: () => {} };
  const rootRunId = `request:${crypto.randomUUID()}`;
  const workflowRunId = rootRunId;
  const persist = typeof store?.startAgentRun === 'function';
  if (persist) {
    store.startAgentRun({ id: rootRunId, entryPoint, skillId, batchId, candidateId,
      provider: provider || gateway.config?.defaultProvider || null,
      rootRunId, workflowRunId, stageId });
    store.appendAgentRunEvent?.(rootRunId, { type: 'run.started', entryPoint, stageId });
    store.saveAgentStep?.({ agentRunId: rootRunId, step: 0, phase: 'request_started', summary: { entryPoint, skillId } });
  }
  const scoped = bindPipelineHarnessGateway(gateway, {
    store, batchId, candidateId, provider, rootRunId, workflowRunId, entryPoint, stageId,
  });
  let finished = false;
  const finish = (status = 'completed', error = null) => {
    if (finished) return;
    finished = true;
    if (!persist) return;
    store.appendAgentRunEvent?.(rootRunId, { type: status === 'completed' ? 'run.completed' : 'run.failed', stageId, ...(error ? { error } : {}) });
    store.saveAgentStep?.({ agentRunId: rootRunId, step: 0, phase: status === 'completed' ? 'request_completed' : 'request_failed', summary: { entryPoint, skillId, ...(error ? { error } : {}) } });
    store.finishAgentRun?.(rootRunId, { status, modelSteps: 0, toolCalls: 0, ...(error ? { error } : {}) });
  };
  return { gateway: scoped, rootRunId, workflowRunId, finish };
}

export async function resolveSkillToolPolicy({ workspaceRoot, skillId, snapshot = null }) {
  const frozenSnapshot=snapshot?.snapshot || snapshot;
  const frozenSkill=frozenSnapshot?.skills?.find((item)=>item.id===skillId);
  const config=frozenSkill?.config || (frozenSnapshot?.skillConfig && frozenSnapshot.skills?.[0]?.id===skillId
    ? frozenSnapshot.skillConfig
    : readActiveSkillConfig(workspaceRoot,skillId));
  const available=(await getToolRegistry()).listCapabilities();
  // 显式空白名单 = 全部禁止（allowedCapabilities 为空数组）；null/无字段 = 全放行
  const allowedCapabilities=Array.isArray(config?.allowedTools) ? [...new Set(config.allowedTools)] : null;
  if(allowedCapabilities){
    const missing=allowedCapabilities.filter((capability)=>!available.some((item)=>item.capability===capability));
    if(missing.length)throw new Error(`技能工具白名单包含不存在的能力：${missing.join('、')}`);
  }
  return {
    skillId,
    config:config || null,
    allowedCapabilities,
    tools:allowedCapabilities===null?available:available.filter((item)=>allowedCapabilities.includes(item.capability)),
  };
}

export async function prepareSkillRun({ gateway, store, batchId, candidateId = null, purpose, bundles, provider, snapshotId = null, selection = null }) {
  const historical=snapshotId?store.getGenerationSnapshot?.(snapshotId):null;
  if(snapshotId&&!historical)throw new Error('指定的 generation snapshot 不存在');
  if(historical&&(historical.batch_id!==batchId||(historical.candidate_row_id??null)!==(candidateId??null)))throw new Error('generation snapshot 不属于当前任务');
  if(historical){
    const frozenById=new Map(historical.snapshot.skills.map((item)=>[item.id,item]));
    bundles=bundles.map((bundle)=>{
      const frozen=frozenById.get(bundle.skillName||bundle.writerSkill);
      // 快照之后才新增的阶段技能（如 article-visual-planner）在历史快照中不存在，
      // 保留当前加载的 bundle 继续执行；只有快照已有的技能才冻结为历史 Prompt
      if(!frozen)return bundle;
      const frozenConfig=frozen.config
        ? {...frozen.config,version:frozen.version,configHash:frozen.configHash}
        : null;
      Object.assign(bundle,{prompt:frozen.prompt,hash:String(frozen.promptHash||'').replace(/^sha256:/,''),config:frozenConfig});
      if(frozen.definition)bundle.definition=structuredClone(frozen.definition);
      return bundle;
    });
    if(bundles[0])bundles[0].config={...(bundles[0].config||{}),...(historical.snapshot.skillConfig||{})};
  }
  // 调用方传入的第一个技能是流程主技能。子技能的 Prompt 覆盖层独立生效，
  // 但不能因为它恰好存在配置就接管整条流程的模型、工具与质量门禁。
  const primary=bundles[0];
  const configuredProvider=primary?.config?.defaultModel;
  const configuredExists=configuredProvider&&gateway.config?.providers?.[configuredProvider];
  const selectedProvider=historical?.snapshot.modelProvider || provider || (configuredExists ? configuredProvider : gateway.config?.defaultProvider);
  const resolved=gateway.config?.providers?.[selectedProvider] || gateway.resolve?.(selectedProvider)?.provider;
  if(!resolved)throw new Error('技能运行时无法解析模型配置');
  if(historical?.snapshot.model&&resolved.model!==historical.snapshot.model){
    throw new Error(`历史模型版本不可用：${selectedProvider}/${historical.snapshot.model}`);
  }
  const available=(await getToolRegistry()).listCapabilities();
  const frozenAllowedTools=historical?.snapshot.skillConfig?.allowedTools;
  const hasFrozenWhitelist=Array.isArray(frozenAllowedTools);
  const hasPrimaryWhitelist=Array.isArray(primary?.config?.allowedTools);
  const allowed=primary?.config?.allowedTools || [];
  // 显式空白名单（含历史快照冻结的空数组）= 全部禁止；null/无字段 = 不过滤工具；
  // 历史快照的冻结工具已在下方逐一校验版本。
  const hasWhitelist=hasFrozenWhitelist||hasPrimaryWhitelist;
  const historicalAuthorization=historical?.snapshot.capabilityAuthorization?.capabilities;
  const tools=historical?.snapshot.tools || (Array.isArray(historicalAuthorization)?available.filter((item)=>historicalAuthorization.includes(item.capability)):(hasWhitelist ? available.filter((item)=>allowed.includes(item.capability)) : available));
  if(historical){
    for(const frozen of tools){
      const strict=historical.snapshot.resolutionPolicy?.strictHistoricalBinding!==false;
      if(strict&&!available.some((item)=>item.capability===frozen.capability&&item.plugin===frozen.plugin&&item.version===frozen.version)){
        throw new Error(`历史工具版本不可用：${frozen.capability}/${frozen.plugin}@${frozen.version}`);
      }
      if(!strict&&!available.some((item)=>item.capability===frozen.capability))throw new Error(`历史能力不可用：${frozen.capability}`);
    }
  }
  if(!historical&&hasWhitelist&&allowed.length!==tools.length)throw new Error('技能工具白名单包含已禁用或不存在的能力');
  for(const bundle of bundles){
    const definition=bundle.definition || normalizeSkillDefinition(bundle.manifest || {}, {id:bundle.skillName || bundle.writerSkill});
    const missing=(definition.requiredCapabilities || []).filter((capability)=>!tools.some((tool)=>tool.capability===capability));
    if(missing.length)throw new Error(`技能 ${definition.id} 缺少必需能力：${missing.join('、')}`);
    bundle.definition=definition;
  }
  const stageModels = historical
    ? (historical.snapshot?.stageModels || {})
    : (gateway.stageModelConfig?.() || {});
  const stageModelsResolved = historical?.snapshot?.stageModelsResolved
    || resolveStageModelsSnapshot({ stageModels, providers: gateway.config?.providers || {} });
  const snapshot=historical?{...historical.snapshot,stageModels:{...stageModels},stageModelsResolved:{...stageModelsResolved},reusedFromSnapshotId:historical.id,createdAt:new Date().toISOString()}:createGenerationSnapshot({
    skillBundles:bundles,tools,provider:selectedProvider,
    model:resolved.model || '',purpose,selection,stageModels,stageModelsResolved,
  });
  snapshot.skillConfig={...(snapshot.skillConfig||{}),defaultModel:primary?.config?.defaultModel||'',allowedTools:hasFrozenWhitelist?[...frozenAllowedTools]:(hasPrimaryWhitelist?[...allowed]:null),
    gates:primary?.config?.gates||null,version:primary?.config?.version||null,configHash:primary?.config?.configHash||''};
  const savedSnapshot=store.saveGenerationSnapshot?.({batchId,candidateId,purpose,snapshot});
  return {provider:selectedProvider,providerConfig:resolved,config:primary?.config||null,tools,
    allowedCapabilities:hasFrozenWhitelist?[...frozenAllowedTools]:(hasPrimaryWhitelist?[...allowed]:null),bundles,snapshotId:savedSnapshot?.id||historical?.id||null};
}
