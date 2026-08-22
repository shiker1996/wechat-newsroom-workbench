import test from 'node:test';
import assert from 'node:assert/strict';
import { socialThemeDefinition } from '../lib/themes/social-theme-compiler.mjs';
import {
  getSocialCardTemplatePack,
  listSocialCardTemplatePacks,
} from '../lib/rendering/social-card-template-registry.mjs';
import {
  createSocialCardStoryboardThemeSnapshot,
  getSocialCardTemplateCapabilities,
} from '../lib/rendering/social-card-template-resolver.mjs';
import { resolveSocialCardCapacityProfile } from '../lib/rendering/social-card-capacity.mjs';

test('阶段 1 五套模板包的十个角色均声明容量 profile', () => {
  const roles = ['cover', 'concept', 'feature', 'steps', 'data', 'compare', 'evidence', 'timeline', 'risk', 'ending'];
  for (const pack of listSocialCardTemplatePacks()) {
    for (const role of roles) {
      const capacity = pack.roles[role].capacity;
      assert.ok(capacity, `${pack.id}/${role} 缺少 capacity`);
      assert.ok(Number.isFinite(capacity.bodyHeightPx));
      assert.ok(Number.isFinite(capacity.maxTextChars));
      assert.ok(Number.isFinite(capacity.maxListItemLines));
      assert.equal(typeof capacity.splitAllowed, 'boolean');
    }
  }
});

test('阶段 1 capacity profile 保留结构预算并输出模板视觉预算', () => {
  const theme = socialThemeDefinition('brutalist', { fallback: false });
  const capabilities = getSocialCardTemplateCapabilities({ themeDefinition: theme, channelMode: 'xiaohongshu', contentType: 'repository' });
  assert.equal(capabilities.capacityProfileVersion, 1);
  assert.equal(capabilities.capacityProfile.templatePack.id, 'brutalist-v1');
  assert.equal(capabilities.roles.feature.maxBlocks, 4);
  assert.equal(capabilities.roles.feature.maxItems, 9);
  assert.equal(capabilities.roles.feature.capacity.structural.maxItems, 9);
  assert.ok(capabilities.roles.feature.capacity.visual.bodyHeightPx < 450);
  assert.ok(capabilities.roles.feature.capacity.split.allowed);
});

test('阶段 1 野兽派 profile 比清爽模板保守，主题 Token 会影响 resolved profile', () => {
  const theme = socialThemeDefinition('ice-blue', { fallback: false });
  const brutalist = resolveSocialCardCapacityProfile({ templatePack: getSocialCardTemplatePack('brutalist-v1'), themeDefinition: theme, channelMode: 'wechat' });
  const clean = resolveSocialCardCapacityProfile({ templatePack: getSocialCardTemplatePack('clean-v1'), themeDefinition: theme, channelMode: 'wechat' });
  assert.ok(brutalist.roles.feature.visual.bodyHeightPx < clean.roles.feature.visual.bodyHeightPx);

  const roomy = structuredClone(theme);
  roomy.tokens.spacing.articlePaddingPx += 8;
  const tighter = resolveSocialCardCapacityProfile({ templatePack: getSocialCardTemplatePack('clean-v1'), themeDefinition: roomy, channelMode: 'wechat' });
  assert.ok(tighter.roles.feature.visual.bodyHeightPx < clean.roles.feature.visual.bodyHeightPx);
});

test('阶段 1 故事板主题快照记录容量版本、哈希与 resolved profile', () => {
  const snapshot = createSocialCardStoryboardThemeSnapshot({
    themeDefinition: socialThemeDefinition('brutalist', { fallback: false }),
    channelMode: 'xiaohongshu',
    contentType: 'repository',
  });
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.capacityProfileVersion, 1);
  assert.match(snapshot.capacityHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(snapshot.capacityProfile.theme.themeId, 'brutalist');
  assert.equal(snapshot.capacityProfile.roles.feature.template, 'feature-grid');
});

