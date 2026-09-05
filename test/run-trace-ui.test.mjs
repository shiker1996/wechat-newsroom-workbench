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
  assert.match(ui, /data-trace-extra="replay"/);
  assert.match(ui, /\/api\/runs\/compare/);
  assert.match(ui, /data-run-action="cancel"/);
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
