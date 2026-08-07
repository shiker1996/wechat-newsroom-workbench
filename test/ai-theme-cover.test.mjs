import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getBuiltinThemeRegistry } from '../lib/themes/theme-registry.mjs';
import { composeAiThemeDefinition, validateAiThemeCandidate, validateAiThemeRequest } from '../lib/themes/ai-theme-contract.mjs';
import { normalizeAiThemeCandidate, buildAiThemeMessages } from '../lib/themes/ai-theme-generator.mjs';
import { compileThemePreview } from '../lib/themes/theme-preview.mjs';
import { auditThemeForPublish } from '../lib/themes/theme-publish-gate.mjs';
import { compactThemeSignatures, compareAiThemeCandidate, themeVisualSimilarity } from '../lib/themes/ai-theme-quality.mjs';

const registry = getBuiltinThemeRegistry();
const coverTokens = structuredClone(registry.get('cover-navy-gold').tokens);

function coverCandidate(overrides = {}) {
  return {
    label: '青夜', description: '深色底青色强调的 AI 资讯封面', tags: ['科技', '深色'],
    tokens: structuredClone(coverTokens),
    designSummary: [{ title: '配色', description: '深青底配亮青强调，标题反白' }],
    ...overrides,
  };
}

test('cover AI 请求合法，targetConfig 可省略或为空对象', () => {
  const request = validateAiThemeRequest({ target: 'cover', prompt: '深色科技感封面主题，强调色青色，适合 AI 资讯账号' });
  assert.equal(request.target, 'cover');
  assert.doesNotThrow(() => validateAiThemeCandidate(coverCandidate(), { target: 'cover' }));
  assert.doesNotThrow(() => validateAiThemeCandidate(coverCandidate({ targetConfig: {} }), { target: 'cover' }));
  assert.throws(() => validateAiThemeCandidate(coverCandidate({ targetConfig: 'nope' }), { target: 'cover' }));
  // 非 cover 目标仍要求 targetConfig
  assert.throws(() => validateAiThemeCandidate({ ...coverCandidate(), targetConfig: undefined }, { target: 'article' }));
});

test('cover 归一化不注入 targetConfig/recipes/components，组合定义只含 tokens', () => {
  const { candidate } = normalizeAiThemeCandidate(coverCandidate({ tokens: {} }), { target: 'cover' });
  assert.equal(candidate.targetConfig, undefined);
  assert.ok(candidate.tokens.colors.accent);
  assert.ok(candidate.tokens.typography.h1Px);
  const { definition } = composeAiThemeDefinition(candidate, { target: 'cover', id: 'ai-cover-test' });
  assert.deepEqual(definition.targets, ['cover']);
  assert.equal(definition.cover, undefined);
  assert.equal(definition.status, 'draft');
});

test('cover 生成 prompt 有封面方向文案且不带配方/组件目录', () => {
  const messages = buildAiThemeMessages({ target: 'cover', prompt: '深色科技感封面主题', preferences: {} });
  const system = messages[0].content;
  assert.ok(system.includes('900×383'));
  assert.ok(system.includes('封面主题只有 tokens'));
  assert.ok(!system.includes('组件属性目录'));
  // 签名段应包含内置封面主题（此前访问 theme.cover.recipes 会崩）
  assert.ok(system.includes('cover-navy-gold'));
});

test('cover 预览输出 900×383 固定样稿且通过发布门禁', () => {
  const { definition } = composeAiThemeDefinition(coverCandidate(), { target: 'cover', id: 'ai-cover-preview' });
  const preview = compileThemePreview({ target: 'cover', definition });
  assert.ok(/width:900px;height:383px/.test(preview.html));
  assert.ok(preview.html.includes('把复杂内容'));
  assert.ok(preview.html.includes('<em'));
  assert.throws(() => compileThemePreview({ target: 'cover', definition: { ...definition, tokens: {} } }));
  const audit = auditThemeForPublish(definition, { target: 'cover' });
  assert.ok(audit.valid, JSON.stringify(audit.issues));
});

test('内置封面主题全部通过 cover 发布门禁', () => {
  for (const theme of registry.list({ target: 'cover' })) {
    const audit = auditThemeForPublish({ ...structuredClone(theme), source: 'user' }, { target: 'cover' });
    assert.ok(audit.valid, `${theme.id}: ${JSON.stringify(audit.issues)}`);
  }
});

test('质量对比对 cover 不访问 recipes/components 且自相似为 1', () => {
  const signatures = compactThemeSignatures(registry.list({ target: 'cover' }), 'cover');
  assert.equal(signatures.length, 5);
  assert.ok(!('recipes' in signatures[0]));
  const navy = registry.get('cover-navy-gold');
  assert.equal(themeVisualSimilarity(navy, navy), 1);
  const comparison = compareAiThemeCandidate({ ...structuredClone(navy), id: 'ai-cover-x' }, registry.list({ target: 'cover' }));
  assert.ok(comparison.nearestTheme);
});

test('主题管理 UI 提供封面 AI 生成入口与三目标文案', () => {
  const index = fs.readFileSync('public/index.html', 'utf8');
  assert.ok(index.includes('name="ai-theme-target" value="cover"'));
  const manager = fs.readFileSync('public/src/views/theme-manager.js', 'utf8');
  assert.ok(manager.includes("cover:'封面'"));
  assert.ok(manager.includes("loadThemeCatalog('cover')"));
  assert.ok(manager.includes("active.target==='cover'"));
});

test('克隆与导入支持 cover 目标', () => {
  const service = fs.readFileSync('lib/themes/user-theme-service.mjs', 'utf8');
  assert.ok(service.includes("resolveWorkspaceTheme(store,sourceId,'cover')"));
  assert.ok(service.includes("'article','social','cover'"));
});
