import { readStyles } from "./style-fixture.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';
import { cloneTheme, exportWorkspaceTheme, importThemeDraft, normalizeImportedTheme, publishTheme, restoreThemeVersion, saveThemeDraft, resolveWorkspaceTheme } from '../server/platform/application/themes/user-theme-service.mjs';
import { handleThemeRoutes, themeCatalog } from '../server/platform/http/routes/theme-routes.mjs';
import { compileArticleTheme } from '../server/shared/themes/article-theme-compiler.mjs';

function workspace(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'user-theme-'));const store=new Store(path.join(dir,'themes.db'));t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return store;}

test('阶段 5 用户主题支持复制、草稿、发布、版本恢复和归档',t=>{
  const store=workspace(t);const draft=cloneTheme(store,{sourceId:'magazine-warm',id:'my-warm',label:'我的暖刊'});assert.equal(draft.status,'draft');assert.equal(draft.source,'user');
  const edited=structuredClone(draft);edited.tokens.colors.accent='#8A3D24';saveThemeDraft(store,{id:'my-warm',target:'article',definition:edited});
  const first=publishTheme(store,'my-warm');assert.equal(first.version,'0.1.0');assert.equal(first.tokens.colors.accent,'#8A3D24');assert.equal(store.userThemeVersions('my-warm').length,1);
  edited.tokens.colors.accent='#245E73';saveThemeDraft(store,{id:'my-warm',target:'article',definition:edited});const second=publishTheme(store,'my-warm');assert.equal(second.version,'0.2.0');assert.equal(store.userThemeVersions('my-warm').length,2);
  const resolved=resolveWorkspaceTheme(store,'my-warm','article');assert.equal(compileArticleTheme(resolved).tokens.colors.accent,'#245E73');assert.ok(themeCatalog('article',undefined,store).items.some((item)=>item.id==='my-warm'&&item.source==='user'));
  restoreThemeVersion(store,'my-warm','0.1.0');assert.equal(store.getUserTheme('my-warm').status,'published');assert.equal(JSON.parse(store.getUserTheme('my-warm').draft_json).tokens.colors.accent,'#8A3D24');
  store.archiveUserTheme('my-warm');assert.equal(resolveWorkspaceTheme(store,'my-warm','article'),null);assert.equal(store.userThemeVersions('my-warm').length,2);
});

test('阶段 5 用户主题不能覆盖内置主题，非法颜色和低对比度不能保存',t=>{
  const store=workspace(t);const base=cloneTheme(store,{sourceId:'ice-blue',id:'my-social',label:'我的冷调'});
  assert.throws(()=>saveThemeDraft(store,{id:'ice-blue',target:'social',definition:base}),/不能覆盖内置主题/);
  const unsafe=structuredClone(base);unsafe.tokens.colors.accent='url(javascript:1)';assert.throws(()=>saveThemeDraft(store,{id:'unsafe-theme',target:'social',definition:unsafe}),/六位十六进制颜色/);
  const low=structuredClone(base);low.tokens.colors.text=low.tokens.colors.background;assert.throws(()=>saveThemeDraft(store,{id:'low-theme',target:'social',definition:low}),/对比度/);
});

test('复制主题可直接通过校验，运行期 hash 不进入严格 Schema',async t=>{
  const store=workspace(t);cloneTheme(store,{sourceId:'magazine-warm',id:'validate-copy',label:'可校验副本'});let result;
  await handleThemeRoutes({request:{method:'POST'},response:{},pathname:'/api/themes/validate-copy/validate',searchParams:new URLSearchParams(),store,json:(_response,status,data)=>{result={status,data};}});
  assert.equal(result.status,200);assert.equal(result.data.valid,true);assert.deepEqual(result.data.issues,[]);
});

test('阶段 5 数据库保留定义与不可变版本双表',t=>{const store=workspace(t);const tables=new Set(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row)=>row.name));assert.ok(tables.has('theme_definitions'));assert.ok(tables.has('theme_versions'));});

test('阶段 5 管理界面提供完整发布操作且生产选择器支持刷新用户主题',()=>{const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),ui=fs.readFileSync(new URL('../public/src/views/theme-manager.js',import.meta.url),'utf8');for(const id of ['clone-theme','validate-user-theme','publish-user-theme','archive-user-theme','restore-user-theme'])assert.match(html,new RegExp(`id="${id}"`));for(const removed of ['preview-user-theme','save-user-theme']){assert.doesNotMatch(html,new RegExp(`id="${removed}"`));assert.doesNotMatch(ui,new RegExp(removed));}assert.match(ui,/invalidateThemeCatalog/);assert.match(ui,/hydrateThemePickers/);});

test('阶段 6 支持安全导入导出、兼容升级提示和重复 ID 防护',t=>{const store=workspace(t),source=exportWorkspaceTheme(store,'magazine-warm');delete source.schemaVersion;source.id='imported-warm';source.label='导入暖刊';const normalized=normalizeImportedTheme(source);assert.equal(normalized.definition.schemaVersion,1);assert.equal(normalized.warnings[0].code,'SCHEMA_INFERRED');const imported=importThemeDraft(store,{definition:source});assert.equal(imported.theme.id,'imported-warm');assert.equal(exportWorkspaceTheme(store,'imported-warm',{draft:true}).source,'user');assert.throws(()=>importThemeDraft(store,{definition:source}),/已存在/);assert.throws(()=>normalizeImportedTheme({...source,schemaVersion:99}),/不支持主题 Schema/);});

test('阶段 6 记录版本级使用统计并给出归档和物理删除影响',t=>{const store=workspace(t);cloneTheme(store,{sourceId:'magazine-warm',id:'used-theme',label:'已使用主题'});const theme=publishTheme(store,'used-theme');store.recordThemeUsage({themeId:theme.id,version:theme.version,target:'article',source:'user',batchId:'batch-a',candidateId:1});store.recordThemeUsage({themeId:theme.id,version:theme.version,target:'article',source:'user',batchId:'batch-a',candidateId:2});const stats=store.themeUsageStats(theme.id),impact=store.themeArchiveImpact(theme.id);assert.equal(stats.usageCount,2);assert.equal(stats.batchCount,1);assert.equal(impact.physicalDeleteAllowed,false);store.archiveUserTheme(theme.id);assert.equal(store.themeArchiveImpact(theme.id).canArchive,false);});

test('阶段 6 管理界面提供 JSON 导入导出、使用统计和归档影响确认',()=>{const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),ui=fs.readFileSync(new URL('../public/src/views/theme-manager.js',import.meta.url),'utf8');for(const id of ['import-theme-file','export-user-theme','user-theme-usage'])assert.match(html,new RegExp(`id="${id}"`));assert.match(ui,/archive-impact/);assert.match(ui,/\/usage/);});

test('阶段 6 主题中心默认收起已归档主题并显示归档数量',()=>{const ui=fs.readFileSync(new URL('../public/src/views/theme-manager.js',import.meta.url),'utf8'),css=readStyles();assert.match(ui,/status!==['"]archived['"]/);assert.match(ui,/user-theme-archived-group/);assert.match(ui,/已归档/);assert.match(ui,/archivedItems\.length/);assert.match(css,/user-theme-archived-group/);});
