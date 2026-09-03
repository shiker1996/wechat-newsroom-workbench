import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildPublicationClaimRegister,
  publicationCompliancePrompt,
  publicationFactBaseIssues,
  scanPublicationRisk,
} from '../server/features/articles/domain/publication-compliance.mjs';

test('发布风险扫描拦截未核实的财经数字和资本市场动作', () => {
  const scan = scanPublicationRisk({
    title: 'Kimi冲刺500亿美元IPO：独立大模型公司的最后一次梦想定价？',
    article: '# Kimi冲刺500亿美元IPO：独立大模型公司的最后一次梦想定价？\n\n正文',
    factBase: { claims: [{ claim: '公司发布新模型', status: 'verified', sourceUrl: 'https://example.com/source' }] },
  });
  assert.ok(scan.categories.includes('financial'));
  assert.ok(scan.categories.includes('sensational'));
  assert.ok(scan.titleBlockers.some((item) => item.includes('500亿美元')));
  assert.ok(scan.titleBlockers.some((item) => item.includes('财经/资本市场')));
  assert.equal(scan.requiresHumanConfirmation, true);
});

test('已核验事实可支持对应标题主张，但仍保留模型专项复核信号', () => {
  const factBase = { claims: [{ claim: 'Kimi 已公开披露 500 亿美元 IPO 估值讨论', status: 'verified', sourceUrl: 'https://example.com/source' }] };
  const scan = scanPublicationRisk({ title: 'Kimi 500 亿美元 IPO 估值讨论', factBase });
  assert.deepEqual(scan.titleBlockers, []);
  assert.equal(scan.requiresModelReview, true);
});

test('高影响 verified 主张没有来源 URL 时阻断事实基座', () => {
  const issues = publicationFactBaseIssues({ claims: [{ claim: '公司估值达到 500 亿美元', status: 'verified' }] });
  assert.equal(issues.length, 1);
  assert.match(issues[0], /没有直接来源 URL/);
});

test('发布主张登记保留状态、来源和正文边界', () => {
  const register = buildPublicationClaimRegister({ claims: [
    { id: 'c1', claim: '官方已确认', status: 'verified', sourceUrl: 'https://example.com/a', sourceType: 'official', boundary: '可确定陈述' },
    { claim: '员工说法', status: 'disputed', source_url: 'https://example.com/b' },
  ] });
  assert.equal(register[0].publicationRule.includes('确定事实'), true);
  assert.equal(register[1].sourceUrl, 'https://example.com/b');
  assert.equal(register[1].publicationRule.includes('不得作为确定事实'), true);
});

test('发布合规提示要求单独检查标题和高影响主张', () => {
  const prompt = publicationCompliancePrompt({ factBase: { claims: [] }, claimRegister: [], scan: { categories: ['financial'] } });
  assert.match(prompt, /标题、摘要和前 200 字单独审核/);
  assert.match(prompt, /高影响事实无法核验时不得返回 pass/);
  assert.match(prompt, /publication_compliance/);
});

test('成稿流水线把事实登记传给标题、SEO和最终发布门禁', () => {
  const source = fs.readFileSync(new URL('../server/features/articles/application/article-pipeline.mjs', import.meta.url), 'utf8');
  assert.match(source, /publicationClaimRegister/);
  assert.match(source, /purpose:'article-seo'/);
  assert.match(source, /publication-safety-gate/);
  assert.match(source, /10-publication-compliance\.json/);
});
