import { readStyles } from "./style-fixture.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../public/src/views/theme-manager.js', import.meta.url), 'utf8');
const styles = readStyles();
const plan = fs.readFileSync(new URL('../docs/design/social-card-template-authoring-ai-assist-plan.md', import.meta.url), 'utf8');

test('Phase 1 Social 主题编辑器展示匹配置信度与低置信度原因', () => {
  assert.match(ui, /匹配置信度/);
  assert.match(ui, /reasonLabels/);
  assert.match(ui, /theme-template-suggestion/);
  assert.match(ui, /当前使用标准兼容模板/);
  assert.match(ui, /confidenceLabels=\{high:'高',medium:'中',low:'低'\}/);
});

test('Phase 1 提供继续使用兼容模板和创建模板提案入口', () => {
  assert.match(ui, /data-template-continue/);
  assert.match(ui, /继续使用标准兼容模板/);
  assert.match(ui, /data-create-template-proposal/);
  assert.match(ui, /openTemplateProposalCreator/);
  assert.match(ui, /target:'social'/);
});

test('Phase 1 继续使用兼容模板只更新草稿选择，不改变渲染链路', () => {
  assert.match(ui, /select\.value='standard-v1'/);
  assert.match(ui, /select\.dispatchEvent\(new Event\('input'/);
  assert.match(ui, /已选择标准兼容模板，保存草稿后生效/);
  assert.match(plan, /低置信度建议仅改变主题管理器交互，不改变现有模板解析、故事板生成和图文渲染路径/);
});

test('Phase 1 低置信度建议具有可区分的视觉状态', () => {
  assert.match(styles, /\.theme-template-confidence\.low/);
  assert.match(styles, /\.theme-template-suggestion/);
  assert.match(styles, /\.theme-template-suggestion button/);
});
