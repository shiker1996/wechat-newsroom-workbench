import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderStoryboardHtml } from '../lib/llm/social-card-pipeline.mjs';
import { socialThemeDefinition } from '../lib/themes/social-theme-compiler.mjs';
import { getSocialCardTemplatePack } from '../lib/rendering/social-card-template-registry.mjs';
import { createSocialCardStoryboardThemeSnapshot, resolveSocialCardStoryboardThemeState } from '../lib/rendering/social-card-template-resolver.mjs';
import { validateThemeDefinition } from '../lib/themes/theme-validator.mjs';

const BATCH_B_THEMES = [
  ['ice-blue', '冰川冷调'],
  ['lavender', '芋泥暮色'],
  ['bone-white', '月白清灰'],
  ['solarized', '极光配色'],
];

const BATCH_C_BINDINGS = [
  ['retro-terminal', 'neon-v1'],
  ['tokyo-night', 'neon-v1'],
  ['charcoal', 'brutalist-v1'],
  ['crimson', 'brutalist-v1'],
  ['orange', 'brutalist-v1'],
  ['mocha', 'clean-v1'],
  ['peach', 'clean-v1'],
];

test('Phase 6 批次 B 四个主题绑定 clean-v1', () => {
  const pack = getSocialCardTemplatePack('clean-v1');
  assert.equal(pack.renderer, 'clean-v1');
  assert.equal(pack.fallbackTemplate, 'standard-v1');
  assert.equal(pack.roleTemplates.cover, 'clean-cover');
  for (const [id] of BATCH_B_THEMES) {
    const theme = socialThemeDefinition(id, { fallback: false });
    assert.deepEqual(theme.social.templatePack, { id: 'clean-v1', version: 1 });
    const { hash, file, ...raw } = theme;
    validateThemeDefinition(raw, { expectedTarget: 'social', expectedSource: 'builtin' });
  }
});

test('Phase 6 clean-v1 为批次 B 输出统一角色模板并保留主题 Token', () => {
  const pages = [
    { kind: 'cover', role: 'cover', title: '清爽编辑模板样稿', lead: '先给结论，再展开证据' },
    { kind: 'content', role: 'feature', title: '核心功能', content_blocks: [{ type: 'text', title: '信息层级', content: '清晰的标题、正文和提示块。' }, { type: 'list', title: '清单', items: ['第一项', '第二项'] }] },
    { kind: 'content', role: 'steps', title: '快速开始', content_blocks: [{ type: 'steps', items: [{ title: '准备', content: '准备素材' }, { title: '生成', content: '运行流程' }] }] },
    { kind: 'ending', role: 'ending', title: '保存这张卡', content_blocks: [{ type: 'highlight', content: '下次需要时再回来。' }] },
  ];
  for (const [id] of BATCH_B_THEMES) {
    const html = renderStoryboardHtml({ topic: '批次 B 样稿', repository: 'demo/repository', visualStyle: id, channelMode: 'xiaohongshu', pages });
    assert.match(html, /data-template-pack="clean-v1"/);
    assert.match(html, /data-template-source="theme-role-template"/);
    assert.match(html, /template-clean-v1/);
    assert.match(html, /clean-template-clean-cover/);
    assert.match(html, /clean-template-clean-feature/);
    assert.match(html, /clean-template-clean-steps/);
    assert.match(html, /clean-template-clean-ending/);
    assert.match(html, /--accent:/);
    assert.doesNotMatch(html, /onload=/);
  }
});

test('Phase 6 clean-v1 消费 editorial-split 主题骨架配方', () => {
  for (const id of ['bone-white', 'solarized']) {
    const html = renderStoryboardHtml({
      topic: '编辑分栏样稿',
      visualStyle: id,
      channelMode: 'xiaohongshu',
      pages: [{ kind: 'content', role: 'feature', title: '双栏内容', content_blocks: [
        { type: 'text', title: '左栏', content: '事实内容' },
        { type: 'note', title: '右栏', content: '编辑提示' },
      ] }],
    });
    assert.match(html, /skeleton-editorial-split/);
    assert.match(html, /clean-block-stack\{display:grid;grid-column:1\/-1;grid-template-columns/);
  }
});

test('clean-v1 按语义构图结果关闭不均衡的强制双栏', () => {
  const html = renderStoryboardHtml({
    topic: '不均衡内容', visualStyle: 'solarized', channelMode: 'xiaohongshu', compositionMode: 'smart',
    pages: [{ kind: 'content', role: 'concept', title: '问题说明', content_blocks: [
      { type: 'text', title: '背景', content: '一段较短的背景说明。' },
      { type: 'list', title: '细节', content: '第一条较长的说明内容\n第二条较长的说明内容\n第三条较长的说明内容' },
    ] }],
  });
  assert.match(html, /skeleton-editorial-split[^\"]*comp-cols-single/);
  assert.match(html, /skeleton-editorial-split\.comp-cols-split-even/);
});

test('Phase 6 批次 B 仍只作用于 social 主题', () => {
  const articleLike = fs.readFileSync(new URL('../themes/article/magazine-warm.json', import.meta.url), 'utf8');
  assert.doesNotMatch(articleLike, /clean-v1/);
});

test('Phase 6 批次 C 七个主题按视觉家族绑定现有模板包', () => {
  for (const [id, packId] of BATCH_C_BINDINGS) {
    const theme = socialThemeDefinition(id, { fallback: false });
    assert.deepEqual(theme.social.templatePack, { id: packId, version: 1 }, `${id} 模板绑定不正确`);
    const { hash, file, ...raw } = theme;
    validateThemeDefinition(raw, { expectedTarget: 'social', expectedSource: 'builtin' });
    assert.equal(getSocialCardTemplatePack(packId).fallbackTemplate, 'standard-v1');
  }
});

test('Phase 6 批次 C 复用模板家族但保留主题 Token 和逐页元数据', () => {
  const pages = [
    { kind: 'cover', role: 'cover', title: '批次 C 样稿', lead: '模板结构复用，主题气质保留' },
    { kind: 'content', role: 'feature', title: '核心能力', content_blocks: [{ type: 'list', title: '清单', items: ['一项', '二项'] }] },
    { kind: 'content', role: 'steps', title: '快速开始', content_blocks: [{ type: 'steps', items: [{ title: '准备', content: '准备素材' }, { title: '执行', content: '运行流程' }] }] },
    { kind: 'ending', role: 'ending', title: '保存这张卡', content_blocks: [{ type: 'highlight', content: '下次需要时再回来。' }] },
  ];
  for (const [id, packId] of BATCH_C_BINDINGS) {
    const html = renderStoryboardHtml({ topic: '批次 C 样稿', repository: 'demo/repository', visualStyle: id, channelMode: 'xiaohongshu', pages });
    assert.match(html, new RegExp(`data-template-pack="${packId}"`), id);
    assert.match(html, /data-template-version="1"/);
    assert.match(html, new RegExp(`class="page page-cover[^\"]*template-${packId}`));
    if (packId === 'clean-v1' || packId === 'brutalist-v1') assert.match(html, /data-template-source="theme-role-template"/);
    assert.match(html, /--accent:/);
    assert.doesNotMatch(html, /onload=/);
  }
});

test('Phase 6 模板 CSS 使用主题 Token，主题配方在模板之后生效', () => {
  const tokyo = renderStoryboardHtml({ topic: '东京夜色', visualStyle: 'tokyo-night', pages: [{ kind: 'cover', title: '夜间工具' }] });
  assert.doesNotMatch(tokyo, /rgba\(85,255,182/);
  assert.match(tokyo, /--neon-grid:color-mix\(in srgb,var\(--accent\)/);
  const charcoal = renderStoryboardHtml({ topic: '炭黑样稿', visualStyle: 'charcoal', pages: [{ kind: 'content', title: '极简', content_blocks: [{ type: 'list', items: ['一项'] }] }] });
  assert.ok(charcoal.indexOf('.template-brutalist-v1') < charcoal.indexOf('.theme-charcoal'), '主题配方应在模板 CSS 之后');
  const crimson = socialThemeDefinition('crimson', { fallback: false });
  assert.equal(crimson.tokens.colors.inverseText, '#22070E');
  const crimsonHtml = renderStoryboardHtml({ topic: '赤焰样稿', visualStyle: 'crimson', pages: [{ kind: 'content', title: '高冲击', content_blocks: [{ type: 'list', items: ['一项'] }] }] });
  assert.match(crimsonHtml, /\.theme-crimson \.brand\{color:var\(--inverse\)\}/);
  assert.match(crimsonHtml, /\.theme-crimson \.page li\{color:var\(--inverse\)\}/);
});

test('Phase 6 主题切换区分同模板换肤与跨模板故事板失效', () => {
  const samePackSnapshot = createSocialCardStoryboardThemeSnapshot({ themeDefinition: socialThemeDefinition('ice-blue'), channelMode: 'xiaohongshu', contentType: 'repository' });
  const samePack = resolveSocialCardStoryboardThemeState({
    editorial: { card_plan_json: JSON.stringify([{ kind: 'content' }]), storyboard_theme_snapshot_json: JSON.stringify(samePackSnapshot) },
    themeDefinition: socialThemeDefinition('bone-white'), channelMode: 'xiaohongshu', contentType: 'repository',
  });
  assert.equal(samePack.status, 'render-only');
  assert.equal(samePack.canRender, true);
  const crossPack = resolveSocialCardStoryboardThemeState({
    editorial: { card_plan_json: JSON.stringify([{ kind: 'content' }]), storyboard_theme_snapshot_json: JSON.stringify(samePackSnapshot) },
    themeDefinition: socialThemeDefinition('crimson'), channelMode: 'xiaohongshu', contentType: 'repository',
  });
  assert.equal(crossPack.status, 'needs-storyboard');
  assert.equal(crossPack.canRender, false);
});

test('Phase 4 历史故事板必须先重新生成后才能进入新模板链路', () => {
  const legacy = resolveSocialCardStoryboardThemeState({
    editorial: { card_plan_json: JSON.stringify([{ kind: 'content' }]), storyboard_theme_snapshot_json: '' },
    themeDefinition: socialThemeDefinition('ice-blue'), channelMode: 'xiaohongshu', contentType: 'repository',
  });
  assert.equal(legacy.status, 'needs-storyboard');
  assert.equal(legacy.canRender, false);
  assert.equal(legacy.requiresStoryboard, true);
  assert.match(legacy.reason, /先重新生成故事板/);
});
