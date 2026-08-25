import test from 'node:test';
import assert from 'node:assert/strict';
import { G_SOCIAL_CLASS_CAPS, G_SOCIAL_THRESHOLDS, G_SOCIAL_WEIGHTS, scoreSocialCandidate, selectSocialCandidates, selectSocialPool } from '../server/features/research/domain/social-scoring.mjs';

const article = (source, time, summary = '已核验来源摘要') => ({ source, time, title: `${source}报道`, url: `https://${source}.example/article`, summary });

test('G_social 使用统一五项权重并输出可审计明细', () => {
  assert.deepEqual(G_SOCIAL_WEIGHTS, { factSupport: 0.25, visualPotential: 0.2, readerValue: 0.2, contentClarity: 0.2, productionReadiness: 0.15 });
  const result = scoreSocialCandidate({
    contentClass: 'news_event', title: '公司发布新的开发者平台', keywords: ['开发者', '平台'], chinaRelevance: 10,
    preScores: { audience: 18 }, confirmedFactCount: 3, timelineCount: 2, sourceCount: 2,
    articles: [article('source-a', '2026-08-24'), article('source-b', '2026-08-25')], riskLevel: '低',
  });
  assert.ok(result.gSocial >= 0 && result.gSocial <= 100);
  assert.equal(result.gSocial, result.socialScoreDetails.finalScore);
  for (const key of Object.keys(G_SOCIAL_WEIGHTS)) assert.ok(Number.isFinite(result.socialScoreDetails[key]));
  assert.equal(result.socialScoreDetails.scoreModel, 'g_social-v1');
});

test('GitHub 项目没有足够资料时只保留候补，不进入可创作候选', () => {
  const item = { contentClass: 'github_project', title: 'Useful open source workflow', keywords: ['开源工具'], chinaRelevance: 4,
    articles: [{ source: 'github:search', title: 'Useful open source workflow', url: 'https://github.com/example/tool' }], riskLevel: '低' };
  const result = scoreSocialCandidate(item);
  assert.ok(result.gSocial < G_SOCIAL_THRESHOLDS.candidate);
  assert.equal(result.qualificationStatus, 'below_threshold');
  assert.equal(selectSocialCandidates([item]).length, 0);
  assert.equal(selectSocialCandidates([item], 10, true)[0].qualificationStatus, 'below_threshold');
});

test('开源技术必须有机制、架构或性能证据', () => {
  const base = { contentClass: 'open_source_technology', title: '一个开源项目说明', keywords: ['开源', '项目'], chinaRelevance: 9,
    preScores: { audience: 17 }, sourceCount: 2, confirmedFactCount: 2,
    articles: [article('docs', '2026-08-24', '介绍功能与使用方式'), article('paper', '2026-08-25', '介绍产品用法')] , riskLevel: '低' };
  const blocked = scoreSocialCandidate(base);
  assert.equal(blocked.qualificationStatus, 'type_gate_blocked');
  const qualified = scoreSocialCandidate({ ...base, classificationEvidence: [{ role: 'technical_mechanism', claim: '采用分层推理架构' }] });
  assert.equal(qualified.contentClass, 'open_source_technology');
  assert.notEqual(qualified.qualificationStatus, 'type_gate_blocked');
  assert.equal(qualified.socialScoreDetails.scoreModel, 'g_social-v1');
});

test('开源趋势必须具备多来源与变化信号', () => {
  const base = { contentClass: 'open_source_trend', title: '开源生态变化', keywords: ['生态'], chinaRelevance: 8,
    preScores: { audience: 16 }, riskLevel: '低', sourceCount: 1, articles: [article('source-a', '2026-08-25')] };
  assert.equal(scoreSocialCandidate(base).qualificationStatus, 'type_gate_blocked');
  const qualified = scoreSocialCandidate({ ...base, sourceCount: 2,
    articles: [article('source-a', '2026-08-20'), article('source-b', '2026-08-25')],
    classificationEvidence: [{ role: 'trend_signal', claim: '多个主体开始采用同一开源标准' }] });
  assert.equal(qualified.contentClass, 'open_source_trend');
  assert.notEqual(qualified.qualificationStatus, 'type_gate_blocked');
});

test('自动图文池限制纯项目集中度', () => {
  const ranking = [
    ...Array.from({ length: 8 }, (_, index) => ({ contentClass: 'github_project', title: `repo-${index}`, autoEligible: true, eligible: true })),
    ...Array.from({ length: 4 }, (_, index) => ({ contentClass: 'news_event', title: `event-${index}`, autoEligible: true, eligible: true })),
  ];
  const selected = selectSocialPool(ranking, 10, G_SOCIAL_CLASS_CAPS);
  assert.equal(selected.length, 10);
  assert.equal(selected.filter((item) => item.contentClass === 'github_project').length, 6);
  assert.equal(selected.filter((item) => item.contentClass === 'news_event').length, 4);
});
