import fs from 'node:fs';
import path from 'node:path';

export function stageWritingSkillRestore(root, entries) {
  const writingRoot=path.resolve(root,'writing-skills');
  const suffix=`${process.pid}-${Date.now()}`;
  const staging=path.resolve(root,`.writing-skills-restore-${suffix}`);
  const previous=path.resolve(root,`.writing-skills-previous-${suffix}`);
  fs.mkdirSync(staging,{recursive:true});
  try{
    for(const [name,data] of entries){
      const relative=name.replace(/^writing-skills\//,'');
      const target=path.resolve(staging,relative);
      if(!target.startsWith(`${staging}${path.sep}`))throw new Error('技能配置恢复路径越界');
      JSON.parse(data.toString('utf8'));
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,data);
    }
  }catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error;}
  let hadPrevious=false;let swapped=false;
  return {
    swap(){
      if(fs.existsSync(writingRoot)){fs.renameSync(writingRoot,previous);hadPrevious=true;}
      try{fs.renameSync(staging,writingRoot);swapped=true;}
      catch(error){if(hadPrevious)fs.renameSync(previous,writingRoot);throw error;}
    },
    commit(){if(hadPrevious)try{fs.rmSync(previous,{recursive:true,force:true});}catch{}},
    rollback(){
      if(swapped&&fs.existsSync(writingRoot))fs.rmSync(writingRoot,{recursive:true,force:true});
      if(hadPrevious&&fs.existsSync(previous))fs.renameSync(previous,writingRoot);
      if(fs.existsSync(staging))fs.rmSync(staging,{recursive:true,force:true});
    },
  };
}

export function stageSkillPackageRestore(root,entries){
  const names=['installed-skills','skill-package-archive','installed-tool-plugins','tool-plugin-archive','installed-collector-plugins','collector-plugin-archive'];
  const suffix=`${process.pid}-${Date.now()}`;
  const staging=path.join(root,'data',`.skill-packages-restore-${suffix}`);
  const moved=[];
  fs.mkdirSync(staging,{recursive:true});
  try{
    for(const [name,data] of entries){
      const relative=name.replace(/^data\//,'');
      const target=path.resolve(staging,relative);
      if(!target.startsWith(`${path.resolve(staging)}${path.sep}`))throw new Error('第三方技能恢复路径越界');
      fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);
    }
    const catalogFile=path.join(staging,'skill-packages.json');
    if(fs.existsSync(catalogFile))JSON.parse(fs.readFileSync(catalogFile,'utf8'));
  }catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error;}
  return {
    swap(){
      for(const name of [...names,'skill-packages.json','skill-install-events.jsonl','tool-plugins.json','tool-plugin-install-events.jsonl',
        'remote-tool-plugins.json','remote-tool-plugin-events.jsonl','collector-plugins.json','collector-plugin-events.jsonl','information-capability-slots.json']){
        const live=path.join(root,'data',name),incoming=path.join(staging,name),previous=`${live}.previous-${suffix}`;
        if(fs.existsSync(live)){fs.renameSync(live,previous);moved.push({live,previous});}
        if(fs.existsSync(incoming))fs.renameSync(incoming,live);
      }
    },
    commit(){for(const {previous} of moved)if(fs.existsSync(previous))fs.rmSync(previous,{recursive:true,force:true});fs.rmSync(staging,{recursive:true,force:true});},
    rollback(){
      for(const name of [...names,'skill-packages.json','skill-install-events.jsonl','tool-plugins.json','tool-plugin-install-events.jsonl',
        'remote-tool-plugins.json','remote-tool-plugin-events.jsonl','collector-plugins.json','collector-plugin-events.jsonl','information-capability-slots.json']){const live=path.join(root,'data',name);if(fs.existsSync(live))fs.rmSync(live,{recursive:true,force:true});}
      for(const {live,previous} of moved)if(fs.existsSync(previous))fs.renameSync(previous,live);
      fs.rmSync(staging,{recursive:true,force:true});
    },
  };
}
