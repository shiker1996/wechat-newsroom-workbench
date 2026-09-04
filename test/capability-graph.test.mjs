import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { analyzeImplementationImpact, buildCapabilityGraph } from '../server/platform/tools/capability-graph.mjs';

const root=path.resolve(import.meta.dirname,'..');
const tool=(id,capabilities,priority=0)=>({id,name:id,version:'1.0.0',capabilities,riskLevel:'read-only',enabled:true,priority});

test('统一依赖图聚合技能、编码功能、普通工具和采集来源',()=>{
  const graph=buildCapabilityGraph({root,tools:[tool('search-a',['cap_content_web_search'],10),tool('search-b',['cap_content_web_search'],0),tool('passage',['cap_content_passage_retrieve'])],collectors:[{id:'feed',name:'Feed',version:'1.0.0',capabilities:['cap_collect_direct'],enabled:true,available:true}],collectionSources:[{id:1,label:'示例 Feed',source_type:'direct',enabled:true}]});
  assert.ok(graph.consumers.some((item)=>item.type==='skill'));
  assert.ok(graph.consumers.some((item)=>item.id==='feature.article-passage-retrieval'));
  assert.equal(graph.capabilities.find((item)=>item.id==='cap_content_web_search').implementations.length,2);
  assert.equal(graph.capabilities.find((item)=>item.id==='cap_collect_direct').consumers[0].consumerType,'collection-source');
  assert.equal(graph.summary.implementations,4);
  assert.deepEqual(graph.aggregationOrder,['catalog','consumers','implementations','routes']);
  assert.equal(graph.capabilities.find((item)=>item.id==='cap_content_web_search').name,'网络搜索');
  assert.equal(graph.capabilities.find((item)=>item.id==='cap_collect_direct').category,'内容采集');
});

test('目录能力即使暂无消费者和实现也保留，未知能力标记为扩展能力',()=>{
  const graph=buildCapabilityGraph({root,tools:[tool('extension',['cap_vendor_custom_lookup'])]});
  assert.equal(graph.capabilities.find((item)=>item.id==='cap_collect_reddit').registered,true);
  assert.equal(graph.capabilities.find((item)=>item.id==='cap_collect_reddit').status,'unused');
  const extension=graph.capabilities.find((item)=>item.id==='cap_vendor_custom_lookup');
  assert.equal(extension.registered,false);
  assert.equal(extension.category,'扩展能力');
  assert.equal(graph.summary.unregistered,1);
});

test('只读影响分析区分安全切换、降级和阻断',()=>{
  const graph=buildCapabilityGraph({root,tools:[tool('primary',['cap_content_passage_retrieve'],10),tool('backup',['cap_content_passage_retrieve'],0)]});
  const primary=analyzeImplementationImpact(graph,{type:'tool',id:'primary'});assert.equal(primary.canDisable,true);assert.equal(primary.degraded[0].remainingImplementations[0].id,'backup');
  const only=buildCapabilityGraph({root,tools:[tool('primary',['cap_content_passage_retrieve'],10)]});const blocked=analyzeImplementationImpact(only,{type:'tool',id:'primary'});assert.equal(blocked.canDisable,false);assert.equal(blocked.blocking[0].capability,'cap_content_passage_retrieve');
});

test('统一能力路由将首选实现置于候选链首位',()=>{
  const graph=buildCapabilityGraph({root,tools:[tool('primary',['cap_content_web_search'],10),tool('preferred',['cap_content_web_search'],0)],routes:{'cap_content_web_search':{preferredImplementationId:'preferred'}}});
  const capability=graph.capabilities.find((item)=>item.id==='cap_content_web_search');
  assert.equal(capability.preferredImplementationId,'preferred');
  assert.equal(capability.implementations[0].id,'preferred');
});
