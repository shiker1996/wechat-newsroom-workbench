import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('日志页面提供 Run Trace 入口并消费聚合指标', () => {
  const html = read('public/index.html');
  const ui = read('public/src/views/logs.js');
  assert.match(html, /id="run-trace-dialog"/);
  assert.match(ui, /data-open-run-trace/);
  assert.match(ui, /\/api\/runs\/\$\{encoded\}/);
  assert.match(ui, /\/metrics/);
  assert.match(ui, /Workflow \/ Agent Run/);
  assert.doesNotMatch(ui, /Replay 回放快照/);
  assert.doesNotMatch(ui, /data-trace-extra="replay"/);
  assert.doesNotMatch(ui, /对比另一次运行/);
  assert.doesNotMatch(html, /run-trace-tab[^>]*>摘要/);
  assert.match(ui, /CALL TREE/);
  assert.match(ui, /traceWaterfallEntries/);
  assert.match(ui, /applyTraceSegmentFilter/);
  assert.match(ui, /data-trace-segment/);
  assert.match(ui, /data-trace-ref/);
  assert.match(ui, /traceRecordRef\("model"/);
  assert.match(ui, /traceToolEntries/);
  assert.match(ui, /lifecycleCount/);
  assert.match(ui, /const matchingModel/);
  assert.match(ui, /traceDataFingerprint/);
  assert.match(ui, /startTraceAutoRefresh/);
  assert.match(ui, /RUN_TRACE_POLL_INTERVAL_MS/);
  assert.match(ui, /cache: "no-store"/);
  assert.match(ui, /data-run-action="cancel"/);
  assert.match(ui, /newRootRunId/);
  assert.match(ui, /正在打开新的 Run Trace/);
});

test('技能运行历史共享 Run Trace 详情入口', () => {
  const ui = read('public/src/views/skills.js');
  assert.match(ui, /data-open-run-trace/);
  assert.match(ui, /openRunTrace\(button\.dataset\.openRunTrace\)/);
});

test('统一日志查询返回 Run Trace 关联字段', () => {
  const query = read('server/platform/persistence/queries/workbench-query-service.mjs');
  assert.match(query, /root_run_id, workflow_run_id, agent_run_id, stage_id/);
  assert.match(query, /LEFT JOIN agent_runs ar/);
});

test('P1 Run Trace 暴露独立子资源和 Artifact 聚合', () => {
  const routes = read('server/platform/http/routes/system-routes.mjs');
  const runs = read('server/platform/persistence/repositories/agent-run-repository.mjs');
  assert.match(routes, /model-calls\|tool-calls\|artifacts/);
  assert.match(routes, /view === 'artifacts'/);
  assert.match(runs, /const artifacts = artifactWhere.length/);
});

test('日志治理提供可配置留存和立即清理入口', () => {
  const html = read('public/index.html');
  const ui = read('public/src/views/logs.js');
  const routes = read('server/platform/http/routes/system-routes.mjs');
  assert.match(html, /log-governance-model-limit/);
  assert.match(ui, /\/api\/system\/log-governance/);
  assert.match(routes, /pathname === '\/api\/system\/log-governance'/);
});

test('模型调用集中在模型运行页面', () => {
  const html = read('public/index.html');
  const logs = read('public/src/views/logs.js');
  const models = read('public/src/views/models.js');
  const routes = read('server/platform/http/routes/model-routes.mjs');
  assert.match(html, /id="model-call-query"/);
  assert.match(html, /id="model-call-status"/);
  assert.doesNotMatch(html, /data-log-type="model"/);
  assert.match(logs, /filter\(\(item\) => item\.log_type !== "model"\)/);
  assert.match(models, /modelCallDetails/);
  assert.match(models, /model-call-refresh/);
  assert.doesNotMatch(models, /Run Trace/);
  assert.match(routes, /listModelCalls\(150\)/);
});
