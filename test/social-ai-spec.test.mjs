import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSocialAiDesignSpec } from '../server/shared/themes/social-ai-spec.mjs';
import { getBuiltinThemeRegistry } from '../server/shared/themes/theme-registry.mjs';

test('数据库自定义图文主题无需磁盘规范，使用当前配色和配方', () => {
  const theme = structuredClone(getBuiltinThemeRegistry().require('bone-white'));
  Object.assign(theme, { id: 'custom-cold-white', label: '冷白庄重', source: 'user' });
  theme.tokens.colors.page = '#F1F5F9';
  const result = loadSocialAiDesignSpec({ theme });
  assert.equal(result.source, 'theme-definition');
  assert.match(result.text, /冷白庄重/);
  assert.match(result.text, /#F1F5F9/);
  assert.match(result.text, /serif/);
  assert.match(result.text, /outlined-card/);
});

test('内置图文主题读取现有规范，缺失仍明确报错', () => {
  assert.equal(loadSocialAiDesignSpec({ theme: getBuiltinThemeRegistry().require('bone-white') }).source, 'file');
  assert.throws(() => loadSocialAiDesignSpec({ theme: { id: 'missing-builtin', source: 'builtin' } }), /缺少主题设计规范/);
});
