import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReplayFixture, buildRunMetrics, compareRunTraces } from '../server/platform/agent/replay.mjs';

function trace(status = 'completed', output = '完成') {
  return { rootRunId: 'root-1', runs: [{ id: 'run-1', entry_point: 'pipeline', skill_id: 'writer', status, stage_id: 'draft', started_at: '2026-01-01T00:00:00.000Z', finished_at: '2026-01-01T00:00:02.000Z' }],
    modelCalls: [{ id: 1, agent_run_id: 'run-1', purpose: 'draft', provider: 'mock', model: 'mock-1', status: 'completed', output_text: output, prompt_tokens: 10, completion_tokens: 5, reasoning_tokens: 1, latency_ms: 200 }],
    toolCalls: [{ id: 'tool-1', agent_run_id: 'run-1', capability: 'search', status: 'ok' }],
    toolExecutions: [{ id: 1, agent_run_id: 'run-1', capability: 'search', plugin: 'mock', plugin_version: '1', status: 'ok', side_effect: 'none', replay_policy: 'reuse-result' }], resumable: false };
}

test('Phase 6 Run Trace metrics 汇总运行、模型和工具质量指标', () => {
  const metrics = buildRunMetrics(trace());
  assert.equal(metrics.runCount, 1); assert.equal(metrics.successRate, 100); assert.equal(metrics.durationMs, 2000);
  assert.equal(metrics.modelCalls, 1); assert.equal(metrics.promptTokens, 10); assert.equal(metrics.toolExecutions, 1);
  assert.equal(metrics.retryRate, 0); assert.equal(metrics.gateFailureRate, 0);
});

test('Phase 6 metrics 汇总重试和门禁失败信号', () => {
  const metrics = buildRunMetrics({ runs: [{ id: 'root', status: 'failed', error: 'SKILL_GATE_FAILED' },
    { id: 'retry', status: 'completed', parent_run_id: 'root' }], events: [{ event: { type: 'run.retry' } }] });
  assert.equal(metrics.retryCount, 2); assert.equal(metrics.retryRate, 100); assert.equal(metrics.gateFailures, 1); assert.equal(metrics.gateFailureRate, 50);
});

test('Phase 6 replay fixture 固定模型响应并标记安全可重放工具', () => {
  const fixture = buildReplayFixture(trace());
  assert.equal(fixture.schemaVersion, 1); assert.equal(fixture.modelResponses[0].output, '完成');
  assert.equal(fixture.modelResponses[0].outputHash.length, 64); assert.equal(fixture.toolResults[0].replayable, true);
});

test('Phase 6 运行对比输出版本无关的 hash 和质量差异', () => {
  const comparison = compareRunTraces(trace(), trace('failed', '失败'));
  assert.equal(comparison.sameOutputs, false); assert.equal(comparison.successRateDelta, -100); assert.equal(comparison.modelCallDelta, 0);
});
