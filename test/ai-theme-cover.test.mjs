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

test('cover 归一化补齐默认构图，组合定义携带 cover.spec', () => {
  const { candidate } = normalizeAiThemeCandidate(coverCandidate({ tokens: {} }), { target: 'cover' });
  assert.ok(candidate.targetConfig?.spec?.components?.some((item) => item.type === 'canvas'));
  assert.ok(candidate.tokens.colors.accent);
  assert.ok(candidate.tokens.typography.titlePx);
  assert.ok(!('h1Px' in candidate.tokens.typography));
  const { definition } = composeAiThemeDefinition(candidate, { target: 'cover', id: 'ai-cover-test' });
  assert.deepEqual(definition.targets, ['cover']);
  assert.ok(definition.cover?.spec?.components?.length);
  assert.equal(definition.status, 'draft');
});

test('cover 构图部分组件笔误时逐组件抢救，不再整组回退', () => {
  const spec = { components: [
    { type: 'canvas', colorRole: 'page' },
    { type: 'color-block', position: 'left-third', shape: 'rect', colorRole: 'accent' },
    { type: 'title', align: 'left' },
    { type: 'subtitle', withBar: true },
    { type: 'eyebrow', form: 'badge' }, // 缺文案，不合规
    { type: 'decoration', kind: 'laser', position: 'top-right' }, // 未知 kind，不合规
  ] };
  const { candidate, repairs } = normalizeAiThemeCandidate(coverCandidate({ targetConfig: { spec } }), { target: 'cover' });
  const types = candidate.targetConfig.spec.components.map((item) => item.type);
  assert.deepEqual(types, ['canvas', 'color-block', 'title', 'subtitle']);
  const record = repairs.find((item) => item.field === 'targetConfig.spec');
  assert.ok(record.reason.includes('丢弃') && record.reason.includes('保留'));
});

test('cover 构图缺失或整体不合规时回退到有色块的默认构图', () => {
  const { candidate: missing } = normalizeAiThemeCandidate(coverCandidate({ targetConfig: {} }), { target: 'cover' });
  assert.ok(missing.targetConfig.spec.components.some((item) => item.type === 'color-block'));
  assert.ok(missing.targetConfig.spec.components.some((item) => item.type === 'subtitle'));
  const { candidate: broken } = normalizeAiThemeCandidate(coverCandidate({ targetConfig: { spec: { components: [{ type: 'eyebrow' }] } } }), { target: 'cover' });
  assert.ok(broken.targetConfig.spec.components.some((item) => item.type === 'color-block'));
});

test('cover 构图不合规时回退默认构图并记录修复', () => {
  const { candidate, repairs } = normalizeAiThemeCandidate(coverCandidate({ targetConfig: { spec: { components: [{ type: 'title' }] } } }), { target: 'cover' });
  assert.ok(candidate.targetConfig.spec.components.some((item) => item.type === 'canvas'));
  assert.ok(repairs.some((item) => item.field === 'targetConfig.spec'));
});

test('cover 生成 prompt 有封面方向文案且携带构图契约', () => {
  const messages = buildAiThemeMessages({ target: 'cover', prompt: '深色科技感封面主题', preferences: {} });
  const system = messages[0].content;
  assert.ok(system.includes('900×383'));
  assert.ok(system.includes('targetConfig.spec'));
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

test('cover token 契约：旧文章字段被拒，封面字段必填且限制范围', () => {
  const definition = composeAiThemeDefinition(coverCandidate(), { target: 'cover', id: 'ai-cover-contract' }).definition;
  const legacy = structuredClone(definition);
  legacy.tokens.typography.h1Px = 34;
  const legacyAudit = auditThemeForPublish(legacy, { target: 'cover' });
  assert.ok(legacyAudit.issues.some((item) => item.field === 'tokens.typography.h1Px' && item.code === 'UNKNOWN_FIELD'));
  const missing = structuredClone(definition);
  delete missing.tokens.typography.titlePx;
  delete missing.tokens.colors.page;
  const missingAudit = auditThemeForPublish(missing, { target: 'cover' });
  assert.ok(missingAudit.issues.some((item) => item.field === 'tokens.typography.titlePx' && item.code === 'REQUIRED'));
  assert.ok(missingAudit.issues.some((item) => item.field === 'tokens.colors.page' && item.code === 'REQUIRED'));
  const outOfRange = structuredClone(definition);
  outOfRange.tokens.typography.titlePx = 80;
  const rangeAudit = auditThemeForPublish(outOfRange, { target: 'cover' });
  assert.ok(rangeAudit.issues.some((item) => item.field === 'tokens.typography.titlePx' && item.code === 'OUT_OF_RANGE'));
});

test('cover 归一化把旧文章字段迁移进封面契约', () => {
  const candidate = coverCandidate();
  candidate.tokens.typography = { family: 'sans', headingFamily: 'sans', bodyPx: 12, h1Px: 40, h2Px: 14, captionPx: 10, lineHeight: 1.4, letterSpacingEm: 0 };
  candidate.tokens.spacing = { articlePaddingPx: 24, sectionPx: 24, paragraphPx: 10, cardGapPx: 12 };
  candidate.tokens.shape = { radiusPx: 6, borderWidthPx: 1, shadow: 'soft' };
  candidate.tokens.colors.background = '#0B1220';
  delete candidate.tokens.colors.page;
  const { candidate: normalized, repairs } = normalizeAiThemeCandidate(candidate, { target: 'cover' });
  assert.equal(normalized.tokens.typography.titlePx, 40);
  assert.equal(normalized.tokens.typography.titleLineHeight, 1.4);
  assert.ok(!('h1Px' in normalized.tokens.typography) && !('articlePaddingPx' in normalized.tokens.spacing) && !('shadow' in normalized.tokens.shape));
  assert.equal(normalized.tokens.colors.page, '#0B1220');
  assert.ok(!('background' in normalized.tokens.colors));
  assert.ok(repairs.some((item) => item.field === 'tokens.typography.titlePx' && item.reason.includes('映射')));
});

test('cover 几何拓展：斜切/半屏色块、背景大字与新装饰的校验与渲染', () => {
  const definition = composeAiThemeDefinition(coverCandidate({
    targetConfig: { spec: { components: [
      { type: 'canvas', colorRole: 'page' },
      { type: 'color-block', position: 'left-half', shape: 'diagonal', colorRole: 'accent' },
      { type: 'title', align: 'left' },
      { type: 'giant-char', position: 'right', colorRole: 'ink' },
      { type: 'decoration', kind: 'corner-marks', position: 'top-left' },
      { type: 'decoration', kind: 'grid', position: 'middle-right' },
    ] } },
  }), { target: 'cover', id: 'ai-cover-geo' }).definition;
  const audit = auditThemeForPublish(definition, { target: 'cover' });
  assert.ok(audit.valid, JSON.stringify(audit.issues));
  const { html } = compileThemePreview({ target: 'cover', definition });
  assert.ok(html.includes('clip-path:polygon'), '斜切色块');
  assert.ok(/cover-giant giant-right/.test(html) && html.includes('把'), '背景大字取标题首字');
  assert.equal((html.match(/deco-corner corner-/g) || []).length, 4, '裁切角标四角');
  assert.ok(/deco-grid deco-middle-right/.test(html), '网格装饰新位置');
});

test('cover 背景大字静态字符与长度校验', () => {
  const definition = composeAiThemeDefinition(coverCandidate({
    targetConfig: { spec: { components: [
      { type: 'canvas', colorRole: 'page' },
      { type: 'title', align: 'center' },
      { type: 'giant-char', text: 'AI', position: 'center', colorRole: 'accentSecondary' },
    ] } },
  }), { target: 'cover', id: 'ai-cover-giant' }).definition;
  const { html } = compileThemePreview({ target: 'cover', definition });
  assert.ok(/cover-giant giant-center[^>]*>AI</.test(html));
  const tooLong = auditThemeForPublish({ ...structuredClone(definition), cover: { spec: { components: [{ type: 'canvas', colorRole: 'page' }, { type: 'title', align: 'left' }, { type: 'giant-char', text: '五个字超长', position: 'left', colorRole: 'ink' }] } } }, { target: 'cover' });
  assert.ok(tooLong.issues.some((item) => item.message.includes('背景大字')));
});

test('cover 编译器消费主题字阶与留白 token', () => {
  const { definition } = composeAiThemeDefinition(coverCandidate(), { target: 'cover', id: 'ai-cover-tokens' });
  definition.tokens.typography.eyebrowPx = 16;
  definition.tokens.typography.subtitlePx = 24;
  definition.tokens.typography.titleLineHeight = 1.5;
  definition.tokens.spacing.gapPx = 28;
  definition.tokens.spacing.metaBottomPx = 40;
  const { html } = compileThemePreview({ target: 'cover', definition });
  assert.ok(html.includes('font-size:16px'), '眉题字号');
  assert.ok(html.includes('font-size:24px'), '副标题字号');
  assert.ok(html.includes('line-height:1.5'), '标题行高');
  assert.ok(html.includes('gap:28px'), '元素间距');
  assert.ok(html.includes('bottom:40px'), '信息行距底');
});

test('内置封面主题全部通过 cover 发布门禁', () => {
  for (const theme of registry.list({ target: 'cover' })) {
    const audit = auditThemeForPublish({ ...structuredClone(theme), source: 'user' }, { target: 'cover' });
    assert.ok(audit.valid, `${theme.id}: ${JSON.stringify(audit.issues)}`);
  }
});

test('质量对比对 cover 不访问 recipes/components 且自相似为 1', () => {
  const signatures = compactThemeSignatures(registry.list({ target: 'cover' }), 'cover');
  assert.equal(signatures.length, 10);
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
