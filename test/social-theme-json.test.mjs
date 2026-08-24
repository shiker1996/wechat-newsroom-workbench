import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { renderStoryboardHtml } from '../server/features/social-cards/application/social-card-pipeline.mjs';
import { compileSocialTheme, socialThemeDefinition } from '../server/shared/themes/social-theme-compiler.mjs';
import { getBuiltinThemeRegistry } from '../server/shared/themes/theme-registry.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('阶段 3 的 14 个图文主题均由 JSON 编译为变量、配方和版本元数据',()=>{
  const themes=getBuiltinThemeRegistry().list({target:'social'});
  assert.equal(themes.length,14);
  for(const definition of themes){
    const compiled=compileSocialTheme(definition);
    assert.equal(compiled.id,definition.id);
    assert.equal(compiled.version,definition.version);
    assert.equal(compiled.hash,definition.hash);
    assert.match(compiled.css,new RegExp(`\\.theme-${definition.id}\\{--bg:#[0-9a-f]{6};--page:#[0-9a-f]{6};--surface:#[0-9a-f]{6}`));
    assert.ok(compiled.className.startsWith(`theme-${definition.id}`));
    assert.ok(Object.isFrozen(compiled));
  }
});

test('阶段 3 生成 HTML 只注入当前主题 CSS 和不可变主题引用',()=>{
  const html=renderStoryboardHtml({topic:'JSON 图文主题',visualStyle:'tokyo-night',pages:[{kind:'cover',title:'封面'},{kind:'ending',title:'结束'}]});
  const definition=socialThemeDefinition('tokyo-night',{fallback:false});
  assert.match(html,/<body class="theme-tokyo-night theme-palette" data-visual-style="tokyo-night" data-theme-version="1\.0\.1" data-theme-hash="sha256:[0-9a-f]{64}"/);
  assert.match(html,/\.theme-tokyo-night\{--bg:#16161e;--page:#1a1b26;/);
  assert.doesNotMatch(html,/\.theme-solarized\{/);
  assert.ok(html.includes(`data-theme-hash="${definition.hash}"`));
});

test('阶段 3 图文渲染器不再维护主题白名单、主题色或内嵌主题类',()=>{
  const source=fs.readFileSync(path.join(root,'server','features','social-cards','application','social-card-pipeline.mjs'),'utf8');
  assert.doesNotMatch(source,/const themes\s*=|themes\.includes/);
  assert.doesNotMatch(source,/\.theme-(?:tokyo-night|solarized|retro-terminal|paper-craft|charcoal|peach|orange|mocha|lavender|crimson|bone-white|neon|brutalist)\{/);
  for(const color of ['#16161e','#00ff41','#ff9ab8','#ff7a00','#967bb6','#ff2d55'])assert.doesNotMatch(source,new RegExp(color,'i'));
  assert.match(source,/social-theme-snapshot\.json/);
});

test('阶段 3 默认主题仍为 ice-blue，未知主题不再静默回退',()=>{
  assert.equal(socialThemeDefinition('ice-blue',{fallback:false}).label,'冰川冷调');
  assert.equal(socialThemeDefinition('missing',{fallback:false}),null);
  assert.equal(socialThemeDefinition('missing',{fallback:true}).id,'ice-blue');
  assert.throws(()=>compileSocialTheme('missing'),/未知图文视觉主题/);
  assert.throws(()=>renderStoryboardHtml({topic:'错误主题',visualStyle:'missing',pages:[{kind:'cover',title:'封面'}]}),/未知图文视觉主题/);
});
