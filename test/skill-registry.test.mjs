import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../server/platform/core/store.mjs';
import { SkillRegistry, createGenerationSnapshot } from '../server/platform/skills/registry.mjs';
import { loadSkillBundle } from '../server/platform/llm/skill-runtime.mjs';
import { writeActiveSkillConfig } from '../server/platform/skills/configuration.mjs';
import { readSkillManifest, validateSkillManifest } from '../server/platform/skills/manifest.mjs';

test('技能注册中心发现项目技能并生成稳定 Prompt 哈希', () => {
  const workspaceRoot = process.cwd();
  const registry = new SkillRegistry({ workspaceRoot });
  const first = registry.get('article-reviewer');
  const second = registry.get('article-reviewer');
  assert.equal(first.id, 'article-reviewer');
  assert.match(first.promptHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.promptHash, second.promptHash);
  assert.ok(first.fileCount >= 1);
  assert.equal(first.enabled, true);
});

test('技能注册中心展示实际生效的配置版本',()=>{
  const workspaceRoot=fs.mkdtempSync(path.join(os.tmpdir(),'configured-skill-registry-'));
  try{
    const skillDir=path.join(workspaceRoot,'skills','demo');fs.mkdirSync(skillDir,{recursive:true});
    fs.writeFileSync(path.join(skillDir,'SKILL.md'),'---\nname: Demo\nversion: builtin\n---\n\n规则','utf8');
    writeActiveSkillConfig(workspaceRoot,'demo',{prompt:'覆盖层',version:4,configHash:'sha256:configured'});
    const skill=new SkillRegistry({workspaceRoot}).get('demo');
    assert.equal(skill.version,'4');
    assert.equal(skill.configured,true);
    assert.equal(skill.configHash,'sha256:configured');
  }finally{fs.rmSync(workspaceRoot,{recursive:true,force:true});}
});

test('生成快照冻结技能、工具和模型版本', () => {
  const workspaceRoot = process.cwd();
  const bundle = loadSkillBundle({ workspaceRoot, skillName:'article-reviewer' });
  const snapshot = createGenerationSnapshot({
    skillBundles:[bundle],
    tools:[{ capability:'content.url.fetch', plugin:'url-fetch', version:'1.0.0' }],
    provider:'provider-a', model:'model-a', purpose:'review',
  });
  assert.equal(snapshot.skills[0].id, 'article-reviewer');
  assert.match(snapshot.skills[0].promptHash, /^sha256:/);
  assert.ok(snapshot.skills[0].prompt.length>0);
  assert.equal(snapshot.tools[0].version, '1.0.0');
  assert.equal(snapshot.schemaVersion,2);
  assert.deepEqual(snapshot.capabilityAuthorization.capabilities,[snapshot.tools[0].capability]);
  assert.equal(snapshot.capabilityRoutes[0].candidates[0].plugin,snapshot.tools[0].plugin);
  assert.equal(snapshot.resolutionPolicy.strictHistoricalBinding,false);
  assert.equal(snapshot.model, 'model-a');
});

test('Store 持久化历史 generation snapshot，不受后续对象修改影响', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-snapshot-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date:'2026-07-29', title:'快照测试' });
    const snapshot = { skills:[{ id:'skill-a', promptHash:'sha256:old' }], model:'model-a' };
    store.saveGenerationSnapshot({ batchId:batch.id, purpose:'article', snapshot });
    snapshot.skills[0].promptHash = 'sha256:new';
    const saved = store.listGenerationSnapshots({ batchId:batch.id });
    assert.equal(saved[0].snapshot.skills[0].promptHash, 'sha256:old');
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive:true, force:true });
  }
});

test('全部内置技能都提供有效的结构化清单', () => {
  const skillsRoot=path.join(process.cwd(),'skills');
  const directories=fs.readdirSync(skillsRoot,{withFileTypes:true}).filter((item)=>item.isDirectory());
  assert.equal(directories.length,42);
  for(const id of ['repository-card-storyboard','event-card-storyboard','custom-card-storyboard','hotspot-tagging','hotspot-brainstorm','hotspot-synthesis','event-card-generator','event-research-analyzer','editorial-room-chat']){
    assert.ok(directories.some((item)=>item.name===id));
  }
  assert.ok(directories.some((item)=>item.name==='xiaohongshu-article-generator'));
  for(const directory of directories){
    const result=readSkillManifest(path.join(skillsRoot,directory.name),directory.name);
    assert.equal(result.status,'valid',`${directory.name}: ${JSON.stringify(result.issues)}`);
  }
});

test('技能清单校验角色、目录 ID、契约和工具声明', () => {
  const issues=validateSkillManifest({
    schemaVersion:1,id:'Wrong_ID',name:'',version:'latest',kind:'agent',
    entryPoints:['unknown'],contentTypes:['article','article'],
    inputContract:'Bad-Contract',outputContract:'markdown',
    requiredCapabilities:['content.url.fetch'],optionalCapabilities:['content.url.fetch'],
    compatibleApp:'*',source:{type:'remote'},
  },{expectedId:'demo'});
  for(const field of ['id','name','version','kind','entryPoints','contentTypes','inputContract',
    'capabilities','compatibleApp','source'])assert.ok(issues.some((item)=>item.field===field),field);
});

test('注册中心暴露技能角色、入口、契约和工具需求', () => {
  const skill=new SkillRegistry({workspaceRoot:process.cwd()}).get('wechat-mp-tutorial');
  assert.equal(skill.manifestStatus,'valid');
  assert.equal(skill.kind,'writer');
  assert.deepEqual(skill.entryPoints,['independent-writing']);
  assert.equal(skill.inputContract,'tutorial_fact_base');
  assert.ok(skill.optionalCapabilities.includes('filesystem.project.read'));
  assert.equal(skill.packageVersion,'1.0.0');
});
