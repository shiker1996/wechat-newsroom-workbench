import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadSkillBundle } from '../lib/llm/skill-runtime.mjs';
import { SOCIAL_CARD_STAGE_CONTRACT, renderStoryboardHtml } from '../lib/social-card-pipeline.mjs';
import { createZip } from '../lib/zip-bundle.mjs';

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
  const source = fs.readFileSync(path.join(root, 'lib', 'social-card-pipeline.mjs'), 'utf8');
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
