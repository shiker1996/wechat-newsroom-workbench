import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCustomCardGate, CUSTOM_CONTENT_TYPES, CUSTOM_SOURCE_LEVELS } from '../lib/social-card-gate.mjs';
import { buildCustomFactSheet, customFactMarkdown, parsePointLine, customSourceUrl } from '../lib/custom-fact-builder.mjs';
import { renderStoryboardHtml } from '../lib/social-card-pipeline.mjs';

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
  const pages=[{kind:'cover',title:'封面',goal:'目标'},{kind:'step',title:'第一步',goal:'操作',content_blocks:[{type:'text',content:'内容'}]},{kind:'ending',title:'结尾',goal:'收尾'}];
  const wechat=renderStoryboardHtml({topic:'主题',pages,contentType:'custom',sourceLabel:'教程',channelMode:'wechat'});
  assert.match(wechat,/HOW TO/);
  assert.match(wechat,/CUSTOM \/ 教程/);
  assert.match(wechat,/内容整理自作者素材/);
  assert.match(wechat,/data-channel="wechat"/);
  const xhs=renderStoryboardHtml({topic:'主题',pages,contentType:'custom',sourceLabel:'教程',channelMode:'xiaohongshu'});
  assert.match(xhs,/小红书 · 教程/);
  assert.match(xhs,/data-channel="xiaohongshu"/);
  assert.match(xhs,/body\[data-channel="xiaohongshu"\] \.page\{height:500px\}/);
});
