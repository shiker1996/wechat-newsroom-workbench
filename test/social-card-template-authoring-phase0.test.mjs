import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SOCIAL_CARD_PAGE_ROLES } from '../lib/rendering/social-card-role.mjs';
import { SOCIAL_CARD_RENDERER_BLOCK_TYPES, SOCIAL_CARD_TEMPLATE_PACKS } from '../lib/rendering/social-card-template-registry.mjs';
import { matchSocialTemplate, templateMatchMetadata } from '../lib/themes/social-template-matcher.mjs';
import { socialThemeDefinition } from '../lib/themes/social-theme-compiler.mjs';
import { validateThemeDefinition } from '../lib/themes/theme-validator.mjs';

test('Phase 0 模板提案 Schema 固化 Social 目标、角色、草稿和状态字段', () => {
  const schema = JSON.parse(fs.readFileSync(new URL('../themes/schema/social-template-proposal.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.target.const, 'social');
  assert.deepEqual(schema.properties.status.enum, ['draft', 'preview-only', 'ready', 'published', 'rejected']);
  assert.deepEqual(Object.keys(schema.properties.roles.properties), SOCIAL_CARD_PAGE_ROLES);
  assert.deepEqual(schema.properties.source.enum, ['ai-proposal', 'ai-html-draft', 'user-authored', 'inherited']);
  assert.equal(schema.$defs.draft.properties.sandboxOnly.type, 'boolean');
});

test('Phase 0 当前模板包完整声明十个角色和受控内容块', () => {
  for (const pack of Object.values(SOCIAL_CARD_TEMPLATE_PACKS)) {
    assert.deepEqual(Object.keys(pack.roles), SOCIAL_CARD_PAGE_ROLES);
    for (const role of SOCIAL_CARD_PAGE_ROLES) {
      assert.ok(pack.roles[role].template);
      assert.ok(pack.roles[role].maxBlocks >= 1);
      assert.ok(pack.roles[role].maxItems >= 1);
      assert.ok(pack.roles[role].supportedBlocks.every((type) => SOCIAL_CARD_RENDERER_BLOCK_TYPES.includes(type)));
    }
  }
});

test('Phase 0 低置信度匹配返回结构化原因、分数和分差', () => {
  const none = matchSocialTemplate({ definition: { label: '普通主题', description: '通用信息卡', tags: [], tokens: {}, social: {} } });
  assert.equal(none.templatePack.id, 'standard-v1');
  assert.equal(none.reasonCode, 'NO_DIRECTION_SIGNAL');
  assert.equal(none.score, 0);
  assert.equal(none.runnerUpScore, 0);
  assert.equal(none.margin, 0);
  const metadata = templateMatchMetadata(none);
  assert.equal(metadata.reasonCode, 'NO_DIRECTION_SIGNAL');
  assert.equal(metadata.score, 0);
});

test('Phase 0 新增匹配字段进入 Social 主题运行时校验和正式契约', () => {
  const definition = structuredClone(socialThemeDefinition('neon', { fallback: false }));
  delete definition.hash;
  delete definition.file;
  definition.source = 'user';
  definition.social.templateMatch = templateMatchMetadata(matchSocialTemplate({ definition }));
  assert.doesNotThrow(() => validateThemeDefinition(definition, { expectedTarget: 'social', expectedSource: 'user' }));
});
