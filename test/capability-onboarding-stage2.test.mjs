import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deriveAgentEntryCapabilities } from '../lib/agent/entry-capabilities.mjs';
import { isResourceAdaptedCapability, RESOURCE_ADAPTED_CAPABILITIES } from '../lib/agent/resource-adaptation.mjs';
import { checkConsumerCapabilityGates } from '../scripts/check-consumer-capability-gates.mjs';
import { EDITORIAL_AGENT_CAPABILITIES } from '../lib/agent/editorial-adapter.mjs';
import { CUSTOM_SOCIAL_AGENT_CAPABILITIES } from '../lib/agent/custom-social-adapter.mjs';

// 阶段 2 机制二「Agent 目录登记驱动」（docs/design/capability-onboarding-configurability-plan.md §4、§7 阶段 2）：
// 目录从登记派生；常量=适配代码上界；纯参数能力登记即生效；资源类能力命中 resourceKind
// 档案表即走默认适配路径（合法），仅列入 RESOURCE_ADAPTED_CAPABILITIES 而无档案的才受常量约束。

const projectRoot=path.resolve(import.meta.dirname,'..');

function makeRoot(t,mutate){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-derivation-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'config'),{recursive:true});
  fs.mkdirSync(path.join(dir,'skills'),{recursive:true});
  const consumers=JSON.parse(fs.readFileSync(path.join(projectRoot,'config','capability-consumers.json'),'utf8'));
  mutate?.(consumers);
  fs.writeFileSync(path.join(dir,'config','capability-consumers.json'),JSON.stringify(consumers));
  return dir;
}

const editorial=(consumers)=>consumers.consumers.find((item)=>item.id==='agent.editorial');
const PURE_PARAM_DEP={
  capability:'vendor.pure.lookup',requirement:'optional',failurePolicy:'continue-with-warning',
  declaration:'optional',adapterStatus:'ready',resourceKinds:[],triggerPolicy:'model-request',
  authorizationAction:null,resultPolicy:'passthrough',source:'test',
};

test('判定规则：resourceId 分支能力为资源类，搜索类为纯参数',()=>{
  for(const capability of ['filesystem.project.read','content.url.fetch','content.document.search','content.repository.inspect','content.passage.retrieve'])
    assert.ok(isResourceAdaptedCapability(capability),capability);
  for(const capability of ['content.web.search','content.news.search','vendor.pure.lookup'])
    assert.ok(!isResourceAdaptedCapability(capability),capability);
  assert.ok(Object.isFrozen(RESOURCE_ADAPTED_CAPABILITIES));
});

test('登记即生效：纯参数能力登记超出常量即进入派生目录（不改常量）',(t)=>{
  const root=makeRoot(t,(consumers)=>{editorial(consumers).dependencies.push({...PURE_PARAM_DEP});});
  const derived=deriveAgentEntryCapabilities(root,'agent.editorial',EDITORIAL_AGENT_CAPABILITIES);
  assert.ok(derived.includes('vendor.pure.lookup'));
  assert.equal(derived.length,EDITORIAL_AGENT_CAPABILITIES.length+1);
});

test('资源类能力登记为 ready 且命中档案表：即使常量未含也合法（默认适配路径）',(t)=>{
  const root=makeRoot(t,(consumers)=>{
    editorial(consumers).dependencies.push({...PURE_PARAM_DEP,capability:'content.document.search',resourceKinds:['document-root'],triggerPolicy:'explicit-resource'});
  });
  const derived=deriveAgentEntryCapabilities(root,'agent.editorial',EDITORIAL_AGENT_CAPABILITIES);
  assert.ok(derived.includes('content.document.search'));
});

test('常量超出登记 → 报错（常量必须是登记的子集）',(t)=>{
  const root=makeRoot(t,(consumers)=>{
    const agent=editorial(consumers);
    agent.dependencies=agent.dependencies.filter((item)=>item.capability!=='content.news.search');
  });
  assert.throws(()=>deriveAgentEntryCapabilities(root,'agent.editorial',EDITORIAL_AGENT_CAPABILITIES),/常量必须是登记的子集/);
});

test('adapterStatus=missing 的登记不进入派生目录（缺少适配，与现状语义一致）',(t)=>{
  const root=makeRoot(t,(consumers)=>{
    editorial(consumers).dependencies.push({...PURE_PARAM_DEP,adapterStatus:'missing'});
  });
  assert.ok(!deriveAgentEntryCapabilities(root,'agent.editorial',EDITORIAL_AGENT_CAPABILITIES).includes('vendor.pure.lookup'));
});

test('登记文件缺失时回退常量（无 config 的嵌入式/测试工作区）',(t)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-derivation-empty-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  assert.deepEqual(deriveAgentEntryCapabilities(dir,'agent.editorial',EDITORIAL_AGENT_CAPABILITIES),EDITORIAL_AGENT_CAPABILITIES);
});

test('门禁 B 新语义：纯参数与命中档案表的资源类登记超出常量均放行',(t)=>{
  const pure=makeRoot(t,(consumers)=>{editorial(consumers).dependencies.push({...PURE_PARAM_DEP});});
  assert.deepEqual(checkConsumerCapabilityGates(pure),[]);
  const resource=makeRoot(t,(consumers)=>{
    editorial(consumers).dependencies.push({...PURE_PARAM_DEP,capability:'content.repository.inspect',resourceKinds:['github-repository-url'],triggerPolicy:'explicit-resource'});
  });
  assert.deepEqual(checkConsumerCapabilityGates(resource),[]);
});

test('真实仓库派生目录与常量一致（机制二对运行时零变化）',()=>{
  assert.deepEqual(deriveAgentEntryCapabilities(projectRoot,'agent.editorial',EDITORIAL_AGENT_CAPABILITIES),[...EDITORIAL_AGENT_CAPABILITIES].sort());
  assert.deepEqual(deriveAgentEntryCapabilities(projectRoot,'agent.custom-social',CUSTOM_SOCIAL_AGENT_CAPABILITIES),[...CUSTOM_SOCIAL_AGENT_CAPABILITIES].sort());
});
