import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  installSkillPackage, listSkillInstallEvents, readSkillPackageCatalog,
  setInstalledSkillStatus, setSkillEntryDefault, setSkillStageDefault, uninstallSkillPackage,
  validateSkillPackageDirectory,
} from '../server/platform/skills/package-manager.mjs';
import { loadSkillBundle } from '../server/platform/llm/skill-runtime.mjs';
import { SkillRegistry } from '../server/platform/skills/registry.mjs';

function fixture(root,{id='third-party-demo',version='1.0.0'}={}){
  const directory=path.join(root,`source-${version}`);
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'SKILL.md'),`---\nname: Third Party Demo\nversion: ${version}\n---\n\n# Demo\n`,'utf8');
  fs.writeFileSync(path.join(directory,'skill.json'),JSON.stringify({
    schemaVersion:1,id,name:'Third Party Demo',version,kind:'stage',
    entryPoints:['independent-writing'],contentTypes:['article'],
    inputContract:'facts',outputContract:'markdown',
    requiredCapabilities:[],optionalCapabilities:[],compatibleApp:'>=0.1.0',
    source:{type:'installed',url:''},
  },null,2),'utf8');
  return directory;
}

test('third-party skill lifecycle is catalogued and respected by runtime',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'skill-package-test-'));
  try{
    const source=fixture(root);
    assert.equal(validateSkillPackageDirectory(source).manifest.id,'third-party-demo');
    const installed=installSkillPackage({workspaceRoot:root,directory:source});
    assert.equal(installed.status,'enabled');
    assert.equal(loadSkillBundle({workspaceRoot:root,skillName:'third-party-demo'}).fallback,false);
    assert.equal(new SkillRegistry({workspaceRoot:root}).get('third-party-demo').thirdParty,true);
    setSkillEntryDefault(root,'independent-writing','third-party-demo');
    assert.equal(readSkillPackageCatalog(root).entryDefaults['independent-writing'],'third-party-demo');
    setInstalledSkillStatus(root,'third-party-demo','disabled');
    assert.equal(loadSkillBundle({workspaceRoot:root,skillName:'third-party-demo'}).fallback,true);
    assert.equal(new SkillRegistry({workspaceRoot:root}).get('third-party-demo').status,'disabled');
    setInstalledSkillStatus(root,'third-party-demo','enabled');
    installSkillPackage({workspaceRoot:root,directory:fixture(root,{version:'1.1.0'})});
    assert.ok(fs.existsSync(path.join(root,'data','skill-package-archive','third-party-demo','1.0.0')));
    uninstallSkillPackage(root,'third-party-demo');
    assert.equal(new SkillRegistry({workspaceRoot:root}).get('third-party-demo'),null);
    assert.equal(readSkillPackageCatalog(root).entryDefaults['independent-writing'],undefined);
    assert.ok(listSkillInstallEvents(root).length>=5);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('third-party package cannot replace a built-in skill',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'skill-package-conflict-'));
  try{
    fs.mkdirSync(path.join(root,'skills','third-party-demo'),{recursive:true});
    fs.writeFileSync(path.join(root,'skills','third-party-demo','SKILL.md'),'# Built in','utf8');
    assert.throws(()=>installSkillPackage({workspaceRoot:root,directory:fixture(root)}),/内置技能冲突/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('third-party stage skill can become an entry stage default and is cleared when disabled',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'skill-stage-default-'));
  try{
    const source=path.join(root,'source-title');fs.mkdirSync(source,{recursive:true});
    fs.writeFileSync(path.join(source,'SKILL.md'),'---\nname: Viral Title\n---\n\n# Title\n','utf8');
    fs.writeFileSync(path.join(source,'skill.json'),JSON.stringify({
      schemaVersion:1,id:'viral-title',name:'Viral Title',version:'1.0.0',kind:'title',
      entryPoints:['hotspot-article','independent-writing'],contentTypes:['article'],
      inputContract:'article_fact_base',outputContract:'title_candidates',
      requiredCapabilities:[],optionalCapabilities:[],compatibleApp:'>=0.1.0',source:{type:'installed',url:''},
    }),'utf8');
    installSkillPackage({workspaceRoot:root,directory:source});
    setSkillStageDefault(root,'independent-writing','title','viral-title');
    assert.equal(readSkillPackageCatalog(root).stageDefaults['independent-writing'].title,'viral-title');
    setInstalledSkillStatus(root,'viral-title','disabled');
    assert.equal(readSkillPackageCatalog(root).stageDefaults['independent-writing'],undefined);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('third-party storyboard skill can be configured for a social-card entry',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'storyboard-stage-default-'));
  try{
    const source=path.join(root,'source-storyboard');fs.mkdirSync(source,{recursive:true});
    fs.writeFileSync(path.join(source,'SKILL.md'),'---\nname: Storyboard Demo\n---\n\n# Storyboard\n','utf8');
    fs.writeFileSync(path.join(source,'skill.json'),JSON.stringify({
      schemaVersion:1,id:'storyboard-demo',name:'Storyboard Demo',version:'1.0.0',kind:'storyboard',
      entryPoints:['social-tool'],contentTypes:['repository'],
      inputContract:'social_card_fact_base',outputContract:'social_card_storyboard',
      requiredCapabilities:[],optionalCapabilities:[],compatibleApp:'>=0.1.0',source:{type:'installed',url:''},
    }),'utf8');
    installSkillPackage({workspaceRoot:root,directory:source});
    setSkillStageDefault(root,'social-tool','storyboard','storyboard-demo');
    assert.equal(readSkillPackageCatalog(root).stageDefaults['social-tool'].storyboard,'storyboard-demo');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
