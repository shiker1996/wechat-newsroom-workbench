import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadSkillBundle } from '../lib/llm/skill-runtime.mjs';
import { SOCIAL_CARD_LAYOUTS, SOCIAL_CARD_STAGE_CONTRACT, cardPageDensity, describeCardLayouts, renderStoryboardHtml, resolveCardLayout, resolveCardLayoutDecision } from '../lib/llm/social-card-pipeline.mjs';
import { createZip } from '../lib/artifacts/zip-bundle.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const execFileAsync = promisify(execFile);

test('项目图文技能加载完整文案、标题、设计与布局契约', () => {
  const bundle = loadSkillBundle({ workspaceRoot:root, skillName:'xiaohongshu-article-generator' });
  assert.equal(bundle.fallback, false);
  for (const name of ['SKILL.md','COPY_GUIDE.md','TITLE_GUIDE.md','DESIGN_SYSTEM.md','references\\layout-contract.md']) {
    assert.ok(bundle.files.some((file) => file.endsWith(name)), `missing ${name}`);
  }
  assert.match(bundle.prompt, /布局审计/);
  assert.match(bundle.prompt, /375/);
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

test('11 项紧凑清单通过真实浏览器布局审计',async()=>{
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
  assert.match(source,/layout_style/);
  assert.match(source,/__socialLayoutBound/);
  assert.match(source,/data-card-page-layout/);
  assert.match(source,/data-save-storyboard-page/);
  assert.match(source,/data-storyboard-block-content/);
  assert.match(source,/生成图文时会整组重新渲染/);
  assert.match(source,/social-facts-title[\s\S]*factsActions\.prepend\(channelPicker\)/);
  assert.match(source,/card-pages\/\$\{page\}\/layout/);
  assert.match(source,/自动推荐[\s\S]*手动指定[\s\S]*自动降级/);
  assert.match(styles,/\.storyboard-layout-control/);
  assert.match(styles,/\.layout-status\.fallback/);
});

test('服务端支持保存故事板单页内容而不触发单图重绘',()=>{
  const source=fs.readFileSync(path.join(root,'server.mjs'),'utf8');
  assert.ok(source.includes("pathname.match(/^\\/api\\/candidates\\/(\\d+)\\/card-pages\\/(\\d+)$/)"));
  assert.match(source,/每页至少保留一个内容块/);
  assert.match(source,/card_plan_json:JSON\.stringify\(cardPlan\),status:'AI_READY'/);
});

test('确定性故事板 HTML 通过真实浏览器布局审计', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-card-layout-'));
  const htmlPath = path.join(dir, 'design.html');
  const reportPath = path.join(dir, 'report.json');
  const pages = Array.from({ length:6 }, (_, index) => ({
    kind:index === 0 ? 'cover' : index === 5 ? 'ending' : 'content',
    title:`第 ${index + 1} 页工具能力说明`, goal:'说明这一页对目标读者的具体价值和使用边界',
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
  const html = renderStoryboardHtml({ topic:'测试工具', repository:'org/repo', pages:[
    { kind:'cover', title:'封面', goal:'说明价值', evidence:['事实一'], content_blocks:[{type:'list',title:'能力',content:'功能一\n功能二'},{type:'code',title:'安装',content:'npm i demo'}] },
    { kind:'ending', title:'结尾', evidence:['仓库地址'] },
  ] });
  assert.match(html, /<\/html>$/);
  assert.equal((html.match(/class="page /g) || []).length, 2);
  assert.equal([...html.matchAll(/class=["']([^"']*)["']/gi)].filter((match) => match[1].split(/\s+/).includes('page')).length, 2);
  assert.ok(html.includes('page-inner'));
  assert.match(html,/<pre><code>npm i demo<\/code><\/pre>/);
  assert.match(html, /\.page-ending \.note-block h2[^}]*color:inherit/);
  assert.match(html, /\.theme-palette \.page-ending \.note-block[^}]*color:var\(--ink\)/);
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
  assert.match(source, /正在读取 README、提取能力并规划逐页内容/);
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
