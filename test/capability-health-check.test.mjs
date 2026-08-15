import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildCapabilityGraph } from '../lib/tools/capability-graph.mjs';
import {
  capabilityHealthCacheSize, invalidateCapabilityHealthCache, prefetchCapabilityHealth,
} from '../lib/tools/health-check.mjs';

// 遗留 6：真实健康检查接入图谱——预取健康表（TTL 缓存 + 写后失效），'unknown' 回退代理并标注。

const projectRoot=path.resolve(import.meta.dirname,'..');

function makeRoot(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capability-health-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'config'),{recursive:true});
  for(const file of ['capabilities.json','capability-consumers.json'])
    fs.copyFileSync(path.join(projectRoot,'config',file),path.join(dir,'config',file));
  return dir;
}

const SEARCH_TOOL={id:'demo-search',name:'演示搜索',version:'1.0.0',capabilities:['content.web.search'],enabled:true,priority:0,riskLevel:'read-only'};
const stateOf=(graph,capability)=>graph.consumerStates.find((item)=>item.consumerId==='agent.editorial'&&item.capability===capability);

// 可计数 mock 注册表：listCapabilities 列出启用实现，health 按插件返回预设结果
function mockRegistry(entries,healthResults,counter={calls:0}){
  return {
    listCapabilities:()=>entries.map((item)=>({capability:item.capability,plugin:item.plugin,enabled:true})),
    async health(capability,{plugin}={}){
      counter.calls+=1;
      const result=healthResults[`${capability}::${plugin}`];
      if(result instanceof Error)throw result;
      return result||{status:'ok',data:{available:true}};
    },
  };
}

test.beforeEach(()=>invalidateCapabilityHealthCache());

test('健康表接入图谱：unhealthy 阻断并输出 IMPLEMENTATION_UNHEALTHY',(t)=>{
  const root=makeRoot(t);
  const graph=buildCapabilityGraph({root,tools:[SEARCH_TOOL],healthByCapability:new Map([['content.web.search','unhealthy']])});
  const state=stateOf(graph,'content.web.search');
  assert.equal(state.available,false);
  assert.equal(state.status,'blocked');
  assert.deepEqual(state.reasons,['IMPLEMENTATION_UNHEALTHY']);
});

test('健康表 healthy 维持可用；unknown 回退代理并标注 HEALTH_CHECK_UNAVAILABLE',(t)=>{
  const root=makeRoot(t);
  const healthy=stateOf(buildCapabilityGraph({root,tools:[SEARCH_TOOL],healthByCapability:new Map([['content.web.search','healthy']])}),'content.web.search');
  assert.equal(healthy.available,true);
  assert.deepEqual(healthy.warnings,[]);
  const unknown=stateOf(buildCapabilityGraph({root,tools:[SEARCH_TOOL],healthByCapability:new Map([['content.web.search','unknown']])}),'content.web.search');
  // 回退代理判定（启用且配置就绪 → 可用），并标注健康检查不可用
  assert.equal(unknown.available,true);
  assert.deepEqual(unknown.warnings,['HEALTH_CHECK_UNAVAILABLE']);
  // 不传健康表：维持代理语义，无任何标注
  const proxy=stateOf(buildCapabilityGraph({root,tools:[SEARCH_TOOL]}),'content.web.search');
  assert.equal(proxy.available,true);
  assert.deepEqual(proxy.warnings,[]);
});

test('预取聚合：任一实现健康即 healthy；异常降级 unknown；显式不可用为 unhealthy',async (t)=>{
  const registry=mockRegistry(
    [{capability:'cap.a',plugin:'p1'},{capability:'cap.a',plugin:'p2'},{capability:'cap.b',plugin:'p3'},{capability:'cap.c',plugin:'p4'}],
    {
      'cap.a::p1':{status:'error',error:{code:'OUTPUT_INVALID',message:'炸了'}},
      'cap.a::p2':{status:'ok',data:{available:true}},
      'cap.b::p3':{status:'ok',data:{available:false}},
      'cap.c::p4':new Error('连接超时'),
    },
  );
  const table=await prefetchCapabilityHealth(registry,['cap.a','cap.b','cap.c','cap.missing']);
  assert.equal(table.get('cap.a'),'healthy');
  assert.equal(table.get('cap.b'),'unhealthy');
  assert.equal(table.get('cap.c'),'unknown');
  assert.equal(table.get('cap.missing'),undefined,'无启用实现的能力不产生表项');
});

test('TTL 缓存：有效期内命中不重查；失效后重跑；invalidate 立即清空',async (t)=>{
  let clock=1_000;
  const counter={calls:0};
  const registry=mockRegistry([{capability:'cap.a',plugin:'p1'}],{},counter);
  const options={ttlMs:45_000,now:()=>clock};
  await prefetchCapabilityHealth(registry,['cap.a'],options);
  assert.equal(counter.calls,1);
  await prefetchCapabilityHealth(registry,['cap.a'],options);
  assert.equal(counter.calls,1,'TTL 内应命中缓存');
  clock+=46_000;
  await prefetchCapabilityHealth(registry,['cap.a'],options);
  assert.equal(counter.calls,2,'TTL 过期后应重新检查');
  assert.ok(capabilityHealthCacheSize()>0);
  invalidateCapabilityHealthCache();
  assert.equal(capabilityHealthCacheSize(),0);
  await prefetchCapabilityHealth(registry,['cap.a'],options);
  assert.equal(counter.calls,3,'invalidate 后应重新检查');
});

test('禁用的实现不参与健康预取',async (t)=>{
  const counter={calls:0};
  const registry={
    listCapabilities:()=>[{capability:'cap.a',plugin:'p1',enabled:false}],
    async health(){counter.calls+=1;return {status:'ok',data:{available:true}};},
  };
  const table=await prefetchCapabilityHealth(registry,['cap.a']);
  assert.equal(counter.calls,0);
  assert.equal(table.size,0);
});
