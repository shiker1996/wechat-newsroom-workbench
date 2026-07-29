import fs from 'node:fs';
import path from 'node:path';
import { getToolRegistry } from './index.mjs';

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
  const parsed=JSON.parse(fs.readFileSync(file,'utf8'));
  return Object.fromEntries(Object.entries(parsed||{}).filter(([slotId,pluginId])=>
    INFORMATION_CAPABILITY_SLOTS.some((slot)=>slot.id===slotId)&&typeof pluginId==='string'));
}
function writeSettings(workspaceRoot,value){
  const file=settingsPath(workspaceRoot);fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=`${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary,`${JSON.stringify(value,null,2)}\n`,'utf8');fs.renameSync(temporary,file);
}
export function getInformationSlot(slotId){
  return INFORMATION_CAPABILITY_SLOTS.find((slot)=>slot.id===slotId)||null;
}
export async function listInformationCapabilitySlots(workspaceRoot){
  const registry=await getToolRegistry(),settings=readSettings(workspaceRoot);
  const capabilities=registry.listCapabilities({includeDisabled:true});
  return INFORMATION_CAPABILITY_SLOTS.map((slot)=>{
    const implementations=capabilities.filter((item)=>item.capability===slot.capability);
    const preferred=settings[slot.id]||'';
    const selected=registry.resolve(slot.capability,{plugin:preferred})?.manifest||null;
    return {...slot,available:Boolean(selected),preferredPlugin:preferred,selectedPlugin:selected?.id||'',
      implementations:implementations.map((item)=>({...item,selected:item.plugin===selected?.id}))};
  });
}
export async function setInformationCapabilitySlot(workspaceRoot,slotId,pluginId=''){
  const slot=getInformationSlot(slotId);if(!slot)throw new Error('未知信息能力槽位');
  const registry=await getToolRegistry(),settings=readSettings(workspaceRoot);
  if(pluginId){
    const implementation=registry.listCapabilities({includeDisabled:true})
      .find((item)=>item.capability===slot.capability&&item.plugin===pluginId);
    if(!implementation)throw new Error('所选插件不实现该信息能力');
    if(!implementation.enabled)throw new Error('所选插件尚未启用');
    settings[slotId]=pluginId;
  }else delete settings[slotId];
  writeSettings(workspaceRoot,settings);
  return (await listInformationCapabilitySlots(workspaceRoot)).find((item)=>item.id===slotId);
}
export async function executeInformationCapabilitySlot(slotId,input={},context={}){
  const slot=getInformationSlot(slotId);if(!slot)throw new Error('未知信息能力槽位');
  const registry=await getToolRegistry(),preferred=readSettings(context.workspaceRoot||process.cwd())[slotId]||'';
  return registry.execute(slot.capability,input,context,preferred?{plugin:preferred}:{});
}
