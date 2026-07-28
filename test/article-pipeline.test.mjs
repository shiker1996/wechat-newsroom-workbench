import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { articleLengthStatus, authorizedWritingBrief, buildDraftUserPrompt, buildArticleStageSystem, compositeSourceText, normalizePlanningResult, selectWriterSkill, ARTICLE_LENGTH_RANGE, ARTICLE_STAGE_CONTRACT, sourceCacheIssue, unverifiedFactBaseIssue } from '../lib/llm/article-pipeline.mjs';
import { inspectArticleQuality } from '../lib/llm/article-quality.mjs';
import { loadArticleSkillBundle, loadSkillBundle } from '../lib/llm/skill-runtime.mjs';

test('成稿规划兼容模型把数组字段返回为字符串', () => {
  const plan=normalizePlanningResult({expectedAction:'收藏、分享',coreKeywords:'AI；编程工具',remainingRisks:'none',titleCandidates:'一个可用标题'});
  assert.deepEqual(plan.expectedAction,['收藏','分享']);
  assert.deepEqual(plan.coreKeywords,['AI','编程工具']);
  assert.deepEqual(plan.remainingRisks,[]);
  assert.deepEqual(plan.titleCandidates,[{title:'一个可用标题',reason:''}]);
});

test('终稿默认字数门禁为1300到1800个可见字符', () => {
  assert.deepEqual(ARTICLE_LENGTH_RANGE,{min:1300,max:1800});
  assert.deepEqual(articleLengthStatus(`# 标题\n\n${'字'.repeat(1166)}`),{count:1166,valid:false,shortfall:134,overflow:0});
  assert.deepEqual(articleLengthStatus(`# 标题\n\n${'字'.repeat(1450)}`),{count:1450,valid:true,shortfall:0,overflow:0});
  assert.deepEqual(articleLengthStatus(`# 标题\n\n${'字'.repeat(1900)}`),{count:1900,valid:false,shortfall:0,overflow:100});
});

test('成稿规划保留结构化数组并接纳单个风险对象', () => {
  const plan=normalizePlanningResult({remainingRisks:{message:'日期仍需核验'},titleCandidates:[{title:'标题',reason:'准确'}]});
  assert.deepEqual(plan.remainingRisks,[{message:'日期仍需核验'}]);
  assert.equal(plan.titleCandidates[0].title,'标题');
});

test('成稿提示词展开真实标题、简报和大纲', () => {
  const prompt = buildDraftUserPrompt('真实标题', { thesis: '真实命题' }, '# 真实大纲');
  assert.match(prompt, /标题:真实标题/);
  assert.match(prompt, /\"thesis\":\"真实命题\"/);
  assert.match(prompt, /大纲:\n# 真实大纲/);
  assert.doesNotMatch(prompt, /\$\{(?:selectedTitle|outline|JSON\.stringify\(brief\))\}/);
});

test('综合候选汇总全部已抓取来源，写作简报移除来源原文', () => {
  const candidate={composite:true,source_documents:[
    {title:'来源甲',url:'https://example.com/a',source:{status:'ok',content:'甲正文'}},
    {title:'来源乙',url:'https://example.com/b',source:{status:'ok',content:'乙正文'}},
    {title:'失败来源',url:'https://example.com/c',source:{status:'error',content:'不应进入'}},
  ]};
  const corpus=compositeSourceText(candidate);
  assert.match(corpus,/来源甲[\s\S]*甲正文/);
  assert.match(corpus,/来源乙[\s\S]*乙正文/);
  assert.doesNotMatch(corpus,/不应进入/);
  const safe=authorizedWritingBrief({topic:'主题',sourceText:corpus,factBase:{claims:[]}});
  assert.equal(safe.sourceText,undefined);
  assert.equal(safe.topic,'主题');
  assert.deepEqual(safe.factBase,{claims:[]});
});

test('质量门禁只授权 verified 事实并区分观点与亲测', () => {
  const source=fs.readFileSync(new URL('../lib/llm/article-pipeline.mjs',import.meta.url),'utf8');
  assert.match(source,/正文事实只能来自事实基座中的 verified 项/);
  assert.match(source,/第一人称作者判断或阅读动作/);
  assert.match(source,/不得用新的数字、案例、榜单、硬件配置或模型常识替换/);
  assert.doesNotMatch(source,/事实基座可能未穷尽其中数据/);
});

test('爆款结构门禁要求钩子、3-5个章节和来源链接', () => {
  const article = `# 标题\n\n2026年，一场真实事件引出冲突，相关研究员公开说明了事件经过、组织决定和自己的离开原因。这意味着什么？真正的问题是技术由谁控制，以及公开承诺能否影响真实业务。\n\n第二段继续交代背景、关键参与者和读者最关心的问题，说明这不是普通的人事变化，而是研究理想进入合同、商业利益和组织权力之后产生的冲突。\n\n第三段明确作者判断：技术原则只有在高代价项目上仍能约束决策才有意义，并给出后续论证的核心方向和事实边界。\n\n## 第一节\n\n事实与解释。[来源](https://example.com/a)\n\n事实与判断。\n\n## 第二节\n\n事实、机制和影响。\n\n进一步分析。\n\n## 第三节\n\n反方与边界。\n\n结论与建议。`;
  assert.equal(inspectArticleQuality(article).pass, true);
  assert.equal(inspectArticleQuality('# 标题\n\n一句话。').pass, false);
});

test('爆款结构门禁接受陈述式钩子，不强制使用问号', () => {
  const article = `# 标题\n\n2026年，一名研究员公开了自己离开公司的原因，并列出内部推动改革失败的经过。他写过方案、联系过管理层，也试图争取技术领袖支持，但组织最终没有改变决定。真正值得讨论的不是一次普通离职，而是研究员是否还能控制自己参与创造的技术。\n\n事件背后连接着政府合同、商业利益和技术伦理。关键在于，公开原则进入高代价项目后还能不能影响组织决定，以及个人为什么很难通过内部流程改变已经商业化的技术方向。\n\n作者的判断很明确：原则只有在利益冲突中仍然有效，才称得上组织规则。后文将沿着事实、机制和影响展开，并区分公开证据、个人叙述和作者判断。\n\n## 第一节\n\n事实与解释。[来源](https://example.com/a)\n\n进一步分析。\n\n## 第二节\n\n组织机制与现实影响。\n\n补充事实边界。\n\n## 第三节\n\n反方解释与结论。\n\n给出具体建议。`;
  assert.equal(inspectArticleQuality(article).pass, true);
});

test('技能运行时加载完整写作技能并记录哈希', () => {
  const bundle = loadArticleSkillBundle({ workspaceRoot: process.cwd(), writerSkill: 'wechat-mp-tech-hotspot' });
  assert.equal(bundle.fallback, false);
  assert.match(bundle.prompt, /wechat-mp-tech-hotspot/);
  assert.match(bundle.hash, /^[a-f0-9]{64}$/);
  assert.ok(bundle.files.some((file) => /runtime-stage-contracts\.md$/.test(file)));
});

test('项目成稿总技能声明与执行器使用相同的阶段契约', () => {
  const orchestrator = loadSkillBundle({ workspaceRoot:process.cwd(), skillName:'wechat-mp-topic-to-article' });
  const writer = loadSkillBundle({ workspaceRoot:process.cwd(), skillName:'wechat-mp-tech-hotspot' });
  assert.equal(orchestrator.fallback, false);
  for (const { id } of ARTICLE_STAGE_CONTRACT) assert.match(orchestrator.prompt, new RegExp(`\\b${id}\\b`));
  const system = buildArticleStageSystem(orchestrator, 'drafting', writer);
  assert.match(system, /## SKILL: wechat-mp-topic-to-article/);
  assert.match(system, /## SKILL: wechat-mp-tech-hotspot/);
  assert.match(system, /只执行 `drafting` 阶段/);
});

test('综合选题写作规则来自项目子技能而非执行器内置提示词', () => {
  const composite = loadSkillBundle({ workspaceRoot:process.cwd(), skillName:'wechat-mp-composite' });
  assert.equal(composite.fallback, false);
  assert.match(composite.prompt, /多个已核验热点/);
  const source = fs.readFileSync(new URL('../lib/llm/article-pipeline.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /composeSkillPrompts|const compositeSkill|你是事实编辑/);
});

test('写作类型路由覆盖技术深解并保护严肃议题边界',()=>{
  assert.equal(selectWriterSkill({composite:true}).skill,'wechat-mp-composite');
  assert.equal(selectWriterSkill({category:'🤖 AI/技术动态',hotspot_title:'新模型发布',angle:'解释这次发布对开发者的影响'}).skill,'wechat-mp-tech-hotspot');
  assert.equal(selectWriterSkill({category:'🤖 AI/技术动态',hotspot_title:'MoE 模型',angle:'拆解推理架构和显存成本，给出可复算公式'}).skill,'wechat-mp-tech-deep');
  assert.equal(selectWriterSkill({category:'🏢 大厂战略',angle:'一个离谱的职场趣闻'}).skill,'wechat-mp-gossip-chill');
  assert.equal(selectWriterSkill({category:'🏢 大厂战略',angle:'离谱裁员事故背后的劳动关系'}).skill,'wechat-mp-deep-dive');
  assert.match(selectWriterSkill({category:'📈 行业趋势',angle:'分析参与方利益关系'}).reason,/参与方/);
});

test('热点文章契约明确拒绝伪装教程、工具清单和纯快讯',()=>{
  const skill=fs.readFileSync(new URL('../skills/wechat-mp-topic-to-article/SKILL.md',import.meta.url),'utf8');
  assert.match(skill,/writer_skill_reason/);
  assert.match(skill,/不承接纯资讯早报/);
  assert.match(skill,/教程必须先建立环境、步骤、成功标准和作者实践证据/);
  assert.match(skill,/工具 → 图文/);
});

test('阶段子技能从项目 skills 目录加载', () => {
  for (const skillName of ['title-generator','humanizer-zh','article-reviewer','seo-keyword-scoring','seo-content-optimizer','article-image-placeholders','wechat-mp-composite']) {
    const bundle = loadSkillBundle({ workspaceRoot: process.cwd(), skillName });
    assert.equal(bundle.fallback, false, skillName);
    assert.match(bundle.files[0], /write-assistant[\\/]skills[\\/]/);
    assert.match(bundle.hash, /^[a-f0-9]{64}$/);
  }
});

test('来源缓存与热点 URL 不一致时给出拦截信息', () => {
  const candidate={url:'https://www.solidot.org/story?sid=84915',composite:false};
  const cached={url:'https://www.stcn.com/article/detail/4040493.html',content:'正文'};
  const issue=sourceCacheIssue(candidate,cached);
  assert.match(issue,/来源缓存与热点原文不一致/);
  assert.match(issue,/stcn\.com/);
  assert.equal(sourceCacheIssue(candidate,{url:'https://www.solidot.org/story?sid=84915',content:'正文'}),null);
  assert.equal(sourceCacheIssue(candidate,{url:'https://www.solidot.org/story?sid=84915/',content:'正文'}),null);
  assert.equal(sourceCacheIssue({...candidate,composite:true},cached),null);
  assert.equal(sourceCacheIssue(candidate,{url:'https://www.stcn.com/x',content:''}),null);
});

test('事实基座全部事实性主张未核实时给出拦截信息', () => {
  const allUnverified={claims:[
    {claim:'事件A',status:'unverified'},
    {claim:'事件B',status:'unverified'},
    {claim:'作者判断',status:'opinion'},
  ],missingEvidence:['原文内容']};
  const issue=unverifiedFactBaseIssue(allUnverified);
  assert.match(issue,/所有事实性主张均未核实/);
  assert.match(issue,/原文内容/);
  assert.equal(unverifiedFactBaseIssue({claims:[{claim:'事件A',status:'verified'},{claim:'事件B',status:'unverified'}]}),null);
  assert.equal(unverifiedFactBaseIssue({claims:[{claim:'作者判断',status:'opinion'}]}),null);
  assert.equal(unverifiedFactBaseIssue({}),null);
});
