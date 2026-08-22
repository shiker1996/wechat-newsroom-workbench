import test from 'node:test';
import assert from 'node:assert/strict';
import { socialCardPageBudget, socialCardPageBudgetMessage, socialCardPageBudgetStatus } from '../lib/rendering/social-card-page-budget.mjs';

test('Social 页数预算区分推荐值和绝对安全上限', () => {
  assert.deepEqual(socialCardPageBudget('repository'), { contentType: 'repository', recommended: 7, absolute: 12 });
  assert.deepEqual(socialCardPageBudget('event'), { contentType: 'event', recommended: 10, absolute: 16 });
  assert.deepEqual(socialCardPageBudget('unknown'), { contentType: 'unknown', recommended: 7, absolute: 12 });
});

test('推荐页数超出只提示，绝对上限超出才阻断', () => {
  const recommended = socialCardPageBudgetStatus(8, 'repository');
  assert.equal(recommended.withinRecommended, false);
  assert.equal(recommended.withinAbsolute, true);
  assert.equal(socialCardPageBudgetMessage(8, 'repository'), '');

  const absolute = socialCardPageBudgetStatus(13, 'repository');
  assert.equal(absolute.withinRecommended, false);
  assert.equal(absolute.withinAbsolute, false);
  assert.match(socialCardPageBudgetMessage(13, 'repository'), /超过绝对安全上限 12 页/);
});
