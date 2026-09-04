import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CONSUMER_CAPABILITY_REASON_CODES, analyzeImplementationImpact, buildCapabilityGraph } from '../server/platform/tools/capability-graph.mjs';
import { handleSystemRoutes } from '../server/platform/http/routes/system-routes.mjs';

// 阶段 2/3：消费者—能力统一可用性计算（设计文档 §5）与只读接口（§8）的测试。
// available = consumerDeclared && adapterReady && skillAllowed && implementationEnabled && implementationHealthy

const projectRoot=path.resolve(import.meta.dirname,'..');
const tool=(id,capabilities,overrides={})=>({id,name:id,version:'1.0.0',capabilities,riskLevel:'read-only',enabled:true,priority:0,...overrides});

function makeRoot(t,{consumers,activeConfigs={}}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'consumer-state-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'config'),{recursive:true});
  fs.writeFileSync(path.join(dir,'config','capabilities.json'),JSON.stringify({schemaVersion:1,capabilities:{
    'cap_content_web_search':{name:'网络搜索',description:'检索公开网页。',category:'信息获取'},
    'cap_filesystem_project_read':{name:'本地项目读取',description:'读取本地项目。',category:'本地内容'},
  }}));
  fs.writeFileSync(path.join(dir,'config','capability-consumers.json'),JSON.stringify({schemaVersion:1,consumers}));
  for(const [skillId,config] of Object.entries(activeConfigs)){
    fs.mkdirSync(path.join(dir,'writing-skills',skillId),{recursive:true});
    fs.writeFileSync(path.join(dir,'writing-skills',skillId,'active.json'),JSON.stringify(config));
  }
  return dir;
}

const agentConsumer=(overrides={})=>({id:'agent.demo',name:'演示 Agent',type:'agent',entryPoint:'demo',runtimeSkillIds:['demo-skill'],dependencies:[],...overrides});
const stateOf=(graph,consumerId,capability)=>graph.consumerStates.find((item)=>item.consumerId===consumerId&&item.capability===capability);

test('完整链路可用；degraded 适配只降级不阻断',(t)=>{
  const root=makeRoot(t,{consumers:[agentConsumer({dependencies:[
    {capability:'cap_content_web_search',requirement:'optional',failurePolicy:'continue-with-warning',declaration:'optional',adapterStatus:'ready',resourceKinds:[],triggerPolicy:'model-request',authorizationAction:null,resultPolicy:'passthrough',source:'builtin'},
    {capability:'cap_filesystem_project_read',requirement:'optional',failurePolicy:'continue-with-warning',declaration:'optional',adapterStatus:'degraded',resourceKinds:['local-project'],triggerPolicy:'deterministic-first-step',authorizationAction:'local-project-read',resultPolicy:'summary',source:'builtin'},
  ]})]});
  const graph=buildCapabilityGraph({root,tools:[tool('search-a',['cap_content_web_search']),tool('search-b',['cap_content_web_search']),tool('reader',['cap_filesystem_project_read'])]});
  const ready=stateOf(graph,'agent.demo','cap_content_web_search');
  assert.equal(ready.available,true);assert.equal(ready.status,'ready');assert.deepEqual(ready.reasons,[]);
  const degraded=stateOf(graph,'agent.demo','cap_filesystem_project_read');
  assert.equal(degraded.available,true);assert.equal(degraded.status,'degraded');assert.deepEqual(degraded.warnings,['ADAPTER_DEGRADED']);
});

test('NO_ENABLED_IMPLEMENTATION 与 IMPLEMENTATION_UNHEALTHY 分别阻断',(t)=>{
  const root=makeRoot(t,{consumers:[agentConsumer({dependencies:[
    {capability:'cap_content_web_search',requirement:'optional',failurePolicy:'continue-with-warning',declaration:'optional',adapterStatus:'ready',resourceKinds:[],triggerPolicy:'model-request',authorizationAction:null,resultPolicy:'passthrough',source:'builtin'},
    {capability:'cap_filesystem_project_read',requirement:'optional',failurePolicy:'continue-with-warning',declaration:'optional',adapterStatus:'ready',resourceKinds:['local-project'],triggerPolicy:'explicit-resource',authorizationAction:'local-project-read',resultPolicy:'summary',source:'builtin'},
  ]})]});
  const graph=buildCapabilityGraph({root,tools:[tool('disabled-search',['cap_content_web_search'],{enabled:false}),tool('unconfigured-reader',['cap_filesystem_project_read'],{configuration:{fields:[]}})],configurationState:()=>({configured:false})});
  const disabled=stateOf(graph,'agent.demo','cap_content_web_search');
  assert.equal(disabled.available,false);assert.deepEqual(disabled.reasons,['NO_ENABLED_IMPLEMENTATION']);
  const unhealthy=stateOf(graph,'agent.demo','cap_filesystem_project_read');
  assert.equal(unhealthy.available,false);assert.deepEqual(unhealthy.reasons,['IMPLEMENTATION_UNHEALTHY']);
});

test('SKILL_NOT_ALLOWED 来自运行时技能的活动配置白名单',(t)=>{
  const root=makeRoot(t,{consumers:[agentConsumer({dependencies:[
    {capability:'cap_content_web_search',requirement:'optional',failurePolicy:'continue-with-warning',declaration:'optional',adapterStatus:'ready',resourceKinds:[],triggerPolicy:'model-request',authorizationAction:null,resultPolicy:'passthrough',source:'builtin'},
  ]})],activeConfigs:{'demo-skill':{prompt:'规则',allowedTools:['cap_filesystem_project_read']}}});
  const graph=buildCapabilityGraph({root,tools:[tool('search-a',['cap_content_web_search'])]});
  const state=stateOf(graph,'agent.demo','cap_content_web_search');
  assert.equal(state.skillAllowed,false);assert.equal(state.available,false);assert.deepEqual(state.reasons,['SKILL_NOT_ALLOWED']);
});

test('缺口行产出 CONSUMER_NOT_DECLARED 与 ADAPTER_MISSING，原因码按固定优先级排序',(t)=>{
  const root=makeRoot(t,{consumers:[agentConsumer({runtimeSkillIds:['demo-skill'],dependencies:[],gaps:[{capability:'cap_filesystem_project_read',reason:'未完成资源接入'}]})],activeConfigs:{'demo-skill':{prompt:'规则',allowedTools:['cap_content_web_search']}}});
  const graph=buildCapabilityGraph({root,tools:[]});
  const gap=stateOf(graph,'agent.demo','cap_filesystem_project_read');
  assert.equal(gap.declared,false);assert.equal(gap.available,false);assert.equal(gap.status,'blocked');
  assert.deepEqual(gap.reasons,['CONSUMER_NOT_DECLARED','ADAPTER_MISSING']);
  assert.equal(gap.gapReason,'未完成资源接入');
  // 组合场景：已声明但缺少适配且没有实现 → 按 BLOCKING 顺序输出
  const root2=makeRoot(t,{consumers:[agentConsumer({id:'agent.combo',runtimeSkillIds:['demo-skill'],dependencies:[
    {capability:'cap_content_web_search',requirement:'optional',failurePolicy:'continue-with-warning',declaration:'optional',adapterStatus:'missing',resourceKinds:[],triggerPolicy:'model-request',authorizationAction:null,resultPolicy:'passthrough',source:'builtin'},
  ]})]});
  const combo=stateOf(buildCapabilityGraph({root:root2,tools:[]}),'agent.combo','cap_content_web_search');
  assert.deepEqual(combo.reasons,['ADAPTER_MISSING','NO_ENABLED_IMPLEMENTATION']);
  // 导出的原因码清单与文档 §5 对齐
  for(const code of ['CONSUMER_NOT_DECLARED','ADAPTER_MISSING','SKILL_NOT_ALLOWED','NO_ENABLED_IMPLEMENTATION','IMPLEMENTATION_UNHEALTHY'])
    assert.ok(CONSUMER_CAPABILITY_REASON_CODES.includes(code),code);
});

test('三向反向查询：消费者→能力、能力→消费者、实现→消费者',async (t)=>{
  const root=makeRoot(t,{consumers:[agentConsumer({dependencies:[
    {capability:'cap_content_web_search',requirement:'optional',failurePolicy:'continue-with-warning',declaration:'optional',adapterStatus:'ready',resourceKinds:[],triggerPolicy:'model-request',authorizationAction:null,resultPolicy:'passthrough',source:'builtin'},
  ]})]});
  const graph=buildCapabilityGraph({root,tools:[tool('search-a',['cap_content_web_search'])]});
  // 消费者 → 能力
  assert.deepEqual(graph.consumerStates.filter((item)=>item.consumerId==='agent.demo').map((item)=>item.capability),['cap_content_web_search']);
  // 能力 → 消费者（状态已回填）
  const entry=graph.capabilities.find((item)=>item.id==='cap_content_web_search').consumers.find((item)=>item.consumerId==='agent.demo');
  assert.equal(entry.available,true);assert.equal(entry.consumerStatus,'degraded');assert.deepEqual(entry.reasons,[]);
  // 实现 → 消费者（停用影响）
  const impact=analyzeImplementationImpact(graph,{type:'tool',id:'search-a'});
  const affected=impact.capabilities[0];
  const consumer=affected.consumers.find((item)=>item.consumerId==='agent.demo');
  assert.equal(consumer.currentlyAvailable,true);assert.equal(consumer.availableAfterDisable,false);
  assert.deepEqual(affected.consumersLosingAvailability,[{consumerId:'agent.demo',consumerName:'演示 Agent',consumerType:'agent'}]);
});

test('真实仓库：三个 Agent 的现状状态与缺口',async ()=>{
  const { getToolRegistry }=await import('../server/platform/tools/index.mjs');
  const registry=await getToolRegistry();
  const listed=registry.listCapabilities({includeDisabled:true});
  const graph=buildCapabilityGraph({root:projectRoot,tools:listed.map((item)=>({id:item.plugin,name:item.plugin,version:item.version,capabilities:[item.capability],enabled:item.enabled,priority:item.priority,riskLevel:item.riskLevel}))});
  // 阶段 5：通用资源适配层（server/platform/agent/resource-adaptation.mjs）为 tutorial/custom-social 补齐
  // passage.retrieve 的 resourceIds 映射（带透传回退），Agent 消费者不再有 degraded 适配
  const degraded=graph.consumerStates.filter((item)=>item.consumerType==='agent'&&item.adapterStatus==='degraded');
  assert.deepEqual(degraded,[]);
  for(const consumerId of ['agent.custom-social','agent.independent-writing']){
    const passage=stateOf(graph,consumerId,'cap_content_passage_retrieve');
    assert.equal(passage.available,true);assert.equal(passage.adapterStatus,'ready');assert.deepEqual(passage.warnings,[]);
  }
  // 扩展方案阶段 A：custom-social 已接入 cap_filesystem_project_read（explicit-resource），缺口消除
  const projectRead=stateOf(graph,'agent.custom-social','cap_filesystem_project_read');
  assert.equal(projectRead.declared,true);assert.equal(projectRead.adapterStatus,'ready');assert.equal(projectRead.available,true);
  assert.ok(graph.consumerStates.filter((item)=>item.consumerType==='agent'&&item.declared).every((item)=>item.available));
  assert.ok(graph.summary.consumerRelations.total>=19);
});

async function callApi(t,pathname){
  let payload=null;
  const handled=await handleSystemRoutes({
    request:{method:'GET'},response:{},pathname,searchParams:new URLSearchParams(),
    root:projectRoot,config:{},store:{listCollectionSources:()=>[]},
    json(_response,status,data){payload={status,data};},body:async()=>({}),
  });
  assert.equal(handled,true,pathname);
  return payload;
}

test('只读接口返回消费者清单与详情，且不泄漏本地路径与授权边界',async ()=>{
  const list=await callApi(null,'/api/system/capability-consumers');
  assert.equal(list.status,200);
  const editorial=list.data.consumers.find((item)=>item.consumerId==='agent.editorial');
  assert.equal(editorial.type,'agent');assert.equal(editorial.summary.total,5);
  // cap_content_web_search / cap_content_news_search 依赖 tavily-search 的 apiKey 配置，
  // 未配置的环境（如 CI）这两项为 blocked，故只断言其余 3 项不依赖凭据的能力可用
  assert.ok(editorial.summary.available>=3);
  const detail=await callApi(null,'/api/system/capability-consumers/agent.custom-social');
  assert.equal(detail.status,200);
  assert.equal(detail.data.runtimeSkillIds[0],'custom-card-storyboard');
  // 扩展方案阶段 A：cap_filesystem_project_read 已接入，详情中应为声明且可用
  const projectRead=detail.data.capabilities.find((item)=>item.capability==='cap_filesystem_project_read');
  assert.equal(projectRead.declared,true);assert.equal(projectRead.adapterStatus,'ready');assert.equal(projectRead.available,true);
  const missing=await callApi(null,'/api/system/capability-consumers/agent.unknown');
  assert.equal(missing.status,404);
  // 阶段 C：无归属技能消费者详情返回 skillAuthorizations（授权载体即自身）
  const skill=await callApi(null,'/api/system/capability-consumers/wechat-mp-composite');
  assert.equal(skill.status,200);assert.equal(skill.data.type,'skill');
  assert.deepEqual(skill.data.runtimeSkillIds,['wechat-mp-composite']);
  assert.equal(skill.data.skillAuthorizations.length,1);
  assert.equal(skill.data.skillAuthorizations[0].skillId,'wechat-mp-composite');
  assert.ok(skill.data.skillAuthorizations[0].editable.includes('cap_content_url_fetch'));
  const skillRow=skill.data.capabilities.find((item)=>item.capability==='cap_content_url_fetch');
  assert.equal(skillRow.skillAuthorizations[0].editable,true);assert.equal(skillRow.skillAuthorizations[0].allowed,true);
  // 阶段 C：feature 消费者详情无授权开关（空数组），但携带适配字段与失败策略
  const feature=await callApi(null,'/api/system/capability-consumers/feature.wechat-typeset');
  assert.equal(feature.status,200);assert.equal(feature.data.type,'feature');
  assert.deepEqual(feature.data.skillAuthorizations,[]);
  const render=feature.data.capabilities.find((item)=>item.capability==='cap_diagram_mermaid_render');
  assert.equal(render.adapterStatus,'ready');assert.equal(render.triggerPolicy,'code-path');
  assert.equal(render.resultPolicy,'article-asset');assert.equal(render.requirement,'conditional');assert.equal(render.failurePolicy,'block');
  // purpose 用途说明透传：列表与详情均携带
  assert.ok(feature.data.purpose.includes('排版'),feature.data.purpose);
  const featureInList=list.data.consumers.find((item)=>item.consumerId==='feature.wechat-typeset');
  assert.equal(featureInList.purpose,feature.data.purpose);
  // 敏感信息（本地路径、allowedRoots、凭据）不得进入响应
  const serialized=JSON.stringify([list.data,detail.data]);
  assert.ok(!serialized.includes(projectRoot),'响应包含本地绝对路径');
  assert.ok(!/allowedRoots|credential|secret/i.test(serialized),'响应包含授权边界或凭据字段');
});
