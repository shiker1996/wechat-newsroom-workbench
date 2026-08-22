import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadSkillBundle, selectSkillPromptReferences } from '../lib/llm/skill-runtime.mjs';
import { SOCIAL_CARD_COMPOSITION_MODES, SOCIAL_CARD_LAYOUTS, SOCIAL_CARD_STAGE_CONTRACT, cardPageDensity, cardPlanRepairStructureIssues, describeCardLayouts, inferCardPageRole, normalizeCardComposition, renderStoryboardHtml as renderStoryboardHtmlBase, resolveCardCompositionDecision, resolveCardLayout, resolveCardLayoutDecision, stableCardCompositionSeed, underfilledDensityTier, underfilledPageIndexes, layoutAuditFailureMessage } from '../lib/llm/social-card-pipeline.mjs';
import { createZip } from '../lib/artifacts/zip-bundle.mjs';
import { skipBrowser } from './helpers/tiers.mjs';
import { socialThemeDefinition } from '../lib/themes/social-theme-compiler.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const execFileAsync = promisify(execFile);

function legacyTheme(id='peach') {
  const definition=structuredClone(socialThemeDefinition(id));
  delete definition.social.templatePack;
  delete definition.hash;delete definition.file;
  return definition;
}

// 这些构图断言验证的是迁移前 standard-v1 的骨架；批次 B/C 的新主题单独由 Phase 6 测试覆盖。
function renderStoryboardHtml(options={}){
  if ((!options.visualStyle || options.visualStyle==='peach') && !options.themeDefinition) options={...options,visualStyle:'peach',themeDefinition:legacyTheme()};
  return renderStoryboardHtmlBase(options);
}

test('图文管线在内部使用版式白名单时建立本地 ESM 绑定', () => {
  const pipeline = fs.readFileSync(path.join(root, 'lib', 'llm', 'social-card-pipeline.mjs'), 'utf8');
  assert.match(pipeline, /import \{ SOCIAL_CARD_LAYOUTS \} from '\.\.\/rendering\/social-card-layout\.mjs';/);
  assert.match(pipeline, /layout_style:SOCIAL_CARD_LAYOUTS\.includes/);
});

test('故事板保存通过共享类型判断解析结构化内容，不引用未定义常量', () => {
  const editor = fs.readFileSync(path.join(root, 'public', 'src', 'views', 'social-editor.js'), 'utf8');
  const model = fs.readFileSync(path.join(root, 'public', 'src', 'views', 'social-editor-model.js'), 'utf8');
  assert.match(editor, /import \{[^}]*isStructuredCardBlockType[^}]*\} from "\.\/social-editor-model\.js"/);
  assert.match(editor, /if\(isStructuredCardBlockType\(type\)\)Object\.assign/);
  assert.doesNotMatch(editor, /CARD_STRUCTURED_BLOCK_TYPES/);
  assert.match(model, /export function isStructuredCardBlockType\(type\)/);
});

test('图文生成任务结束后按故事板门禁恢复生成按钮',()=>{
  const editor=fs.readFileSync(path.join(root,'public','src','views','social-editor.js'),'utf8');
  assert.match(editor,/generate\.disabled=!gate\.ready\|\|themeBlocked/);
  assert.match(editor,/const ready=generate\.dataset\.ready!=='false';[\s\S]*generate\.disabled=!ready;/);
  assert.match(editor,/job && job\.status === 'completed'\) \{ generate\.textContent = '重新生成整组图文'; return; \}/);
});

test('项目图文技能加载完整文案、标题、设计与布局契约', () => {
  const bundle = loadSkillBundle({ workspaceRoot:root, skillName:'xiaohongshu-article-generator' });
  assert.equal(bundle.fallback, false);
  for (const name of ['SKILL.md','COPY_GUIDE.md','TITLE_GUIDE.md','DESIGN_SYSTEM.md','references\\layout-contract.md']) {
    assert.ok(bundle.files.some((file) => file.endsWith(name)), `missing ${name}`);
  }
  assert.match(bundle.prompt, /布局审计/);
  assert.match(bundle.prompt, /375/);
});

test('生成交付技能按阶段和内容类型选择 reference',()=>{
  const bundle=loadSkillBundle({workspaceRoot:root,skillName:'xiaohongshu-article-generator'});
  const eventCopy=selectSkillPromptReferences(bundle.prompt,{
    include:['COPY_GUIDE.md','references\\copy-event.md'],
  });
  assert.match(eventCopy,/事件图文配套文案规则/);
  assert.match(eventCopy,/不可变系统安全门禁/);
  assert.doesNotMatch(eventCopy,/工具图文配套文案规则/);
  assert.doesNotMatch(eventCopy,/自定义图文配套文案规则/);
  assert.doesNotMatch(eventCopy,/小红书图文布局契约/);
  assert.doesNotMatch(eventCopy,/## REFERENCE: COLOR_SCHEMES_PREVIEW\.md/);

  const customRepair=selectSkillPromptReferences(bundle.prompt,{
    include:['DESIGN_SYSTEM.md','references\\layout-contract.md','references\\copy-custom.md'],
  });
  assert.match(customRepair,/自定义图文配套文案规则/);
  assert.match(customRepair,/小红书图文布局契约/);
  assert.match(customRepair,/设计系统/);
  assert.doesNotMatch(customRepair,/事件图文配套文案规则/);
  assert.doesNotMatch(customRepair,/## REFERENCE: TITLE_GUIDE\.md/);
});

test('智能版式按页面角色与内容块选择不同构图',()=>{
  assert.deepEqual(SOCIAL_CARD_LAYOUTS,['auto','poster','editorial','data','checklist','steps','minimal']);
  assert.equal(resolveCardLayout({kind:'cover'}),'poster');
  assert.equal(resolveCardLayout({kind:'ending'}),'minimal');
  assert.equal(resolveCardLayout({content_blocks:[{type:'stats'}]}),'data');
  assert.equal(resolveCardLayout({content_blocks:[{type:'steps'}]}),'steps');
  assert.equal(resolveCardLayout({content_blocks:[{type:'list'}]}),'checklist');
  assert.equal(resolveCardLayout({content_blocks:[{type:'list'}]},'auto','xiaohongshu'),'checklist');
  assert.equal(resolveCardLayout({content_blocks:[{type:'text'}]}),'editorial');
  assert.equal(resolveCardLayout({kind:'quickstart',content_blocks:[{type:'text',content:'1. 下载代码 2. 安装依赖 3. 启动项目'}]}),'steps');
  assert.equal(resolveCardLayout({kind:'cover'},'minimal'),'minimal');
});

test('快速开始的编号文本在公众号和小红书中都渲染为步骤组件',()=>{
  const page={kind:'quickstart',title:'三步开始',content_blocks:[{type:'text',title:'快速开始',content:'1. 下载代码 2. 安装依赖 3. 启动项目'}]};
  for(const channelMode of ['wechat','xiaohongshu']){
    const html=renderStoryboardHtml({topic:'步骤识别',pages:[page],channelMode});
    assert.match(html,/layout-steps density-normal blocks-1/);
    assert.match(html,/class="content-block steps-block"/);
    assert.equal((html.match(/class="step"/g)||[]).length,3);
  }
});

test('公众号和小红书清单都会移除正文自带的重复项目符号',()=>{
  const page={kind:'capability',title:'能力清单',content_blocks:[{type:'list',content:'• 第一项\n✅ 第二项\n- 第三项'}]};
  for(const channelMode of ['wechat','xiaohongshu']){
    const html=renderStoryboardHtml({topic:'清单净化',pages:[page],channelMode});
    assert.match(html,/layout-checklist/);
    assert.match(html,/<li>第一项<\/li><li>第二项<\/li><li>第三项<\/li>/);
  }
});

test('逐页指定优先于整组版式，不匹配时安全降级',()=>{
  const manual={kind:'content',layout_style:'minimal',content_blocks:[{type:'text'}]};
  assert.deepEqual(resolveCardLayoutDecision(manual,'poster','xiaohongshu'),{layout:'minimal',source:'manual',reason:'逐页手动指定'});
  const fallback=resolveCardLayoutDecision({layout_style:'data',content_blocks:[{type:'text'}]},'auto','wechat');
  assert.equal(fallback.layout,'editorial');
  assert.equal(fallback.source,'fallback');
  assert.equal(fallback.requested,'data');
  const decisions=describeCardLayouts([{kind:'cover'},{kind:'content',content_blocks:[{type:'list'}]}],{channelMode:'xiaohongshu'});
  assert.deepEqual(decisions.map((item)=>item.layout),['poster','checklist']);
});

test('六种版式改变页面骨架而不是只替换配色',()=>{
  for(const layout of SOCIAL_CARD_LAYOUTS.filter((item)=>item!=='auto')){
    const block=layout==='data'?{type:'stats',items:[{num:'1',label:'指标'}]}:layout==='steps'?{type:'steps',items:[{title:'第一步',content:'执行'}]}:layout==='checklist'?{type:'list',content:'第一项\n第二项'}:{type:'text',content:'正文'};
    const html=renderStoryboardHtml({topic:'版式测试',pages:[{kind:'content',title:'版式测试',content_blocks:[block]}],layoutStyle:layout});
    assert.match(html,new RegExp(`class="page page-content layout-${layout} density-normal blocks-1 items-`));
    assert.match(html,new RegExp(`data-layout="${layout}"`));
  }
});

test('长清单自动切换为紧凑密度，避免固定卡片高度溢出',()=>{
  const page={kind:'capability',title:'11 个主题',content_blocks:[{type:'list',content:Array.from({length:11},(_,index)=>`主题 ${index+1}`).join('\n')}]};
  assert.equal(cardPageDensity(page),'compact');
  const html=renderStoryboardHtml({topic:'长清单',pages:[page],channelMode:'xiaohongshu'});
  assert.match(html,/layout-checklist density-compact blocks-1 items-9/);
  assert.match(html,/data-density="compact"/);
  assert.match(html,/\.layout-checklist\.density-compact \.page li\{min-height:46px/);
});

test('单内容块杂志版使用左右分栏填补无效空白',()=>{
  const html=renderStoryboardHtml({topic:'单块杂志页',pages:[{kind:'content',title:'标题占左栏',content_blocks:[{type:'text',title:'正文',content:'正文占右栏'}]}]});
  assert.match(html,/layout-editorial density-normal blocks-1 items-0/);
  assert.match(html,/data-block-count="1"/);
  assert.match(html,/\.layout-editorial\.blocks-1 h1\{grid-column:1/);
  assert.match(html,/\.layout-editorial\.blocks-1 \.content-block\{grid-column:2!important/);
});

test('清单 1 至 5 项单列，6 至 8 项双列，9 项以上双列紧凑',()=>{
  const render=(count)=>renderStoryboardHtml({topic:'清单列数',pages:[{kind:'capability',title:`${count} 项`,content_blocks:[{type:'list',content:Array.from({length:count},(_,index)=>`项目 ${index+1}`).join('\n')}]}]});
  const five=render(5),six=render(6),nine=render(9);
  assert.match(five,/layout-checklist density-normal blocks-1 items-5/);
  assert.match(five,/\.layout-checklist\.items-5 \.list-block ul\{grid-template-columns:1fr\}/);
  assert.match(six,/layout-checklist density-normal blocks-1 items-6/);
  assert.match(nine,/layout-checklist density-compact blocks-1 items-9/);
  const chineseList=renderStoryboardHtml({topic:'事实边界',pages:[{kind:'risk',title:'未核实清单',content_blocks:[{type:'list',content:'细节未知、日期未知、影响未知、损失未知'}]}]});
  assert.match(chineseList,/items-4/);
  assert.equal((chineseList.match(/<li>/g)||[]).length,4);
});

test('杂志分栏按内容块顺序排布 div 与 aside',()=>{
  const html=renderStoryboardHtml({topic:'事件分栏',contentType:'event',pages:[{kind:'evidence',title:'事实与边界',content_blocks:[{type:'text',content:'事件事实'},{type:'note',content:'核实边界'}]}]});
  assert.match(html,/layout-editorial density-normal blocks-2 items-0/);
  assert.match(html,/\.layout-editorial \.content-block:nth-child\(odd\)\{grid-column:1\}/);
  assert.match(html,/\.layout-editorial \.content-block:nth-child\(even\)\{grid-column:2\}/);
  assert.doesNotMatch(html,/content-block:nth-of-type/);
});

test('11 项紧凑清单通过真实浏览器布局审计',async(t)=>{
  if (skipBrowser(t)) return;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'social-card-dense-list-'));
  try{
    const htmlPath=path.join(dir,'design.html');
    const reportPath=path.join(dir,'report.json');
    const page={kind:'capability',title:'11 个主题，覆盖完整实践链路',content_blocks:[
      {type:'list',title:'核心章节',content:Array.from({length:11},(_,index)=>`第 ${index+1} 个实践主题`).join('\n')},
      {type:'text',content:'每个章节都可以独立学习，从基础逐步深入。'},
    ]};
    fs.writeFileSync(htmlPath,renderStoryboardHtml({topic:'长清单',pages:[page],channelMode:'xiaohongshu'}),'utf8');
    await execFileAsync(process.execPath,[path.join(root,'skills','xiaohongshu-article-generator','scripts','layout-audit.mjs'),htmlPath,'--json',reportPath],{cwd:dir,windowsHide:true});
    const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
    assert.equal(report.valid,true,JSON.stringify(report.pages));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('图文编辑室可以独立选择版式和视觉主题',()=>{
  const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
  const source=fs.readFileSync(path.join(root,'public','src','views','social-editor.js'),'utf8');
  const styles=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');
  assert.match(html,/id="social-layout-style"[\s\S]*智能混排[\s\S]*海报大字[\s\S]*杂志分栏[\s\S]*数据报告[\s\S]*卡片清单[\s\S]*教程步骤[\s\S]*极简留白/);
  assert.match(html,/id="social-storyboard-theme-status"/);
  assert.match(html,/id="inspect-repository"[\s\S]*分析仓库/);
  assert.match(html,/id="analyze-card-editorial"[\s\S]*生成故事板/);
  assert.match(html,/social-facts-stage[\s\S]*id="inspect-repository"/);
  assert.match(html,/social-storyboard-head[\s\S]*id="analyze-card-editorial"/);
  assert.match(source,/layout_style/);
  assert.match(source,/__socialLayoutBound/);
  assert.match(source,/data-card-page-layout/);
  assert.match(source,/data-save-storyboard-page/);
  assert.match(source,/data-regenerate-storyboard-page/);
  assert.match(source,/data-regenerate-mode/);
  assert.match(source,/repository\/inspect/);
  assert.match(source,/仓库事实已更新，请点击“生成故事板”/);
  assert.match(source,/AI 扩写本页/);
  assert.match(source,/AI 缩写本页/);
  assert.match(source,/storyboard-page-ai-action/);
  assert.doesNotMatch(source,/AI 改写本页/);
  assert.match(source,/layoutReportPages/);
  assert.match(source,/card-pages\/\$\{pageNumber\}\/ai/);
  assert.match(source,/data-storyboard-block-content/);
  assert.match(source,/生成图文时会整组重新渲染/);
  assert.match(source,/storyboardThemeState/);
  assert.match(source,/needs-storyboard/);
  assert.match(source,/social-facts-title[\s\S]*factsActions\.prepend\(channelPicker\)/);
  assert.match(source,/card-pages\/\$\{page\}\/layout/);
  assert.match(source,/自动推荐[\s\S]*手动指定[\s\S]*自动降级/);
  assert.match(styles,/\.storyboard-layout-control/);
  assert.match(styles,/\.layout-status\.fallback/);
  assert.match(styles,/\.storyboard-ai-expand/);
  assert.match(styles,/\.storyboard-ai-compress/);
});

test('服务端支持保存故事板单页内容而不触发单图重绘',()=>{
  const source=fs.readFileSync(path.join(root,'lib/http/routes/social-card-routes.mjs'),'utf8');
  const storyboardPrompt=fs.readFileSync(path.join(root,'lib','domain','social-card-prompts','channel-xiaohongshu.md'),'utf8');
  assert.ok(source.includes("pathname.match(/^\\/api\\/candidates\\/(\\d+)\\/card-pages\\/(\\d+)$/)"));
  assert.ok(source.includes("pathname.match(/^\\/api\\/candidates\\/(\\d+)\\/card-pages\\/(\\d+)\\/ai$/)"));
  assert.match(source,/每页至少保留一个内容块/);
  assert.match(source,/card_plan_json:JSON\.stringify\(cardPlan\),status:'AI_READY'/);
  assert.match(source,/layoutReport/);
  assert.match(source,/modeInstruction/);
  assert.doesNotMatch(source,/\['expand','compress','rewrite'\]/);
  assert.match(source,/AI 扩写本页/);
  assert.match(source,/AI 缩写本页/);
  // 故事板策划 prompt 约束 stat 数值长度，避免窄数据卡内长算式折行
  assert.match(storyboardPrompt,/num 不超过 6 个字符/);
});

test('确定性故事板 HTML 通过真实浏览器布局审计', async (t) => {
  if (skipBrowser(t)) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-card-layout-'));
  const htmlPath = path.join(dir, 'design.html');
  const reportPath = path.join(dir, 'report.json');
  const pages = Array.from({ length:6 }, (_, index) => ({
    kind:index === 0 ? 'cover' : index === 5 ? 'ending' : 'content',
    title:`第 ${index + 1} 页工具能力说明`, goal:'说明这一页对目标读者的具体价值和使用边界',
    content_blocks: (index === 0 || index === 5) ? [] : [
      { type:'text', title:'使用方式', content:'安装后即可在命令行中使用，支持通过配置文件自定义默认行为。' },
      { type:'list', title:'核心能力', content:'增量构建缓存\n并行任务调度\n插件钩子机制\n详细错误报告\n类型化配置项' },
    ],
    evidence:['来自 README 的已核验能力说明','安装命令 npm install example','基于项目文档整理，未实际运行'],
  }));
  fs.writeFileSync(htmlPath, renderStoryboardHtml({ topic:'测试工具', repository:'org/repo', pages }), 'utf8');
  await execFileAsync(process.execPath, [path.join(root, 'skills', 'xiaohongshu-article-generator', 'scripts', 'layout-audit.mjs'), htmlPath, '--json', reportPath], { cwd:dir, windowsHide:true });
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.valid, true, JSON.stringify(report.pages));
});

test('图文执行器严格声明六阶段技能契约', () => {
  assert.deepEqual(SOCIAL_CARD_STAGE_CONTRACT.map((item) => item.id), [
    'facts','planning','generation','layout-audit','screenshots','delivery-gate',
  ]);
  assert.equal(SOCIAL_CARD_STAGE_CONTRACT[4].skill, 'html-pages-to-images');
});

test('图文文案由模型生成，HTML 根据故事板确定性组装', () => {
  const source = fs.readFileSync(path.join(root, 'lib', 'llm', 'social-card-pipeline.mjs'), 'utf8');
  assert.match(source, /purpose:'social-card-copy'/);
  assert.doesNotMatch(source, /purpose:'social-card-html'/);
  assert.doesNotMatch(source, /purpose:'social-card-generation'/);
  const html = renderStoryboardHtml({ visualStyle:'peach', topic:'测试工具', repository:'org/repo', pages:[
    { kind:'cover', title:'封面', goal:'说明价值', evidence:['事实一'], content_blocks:[{type:'list',title:'能力',content:'功能一\n功能二'},{type:'code',title:'安装',content:'npm i demo'}] },
    { kind:'ending', title:'结尾', continuation_index:2, evidence:['仓库地址'] },
  ] });
  assert.match(html, /<\/html>$/);
  assert.equal((html.match(/class="page /g) || []).length, 2);
  assert.equal([...html.matchAll(/class=["']([^"']*)["']/gi)].filter((match) => match[1].split(/\s+/).includes('page')).length, 2);
  assert.ok(html.includes('page-inner'));
  assert.match(html,/<pre><code>npm i demo<\/code><\/pre>/);
  assert.match(html, /class="continuation-badge" data-text-role="auxiliary"/);
  assert.match(html, /\.page-body\{[^}]*min-width:0/);
  assert.match(html, /\.page-ending \.note-block h2[^}]*color:inherit/);
  assert.match(html, /\.theme-peach \.page-ending \.note-block[^}]*color:var\(--ink\)/);
  assert.match(html, /\.page-ending \.highlight-block h2[^}]*color:inherit/);
});

test('故事板渲染支持设计系统的完整视觉主题',()=>{
  const pages=[{kind:'cover',title:'主题测试',goal:'验证主题'}];
  for(const visualStyle of ['neon','tokyo-night','brutalist','solarized','retro-terminal','paper-craft','charcoal','peach','orange','ice-blue','mocha','lavender','crimson','bone-white']){
    const html=renderStoryboardHtml({topic:'主题测试',repository:'org/repo',pages,visualStyle});
    assert.match(html,new RegExp(`class="theme-${visualStyle}(?: |")`));
    assert.match(html,new RegExp(`data-visual-style="${visualStyle}"`));
  }
});

test('图文编辑室异步按钮使用稳定节点引用并清理旧监听器', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'src', 'views', 'social-editor.js'), 'utf8');
  assert.doesNotMatch(source, /event\.currentTarget/);
  assert.match(source, /current\.replaceWith\(fresh\)/);
  assert.match(source, /inspectButton\.disabled=false/);
  assert.match(source, /整理 README 与仓库事实/);
  assert.match(source, /data-storyboard-elapsed/);
  assert.match(source, /模型仍在处理，接口请求保持等待/);
  assert.match(source, /watchSocialJob/);
  assert.match(source, /重新生成图文/);
});

test('整组图文下载生成标准 ZIP 结构', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'social-card-zip-'));try{const file=path.join(dir,'copy.txt');fs.writeFileSync(file,'hello','utf8');const zip=createZip([{name:'copy.txt',path:file}]);assert.equal(zip.readUInt32LE(0),0x04034b50);assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);assert.ok(zip.includes(Buffer.from('copy.txt')));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('图文编辑室包含画廊、证据预览、下载和任务完成恢复', () => {
  const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');const source=fs.readFileSync(path.join(root,'public','src','views','social-editor.js'),'utf8');for(const id of ['social-gallery-image','social-gallery-film','social-proof-content','social-download-all'])assert.match(html,new RegExp(`id="${id}"`));assert.match(source,/loadDelivery/);assert.match(source,/重新生成图文/);
});

test('图文候选使用顶部滚动 Tab 与两端箭头', () => {
  const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');const styles=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');const source=fs.readFileSync(path.join(root,'public','src','views','social-editor.js'),'utf8');assert.match(html,/social-candidate-tab-strip[\s\S]*social-tabs-previous[\s\S]*social-editor-candidates[\s\S]*social-tabs-next/);assert.match(styles,/\.social-editor-layout \{ display:grid; grid-template-columns:minmax\(0,1fr\)/);assert.match(styles,/\.social-editor-candidates \{[^}]*display:flex[^}]*overflow-x:auto/);assert.match(source,/setupSocialTabNavigation/);assert.match(source,/scrollBy/);
});

test('智能构图按页面语义推断角色并规范化最小 DSL',()=>{
  assert.deepEqual(SOCIAL_CARD_COMPOSITION_MODES,['smart','template']);
  assert.equal(inferCardPageRole({kind:'timeline'}),'timeline');
  assert.equal(inferCardPageRole({kind:'capability',content_blocks:[]}),'feature');
  const normalized=normalizeCardComposition({kind:'risk',composition:{id:'free-html',columns:'absolute'}});
  assert.equal(normalized.role,'risk');
  assert.deepEqual(normalized.composition,{id:'risk-sidebar',columns:'single',flow:'stack',alignment:'center',decoration:'stamp',overlap:'accent-edge'});
  assert.equal(normalized.fallback,true);
});

test('智能构图输出确定性标记，稳定模板保持兼容',()=>{
  const page={kind:'evidence',title:'证据边界',content_blocks:[{type:'text',content:'已确认事实'},{type:'note',content:'尚待核实'}]};
  const smart=renderStoryboardHtml({topic:'构图测试',pages:[page],compositionMode:'smart'});
  assert.match(smart,/composition-smart role-evidence comp-evidence-(?:ledger|frame)/);
  assert.match(smart,/data-page-role="evidence"/);
  assert.match(smart,/data-composition-mode="smart"/);
  const stable=renderStoryboardHtml({topic:'构图测试',pages:[page],compositionMode:'template'});
  assert.match(stable,/composition-template/);
  assert.match(stable,/data-composition-mode="template"/);
});

test('相同种子稳定复现构图，多种子可覆盖同角色的多个变体',()=>{
  const page={kind:'capability',title:'稳定构图',content_blocks:[{type:'list',content:'A\nB\nC'}]};
  assert.equal(stableCardCompositionSeed(page,2,'batch-a'),stableCardCompositionSeed(page,2,'batch-a'));
  const first=normalizeCardComposition(page,{pageIndex:2,seed:'batch-a'}).composition.id;
  assert.equal(normalizeCardComposition(page,{pageIndex:2,seed:'batch-a'}).composition.id,first);
  const variants=new Set(Array.from({length:20},(_,index)=>normalizeCardComposition(page,{pageIndex:2,seed:`batch-${index}`}).composition.id));
  assert.equal(variants.size,2);
});

test('故事板构图 id 合法时部分接受并按注册变体补齐字段',()=>{
  const page={kind:'capability',content_blocks:[{type:'text',content:'A'},{type:'text',content:'B'}],
    composition:{id:'feature-ledger',columns:'absolute',flow:'alternate',alignment:'center',decoration:'glitter'}};
  const normalized=normalizeCardComposition(page,{pageIndex:1,seed:'s'});
  assert.equal(normalized.composition.id,'feature-ledger');
  assert.equal(normalized.composition.columns,'split-even');
  assert.equal(normalized.composition.flow,'alternate');
  assert.equal(normalized.composition.decoration,'index-line');
  assert.equal(normalized.adjusted,true);
  assert.equal(normalized.fallback,false);
  assert.equal(normalized.source,'storyboard');
  const decision=resolveCardCompositionDecision(page,{compositionMode:'smart',pageIndex:1,seed:'s'});
  assert.match(decision.reason,/按内容关系修正列宽或补齐非法字段/);
});

test('内容块体量悬殊时降级为单列，体量均衡时保留分列',()=>{
  // 长步骤文本 + 短笔记：最大块占比约 0.68，左右分列会一高一低
  const imbalanced={kind:'quickstart',content_blocks:[
    {type:'text',title:'快速开始',content:'1. 访问 GitHub https://github.com/Lordog/dive-into-llms\n2. 选择感兴趣的章节，进入对应文件夹\n3. 下载课件和 Jupyter Notebook 脚本\n4. 在本地或云端运行（部分章节已提供在线链接）'},
    {type:'note',title:'合作版本',content:'另提供国产化教程（含PPT、实验手册、视频），详见社区。'},
  ]};
  for(let index=0;index<20;index+=1){
    const composition=normalizeCardComposition(imbalanced,{pageIndex:3,seed:`seed-${index}`}).composition;
    assert.equal(composition.columns,'single');
    assert.equal(composition.flow,'stack');
  }
  // 体量接近的两个块：保留分列变体
  const balanced={kind:'risk',composition:{id:'risk-sidebar',columns:'split-narrow',flow:'alternate',alignment:'center',decoration:'stamp',overlap:'accent-edge'},content_blocks:[{type:'text',content:'不执行自由 HTML，装饰来自白名单'},{type:'note',content:'构图参数受枚举与角色双重约束'}]};
  const kept=normalizeCardComposition(balanced,{pageIndex:3,seed:'seed-1'}).composition;
  assert.equal(kept.id,'risk-sidebar');
  assert.equal(kept.columns,'split-wide');
  assert.equal(kept.flow,'alternate');
  // 表格块字数少但行数多：6 行对比表 vs 一句话笔记，表格应被判为大块
  const tableHeavy={kind:'positions',content_blocks:[
    {type:'compare',title:'各方回应',headers:['主体','立场'],rows:[['官方','已确认'],['媒体','报道中'],['专家','谨慎'],['用户','观望'],['竞品','沉默'],['社区','热议']]},
    {type:'note',content:'持续跟进。'},
  ]};
  const tableComposition=normalizeCardComposition(tableHeavy,{pageIndex:2,seed:'seed-1'}).composition;
  assert.equal(tableComposition.columns,'single');
  // 数据卡块：4 张统计卡 vs 短文本，同样算大块
  const statsHeavy={kind:'impact',content_blocks:[
    {type:'stats',title:'关键数据',items:[{num:'45K',label:'星标'},{num:'11',label:'章节'},{num:'3',label:'合作方'},{num:'100%',label:'免费'}]},
    {type:'text',content:'数据来自公开页面。'},
  ]};
  const statsComposition=normalizeCardComposition(statsHeavy,{pageIndex:2,seed:'seed-1'}).composition;
  assert.equal(statsComposition.columns,'single');
});

test('同角色页面避免重复推荐同一构图变体',()=>{
  const page={kind:'capability',title:'稳定构图',content_blocks:[{type:'list',content:'A\nB\nC'},{type:'note',content:'备注'}]};
  const first=normalizeCardComposition(page,{pageIndex:1,seed:'dedupe'}).composition.id;
  const second=normalizeCardComposition(page,{pageIndex:1,seed:'dedupe',avoidIds:[first]}).composition.id;
  assert.notEqual(second,first);
  // avoidIds 不影响显式指定的故事板构图
  const explicit={...page,composition:{id:first,columns:'split-even',flow:'alternate',alignment:'start',decoration:'index-line',overlap:'none'}};
  assert.equal(normalizeCardComposition(explicit,{pageIndex:1,seed:'dedupe',avoidIds:[first]}).composition.id,first);
  // 渲染整组时同角色两页得到不同变体
  const html=renderStoryboardHtml({topic:'去重',pages:[page,page],compositionMode:'smart',compositionSeed:'dedupe'});
  const ids=[...html.matchAll(/<section\b[^>]*data-composition-id="([^"]*)"/g)].map((match)=>match[1]);
  assert.equal(ids.length,2);
  assert.notEqual(ids[0],ids[1]);
});
test('安全构图关闭高风险变体并输出审计回退标记',()=>{
  const page={kind:'cover',title:'安全回退',content_blocks:[{type:'text',content:'说明'}]};
  const html=renderStoryboardHtml({topic:'安全回退',pages:[page],compositionMode:'smart',compositionSeed:'risky',forceSafeComposition:true});
  assert.match(html,/data-layout-source="safe"/);
  assert.match(html,/comp-hero-stack/);
  assert.match(html,/decor-none overlap-none/);
});

test('高密度内容与单内容块自动降级为单列构图',()=>{
  const densePage={kind:'capability',title:'密集列表',content_blocks:[{type:'list',items:Array.from({length:9},(_,index)=>({title:`要点${index+1}`,content:'说明'}))}]};
  for(let index=0;index<20;index+=1){
    const composition=normalizeCardComposition(densePage,{pageIndex:1,seed:`seed-${index}`}).composition;
    assert.equal(composition.columns,'single');
    assert.equal(composition.flow,'stack');
  }
  const singleBlock={kind:'problem',title:'单块',composition:{id:'concept-split',columns:'split-wide',flow:'alternate',alignment:'center',decoration:'index-line',overlap:'none'},content_blocks:[{type:'text',content:'唯一的段落'}]};
  const downgraded=normalizeCardComposition(singleBlock,{pageIndex:1,seed:'s'}).composition;
  assert.equal(downgraded.id,'concept-split');
  assert.equal(downgraded.columns,'single');
  assert.equal(downgraded.flow,'stack');
});

test('安全回退优先单列稳定变体且支持按页启用',()=>{
  const feature=normalizeCardComposition({kind:'capability',content_blocks:[{type:'text',content:'A'},{type:'text',content:'B'}]},{forceSafe:true});
  assert.equal(feature.composition.id,'feature-stack');
  assert.equal(feature.composition.columns,'single');
  assert.equal(feature.composition.decoration,'none');
  assert.equal(feature.composition.overlap,'none');
  const concept=normalizeCardComposition({kind:'problem',content_blocks:[{type:'text',content:'A'},{type:'text',content:'B'}]},{forceSafe:true});
  assert.equal(concept.composition.columns,'single');
  assert.equal(concept.composition.flow,'stack');
  const pages=[
    {kind:'capability',title:'甲',content_blocks:[{type:'text',content:'A'},{type:'text',content:'B'}]},
    {kind:'capability',title:'乙',content_blocks:[{type:'text',content:'A'},{type:'text',content:'B'}]},
  ];
  const html=renderStoryboardHtml({topic:'按页安全',pages,compositionMode:'smart',compositionSeed:'per-page',forceSafeComposition:[1]});
  const sources=[...html.matchAll(/<section\b[^>]*data-layout-source="([^"]*)"[^>]*data-page-number="(\d+)"/g)]
    .sort((a,b)=>Number(a[2])-Number(b[2])).map((match)=>match[1]);
  assert.equal(sources.length,2);
  assert.notEqual(sources[0],'safe');
  assert.equal(sources[1],'safe');
});

test('暗色主题下标题卡对比度与步骤文本断行有保障',()=>{
  const html=renderStoryboardHtml({topic:'暗色主题',pages:[{kind:'cover',title:'封面',content_blocks:[{type:'text',content:'说明'}]}],visualStyle:'neon',compositionMode:'smart'});
  assert.match(html,/\.composition-smart\.overlap-title-card h1\{[^}]*color:var\(--ink\)/);
  assert.match(html,/\.step p\{[^}]*overflow-wrap:anywhere/);
  assert.match(html,/\.step h3\{[^}]*overflow-wrap:anywhere/);
  assert.match(html,/\.theme-neon\{--bg:#050809;--page:#07100e;--surface:#0c1c17;--ink:#eafff7;--muted:#9bd8c2;--accent:#55ffb6/);
  // 卡片内不再重复渲染页码，decor-index-line 只保留短装饰线
  assert.match(html,/\.decor-index-line \.page-content-stack:before\{content:"";/);
  assert.doesNotMatch(html,/attr\(data-card-index\)/);
});

test('智能构图不再叠加旧模板骨架，语义版式仅保留为数据属性',()=>{
  const pages=[
    {kind:'evidence',title:'证据页',layout_style:'data',content_blocks:[{type:'text',content:'事实'},{type:'note',content:'边界'}]},
    {kind:'ending',title:'结尾页',content_blocks:[{type:'highlight',content:'继续关注'}]},
  ];
  const html=renderStoryboardHtml({topic:'骨架隔离',pages,compositionMode:'smart'});
  assert.match(html,/class="page page-content layout-smart[^"]*composition-smart/);
  assert.match(html,/class="page page-ending layout-smart[^"]*composition-smart/);
  assert.doesNotMatch(html,/class="page[^"]*layout-(?:editorial|data|steps|minimal)[^"]*composition-smart/);
  assert.match(html,/data-layout="editorial"/);
  assert.match(html,/page-ending\.overlap-title-card h1\{background:var\(--surface\);color:var\(--ink\)\}/);
});

test('智能构图多角色与受控装饰通过真实浏览器布局审计',async(t)=>{
  if (skipBrowser(t)) return;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smart-composition-audit-'));
  try{
    const pages=[
      {kind:'cover',title:'智能构图不是随机换皮',content_blocks:[{type:'highlight',content:'同一内容稳定复现'}]},
      {kind:'capability',title:'三个核心能力',content_blocks:[
        {type:'list',title:'能力清单',content:'页面角色自动推断\n稳定随机种子复现\n按页安全回退\n构图部分接受\n同角色变体去重'},
        {type:'text',title:'设计原则',content:'所有构图变体来自白名单，渲染层不支持自由 HTML，同一内容在相同种子下稳定复现。'},
      ]},
      {kind:'timeline',title:'从规划到交付',content_blocks:[{type:'timeline',items:[{time:'01',title:'规划',content:'识别页面角色与内容密度'},{time:'02',title:'渲染',content:'选择构图变体并去重'},{time:'03',title:'审计',content:'真实浏览器测量填充率'},{time:'04',title:'修复',content:'必要时按页安全回退'}]}]},
      {kind:'risk',title:'自由度有明确边界',content_blocks:[
        {type:'text',title:'渲染边界',content:'不执行模型生成的自由 HTML，所有版式来自确定性模板。'},
        {type:'note',title:'装饰约束',content:'装饰与叠放均来自白名单构图，禁止空白卡与缩放凑版。'},
        {type:'list',title:'审计兜底',content:'填充率实测\n溢出硬失败\n字号下限约束'},
      ]},
      {kind:'ending',title:'内容稳定，视觉更灵活',content_blocks:[{type:'highlight',content:'继续生成整组图文'}]},
    ];
    const htmlPath=path.join(dir,'smart.html'),reportPath=path.join(dir,'report.json');
    fs.writeFileSync(htmlPath,renderStoryboardHtml({topic:'智能构图审计',pages,compositionMode:'smart',compositionSeed:'audit-seed'}),'utf8');
    await execFileAsync(process.execPath,[path.join(root,'skills','xiaohongshu-article-generator','scripts','layout-audit.mjs'),htmlPath,'--json',reportPath],{cwd:dir,windowsHide:true});
    const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
    assert.equal(report.valid,true,JSON.stringify(report.pages?.filter((page)=>!page.valid)));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('布局审计以真实内容边界测量，稀疏内容页标记 underfilled',async(t)=>{
  if (skipBrowser(t)) return;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sparse-page-audit-'));
  try{
    const htmlPath=path.join(dir,'sparse.html'),reportPath=path.join(dir,'report.json');
    // stack 带 min-height 装饰性高度：内容只有一句话时，按 stack 边界测会掩盖稀疏，按真实内容边界测必须标记 underfilled
    fs.writeFileSync(htmlPath,renderStoryboardHtml({topic:'稀疏页',compositionMode:'smart',compositionSeed:'sparse-seed',pages:[
      {kind:'capability',title:'只有一句话的页面',content_blocks:[{type:'text',content:'内容很少。'}]},
    ]}),'utf8');
    // 审计发现问题时进程以退出码 1 结束，但报告已写入，忽略退出码直接读报告
    await execFileAsync(process.execPath,[path.join(root,'skills','xiaohongshu-article-generator','scripts','layout-audit.mjs'),htmlPath,'--json',reportPath],{cwd:dir,windowsHide:true}).catch(()=>{});
    const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
    assert.equal(report.valid,false);
    assert.ok(report.pages[0].issues.includes('underfilled'),JSON.stringify(report.pages[0]));
    assert.ok(report.pages[0].utilization<50,JSON.stringify(report.pages[0]));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('copy stage requires topic tags on both channels and delivery validation flags missing tags', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'lib/llm/social-card-pipeline.mjs'), 'utf8');
  assert.ok(source.includes('末尾带 6–8 个话题标签'), 'xiaohongshu channel should require tags');
  assert.ok(source.includes('末尾带 6–8 个准确话题标签'), 'wechat channel should require tags');
  assert.ok(!source.includes('不使用话题标签'), 'wechat channel must not forbid tags');
  assert.ok(source.includes('配套文案话题标签不足'), 'delivery validation should flag missing tags');
});

test('纯 underfilled 页面启用有界舒展排版，结构或溢出问题不启用',()=>{
  const report={pages:[
    {page:1,issues:['underfilled']},
    {page:2,issues:['underfilled','vertical_imbalance']},
    {page:3,issues:['underfilled','overflow']},
    {page:4,issues:['clipped']},
  ]};
  assert.deepEqual(underfilledPageIndexes(report,new Set([1])),[0]);
  const html=renderStoryboardHtml({topic:'舒展排版',expandedDensityPages:new Set([0]),pages:[
    {kind:'capability',title:'内容较少',content_blocks:[{type:'text',title:'第一块',content:'已有正文'},{type:'text',title:'第二块',content:'已有正文'}]},
    {kind:'capability',title:'普通页面',content_blocks:[{type:'text',content:'正文'}]},
  ]});
  assert.match(html,/density-normal density-expanded/);
  assert.match(html,/data-density-adjustment="expanded"/);
  assert.match(html,/data-density-adjustment="none"/);
  assert.match(html,/\.page\.density-expanded \.content-block\{gap:calc\(var\(--paragraph-gap\) \+ 5px\);padding-block:14px\}/);
  assert.match(html,/\.page\.density-expanded\.blocks-1 \.page-content-stack,\.page\.density-expanded\.blocks-2 \.page-content-stack\{gap:calc\(var\(--card-gap\) \+ 24px\)\}/);
  assert.match(html,/\.page\.density-expanded\.blocks-1 \.content-block,\.page\.density-expanded\.blocks-2 \.content-block\{padding-block:22px\}/);
});

test('布局审计轮次穷尽的失败信息带逐页明细与故事板编辑指引',()=>{
  const message=layoutAuditFailureMessage({pages:[
    {page:2,valid:false,kind:'content',utilization:96.8,issues:['overfilled']},
    {page:6,valid:false,kind:'content',utilization:47.4,issues:['underfilled']},
    {page:7,valid:true,kind:'ending',utilization:30,issues:[]},
  ]},5);
  assert.match(message,/布局审计 5 轮后仍未通过/);
  assert.match(message,/P2 内容过多（版面利用率 96\.8%）/);
  assert.match(message,/P6 内容不足（版面利用率 47\.4%）/);
  assert.ok(!message.includes('P7'));
  assert.match(message,/02 卡片故事板/);
  assert.match(message,/内容不足的页：补充内容块、增加列表条目或扩写段落/);
  assert.match(message,/内容放不下的页：删减、拆分或缩短文字/);
});

test('智能构图中的四项同级指标使用二乘二网格',()=>{
  const html=renderStoryboardHtml({topic:'四项指标',compositionMode:'smart',pages:[{kind:'problem',title:'内存对比',content_blocks:[{type:'text',content:'问题说明'},{type:'list',content:'Claude Code: 386.6 MB\nCursor Agent: 214.9 MB\nOpenCode: 371.5 MB\nGitHub Copilot CLI: 333.3 MB'}]}]});
  assert.match(html,/composition-smart[^\"]*items-4/);
  assert.match(html,/\.composition-smart\.items-4 \.list-block ul\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('性能小数不会被误判成编号步骤',()=>{
  const page={kind:'capability',role:'data',title:'内存效率优势',content_blocks:[
    {type:'text',title:'内存对比',content:'jcode: 27.8 MB\nClaude Code: 386.6 MB'},
    {type:'text',title:'启动速度',content:'jcode: 14 ms\nClaude Code: 3436.9 ms'},
    {type:'text',title:'扩展性',content:'jcode 增加约 10.4 MB，而 Claude Code 增加约 212.7 MB。'},
  ]};
  const html=renderStoryboardHtml({topic:'小数识别',pages:[page],compositionMode:'smart'});
  assert.match(html,/data-layout="editorial"/);
  assert.doesNotMatch(html,/steps-block|第 \d+ 步/);
  assert.match(html,/jcode: 27\.8 MB/);
  assert.match(html,/Claude Code 增加约 212\.7 MB/);
});

test('三个内容块回归单列避免半栏破碎构图，四个及以上同级块才使用等宽双列',()=>{
  const three={kind:'quickstart',content_blocks:[
    {type:'code',title:'macOS / Linux',content:'tool install'},
    {type:'code',title:'Windows',content:'tool.exe install'},
    {type:'code',title:'验证安装',content:'tool --version'},
  ]};
  for(let index=0;index<20;index+=1){const composition=normalizeCardComposition(three,{pageIndex:4,seed:`seed-${index}`}).composition;assert.equal(composition.columns,'single');assert.equal(composition.flow,'stack');}
  const four={kind:'capability',content_blocks:[
    {type:'text',title:'能力一',content:'同级能力说明一'},
    {type:'text',title:'能力二',content:'同级能力说明二'},
    {type:'text',title:'能力三',content:'同级能力说明三'},
    {type:'text',title:'能力四',content:'同级能力说明四'},
  ]};
  for(let index=0;index<20;index+=1){const composition=normalizeCardComposition(four,{pageIndex:4,seed:`seed-${index}`}).composition;assert.equal(composition.columns,'split-even');assert.equal(composition.flow,'alternate');}
  const html=renderStoryboardHtml({topic:'四块构图',pages:[four],compositionMode:'smart'});
  assert.match(html,/blocks-4[^"]*comp-cols-split-even[^"]*comp-flow-alternate/);
  // 跨栏补齐规则保留，但只在非单列时生效
  assert.match(html,/\.composition-smart\.blocks-3\.comp-flow-alternate\.tri-span-first:not\(\.comp-cols-single\) \.content-block:first-of-type\{grid-column:1\/-1\}/);
  assert.match(html,/\.composition-smart\.blocks-3\.comp-flow-alternate\.tri-span-last:not\(\.comp-cols-single\) \.content-block:last-child\{grid-column:1\/-1\}/);
});

test('块内列表的双列网格只在单列页面启用，避免与分列页面嵌套出四列',()=>{
  const html=renderStoryboardHtml({topic:'列表网格',pages:[{kind:'capability',content_blocks:[{type:'list',title:'要点',items:['一','二','三','四','五','六','七']}]}],compositionMode:'smart'});
  assert.match(html,/\.composition-smart\.comp-cols-single\.items-7 \.list-block ul/);
  assert.doesNotMatch(html,/\.composition-smart\.items-7 \.list-block ul/);
});

test('只有明确主辅关系才使用非等宽列且列宽方向由内容顺序决定',()=>{
  const mainFirst={kind:'risk',content_blocks:[{type:'text',content:'主要能力说明'},{type:'note',content:'补充使用提醒'}]},auxiliaryFirst={kind:'risk',content_blocks:[{type:'note',content:'补充使用提醒'},{type:'text',content:'主要能力说明'}]},unclear={kind:'concept',content_blocks:[{type:'text',content:'第一种说明'},{type:'code',content:'run demo'}]};
  assert.equal(normalizeCardComposition(mainFirst,{seed:'a'}).composition.columns,'split-wide');
  assert.equal(normalizeCardComposition(auxiliaryFirst,{seed:'b'}).composition.columns,'split-narrow');
  assert.equal(normalizeCardComposition(unclear,{seed:'c'}).composition.columns,'single');
});

test('内容悬殊或密集时固定单列，稳定种子只切换同列宽的视觉变体',()=>{
  const imbalanced={kind:'concept',content_blocks:[{type:'text',content:'这是一段明显更长的主要内容，用于解释背景、限制、适用条件和完整操作过程，长度远高于其余两个内容块，继续分列会导致一侧拥挤。'.repeat(2)},{type:'note',content:'短备注'},{type:'code',content:'run'}]},dense={kind:'feature',content_blocks:[{type:'list',items:Array.from({length:9},(_,index)=>`项目 ${index+1}`)}]},peers={kind:'feature',content_blocks:[{type:'text',content:'同级能力一'},{type:'text',content:'同级能力二'}]};
  assert.equal(normalizeCardComposition(imbalanced,{seed:'a'}).composition.columns,'single');
  assert.equal(normalizeCardComposition(dense,{seed:'b'}).composition.columns,'single');
  const decisions=Array.from({length:20},(_,index)=>normalizeCardComposition(peers,{seed:`visual-${index}`} ).composition);
  assert.deepEqual(new Set(decisions.map((item)=>item.columns)),new Set(['split-even']));
  assert.equal(new Set(decisions.map((item)=>item.id)).size,2);
});

test('布局内容修复只允许改写现有文字，不得新增重复块或列表项',()=>{
  const original=[{kind:'capability',title:'核心能力',goal:'解释能力',evidence:['README'],content_blocks:[{type:'text',title:'记忆系统',content:'自动检索记忆'},{type:'list',title:'协作机制',content:'消息传递\n冲突检查'}]}];
  const rewritten=structuredClone(original);rewritten[0].content_blocks[0].content='自动检索相关记忆，并把已确认的上下文注入当前对话';rewritten[0].content_blocks[1].content='代理间消息传递\n自动检查文件冲突';
  assert.deepEqual(cardPlanRepairStructureIssues(original,rewritten),[]);
  const addedBlock=structuredClone(rewritten);addedBlock[0].content_blocks.push({type:'list',title:'记忆特点',content:'自动检索'});
  assert.ok(cardPlanRepairStructureIssues(original,addedBlock).some((issue)=>issue.includes('内容块数量')));
  const addedItem=structuredClone(rewritten);addedItem[0].content_blocks[1].content+='\n并行协作';
  assert.ok(cardPlanRepairStructureIssues(original,addedItem).some((issue)=>issue.includes('列表条目数量')));
});

test('accent-edge 不再横向移动首个内容块',()=>{
  const page={kind:'risk',composition:{id:'risk-sidebar',columns:'single',flow:'stack',alignment:'center',decoration:'stamp',overlap:'accent-edge'},content_blocks:[{type:'text',content:'第一块'},{type:'note',content:'第二块'}]};
  const html=renderStoryboardHtml({topic:'对齐',pages:[page],compositionMode:'smart'});
  assert.match(html,/\.composition-smart\.overlap-accent-edge \.content-block:nth-child\(3\)\{transform:none;margin-right:0\}/);
});

test('渲染保留全部内容块和对象型列表的标题正文',()=>{
  const content_blocks=Array.from({length:5},(_,index)=>({type:'text',title:`内容${index+1}`,content:`正文${index+1}`}));
  content_blocks[2]={type:'list',title:'指标',items:[{title:'内存',content:'降低 40%'}]};
  const html=renderStoryboardHtml({topic:'内容完整性',pages:[{kind:'content',title:'完整页面',content_blocks}]});
  assert.match(html,/blocks-5/);
  assert.match(html,/正文5/);
  assert.match(html,/内存：降低 40%/);
});

test('scenes 块只有换行正文时仍按场景列表渲染',()=>{
  const html=renderStoryboardHtml({topic:'场景回退',pages:[{kind:'scenario',title:'适用场景',content_blocks:[{
    type:'scenes',title:'适合谁',content:'直播打赏前需要冷静期\n误触会员入口时需要拦截\n临时支付时需要可控放行',items:[],
  }]}]});
  assert.match(html,/scenes-block/);
  assert.match(html,/<li>直播打赏前需要冷静期<\/li>/);
  assert.match(html,/<li>临时支付时需要可控放行<\/li>/);
});

test('underfilled density adjustment uses bounded relaxed and expanded tiers',()=>{
  assert.equal(underfilledDensityTier({kind:'content',utilization:49,issues:['underfilled']}),'relaxed');
  assert.equal(underfilledDensityTier({kind:'content',utilization:47.9,issues:['underfilled']}),'expanded');
  assert.equal(underfilledDensityTier({kind:'cover',utilization:40,issues:['underfilled']}),null);
  assert.equal(underfilledDensityTier({kind:'ending',utilization:40,issues:['underfilled']}),null);
  assert.equal(underfilledDensityTier({kind:'content',utilization:45,issues:['underfilled','overflow']}),null);

  const html=renderStoryboardHtml({
    topic:'Density tiers',
    relaxedDensityPages:new Set([0]),
    expandedDensityPages:new Set([1]),
    pages:[
      {kind:'content',title:'Relaxed',content_blocks:[{type:'text',content:'Body'}]},
      {kind:'content',title:'Expanded',content_blocks:[{type:'text',content:'Body'}]},
      {kind:'content',title:'Normal',content_blocks:[{type:'text',content:'Body'}]},
    ],
  });
  assert.match(html,/density-normal density-relaxed/);
  assert.match(html,/density-normal density-expanded/);
  assert.match(html,/data-density-adjustment="relaxed"/);
  assert.match(html,/data-density-adjustment="expanded"/);
  assert.match(html,/data-density-adjustment="none"/);
  assert.match(html,/\.page\.density-relaxed \.content-block\{padding-block:3px\}/);
});
