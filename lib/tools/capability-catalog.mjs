import fs from 'node:fs';
import path from 'node:path';

const ID=/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;

export function readCapabilityCatalog(root){
  const file=path.join(root,'config','capabilities.json'),parsed=JSON.parse(fs.readFileSync(file,'utf8'));
  if(parsed.schemaVersion!==1||!parsed.capabilities||typeof parsed.capabilities!=='object'||Array.isArray(parsed.capabilities))throw new Error('capabilities.json 格式无效');
  const capabilities={};
  for(const [id,value] of Object.entries(parsed.capabilities)){
    if(!ID.test(id)||!value||typeof value.name!=='string'||!value.name.trim()||typeof value.description!=='string'||!value.description.trim()||typeof value.category!=='string'||!value.category.trim())throw new Error(`能力目录条目无效：${id}`);
    capabilities[id]={id,name:value.name.trim(),description:value.description.trim(),category:value.category.trim(),registered:true};
  }
  return {schemaVersion:1,capabilities};
}

export function capabilityMetadata(catalog,id){return catalog.capabilities[id]||{id,name:id,description:'该能力由扩展插件注册，尚未加入项目能力目录。',category:'扩展能力',registered:false};}
