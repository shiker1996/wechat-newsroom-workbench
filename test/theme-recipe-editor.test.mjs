import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ARTICLE_THEME_RECIPES, SOCIAL_THEME_RECIPES, themeRecipeEditorCatalog } from '../server/shared/themes/recipe-catalog.mjs';
import { compileThemePreview } from '../server/platform/application/themes/theme-preview.mjs';
import { articleThemeDefinition } from '../server/shared/themes/article-theme-compiler.mjs';
import { socialThemeDefinition } from '../server/shared/themes/social-theme-compiler.mjs';
import { validateThemeDefinition } from '../server/shared/themes/theme-validator.mjs';

const ui=fs.readFileSync(new URL('../public/src/views/theme-manager.js',import.meta.url),'utf8');
const styles=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');

test('阶段 4 配方目录为全部文章和图文枚举提供中文元数据及样稿角色',()=>{
  for(const [target,recipes] of Object.entries({article:ARTICLE_THEME_RECIPES,social:SOCIAL_THEME_RECIPES})){
    const catalog=themeRecipeEditorCatalog(target);assert.deepEqual(Object.keys(catalog),Object.keys(recipes));
    for(const [group,values] of Object.entries(recipes)){assert.ok(catalog[group].label);assert.ok(catalog[group].specimenRole);assert.deepEqual(catalog[group].options.map((item)=>item.value),values);for(const option of catalog[group].options)assert.ok(option.label&&option.description);}
  }
});

test('阶段 4 编辑器按目标读取服务端配方目录并开放对应效果',()=>{
  assert.match(ui,/active\.editorCatalog\?\.recipes/);
  assert.match(ui,/data-theme-field="\$\{target\}\.recipes\.\$\{key\}"/);
  for(const field of ['article.behavior.justify','article.behavior.numberSections','article.behavior.highlightStrong','social.effects.texture'])assert.ok(ui.includes(field),field);
  for(const effect of ['decorationOpacity','contentTiltDeg'])assert.match(ui,new RegExp(`effectNumber\\('${effect}'`));
  assert.match(ui,/data-theme-field="social\.effects\.\$\{key\}"/);
  assert.doesNotMatch(ui,/gridTemplate|pageOrder|contentOrder|storyboardGrid/);
});

test('阶段 4 配方字段高亮正式固定样稿对应组件',()=>{
  const definition=articleThemeDefinition('magazine-warm');
  const preview=compileThemePreview({target:'article',definition,highlightField:'article.recipes.quote'});
  assert.match(preview.html,/section\{outline:3px solid/);
});

test('阶段 4 配方控件保持响应式、键盘原生控件和配置恢复',()=>{
  assert.match(styles,/@media\(max-width:760px\)\{\.theme-recipe-grid\{grid-template-columns:1fr\}/);
  assert.match(styles,/\.theme-recipe-field:focus-within/);
  assert.match(ui,/data-reset-config/);
  assert.match(ui,/editorBaseline\[button\.dataset\.resetConfig\]/);
});

test('阶段 4 目录中的每个配方值都能通过 Schema 并生成正式固定样稿',()=>{
  for(const [target,base,recipes] of [['article',articleThemeDefinition('magazine-warm'),ARTICLE_THEME_RECIPES],['social',socialThemeDefinition('ice-blue'),SOCIAL_THEME_RECIPES]]){
    for(const [group,values] of Object.entries(recipes))for(const value of values){const definition=structuredClone(base);delete definition.hash;delete definition.file;definition[target].recipes[group]=value;validateThemeDefinition(definition,{expectedTarget:target});const preview=compileThemePreview({target,definition});assert.match(preview.html,/<html/);assert.equal(preview.target,target);}
  }
});
