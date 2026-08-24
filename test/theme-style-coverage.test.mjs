import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ARTICLE_THEME_RECIPES, SOCIAL_THEME_RECIPES } from '../server/shared/themes/recipe-catalog.mjs';

const root=new URL('..',import.meta.url);
const coverage=JSON.parse(fs.readFileSync(new URL('./fixtures/theme-style-coverage.json',import.meta.url),'utf8'));
const schema=JSON.parse(fs.readFileSync(new URL('../themes/schema/theme.schema.json',import.meta.url),'utf8'));
const status=new Set(['complete','partial','missing','not_applicable']);

function ids(target){
  const dir=new URL(`../themes/${target}/`,import.meta.url);
  return fs.readdirSync(dir).filter((name)=>name.endsWith('.json')).map((name)=>path.basename(name,'.json')).sort();
}

test('阶段0覆盖清单精确登记全部内置主题',()=>{
  assert.deepEqual(coverage.themeIds.article,ids('article'));
  assert.deepEqual(coverage.themeIds.social,ids('social'));
});

test('阶段0覆盖矩阵追踪Schema中的每个基础token',()=>{
  const groups=schema.properties.tokens.properties;
  for(const [group,definition] of Object.entries(groups)){
    assert.deepEqual(Object.keys(coverage.tokens[group]).sort(),Object.keys(definition.properties).sort(),`${group}字段必须完整登记`);
    for(const [field,targets] of Object.entries(coverage.tokens[group])){
      assert.ok(status.has(targets.article),`${group}.${field}.article状态有效`);
      assert.ok(status.has(targets.social),`${group}.${field}.social状态有效`);
    }
  }
});

test('阶段0覆盖矩阵追踪文章与图文全部配方组',()=>{
  assert.deepEqual(Object.keys(coverage.recipes.article).sort(),Object.keys(ARTICLE_THEME_RECIPES).sort());
  assert.deepEqual(Object.keys(coverage.recipes.social).sort(),Object.keys(SOCIAL_THEME_RECIPES).sort());
  for(const target of ['article','social'])for(const value of Object.values(coverage.recipes[target]))assert.ok(status.has(value));
});

test('每个内置主题只使用配方目录允许的值',()=>{
  for(const target of ['article','social']){
    const catalog=target==='article'?ARTICLE_THEME_RECIPES:SOCIAL_THEME_RECIPES;
    for(const id of ids(target)){
      const theme=JSON.parse(fs.readFileSync(new URL(`../themes/${target}/${id}.json`,import.meta.url),'utf8'));
      for(const [group,value] of Object.entries(theme[target].recipes))assert.ok(catalog[group]?.includes(value),`${id}.${group}=${value}`);
    }
  }
});

