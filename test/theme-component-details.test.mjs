import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { SOCIAL_COMPONENT_CATALOG, resolveSocialComponents, socialComponentDefaults } from '../server/shared/themes/component-catalog.mjs';
import { normalizeAiThemeCandidate, buildAiThemeMessages } from '../server/platform/application/themes/ai-theme-generator.mjs';
import { compileSocialTheme, socialThemeDefinition } from '../server/shared/themes/social-theme-compiler.mjs';
import { compileThemePreview } from '../server/platform/application/themes/theme-preview.mjs';
import { auditThemeForPublish } from '../server/platform/application/themes/theme-publish-gate.mjs';
import { validateThemeDefinition } from '../server/shared/themes/theme-validator.mjs';
import { skipBrowser } from './helpers/tiers.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),execFileAsync=promisify(execFile);
function userTheme(){const value=structuredClone(socialThemeDefinition('ice-blue'));delete value.hash;delete value.file;value.id='component-details';value.source='user';value.status='draft';value.social.components=socialComponentDefaults(value.social.recipes);return value;}

test('P1 组件目录只开放受控字体、字重、字号档位和语义颜色',()=>{
  assert.deepEqual(Object.keys(SOCIAL_COMPONENT_CATALOG),['coverTitle','eyebrow','lead','statValue','statLabel','step','compareTable','list','note','contentTitle','endingTitle']);
  for(const entry of Object.values(SOCIAL_COMPONENT_CATALOG))for(const field of Object.values(entry.fields)){assert.ok(field.options.length>=3);assert.ok(field.options.every((option)=>option.label&&['string','number'].includes(typeof option.value)));}
  const invalid=userTheme();invalid.social.components.coverTitle.fontFamily='Custom Font';invalid.social.components.coverTitle.colorRole='#FF00FF';
  assert.throws(()=>validateThemeDefinition(invalid,{expectedTarget:'social'}),(error)=>error.issues.some((item)=>item.field==='social.components.coverTitle.fontFamily'&&item.code==='ENUM')&&error.issues.some((item)=>item.field==='social.components.coverTitle.colorRole'&&item.code==='ENUM'));
  const schema=JSON.parse(fs.readFileSync(new URL('../themes/schema/theme.schema.json',import.meta.url),'utf8'));assert.deepEqual(schema.properties.social.properties.components.properties.coverTitle.required,['fontFamily','fontWeight','sizeScale','colorRole','borderColorRole']);
});

test('P1 编译器将组件属性严格作用于封面标题、眉题和封面导语',()=>{
  const value=userTheme();value.social.components={coverTitle:{fontFamily:'mono',fontWeight:500,sizeScale:'display',colorRole:'accentSecondary',borderColorRole:'line'},eyebrow:{fontFamily:'serif',fontWeight:600,colorRole:'text'},lead:{sizeScale:'compact',colorRole:'accent'}};
  const compiled=compileSocialTheme(value);
  assert.match(compiled.css,/\.page-cover h1\{font-family:Consolas[^}]*font-weight:500[^}]*font-size:36px[^}]*color:var\(--accent2\)[^}]*border-color:var\(--line\)/);
  assert.match(compiled.css,/\.eyebrow\{font-family:Georgia[^}]*font-weight:600[^}]*color:var\(--ink\)/);
  assert.match(compiled.css,/\.page-cover \.lead\{font-size:11px;color:var\(--accent\)/);
  for(const path of ['social.components.coverTitle.fontFamily','social.components.coverTitle.fontWeight','social.components.coverTitle.sizeScale','social.components.coverTitle.colorRole','social.components.coverTitle.borderColorRole','social.components.eyebrow.fontFamily','social.components.eyebrow.fontWeight','social.components.eyebrow.colorRole','social.components.lead.sizeScale','social.components.lead.colorRole'])assert.ok(compiled.usageMap[path]?.length,path);
});

test('P1 正式预览按组件字段精确高亮对应节点',()=>{
  const value=userTheme();
  assert.match(compileThemePreview({target:'social',definition:value,highlightField:'social.components.coverTitle.fontWeight'}).html,/\.page-cover h1\{outline:3px solid/);
  assert.match(compileThemePreview({target:'social',definition:value,highlightField:'social.components.eyebrow.colorRole'}).html,/\.eyebrow\{outline:3px solid/);
  assert.match(compileThemePreview({target:'social',definition:value,highlightField:'social.components.lead.sizeScale'}).html,/\.page-cover \.lead\{outline:3px solid/);
});

test('P1 AI 候选显式补齐组件属性并修复任意值与低对比颜色角色',()=>{
  const base=socialThemeDefinition('ice-blue'),candidate={label:'组件主题',description:'测试安全组件属性',tags:['test'],tokens:structuredClone(base.tokens),targetConfig:structuredClone(base.social),designSummary:[{title:'组件细节',description:'使用安全枚举'}]};
  candidate.targetConfig.components={coverTitle:{fontFamily:'url(font)',fontWeight:550,sizeScale:'huge',colorRole:'inverseText',borderColorRole:'pink'},eyebrow:{fontFamily:'inherit',fontWeight:700,colorRole:'inverseText'},lead:{sizeScale:'standard',colorRole:'inverseText'}};
  const result=normalizeAiThemeCandidate(candidate,{target:'social'}),components=result.candidate.targetConfig.components;
  assert.deepEqual(Object.keys(components),['coverTitle','eyebrow','lead','statValue','statLabel','step','compareTable','list','note','contentTitle','endingTitle']);assert.equal(components.coverTitle.fontFamily,'inherit');assert.equal(components.coverTitle.fontWeight,700);assert.equal(components.coverTitle.sizeScale,'standard');assert.equal(components.coverTitle.borderColorRole,'accent');
  assert.notEqual(components.eyebrow.colorRole,'inverseText');assert.notEqual(components.lead.colorRole,'inverseText');assert.ok(result.repairs.some((item)=>item.field.startsWith('targetConfig.components.')));
  const prompt=buildAiThemeMessages({target:'social',prompt:'创建一套克制清晰但有明显封面字体层次的技术图文主题',preferences:{}})[0].content;assert.match(prompt,/组件属性目录/);assert.match(prompt,/不得输出任意字体、颜色或尺寸/);
});

test('P2 数据、步骤、对比表、列表和提示框使用受控组件属性',()=>{
  const value=userTheme();Object.assign(value.social.components,{statValue:{fontFamily:'mono',fontWeight:500,sizeScale:'display',colorRole:'accentSecondary'},statLabel:{sizeScale:'display',colorRole:'text'},step:{titleColorRole:'accent',bodyColorRole:'text',markerSurfaceRole:'codeBackground'},compareTable:{headerTextColorRole:'inverseText',headerSurfaceRole:'codeBackground',bodyTextColorRole:'accent',borderColorRole:'accentSecondary'},list:{textColorRole:'inverseText',surfaceRole:'codeBackground',borderColorRole:'accent',borderWeight:'heavy'},note:{textColorRole:'inverseText',surfaceRole:'codeBackground',borderColorRole:'accentSecondary',borderWeight:'medium'}});
  const compiled=compileSocialTheme(value);
  assert.match(compiled.css,/\.stat b\{font-family:Consolas[^}]*font-weight:500[^}]*font-size:24px[^}]*color:var\(--accent2\)/);
  assert.match(compiled.css,/\.step h3\{color:var\(--accent\)/);assert.match(compiled.css,/\.step>b\{background:var\(--code\)/);
  assert.match(compiled.css,/\.compare-block th\{color:var\(--inverse\);background:var\(--code\)/);
  assert.match(compiled.css,/\.page li\{color:var\(--inverse\);border-color:var\(--accent\);background:var\(--code\);border-width:4px/);
  assert.match(compiled.css,/\.note-block\{border-left-color:var\(--accent2\);background:var\(--code\);border-left-width:2px/);
  for(const component of ['statValue','statLabel','step','compareTable','list','note'])for(const key of Object.keys(value.social.components[component]))assert.ok(compiled.usageMap[`social.components.${component}.${key}`]?.length,`${component}.${key}`);
});

test('P2 固定样稿包含全部新增组件并支持字段高亮',()=>{
  const value=userTheme(),html=compileThemePreview({target:'social',definition:value,highlightField:'social.components.compareTable.borderColorRole'}).html;
  for(const marker of ['class="stat-row"','class="step-col"','class="content-block compare-block"','class="content-block list-block"','class="content-block note-block"'])assert.ok(html.includes(marker),marker);
  assert.match(html,/\.compare-block table\{outline:3px solid/);
});

test('P3 内容页与结尾页标题可独立设置字体、字号和颜色',()=>{
  const value=userTheme();value.social.components.contentTitle={fontFamily:'serif',sizeScale:'compact',colorRole:'accentSecondary'};value.social.components.endingTitle={fontFamily:'mono',sizeScale:'display',colorRole:'inverseText'};
  const compiled=compileSocialTheme(value);
  assert.match(compiled.css,/\.page:not\(\.page-cover\):not\(\.page-ending\) h1\{font-family:Georgia[^}]*font-size:29px;color:var\(--accent2\)/);
  assert.match(compiled.css,/\.page-ending h1\{font-family:Consolas[^}]*font-size:36px;color:var\(--inverse\)/);
  for(const component of ['contentTitle','endingTitle'])for(const key of ['fontFamily','sizeScale','colorRole'])assert.ok(compiled.usageMap[`social.components.${component}.${key}`]?.length,`${component}.${key}`);
  assert.match(compileThemePreview({target:'social',definition:value,highlightField:'social.components.contentTitle.fontFamily'}).html,/\.page:not\(\.page-cover\):not\(\.page-ending\) h1\{outline:3px solid/);
  assert.match(compileThemePreview({target:'social',definition:value,highlightField:'social.components.endingTitle.colorRole'}).html,/\.page-ending h1\{outline:3px solid/);
});

test('P3 标题展示档参与固定画布密度预算，低对比颜色被发布门禁拒绝',()=>{
  const dense=userTheme();Object.assign(dense.tokens.typography,{h1Px:34,h2Px:18,bodyPx:13});dense.social.components.contentTitle.sizeScale='display';assert.throws(()=>validateThemeDefinition(dense,{expectedTarget:'social'}),(error)=>error.issues.some((item)=>item.field==='social.components.contentTitle.sizeScale'&&item.code==='SOCIAL_COMPONENT_DENSITY_BUDGET'));
  const low=userTheme();low.social.components.contentTitle.colorRole='inverseText';const report=auditThemeForPublish(low,{target:'social'});assert.ok(report.issues.some((item)=>item.field==='social.components.contentTitle.colorRole'&&item.code==='LOW_COMPONENT_CONTRAST'));
});

test('P1 发布门禁拒绝组件低对比色和超出固定画布密度预算的组合',()=>{
  const low=userTheme();low.social.components.coverTitle.colorRole='inverseText';const lowReport=auditThemeForPublish(low,{target:'social'});assert.ok(lowReport.issues.some((item)=>item.field==='social.components.coverTitle.colorRole'&&item.code==='LOW_COMPONENT_CONTRAST'));
  const dense=userTheme();Object.assign(dense.tokens.typography,{h1Px:34,h2Px:18,bodyPx:13});dense.social.components.coverTitle.sizeScale='display';assert.throws(()=>validateThemeDefinition(dense,{expectedTarget:'social'}),(error)=>error.issues.some((item)=>item.code==='SOCIAL_COMPONENT_DENSITY_BUDGET'));
});

test('强调色块配方下封面标题文字低对比时门禁给出可操作提示，编辑器随配方联动文字颜色',()=>{
  const stale=userTheme();stale.social.recipes.coverTitle='highlight-block';stale.social.components.coverTitle.colorRole='text';
  const report=auditThemeForPublish(stale,{target:'social'});
  const hit=report.issues.find((item)=>item.field==='social.components.coverTitle.colorRole'&&item.code==='LOW_COMPONENT_CONTRAST');
  assert.ok(hit,'应检出强调色块下的低对比文字');
  assert.match(hit.message,/反色/);assert.match(hit.message,/恢复配方推荐值/);
  const source=fs.readFileSync(new URL('../public/src/views/theme-manager.js',import.meta.url),'utf8');
  assert.match(source,/social\.recipes\.coverTitle/);assert.match(source,/highlight-block'&&colorRole\.value==='text'/);assert.match(source,/colorRole\.value='inverseText'/);
});

test('P1 旧主题无 components 时保持配方默认效果并可继续编译',()=>{
  const legacy=structuredClone(socialThemeDefinition('mocha'));delete legacy.hash;delete legacy.file;delete legacy.social.components;assert.doesNotThrow(()=>validateThemeDefinition(legacy,{expectedTarget:'social'}));const resolved=resolveSocialComponents(legacy);assert.equal(resolved.coverTitle.fontFamily,'serif');assert.equal(resolved.coverTitle.colorRole,'text');assert.match(compileSocialTheme(legacy).css,/\.page-cover h1/);
});

test('P1 展示档封面文字在 375×667 长标题样稿中无溢出',async(t)=>{
  if(skipBrowser(t))return;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'theme-components-p1-'));
  try{const value=userTheme();value.tokens.spacing.paragraphPx=8;value.social.components.coverTitle.sizeScale='display';value.social.components.coverTitle.fontFamily='serif';value.social.components.lead.sizeScale='display';const htmlPath=path.join(dir,'preview.html'),reportPath=path.join(dir,'report.json');fs.writeFileSync(htmlPath,compileThemePreview({target:'social',definition:value}).html,'utf8');await execFileAsync(process.execPath,[path.join(root,'skills','xiaohongshu-article-generator','scripts','layout-audit.mjs'),htmlPath,'--json',reportPath],{cwd:dir,windowsHide:true}).catch(()=>{});const report=JSON.parse(fs.readFileSync(reportPath,'utf8')),overflow=report.pages.flatMap((page)=>page.issues||[]).filter((issue)=>['overflow','clipped','horizontal_overflow','overfilled'].includes(issue));assert.deepEqual(overflow,[],JSON.stringify(report.pages));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('P1 主题中心展示三组组件细节并保留原生键盘控件',()=>{
  const ui=fs.readFileSync(new URL('../public/src/views/theme-manager.js',import.meta.url),'utf8'),styles=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8'),routes=fs.readFileSync(new URL('../server/platform/http/routes/theme-routes.mjs',import.meta.url),'utf8');assert.match(ui,/function componentEditor/);assert.match(ui,/组件细节/);assert.match(ui,/data-reset-components/);assert.match(ui,/\$\{target\}\.components\.\$\{component\}\.\$\{key\}/);assert.match(styles,/\.theme-component-grid/);assert.match(styles,/@media\(max-width:1050px\)\{\.theme-component-grid\{grid-template-columns:1fr/);assert.match(routes,/socialComponentEditorCatalog\(draft\.social\?\.recipes\)/);assert.match(routes,/articleComponentEditorCatalog\(draft\.article\?\.recipes\)/);
});
