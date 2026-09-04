import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from '../core/atomic-file.mjs';
import { RESOURCE_KIND_PROFILES } from '../agent/resource-adaptation.mjs';

const ID=/^cap_[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$/;
const fileFor=(root)=>path.join(root,'config','capabilities.json');

// 条目可选声明 resourceKind（值必须是 RESOURCE_KIND_PROFILES 的 key）：声明后该能力走
// 对应档案的默认适配路径（参数改写/Schema 注入/授权检查），新资源类能力接入无需 Adapter 代码。
function validateCatalogEntry(id,value){
  if(!ID.test(id)||!value||typeof value.name!=='string'||!value.name.trim()||typeof value.description!=='string'||!value.description.trim()||typeof value.category!=='string'||!value.category.trim())throw new Error(`能力目录条目无效：${id}`);
  const resourceKind=value.resourceKind==null?null:String(value.resourceKind);
  if(resourceKind&&!RESOURCE_KIND_PROFILES[resourceKind])throw new Error(`能力目录条目 resourceKind 无效：${id}（${resourceKind}，合法值：${Object.keys(RESOURCE_KIND_PROFILES).join('/')}）`);
  return {id,name:value.name.trim(),description:value.description.trim(),category:value.category.trim(),...(resourceKind?{resourceKind}:{}),registered:true};
}

export function readCapabilityCatalog(root){
  const parsed=JSON.parse(fs.readFileSync(fileFor(root),'utf8'));
  if(parsed.schemaVersion!==1||!parsed.capabilities||typeof parsed.capabilities!=='object'||Array.isArray(parsed.capabilities))throw new Error('capabilities.json 格式无效');
  const capabilities={};
  for(const [id,value] of Object.entries(parsed.capabilities))capabilities[id]=validateCatalogEntry(id,value);
  return {schemaVersion:1,capabilities};
}

export function capabilityMetadata(catalog,id){return catalog.capabilities[id]||{id,name:id,description:'该能力由扩展插件注册，尚未加入项目能力目录。',category:'扩展能力',registered:false};}

// R2（顺序规则收口）：目录外能力的实现允许存在但不得启用、不得设为路由首选；返回未登记能力 id 列表
export function findUnregisteredCapabilities(root,capabilityIds){
  const catalog=readCapabilityCatalog(root);
  return [...new Set(capabilityIds)].filter((id)=>!catalog.capabilities[id]);
}

// R3：插件 Manifest 声明目录外能力时生成目录条目草案（保守占位，needsCompletion 标记需人工补全）
export function catalogDraftsForManifest(root,manifest){
  const catalog=readCapabilityCatalog(root);
  return (manifest.capabilities||[]).filter((id)=>!catalog.capabilities[id]).map((id)=>({
    id,name:id,description:`插件「${manifest.name||manifest.id}」声明的能力，待人工补全名称、描述与分类。`,category:'扩展能力',needsCompletion:true,
  }));
}

// R3 确认入库：草案必须经人工确认（路由层要求管理员确认），这里只校验并原子写入
export function addCapabilityCatalogEntries(root,entries){
  if(!Array.isArray(entries)||!entries.length)throw new Error('缺少目录条目');
  const parsed=JSON.parse(fs.readFileSync(fileFor(root),'utf8'));
  if(parsed.schemaVersion!==1||!parsed.capabilities||typeof parsed.capabilities!=='object'||Array.isArray(parsed.capabilities))throw new Error('capabilities.json 格式无效');
  const added=[];
  for(const entry of entries){
    const id=String(entry?.id||''),validated=validateCatalogEntry(id,entry);
    if(parsed.capabilities[id])throw new Error(`能力已在目录中：${id}`);
    parsed.capabilities[id]={name:validated.name,description:validated.description,category:validated.category,...(validated.resourceKind?{resourceKind:validated.resourceKind}:{})};
    added.push(validated);
  }
  atomicWriteJson(fileFor(root),parsed);
  return added;
}
