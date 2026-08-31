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
  assert.equal((html.match(/class="nav-item/g) || []).length, 22);
  assert.match(html, /data-view="material-inbox">素材入箱/);
  assert.match(html, /data-view="wechat-review">公众号复盘/);
  assert.match(html, /data-view="artifacts">产物中心/);
  assert.match(html, /data-view="publication">发布中心/);
  assert.match(html, /data-view="wechat-review">公众号复盘/);
  assert.match(html, /id="quick-material-button">＋ 快速记素材/);
  assert.match(html, /id="quick-material-dialog"/);
  assert.match(main, /bindQuickMaterialCapture/);
  assert.ok(html.indexOf('data-view="publication"') < html.indexOf('data-view="artifacts"'));
  assert.ok(html.indexOf('data-view="material-inbox"') < html.indexOf('data-view="skills"'));
  assert.ok(html.indexOf('data-view="wechat-review"') < html.indexOf('data-view="skills"'));
  assert.match(html,/data-view="topics">文章选题池/);
  assert.match(html,/data-view="editorial">热点事件/);
  assert.match(html, /class="nav-utility" data-view="system"/);
  assert.match(html, /class="rail-utility-group" aria-label="扩展与定制"/);
  assert.match(html, /class="rail-utility-group rail-maintenance-group" aria-label="系统维护"/);
  for (const view of ['skills', 'themes', 'models']) assert.match(html, new RegExp(`class="nav-utility" data-view="${view}"`));
  assert.ok(html.indexOf('data-view="skills"') < html.indexOf('data-view="themes"'));
  assert.ok(html.indexOf('data-view="themes"') < html.indexOf('data-view="models"'));
  assert.match(html, /服务 · 环境 · 备份/);
  assert.match(main, /group\.open = Boolean\(activeNavItem && group\.contains\(activeNavItem\)\)/);
  assert.match(main, /setAttribute\("aria-current", "page"\)/);
  assert.match(main, /\.nav-item\.active,\.nav-utility\.active/);
  assert.match(styles, /\.nav-group>summary/);
  assert.match(styles, /\.rail nav \{ flex:none;max-height:240px/);
  assert.ok(html.indexOf('data-view="models"') < html.indexOf('data-view="system"'));
  assert.ok(html.indexOf('data-view="system"') < html.indexOf('class="rail-foot"'));
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
  assert.doesNotMatch(html,/configuration-console-strip/);
  assert.doesNotMatch(html,/data-config-panel="app"/);
  assert.match(html,/id="config-panel-extensions"/);
  assert.doesNotMatch(html,/data-config-panel="rsshub"/);
  assert.doesNotMatch(system,/selectConfigTab\("extensions"\)/);
});
