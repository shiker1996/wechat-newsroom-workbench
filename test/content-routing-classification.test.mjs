import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveClassificationFeatures, normalizeEventClassification } from '../server/features/research/domain/content-routing.mjs';

function event(title, articles, extra = {}) {
  return { event_id: 'S-TEST', representative_title: title, keywords: [], articles, ...extra };
}

test('阶段一分类：GitHub 单项目自动归为项目图文', () => {
  const current = event('某开源项目发布新版本', [{ hotspot_id: 1, title: 'GitHub repository release', source: 'github', url: 'https://github.com/acme/demo', time: '2026-08-25' }]);
  const result = normalizeEventClassification({}, { event: current });
  assert.equal(result.contentClass, 'github_project');
  assert.equal(result.status, 'auto');
  assert.equal(result.articleEligible, false);
  assert.equal(result.defaultRoute, 'social_cards');
});

test('阶段一分类：技术机制证据允许开源技术获得文章资格', () => {
  const current = event('开源推理框架的架构与性能', [
    { hotspot_id: 1, title: '项目仓库', source: 'github', url: 'https://github.com/acme/infer', time: '2026-08-25' },
    { hotspot_id: 2, title: '官方架构文档与 benchmark', source: '官方文档', url: 'https://docs.example.com/architecture', time: '2026-08-25' },
  ]);
  const features = deriveClassificationFeatures(current);
  const result = normalizeEventClassification({ content_class: 'open_source_technology', confidence: 0.88, reason: '有架构与性能证据', evidence: [
    { source_id: 'hotspot:2', role: 'technical_mechanism', claim: '官方架构文档' },
  ] }, { event: current, features });
  assert.equal(result.contentClass, 'open_source_technology');
  assert.equal(result.status, 'model_validated');
  assert.equal(result.articleEligible, true);
  assert.equal(result.evidence[0].sourceId, 'hotspot:2');
});

test('阶段一分类：趋势缺少多来源或多主体时保留待复核状态', () => {
  const current = event('一个项目的生态趋势', [{ hotspot_id: 1, title: '项目趋势', source: '媒体', url: 'https://example.com/trend', time: '2026-08-25' }]);
  const result = normalizeEventClassification({ content_class: 'open_source_trend', confidence: 0.9, evidence: [] }, { event: current });
  assert.equal(result.contentClass, 'open_source_trend');
  assert.equal(result.status, 'needs_review');
  assert.equal(result.articleEligible, true);
  assert.ok(result.missingEvidence.length > 0);
});

test('待复核的普通新闻仍可进入文章路线', () => {
  const current = event('公司回应产品争议', [{ hotspot_id: 1, title: '公司回应', source: '媒体', url: 'https://example.com/news', time: '2026-08-25' }]);
  const result = normalizeEventClassification({}, { event: current });
  assert.equal(result.contentClass, 'news_event');
  assert.equal(result.status, 'needs_review');
  assert.equal(result.articleEligible, true);
  assert.equal(result.defaultRoute, 'article');
});

test('单条 GitHub Search 项目即使声称有技术机制也降为纯项目', () => {
  const current = event('FareedKhan-dev/kimi-k3-in-c 发布 Kimi K3 CPU 推理实现', [{
    hotspot_id: 1,
    title: 'FareedKhan-dev/kimi-k3-in-c',
    source: 'GitHub Search · 最近 7 天',
    url: 'https://github.com/FareedKhan-dev/kimi-k3-in-c',
    summary: 'Portable C99 implementation with memory optimization and single CPU inference.',
    time: '2026-08-25',
  }]);
  const result = normalizeEventClassification({
    content_class: 'open_source_technology',
    confidence: 0.85,
    evidence: [{ source_id: 'hotspot:1', role: 'technical_mechanism', claim: 'Portable C99 implementation' }],
  }, { event: current });
  assert.equal(result.contentClass, 'github_project');
  assert.equal(result.status, 'auto');
  assert.equal(result.articleEligible, false);
  assert.equal(result.defaultRoute, 'social_cards');
});

test('单条 GitHub Search 项目即使自述开放标准也不能升级为开源趋势', () => {
  const current = event('某项目实现开放协议', [{
    hotspot_id: 1,
    title: 'acme/protocol-tool',
    source: 'GitHub Search · 最近 7 天',
    url: 'https://github.com/acme/protocol-tool',
    summary: 'Self-hosted implementation of an open standard with compatibility and adoption signals.',
    time: '2026-08-25',
  }]);
  const result = normalizeEventClassification({ content_class: 'open_source_trend', confidence: 0.9 }, { event: current });
  assert.equal(result.contentClass, 'github_project');
  assert.equal(result.articleEligible, false);
  assert.equal(result.defaultRoute, 'social_cards');
});
