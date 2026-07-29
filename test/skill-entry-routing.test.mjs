import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  listArticleStageSkillSlots, listEntryWriterSkills, listSocialCardStageSkillSlots,
  resolveArticleStageSkills, resolveEntryWriterSkill, resolveSocialCardStageSkills,
} from '../lib/skills/entry-routing.mjs';
import { createGenerationSnapshot } from '../lib/skills/registry.mjs';

function writeSkill(root,{id,name=id,entryPoints,contentTypes,inputContract,requiredCapabilities=[],
  kind='writer',outputContract='wechat_markdown'}) {
  const directory=path.join(root,'skills',id);
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'SKILL.md'),`---\nname: ${name}\ndescription: test writer\n---\n\n# ${name}\n`,'utf8');
  fs.writeFileSync(path.join(directory,'skill.json'),JSON.stringify({
    schemaVersion:1,id,name,version:'1.0.0',kind,entryPoints,contentTypes,
    inputContract,outputContract,requiredCapabilities,optionalCapabilities:[],
    compatibleApp:'>=0.1.0',source:{type:'builtin',url:''},
  }),'utf8');
}

function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'skill-entry-routing-'));
  fs.mkdirSync(path.join(root,'data'),{recursive:true});
  fs.writeFileSync(path.join(root,'data','skill-packages.json'),JSON.stringify({
    schemaVersion:1,packages:{},entryDefaults:{'hotspot-article':'hotspot-default'},stageDefaults:{},
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
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'data','skill-packages.json'),'utf8'));
  catalog.stageDefaults['hotspot-article']={title:'custom-title'};
  fs.writeFileSync(path.join(root,'data','skill-packages.json'),JSON.stringify(catalog),'utf8');
  const automatic=await resolveArticleStageSkills({workspaceRoot:root});
  assert.equal(automatic.title.selectedSkill,'custom-title');
  assert.equal(automatic.title.selectionSource,'workspace-default');
  await assert.rejects(resolveArticleStageSkills({workspaceRoot:root,requested:{title:'hotspot-other'}}),/不兼容当前阶段契约/);
});

test('social-card storyboard routing validates entry, content type, contracts and capabilities',async(t)=>{
  const root=fixture();
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const base={entryPoints:['social-tool'],contentTypes:['repository'],kind:'storyboard',
    inputContract:'social_card_fact_base',outputContract:'social_card_storyboard'};
  writeSkill(root,{id:'repository-card-storyboard',name:'内置故事板',...base});
  writeSkill(root,{id:'event-card-storyboard',name:'事件故事板',
    entryPoints:['social-event'],contentTypes:['event'],kind:'storyboard',
    inputContract:'social_card_fact_base',outputContract:'social_card_storyboard'});
  writeSkill(root,{id:'custom-card-storyboard',name:'自定义故事板内置',
    entryPoints:['social-custom'],contentTypes:['tutorial','list','opinion'],kind:'storyboard',
    inputContract:'social_card_fact_base',outputContract:'social_card_storyboard'});
  writeSkill(root,{id:'custom-storyboard',name:'自定义故事板',...base});
  writeSkill(root,{id:'wrong-contract',name:'错误契约',...base,outputContract:'wechat_markdown'});
  writeSkill(root,{id:'missing-storyboard-tool',name:'缺少工具',...base,requiredCapabilities:['content.missing.search']});

  const listed=await listSocialCardStageSkillSlots({
    workspaceRoot:root,entryPoint:'social-tool',contentType:'repository',
  });
  const slot=listed.slots[0];
  assert.equal(slot.id,'storyboard');
  assert.deepEqual(slot.items.map((item)=>item.id).sort(),[
    'custom-storyboard','missing-storyboard-tool','repository-card-storyboard',
  ]);
  assert.equal(slot.items.find((item)=>item.id==='missing-storyboard-tool').available,false);

  const selected=await resolveSocialCardStageSkills({
    workspaceRoot:root,entryPoint:'social-tool',contentType:'repository',
    requested:{storyboard:'custom-storyboard'},
  });
  assert.equal(selected.storyboard.selectedSkill,'custom-storyboard');
  assert.equal(selected.storyboard.selectionSource,'user');
  const automatic=await resolveSocialCardStageSkills({
    workspaceRoot:root,entryPoint:'social-tool',contentType:'repository',
  });
  assert.equal(automatic.storyboard.selectedSkill,'repository-card-storyboard');
  assert.equal(automatic.storyboard.selectionSource,'builtin-default');
  const eventDefault=await resolveSocialCardStageSkills({
    workspaceRoot:root,entryPoint:'social-event',contentType:'event',
  });
  assert.equal(eventDefault.storyboard.selectedSkill,'event-card-storyboard');
  const customDefault=await resolveSocialCardStageSkills({
    workspaceRoot:root,entryPoint:'social-custom',contentType:'tutorial',
  });
  assert.equal(customDefault.storyboard.selectedSkill,'custom-card-storyboard');
  await assert.rejects(resolveSocialCardStageSkills({
    workspaceRoot:root,entryPoint:'social-tool',contentType:'repository',
    requested:{storyboard:'wrong-contract'},
  }),/不兼容当前图文入口、内容类型或阶段契约/);
  await assert.rejects(listSocialCardStageSkillSlots({
    workspaceRoot:root,entryPoint:'social-tool',contentType:'event',
  }),/内容类型与创作入口不匹配/);
});
