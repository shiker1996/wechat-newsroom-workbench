import crypto from 'node:crypto';

function hash(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value ?? null)).digest('hex');
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return fallback; }
}

function duration(row) {
  if (!row?.started_at || !row?.finished_at) return null;
  return Math.max(0, new Date(row.finished_at).getTime() - new Date(row.started_at).getTime());
}

export function buildRunMetrics(trace = {}) {
  const runs = Array.isArray(trace.runs) ? trace.runs : (trace.run ? [trace.run] : []);
  const modelCalls = Array.isArray(trace.modelCalls) ? trace.modelCalls : [];
  const toolCalls = Array.isArray(trace.toolCalls) ? trace.toolCalls : [];
  const toolExecutions = Array.isArray(trace.toolExecutions) ? trace.toolExecutions : [];
  const events = Array.isArray(trace.events) ? trace.events : [];
  const durations = runs.map(duration).filter(Number.isFinite);
  const sum = (items, key) => items.reduce((total, item) => total + (Number(item[key]) || 0), 0);
  const completed = runs.filter((run) => run.status === 'completed').length;
  const failed = runs.filter((run) => ['failed', 'cancelled', 'aborted'].includes(run.status)).length;
  const retryCount = runs.filter((run) => run.parent_run_id || run.parentRunId || run.retry_of || run.retryOf).length
    + events.filter((item) => /(^|[._-])retry([._-]|$)/i.test(String(item.event?.type || item.type || item.name || ''))).length;
  const gateFailureCount = runs.filter((run) => /gate[._ -]?failed|skill_gate_failed|门禁/i.test(String(run.error || ''))).length
    + events.filter((item) => /gate[._ -]?failed|skill_gate_failed|门禁/i.test(JSON.stringify(item.event || item))).length;
  return {
    schemaVersion: 1,
    runCount: runs.length,
    completedRuns: completed,
    failedRuns: failed,
    successRate: runs.length ? Number((completed / runs.length * 100).toFixed(1)) : 0,
    resumable: Boolean(trace.resumable),
    durationMs: durations.length ? Math.max(...durations) : 0,
    averageRunDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    modelCalls: modelCalls.length,
    modelFailures: modelCalls.filter((call) => call.status !== 'completed').length,
    modelLatencyMs: sum(modelCalls, 'latency_ms'),
    averageModelLatencyMs: modelCalls.length ? Math.round(sum(modelCalls, 'latency_ms') / modelCalls.length) : 0,
    promptTokens: sum(modelCalls, 'prompt_tokens'),
    completionTokens: sum(modelCalls, 'completion_tokens'),
    reasoningTokens: sum(modelCalls, 'reasoning_tokens'),
    toolCalls: toolCalls.length,
    toolFailures: toolCalls.filter((call) => call.status !== 'ok').length,
    toolExecutions: toolExecutions.length,
    toolExecutionFailures: toolExecutions.filter((execution) => execution.status !== 'ok').length,
    retryCount,
    retryRate: runs.length ? Number((retryCount / runs.length * 100).toFixed(1)) : 0,
    gateFailures: gateFailureCount,
    gateFailureRate: runs.length ? Number((gateFailureCount / runs.length * 100).toFixed(1)) : 0,
    stages: [...new Set(runs.map((run) => run.stage_id || run.stageId).filter(Boolean))],
  };
}

export function buildReplayFixture(trace = {}, { snapshots = [] } = {}) {
  const modelResponses = (trace.modelCalls || []).map((call) => ({
    id: call.id,
    agentRunId: call.agent_run_id,
    agentStep: call.agent_step,
    purpose: call.purpose,
    provider: call.provider,
    model: call.model,
    status: call.status,
    output: call.output_text || '',
    reasoning: call.reasoning_text || '',
    toolCalls: parseJson(call.tool_calls_json, []),
    outputHash: hash(call.output_text || ''),
  }));
  const toolResults = (trace.toolExecutions || []).map((execution) => ({
    id: execution.id,
    agentRunId: execution.agent_run_id,
    capability: execution.capability,
    plugin: execution.plugin,
    version: execution.plugin_version,
    status: execution.status,
    sideEffect: execution.side_effect,
    replayPolicy: execution.replay_policy,
    resultSummary: execution.result_summary || null,
    replayable: execution.side_effect === 'none' && execution.replay_policy === 'reuse-result',
  }));
  return {
    schemaVersion: 1,
    rootRunId: trace.rootRunId || trace.run?.root_run_id || trace.run?.rootRunId || null,
    generatedAt: new Date().toISOString(),
    runs: (trace.runs || (trace.run ? [trace.run] : [])).map((run) => ({ id: run.id, entryPoint: run.entry_point || run.entryPoint, skillId: run.skill_id || run.skillId,
      status: run.status, generationSnapshotId: run.generation_snapshot_id || run.generationSnapshotId, rootRunId: run.root_run_id || run.rootRunId,
      workflowRunId: run.workflow_run_id || run.workflowRunId, stageId: run.stage_id || run.stageId })),
    snapshots: snapshots.map((snapshot) => ({ id: snapshot.id, purpose: snapshot.purpose, snapshotHash: hash(snapshot.snapshot), createdAt: snapshot.created_at || snapshot.createdAt })),
    modelResponses,
    toolResults,
    metrics: buildRunMetrics(trace),
    replayableModelCalls: modelResponses.filter((call) => call.status === 'completed').length,
    replayableToolCalls: toolResults.filter((call) => call.replayable).length,
  };
}

export function compareRunTraces(left = {}, right = {}) {
  const leftFixture = buildReplayFixture(left);
  const rightFixture = buildReplayFixture(right);
  const leftOutputs = leftFixture.modelResponses.map((item) => item.outputHash);
  const rightOutputs = rightFixture.modelResponses.map((item) => item.outputHash);
  const sameOutputs = JSON.stringify(leftOutputs) === JSON.stringify(rightOutputs);
  const lm = leftFixture.metrics;
  const rm = rightFixture.metrics;
  return {
    schemaVersion: 1,
    sameOutputs,
    modelCallDelta: rm.modelCalls - lm.modelCalls,
    toolCallDelta: rm.toolCalls - lm.toolCalls,
    durationDeltaMs: rm.durationMs - lm.durationMs,
    successRateDelta: Number((rm.successRate - lm.successRate).toFixed(1)),
    promptTokenDelta: rm.promptTokens - lm.promptTokens,
    completionTokenDelta: rm.completionTokens - lm.completionTokens,
    outputHash: { left: hash(leftOutputs), right: hash(rightOutputs) },
    left: lm,
    right: rm,
  };
}
