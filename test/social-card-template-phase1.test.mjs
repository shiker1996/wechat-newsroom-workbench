import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderStoryboardHtml } from '../lib/llm/social-card-pipeline.mjs';
import { socialThemeDefinition } from '../lib/themes/social-theme-compiler.mjs';
import {
  buildSocialCardTemplateCapabilityPrompt,
  getSocialCardTemplateCapabilities,
  resolveSocialCardTemplate,
  resolveSocialCardTemplateContext,
  validateSocialCardTemplateCompatibility,
} from '../lib/rendering/social-card-template-resolver.mjs';

function legacyTheme(id='peach') {
  const theme=structuredClone(socialThemeDefinition(id));
  delete theme.social.templatePack;
  delete theme.hash;delete theme.file;
  return theme;
}

test('Phase 1 旧 social 主题默认映射到 standard-v1', () => {
  const theme = legacyTheme();
  const context = resolveSocialCardTemplateContext({ themeDefinition: theme, channelMode: 'xiaohongshu', contentType: 'repository' });
  assert.equal(context.pack.id, 'standard-v1');
  assert.equal(context.pack.version, 1);
  assert.equal(context.source, 'default');
  assert.equal(context.fallback, false);
  assert.equal(resolveSocialCardTemplate({ kind: 'content', role: 'feature', content_blocks: [{ type: 'list' }] }, { themeDefinition: theme }).templateId, 'feature-ledger');
});

test('Phase 1 未知模板包安全回退到 standard-v1', () => {
  const theme = { ...legacyTheme(), social: { templatePack: 'missing-v9' } };
  const context = resolveSocialCardTemplateContext({ themeDefinition: theme, channelMode: 'wechat' });
  assert.equal(context.pack.id, 'standard-v1');
  assert.equal(context.source, 'fallback');
  assert.equal(context.fallback, true);
  assert.match(context.reason, /missing-v9/);
});

test('Phase 1 模板能力摘要按渠道限制内容块，但不规定固定卡片数量', () => {
  const theme = socialThemeDefinition('neon', { fallback: false });
  const wechat = getSocialCardTemplateCapabilities({ themeDefinition: theme, channelMode: 'wechat' });
  const xhs = getSocialCardTemplateCapabilities({ themeDefinition: theme, channelMode: 'xiaohongshu' });
  assert.ok(wechat.allowedBlockTypes.includes('code'));
  assert.ok(!wechat.allowedBlockTypes.includes('stats'));
  assert.ok(xhs.allowedBlockTypes.includes('stats'));
  const prompt = buildSocialCardTemplateCapabilityPrompt(xhs);
  assert.match(prompt, /版式能力约束/);
  assert.match(prompt, /不是要求固定卡片数量/);
  assert.match(prompt, /不要输出 HTML、CSS/);
});

test('Phase 1 兼容性校验保留内容并以 warning 标记承载风险', () => {
  const theme = legacyTheme();
  const pages = [{
    kind: 'content',
    role: 'feature',
    content_blocks: [
      { type: 'stats', items: [{ num: '1', label: 'a' }] },
      { type: 'list', items: ['a', 'b', 'c', 'd', 'e'] },
      { type: 'note', content: 'n' },
      { type: 'text', content: 't' },
      { type: 'highlight', content: 'h' },
    ],
  }];
  const result = validateSocialCardTemplateCompatibility(pages, { themeDefinition: theme, channelMode: 'wechat' });
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((item) => item.code === 'BLOCK_TYPE_UNSUPPORTED'));
  assert.ok(result.warnings.some((item) => item.code === 'BLOCK_BUDGET_EXCEEDED'));
  assert.equal(result.pages[0].templatePack, 'standard-v1');
});

test('Phase 1 HTML 记录模板包元数据且不改变页面结构', () => {
  const html = renderStoryboardHtml({
    topic: '模板基线',
    visualStyle: 'peach',
    themeDefinition: legacyTheme(),
    channelMode: 'xiaohongshu',
    pages: [{ kind: 'cover', title: '封面' }, { kind: 'ending', title: '结尾' }],
  });
  assert.match(html, /data-template-pack="standard-v1"/);
  assert.match(html, /data-template-version="1"/);
  assert.match(html, /class="page page-cover/);
  assert.match(html, /class="page page-ending/);
});

test('Phase 1 故事板路由在生成前注入模板能力并在生成后校验', () => {
  const source = fs.readFileSync(new URL('../lib/http/routes/social-card-routes.mjs', import.meta.url), 'utf8');
  assert.match(source, /templateCapabilities:templateContext\.capabilities/);
  assert.match(source, /validateSocialCardTemplateCompatibility/);
  assert.match(source, /socialTemplateContext\(/);
});
