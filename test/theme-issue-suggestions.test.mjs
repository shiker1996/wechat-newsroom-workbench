import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichThemeIssues, suggestContrastColor } from '../server/shared/themes/theme-issue-suggestions.mjs';
import { auditThemeForPublish } from '../server/platform/application/themes/theme-publish-gate.mjs';
import { getBuiltinThemeRegistry } from '../server/shared/themes/theme-registry.mjs';

test('suggestContrastColor returns a passing color', () => {
  const fix = suggestContrastColor('#777777', '#FFFFFF', 4.5);
  assert.ok(fix && /^#[0-9A-F]{6}$/.test(fix.color));
  assert.ok(fix.ratio >= 4.5);
});

test('enrichThemeIssues adds actionable suggestions per code', () => {
  const definition = { tokens:{ colors:{ text:'#777777', background:'#FFFFFF' }, typography:{ h1Px:42 } } };
  const issues = enrichThemeIssues([
    { field:'tokens.colors.text', code:'LOW_CONTRAST', message:'对比度不足', details:{ foreground:'#777777', background:'#FFFFFF', minimum:4.5 } },
    { field:'tokens.typography.family', code:'ENUM', message:'字体角色不受支持' },
    { field:'tokens.typography.h1Px', code:'OUT_OF_RANGE', message:'必须是 28–40 之间的有限数值' },
    { field:'tokens.colors.accent', code:'FORMAT', message:'必须是六位十六进制颜色' },
    { field:'tokens.colors.unknownKey', code:'UNKNOWN_FIELD', message:'未知字段' },
    { field:'article.recipes.h1', code:'ENUM', message:'配方不受支持' },
  ], definition);
  assert.match(issues[0].suggestion, /建议把该颜色改为 #[0-9A-F]{6}（可达 [\d.]+:1）/);
  assert.match(issues[0].suggestion, /当前对比度 [\d.]+:1（要求 ≥4\.5:1）/);
  assert.match(issues[1].suggestion, /sans \/ serif \/ mono/);
  assert.match(issues[2].suggestion, /可先调整为 40（范围内）/);
  assert.match(issues[3].suggestion, /六位十六进制/);
  assert.match(issues[4].suggestion, /删除/);
  assert.match(issues[5].suggestion, /editorial-serif|可选配方/);
  // 无建议的 issue 保持原样，不带 suggestion 字段
  const plain = enrichThemeIssues([{ field:'theme', code:'COMPILE_FAILED', message:'x' }]);
  assert.equal(plain[0].suggestion, undefined);
});

test('publish gate issues carry fix suggestions end to end', () => {
  const theme = structuredClone(getBuiltinThemeRegistry().get('cover-navy-gold'));
  theme.source = 'user';
  theme.tokens.colors.muted = theme.tokens.colors.page; // 人为制造对比度不合格
  const report = auditThemeForPublish(theme, { target: 'cover' });
  const contrast = report.issues.find((item) => item.code === 'LOW_CONTRAST');
  assert.ok(contrast, JSON.stringify(report.issues));
  assert.match(contrast.suggestion, /建议把该颜色改为 #[0-9A-F]{6}/);
});
