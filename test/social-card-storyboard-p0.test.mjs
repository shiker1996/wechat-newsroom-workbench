import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkillBundle } from '../lib/llm/skill-runtime.mjs';
import {
  SOCIAL_CARD_STORYBOARD_CONTRACTS,
  buildSocialCardFactEnvelope,
  buildSocialCardStoryboardSystemPrompt,
  toLegacySocialCardPromptInput,
} from '../lib/domain/social-card-storyboard-contracts.mjs';
import { continuationBadge, renderStoryboardBlock, renderTechnicalText } from '../lib/rendering/storyboard-html-content.mjs';

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
    const schema=JSON.parse(fs.readFileSync(path.join(root,'lib','domain','schemas',file),'utf8'));
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
    'repository/wechat':'0bb9505c29499d19941e8484c199e9c41201fa0718f163e85ceec4adb716d0c8',
    'repository/xiaohongshu':'493ca9619b1c61e62251624bc62032f3558a802d4d99c262e262bc03fcb55902',
    'event/wechat':'9d95a99b8f07c1fc5c26e2c94fba08b01163a38ae47cb5c25e1047084099e9e7',
    'event/xiaohongshu':'222c409414e68f712ab43060421b51ca29091a08a32c5d9f2804862fd6f5c616',
    'custom/wechat':'a84b1f7e6bb24bb1ba7792055bfcc9fd397d94fdf67d0cd4d41292844bfdfca7',
    'custom/xiaohongshu':'581275f2cdeba82c1b0eb43690b9b3ec6997872a367c2ceab3973291a3c6e32e',
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
  const source=fs.readFileSync(path.join(root,'lib','http','routes','social-card-routes.mjs'),'utf8');
  assert.match(source,/buildSocialCardStoryboardSystemPrompt/);
  assert.match(source,/buildSocialCardFactEnvelope/);
  assert.doesNotMatch(source,/README 到卡片故事板/);
  assert.doesNotMatch(source,/num 不超过 6 个字符/);
});

test('P1 card-editorial 接收故事板技能并冻结阶段选择',()=>{
  const source=fs.readFileSync(path.join(root,'lib','http','routes','social-card-routes.mjs'),'utf8');
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

test('图文创作页以事实、故事板和交付三阶段组织主路径',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const styles=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
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
  assert.match(repository.prompt,/核心能力怎样工作/);
  assert.match(repository.prompt,/Star、Trending 和项目知名度只作为证据/);
  assert.match(repository.prompt,/运行时继续允许 4～7 页/);
  assert.match(repository.prompt,/awesome\/list\/catalog/);
  assert.match(repository.prompt,/禁止所有仓库机械套用/);
  assert.match(repository.prompt,/不单设信息贫乏的“适用场景”页/);
  assert.match(repository.prompt,/<commit>.*YOUR_TOKEN.*\$API_KEY/);
  assert.match(repository.prompt,/不用“点赞、收藏、转发”代替内容结论/);
  assert.match(event.prompt,/传播张力不得高于证据强度/);
  assert.match(custom.prompt,/author_experience/);
  assert.match(delivery.prompt,/不负责选择故事线或首次规划故事板/);
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
