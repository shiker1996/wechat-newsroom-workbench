import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildAiThemeMessages, normalizeAiThemeCandidate } from '../lib/themes/ai-theme-generator.mjs';
import { compileSocialTheme, socialThemeDefinition } from '../lib/themes/social-theme-compiler.mjs';
import { compileThemePreview } from '../lib/themes/theme-preview.mjs';
import { renderStoryboardHtml, deterministicCoverTitleLines, normalizeCoverTitleLines } from '../lib/llm/social-card-pipeline.mjs';
import { validateThemeDefinition } from '../lib/themes/theme-validator.mjs';
import { skipBrowser } from './helpers/tiers.mjs';

const recipes=['classic','editorial','poster','highlight-block'];
const builtinAssignments={
  classic:['charcoal','ice-blue','lavender','peach'],
  editorial:['bone-white','mocha','paper-craft','solarized'],
  poster:['brutalist','crimson','orange'],
  'highlight-block':['neon','retro-terminal','tokyo-night'],
};
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const execFileAsync=promisify(execFile);

function themeWithCoverTitle(value){
  const definition=structuredClone(socialThemeDefinition('ice-blue'));
  delete definition.hash;delete definition.file;
  delete definition.social.templatePack;
  definition.social.recipes.coverTitle=value;
  return definition;
}

async function assertNoOverflow(definition,label,dir){
  const htmlPath=path.join(dir,`${label}.html`),reportPath=path.join(dir,`${label}.json`);
  fs.writeFileSync(htmlPath,compileThemePreview({target:'social',definition}).html,'utf8');
  await execFileAsync(process.execPath,[path.join(root,'skills','xiaohongshu-article-generator','scripts','layout-audit.mjs'),htmlPath,'--json',reportPath],{cwd:dir,windowsHide:true}).catch(()=>{});
  const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
  const overflow=report.pages.flatMap((page)=>page.issues||[]).filter((issue)=>['overflow','clipped','horizontal_overflow','overfilled'].includes(issue));
  assert.deepEqual(overflow,[],`${label}: ${JSON.stringify(report.pages)}`);
}

test('旧图文主题缺少 coverTitle 时保持兼容并按 classic 编译',()=>{
  const legacy=structuredClone(socialThemeDefinition('ice-blue'));
  delete legacy.hash;delete legacy.file;delete legacy.social.recipes.coverTitle;
  assert.doesNotThrow(()=>validateThemeDefinition(legacy,{expectedTarget:'social'}));
  const compiled=compileSocialTheme(legacy);
  assert.equal(compiled.recipes.coverTitle,'classic');
  assert.match(compiled.css,/\.page-cover h1\{[^}]+border-left:2px solid var\(--accent\)/);
  assert.doesNotMatch(compiled.css,/text-shadow:3px 3px 0 var\(--accent2\)|\.cover-title-line/);
});

test('14 个内置图文主题按视觉语言分配四种封面标题',()=>{
  for(const [recipe,ids] of Object.entries(builtinAssignments))for(const id of ids){
    assert.equal(socialThemeDefinition(id).social.recipes.coverTitle,recipe,`${id} 应使用 ${recipe}`);
  }
  assert.equal(Object.values(builtinAssignments).flat().length,14);
});

test('四种封面标题配方只向 page-cover h1 输出受控样式',()=>{
  for(const recipe of recipes){
    const compiled=compileSocialTheme(themeWithCoverTitle(recipe));
    assert.equal(compiled.recipes.coverTitle,recipe);
    assert.equal(compiled.usageMap['social.recipes.coverTitle'][0],'cover-title');
    if(recipe!=='classic'){
      const signature=recipe==='editorial'?'border-top:4px double':recipe==='poster'?'text-shadow:3px 3px':'.cover-title-line';
      const rules=[...compiled.css.matchAll(/([^{}]+)\{[^{}]*\}/g)].filter((match)=>match[0].includes(signature));
      assert.ok(rules.length,`${recipe} 应输出独立样式`);
      assert.ok(rules.every((match)=>match[1].includes('.page-cover h1')),`${recipe} 不得影响内容页或结束页标题`);
    }
    assert.doesNotMatch(compiled.css,/(?:^|[;{])position\s*:\s*absolute|(?:^|[;{])height\s*:/);
  }
});

test('四种配方形成可辨认的标题版式语言',()=>{
  const css=Object.fromEntries(recipes.map((recipe)=>[recipe,compileSocialTheme(themeWithCoverTitle(recipe)).css]));
  assert.match(css.classic,/border-left:2px solid var\(--accent\)/);assert.match(css.classic,/max-width:96%/);
  assert.match(css.editorial,/border-top:4px double var\(--ink\)/);assert.match(css.editorial,/font-family:Georgia/);
  assert.match(css.poster,/text-shadow:3px 3px 0 var\(--accent2\)/);assert.match(css.poster,/border-bottom:4px solid var\(--accent\)/);
  assert.match(css['highlight-block'],/\.cover-title-line:nth-child\(even\)/);assert.match(css['highlight-block'],/background:var\(--code\);color:var\(--ink\)/);
  const html=compileThemePreview({target:'social',definition:themeWithCoverTitle('highlight-block')}).html;
  assert.equal((html.match(/class="cover-title-line"/g)||[]).length,3);
  const twoLine=renderStoryboardHtml({topic:'封面标题十一个字刚好',visualStyle:'neon',pages:[{kind:'cover',title:'封面标题十一个字刚好',content_blocks:[]}]});
  assert.equal((twoLine.match(/class="cover-title-line"/g)||[]).length,2);
  assert.match(html.replace(/<[^>]+>/g,''),/如何把复杂的技术内容讲得清楚又准确/);
});

test('封面标题 AI 语义断行：校验、优先使用与代码兜底',()=>{
  assert.deepEqual(normalizeCoverTitleLines('用 LangChain 编排智能体工作流',['用 LangChain','编排智能体工作流']),['用 LangChain','编排智能体工作流']);
  assert.equal(normalizeCoverTitleLines('轻量级工作流编排引擎',['轻量级','引擎']),null);
  assert.equal(normalizeCoverTitleLines('轻量级工作流编排引擎',['轻量级工作流编排引擎']),null);
  assert.equal(normalizeCoverTitleLines('轻量级工作流编排引擎',['轻量级','','工作流编排引擎']),null);
  const ai=renderStoryboardHtml({topic:'用 LangChain 编排智能体工作流',visualStyle:'neon',coverTitleLines:['用 LangChain','编排智能体工作流'],pages:[{kind:'cover',title:'用 LangChain 编排智能体工作流',content_blocks:[]}]});
  assert.ok(ai.includes('<span class="cover-title-line">用 LangChain</span><span class="cover-title-line">编排智能体工作流</span>'));
  const fallback=renderStoryboardHtml({topic:'轻量级工作流编排引擎',visualStyle:'neon',coverTitleLines:['轻量级','引擎'],pages:[{kind:'cover',title:'轻量级工作流编排引擎',content_blocks:[]}]});
  assert.equal((fallback.match(/class="cover-title-line"/g)||[]).length,2);
});

test('封面标题确定性兜底不拆开英文专名和数字片段',()=>{
  const title='告别聊天改稿：可视化编辑 HTML/Markdown，一键反馈给 AI';
  const lines=deterministicCoverTitleLines(title);
  assert.deepEqual(lines,['告别聊天改稿：','可视化编辑','HTML/Markdown，','一键反馈给 AI']);
  assert.equal(lines.join('').replace(/\s+/g,''),title.replace(/\s+/g,''));
  const html=renderStoryboardHtml({topic:title,visualStyle:'lavender',pages:[{kind:'cover',title,content_blocks:[]} ]});
  assert.match(html,/class="clean-title-line">HTML\/Markdown，<\/span>/);
  assert.doesNotMatch(html,/class="clean-title-line">[^<]*H[^<]*<\/span><span class="clean-title-line">TML/);
});

test('四个图文模板的封面 kicker 与内容页对齐且正文组居中',()=>{
  const cases=[
    ['lavender','template-clean-v1'],
    ['paper-craft','template-editorial-v1'],
    ['brutalist','template-brutalist-v1'],
    ['neon','template-neon-v1'],
  ];
  for(const [visualStyle,templateClass] of cases){
    const html=renderStoryboardHtml({topic:'封面标题',visualStyle,pages:[{kind:'cover',title:'封面标题',content_blocks:[]}]});
    assert.match(html,new RegExp(`\\.${templateClass}\\.page-cover \\.page-content-stack\\{justify-content:flex-start`),`${visualStyle} 封面 kicker 应保持顶部对齐`);
    assert.match(html,new RegExp(`\\.${templateClass}\\.page-cover h1\\{margin-top:auto;margin-bottom:0`),`${visualStyle} 封面正文组应在剩余空间居中`);
  }
});

test('正式长标题样稿可预览且封面字段聚焦到封面标题',()=>{
  for(const recipe of recipes){
    const preview=compileThemePreview({target:'social',definition:themeWithCoverTitle(recipe),highlightField:'social.recipes.coverTitle'});
    assert.match(preview.html,/width:375px;height:667px;overflow:hidden/);
    assert.match(preview.html.replace(/<[^>]+>/g,''),/如何把复杂的技术内容讲得清楚又准确/);
    assert.match(preview.html,/\.page-cover h1\{outline:3px solid/);
  }
});

test('四种封面标题在 375×667 正式样稿中无溢出',async(t)=>{
  if(skipBrowser(t))return;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'theme-cover-title-'));
  try{for(const recipe of recipes)await assertNoOverflow(themeWithCoverTitle(recipe),recipe,dir);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('14 个内置主题的封面标题在 375×667 正式样稿中无溢出',async(t)=>{
  if(skipBrowser(t))return;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'theme-cover-title-builtins-'));
  try{for(const id of Object.values(builtinAssignments).flat())await assertNoOverflow(socialThemeDefinition(id),id,dir);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('AI 图文主题提示强制白名单 coverTitle，缺失和非法值被规范化',()=>{
  const system=buildAiThemeMessages({target:'social',prompt:'创建一个清晰克制且适合技术教程的图文视觉主题',preferences:{}})[0].content;
  assert.match(system,/coverTitle 必须显式选择一个白名单配方/);
  assert.match(system,/"coverTitle"/);
  for(const value of [undefined,'.page-cover h1{position:absolute}']){
    const input={targetConfig:{recipes:{coverTitle:value}}};
    const normalized=normalizeAiThemeCandidate(input,{target:'social'});
    assert.equal(normalized.candidate.targetConfig.recipes.coverTitle,'classic');
  }
});
