import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../server/platform/core/store.mjs';
import { getToolRegistry } from '../server/platform/tools/index.mjs';
import { buildCapabilityGraph } from '../server/platform/tools/capability-graph.mjs';
import { activeConfigIntegrity, describeActiveSkillConfig, readActiveSkillConfig, writeActiveSkillConfig, writeVersionedSkillConfig } from '../server/platform/skills/configuration.mjs';
import { assertAuthorizationChange, describeSkillAuthorization, previewSkillAuthorizationChange, saveSkillAuthorization } from '../server/platform/skills/capability-authorization.mjs';
import { handleSystemRoutes } from '../server/platform/http/routes/system-routes.mjs';

// 阶段 4a/4b：版本协商与 hash 链、历史 run 授权冻结、技能能力授权编辑的服务端边界

const projectRoot=path.resolve(import.meta.dirname,'..');

function makeWorkspace(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skill-authorization-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
  fs.mkdirSync(path.join(dir,'config'),{recursive:true});
  for(const name of ['capabilities.json','capability-consumers.json'])
    fs.copyFileSync(path.join(projectRoot,'config',name),path.join(dir,'config',name));
  // 路由层需要真实的技能目录（SkillRegistry），以只读方式链接进临时工作区；写入只发生在 writing-skills/
  fs.symlinkSync(path.join(projectRoot,'skills'),path.join(dir,'skills'),'junction');
  return dir;
}

async function graphFor(root){
  const registry=await getToolRegistry();
  const listed=registry.listCapabilities({includeDisabled:true});
  return buildCapabilityGraph({root,tools:listed.map((item)=>({id:item.plugin,name:item.plugin,version:item.version,capabilities:[item.capability],enabled:item.enabled,priority:item.priority,riskLevel:item.riskLevel}))});
}

test('版本化写入：单调递增、parentHash 链、旧格式升级',(t)=>{
  const root=makeWorkspace(t);
  const first=writeVersionedSkillConfig(root,'demo-skill',{prompt:'规则',allowedTools:['content.web.search']});
  assert.equal(first.version,1);assert.equal(first.parentHash,'');assert.match(first.configHash,/^sha256:/);
  const second=writeVersionedSkillConfig(root,'demo-skill',{prompt:'规则 v2',allowedTools:['content.web.search']},{expectedVersion:1});
  assert.equal(second.version,2);assert.equal(second.parentHash,first.configHash);
  assert.equal(activeConfigIntegrity(JSON.parse(fs.readFileSync(path.join(root,'writing-skills','demo-skill','active.json'),'utf8'))).status,'verified');
  // 旧格式（无 version/configHash）读取正常，下次写入升级为 version 1
  writeActiveSkillConfig(root,'legacy-skill',{prompt:'旧配置',allowedTools:['content.web.search']});
  assert.equal(describeActiveSkillConfig(root,'legacy-skill').integrity,'legacy');
  assert.equal(readActiveSkillConfig(root,'legacy-skill').prompt,'旧配置');
  const upgraded=writeVersionedSkillConfig(root,'legacy-skill',{prompt:'旧配置 v2'},{expectedVersion:0});
  assert.equal(upgraded.version,1);
});

test('版本冲突返回明确原因码，篡改的 hash 链拒绝写入',(t)=>{
  const root=makeWorkspace(t);
  writeVersionedSkillConfig(root,'demo-skill',{prompt:'v1'});
  assert.throws(()=>writeVersionedSkillConfig(root,'demo-skill',{prompt:'过期写入'},{expectedVersion:0}),
    (error)=>error.code==='CONFIG_VERSION_CONFLICT'&&error.currentVersion===1);
  // 篡改文件内容（hash 链断裂）
  const file=path.join(root,'writing-skills','demo-skill','active.json');
  const raw=JSON.parse(fs.readFileSync(file,'utf8'));raw.prompt='被篡改';
  fs.writeFileSync(file,JSON.stringify(raw));
  assert.equal(activeConfigIntegrity(raw).status,'broken');
  assert.throws(()=>writeVersionedSkillConfig(root,'demo-skill',{prompt:'v2'},{expectedVersion:1}),
    (error)=>error.code==='CONFIG_INTEGRITY_BROKEN');
});

test('Agent run 启动时冻结能力授权快照',(t)=>{
  const root=makeWorkspace(t);
  const store=new Store(path.join(root,'test.db'));
  try{
    const batch=store.createBatch({date:'2026-08-14',title:'授权冻结'});
    const run=store.startAgentRun({id:'agent-run-freeze',entryPoint:'editorial',batchId:batch.id,allowedCapabilities:['content.web.search','filesystem.project.read']});
    assert.deepEqual(run.allowedCapabilities,['content.web.search','filesystem.project.read']);
    // 运行后配置变更不影响历史 run 的冻结快照
    writeVersionedSkillConfig(root,'editorial-room-chat',{prompt:'规则',allowedTools:['content.news.search']});
    assert.deepEqual(store.getAgentRun('agent-run-freeze').allowedCapabilities,['content.web.search','filesystem.project.read']);
    assert.deepEqual(store.listAgentRuns()[0].allowedCapabilities,['content.web.search','filesystem.project.read']);
  }finally{store.close();}
});

test('授权边界：required、未声明与目录外能力都被服务端拒绝',async (t)=>{
  const root=makeWorkspace(t),graph=await graphFor(root);
  // 阶段 5 起 custom-card-storyboard 的 passage.retrieve 已补齐适配（ready 且 optional），允许从白名单移除；
  // 原"degraded 不得停用"场景随适配完成而消失（server/platform/agent/resource-adaptation.mjs 的 resourceIds 映射 + 透传回退）
  assert.doesNotThrow(()=>assertAuthorizationChange(root,graph,'custom-card-storyboard',
    ['content.url.fetch','content.web.search','content.news.search','content.document.search','content.repository.inspect']));
  // 未在消费者登记中声明的能力不得通过配置引入
  assert.throws(()=>assertAuthorizationChange(root,graph,'custom-card-storyboard',
    ['content.url.fetch','content.passage.retrieve','image.cdn.upload']),
    (error)=>error.issues.some((issue)=>issue.capability==='image.cdn.upload'));
  // 目录外能力
  assert.throws(()=>assertAuthorizationChange(root,graph,'editorial-room-chat',['content.web.search','vendor.unknown']),
    (error)=>error.issues.some((issue)=>issue.capability==='vendor.unknown'));
  // 非 Agent 运行时技能
  assert.throws(()=>assertAuthorizationChange(root,graph,'article-reviewer',['content.web.search']),
    (error)=>error.code==='CAPABILITY_AUTHORIZATION_INVALID');
  // required 判定：构造一个 declaration=required 的登记
  const raw=JSON.parse(fs.readFileSync(path.join(root,'config','capability-consumers.json'),'utf8'));
  raw.consumers.find((item)=>item.id==='agent.editorial').dependencies.find((item)=>item.capability==='content.web.search').declaration='required';
  fs.writeFileSync(path.join(root,'config','capability-consumers.json'),JSON.stringify(raw));
  const requiredGraph=await graphFor(root);
  assert.throws(()=>assertAuthorizationChange(root,requiredGraph,'editorial-room-chat',
    ['filesystem.project.read','content.url.fetch','content.passage.retrieve','content.news.search']),
    (error)=>error.issues.some((issue)=>issue.capability==='content.web.search'&&/必需能力/.test(issue.message)));
});

test('影响预览：单技能停用只影响自己的消费者',async (t)=>{
  const root=makeWorkspace(t),graph=await graphFor(root);
  const next=['filesystem.project.read','content.url.fetch','content.passage.retrieve','content.news.search'];
  const preview=previewSkillAuthorizationChange(root,graph,{skillId:'editorial-room-chat',capabilities:next});
  assert.deepEqual(preview.changes,[{consumerId:'agent.editorial',consumerName:'编辑室 Agent',capability:'content.web.search',capabilityName:'网络搜索',from:'available',to:'unavailable'}]);
});

test('写入后图谱状态翻转，清除白名单后恢复；版本随写入递增',async (t)=>{
  const root=makeWorkspace(t);
  const next=['filesystem.project.read','content.url.fetch','content.passage.retrieve','content.news.search'];
  const saved=saveSkillAuthorization(root,await graphFor(root),'editorial-room-chat',{capabilities:next,expectedVersion:0});
  assert.equal(saved.version,1);
  assert.deepEqual(saved.impact,[{consumerId:'agent.editorial',consumerName:'编辑室 Agent',capability:'content.web.search',capabilityName:'网络搜索',from:'available',to:'unavailable'}]);
  const after=await graphFor(root);
  const blocked=after.consumerStates.find((item)=>item.consumerId==='agent.editorial'&&item.capability==='content.web.search');
  assert.equal(blocked.available,false);assert.deepEqual(blocked.reasons,['SKILL_NOT_ALLOWED']);
  // 其他消费者不受影响（文档 §11）
  for(const consumerId of ['agent.independent-writing','agent.custom-social'])
    assert.equal(after.consumerStates.find((item)=>item.consumerId===consumerId&&item.capability==='content.web.search').available,true,consumerId);
  // 基于过期版本再次写入 → 冲突
  assert.throws(()=>saveSkillAuthorization(root,after,'editorial-room-chat',{capabilities:next,expectedVersion:0}),
    (error)=>error.code==='CONFIG_VERSION_CONFLICT'&&error.currentVersion===1);
  // 清除白名单恢复全放行
  const restored=saveSkillAuthorization(root,after,'editorial-room-chat',{capabilities:null,expectedVersion:1});
  assert.equal(restored.version,2);
  const final=await graphFor(root);
  assert.equal(final.consumerStates.find((item)=>item.consumerId==='agent.editorial'&&item.capability==='content.web.search').available,true);
});

test('无归属技能作为独立消费者：授权启停走既有边界校验并只影响自身',async (t)=>{
  const root=makeWorkspace(t),graph=await graphFor(root);
  // 注意：空 allowedTools 语义为全放行，故用多能力的无归属技能（wechat-article-typeset）验证停用
  const stateOf=(g)=>g.consumerStates.find((item)=>item.consumerId==='wechat-article-typeset'&&item.capability==='diagram.mermaid.render');
  assert.equal(stateOf(graph).available,true);
  const next=['diagram.echarts.render','image.cdn.upload'];
  // 影响预览覆盖技能消费者自身
  const preview=previewSkillAuthorizationChange(root,graph,{skillId:'wechat-article-typeset',capabilities:next});
  assert.ok(preview.changes.some((item)=>item.consumerId==='wechat-article-typeset'&&item.capability==='diagram.mermaid.render'&&item.to==='unavailable'));
  // agent 消费者不受影响（agent 以自身 runtimeSkillIds 的白名单为准，wechat-article-typeset 不在其中）
  assert.ok(!preview.changes.some((item)=>String(item.consumerId).startsWith('agent.')));
  const saved=saveSkillAuthorization(root,graph,'wechat-article-typeset',{capabilities:next,expectedVersion:0});
  assert.equal(saved.version,1);
  const after=await graphFor(root);
  assert.equal(stateOf(after).available,false);assert.deepEqual(stateOf(after).reasons,['SKILL_NOT_ALLOWED']);
  // 恢复
  saveSkillAuthorization(root,after,'wechat-article-typeset',{capabilities:null,expectedVersion:1});
  assert.equal(stateOf(await graphFor(root)).available,true);
  // 边界：无归属技能也不能通过配置引入 Manifest 未声明的能力
  assert.throws(()=>assertAuthorizationChange(root,graph,'wechat-article-typeset',[...next,'content.news.search']),
    (error)=>error.issues.some((issue)=>issue.capability==='content.news.search'));
});

test('custom-social 本地项目读取授权启停往返，不影响其他消费者',async (t)=>{
  const root=makeWorkspace(t),graph=await graphFor(root);
  const stateOf=(g,consumerId)=>g.consumerStates.find((item)=>item.consumerId===consumerId&&item.capability==='filesystem.project.read');
  const before=await graphFor(root);
  assert.equal(stateOf(before,'agent.custom-social').available,true,'阶段 A 接入后默认应可用');
  // 停用：从 custom-card-storyboard 白名单移除该能力
  const next=['content.url.fetch','content.web.search','content.news.search','content.document.search','content.repository.inspect','content.passage.retrieve'];
  const saved=saveSkillAuthorization(root,before,'custom-card-storyboard',{capabilities:next,expectedVersion:0});
  assert.equal(saved.version,1);
  assert.ok(saved.impact.some((item)=>item.consumerId==='agent.custom-social'&&item.capability==='filesystem.project.read'&&item.to==='unavailable'));
  const after=await graphFor(root);
  const blocked=stateOf(after,'agent.custom-social');
  assert.equal(blocked.available,false);assert.deepEqual(blocked.reasons,['SKILL_NOT_ALLOWED']);
  // 其他消费者的同名能力不受影响
  for(const consumerId of ['agent.editorial','agent.independent-writing'])
    assert.equal(stateOf(after,consumerId).available,true,consumerId);
  // 启用往返：清除白名单恢复
  saveSkillAuthorization(root,after,'custom-card-storyboard',{capabilities:null,expectedVersion:1});
  const restored=await graphFor(root);
  assert.equal(stateOf(restored,'agent.custom-social').available,true);
});

async function putAuthorization(t,root,skillId,input){
  let payload=null;
  const handled=await handleSystemRoutes({
    request:{method:'PUT'},response:{},pathname:`/api/system/skills/${skillId}/configuration`,searchParams:new URLSearchParams(),
    root,config:{},store:{listCollectionSources:()=>[]},
    json(_response,status,data){payload={status,data};},body:async()=>input,
  });
  assert.equal(handled,true);
  return payload;
}

test('PUT 技能配置路由：dryRun 预览不落盘，过期版本返回 409',async (t)=>{
  const root=makeWorkspace(t);
  // 路由层图谱走真实配置状态：tmp 工作区里带配置/凭据的插件未就绪，选用无配置的 local-project-reader 对应能力验证可用性翻转
  const next=['content.url.fetch','content.passage.retrieve','content.web.search','content.news.search'];
  const dryRun=await putAuthorization(t,root,'editorial-room-chat',{capabilityAuthorization:{mode:'allow-list',capabilities:next},dryRun:true});
  assert.equal(dryRun.status,200);assert.equal(dryRun.data.dryRun,true);
  assert.deepEqual(dryRun.data.impact.map((item)=>[item.consumerId,item.capability,item.from,item.to]),
    [['agent.editorial','filesystem.project.read','available','unavailable']]);
  assert.ok(!fs.existsSync(path.join(root,'writing-skills','editorial-room-chat','active.json')),'dryRun 不应写入');
  const saved=await putAuthorization(t,root,'editorial-room-chat',{capabilityAuthorization:{mode:'allow-list',capabilities:next},expectedVersion:0});
  assert.equal(saved.status,200);assert.equal(saved.data.version,1);
  const conflict=await putAuthorization(t,root,'editorial-room-chat',{capabilityAuthorization:{mode:'allow-list',capabilities:next},expectedVersion:0});
  assert.equal(conflict.status,409);assert.equal(conflict.data.code,'CONFIG_VERSION_CONFLICT');assert.equal(conflict.data.currentVersion,1);
  // 阶段 6：expectedVersion 必传，缺失返回 400
  const missing=await putAuthorization(t,root,'editorial-room-chat',{capabilityAuthorization:{mode:'allow-list',capabilities:next}});
  assert.equal(missing.status,400);assert.equal(missing.data.code,'CAPABILITY_AUTHORIZATION_INVALID');
  // 未在消费者登记中声明的能力仍被路由拒绝
  const rejected=await putAuthorization(t,root,'custom-card-storyboard',{capabilityAuthorization:{mode:'allow-list',capabilities:['content.url.fetch','image.cdn.upload']}});
  assert.equal(rejected.status,400);assert.equal(rejected.data.code,'CAPABILITY_AUTHORIZATION_INVALID');
});
