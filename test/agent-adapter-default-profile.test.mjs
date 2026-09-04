import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deriveAgentEntryCapabilities } from '../server/platform/agent/entry-capabilities.mjs';
import { EDITORIAL_AGENT_CAPABILITIES } from '../server/features/articles/application/agent/editorial-adapter.mjs';
import { applyCatalogSchemas, buildAdaptation, resolveCatalogResourceProfiles, RESOURCE_ID_SCHEMA } from '../server/platform/agent/resource-adaptation.mjs';
import { addCapabilityCatalogEntries, readCapabilityCatalog } from '../server/platform/tools/capability-catalog.mjs';
import { buildCapabilityGraph } from '../server/platform/tools/capability-graph.mjs';

// 阶段 3（docs/design/agent-adapter-configurability-design.md §4）：新资源类能力走默认档案路径——
// 目录条目声明 resourceKind + 消费者登记即接入，全程不改任何 .mjs（不进 Adapter 常量）。

const projectRoot=path.resolve(import.meta.dirname,'..');
const CLOUDDOC={capability:'cap_vendor_clouddoc_read',requirement:'optional',failurePolicy:'continue-with-warning',declaration:'optional',adapterStatus:'ready',resourceKinds:['cloud-document-url'],triggerPolicy:'explicit-resource',authorizationAction:null,resultPolicy:'fact-attachment',source:'test'};

function makeRoot(t,{resourceKind='url-fetch'}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-default-profile-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'config'),{recursive:true});
  fs.mkdirSync(path.join(dir,'skills','editorial-room-chat'),{recursive:true});
  fs.copyFileSync(path.join(projectRoot,'skills','editorial-room-chat','skill.json'),path.join(dir,'skills','editorial-room-chat','skill.json'));
  const catalog=JSON.parse(fs.readFileSync(path.join(projectRoot,'config','capabilities.json'),'utf8'));
  catalog.capabilities['cap_vendor_clouddoc_read']={name:'云文档读取',description:'读取指定云文档的正文内容。',category:'信息获取',...(resourceKind?{resourceKind}:{})};
  fs.writeFileSync(path.join(dir,'config','capabilities.json'),JSON.stringify(catalog));
  const consumers=JSON.parse(fs.readFileSync(path.join(projectRoot,'config','capability-consumers.json'),'utf8'));
  consumers.consumers.find((item)=>item.id==='agent.editorial').dependencies.push({...CLOUDDOC});
  fs.writeFileSync(path.join(dir,'config','capability-consumers.json'),JSON.stringify(consumers));
  return dir;
}

test('目录条目 resourceKind 派生映射：新能力命中 url-fetch 档案，静态表不受影响',(t)=>{
  const root=makeRoot(t);
  const profiles=resolveCatalogResourceProfiles(root);
  assert.equal(profiles['cap_vendor_clouddoc_read'],'url-fetch');
  assert.ok(!('cap_content_url_fetch' in profiles),'静态表内能力无 catalog 声明，不出现在派生映射');
});

test('新资源类能力登记 ready 即派生进入口目录（无 Adapter 常量、无代码）',(t)=>{
  const root=makeRoot(t);
  const derived=deriveAgentEntryCapabilities(root,'agent.editorial',EDITORIAL_AGENT_CAPABILITIES);
  assert.ok(derived.includes('cap_vendor_clouddoc_read'));
  assert.equal(derived.length,EDITORIAL_AGENT_CAPABILITIES.length+1);
});

test('能力图谱：新能力实现健康且授权放行时链路 available',(t)=>{
  const root=makeRoot(t);
  const tool={id:'clouddoc-reader',name:'云文档读取',version:'1.0.0',capabilities:['cap_vendor_clouddoc_read'],enabled:true,priority:0,riskLevel:'network-read'};
  const state=buildCapabilityGraph({root,tools:[tool]}).consumerStates
    .find((item)=>item.consumerId==='agent.editorial'&&item.capability==='cap_vendor_clouddoc_read');
  assert.equal(state.available,true);
  assert.deepEqual(state.reasons,[]);
});

test('buildAdaptation：新能力按 url-fetch 档案改写参数，越界 resourceId 抛 RESOURCE_NOT_ALLOWED',(t)=>{
  const root=makeRoot(t);
  fs.writeFileSync(path.join(root,'config','agent-adaptation-messages.json'),JSON.stringify({schemaVersion:1,messages:{'agent.custom-social':{'cap_vendor_clouddoc_read':'素材 URL 未授权'}}}));
  const adaptation=buildAdaptation({adaptation:{resourceSources:[{source:'materials'}]},inputs:{materialUrls:['https://docs.example.com/a'],answer:''},workspaceRoot:root,consumerId:'agent.custom-social'});
  const resolved=adaptation.resolveArguments({resourceId:'material:1'},{capability:'cap_vendor_clouddoc_read',arguments:{resourceId:'material:1'}});
  assert.deepEqual(resolved,{targetUrl:'https://docs.example.com/a',root});
  const denied=adaptation.resolveArguments.bind(null,{resourceId:'material:9'},{capability:'cap_vendor_clouddoc_read'});
  assert.throws(denied,(error)=>error.code==='RESOURCE_NOT_ALLOWED'&&error.message==='素材 URL 未授权');
});

test('applyCatalogSchemas：目录声明 resourceKind 的能力自动注入档案 Schema（无 bindings）',(t)=>{
  const root=makeRoot(t);
  const catalog=[
    {capability:'cap_vendor_clouddoc_read',inputSchema:{type:'object'}},
    {capability:'cap_content_web_search',inputSchema:{type:'object',properties:{query:{type:'string'}}}},
  ];
  const [clouddoc,web]=applyCatalogSchemas(catalog,[],root);
  assert.deepEqual(clouddoc.inputSchema,RESOURCE_ID_SCHEMA);
  assert.deepEqual(web.inputSchema,{type:'object',properties:{query:{type:'string'}}});
});

test('非法 resourceKind 被目录校验拒绝（读取与 R3 入库）',(t)=>{
  const root=makeRoot(t,{resourceKind:'bogus-kind'});
  assert.throws(()=>readCapabilityCatalog(root),/resourceKind 无效/);
  const valid=makeRoot(t);
    assert.throws(()=>addCapabilityCatalogEntries(valid,[{id:'cap_vendor_other_read',name:'x',description:'y',category:'z',resourceKind:'bogus-kind'}]),/resourceKind 无效/);
});

test('catalog 声明与静态档案映射冲突时报错（静态优先，冲突即配置错误）',(t)=>{
  const root=makeRoot(t);
  const file=path.join(root,'config','capabilities.json');
  const catalog=JSON.parse(fs.readFileSync(file,'utf8'));
  catalog.capabilities['cap_content_url_fetch'].resourceKind='document-root';
  fs.writeFileSync(file,JSON.stringify(catalog));
  assert.throws(()=>resolveCatalogResourceProfiles(root),/冲突/);
});
