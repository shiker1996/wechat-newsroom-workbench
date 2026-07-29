import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  installSkillPackage, listSkillInstallEvents, readSkillPackageCatalog,
  setInstalledSkillStatus, setSkillEntryDefault, uninstallSkillPackage,
  validateSkillPackageDirectory,
} from '../lib/skills/package-manager.mjs';
import { loadSkillBundle } from '../lib/llm/skill-runtime.mjs';
import { SkillRegistry } from '../lib/skills/registry.mjs';

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
