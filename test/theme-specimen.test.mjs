import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const catalog=fs.readFileSync(new URL('../public/src/core/theme-catalog.js',import.meta.url),'utf8');
const manager=fs.readFileSync(new URL('../public/src/views/theme-manager.js',import.meta.url),'utf8');
const styles=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');

test('主题中心样稿覆盖边线、反白文字和代码表现',()=>{
  for(const token of ['sample-rule','sample-inverse','<code>'])assert.match(catalog,new RegExp(token));
  for(const token of ['/api/themes/preview','frame.srcdoc=result.html','主题正式编译样稿'])assert.match(manager,new RegExp(token));
  assert.match(styles,/\.theme-choice-sample code/);
  assert.match(styles,/\.user-theme-live-preview iframe/);
});

test('主题实时预览提交全部颜色并使用正式生产返回值',()=>{
  for(const token of ['accentSecondary','line','inverseText','codeBackground'])assert.match(manager,new RegExp(token));
  assert.match(manager,/definition:definition\(\),highlightField/);
  assert.match(manager,/frame\.srcdoc=result\.html/);
  assert.doesNotMatch(manager,/colorContrast|--p-code|--p-inverse/);
});

test('图文主题预览不再维护背景、画布和内容表面的第二套解释',()=>{
  assert.doesNotMatch(manager,/--p-bg|--p-page|--p-surface/);
  assert.doesNotMatch(manager,/theme-live-bordered/);
  assert.match(manager,/target:active\.target/);
  assert.match(manager,/input\.closest\('label'\)\?\.querySelector\('code'\)\?\.replaceChildren\(input\.value\.toUpperCase\(\)\)/);
});
