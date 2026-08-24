import test from 'node:test';
import assert from 'node:assert/strict';
import { getBuiltinThemeRegistry } from '../server/shared/themes/theme-registry.mjs';
import { compareAiThemeCandidate, compactThemeSignatures, themeVisualSimilarity } from '../server/shared/themes/ai-theme-quality.mjs';
import { buildAiThemeMessages } from '../server/platform/application/themes/ai-theme-generator.mjs';

const registry=getBuiltinThemeRegistry(),warm=registry.get('magazine-warm'),tech=registry.get('tech-wire'),ice=registry.get('ice-blue');

test('阶段 3 相同主题被判定为过于相似并建议重新生成',()=>{
  const candidate=structuredClone(warm);candidate.id='ai-candidate-same';candidate.source='user';
  const comparison=compareAiThemeCandidate(candidate,[warm,tech]);assert.equal(themeVisualSimilarity(candidate,warm),1);assert.equal(comparison.nearestTheme.id,'magazine-warm');assert.equal(comparison.similarityPercent,100);assert.equal(comparison.verdict,'too-similar');assert.equal(comparison.recommendRegenerate,true);
});

test('阶段 3 差异摘要覆盖配色、字阶、形状与组件配方',()=>{
  const candidate=structuredClone(warm);candidate.id='ai-candidate-different';candidate.tokens.colors.accent='#0066CC';candidate.tokens.typography.h1Px=40;candidate.tokens.shape.radiusPx=24;candidate.article.recipes.quote='dark-block';
  const comparison=compareAiThemeCandidate(candidate,[warm]);assert.deepEqual(comparison.differences.map((item)=>item.group),['配色','字体与字阶','形状与层次','组件配方','组件细节']);assert.ok(comparison.similarity<1);
});

test('阶段 3 文章与图文提示词提供不同排版目标并携带内置视觉签名',()=>{
  const base={prompt:'生成一个具有明确视觉方向并保持内容可读性的完整安全主题。',preferences:{}};
  const article=buildAiThemeMessages({...base,target:'article'})[0].content,social=buildAiThemeMessages({...base,target:'social'})[0].content;
  assert.match(article,/长时间阅读为先/);assert.match(article,/正文建议 15–18px/);assert.match(social,/375×667/);assert.match(social,/一级标题 26–34px/);assert.match(social,/最多只允许 3 项/);assert.match(article,/避免直接复刻/);assert.ok(compactThemeSignatures([warm,tech,ice],'article').every((item)=>item.recipes));assert.match(article,/不得发明 codeText、border、codeTheme、brightness、readingPriority/);assert.match(article,/"highlightStrong":\["accent","ink"\]/);
});
