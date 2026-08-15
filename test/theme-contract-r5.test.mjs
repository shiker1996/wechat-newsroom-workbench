import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { articleThemeDefinition } from '../lib/themes/article-theme-compiler.mjs';
import { compileArticleTheme } from '../lib/themes/article-theme-compiler.mjs';
import { compileSocialTheme, socialThemeDefinition } from '../lib/themes/social-theme-compiler.mjs';
import { auditThemeForPublish } from '../lib/themes/theme-publish-gate.mjs';
import { validateThemeDefinition } from '../lib/themes/theme-validator.mjs';

function editable(definition,id){const value=structuredClone(definition);delete value.hash;delete value.file;value.id=id;value.source='user';value.status='draft';return value;}

test('R5.1 运行时校验与 Schema 一致要求 behavior 和 effects',()=>{
  const article=editable(articleThemeDefinition('magazine-warm'),'missing-behavior');delete article.article.behavior;
  assert.throws(()=>validateThemeDefinition(article,{expectedTarget:'article'}),(error)=>error.issues.some((item)=>item.field==='article.behavior'&&item.code==='REQUIRED'));
  const social=editable(socialThemeDefinition('mocha'),'missing-effects');delete social.social.effects;
  assert.throws(()=>validateThemeDefinition(social,{expectedTarget:'social'}),(error)=>error.issues.some((item)=>item.field==='social.effects'&&item.code==='REQUIRED'));
});

test('R5.1 编译器对绕过校验的旧定义仍使用稳定默认值',()=>{
  const article=structuredClone(articleThemeDefinition('magazine-warm'));delete article.article.behavior;
  assert.deepEqual(compileArticleTheme(article).variants.justify,false);
  const social=structuredClone(socialThemeDefinition('mocha'));delete social.social.effects;
  const css=compileSocialTheme(social).css;
  assert.match(css,/--decoration-opacity:0\.35/);assert.doesNotMatch(css,/NaN|undefined/);
});

test('R5.1 导入主题的离散数值必须符合编辑器步长',()=>{
  const social=editable(socialThemeDefinition('mocha'),'bad-number-step');social.social.effects.decorationOpacity=.333;
  assert.throws(()=>validateThemeDefinition(social,{expectedTarget:'social',enforceNumericSteps:true}),(error)=>error.issues.some((item)=>item.field==='social.effects.decorationOpacity'&&item.code==='STEP_MISMATCH'));
  social.social.effects.decorationOpacity=.35;social.tokens.typography.lineHeight=1.43;
  assert.throws(()=>validateThemeDefinition(social,{expectedTarget:'social',enforceNumericSteps:true}),(error)=>error.issues.some((item)=>item.field==='tokens.typography.lineHeight'&&item.code==='STEP_MISMATCH'));
});

test('R5.1 Schema 登记 codePx 并声明与编辑器一致的步长',()=>{
  const schema=JSON.parse(fs.readFileSync(new URL('../themes/schema/theme.schema.json',import.meta.url),'utf8'));
  assert.equal(schema.properties.tokens.properties.typography.properties.codePx.multipleOf,1);
  assert.equal(schema.properties.tokens.properties.typography.properties.lineHeight.multipleOf,.05);
  assert.equal(schema.properties.social.properties.effects.properties.contentTiltDeg.minimum,-2);
});

test('R5.1 neon 半透明内容面按合成后的实际背景计算对比度',()=>{
  const social=editable(socialThemeDefinition('neon'),'neon-composited-contrast');
  Object.assign(social.tokens.colors,{background:'#000000',page:'#FFFFFF',surface:'#000000',text:'#777777'});
  const report=auditThemeForPublish(social,{target:'social'}),item=report.issues.find((entry)=>entry.code==='LOW_CONTRAST'&&entry.specimenNode==='content surface');
  assert.equal(item?.details?.background,'#171717');
});
