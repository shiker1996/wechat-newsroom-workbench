import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditThemeForPublish, assertThemePublishable } from '../lib/themes/theme-publish-gate.mjs';
import { articleThemeDefinition } from '../lib/themes/article-theme-compiler.mjs';
import { socialThemeDefinition } from '../lib/themes/social-theme-compiler.mjs';
import { handleThemeRoutes } from '../lib/http/routes/theme-routes.mjs';

function userCopy(definition,id){const value=structuredClone(definition);delete value.hash;delete value.file;value.id=id;value.source='user';value.status='draft';return value;}

test('阶段 5 文章和图文发布前通过结构、对比度、覆盖、HTML 与布局五项门禁',()=>{
  for(const [target,definition] of [['article',userCopy(articleThemeDefinition('magazine-warm'),'gate-article')],['social',userCopy(socialThemeDefinition('ice-blue'),'gate-social')]]){
    const report=auditThemeForPublish(definition,{target});assert.equal(report.valid,true);assert.deepEqual(report.checks,{schema:true,contrast:true,coverage:true,html:true,layout:true});assert.doesNotThrow(()=>assertThemePublishable(definition,{target}));
  }
});

test('阶段 5 发布失败定位具体字段和固定样稿节点',()=>{
  const definition=userCopy(articleThemeDefinition('magazine-warm'),'bad-contrast');definition.tokens.colors.codeBackground='#FFFFFF';
  const report=auditThemeForPublish(definition,{target:'article'});assert.equal(report.valid,false);const issue=report.issues.find((item)=>item.code==='LOW_CONTRAST'&&item.specimenNode==='code');assert.equal(issue.field,'tokens.colors.inverseText');assert.throws(()=>assertThemePublishable(definition,{target:'article'}),/code 样稿节点/);
});

test('图文用户主题限制视觉参数上限并阻止多项参数同时偏大',()=>{
  const tooLarge=userCopy(socialThemeDefinition('ice-blue'),'social-too-large');tooLarge.tokens.typography.h1Px=35;
  const rangeReport=auditThemeForPublish(tooLarge,{target:'social'});assert.ok(rangeReport.issues.some((item)=>item.field==='tokens.typography.h1Px'&&item.code==='OUT_OF_RANGE'));
  const dense=userCopy(socialThemeDefinition('ice-blue'),'social-too-dense');Object.assign(dense.tokens.typography,{bodyPx:13,h1Px:34,h2Px:18,captionPx:11,lineHeight:1.55});Object.assign(dense.tokens.spacing,{articlePaddingPx:28,sectionPx:28,paragraphPx:12,cardGapPx:14});
  const densityReport=auditThemeForPublish(dense,{target:'social'});assert.ok(densityReport.issues.some((item)=>item.field==='tokens.spacing.sectionPx'&&item.code==='SOCIAL_DENSITY_BUDGET'));
});

test('阶段 5 旧结构主题只生成兼容报告而不迁移定义',()=>{
  const legacy=userCopy(articleThemeDefinition('magazine-warm'),'legacy-theme');delete legacy.tokens.typography.h1Px;const before=JSON.stringify(legacy),report=auditThemeForPublish(legacy,{target:'article'});assert.equal(report.compatible,false);assert.equal(report.checks.schema,false);assert.equal(JSON.stringify(legacy),before);assert.ok(report.issues.some((item)=>item.field==='tokens.typography.h1Px'));
});

test('阶段 5 主题中心提供只读兼容报告并将发布错误定位到字段',()=>{
  const ui=fs.readFileSync(new URL('../public/src/views/theme-manager.js',import.meta.url),'utf8'),styles=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
  assert.match(ui,/editorMode==='read-only'/);assert.match(ui,/旧主题只读兼容报告/);assert.match(ui,/该草稿不会被原地迁移/);assert.match(ui,/control\?\.closest\('details'\)/);assert.match(ui,/control\?\.focus\(\)/);assert.match(styles,/\.theme-compat-report\.legacy/);
});

test('阶段 5 网络层保留服务端结构化发布问题',()=>{const http=fs.readFileSync(new URL('../public/src/core/http.js',import.meta.url),'utf8');assert.match(http,/error\.issues=data\.issues\|\|\[\]/);});

test('阶段 5 用户主题详情按兼容结果切换完整编辑与只读模式',async()=>{
  const definition=userCopy(articleThemeDefinition('magazine-warm'),'legacy-route');delete definition.tokens.typography.h1Px;const row={id:'legacy-route',label:'旧主题',target:'article',status:'draft',active_version:null,active_version_id:null,active_definition_json:null,active_hash:null,draft_json:JSON.stringify(definition)};let result;
  await handleThemeRoutes({request:{method:'GET'},response:{},pathname:'/api/themes/legacy-route',searchParams:new URLSearchParams(),store:{getUserTheme:()=>row},json:(_response,status,data)=>{result={status,data};}});
  assert.equal(result.status,200);assert.equal(result.data.editorMode,'read-only');assert.equal(result.data.compatibility.compatible,false);assert.equal(JSON.parse(row.draft_json).tokens.typography.h1Px,undefined);
});
