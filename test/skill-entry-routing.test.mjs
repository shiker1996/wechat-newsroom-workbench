import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listArticleStageSkillSlots, listEntryWriterSkills, resolveArticleStageSkills, resolveEntryWriterSkill } from '../lib/skills/entry-routing.mjs';
import { createGenerationSnapshot } from '../lib/skills/registry.mjs';

function writeSkill(root,{id,name=id,entryPoints,contentTypes,inputContract,requiredCapabilities=[]}) {
  const directory=path.join(root,'skills',id);
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'SKILL.md'),`---\nname: ${name}\ndescription: test writer\n---\n\n# ${name}\n`,'utf8');
  fs.writeFileSync(path.join(directory,'skill.json'),JSON.stringify({
    schemaVersion:1,id,name,version:'1.0.0',kind:'writer',entryPoints,contentTypes,
    inputContract,outputContract:'wechat_markdown',requiredCapabilities,optionalCapabilities:[],
    compatibleApp:'>=0.1.0',source:{type:'builtin',url:''},
  }),'utf8');
}

function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'skill-entry-routing-'));
  fs.mkdirSync(path.join(root,'data'),{recursive:true});
  fs.writeFileSync(path.join(root,'data','skill-packages.json'),JSON.stringify({
    schemaVersion:1,packages:{},entryDefaults:{'hotspot-article':'hotspot-default'},
  }),'utf8');
  writeSkill(root,{id:'hotspot-default',name:'热点默认',entryPoints:['hotspot-article'],contentTypes:['tech_hotspot'],inputContract:'article_fact_base'});
  writeSkill(root,{id:'hotspot-other',name:'热点备选',entryPoints:['hotspot-article'],contentTypes:['tech_hotspot'],inputContract:'article_fact_base'});
  writeSkill(root,{id:'tutorial-writer',name:'教程写作',entryPoints:['independent-writing'],contentTypes:['tutorial'],inputContract:'tutorial_fact_base'});
  writeSkill(root,{id:'missing-tool',name:'缺工具',entryPoints:['hotspot-article'],contentTypes:['tech_hotspot'],inputContract:'article_fact_base',requiredCapabilities:['content.missing.search']});
  return root;
}

test('entry routing follows user, workspace default and recommendation order',async(t)=>{
  const root=fixture();
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const requested=await resolveEntryWriterSkill({workspaceRoot:root,entryPoint:'hotspot-article',requestedSkillId:'hotspot-other',recommendedSkillId:'hotspot-other'});
  assert.equal(requested.selectedSkill,'hotspot-other');
  assert.equal(requested.selectionSource,'user');
  const automatic=await resolveEntryWriterSkill({workspaceRoot:root,entryPoint:'hotspot-article',recommendedSkillId:'hotspot-other'});
  assert.equal(automatic.selectedSkill,'hotspot-default');
  assert.equal(automatic.selectionSource,'workspace-default');
});

test('entry routing filters contracts and blocks missing required capabilities',async(t)=>{
  const root=fixture();
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const result=await listEntryWriterSkills({workspaceRoot:root,entryPoint:'hotspot-article',recommendedSkillId:'hotspot-other'});
  assert.equal(result.items.find((item)=>item.id==='missing-tool').available,false);
  assert.deepEqual(result.items.find((item)=>item.id==='missing-tool').missingCapabilities,['content.missing.search']);
  await assert.rejects(
    resolveEntryWriterSkill({workspaceRoot:root,entryPoint:'hotspot-article',requestedSkillId:'tutorial-writer',recommendedSkillId:'hotspot-other'}),
    /不兼容当前创作入口/,
  );
});

test('generation snapshot records the writer selection decision',()=>{
  const snapshot=createGenerationSnapshot({
    skillBundles:[{skillName:'hotspot-other',prompt:'prompt',hash:'abc',files:[]}],
    provider:'test',model:'test-model',purpose:'article',
    selection:{requestedSkill:'hotspot-other',selectedSkill:'hotspot-other',selectionSource:'user',entryPoint:'hotspot-article'},
  });
  assert.deepEqual(snapshot.selection,{
    requestedSkill:'hotspot-other',selectedSkill:'hotspot-other',selectionSource:'user',
    entryPoint:'hotspot-article',contentType:'',stages:{},
  });
});

test('article stage overrides validate role and contracts before selection',async(t)=>{
  const root=fixture();
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const [id,name,kind,inputContract,outputContract] of [
    ['title-generator','默认标题','title','article_fact_base','title_candidates'],
    ['article-reviewer','默认审稿','reviewer','article_fact_base','reviewed_markdown'],
    ['humanizer-zh','默认表达','humanizer','wechat_markdown','wechat_markdown'],
    ['seo-content-optimizer','默认 SEO','seo','reviewed_markdown','wechat_markdown'],
    ['custom-title','自定义标题','title','article_fact_base','title_candidates'],
  ]){
    const directory=path.join(root,'skills',id);fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,'SKILL.md'),`---\nname: ${name}\ndescription: stage\n---\n`,'utf8');
    fs.writeFileSync(path.join(directory,'skill.json'),JSON.stringify({
      schemaVersion:1,id,name,version:'1.0.0',kind,entryPoints:['hotspot-article'],contentTypes:['article'],
      inputContract,outputContract,requiredCapabilities:[],optionalCapabilities:[],compatibleApp:'>=0.1.0',source:{type:'builtin',url:''},
    }),'utf8');
  }
  const listed=await listArticleStageSkillSlots({workspaceRoot:root});
  assert.equal(listed.slots.find((slot)=>slot.id==='title').items.some((item)=>item.id==='custom-title'),true);
  const selected=await resolveArticleStageSkills({workspaceRoot:root,requested:{title:'custom-title'}});
  assert.equal(selected.title.selectedSkill,'custom-title');
  assert.equal(selected.title.selectionSource,'user');
  assert.equal(selected.reviewer.selectedSkill,'article-reviewer');
  await assert.rejects(resolveArticleStageSkills({workspaceRoot:root,requested:{title:'hotspot-other'}}),/不兼容当前阶段契约/);
});
