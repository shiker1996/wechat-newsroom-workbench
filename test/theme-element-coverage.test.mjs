import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { articleThemeDefinition, compileArticleTheme } from '../server/shared/themes/article-theme-compiler.mjs';
import { compileSocialTheme, socialThemeDefinition } from '../server/shared/themes/social-theme-compiler.mjs';
import { themeConfigLeafPaths, unconsumedThemeConfigFields } from '../server/platform/application/themes/theme-publish-gate.mjs';

const matrix=JSON.parse(fs.readFileSync(new URL('./fixtures/theme-element-coverage.json',import.meta.url),'utf8'));
const sourcePattern=/^(token|recipe|fixed):.+$|^not-applicable$/;

test('P0 元素消费矩阵完整登记图文节点的六类样式来源',()=>{
  assert.equal(matrix.schemaVersion,1);assert.equal(matrix.target,'social');
  const roles=new Set();
  for(const [element,entry] of Object.entries(matrix.elements)){
    assert.ok(entry.label&&entry.selector&&entry.specimenRole,element);
    assert.ok(!roles.has(entry.specimenRole),`重复样稿角色：${entry.specimenRole}`);roles.add(entry.specimenRole);
    assert.deepEqual(Object.keys(entry.currentSources).sort(),[...matrix.aspects].sort(),`${element} 必须登记六类样式来源`);
    for(const [aspect,sources] of Object.entries(entry.currentSources)){
      assert.ok(Array.isArray(sources)&&sources.length,`${element}.${aspect} 来源不能为空`);
      for(const source of sources)assert.match(source,sourcePattern,`${element}.${aspect} 来源格式非法`);
    }
  }
});

test('P0 当前 token 与配方来源都由正式图文编译器消费',()=>{
  const compiled=compileSocialTheme(socialThemeDefinition('ice-blue'));
  const referenced=new Set(Object.values(matrix.elements).flatMap((entry)=>Object.values(entry.currentSources).flat()).filter((source)=>/^(token|recipe):/.test(source)).map((source)=>source.slice(source.indexOf(':')+1)));
  for(const field of referenced)assert.ok(compiled.usageMap[field]?.length,`${field} 未进入正式 usageMap`);
});

test('P0 每个计划字段都绑定已登记的正式样稿节点与实施阶段',()=>{
  const roles=new Set(Object.values(matrix.elements).map((entry)=>entry.specimenRole));
  for(const [field,entry] of Object.entries(matrix.plannedFields)){
    assert.match(field,/^social\.components\.[a-zA-Z]+\.[a-zA-Z]+$/);
    assert.ok(['P1','P2','P3'].includes(entry.phase),field);
    assert.ok(roles.has(entry.specimenRole),`${field} 缺少正式样稿节点`);
  }
});

test('P1 已实施组件字段全部进入正式图文 usageMap',()=>{
  const compiled=compileSocialTheme(socialThemeDefinition('ice-blue'));
  for(const [field,entry] of Object.entries(matrix.plannedFields).filter(([,value])=>value.status==='implemented'))assert.ok(compiled.usageMap[field]?.includes(entry.specimenRole),`${field} 未映射到 ${entry.specimenRole}`);
});

test('P0 两类主题的每个现有配置叶子字段都进入正式 usageMap',()=>{
  for(const [target,definition,compiled] of [
    ['article',articleThemeDefinition('magazine-warm'),compileArticleTheme(articleThemeDefinition('magazine-warm'))],
    ['social',socialThemeDefinition('ice-blue'),compileSocialTheme(socialThemeDefinition('ice-blue'))],
  ]){
    assert.deepEqual(unconsumedThemeConfigFields(definition,target,compiled.usageMap),[],`${target} 存在未消费字段`);
    assert.ok(themeConfigLeafPaths(definition,target).length>30);
  }
});

test('P0 未消费字段检查能够识别 Schema 已接受但编译映射缺失的字段',()=>{
  const definition=socialThemeDefinition('ice-blue'),compiled=compileSocialTheme(definition),usageMap=structuredClone(compiled.usageMap);
  delete usageMap['social.effects.texture'];
  assert.deepEqual(unconsumedThemeConfigFields(definition,'social',usageMap),['social.effects.texture']);
});
