import { readStyles } from "./style-fixture.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('主题选择拥有独立入口和视觉化选择器，同时保留原生表单契约', () => {
  const html = read('public', 'index.html');
  assert.match(html, /data-view="themes"/);
  assert.match(html, /id="view-themes"/);
  assert.match(html, /data-theme-browser="article"/);
  assert.match(html, /data-theme-browser="social"/);
  assert.match(html, /id="theme-picker-dialog"/);
  assert.match(html, /id="theme-picker-grid"/);
  assert.match(html, /id="typeset-theme"/);
  assert.match(html, /data-theme-picker="article"/);
  assert.match(html, /id="social-visual-style"/);
  assert.match(html, /data-theme-picker="social"/);
});

test('主题卡片先暂选后确认，并同步到原有 select change 流程', () => {
  const source = read('public', 'src', 'core', 'theme-catalog.js');
  assert.match(source, /data-theme-choice/);
  assert.match(source, /confirm-theme-picker/);
  assert.match(source, /dispatchEvent\(new Event\('change'/);
  assert.match(source, /data-theme-filter/);
  assert.match(source, /theme-ui-sync/);
});

test('主题中心作为独立页面加载，不再附着在系统配置模块', () => {
  const main = read('public', 'src', 'main.js');
  const system = read('public', 'src', 'views', 'system.js');
  assert.match(main, /themes:\s*"\.\/views\/theme-manager\.js"/);
  assert.doesNotMatch(system, /theme-manager/);
});

test('生产编辑器使用与相邻控件等高的紧凑主题按钮', () => {
  const styles = readStyles();
  const source = read('public', 'src', 'core', 'theme-catalog.js');
  assert.match(styles, /\.social-theme-picker:has\(#social-theme-trigger\)\{align-content:stretch\}/);
  assert.match(styles, /#social-theme-trigger\{width:100%;height:35px\}/);
  assert.match(styles, /\.typeset-toolbar #typeset-theme-trigger,\.typeset-toolbar #cover-theme-trigger\{width:170px;height:44px\}/);
  assert.match(styles, /#typeset-theme-preview,#social-theme-preview,#typeset-theme-meta,#social-theme-meta\{display:none\}/);
  assert.match(styles, /content:'更换 →'/);
  assert.match(source, /textContent='主题'/);
  assert.match(source, /setAttribute\('aria-label',`更换主题/);
});
