import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateArticleFactEligibility } from '../server/features/articles/domain/article-fact-eligibility.mjs';

const verified = (claim = '已核验事实') => ({ claims: [{ claim, status: 'verified' }] });

test('文章事实门禁：纯项目即使有已核验事实也不能直接写文章', () => {
  const result = evaluateArticleFactEligibility({ classification: { contentClass: 'github_project' }, factBase: verified() });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /图文路线/);
});

test('文章事实门禁：新闻事件至少需要一条 verified 事实', () => {
  const blocked = evaluateArticleFactEligibility({ classification: { contentClass: 'news_event' }, factBase: { claims: [{ claim: '待核验', status: 'unverified' }] } });
  assert.equal(blocked.eligible, false);
  assert.match(blocked.reason, /status=verified/);
  const ready = evaluateArticleFactEligibility({ classification: { contentClass: 'news_event' }, factBase: verified('官方已确认') });
  assert.equal(ready.eligible, true);
});

test('文章事实门禁：开源技术必须有机制、架构或性能证据', () => {
  const blocked = evaluateArticleFactEligibility({ classification: { contentClass: 'open_source_technology' }, factBase: verified() });
  assert.equal(blocked.eligible, false);
  assert.match(blocked.reason, /技术机制/);
  const ready = evaluateArticleFactEligibility({
    classification: { contentClass: 'open_source_technology', features: { hasTechnicalDocs: true } },
    factBase: verified('架构文档说明了推理路径'),
  });
  assert.equal(ready.eligible, true);
});

test('文章事实门禁：开源趋势必须有跨来源、跨主体或生态变化证据', () => {
  const blocked = evaluateArticleFactEligibility({ classification: { contentClass: 'open_source_trend' }, factBase: verified() });
  assert.equal(blocked.eligible, false);
  assert.match(blocked.reason, /多来源/);
  const ready = evaluateArticleFactEligibility({
    classification: { contentClass: 'open_source_trend', features: { independentSourceCount: 2 } },
    factBase: verified('两个独立来源均观察到迁移'),
  });
  assert.equal(ready.eligible, true);
});
