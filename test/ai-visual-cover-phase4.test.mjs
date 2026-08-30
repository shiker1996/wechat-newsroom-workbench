import assert from 'node:assert/strict';
import test from 'node:test';

import { getBuiltinThemeRegistry } from '../server/shared/themes/theme-registry.mjs';
import { loadCoverAiDesignSpec } from '../server/shared/themes/cover-ai-spec.mjs';
import { buildAiVisualCoverScaffold, buildCoverVisualInput } from '../server/features/articles/application/ai-visual-cover-composer.mjs';
import { loadSkillBundle } from '../server/platform/llm/skill-runtime.mjs';

test('Phase 4：10 套内置封面主题可提供 AI 视觉设计规范', () => {
  const themes = getBuiltinThemeRegistry().list({ target: 'cover' });
  assert.equal(themes.length, 10);
  for (const theme of themes) {
    const spec = loadCoverAiDesignSpec({ workspaceRoot: process.cwd(), theme, allowFallback: false });
    assert.equal(spec.ok, true, `${theme.id}: ${JSON.stringify(spec.issues)}`);
    const input = buildCoverVisualInput({ title: '测试标题', summary: '样张摘要', brand: '测试账号 · 2026.08', theme });
    assert.deepEqual(input.canvas, { width: 900, height: 383, selector: '.page' });
    assert.deepEqual(input.output, { html: 'ai-cover.html', image: 'cover.png' });
  }
  assert.match(buildAiVisualCoverScaffold(), /data-render-mode="ai-visual-cover"/);
});

test('AI 封面技能加载布局、契约和语义组件三份内置参考', () => {
  const bundle = loadSkillBundle({ workspaceRoot: process.cwd(), skillName: 'article-cover-ai-visual-generator' });
  assert.equal(bundle.fallback, false);
  assert.match(bundle.prompt, /cover-layout-guide\.md/);
  assert.match(bundle.prompt, /cover-visual-contract\.md/);
  assert.match(bundle.prompt, /cover-visual-component-mapping\.md/);
  assert.match(bundle.prompt, /禁止自行创造以下信息[\s\S]*期号/);
  assert.match(bundle.prompt, /构图位置、方向、视觉面板和具体组件由模型自行判断/);
  assert.match(bundle.prompt, /标题、摘要和信息行必须完整落在画布内/);
  assert.match(bundle.prompt, /视觉隐喻候选中选择或组合方向/);
  assert.match(bundle.prompt, /连续、有层次、有面积和视觉重量/);
  assert.doesNotMatch(bundle.prompt, /compositionHint/);
  assert.doesNotMatch(bundle.prompt, /secondaryFocus/);
});
