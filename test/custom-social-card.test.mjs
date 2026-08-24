import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCustomCardGate, CUSTOM_CONTENT_TYPES, CUSTOM_SOURCE_LEVELS } from '../server/features/social-cards/index.mjs';
import { buildCustomFactSheet, customFactMarkdown, parsePointLine, customSourceUrl } from '../server/features/social-cards/index.mjs';
import { renderStoryboardHtml } from '../server/features/social-cards/application/social-card-pipeline.mjs';
import { sanitizeCardPlan } from '../server/shared/rendering/storyboard-content.mjs';
import { socialThemeDefinition } from '../server/shared/themes/social-theme-compiler.mjs';

const okEditorial={must_disclose:'体验来自作者确认',forbidden_claims:'不得夸大效果',target_reader:'职场新人',pain_point:'整理效率低',recommended_pages:6};
const okFact={kind:'custom',content_type:'tutorial',topic:'三步同步笔记',thesis:'',points:[
  {text:'要点一',source_level:'author_experience',source_url:''},
  {text:'要点二',source_level:'user_material',source_url:'https://example.com/a'},
  {text:'要点三',source_level:'model_suggestion',source_url:''},
],steps:['第一步','第二步'],items:[],materials:[{url:'https://example.com/a',status:'ok',content_chars:100}],limitations:''};

test('自定义门禁在事实基座与编辑决策齐备时通过', () => {
  const gate=evaluateCustomCardGate({}, {data:okFact}, okEditorial);
  assert.equal(gate.ready,true,gate.issues.join('；'));
  assert.equal(gate.contentType,'custom');
});

test('自定义门禁拦截来源等级缺失、全模型建议和素材抓取失败', () => {
  const missingLevel={...okFact,points:[{text:'a',source_level:''},{text:'b',source_level:'author_experience'},{text:'c',source_level:'user_material'}]};
  assert.match(evaluateCustomCardGate({},{data:missingLevel},okEditorial).issues.join('；'),/来源等级/);
  const allModel={...okFact,points:[{text:'a',source_level:'model_suggestion'},{text:'b',source_level:'model_suggestion'},{text:'c',source_level:'model_suggestion'}]};
  assert.match(evaluateCustomCardGate({},{data:allModel},okEditorial).issues.join('；'),/作者体验或用户素材/);
  const badMaterial={...okFact,materials:[{url:'https://example.com/x',status:'error',error:'超时'}]};
  assert.match(evaluateCustomCardGate({},{data:badMaterial},okEditorial).issues.join('；'),/素材链接/);
});

test('自定义门禁按内容类型检查教程步骤、清单条目和核心观点', () => {
  assert.match(evaluateCustomCardGate({},{data:{...okFact,steps:['仅一步']}},okEditorial).issues.join('；'),/教程步骤/);
  const listFact={...okFact,content_type:'list',steps:[],items:['甲','乙']};
  assert.match(evaluateCustomCardGate({},{data:listFact},okEditorial).issues.join('；'),/清单条目/);
  const opinionFact={...okFact,content_type:'opinion',steps:[],thesis:''};
  assert.match(evaluateCustomCardGate({},{data:opinionFact},okEditorial).issues.join('；'),/核心观点/);
  const goodList={...okFact,content_type:'list',steps:[],items:['甲','乙','丙']};
  assert.equal(evaluateCustomCardGate({},{data:goodList},okEditorial).ready,true);
});

test('要点行解析支持来源等级前缀与行尾 URL', () => {
  assert.deepEqual(parsePointLine('【体验】我每周整理一次'),{text:'我每周整理一次',source_level:'author_experience',source_url:''});
  assert.deepEqual(parsePointLine('【素材】官方文档 https://example.com/docs'),{text:'官方文档',source_level:'user_material',source_url:'https://example.com/docs'});
  assert.deepEqual(parsePointLine('普通建议'),{text:'普通建议',source_level:'model_suggestion',source_url:''});
  assert.equal(parsePointLine('【体验】'),null);
  assert.ok(CUSTOM_CONTENT_TYPES.tutorial&&CUSTOM_SOURCE_LEVELS.author_experience);
  assert.equal(customSourceUrl(42),'custom://42');
});

test('自定义事实基座构建校验类型、要点数量与来源等级', async () => {
  const fetchImpl=async({targetUrl})=>({status:'ok',title:'素材',content:'正文',content_chars:2,url:targetUrl});
  const fact=await buildCustomFactSheet({input:{
    content_type:'list',topic:'三个笔记工具',points:'【体验】工具甲顺手\n【素材】工具乙官网介绍\n工具丙可以试试',
    items:'甲\n乙\n丙',materialUrls:'https://example.com/a',expected_pages:8,
  },fetchImpl});
  assert.equal(fact.kind,'custom');
  assert.equal(fact.points.length,3);
  assert.equal(fact.points[0].source_level,'author_experience');
  assert.equal(fact.materials[0].status,'ok');
  assert.equal(fact.expected_pages,8);
  await assert.rejects(()=>buildCustomFactSheet({input:{content_type:'seed',topic:'x',points:'a\nb\nc'},fetchImpl}),/内容类型/);
  await assert.rejects(()=>buildCustomFactSheet({input:{content_type:'opinion',topic:'x',points:'只有一条'},fetchImpl}),/至少/);
  await assert.rejects(()=>buildCustomFactSheet({input:{content_type:'opinion',topic:'x',points:'a\nb\nc'},fetchImpl}),/作者真实体验/);
});

test('已成功读取的本地项目可作为教程的用户素材上下文', async () => {
  const fact=await buildCustomFactSheet({input:{
    content_type:'tutorial',topic:'本地工具教程',
    points:'第一步\n第二步\n第三步',
  },hasUserMaterialContext:true,fetchImpl:async()=>({status:'ok'})});
  assert.equal(fact.has_user_material_context,true);
  assert.ok(fact.points.every((item)=>item.source_level==='model_suggestion'));
});

test('自定义事实清单标注来源等级与体验边界', async () => {
  const fact=await buildCustomFactSheet({input:{content_type:'opinion',topic:'观点',thesis:'核心观点',points:'【体验】亲身经历\n【素材】引用 https://example.com/a\n建议项'},fetchImpl:async()=>({status:'ok'})});
  const md=customFactMarkdown(fact);
  assert.match(md,/作者真实体验/);
  assert.match(md,/用户提供素材/);
  assert.match(md,/模型建议/);
  assert.match(md,/核心观点/);
  assert.match(md,/体验真实性边界/);
});

test('自定义图文渲染使用独立标签体系与品牌行', () => {
  const legacyTheme=structuredClone(socialThemeDefinition('peach')); delete legacyTheme.social.templatePack; delete legacyTheme.hash; delete legacyTheme.file;
  const pages=[{kind:'cover',title:'封面',goal:'目标'},{kind:'step',title:'第一步',goal:'操作',content_blocks:[{type:'text',content:'内容'}]},{kind:'ending',title:'结尾',goal:'收尾'}];
  const wechat=renderStoryboardHtml({topic:'主题',pages,contentType:'custom',sourceLabel:'教程',channelMode:'wechat',visualStyle:'peach',themeDefinition:legacyTheme});
  assert.match(wechat,/HOW TO/);
  assert.match(wechat,/CUSTOM \/ 教程/);
  assert.match(wechat,/内容整理自作者素材/);
  assert.match(wechat,/data-channel="wechat"/);
  const xhs=renderStoryboardHtml({topic:'主题',pages,contentType:'custom',sourceLabel:'教程',channelMode:'xiaohongshu',visualStyle:'peach',themeDefinition:legacyTheme});
  assert.match(xhs,/小红书 · 教程/);
  assert.match(xhs,/data-channel="xiaohongshu"/);
  assert.match(xhs,/\.page\{width:375px;height:667px/);
  assert.doesNotMatch(xhs,/height:500px/);
});

test('小红书渠道渲染数据卡、对比卡、步骤卡、时间卡、场景卡、亮点卡版式', () => {
  const pages=[{kind:'content',title:'版式页一',goal:'目标',content_blocks:[
    {type:'stats',title:'关键数字',items:[{num:'2.8万亿',label:'参数规模'},{num:'100万',label:'上下文'}]},
    {type:'compare',title:'对比',headers:['维度','K3','GPT-5.6'],rows:[['上下文','100万','40万'],['协议','MIT','闭源']]},
    {type:'steps',title:'上手',items:[{title:'安装',content:'复制命令'},{title:'运行',content:'执行脚本'}]},
  ]},{kind:'content',title:'版式页二',goal:'目标',content_blocks:[
    {type:'timeline',title:'进展',items:[{time:'7月16日',title:'发布',content:'K3 发布'},{time:'7月27日',title:'开源',content:'预计开源'}]},
    {type:'scenes',title:'场景',items:[{title:'写作',content:'长文润色'},{title:'编程',content:'代码补全'}]},
    {type:'highlight',title:'核心亮点',content:'开源协议宽松，可商用'},
  ]}];
  const html=renderStoryboardHtml({topic:'主题',pages,contentType:'custom',sourceLabel:'教程',channelMode:'xiaohongshu'});
  assert.match(html,/<div class="stat"><b>2\.8万亿<\/b><span data-text-role="auxiliary">参数规模<\/span><\/div>/);
  assert.match(html,/<th data-text-role="auxiliary">K3<\/th>/);
  assert.match(html,/<td>MIT<\/td>/);
  assert.match(html,/<div class="step"><b>1<\/b>/);
  assert.match(html,/class="tl-time" data-text-role="auxiliary">7月16日/);
  assert.match(html,/<div class="scene"><h3>写作<\/h3>/);
  assert.match(html,/highlight-block/);
  assert.match(html,/开源协议宽松，可商用/);
});

test('新版式块缺少 items 时退化为列表或文本块', () => {
  const pages=[{kind:'content',title:'兜底页',goal:'目标',content_blocks:[
    {type:'timeline',title:'关键节点',content:'7月16日：发布\n7月27日：开源',items:[],headers:[],rows:[]},
    {type:'stats',title:'数字',content:'无结构化数据',items:[],headers:[],rows:[]},
  ]}];
  const html=renderStoryboardHtml({topic:'主题',pages,contentType:'event',sourceLabel:'事件专题',channelMode:'xiaohongshu'});
  assert.doesNotMatch(html,/timeline-block/);
  assert.doesNotMatch(html,/stats-block/);
  assert.match(html,/<li>7月16日：发布<\/li>/);
  assert.match(html,/无结构化数据/);
});

test('时间线归一化模型别名但不在归一化阶段删除重复块', () => {
  const pages = sanitizeCardPlan([{ kind:'content', role:'timeline', title:'时间线', content_blocks:[
    { type:'timeline', title:'阶段变化', items:[{ time:'2025年', text:'阿里巴巴宣布拟配售新股，资金投入 AI 基础设施。' }] },
    { type:'timeline', title:'阶段变化', items:[{ time:'2025年', text:'阿里巴巴宣布拟配售新股，资金投入 AI 基础设施。' }] },
  ] }]);
  assert.equal(pages[0].content_blocks.length, 2);
  assert.equal(pages[0].content_blocks[0].type, 'text');
  assert.equal(pages[0].content_blocks[1].type, 'text');
  assert.match(pages[0].content_blocks[0].content, /资金投入 AI 基础设施/);
  const html = renderStoryboardHtml({ topic:'主题', pages, contentType:'event', sourceLabel:'事件专题', channelMode:'xiaohongshu' });
  assert.equal((html.match(/timeline-block/g) || []).length, 0);
  assert.match(html, /资金投入 AI 基础设施/);
});

test('列表数组拆成条目，单条时间线不渲染骨架且保留跨页补充', () => {
  const pages = sanitizeCardPlan([
    { kind:'content', role:'concept', title:'背景', content_blocks:[
      { type:'list', title:'关键节点', content:['2019年：上市','2025年：配售'], items:[] },
      { type:'note', title:'来源证据', content:'同一来源说明', fact_ids:['fact-source'], supplement_slot_id:'context' },
    ] },
    { kind:'content', role:'evidence', title:'来源', content_blocks:[
      { type:'note', title:'来源证据', content:'同一来源说明', fact_ids:['fact-source'], supplement_slot_id:'source' },
      { type:'timeline', title:'阶段变化', items:[{time:'2025年', text:'只有一个阶段'}] },
    ] },
  ]);
  assert.deepEqual(pages[0].content_blocks[0].items, ['2019年：上市', '2025年：配售']);
  assert.equal(pages[0].content_blocks[0].content, '2019年：上市\n2025年：配售');
  assert.equal(pages[1].content_blocks.some((block) => block.type === 'timeline'), false);
  assert.equal(pages[0].content_blocks.filter((block) => block.title === '来源证据').length, 1);
  assert.equal(pages[1].content_blocks.filter((block) => block.title === '来源证据').length, 1);
});

test('旧版逗号拼接列表在最终入口恢复为独立条目', () => {
  const pages = sanitizeCardPlan([{ kind:'content', role:'timeline', content_blocks:[
    { type:'list', title:'关键节点', content:'2019年：上市,2025年：配售金额800亿港元,所得款项投入AI基础设施', items:[] },
  ] }]);
  assert.deepEqual(pages[0].content_blocks[0].items, ['2019年：上市', '2025年：配售金额800亿港元', '所得款项投入AI基础设施']);
  assert.equal(pages[0].content_blocks[0].content, '2019年：上市\n2025年：配售金额800亿港元\n所得款项投入AI基础设施');
});

test('list 块支持 items 字符串数组兜底', () => {
  const pages=[{kind:'content',title:'列表页',goal:'目标',content_blocks:[
    {type:'list',title:'各方立场',content:'',items:['甲方：指控','乙方：否认'],headers:[],rows:[]},
  ]}];
  const html=renderStoryboardHtml({topic:'主题',pages,contentType:'event',sourceLabel:'事件专题',channelMode:'xiaohongshu'});
  assert.match(html,/<li>甲方：指控<\/li>/);
  assert.match(html,/<li>乙方：否认<\/li>/);
});

test('工具与事件图文在小红书渠道下使用小红书品牌行', () => {
  const pages=[{kind:'cover',title:'封面',goal:'目标'},{kind:'ending',title:'结尾',goal:'收尾'}];
  const toolWechat=renderStoryboardHtml({topic:'主题',repository:'acme/tool',pages,contentType:'repository',channelMode:'wechat'});
  assert.match(toolWechat,/OPEN SOURCE \/ acme\/tool/);
  const toolXhs=renderStoryboardHtml({topic:'主题',repository:'acme/tool',pages,contentType:'repository',channelMode:'xiaohongshu'});
  assert.match(toolXhs,/小红书 · acme\/tool/);
  assert.match(toolXhs,/data-channel="xiaohongshu"/);
  const eventWechat=renderStoryboardHtml({topic:'主题',pages,contentType:'event',sourceLabel:'事件专题',channelMode:'wechat'});
  assert.match(eventWechat,/EVENT DESK \/ 事件专题/);
  const eventXhs=renderStoryboardHtml({topic:'主题',pages,contentType:'event',sourceLabel:'事件专题',channelMode:'xiaohongshu'});
  assert.match(eventXhs,/小红书 · 事件专题/);
  assert.match(eventXhs,/data-channel="xiaohongshu"/);
});
