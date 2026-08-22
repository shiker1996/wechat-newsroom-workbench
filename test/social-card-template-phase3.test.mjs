import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { themeCatalog } from '../lib/http/routes/theme-routes.mjs';
import { compileThemePreview } from '../lib/themes/theme-preview.mjs';
import { socialThemeDefinition } from '../lib/themes/social-theme-compiler.mjs';
import { auditThemeForPublish, assertThemePublishable } from '../lib/themes/theme-publish-gate.mjs';
import { socialCardTemplateEditorCatalog } from '../lib/rendering/social-card-template-registry.mjs';
import { handleThemeRoutes } from '../lib/http/routes/theme-routes.mjs';

test('Phase 3 social 主题目录返回模板包与版式倾向', () => {
  const item = themeCatalog('social').items.find((theme) => theme.id === 'neon');
  assert.equal(item.template.id, 'neon-v1');
  assert.equal(item.template.fallbackTemplate, 'standard-v1');
  assert.equal(themeCatalog('social').items.find((theme) => theme.id === 'peach').template.id, 'clean-v1');
});

test('Phase 3 正式预览返回模板状态并记录逐页模板', () => {
  const preview = compileThemePreview({ target: 'social', definition: socialThemeDefinition('neon', { fallback: false }) });
  assert.equal(preview.template.pack, 'neon-v1');
  assert.equal(preview.template.version, 1);
  assert.match(preview.html, /data-template-pack="neon-v1"/);
  assert.equal((preview.html.match(/data-template-id="[^"]+"/g) || []).length, 5);
});

test('Phase 3 social 发布门禁验证模板包元数据，文章与封面仍走原门禁', () => {
  const socialDefinition = structuredClone(socialThemeDefinition('ice-blue', { fallback: false }));
  socialDefinition.source = 'user';
  const social = auditThemeForPublish(socialDefinition, { target: 'social' });
  assert.equal(social.valid, true);
  const article = auditThemeForPublish({ ...socialThemeDefinition('neon', { fallback: false }), targets: ['article'], source: 'user' }, { target: 'article' });
  assert.equal(article.valid, false);
  assert.doesNotMatch(JSON.stringify(article.issues), /TEMPLATE_RENDERER_MISSING/);
});

test('Phase 3 模板包编辑目录只供 social 使用且管理器提供模板选择', () => {
  assert.ok(socialCardTemplateEditorCatalog().some((item) => item.id === 'neon-v1'));
  const html = fs.readFileSync(new URL('../public/src/views/theme-manager.js', import.meta.url), 'utf8');
  assert.match(html, /function templateEditor/);
  assert.match(html, /social\.templatePack\.id/);
  assert.match(html, /模板包/);
});

test('Phase 3 standard-v1 明确定位为标准兼容模板，预览返回角色模板和兼容标记', () => {
  const standard = socialCardTemplateEditorCatalog().find((item) => item.id === 'standard-v1');
  assert.equal(standard.label, '标准兼容模板');
  const legacy = structuredClone(socialThemeDefinition('peach', { fallback: false }));
  delete legacy.social.templatePack;
  delete legacy.social.templateMatch;
  const preview = compileThemePreview({ target: 'social', definition: legacy });
  assert.equal(preview.template.pack, 'standard-v1');
  assert.equal(preview.template.compatibility, true);
  assert.equal(preview.template.roleTemplates.cover, 'hero-stack');
});

test('Phase 3 新 Social 用户主题必须绑定模板，历史主题只能只读兼容查看', async () => {
  const legacy = structuredClone(socialThemeDefinition('peach', { fallback: false }));
  delete legacy.hash; delete legacy.file; delete legacy.social.templatePack; delete legacy.social.templateMatch;
  legacy.id = 'legacy-social'; legacy.source = 'user'; legacy.status = 'draft';
  const report = auditThemeForPublish(legacy, { target: 'social' });
  assert.equal(report.valid, false);
  assert.equal(report.legacy, true);
  assert.ok(report.issues.some((item) => item.code === 'TEMPLATE_REQUIRED'));
  assert.throws(() => assertThemePublishable(legacy, { target: 'social' }), /标准兼容预览/);
  let result;
  await handleThemeRoutes({
    request: { method: 'GET' }, response: {}, pathname: '/api/themes/legacy-social', searchParams: new URLSearchParams(),
    store: { getUserTheme: () => ({ id: 'legacy-social', label: '旧图文主题', target: 'social', status: 'draft', active_version: null, draft_json: JSON.stringify(legacy) }) },
    json: (_response, status, data) => { result = { status, data }; },
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.legacy, true);
  assert.equal(result.data.editorMode, 'read-only');
  assert.match(result.data.compatibility.issues[0].message, /只提供标准兼容预览/);
});
