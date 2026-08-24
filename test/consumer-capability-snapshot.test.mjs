import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { EDITORIAL_AGENT_CAPABILITIES } from '../server/features/articles/application/agent/editorial-adapter.mjs';
import { TUTORIAL_AGENT_CAPABILITIES } from '../server/features/articles/application/agent/tutorial-adapter.mjs';
import { CUSTOM_SOCIAL_AGENT_CAPABILITIES } from '../server/features/social-cards/application/agent/custom-social-adapter.mjs';
import { buildConversationToolCatalog } from '../server/platform/agent/tool-catalog.mjs';
import { deriveAgentEntryCapabilities } from '../server/platform/agent/entry-capabilities.mjs';
import { buildCapabilityGraph } from '../server/platform/tools/capability-graph.mjs';
import { getToolRegistry } from '../server/platform/tools/index.mjs';
import { buildConsumerCapabilityBaseline } from '../scripts/quality/snapshot-consumer-capability-baseline.mjs';

// 阶段 0 冻结基线：固化三个 Agent 当前的能力可见性行为与图谱现状。
// 任何修改 Adapter 能力常量、目录过滤规则或实现启停状态的变更都必须显式更新本快照。

const root=path.resolve(import.meta.dirname,'..');
const catalogShape=(registry,entryCapabilities,allowedCapabilities=null)=>buildConversationToolCatalog({registry,entryCapabilities,allowedCapabilities})
  .map((item)=>({capability:item.capability,implementations:item.implementations.map((impl)=>impl.plugin).sort()}));

test('三个 Agent 的能力常量快照保持不变',()=>{
  assert.deepEqual(EDITORIAL_AGENT_CAPABILITIES,Object.freeze([
    'filesystem.project.read','content.url.fetch','content.passage.retrieve','content.web.search','content.news.search',
  ]));
  assert.deepEqual(TUTORIAL_AGENT_CAPABILITIES,Object.freeze([
    'filesystem.project.read','content.url.fetch','content.web.search','content.news.search','content.document.search','content.passage.retrieve',
  ]));
  assert.deepEqual(CUSTOM_SOCIAL_AGENT_CAPABILITIES,Object.freeze([
    'filesystem.project.read','content.url.fetch','content.web.search','content.news.search','content.document.search','content.repository.inspect','content.passage.retrieve',
  ]));
});

test('三个 Agent 的会话工具目录快照（真实注册表）',async ()=>{
  const registry=await getToolRegistry();
  assert.deepEqual(catalogShape(registry,EDITORIAL_AGENT_CAPABILITIES),[
    {capability:'content.news.search',implementations:['tavily-search']},
    {capability:'content.passage.retrieve',implementations:['local-passage-retrieval']},
    {capability:'content.url.fetch',implementations:['url-fetch']},
    {capability:'content.web.search',implementations:['tavily-search']},
    {capability:'filesystem.project.read',implementations:['local-project-reader']},
  ]);
  assert.deepEqual(catalogShape(registry,TUTORIAL_AGENT_CAPABILITIES),[
    {capability:'content.document.search',implementations:['document-folder-search']},
    {capability:'content.news.search',implementations:['tavily-search']},
    {capability:'content.passage.retrieve',implementations:['local-passage-retrieval']},
    {capability:'content.url.fetch',implementations:['url-fetch']},
    {capability:'content.web.search',implementations:['tavily-search']},
    {capability:'filesystem.project.read',implementations:['local-project-reader']},
  ]);
  assert.deepEqual(catalogShape(registry,CUSTOM_SOCIAL_AGENT_CAPABILITIES),[
    {capability:'content.document.search',implementations:['document-folder-search']},
    {capability:'content.news.search',implementations:['tavily-search']},
    {capability:'content.passage.retrieve',implementations:['local-passage-retrieval']},
    {capability:'content.repository.inspect',implementations:['repository-inspector']},
    {capability:'content.url.fetch',implementations:['url-fetch']},
    {capability:'content.web.search',implementations:['tavily-search']},
    {capability:'filesystem.project.read',implementations:['local-project-reader']},
  ]);
});

test('登记派生的 Agent 目录与能力常量一致（阶段 2 机制二的行为不变基线）',()=>{
  // 登记与常量当前恰好一致：从登记派生的目录集合必须与常量相等，证明权威反转对运行时零影响
  for(const [consumerId,constant] of [
    ['agent.editorial',EDITORIAL_AGENT_CAPABILITIES],
    ['agent.independent-writing',TUTORIAL_AGENT_CAPABILITIES],
    ['agent.custom-social',CUSTOM_SOCIAL_AGENT_CAPABILITIES],
  ])assert.deepEqual(deriveAgentEntryCapabilities(root,consumerId,constant),[...constant].sort(),consumerId);
});

test('技能白名单收窄三个 Agent 的可见能力',async ()=>{
  const registry=await getToolRegistry();
  assert.deepEqual(catalogShape(registry,EDITORIAL_AGENT_CAPABILITIES,['content.web.search','content.news.search']),
    [{capability:'content.news.search',implementations:['tavily-search']},{capability:'content.web.search',implementations:['tavily-search']}]);
  assert.deepEqual(catalogShape(registry,CUSTOM_SOCIAL_AGENT_CAPABILITIES,['filesystem.project.read']),
    [{capability:'filesystem.project.read',implementations:['local-project-reader']}]);
});

test('capability-graph 对三个 Agent 能力的现状快照',async ()=>{
  const registry=await getToolRegistry();
  const listed=registry.listCapabilities({includeDisabled:true});
  const agentCapabilities=[...new Set([...EDITORIAL_AGENT_CAPABILITIES,...TUTORIAL_AGENT_CAPABILITIES,...CUSTOM_SOCIAL_AGENT_CAPABILITIES])].sort();
  const graph=buildCapabilityGraph({root,tools:listed.map((item)=>({id:item.plugin,name:item.plugin,version:item.version,capabilities:[item.capability],enabled:item.enabled,priority:item.priority,riskLevel:item.riskLevel}))});
  // 阶段 1 起三个 Agent 已作为消费者纳入图谱
  assert.equal(graph.consumers.some((item)=>item.type==='agent'),true);
  for(const consumerId of ['agent.editorial','agent.independent-writing','agent.custom-social'])
    assert.ok(graph.consumers.some((item)=>item.id===consumerId&&item.type==='agent'),consumerId);
  const snapshot=Object.fromEntries(agentCapabilities.map((capability)=>{
    const node=graph.capabilities.find((item)=>item.id===capability);
    return [capability,{status:node.status,implementations:node.implementations.map((item)=>item.id)}];
  }));
  assert.deepEqual(snapshot,{
    'content.document.search':{status:'degraded',implementations:['document-folder-search']},
    'content.news.search':{status:'degraded',implementations:['tavily-search']},
    'content.passage.retrieve':{status:'degraded',implementations:['local-passage-retrieval']},
    'content.repository.inspect':{status:'degraded',implementations:['repository-inspector']},
    'content.url.fetch':{status:'degraded',implementations:['url-fetch']},
    'content.web.search':{status:'degraded',implementations:['tavily-search']},
    'filesystem.project.read':{status:'degraded',implementations:['local-project-reader']},
  });
});

test('消费者—能力—实现基线与仓库现状保持同步',async ()=>{
  const expected=await buildConsumerCapabilityBaseline(root);
  const saved=JSON.parse(fs.readFileSync(path.join(root,'test','fixtures','capability-consumer-baseline.json'),'utf8'));
  assert.deepEqual(saved,expected,'基线已过期，请运行 npm run capability:consumer-baseline 或 node scripts/quality/snapshot-consumer-capability-baseline.mjs');
});
