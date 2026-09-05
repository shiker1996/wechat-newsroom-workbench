import { toolError, toolSuccess } from './tool-protocol.mjs';
import { validateInput } from '../tools/schemas.mjs';
import { enforcePolicy } from '../tools/policy.mjs';
import { createExecutionRecord, createStoreExecutionLogger } from '../tools/execution-log.mjs';
import { toolRuntimeMetadata } from './tool-definition.mjs';
import { toolCallFingerprint } from './context.mjs';

const ERROR_MAP = { DEPENDENCY_MISSING:'TOOL_DEPENDENCY_MISSING', PERMISSION_DENIED:'TOOL_PERMISSION_DENIED', PATH_OUTSIDE_ALLOWED_ROOTS:'RESOURCE_NOT_ALLOWED', INVALID_INPUT:'INVALID_TOOL_ARGUMENTS', TIMEOUT:'TOOL_TIMEOUT', OUTPUT_INVALID:'TOOL_OUTPUT_INVALID', FIRST_RUN_CONFIRM_REQUIRED:'TOOL_CONFIRMATION_REQUIRED' };
function normalizeError(request, error) {
  const code = ERROR_MAP[error?.code] || (['AGENT_ABORTED','RESOURCE_NOT_ALLOWED'].includes(error?.code) ? error.code : 'TOOL_EXECUTION_FAILED');
  return toolError(request, code, error?.message || '工具执行失败', Boolean(error?.retryable));
}

async function bounded(operation, timeoutMs, signal) {
  const controller = new AbortController();
  let timer, abort;
  try {
    return await new Promise((resolve, reject) => {
      const stop = (code, message) => { controller.abort(); reject(Object.assign(new Error(message), { code })); };
      abort = () => stop('AGENT_ABORTED', 'Agent 已取消');
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => stop('TIMEOUT', `工具执行超过 ${timeoutMs}ms`), timeoutMs);
      Promise.resolve().then(() => operation(controller.signal)).then(resolve, reject);
    });
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function executeBrokerTool(request, { registry, catalog, context = {}, resolveArguments = (value) => value, cacheLookup = null, onEvent = () => {} } = {}) {
  const tool = catalog?.find((item) => item.capability === request.capability);
  if (!tool || (Array.isArray(context.allowedCapabilities) && !context.allowedCapabilities.includes(request.capability))) {
    return toolError(request, 'CAPABILITY_NOT_VISIBLE', `当前对话未授权能力：${request.capability}`, false);
  }
  const metadata = toolRuntimeMetadata(tool);
  const confirmed = Array.isArray(context.confirmedCapabilities) && context.confirmedCapabilities.includes(request.capability);
  const startedAt = new Date().toISOString();
  const executionLog = context.executionLog || createStoreExecutionLogger(context.store, context);
  const handler = context.toolHandlers?.[request.capability];
  let args = request.arguments, registryStarted = false, cached = false, closed = false;
  const finish = (result) => {
    closed = true;
    // Registry owns per-attempt/fallback logs; Broker owns handler/cache/preflight logs.
    if (!registryStarted || ['TOOL_TIMEOUT','AGENT_ABORTED'].includes(result.error?.code)) executionLog?.(createExecutionRecord({ capability: request.capability,
      plugin: cached ? 'agent-cache' : tool.implementations?.[0]?.plugin || 'agent-application',
      version: tool.implementations?.[0]?.version || null, input: args, result,
      startedAt, finishedAt: new Date().toISOString(), consumerId: context.skillId || null,
      agentRunId: context.agentRunId || null, agentToolCallId: context.agentToolCallId || null,
      workflowRunId: context.workflowRunId || null, rootRunId: context.rootRunId || null, stageId: context.stageId || null,
      sideEffect: metadata.sideEffect, replayPolicy: metadata.replayPolicy }));
    return result;
  };
  try {
    const result = await bounded(async (signal) => {
      if (metadata.requiresConfirmation && !confirmed) {
        onEvent('tool.needs_confirmation', { requestId: request.requestId, capability: request.capability });
        return toolError(request, 'TOOL_CONFIRMATION_REQUIRED', '此工具需要明确确认，当前会话不执行该写入', false);
      }
      // Validate model-facing schema before resource IDs are replaced with real paths.
      const invalid = validateInput(tool.inputSchema || {}, args);
      if (invalid) return toolError(request, 'INVALID_TOOL_ARGUMENTS', invalid, false);
      try { args = await resolveArguments(args, request); }
      catch (error) { return toolError(request, error.code === 'RESOURCE_NOT_ALLOWED' ? error.code : 'INVALID_TOOL_ARGUMENTS', error.message, false); }
      if (signal.aborted) throw Object.assign(new Error('工具已取消'), { code: 'AGENT_ABORTED' });
      const denied = enforcePolicy({ ...metadata, capabilities: [request.capability] }, args, { ...context, authorizedExternalWrite: confirmed });
      if (denied) return normalizeError(request, denied);
      onEvent('tool.running', { requestId: request.requestId, capability: request.capability });
      let raw;
      const implementation = tool.implementations?.[0] || {};
      const reusableIdempotent = metadata.idempotent && metadata.replayPolicy === 'reuse-result';
      // Resource aliases such as project:current are local to a run. Include the
      // resolved arguments and run identity; never reuse old global alias keys.
      const scopedKey = context.idempotencyKey && context.agentRunId
        ? JSON.stringify(['run-v2', context.agentRunId, context.idempotencyKey, toolCallFingerprint({ ...request, arguments: args })])
        : null;
      if (reusableIdempotent && scopedKey && context.store?.getAgentIdempotentResult) {
        const saved = context.store.getAgentIdempotentResult({ key: scopedKey, capability: request.capability, plugin: implementation.plugin, version: implementation.version });
        if (saved?.result?.status === 'ok') { raw = saved.result; cached = true; }
      }
      if (typeof cacheLookup === 'function' && metadata.sideEffect === 'none') {
        if (!raw) { try { raw = await cacheLookup(request, args); } catch { raw = null; } }
        cached = cached || raw?.status === 'ok';
        if (!cached) raw = null;
      }
      if (signal.aborted) throw Object.assign(new Error('工具已取消'), { code: 'AGENT_ABORTED' });
      if (!raw) {
        const executionContext = { ...context, signal, executionLog: (record) => { if (!closed) executionLog?.(record); }, authorizedExternalWrite: confirmed, request };
        if (tool.implementations?.length) executionContext.implementationScope = {
          ...context.implementationScope, [request.capability]: tool.implementations.map(({ plugin, version }) => ({ plugin, version })),
        };
        if (typeof handler === 'function') raw = await handler(args, executionContext);
        else {
          if (typeof registry?.execute !== 'function') return toolError(request, 'TOOL_DEPENDENCY_MISSING', '缺少工具注册表', false);
          registryStarted = true;
          raw = await registry.execute(request.capability, args, executionContext);
        }
      }
      if (raw?.status !== 'ok') return raw?.status === 'error' ? normalizeError(request, raw.error) : toolError(request, 'TOOL_OUTPUT_INVALID', '工具未返回标准状态', false);
      const outputInvalid = validateInput(tool.outputSchema || { type: 'object' }, raw.data);
      if (outputInvalid) return toolError(request, 'TOOL_OUTPUT_INVALID', outputInvalid, false);
      if (!cached && reusableIdempotent && scopedKey && context.store?.saveAgentIdempotentResult) context.store.saveAgentIdempotentResult({ key: scopedKey, capability: request.capability, plugin: implementation.plugin || raw.provenance?.plugin, version: implementation.version, result: raw });
      return toolSuccess(request, { ...raw, provenance: {
        plugin: raw.provenance?.plugin || raw.provenance?.provider || (cached ? 'agent-cache' : tool.implementations?.[0]?.plugin || 'agent-application'),
        version: tool.implementations?.[0]?.version || null, ...raw.provenance,
      } });
    }, Math.min(metadata.timeoutMs, Number(context.timeoutMs) > 0 ? Number(context.timeoutMs) : metadata.timeoutMs), context.signal);
    return finish(result);
  } catch (error) { return finish(normalizeError(request, error)); }
}
