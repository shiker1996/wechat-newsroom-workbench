import { readStyles } from "./style-fixture.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkillBundle } from '../server/platform/llm/skill-runtime.mjs';
import {
  SOCIAL_CARD_STORYBOARD_CONTRACTS,
  buildSocialCardFactEnvelope,
  buildSocialCardStoryboardSystemPrompt,
  toLegacySocialCardPromptInput,
} from '../server/features/social-cards/index.mjs';
import { continuationBadge, renderStoryboardBlock, renderTechnicalText } from '../server/shared/rendering/storyboard-html-content.mjs';
import { sanitizeCardPlan } from '../server/shared/rendering/storyboard-content.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sha256=(value)=>crypto.createHash('sha256').update(value).digest('hex');

test('技术命令和 URL 以安全可换行片段渲染，续页显示连续标识',()=>{
  const text=renderTechnicalText('执行 npx -y human-review setup --global，访问 https://github.com/shiker1996/stop-pay-bilibili。');
  assert.match(text,/class="inline-technical technical-command"/);
  assert.match(text,/class="inline-technical technical-url"/);
  assert.match(renderStoryboardBlock({type:'steps',items:[{title:'安装',content:'运行 npm install --save-dev demo'}]}),/inline-technical technical-command/);
  assert.equal(continuationBadge({continuation_index:1}), '');
  assert.match(continuationBadge({continuation_index:2}),/CONTINUED · 02/);
});

test('步骤块兼容字符串 items，避免只渲染序号而丢失步骤正文',()=>{
  const html=renderStoryboardBlock({type:'steps',title:'本地运行',items:['进入 web 目录','安装依赖','启动开发服务器']});
  assert.match(html,/<h3>进入 web 目录<\/h3>/);
  assert.match(html,/<h3>安装依赖<\/h3>/);
  assert.match(html,/<h3>启动开发服务器<\/h3>/);
  assert.doesNotMatch(html,/<h3><\/h3><p><\/p>/);
});

test('列表块的分号串按列表条目渲染，不降级成单段落',()=>{
  const html=renderStoryboardBlock({
    type:'list',
    title:'关键节点',
    content:'2025年9月：发布实验版本；两个多月后：发布正式版；2026年8月：发布视觉理解模型。',
  });
  assert.equal((html.match(/<li/g)||[]).length,3);
  assert.match(html,/class="content-block list-block"/);
  assert.doesNotMatch(html,/class="content-block text-block"/);
});

test('完整 fenced code 不受内容块类型影响，统一渲染为代码块',()=>{
  const html=renderStoryboardBlock({type:'list',title:'安装命令',content:'```bash\ncurl -fsSl https://example.com/install | bash\n```'});
  assert.match(html,/class="content-block code-block"/);
  assert.match(html,/<pre><code[^>]*>curl -fsSl https:\/\/example\.com\/install \| bash<\/code><\/pre>/);
  assert.doesNotMatch(html,/```bash/);
});

test('阶段 2 字体放大变体通过内联样式覆盖主题 CSS',()=>{
  const html=renderStoryboardBlock({
    type:'note',title:'补充说明',content:'这是一段用于验证字体放大变体的说明。',font_scale:1.12,
  });
  assert.match(html,/font-size:12\.32px/);
  assert.match(html,/line-height:/);
});

test('故事板视觉意图安全渲染为强调、图标、徽章和句内重点',()=>{
  const html=renderStoryboardBlock({
    type:'highlight',
    title:'关键变化',
    content:'净利润下降 75%。',
    content_runs:[
      {text:'净利润下降 ',role:'normal'},
      {text:'75%',role:'metric',tone:'danger',emphasis:'strong'},
      {text:'。',role:'normal'},
    ],
    visual:{icon:'warning',badge:'关键变化',tone:'danger',emphasis:'strong'},
  });
  assert.match(html,/class="content-block highlight-block visual-emphasis-strong visual-tone-danger visual-icon-warning"/);
  assert.match(html,/class="visual-icon"[^>]*>!</);
  assert.match(html,/class="visual-badge"[^>]*>关键变化</);
  assert.match(html,/class="visual-run visual-role-metric visual-tone-danger visual-emphasis-strong">75%<\/span>/);
  assert.doesNotMatch(html,/<script|<img|style=/i);
});

test('不完整 content_runs 回退为原文，避免视觉标记吞掉内容',()=>{
  const html=renderStoryboardBlock({
    type:'text',
    content:'完整事实句。',
    content_runs:[{text:'不完整',role:'metric',emphasis:'strong'}],
  });
  assert.match(html,/>完整事实句。<\/p>/);
  assert.doesNotMatch(html,/visual-run/);
});

test('故事板遗漏 visual 时，从关键事实和内容块职责生成保守视觉意图',()=>{
  const pages=sanitizeCardPlan([{kind:'cover',role:'cover',title:'事件',content_blocks:[
    {type:'text',title:'核心事件',content:'马云增持阿里超6亿港元，净利润下降75%'}
  ]},{kind:'content',role:'compare',title:'讨论',content_blocks:[
    {type:'compare',title:'价格变化',headers:['此前','现在'],rows:[['旧价','4499元'],['新价','6999元']]},
    {type:'note',title:'事实边界',content:'具体动机尚未公开'}
  ]}]);
  const cover=pages[0].content_blocks[0];
  assert.deepEqual(cover.visual,{emphasis:'hero',tone:'accent',icon:'rocket',badge:'核心事件'});
  assert.equal(cover.content_runs.map((run)=>run.text).join(''),cover.content);
  assert.ok(cover.content_runs.some((run)=>run.text==='马云'&&run.role==='label'));
  assert.ok(cover.content_runs.some((run)=>run.text==='阿里'&&run.role==='label'));
  assert.ok(cover.content_runs.some((run)=>run.text==='6亿港元'&&run.role==='metric'));
  assert.deepEqual(pages[1].content_blocks[0].visual,{emphasis:'strong',tone:'danger',icon:'price',badge:'价格变化'});
  assert.deepEqual(pages[1].content_blocks[1].visual,{tone:'warning',icon:'warning',badge:'事实边界'});
});

test('故事板把列表、时间线和对比表中的关键事实细化为条目级 visual',()=>{
  const pages=sanitizeCardPlan([
    {kind:'content',title:'事实',content_blocks:[{type:'list',title:'增持与配售',items:['马云连续增持阿里港股，总额超6亿港元','普通背景事实']}]},
    {kind:'content',title:'时间线',content_blocks:[{type:'timeline',title:'事件时间线',items:[
      {time:'2026-08-20',title:'发布财报',content:'净利润同比降75%'},
      {time:'2026-08-23',title:'宣布配售',content:'配售800亿港元用于AI投资'},
    ]}]},
    {kind:'content',title:'对比',content_blocks:[{type:'compare',title:'市场与公司',headers:['视角','信息'],rows:[['市场','股价一度跌近10%']]}]},
  ]);
  const list=pages[0].content_blocks[0];
  const timeline=pages[1].content_blocks[0];
  const compare=pages[2].content_blocks[0];
  assert.deepEqual(list.items[1],'普通背景事实');
  assert.deepEqual(list.items[0].visual,{emphasis:'strong',tone:'accent'});
  assert.equal(list.items[0].content_runs.map((run)=>run.text).join(''),list.items[0].content);
  assert.deepEqual(timeline.items[0].visual,{emphasis:'strong',tone:'danger'});
  assert.ok(timeline.items[0].content_runs.some((run)=>run.text==='75%'&&run.tone==='danger'));
  assert.deepEqual(compare.rows[0][1].visual,{emphasis:'strong',tone:'danger'});
  assert.match(renderStoryboardBlock(list),/visual-run visual-role-metric/);
});

test('P0 固化图文故事板三项 JSON Schema 契约',()=>{
  assert.deepEqual(SOCIAL_CARD_STORYBOARD_CONTRACTS,{
    factBase:'social_card_fact_base',
    storyboard:'social_card_storyboard',
    layoutReport:'social_card_layout_report',
  });
  for(const [file,id] of [
    ['social-card-fact-base.schema.json','social_card_fact_base'],
    ['social-card-storyboard.schema.json','social_card_storyboard'],
    ['social-card-layout-report.schema.json','social_card_layout_report'],
  ]){
    const schema=JSON.parse(fs.readFileSync(path.join(root,'server','shared','domain','schemas',file),'utf8'));
    assert.equal(schema.$id,id);
    assert.equal(schema.$schema,'https://json-schema.org/draft/2020-12/schema');
  }
});

test('统一事实信封覆盖三个入口且兼容迁移前模型输入',()=>{
  const cases=[
    ['repository','social-tool','repository_facts'],
    ['event','social-event','event_analysis'],
    ['custom','social-custom','custom_facts'],
  ];
  for(const [contentType,entryPoint,legacyKey] of cases){
    const envelope=buildSocialCardFactEnvelope({
      contentType,channelMode:'xiaohongshu',topic:'测试主题',facts:{kind:contentType},
      eventAnalysis:{kind:'event'},outputMode:`xiaohongshu-${contentType}`,
    });
    assert.equal(envelope.contract,'social_card_fact_base');
    assert.equal(envelope.entryPoint,entryPoint);
    assert.equal(envelope.constraints.pageWidth,375);
    assert.ok(envelope.constraints.allowedBlockTypes.includes('stats'));
    const legacy=toLegacySocialCardPromptInput(envelope);
    assert.deepEqual(Object.keys(legacy),['topic','channel_mode',legacyKey]);
    assert.equal(legacy.topic,'测试主题');
  }
});

test('迁移后的故事板提示词保持六种入口和渠道组合的语义快照',()=>{
  const skillIds={
    repository:'repository-card-storyboard',
    event:'event-card-storyboard',
    custom:'custom-card-storyboard',
  };
  const snapshots={
    'repository/wechat':'1a17e3d1b8e15b807b58d59179d4d074e99f27464d2d9ac2b44c89a5cd0aee00',
    'repository/xiaohongshu':'b1cc51a81d4f872aa6966cd67892000033d6f8700586255915471219e675332c',
    'event/wechat':'562dcf58e85e3895c12673e91f84ae08e22ccc5bc9659a19aa7a22a5f3d190bd',
    'event/xiaohongshu':'2ae6c572fb4dcfbc24e22423d69e601733572abfc6cc0a731c244ae6a1ec7f46',
    'custom/wechat':'becae18bd7506d49f5c51594491aea48a124cdbd4edf22a9290852fc1cbccf43',
    'custom/xiaohongshu':'6d6f247a89e96ea711c1b83311af8de28612b9f253f4437c4689e1184c0ca6d4',
  };
  for(const [key,expected] of Object.entries(snapshots)){
    const [contentType,channelMode]=key.split('/');
    const bundle=loadSkillBundle({workspaceRoot:root,skillName:skillIds[contentType]});
    assert.equal(bundle.fallback,false);
    const prompt=buildSocialCardStoryboardSystemPrompt({
      workspaceRoot:root,skillId:skillIds[contentType],
      skillPrompt:bundle.prompt,contentType,channelMode,
    });
    // 提示词快照对换行符不敏感：Windows 工作树 CRLF 与仓库 LF 语义相同
    assert.equal(sha256(prompt.replace(/\r\n/g,'\n')),expected,key);
  }
});

test('路由只负责注入阶段输入，不再内嵌完整故事板方法正文',()=>{
  const source=fs.readFileSync(path.join(root,'server','platform','http','routes','social-card-routes.mjs'),'utf8');
  assert.match(source,/buildSocialCardStoryboardSystemPrompt/);
  assert.match(source,/buildSocialCardFactEnvelope/);
  assert.doesNotMatch(source,/README 到卡片故事板/);
  assert.doesNotMatch(source,/num 不超过 6 个字符/);
});

test('P1 card-editorial 接收故事板技能并冻结阶段选择',()=>{
  const source=fs.readFileSync(path.join(root,'server','platform','http','routes','social-card-routes.mjs'),'utf8');
  assert.match(source,/social-card-stage-skills/);
  assert.match(source,/input\.stageSkills/);
  assert.match(source,/resolveSocialCardStageSkills/);
  assert.match(source,/skillName:storyboardSelection\.selectedSkill/);
  assert.match(source,/stages:stageSelections/);
});

test('P2 图文编辑室展示故事板技能选择并随请求提交',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const source=fs.readFileSync(new URL('../public/src/views/social-editor.js',import.meta.url),'utf8');
  const skills=fs.readFileSync(new URL('../public/src/views/skills.js',import.meta.url),'utf8');
  assert.match(html,/id="social-skill-summary"/);
  assert.match(html,/id="social-stage-skills"/);
  assert.match(html,/id="reset-social-skills"/);
  assert.match(source,/loadStageSkillControls/);
  assert.match(source,/SOCIAL_ENTRY_POINTS=\{repository:'social-tool',event:'social-event',custom:'social-custom'\}/);
  assert.match(source,/stageSkills:selectedStageSkills\(document\.getElementById\('social-stage-skills'\)\)/);
  assert.match(source,/现有逐页编辑将被替换/);
  assert.match(source,/data-storyboard-elapsed/);
  assert.match(source,/模型仍在处理，接口请求保持等待/);
  assert.match(source,/故事板规划摘要/);
  assert.doesNotMatch(source,/summary>思考过程/);
  assert.match(skills,/storyboard: "故事板规划"/);
});

test('新增开源技术与趋势故事板复用事件图文输出契约',()=>{
  for(const [skillName,requiredMethod] of [
    ['open-source-technology-storyboard','机制'],
    ['open-source-trend-storyboard','趋势判断'],
  ]){
    assert.equal(fs.existsSync(path.join(root,'skills',skillName,'references','storyboard.md')),true);
    const skillSource=fs.readFileSync(path.join(root,'skills',skillName,'SKILL.md'),'utf8');
    assert.match(skillSource,/^## 输入/m);
    assert.match(skillSource,/^## 输出/m);
    assert.match(skillSource,/references\/storyboard\.md/);
    const bundle=loadSkillBundle({workspaceRoot:root,skillName});
    const prompt=buildSocialCardStoryboardSystemPrompt({
      workspaceRoot:root,skillId:skillName,skillPrompt:bundle.prompt,contentType:'event',channelMode:'wechat',
    });
    assert.match(prompt,new RegExp(requiredMethod));
    assert.match(prompt,/顶层必须直接返回 `card_plan` 数组/);
    assert.match(prompt,/"content_blocks"/);
    assert.match(prompt,/不要返回 `storyboard\.pages` 或 `blocks`/);
    assert.match(prompt,/`list`.*`items`/);
    assert.match(prompt,/禁止在列表块写 `content`/);
    assert.match(prompt,/封面最多 1 个核心内容块/);
  }
});

test('图文创作页以事实、故事板和交付三阶段组织主路径',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const styles=readStyles();
  assert.match(html,/class="social-flow-indicator"/);
  assert.match(html,/核对事实/);
  assert.match(html,/规划故事板/);
  assert.match(html,/生成与交付/);
  assert.match(html,/class="social-foundation-grid"/);
  assert.match(html,/class="social-control-deck"/);
  assert.match(html,/class="card-gate-panel social-production-bar"/);
  assert.match(styles,/\.social-project-hero\{/);
  assert.match(styles,/\.social-production-bar\{position:sticky/);
  assert.match(styles,/\.social-editor-form \{ min-width:0;width:100%;max-width:none;margin-inline:0; \}/);
  assert.match(styles,/@media\(min-width:1600px\).*?\.social-control-deck\{grid-template-columns:minmax\(280px,.62fr\) minmax\(720px,1.75fr\)/s);
  assert.match(styles,/\.social-foundation-grid:has\(\.social-score-panel\[hidden\]\)\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(styles,/@media\(max-width:760px\).*?\.social-picker-group\{grid-template-columns:1fr 1fr\}/s);
});

test('三类故事板规划与图文生成交付拆成四个内置技能',()=>{
  const repository=loadSkillBundle({workspaceRoot:root,skillName:'repository-card-storyboard'});
  const event=loadSkillBundle({workspaceRoot:root,skillName:'event-card-storyboard'});
  const custom=loadSkillBundle({workspaceRoot:root,skillName:'custom-card-storyboard'});
  const delivery=loadSkillBundle({workspaceRoot:root,skillName:'xiaohongshu-article-generator'});
  for(const storyboard of [repository,event,custom]){
    assert.equal(storyboard.manifest.kind,'storyboard');
    assert.equal(storyboard.manifest.inputContract,'social_card_fact_base');
    assert.equal(storyboard.manifest.outputContract,'social_card_storyboard');
  }
  assert.deepEqual(repository.manifest.entryPoints,['social-tool']);
  assert.deepEqual(event.manifest.entryPoints,['social-event']);
  assert.deepEqual(custom.manifest.entryPoints,['custom-social']);
  assert.equal(delivery.manifest.kind,'stage');
  assert.equal(delivery.manifest.inputContract,'social_card_storyboard');
  assert.equal(delivery.manifest.outputContract,'social_card_delivery');
  assert.match(repository.prompt,/核心能力如何工作/);
  assert.match(repository.prompt,/Star 或 Trending 排名当标题主张/);
  assert.match(repository.prompt,/工具图文推荐 4–7 页/);
  assert.match(repository.prompt,/awesome\/list\/catalog/);
  assert.match(repository.prompt,/不机械套用/);
  assert.match(repository.prompt,/事实不足以支撑独立场景页时/);
  assert.match(repository.prompt,/`content_blocks`/);
  assert.match(repository.prompt,/`list`.*`items` 字符串数组/);
  assert.match(repository.prompt,/<commit>.*YOUR_TOKEN.*\$API_KEY/);
  assert.match(repository.prompt,/不使用“点赞、收藏、转发”等传播口号替代内容结论/);
  assert.match(event.prompt,/传播张力不得高于证据强度/);
  assert.match(custom.prompt,/author_experience/);
  assert.match(delivery.prompt,/不负责选择故事线或首次规划故事板/);
});

test('四个内置故事板统一章节、页面角色和类型化降级规则',()=>{
  const cases=[
    ['repository-card-storyboard',['当前运行阶段：','一、页面结构','二、页面选择规则','三、事实分配与防重复','四、证据边界与降级规则','五、内容块、来源与密度规则','六、合并与禁止合并规则','七、常见错误'],/`kind` 和 `role`/],
    ['event-card-storyboard',['当前运行阶段：','一、页面结构','二、页面选择规则','三、事实分配与防重复要求','四、事实与表达边界','五、证据门槛与降级规则','六、密度、合并与模板边界','七、常见错误'],/证据不足时缩短故事板/],
    ['open-source-technology-storyboard',['当前运行阶段：','一、页面结构','二、页面选择规则','三、事实分配与防重复','四、内容块与来源规则','五、技术边界与密度','六、合并与禁止合并规则','七、证据门槛、降级与常见错误'],/没有机制、架构或工作路径证据时/],
    ['open-source-trend-storyboard',['当前运行阶段：','一、页面结构','二、页面选择规则','三、事实分配与防重复','四、内容块与来源规则','五、趋势边界与密度','六、合并与禁止合并规则','七、证据门槛、降级与常见错误'],/跨来源、跨主体、跨时间中的两类变化信号/],
  ];
  for(const [skillName,headings,marker] of cases){
    const prompt=loadSkillBundle({workspaceRoot:root,skillName}).prompt;
    for(const heading of headings) assert.match(prompt,new RegExp(`^## ${heading}`,'m'),`${skillName}: ${heading}`);
    assert.match(prompt,/每个页面必须同时返回明确的 `kind` 和 `role`/);
    assert.match(prompt,/每个内容块必须带 `source_refs`/);
    assert.match(prompt,marker);
  }
});

test('五类故事板声明语义视觉意图且不暴露渲染细节',()=>{
  for(const skillName of [
    'repository-card-storyboard',
    'event-card-storyboard',
    'open-source-technology-storyboard',
    'open-source-trend-storyboard',
    'custom-card-storyboard',
  ]){
    const prompt=loadSkillBundle({workspaceRoot:root,skillName}).prompt;
    assert.match(prompt,/语义化 `visual` 意图/);
    assert.match(prompt,/content_runs/);
    assert.match(prompt,/不得输出字号、颜色值、HTML 或 CSS/);
  }
  const schema=JSON.parse(fs.readFileSync(path.join(root,'server','shared','domain','schemas','social-card-storyboard.schema.json'),'utf8'));
  const block=schema.properties.card_plan.items.properties.content_blocks.items;
  assert.deepEqual(block.properties.visual.properties.icon.enum,[
    'none','metric','ai','price','warning','source','user','timeline','rocket',
  ]);
  assert.deepEqual(block.properties.content_runs.items.properties.role.enum,['normal','metric','label','warning','source']);
});

test('第三方故事板使用自身方法且只叠加固定运行契约',()=>{
  const prompt=buildSocialCardStoryboardSystemPrompt({
    workspaceRoot:root,skillId:'third-party-storyboard',
    skillPrompt:'第三方方法：先按反常识命题组织证据。',
    contentType:'repository',channelMode:'wechat',
  });
  assert.match(prompt,/第三方方法：先按反常识命题组织证据/);
  assert.match(prompt,/固定运行契约：事实基座到图文故事板/);
  assert.match(prompt,/公众号渠道固定要求/);
  assert.doesNotMatch(prompt,/README 到工具图文故事板/);
  assert.doesNotMatch(prompt,/禁止用 GitHub topics 代替功能解释/);
});
