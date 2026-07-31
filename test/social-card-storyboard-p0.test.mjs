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

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sha256=(value)=>crypto.createHash('sha256').update(value).digest('hex');

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
    'repository/wechat':'d8e8a0132b5f0307bfc123056adac1a2627341fbe313733e16b15467905f39be',
    'repository/xiaohongshu':'0c748cb81c0779d93d865a6c80388df95899c5064a0e3f89f497a4a80e4973b5',
    'event/wechat':'4f10b9aa901f480fdf40a7e5ad780299ac9511b7646e3252683dd060465b704f',
    'event/xiaohongshu':'73ce4a8d8573f269e6a9b142b379c168e4162a34fccc963936ef17799a3e1384',
    'custom/wechat':'a78279ecf94306c47f992835aeb144df4dfc82ebe23b48fbde5eb0996b3b264e',
    'custom/xiaohongshu':'8a2de17ffb325e17e62498fc9f37044600bcc516312d8e6cea478561b0f52728',
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
  assert.match(styles,/\.social-editor-form\{width:100%;max-width:none;margin-inline:0\}/);
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
  assert.deepEqual(custom.manifest.entryPoints,['social-custom']);
  assert.equal(delivery.manifest.kind,'stage');
  assert.equal(delivery.manifest.inputContract,'social_card_storyboard');
  assert.equal(delivery.manifest.outputContract,'social_card_delivery');
  assert.match(repository.prompt,/核心能力怎样工作/);
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
