import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const ui=fs.readFileSync(new URL('../public/src/views/theme-manager.js',import.meta.url),'utf8');
const styles=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');

test('阶段 3 主题中心持续开放完整字体字阶、间距和形状字段',()=>{
  for(const group of ['typography','spacing','shape'])assert.match(ui,new RegExp(`${group}:\\{label:`));
  for(const field of ['family','headingFamily','bodyPx','h1Px','h2Px','captionPx','lineHeight','letterSpacingEm','articlePaddingPx','sectionPx','paragraphPx','cardGapPx','radiusPx','borderWidthPx','shadow'])assert.match(ui,new RegExp(`'${field}'`));
});

test('阶段 3 数值控件提供同步滑杆、精确输入、单位和 Schema 边界',()=>{
  assert.match(ui,/type="range" min="\$\{min\}" max="\$\{max\}" step="\$\{step\}"/);
  assert.match(ui,/type="number" min="\$\{min\}" max="\$\{max\}" step="\$\{step\}"/);
  assert.match(ui,/socialTokenLimits=\{bodyPx:\[9,13\],h1Px:\[22,34\]/);
  assert.match(ui,/document\.querySelectorAll\(`#user-theme-form \[data-token-pair=/);
  for(const range of ["['bodyPx','正文字号','number',9,18", "['h1Px','一级标题','number',22,44", "['articlePaddingPx','页面内边距','number',0,40", "['radiusPx','圆角','number',0,32", "['borderWidthPx','边线宽度','number',0,8"])assert.ok(ui.includes(range),range);
});

test('阶段 3 支持分组恢复、即时本地校验和生产影响高亮',()=>{
  assert.match(ui,/data-reset-token-group/);
  assert.match(ui,/editorBaseline\.tokens\[group\]/);
  assert.match(ui,/\[data-theme-field\]:invalid/);
  assert.match(ui,/schedulePreview\(field,0\)/);
});

test('阶段 3 控件在窄屏收为单列且保留键盘原生控件',()=>{
  assert.match(styles,/@media\(max-width:760px\)\{\.theme-token-grid\{grid-template-columns:1fr\}/);
  assert.match(styles,/\.theme-token-field:focus-within/);
  assert.match(ui,/<details class="theme-token-section"/);
  assert.match(ui,/<select data-theme-field/);
});

test('字间距兼容内置文章主题并在字段旁显示原生校验错误',()=>{
  assert.match(ui,/\['letterSpacingEm','字间距','number',-\.08,\.2,\.005,'em'\]/);
  assert.match(ui,/class="theme-field-error"/);
  assert.match(ui,/input\.validity\.stepMismatch/);
  assert.match(ui,/请先修正左侧标出的配置项/);
  assert.match(styles,/\.theme-token-field\.invalid \.theme-field-error\{display:block\}/);
});
