import fs from 'node:fs';
import path from 'node:path';
import { getToolRegistry } from './index.mjs';

// 固定元数据的写作信息槽位：名称/说明/环节仅用于展示，不再是槽位全集。
// 槽位清单 = 注册表里的全部能力；未出现在本表中的能力以能力名自动生成槽位卡片。
export const INFORMATION_CAPABILITY_SLOTS=Object.freeze([
  {id:'web-page',name:'网页正文读取',capability:'content.url.fetch',description:'读取指定网页并提取可引用正文',stage:'事实基座'},
  {id:'web-search',name:'网络搜索',capability:'content.web.search',description:'按查询词检索公开网页',stage:'资料发现'},
  {id:'news-search',name:'新闻搜索',capability:'content.news.search',description:'检索带发布时间和来源的新闻结果',stage:'热点调研'},
  {id:'repository',name:'代码仓库分析',capability:'content.repository.inspect',description:'核验仓库元数据、README、版本与安装入口',stage:'事实基座'},
  {id:'document',name:'文档检索',capability:'content.document.search',description:'从已授权知识库或文档服务检索材料',stage:'资料发现'},
  {id:'local-project',name:'本地项目读取',capability:'filesystem.project.read',description:'只读提取本地项目结构和文本材料',stage:'自主写作'},
]);

function settingsPath(workspaceRoot){return path.join(workspaceRoot,'data','information-capability-slots.json');}
function readSettings(workspaceRoot){
  const file=settingsPath(workspaceRoot);
  if(!fs.existsSync(file))return {};
  let parsed;
  try{ parsed=JSON.parse(fs.readFileSync(file,'utf8')); }catch{ return {}; }
  // 键可以是固定槽位 id，也可以是任意能力名（动态槽位）；值统一为插件 id。
  return Object.fromEntries(Object.entries(parsed||{}).filter(([key,value])=>typeof key==='string'&&typeof value==='string'));
}
function writeSettings(workspaceRoot,value){
  const file=settingsPath(workspaceRoot);fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=`${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary,`${JSON.stringify(value,null,2)}\n`,'utf8');fs.renameSync(temporary,file);
}
export function getInformationSlot(slotId){
  return INFORMATION_CAPABILITY_SLOTS.find((slot)=>slot.id===slotId)||null;
}

// 槽位 id → 能力名：固定槽位映射到声明的能力，其余 id 直接视为能力名。
function capabilityForSlot(slotId,capabilities){
  const fixed=getInformationSlot(slotId);
  if(fixed)return fixed.capability;
  return capabilities.some((item)=>item.capability===slotId)?slotId:null;
}

function buildSlot(meta,implementations,registry,preferred){
  const selected=registry.resolve(meta.capability,{plugin:preferred})?.manifest||null;
  return {...meta,available:Boolean(selected),preferredPlugin:preferred,selectedPlugin:selected?.id||'',
    implementations:implementations.map((item)=>({...item,selected:item.plugin===selected?.id}))};
}

export async function listInformationCapabilitySlots(workspaceRoot){
  const registry=await getToolRegistry(),settings=readSettings(workspaceRoot);
  const capabilities=registry.listCapabilities({includeDisabled:true});
  const covered=new Set(INFORMATION_CAPABILITY_SLOTS.map((slot)=>slot.capability));
  const slots=INFORMATION_CAPABILITY_SLOTS.map((slot)=>buildSlot(
    slot,capabilities.filter((item)=>item.capability===slot.capability),registry,settings[slot.id]||''));
  const dynamicCapabilities=[...new Set(capabilities.map((item)=>item.capability))].filter((capability)=>!covered.has(capability)).sort();
  for(const capability of dynamicCapabilities){
    slots.push(buildSlot(
      {id:capability,name:capability,capability,description:'',stage:'工具能力'},
      capabilities.filter((item)=>item.capability===capability),registry,settings[capability]||''));
  }
  return slots;
}

export async function setInformationCapabilitySlot(workspaceRoot,slotId,pluginId=''){
  const registry=await getToolRegistry();
  const all=registry.listCapabilities({includeDisabled:true});
  const capability=capabilityForSlot(slotId,all);
  if(!capability)throw new Error('未知能力槽位');
  const settings=readSettings(workspaceRoot);
  if(pluginId){
    const implementation=all.find((item)=>item.capability===capability&&item.plugin===pluginId);
    if(!implementation)throw new Error('所选插件不实现该能力');
    if(!implementation.enabled)throw new Error('所选插件尚未启用');
    settings[slotId]=pluginId;
  }else delete settings[slotId];
  writeSettings(workspaceRoot,settings);
  return (await listInformationCapabilitySlots(workspaceRoot)).find((item)=>item.id===slotId);
}

// 能力级偏好：先查固定槽位映射，再查能力名直配。
export function preferredPluginForCapability(workspaceRoot,capability){
  const settings=readSettings(workspaceRoot);
  for(const slot of INFORMATION_CAPABILITY_SLOTS){
    if(slot.capability===capability&&settings[slot.id])return settings[slot.id];
  }
  return settings[capability]||'';
}

export async function executeInformationCapabilitySlot(slotId,input={},context={}){
  const slot=getInformationSlot(slotId);if(!slot)throw new Error('未知信息能力槽位');
  const registry=await getToolRegistry(),preferred=readSettings(context.workspaceRoot||process.cwd())[slotId]||'';
  return registry.execute(slot.capability,input,context,preferred?{plugin:preferred}:{});
}

// 任意能力的偏好执行：所有不走固定槽位的调用方（如编辑室摘录检索）统一走这里。
export async function executeCapabilityWithPreference(workspaceRoot,capability,input={},context={}){
  const registry=await getToolRegistry(),preferred=preferredPluginForCapability(workspaceRoot,capability);
  return registry.execute(capability,input,context,preferred?{plugin:preferred}:{});
}
