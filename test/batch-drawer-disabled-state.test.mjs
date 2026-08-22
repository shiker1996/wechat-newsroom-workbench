import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('采集失败阻断按钮有明确的置灰禁用态', () => {
  const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const disabledRule = styles.match(/\.primary-button:disabled\s+\{([^}]*)\}/);
  assert.ok(disabledRule, '缺少 primary-button 的 disabled 样式');
  assert.match(disabledRule[1], /background\s*:/, '禁用态应使用灰色背景');
  assert.match(disabledRule[1], /cursor\s*:\s*not-allowed/, '禁用态应显示不可点击光标');
  assert.match(disabledRule[1], /box-shadow\s*:\s*none/, '禁用态不应保留按钮阴影');
  assert.match(styles, /\.primary-button:disabled:hover\s*\{[^}]*transform\s*:\s*none/, '禁用态悬停不应产生位移');
});
