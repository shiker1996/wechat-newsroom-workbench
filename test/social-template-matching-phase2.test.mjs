import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';
import { composeAiThemeDefinition } from '../server/shared/themes/ai-theme-contract.mjs';
import { getBuiltinThemeRegistry } from '../server/shared/themes/theme-registry.mjs';
import { matchSocialTemplate } from '../server/shared/themes/social-template-matcher.mjs';
import { cloneTheme, importThemeDraft, saveThemeDraft } from '../server/platform/application/themes/user-theme-service.mjs';

const registry = getBuiltinThemeRegistry();

function socialDefinition(id='ice-blue') {
  const source = structuredClone(registry.get(id));
  delete source.hash;
  delete source.file;
  return source;
}

test('Phase 2 确定性匹配器按终端、硬边界、编辑纸张和清爽工具卡分流', () => {
  const cases = [
    [{ label: '未来终端', description: '开发者网格代码工具', tags: ['futuristic', 'terminal'], tokens: { typography: { family: 'mono' } }, social: { effects: { texture: 'grid' } } }, 'neon-v1'],
    [{ label: '高冲击海报', description: '硬边框强对比', tags: ['bold', 'high-impact'], tokens: { shape: { radiusPx: 0, shadow: 'hard' } }, social: {} }, 'brutalist-v1'],
    [{ label: '纸张编辑', description: '印刷杂志来源账页', tags: ['paper', 'editorial'], tokens: { typography: { headingFamily: 'serif' } }, social: { effects: { texture: 'paper-grain' } } }, 'editorial-v1'],
    [{ label: '清爽工具卡', description: '柔和克制的工具介绍', tags: ['clean', 'soft', 'tool-card'], tokens: { shape: { radiusPx: 18, shadow: 'soft' } }, social: {} }, 'clean-v1'],
  ];
  for (const [definition, expected] of cases) {
    const result = matchSocialTemplate({ definition });
    assert.equal(result.templatePack.id, expected);
    assert.equal(result.source, 'program-recommended');
    assert.ok(result.signals.length > 0);
  }
});

test('Phase 2 不明确的自定义方向使用 standard-v1 并标记兼容待确认', () => {
  const result = matchSocialTemplate({ definition: { label: '我的颜色', description: '一个自定义主题', tags: [], tokens: {}, social: {} } });
  assert.equal(result.templatePack.id, 'standard-v1');
  assert.equal(result.source, 'compatibility');
  assert.equal(result.confidence, 'low');
  assert.match(result.reason, /兼容模板/);
});

test('Phase 2 AI Social 主题由程序写入模板包和匹配摘要，忽略模型携带的模板字段', () => {
  const source = socialDefinition('neon');
  const candidate = {
    label: '纸张工具卡', description: '编辑纸张风格的工具介绍', tags: ['paper', 'editorial'],
    tokens: source.tokens,
    targetConfig: { ...source.social, templatePack: { id: 'neon-v1', version: 1 }, templateMatch: { source: 'user-selected' } },
    designSummary: [{ title: '印刷感', description: '纸张、衬线与来源账页' }],
  };
  const result = composeAiThemeDefinition(candidate, { target: 'social', id: 'ai-paper-tool', templateMatchContext: { preferences: { tone: ['editorial'] } } });
  assert.equal(result.definition.social.templatePack.id, 'editorial-v1');
  assert.equal(result.definition.social.templateMatch.source, 'program-recommended');
  assert.equal(result.definition.social.templateMatch.packId, 'editorial-v1');
});

test('Phase 2 新建、复制和导入 Social 主题都会补齐模板匹配', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'social-template-matching-'));
  const store = new Store(path.join(root, 'themes.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const legacy = socialDefinition('ice-blue');
  delete legacy.social.templatePack;
  const saved = saveThemeDraft(store, { id: 'custom-terminal', target: 'social', definition: { ...legacy, label: '终端主题', tags: ['terminal', 'mono'] } });
  assert.ok(saved.social.templatePack);
  assert.equal(saved.social.templateMatch.source, 'program-recommended');
  assert.equal(saved.social.templatePack.id, 'neon-v1');
  const clone = cloneTheme(store, { sourceId: 'neon', id: 'copy-neon', label: '霓虹副本' });
  assert.equal(clone.social.templatePack.id, 'neon-v1');
  assert.equal(clone.social.templateMatch.source, 'inherited');
  const imported = importThemeDraft(store, { definition: { ...legacy, id: 'imported-paper', label: '编辑导入', tags: ['paper', 'editorial'] } });
  assert.equal(imported.theme.social.templatePack.id, 'editorial-v1');
  assert.equal(imported.theme.social.templateMatch.source, 'program-recommended');
});

test('Phase 2 文章和封面主题不写入 Social 模板匹配字段', () => {
  const article = structuredClone(registry.get('magazine-warm'));
  const cover = structuredClone(registry.get('cover-navy-gold'));
  assert.equal(article.social, undefined);
  assert.equal(cover.social, undefined);
});
