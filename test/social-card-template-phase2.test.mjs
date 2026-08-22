import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderStoryboardHtml } from '../lib/llm/social-card-pipeline.mjs';
import { socialThemeDefinition } from '../lib/themes/social-theme-compiler.mjs';
import { getSocialCardTemplatePack, listSocialCardTemplatePacks } from '../lib/rendering/social-card-template-registry.mjs';
import { validateThemeDefinition } from '../lib/themes/theme-validator.mjs';

function legacyTheme(id='peach') {
  const theme=structuredClone(socialThemeDefinition(id));
  delete theme.social.templatePack;
  delete theme.hash;delete theme.file;
  return theme;
}

test('Phase 2 neon-v1 注册角色模板并声明 standard-v1 回退', () => {
  const pack = getSocialCardTemplatePack('neon-v1');
  assert.equal(pack.renderer, 'neon-v1');
  assert.equal(pack.fallbackTemplate, 'standard-v1');
  assert.equal(pack.roleTemplates.cover, 'hero-metrics');
  assert.ok(listSocialCardTemplatePacks().some((item) => item.id === 'standard-v1'));
});

test('Phase 2 neon 主题绑定 neon-v1，旧主题仍使用 standard-v1', () => {
  const neon = socialThemeDefinition('neon', { fallback: false });
  const old = legacyTheme();
  assert.deepEqual(neon.social.templatePack, { id: 'neon-v1', version: 1 });
  assert.equal(old.social.templatePack, undefined);
  const { hash, file, ...rawNeon } = neon;
  validateThemeDefinition(rawNeon, { expectedTarget: 'social', expectedSource: 'builtin' });
});

test('Phase 2 neon-v1 输出受控角色组件和模板元数据', () => {
  const html = renderStoryboardHtml({
    topic: '霓虹模板样稿',
    repository: 'demo/repository',
    visualStyle: 'neon',
    channelMode: 'xiaohongshu',
    pages: [
      { kind: 'cover', role: 'cover', title: '霓虹模板样稿', lead: '先给结论，再展开证据' },
      { kind: 'content', role: 'feature', title: '功能栈', content_blocks: [{ type: 'stats', items: [{ num: '3', label: '动作' }] }] },
      { kind: 'ending', role: 'ending', title: '保存这张卡', content_blocks: [{ type: 'highlight', content: '下一次需要时再回来。' }] },
    ],
  });
  assert.match(html, /data-template-pack="neon-v1"/);
  assert.match(html, /class="page page-cover skeleton-terminal-rail template-neon-v1 neon-role-cover/);
  assert.match(html, /neon-template-hero-metrics/);
  assert.match(html, /neon-template-feature-stack/);
  assert.match(html, /neon-template-closing-cta/);
  assert.match(html, /--neon-grid/);
  assert.doesNotMatch(renderStoryboardHtml({ topic: '受控', visualStyle: 'neon', pages: [{ kind: 'content', role: 'feature', title: '受控', layout_intent: '" onload="alert(1)', content_blocks: [] }] }), /onload=/);
});

test('Neon 对比表正文不低于布局审计的 11px 门槛', () => {
  const html = renderStoryboardHtml({
    topic: '对比表字号',
    visualStyle: 'neon',
    pages: [{ kind: 'content', role: 'compare', title: '对比', content_blocks: [{ type: 'compare', headers: ['方式', '结果'], rows: [['A', '低'], ['B', '高']] }] }],
  });
  assert.match(html, /\.template-neon-v1 \.compare-block td\{font-size:11px\}/);
});

test('Phase 2 standard-v1 渲染路径保持旧页面骨架', () => {
  const html = renderStoryboardHtml({
    topic: '标准模板',
    visualStyle: 'peach',
    themeDefinition: legacyTheme(),
    pages: [{ kind: 'cover', role: 'cover', title: '标准模板' }],
  });
  assert.match(html, /data-template-pack="standard-v1"/);
  assert.doesNotMatch(html, /template-neon-v1/);
  assert.match(html, /class="page page-cover [^"]*composition-template/);
});

test('Phase 2 严格模板模式不再自动回退 standard-v1', () => {
  const source = fs.readFileSync(new URL('../lib/llm/social-card-pipeline.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /templateFallbackApplied/);
  assert.doesNotMatch(source, /templatePackOverride = 'standard-v1'/);
  assert.match(source, /严格渲染未通过，未自动回退到 standard-v1/);
  assert.match(source, /template-failure-report\.json/);
  assert.match(source, /template-audit-initial\.json/);
});
