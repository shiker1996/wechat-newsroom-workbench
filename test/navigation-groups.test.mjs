import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('侧栏按五个任务阶段组织并自动展开当前阶段', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../public/src/main.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  for (const label of ['今日工作', '发现与研判', '文章生产', '图文生产', '资产与审计']) {
    assert.match(html, new RegExp(label));
  }
  assert.equal((html.match(/class="nav-group"/g) || []).length, 5);
  assert.equal((html.match(/class="nav-item/g) || []).length, 17);
  assert.match(html, /class="nav-utility" data-view="system"/);
  assert.match(html, /服务 · 环境 · 备份/);
  assert.match(main, /group\.open = Boolean\(activeNavItem && group\.contains\(activeNavItem\)\)/);
  assert.match(main, /setAttribute\("aria-current", "page"\)/);
  assert.match(styles, /\.nav-group>summary/);
  assert.match(styles, /\.rail nav \{ flex:none;max-height:240px/);
  assert.ok(html.indexOf('class="rail-foot"') < html.indexOf('class="nav-utility" data-view="system"'));
  assert.match(styles,/nav \{ flex:1;min-height:0/);
});

test('运行配置页区分服务状态、环境参数与本地恢复', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../public/src/main.js', import.meta.url), 'utf8');
  const system = fs.readFileSync(new URL('../public/src/views/system.js', import.meta.url), 'utf8');
  assert.match(html, /class="runtime-commandbar"/);
  assert.match(html, /class="system-workspace"/);
  assert.match(html, /class="maintenance-panel"/);
  assert.doesNotMatch(html, /control-card backup-card/);
  assert.match(main, /system: "运行与配置中心"/);
  assert.match(html,/class="config-tabbar"/);
  assert.match(html,/data-config-panel="app"/);
  assert.match(html,/data-config-panel="rsshub"/);
  assert.match(system,/function selectConfigTab/);
});
