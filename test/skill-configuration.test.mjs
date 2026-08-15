import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../lib/core/store.mjs';
import {
  dryRunSkillConfig, normalizeSkillConfig, readActiveSkillConfig, validateSkillConfig, writeActiveSkillConfig,
} from '../lib/skills/configuration.mjs';
import { loadSkillBundle } from '../lib/llm/skill-runtime.mjs';
import { prepareSkillRun, resolveSkillToolPolicy } from '../lib/skills/pipeline-runtime.mjs';

test('技能配置拒绝未知工具、非法字数和 Prompt/门禁冲突', () => {
  const config=normalizeSkillConfig({
    prompt:'请使用第一人称写作',allowedTools:['unknown.tool'],
    gates:{length:{minVisibleChars:3000,maxVisibleChars:1000},voice:{firstPerson:'off'},repair:{maxAttempts:1}},
  });
  const issues=validateSkillConfig(config,['content.url.fetch']);
  assert.ok(issues.some((item)=>item.field==='allowedTools'));
  assert.ok(issues.some((item)=>item.field==='gates.length'));
  assert.ok(issues.some((item)=>item.field==='gates.voice.firstPerson'));
});

test('allowedTools 兼容读取并规范化为能力授权覆盖层',()=>{const config=normalizeSkillConfig({prompt:'test',allowedTools:['content.url.fetch']});assert.deepEqual(config.capabilityAuthorization,{mode:'allow-list',capabilities:['content.url.fetch']});const modern=normalizeSkillConfig({prompt:'test',capabilityAuthorization:{capabilities:['content.web.search']}});assert.deepEqual(modern.allowedTools,['content.web.search']);});

test('技能门禁配置深合并默认值并拒绝未知枚举', () => {
  const config=normalizeSkillConfig({prompt:'规则',gates:{
    facts:{unverifiedClaims:'warning'},voice:{firstPerson:'sometimes'},repair:{enabled:'yes'},
  }});
  assert.equal(config.gates.facts.missingAttribution,'error');
  assert.equal(config.gates.voice.personalTestClaim,'require_author_experience');
  const issues=validateSkillConfig(config,[]);
  assert.ok(issues.some((item)=>item.field==='gates.voice.firstPerson'));
  assert.ok(issues.some((item)=>item.field==='gates.repair.enabled'));
});

test('旧版部分 active 配置在读取时补全门禁且损坏文件不静默降级', () => {
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'skill-active-read-'));
  try{
    writeActiveSkillConfig(tempRoot,'demo',{prompt:'旧配置',gates:{facts:{unverifiedClaims:'warning'}}});
    const config=readActiveSkillConfig(tempRoot,'demo');
    assert.equal(config.gates.facts.missingAttribution,'error');
    fs.writeFileSync(path.join(tempRoot,'writing-skills','demo','active.json'),'{broken','utf8');
    assert.throws(()=>readActiveSkillConfig(tempRoot,'demo'),/active\.json 无效/);
  }finally{fs.rmSync(tempRoot,{recursive:true,force:true});}
});

test('事实基座试运行拦截未核验事实和模型建议冒充体验', () => {
  const config=normalizeSkillConfig({prompt:'用第一人称写我的亲测体验'});
  const result=dryRunSkillConfig(config,{claims:[{verified:false,source_level:'model_suggestion'}]});
  assert.equal(result.pass,false);
  assert.ok(result.issues.some((item)=>item.gate==='unverifiedClaims'));
  assert.ok(result.issues.some((item)=>item.gate==='modelSuggestionAsExperience'));
  assert.ok(result.systemGates.includes('no_arbitrary_code'));
});

test('发布的 Prompt 覆盖层进入技能运行时且改变哈希', () => {
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'skill-config-runtime-'));
  try{
    const skillDir=path.join(tempRoot,'skills','demo');fs.mkdirSync(skillDir,{recursive:true});
    fs.writeFileSync(path.join(skillDir,'SKILL.md'),'# 内置规则\n\n保持事实。','utf8');
    const before=loadSkillBundle({workspaceRoot:tempRoot,skillName:'demo'});
    writeActiveSkillConfig(tempRoot,'demo',{prompt:'增加可配置规则。'});
    const after=loadSkillBundle({workspaceRoot:tempRoot,skillName:'demo'});
    assert.match(after.prompt,/CONFIGURED OVERLAY/);
    assert.match(after.prompt,/增加可配置规则/);
    assert.ok(after.prompt.indexOf('CONFIGURED OVERLAY')<after.prompt.indexOf('不可变系统安全门禁'));
    assert.notEqual(after.hash,before.hash);
  }finally{fs.rmSync(tempRoot,{recursive:true,force:true});}
});

test('恢复历史配置会创建新版本而不覆盖旧版本', () => {
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'skill-config-store-'));let store;
  try{
    store=new Store(path.join(tempRoot,'test.db'));
    store.saveSkillVersion({skillId:'demo',config:{prompt:'v1'},configHash:'h1',publish:true});
    store.saveSkillVersion({skillId:'demo',config:{prompt:'v2'},configHash:'h2',publish:true});
    const old=store.getSkillVersion('demo',1);
    const restored=store.saveSkillVersion({skillId:'demo',config:old.config,configHash:'h1',publish:true});
    assert.equal(restored.version,3);
    assert.equal(store.listSkillVersions('demo').length,3);
    assert.equal(store.getSkillVersion('demo',1).config.prompt,'v1');
  }finally{store?.close();fs.rmSync(tempRoot,{recursive:true,force:true});}
});

test('统一创作运行时应用默认模型、工具白名单并冻结配置快照', async () => {
  const saved=[];
  const gateway={config:{defaultProvider:'default',providers:{
    default:{model:'model-default'},configured:{model:'model-configured'},
  }}};
  const bundle={skillName:'demo',prompt:'规则',hash:'abc',files:[],fallback:false,config:{
    defaultModel:'configured',allowedTools:['content.url.fetch'],version:3,configHash:'sha256:cfg',
    gates:{length:{minVisibleChars:900,maxVisibleChars:1500}},
  }};
  const result=await prepareSkillRun({gateway,store:{saveGenerationSnapshot:(item)=>saved.push(item)},
    batchId:'batch-1',candidateId:2,purpose:'tutorial',bundles:[bundle]});
  assert.equal(result.provider,'configured');
  assert.deepEqual(result.tools.map((item)=>item.capability),['content.url.fetch']);
  assert.equal(saved[0].snapshot.skillConfig.version,3);
  assert.equal(saved[0].snapshot.model,'model-configured');
});

test('配置门禁实际检查事实来源、体验和返工开关', async () => {
  const {evaluateConfiguredGates,configuredRepairAttempts}=await import('../lib/skills/configuration.mjs');
  const config=normalizeSkillConfig({prompt:'规则',gates:{repair:{enabled:false,maxAttempts:3}}});
  const result=evaluateConfiguredGates(config,{factBase:{claims:[{claim:'未经核实',verified:false,source_level:'model_suggestion'}]},output:'我亲测效果很好',visibleChars:1000});
  assert.equal(result.pass,false);
  assert.ok(result.issues.some((item)=>/未核验/.test(item.message)));
  assert.ok(result.issues.some((item)=>/亲身体验/.test(item.message)));
  assert.equal(configuredRepairAttempts(config,2),0);
});

test('历史重试复用快照中的 Prompt、模型和工具版本', async () => {
  const snapshots=[];const original={
    id:9,batch_id:'batch-1',candidate_row_id:2,snapshot:{
      schemaVersion:1,purpose:'tutorial',modelProvider:'configured',model:'model-configured',
      skills:[{id:'demo',version:2,configHash:'sha256:old',promptHash:'sha256:oldprompt',prompt:'历史 Prompt',files:[],fallback:false}],
      tools:[{capability:'content.url.fetch',plugin:'url-fetch',version:'1.0.0'}],
      skillConfig:{defaultModel:'configured',allowedTools:['content.url.fetch'],gates:{length:{minVisibleChars:900,maxVisibleChars:1500},repair:{enabled:true,maxAttempts:1}}},
    },
  };
  const store={getGenerationSnapshot:()=>original,saveGenerationSnapshot:(item)=>{snapshots.push(item);return{id:10};}};
  const gateway={config:{defaultProvider:'default',providers:{configured:{model:'model-configured'}}}};
  const bundle={skillName:'demo',prompt:'当前 Prompt',hash:'current',files:[],fallback:false};
  const runtime=await prepareSkillRun({gateway,store,batchId:'batch-1',candidateId:2,purpose:'tutorial',bundles:[bundle],snapshotId:9});
  assert.equal(bundle.prompt,'历史 Prompt');
  assert.equal(runtime.provider,'configured');
  assert.equal(runtime.snapshotId,10);
  assert.equal(snapshots[0].snapshot.reusedFromSnapshotId,9);
});

test('历史快照中的显式空白名单冻结为全部禁止', async () => {
  const snapshots=[];const original={
    id:11,batch_id:'batch-1',candidate_row_id:2,snapshot:{
      schemaVersion:1,purpose:'social-cards-repository',modelProvider:'default',model:'model-default',
      skills:[{id:'xiaohongshu-article-generator',version:'builtin',config:null,promptHash:'sha256:p',prompt:'生成 Prompt',files:[],fallback:false}],
      tools:[{capability:'content.url.fetch',plugin:'url-fetch',version:'1.0.0'}],
      skillConfig:{defaultModel:'',allowedTools:[],gates:null,version:null,configHash:''},
    },
  };
  const store={getGenerationSnapshot:()=>original,saveGenerationSnapshot:(item)=>{snapshots.push(item);return{id:12};}};
  const gateway={config:{defaultProvider:'default',providers:{default:{model:'model-default'}}}};
  const bundle={skillName:'xiaohongshu-article-generator',prompt:'当前 Prompt',hash:'current',files:[],fallback:false,config:null};
  const runtime=await prepareSkillRun({gateway,store,batchId:'batch-1',candidateId:2,purpose:'social-cards-repository',bundles:[bundle],snapshotId:11});
  // 显式空数组 = 全部禁止；历史工具列表仍按快照冻结恢复
  assert.deepEqual(runtime.allowedCapabilities,[]);
  assert.deepEqual(runtime.tools.map((item)=>item.capability),['content.url.fetch']);
  assert.deepEqual(snapshots[0].snapshot.skillConfig.allowedTools,[]);
});

test('模型调用通过绑定网关精确携带 generation snapshot', async () => {
  const {bindGenerationSnapshot}=await import('../lib/skills/pipeline-runtime.mjs');
  const calls=[];
  const gateway={
    complete:async(input)=>{calls.push(input);return input;},
    streamComplete:async(input,onDelta)=>{calls.push(input);onDelta?.('ok');return input;},
  };
  const bound=bindGenerationSnapshot(gateway,17);
  await bound.complete({purpose:'article'});
  await bound.streamComplete({purpose:'review'},()=>{});
  assert.deepEqual(calls.map((item)=>item.generationSnapshotId),[17,17]);
});

test('子技能配置只冻结自身 Prompt，不接管主技能的模型、工具和门禁', async () => {
  const saved=[];
  const gateway={config:{defaultProvider:'default',providers:{
    default:{model:'model-default'},child:{model:'model-child'},
  }}};
  const primary={skillName:'wechat-mp-deep-dive',prompt:'主技能',hash:'primary',files:[],fallback:false,config:null};
  const child={skillName:'article-reviewer',prompt:'子技能覆盖层',hash:'child',files:[],fallback:false,config:{
    defaultModel:'child',allowedTools:[],version:4,configHash:'sha256:child',
    gates:{length:{minVisibleChars:1,maxVisibleChars:2}},
  }};
  const runtime=await prepareSkillRun({gateway,store:{saveGenerationSnapshot:(item)=>{saved.push(item);return{id:1};}},
    batchId:'batch-1',candidateId:2,purpose:'article',bundles:[primary,child]});
  assert.equal(runtime.provider,'default');
  assert.equal(runtime.config,null);
  assert.equal(runtime.allowedCapabilities,null);
  assert.ok(runtime.tools.length>0);
  assert.equal(saved[0].snapshot.skills[1].config.configHash,'sha256:child');
  assert.equal(saved[0].snapshot.skillConfig.defaultModel,'');
});

test('工具策略可从活动配置和历史快照恢复精确白名单', async () => {
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'skill-tool-policy-'));
  try{
    writeActiveSkillConfig(tempRoot,'wechat-mp-tutorial',{allowedTools:['filesystem.project.read']});
    const active=await resolveSkillToolPolicy({workspaceRoot:tempRoot,skillId:'wechat-mp-tutorial'});
    assert.deepEqual(active.allowedCapabilities,['filesystem.project.read']);
    const historical=await resolveSkillToolPolicy({workspaceRoot:tempRoot,skillId:'wechat-mp-tutorial',snapshot:{
      skills:[{id:'wechat-mp-tutorial',config:{allowedTools:['content.url.fetch']}}],
    }});
    assert.deepEqual(historical.allowedCapabilities,['content.url.fetch']);
  }finally{fs.rmSync(tempRoot,{recursive:true,force:true});}
});
