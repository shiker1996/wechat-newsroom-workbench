import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('切换主视图时回到顶部，刷新当前视图时保留滚动位置', () => {
  const source = fs.readFileSync(new URL('../public/src/main.js', import.meta.url), 'utf8');
  assert.match(source, /const previousView = document\.querySelector\("\.nav-item\.active,\.nav-utility\.active"\)\?\.dataset\.view/);
  assert.match(source, /const isViewChange = previousView !== view/);
  assert.match(source, /if \(isViewChange\) \{[\s\S]*?scrollTop = 0;[\s\S]*?scrollLeft = 0;/);
});
