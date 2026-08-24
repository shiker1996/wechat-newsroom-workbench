import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';
import { handleThemeRoutes } from '../server/platform/http/routes/theme-routes.mjs';
import { summarizeSocialTemplateExtensionGate } from '../server/shared/rendering/social-template-extension-gate.mjs';

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-template-phase5-'));
  const store = new Store(path.join(dir, 'workbench.db'));
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return store;
}

test('Phase 5 提案指标计算接受率、门禁通过率和失败角色', (t) => {
  const store = workspace(t);
  store.recordSocialTemplateProposalMetric({ operation: 'generated', proposalId: 'p1', candidateId: 'c1' });
  store.recordSocialTemplateProposalMetric({ operation: 'generated', proposalId: 'p2', candidateId: 'c2' });
  store.recordSocialTemplateProposalMetric({ operation: 'generated', proposalId: 'p3', candidateId: 'c3' });
  store.recordSocialTemplateProposalMetric({ operation: 'compiled', proposalId: 'p1', candidateId: 'c1', auditValid: true, productionEligible: true, failedRoles: ['data'], pageCount: 2 });
  store.recordSocialTemplateProposalMetric({ operation: 'compiled', proposalId: 'p2', candidateId: 'c2', auditValid: true, productionEligible: true, failedRoles: ['data'], pageCount: 2 });
  store.recordSocialTemplateProposalMetric({ operation: 'compiled', proposalId: 'p3', candidateId: 'c3', auditValid: false, productionEligible: false, failedRoles: ['data'], pageCount: 2, underfilledPages: 1 });
  store.recordSocialTemplateProposalMetric({ operation: 'confirmed', proposalId: 'p1', candidateId: 'c1' });
  const stats = store.socialTemplateProposalMetricsStats();
  assert.equal(stats.generatedCount, 3);
  assert.equal(stats.compiledCount, 3);
  assert.equal(stats.confirmedCount, 1);
  assert.equal(stats.acceptanceRate, 1 / 3);
  assert.equal(stats.compilePassRate, 2 / 3);
  assert.equal(stats.failedRoles.data, 3);
  assert.equal(stats.underfilledRate, 1 / 6);
  assert.equal(stats.extensionGate.decision, 'renderer-change-candidate');
});

test('Phase 5 受控扩展门禁在样本不足时不建议新增 renderer', () => {
  const result = summarizeSocialTemplateExtensionGate([
    { operation: 'compiled', failedRoles: ['cover'] },
    { operation: 'compiled', failedRoles: ['cover'] },
  ]);
  assert.equal(result.decision, 'collect-more-evidence');
  assert.equal(result.rendererExtensionEligible, false);
});

test('Phase 5 提案指标 API 只暴露 Social 链路统计', async (t) => {
  const store = workspace(t);
  store.recordSocialTemplateProposalMetric({ operation: 'generated', proposalId: 'social-1', candidateId: 'c1' });
  let result;
  await handleThemeRoutes({ request: { method: 'GET' }, response: {}, pathname: '/api/social/template-proposals/metrics', searchParams: new URLSearchParams(), store, json: (_response, status, data) => { result = { status, data }; } });
  assert.equal(result.status, 200);
  assert.equal(result.data.generatedCount, 1);
  assert.ok(result.data.extensionGate);
  assert.equal(Object.prototype.hasOwnProperty.call(result.data, 'article'), false);
});

test('Phase 5 文档与 API 路由已更新', () => {
  const api = fs.readFileSync(new URL('../API.md', import.meta.url), 'utf8');
  const plan = fs.readFileSync(new URL('../docs/design/social-card-template-authoring-ai-assist-plan.md', import.meta.url), 'utf8');
  assert.match(api, /social\/template-proposals\/metrics/);
  assert.match(plan, /状态：Phase 5 已完成/);
  assert.match(plan, /renderer-change-candidate/);
});
