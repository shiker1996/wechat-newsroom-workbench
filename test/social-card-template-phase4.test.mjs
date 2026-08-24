import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';
import { aggregateSocialTemplateMetrics, summarizeSocialTemplateRun } from '../server/shared/rendering/social-card-template-metrics.mjs';

test('Phase 4 模板指标统计区分模板回退、布局问题和单页成功率', () => {
  const run = summarizeSocialTemplateRun({
    requestedTemplate: { id: 'neon-v1', version: 1, source: 'theme' },
    renderedTemplate: { id: 'standard-v1', version: 1, source: 'fallback' },
    report: { valid: true, pages: [
      { page: 1, issues: [] },
      { page: 2, issues: ['underfilled'] },
      { page: 3, issues: ['overflow'] },
    ] },
    fallback: true,
  });
  assert.equal(run.pageCount, 3);
  assert.equal(run.underfilledPages, 1);
  assert.equal(run.overflowPages, 1);
  assert.equal(run.fallback, true);
  assert.equal(run.fallbackKind, 'automatic-template');
  const stats = aggregateSocialTemplateMetrics([
    run,
    { operation: 'page-regeneration', success: 1 },
    { operation: 'page-regeneration', success: 0 },
  ]);
  assert.equal(stats.usageCount, 1);
  assert.equal(stats.layoutPassRate, 1);
  assert.equal(stats.fallbackRate, 1);
  assert.equal(stats.automaticTemplateFallbackRate, 1);
  assert.equal(stats.resolverFallbackRate, 0);
  assert.equal(stats.underfilledRate, 1 / 3);
  assert.equal(stats.overflowRate, 1 / 3);
  assert.equal(stats.singlePageRegenerationSuccessRate, 0.5);
});

test('Phase 4 social 模板指标落库且不进入文章/封面主题使用统计', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'social-template-metrics-'));
  const store = new Store(path.join(root, 'test.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.recordSocialTemplateMetric({
    operation: 'generation', success: true, requestedTemplate: { id: 'neon-v1', version: 1, source: 'theme' },
    renderedTemplate: { id: 'neon-v1', version: 1, source: 'theme' }, channelMode: 'xiaohongshu', contentType: 'repository',
    pageCount: 6, layoutPass: true, fallback: false, underfilledPages: 1, overflowPages: 0,
  });
  store.recordSocialTemplateMetric({ operation: 'page-regeneration', success: false, requestedTemplate: { id: 'neon-v1', version: 1 }, pageCount: 1 });
  const stats = store.socialTemplateMetricsStats({ templatePackId: 'neon-v1' });
  assert.equal(stats.usageCount, 1);
  assert.equal(stats.usageRate, 1);
  assert.equal(stats.singlePageRegenerationCount, 1);
  assert.equal(stats.singlePageRegenerationSuccessRate, 0);
  assert.equal(stats.automaticTemplateFallbackRate, 0);
  assert.equal(stats.explicitCompatibilityRate, 0);
  assert.equal(store.themeUsageStats('neon-v1').usageCount, 0);
});

test('Phase 4 单页接口显式传入模板上下文并返回逐页模板信息', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'server/platform/http/routes/social-card-routes.mjs'), 'utf8');
  assert.match(source, /targetTemplateContext/);
  assert.match(source, /target_template:targetTemplateContext/);
  assert.match(source, /template:\{\.\.\.templateCompatibility,target:templateCompatibility\.pages/);
  assert.match(source, /recordSocialTemplateMetric/);
});
