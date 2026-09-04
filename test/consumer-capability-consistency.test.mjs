import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EDITORIAL_AGENT_CAPABILITIES } from '../server/features/articles/application/agent/editorial-adapter.mjs';
import { TUTORIAL_AGENT_CAPABILITIES } from '../server/features/articles/application/agent/tutorial-adapter.mjs';
import { CUSTOM_SOCIAL_AGENT_CAPABILITIES } from '../server/features/social-cards/application/agent/custom-social-adapter.mjs';
import { CONVERSATION_AGENT_ENTRY_POINTS } from '../server/platform/agent/contracts.mjs';
import { readCapabilityCatalog } from '../server/platform/tools/capability-catalog.mjs';
import { isResourceAdaptedCapability } from '../server/platform/agent/resource-adaptation.mjs';
import { auditCapabilityConsumers, auditSkillCapabilityReferences, readAgentConsumers, readCapabilityConsumers } from '../server/platform/tools/dependency-baseline.mjs';

// 阶段 0 依赖一致性：Adapter 能力常量、功能消费者登记、技能 Manifest 引用的能力
// 都必须存在于 config/capabilities.json 目录中，不得出现悬空引用。

const root=path.resolve(import.meta.dirname,'..');
const catalogIds=new Set(Object.keys(readCapabilityCatalog(root).capabilities));

test('三个 Agent 的能力常量引用的能力都存在于能力目录',()=>{
  for(const [name,capabilities] of [
    ['EDITORIAL_AGENT_CAPABILITIES',EDITORIAL_AGENT_CAPABILITIES],
    ['TUTORIAL_AGENT_CAPABILITIES',TUTORIAL_AGENT_CAPABILITIES],
    ['CUSTOM_SOCIAL_AGENT_CAPABILITIES',CUSTOM_SOCIAL_AGENT_CAPABILITIES],
  ]){
    assert.ok(Object.isFrozen(capabilities),`${name} 必须冻结`);
    assert.equal(new Set(capabilities).size,capabilities.length,`${name} 存在重复声明`);
    for(const capability of capabilities)assert.ok(catalogIds.has(capability),`${name} 引用了目录中不存在的能力：${capability}`);
  }
});

test('Adapter 能力常量与 agent 消费者登记保持一致（机制二：常量=适配代码上界）',()=>{
  const agents=new Map(readAgentConsumers(root).map((consumer)=>[consumer.id,consumer]));
  for(const [consumerId,constantName,capabilities] of [
    ['agent.editorial','EDITORIAL_AGENT_CAPABILITIES',EDITORIAL_AGENT_CAPABILITIES],
    ['agent.independent-writing','TUTORIAL_AGENT_CAPABILITIES',TUTORIAL_AGENT_CAPABILITIES],
    ['agent.custom-social','CUSTOM_SOCIAL_AGENT_CAPABILITIES',CUSTOM_SOCIAL_AGENT_CAPABILITIES],
  ]){
    const consumer=agents.get(consumerId);
    assert.ok(consumer,`登记缺少 ${consumerId}`);
    assert.equal(consumer.capabilityConstant,constantName);
    // 常量 ⊆ 登记：常量只表达"本 Adapter 有适配代码的能力上界"
    const registered=new Set((consumer.dependencies||[]).map((item)=>item.capability));
    for(const capability of capabilities)assert.ok(registered.has(capability),`${consumerId} 登记缺少常量能力 ${capability}`);
    // 资源类能力（resourceId 分支）登记了就必须有适配代码（常量包含）；纯参数能力允许登记超出常量
    for(const dependency of consumer.dependencies||[])
      if(isResourceAdaptedCapability(dependency.capability))
        assert.ok(capabilities.includes(dependency.capability),`${consumerId} 登记了资源类能力 ${dependency.capability} 但 ${constantName} 未包含`);
    // 登记引用的能力必须在目录中
    for(const dependency of consumer.dependencies)assert.ok(catalogIds.has(dependency.capability),`${consumerId} 登记了目录中不存在的能力：${dependency.capability}`);
  }
  // 扩展方案阶段 A 后三个 Agent 登记均覆盖各自能力常量；custom-social 的 cap_filesystem_project_read 缺口已消除
  const customSocial=agents.get('agent.custom-social');
  const projectRead=customSocial.dependencies.find((item)=>item.capability==='cap_filesystem_project_read');
  assert.ok(projectRead,'agent.custom-social 登记缺少 cap_filesystem_project_read');
  assert.equal(projectRead.adapterStatus,'ready');assert.equal(projectRead.triggerPolicy,'explicit-resource');
  assert.deepEqual(projectRead.resourceKinds,['local-project']);assert.equal(projectRead.authorizationAction,'local-project-read');
});

test('技能 Manifest 与登记不一致时产生 warning 而不是报错',()=>{
  // 引用目录中不存在的能力 → warning
  const unknown=auditSkillCapabilityReferences(root,{skillId:'demo',entryPoints:[],capabilities:['cap_vendor_custom_lookup']});
  assert.ok(unknown.some((item)=>item.level==='warning'&&item.message.includes('cap_vendor_custom_lookup')));
  // 引用了对应 agent 消费者未登记的能力 → warning
  const unregistered=auditSkillCapabilityReferences(root,{skillId:'demo',entryPoints:['custom-social'],capabilities:['cap_image_cdn_upload']});
  assert.ok(unregistered.some((item)=>item.level==='warning'&&item.message.includes('agent.custom-social')));
  // 校正后的运行时技能与登记一致 → 无 warning
  for(const [skillId,entryPoints,capabilities] of [
    ['editorial-room-chat',[],['cap_filesystem_project_read','cap_content_url_fetch','cap_content_passage_retrieve','cap_content_web_search','cap_content_news_search']],
    ['wechat-mp-tutorial',['independent-writing'],['cap_filesystem_project_read','cap_content_url_fetch','cap_content_web_search','cap_content_news_search','cap_content_document_search','cap_content_passage_retrieve']],
    ['custom-card-storyboard',['custom-social'],['cap_content_url_fetch','cap_content_web_search','cap_content_news_search','cap_content_document_search','cap_content_repository_inspect','cap_content_passage_retrieve']],
  ])assert.deepEqual(auditSkillCapabilityReferences(root,{skillId,entryPoints,capabilities}),[],skillId);
});

test('三个 Agent 的 entryPoint 都在会话契约中登记',()=>{
  for(const entryPoint of ['editorial','independent-writing','custom-social'])
    assert.ok(CONVERSATION_AGENT_ENTRY_POINTS.includes(entryPoint),`未登记的 entryPoint：${entryPoint}`);
});

test('capability-consumers.json 功能消费者登记与能力目录一致',()=>{
  const consumers=readCapabilityConsumers(root);
  const ids=new Set();
  for(const consumer of consumers){
    assert.ok(!ids.has(consumer.id),`重复登记消费者：${consumer.id}`);
    ids.add(consumer.id);
    assert.ok(consumer.dependencies.length>0,`${consumer.id} 未声明任何能力依赖`);
    for(const dependency of consumer.dependencies){
      assert.ok(catalogIds.has(dependency.capability),`${consumer.id} 引用了目录中不存在的能力：${dependency.capability}`);
      assert.ok(['required','optional','conditional'].includes(dependency.requirement),`${consumer.id}/${dependency.capability}: requirement 无效`);
      assert.ok(['block','continue-with-warning','skip'].includes(dependency.failurePolicy),`${consumer.id}/${dependency.capability}: failurePolicy 无效`);
    }
  }
});

// 扩展方案阶段 B：feature 依赖适配可见性字段（adapterStatus/triggerPolicy/resultPolicy 必带且枚举合法）正反用例
test('feature 依赖适配字段校验：真实仓库通过，缺字段与非法枚举被审计捕获',(t)=>{
  // 正例：真实仓库四条 feature 依赖全部携带合法适配字段，审计无字段类问题
  const real=auditCapabilityConsumers(root);
  assert.deepEqual(real.issues.filter((issue)=>/adapterStatus|triggerPolicy|resultPolicy/.test(issue)),[],real.issues.join('\n'));
  for(const consumer of real.consumers.filter((item)=>item.type==='feature')){
    assert.ok(typeof consumer.purpose==='string'&&consumer.purpose,`${consumer.id} 缺少 purpose 用途说明`);
    for(const dependency of consumer.dependencies){
      assert.equal(dependency.adapterStatus,'ready',`${consumer.id}/${dependency.capability}`);
      assert.equal(dependency.triggerPolicy,'code-path',`${consumer.id}/${dependency.capability}`);
      assert.ok(dependency.resultPolicy,`${consumer.id}/${dependency.capability}`);
    }
  }
  // 反例：缺 resultPolicy、非法 triggerPolicy 均被捕获（用临时工作区注入，过滤源文件存在性噪音）
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'feature-adaptation-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'config'),{recursive:true});
  const mutated=JSON.parse(fs.readFileSync(path.join(root,'config','capability-consumers.json'),'utf8'));
  const target=mutated.consumers.find((item)=>item.id==='feature.wechat-typeset').dependencies;
  delete target[0].resultPolicy;
  target[1].triggerPolicy='not-a-policy';
  fs.writeFileSync(path.join(dir,'config','capability-consumers.json'),JSON.stringify(mutated));
  const issues=auditCapabilityConsumers(dir).issues.filter((issue)=>issue.startsWith('feature.wechat-typeset/'));
  assert.ok(issues.some((issue)=>issue.includes('cap_diagram_mermaid_render')&&issue.includes('resultPolicy 缺失或无效')),issues.join('\n'));
  assert.ok(issues.some((issue)=>issue.includes('cap_diagram_echarts_render')&&issue.includes('triggerPolicy 无效')),issues.join('\n'));
});

test('全部技能 Manifest 的能力声明与能力目录一致',()=>{
  const skillsRoot=path.join(root,'skills');
  const directories=fs.readdirSync(skillsRoot,{withFileTypes:true}).filter((entry)=>entry.isDirectory());
  assert.ok(directories.length>0);
  for(const directory of directories){
    const file=path.join(skillsRoot,directory.name,'skill.json');
    if(!fs.existsSync(file))continue;
    const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
    for(const field of ['requiredCapabilities','optionalCapabilities'])
      for(const capability of manifest[field]||[])
        assert.ok(catalogIds.has(capability),`${directory.name} 的 ${field} 引用了目录中不存在的能力：${capability}`);
    const overlap=(manifest.requiredCapabilities||[]).filter((capability)=>(manifest.optionalCapabilities||[]).includes(capability));
    assert.deepEqual(overlap,[],`${directory.name} 同时把能力声明为 required 和 optional：${overlap.join('、')}`);
  }
});
