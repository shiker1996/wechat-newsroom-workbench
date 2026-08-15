import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeSkillConfig, readActiveSkillConfig } from '../lib/skills/configuration.mjs';
import { buildCapabilityGraph } from '../lib/tools/capability-graph.mjs';
import { resolveSkillToolPolicy } from '../lib/skills/pipeline-runtime.mjs';

// 遗留 4：空白名单语义——显式空数组 = 全部禁止（SKILL_NOT_ALLOWED）；null/无字段 = 全放行（既有默认）。

const projectRoot=path.resolve(import.meta.dirname,'..');

function makeRoot(t,{activeConfigs={}}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'whitelist-empty-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'config'),{recursive:true});
  for(const file of ['capabilities.json','capability-consumers.json'])
    fs.copyFileSync(path.join(projectRoot,'config',file),path.join(dir,'config',file));
  fs.mkdirSync(path.join(dir,'skills','editorial-room-chat'),{recursive:true});
  for(const file of ['SKILL.md','skill.json'])
    fs.copyFileSync(path.join(projectRoot,'skills','editorial-room-chat',file),path.join(dir,'skills','editorial-room-chat',file));
  for(const [skillId,config] of Object.entries(activeConfigs)){
    fs.mkdirSync(path.join(dir,'writing-skills',skillId),{recursive:true});
    fs.writeFileSync(path.join(dir,'writing-skills',skillId,'active.json'),JSON.stringify(config));
  }
  return dir;
}
const SEARCH_TOOL={id:'demo-search',name:'演示搜索',version:'1.0.0',capabilities:['content.web.search'],enabled:true,priority:0,riskLevel:'read-only'};
const stateOf=(graph,capability)=>graph.consumerStates.find((item)=>item.consumerId==='agent.editorial'&&item.capability===capability);

test('normalizeSkillConfig：无白名单字段 → null（全放行）；显式空数组 → []（全禁）',()=>{
  const unset=normalizeSkillConfig({prompt:'规则'});
  assert.equal(unset.allowedTools,null);
  assert.equal(unset.capabilityAuthorization,null);
  const empty=normalizeSkillConfig({prompt:'规则',allowedTools:[]});
  assert.deepEqual(empty.allowedTools,[]);
  assert.deepEqual(empty.capabilityAuthorization,{mode:'allow-list',capabilities:[]});
  const viaAuthorization=normalizeSkillConfig({prompt:'规则',capabilityAuthorization:{mode:'allow-list',capabilities:[]}});
  assert.deepEqual(viaAuthorization.allowedTools,[]);
  const listed=normalizeSkillConfig({prompt:'规则',allowedTools:['content.web.search']});
  assert.deepEqual(listed.allowedTools,['content.web.search']);
});

test('能力图谱：活动配置显式空白名单阻断全部能力；未配置则放行',(t)=>{
  // 显式空数组 → 全部禁止（agent.editorial 已声明 content.web.search）
  const rootBlocked=makeRoot(t,{activeConfigs:{'editorial-room-chat':{prompt:'规则',allowedTools:[]}}});
  const blocked=stateOf(buildCapabilityGraph({root:rootBlocked,tools:[SEARCH_TOOL]}),'content.web.search');
  assert.equal(blocked.available,false);
  assert.equal(blocked.skillAllowed,false);
  assert.deepEqual(blocked.reasons,['SKILL_NOT_ALLOWED']);
  // 无白名单字段 → 全放行
  const rootOpen=makeRoot(t,{activeConfigs:{'editorial-room-chat':{prompt:'规则'}}});
  const open=stateOf(buildCapabilityGraph({root:rootOpen,tools:[SEARCH_TOOL]}),'content.web.search');
  assert.equal(open.skillAllowed,true);
  assert.equal(open.available,true);
  assert.deepEqual(open.reasons,[]);
});

test('readActiveSkillConfig：active.json 无字段读回 null，显式空数组读回 []',(t)=>{
  const root=makeRoot(t,{activeConfigs:{'editorial-room-chat':{prompt:'规则'}}});
  assert.equal(readActiveSkillConfig(root,'editorial-room-chat').allowedTools,null);
  fs.writeFileSync(path.join(root,'writing-skills','editorial-room-chat','active.json'),JSON.stringify({prompt:'规则',allowedTools:[]}));
  assert.deepEqual(readActiveSkillConfig(root,'editorial-room-chat').allowedTools,[]);
});

test('工具策略：显式空白名单解析为空列表；null 全放行',async (t)=>{
  const root=makeRoot(t,{activeConfigs:{'editorial-room-chat':{prompt:'规则',allowedTools:[]}}});
  const blocked=await resolveSkillToolPolicy({workspaceRoot:root,skillId:'editorial-room-chat'});
  assert.deepEqual(blocked.allowedCapabilities,[]);
  assert.deepEqual(blocked.tools,[]);
  fs.writeFileSync(path.join(root,'writing-skills','editorial-room-chat','active.json'),JSON.stringify({prompt:'规则'}));
  const open=await resolveSkillToolPolicy({workspaceRoot:root,skillId:'editorial-room-chat'});
  assert.equal(open.allowedCapabilities,null);
  assert.ok(open.tools.length>0,'null 白名单应放行全部已注册能力');
});
