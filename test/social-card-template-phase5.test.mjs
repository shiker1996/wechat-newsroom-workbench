import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderStoryboardHtml } from '../lib/llm/social-card-pipeline.mjs';
import { compileSocialTheme, socialThemeDefinition } from '../lib/themes/social-theme-compiler.mjs';
import { getSocialCardTemplatePack } from '../lib/rendering/social-card-template-registry.mjs';
import { validateThemeDefinition } from '../lib/themes/theme-validator.mjs';

test('Phase 5 brutalist-v1 注册并绑定野兽派 social 主题', () => {
  const pack = getSocialCardTemplatePack('brutalist-v1');
  assert.equal(pack.renderer, 'brutalist-v1');
  assert.equal(pack.fallbackTemplate, 'standard-v1');
  assert.equal(pack.roleTemplates.cover, 'poster-cover');
  const theme = socialThemeDefinition('brutalist', { fallback: false });
  assert.deepEqual(theme.social.templatePack, { id: 'brutalist-v1', version: 1 });
  const { hash, file, ...raw } = theme;
  validateThemeDefinition(raw, { expectedTarget: 'social', expectedSource: 'builtin' });
});

test('Phase 5 brutalist-v1 输出硬边框、角色模板和逐页元数据', () => {
  const html = renderStoryboardHtml({
    topic: '野兽派模板样稿', repository: 'demo/repository', visualStyle: 'brutalist', channelMode: 'xiaohongshu',
    pages: [
      { kind: 'cover', role: 'cover', title: '野兽派模板样稿', lead: '先给结论，再展开证据' },
      { kind: 'content', role: 'concept', title: '先说判断', content_blocks: [{ type: 'text', title: '结论', content: '这是一个可复用的结构。' }] },
      { kind: 'content', role: 'steps', title: '快速开始', content_blocks: [{ type: 'steps', items: [{ title: '安装', content: '准备环境' }, { title: '运行', content: '执行命令' }] }] },
      { kind: 'ending', role: 'ending', title: '保存这张卡', content_blocks: [{ type: 'highlight', content: '下一次需要时再回来。' }] },
    ],
  });
  assert.match(html, /data-template-pack="brutalist-v1"/);
  assert.match(html, /data-template-source="theme-role-template"/);
  assert.match(html, /class="page page-cover skeleton-impact-band template-brutalist-v1 brutalist-role-cover/);
  assert.match(html, /brutalist-template-poster-cover/);
  assert.match(html, /brutalist-template-thesis-split/);
  assert.match(html, /brutalist-template-numbered-steps/);
  assert.match(html, /brutalist-template-hard-cta/);
  assert.match(html, /border:4px solid var\(--ink\)/);
  assert.match(html, /\.template-brutalist-v1\.page-cover \.brutalist-title-line\{[^}]*background:var\(--ink\);color:var\(--inverse\)/);
  assert.match(html, /\.template-brutalist-v1\.page-cover \.brutalist-title-line:nth-child\(even\)\{[^}]*background:var\(--inverse\);color:var\(--ink\)/);
  assert.match(html, /\.template-brutalist-v1 \.brand\{[^}]*background:var\(--ink\);color:var\(--inverse\)/);
  assert.match(html, /\.template-brutalist-v1 \.page li:before\{[^}]*background:var\(--ink\);box-shadow:2px 2px 0 var\(--accentSecondary\)/);
  assert.doesNotMatch(html, /onload=/);
});

test('brutalist-v1 封面标题交替交换正文色与反色', () => {
  const charcoal = compileSocialTheme(socialThemeDefinition('charcoal', { fallback: false })).css;
  assert.match(charcoal, /--ink:#ededed/);
  assert.match(charcoal, /--inverse:#111111/);
});

test('Phase 5 editorial-v1 注册并绑定纸艺暖调 social 主题', () => {
  const pack = getSocialCardTemplatePack('editorial-v1');
  assert.equal(pack.renderer, 'editorial-v1');
  assert.equal(pack.fallbackTemplate, 'standard-v1');
  assert.equal(pack.roleTemplates.cover, 'paper-poster');
  const theme = socialThemeDefinition('paper-craft', { fallback: false });
  assert.deepEqual(theme.social.templatePack, { id: 'editorial-v1', version: 1 });
  const { hash, file, ...raw } = theme;
  validateThemeDefinition(raw, { expectedTarget: 'social', expectedSource: 'builtin' });
});

test('Phase 5 editorial-v1 输出纸张编辑结构和逐页模板元数据', () => {
  const html = renderStoryboardHtml({
    topic: '编辑纸页样稿', repository: 'demo/repository', visualStyle: 'paper-craft', channelMode: 'xiaohongshu',
    pages: [
      { kind: 'cover', role: 'cover', title: '编辑纸页样稿', lead: '先给结论，再展开证据' },
      { kind: 'content', role: 'concept', title: '先说判断', content_blocks: [{ type: 'text', title: '结论', content: '这是一个可复用的结构。' }] },
      { kind: 'content', role: 'steps', title: '快速开始', content_blocks: [{ type: 'steps', items: [{ title: '安装', content: '准备环境' }, { title: '运行', content: '执行命令' }] }] },
      { kind: 'ending', role: 'ending', title: '保存这张卡', content_blocks: [{ type: 'highlight', content: '下一次需要时再回来。' }] },
    ],
  });
  assert.match(html, /data-template-pack="editorial-v1"/);
  assert.match(html, /data-template-source="theme-role-template"/);
  assert.match(html, /class="page page-cover skeleton-paper-offset template-editorial-v1 editorial-role-cover/);
  assert.match(html, /editorial-template-paper-poster/);
  assert.match(html, /editorial-template-margin-thesis/);
  assert.match(html, /editorial-template-numbered-margin/);
  assert.match(html, /editorial-template-closing-editor/);
  assert.match(html, /font:700 30px\/1\.12 Georgia/);
  assert.doesNotMatch(html, /onload=/);
});

test('Phase 5 非 social 主题仍不绑定 brutalist 模板', () => {
  const articleLike = fs.readFileSync(new URL('../themes/article/magazine-warm.json', import.meta.url), 'utf8');
  assert.doesNotMatch(articleLike, /brutalist-v1/);
  assert.doesNotMatch(articleLike, /editorial-v1/);
});

test('Phase 5 模板回退时 body 与 section 元数据保持一致', () => {
  const html = renderStoryboardHtml({
    topic: '回退标记样稿', repository: 'demo/repository', visualStyle: 'neon', channelMode: 'xiaohongshu', templatePackOverride: 'standard-v1',
    pages: [{ kind: 'cover', role: 'cover', title: '回退标记样稿' }],
  });
  assert.match(html, /data-template-pack="standard-v1"/);
  assert.match(html, /data-template-source="fallback"/);
  assert.match(html, /data-template-id="hero-stack"/);
  assert.doesNotMatch(html, /data-template-pack="neon-v1"/);
});

test('Phase 5 野兽派主题层也为列表标记提供高对比覆盖', () => {
  const theme = socialThemeDefinition('brutalist', { fallback: false });
  const compiled = compileSocialTheme(theme);
  assert.match(compiled.css, /\.theme-brutalist \.page li:before\{content:"";background:var\(--ink\);border:2px solid var\(--accent\)/);
});
