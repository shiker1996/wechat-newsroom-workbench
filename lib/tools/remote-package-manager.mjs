import fs from 'node:fs';
import path from 'node:path';
import { clearRemoteCredential, getRemoteCredential } from './remote-credentials.mjs';
import { APP_VERSION } from '../version.mjs';

const TYPES=new Set(['remote-api','mcp']);
const RISKS=new Set(['network-read','external-write']);

function files(root){return {catalog:path.join(root,'data','remote-tool-plugins.json'),events:path.join(root,'data','remote-tool-plugin-events.jsonl')};}
function tuple(value){const match=String(value).match(/(\d+)\.(\d+)\.(\d+)/);return match?match.slice(1).map(Number):null;}
function compatible(range){
  const current=tuple(APP_VERSION),minimum=tuple(range);if(!current||!minimum)return false;
  for(let i=0;i<3;i+=1){if(current[i]>minimum[i])return true;if(current[i]<minimum[i])return false;}return true;
}
function atomic(filePath,value){
  fs.mkdirSync(path.dirname(filePath),{recursive:true});const temporary=`${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary,`${JSON.stringify(value,null,2)}\n`,'utf8');fs.renameSync(temporary,filePath);
}
function record(root,input){
  const filePath=files(root).events;fs.mkdirSync(path.dirname(filePath),{recursive:true});
  fs.appendFileSync(filePath,`${JSON.stringify({createdAt:new Date().toISOString(),...input})}\n`,'utf8');
}
export function readRemotePluginCatalog(root){
  if(!fs.existsSync(files(root).catalog))return {schemaVersion:1,plugins:{}};
  const value=JSON.parse(fs.readFileSync(files(root).catalog,'utf8'));
  if(value.schemaVersion!==1||!value.plugins)throw new Error('远程插件目录无效');return value;
}
export function validateRemotePluginManifest(input){
  const manifest=structuredClone(input||{});
  const required=['schemaVersion','id','name','version','type','capabilities','riskLevel','endpoint','inputSchema','outputSchema','timeoutMs','compatibleApp'];
  const missing=required.filter((key)=>manifest[key]===undefined);
  if(missing.length)throw new Error(`远程插件缺少字段：${missing.join(', ')}`);
  if(manifest.schemaVersion!==1||!TYPES.has(manifest.type)||manifest.entry!==undefined)throw new Error('远程插件类型无效或声明了本地 entry');
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)||!/^\d+\.\d+\.\d+$/.test(manifest.version))throw new Error('远程插件 ID 或版本无效');
  if(!Array.isArray(manifest.capabilities)||!manifest.capabilities.length||manifest.capabilities.some((item)=>typeof item!=='string'||!item.trim()))throw new Error('远程插件 capabilities 无效');
  if(!RISKS.has(manifest.riskLevel)||manifest.inputSchema?.type!=='object'||manifest.outputSchema?.type!=='object')throw new Error('远程插件风险等级或契约无效');
  const endpoint=new URL(manifest.endpoint);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.hash)throw new Error('远程插件 endpoint 必须是无内嵌凭据的 HTTPS URL');
  if(!Number.isInteger(manifest.timeoutMs)||manifest.timeoutMs<1000||manifest.timeoutMs>30000)throw new Error('timeoutMs 必须为 1000–30000');
  manifest.maxResponseBytes=Math.min(2_000_000,Math.max(1024,Number(manifest.maxResponseBytes)||1_000_000));
  if(!compatible(manifest.compatibleApp))throw new Error(`插件需要 ${manifest.compatibleApp}，当前工作台为 ${APP_VERSION}`);
  if(manifest.type==='mcp'&&!String(manifest.toolName||'').trim())throw new Error('MCP 插件必须声明 toolName');
  if(manifest.healthEndpoint){
    const health=new URL(manifest.healthEndpoint);
    if(health.protocol!=='https:'||health.hostname.toLowerCase()!==endpoint.hostname.toLowerCase()||health.username||health.password)throw new Error('healthEndpoint 必须与 endpoint 使用相同 HTTPS 域名');
  }
  if(manifest.credentialProfile&&!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.credentialProfile))throw new Error('credentialProfile 无效');
  manifest.allowedDomains=[endpoint.hostname.toLowerCase()];
  manifest.permissions={networkDomains:manifest.allowedDomains,pathAccess:[],externalWrite:manifest.riskLevel==='external-write',credentials:manifest.credentialProfile?[manifest.credentialProfile]:[]};
  manifest.source=manifest.source||{type:'user-configured',url:manifest.endpoint};
  return manifest;
}
export function installRemotePlugin(root,input){
  const manifest=validateRemotePluginManifest(input),catalog=readRemotePluginCatalog(root),previous=catalog.plugins[manifest.id];
  if(manifest.credentialProfile&&Object.values(catalog.plugins).some((item)=>item.id!==manifest.id&&item.status!=='uninstalled'&&item.manifest.credentialProfile===manifest.credentialProfile))throw new Error('credentialProfile 已被其他插件使用');
  const item={id:manifest.id,name:manifest.name,version:manifest.version,status:'disabled',manifest,installedAt:new Date().toISOString()};
  if(previous?.manifest.credentialProfile&&previous.manifest.credentialProfile!==manifest.credentialProfile){
    clearRemoteCredential(root,manifest.id,previous.manifest.credentialProfile);
  }
  catalog.plugins[manifest.id]=item;atomic(files(root).catalog,catalog);
  record(root,{pluginId:item.id,version:item.version,action:previous?'update':'install',result:'ok'});return item;
}
export function setRemotePluginStatus(root,id,status){
  if(!['enabled','disabled'].includes(status))throw new Error('远程插件状态无效');
  const catalog=readRemotePluginCatalog(root),item=catalog.plugins[id];if(!item||item.status==='uninstalled')throw new Error('远程插件不存在');
  if(status==='enabled'&&item.manifest.credentialProfile&&!getRemoteCredential(root,item.manifest.credentialProfile))throw new Error('请先配置插件凭据');
  item.status=status;item.updatedAt=new Date().toISOString();atomic(files(root).catalog,catalog);
  record(root,{pluginId:id,version:item.version,action:status,result:'ok'});return item;
}
// 首次执行确认（开源清单 3.3）：避免「安装即信任所有能力」——启用后首次真实调用前，
// 用户必须在「技能与插件」页面确认该插件的域名与权限摘要，执行门禁见 remote-adapter。
export function confirmRemotePluginFirstRun(root,id){
  const catalog=readRemotePluginCatalog(root),item=catalog.plugins[id];if(!item||item.status==='uninstalled')throw new Error('远程插件不存在');
  if(!item.firstRunConfirmedAt){item.firstRunConfirmedAt=new Date().toISOString();atomic(files(root).catalog,catalog);}
  record(root,{pluginId:id,version:item.version,action:'first-run-confirm',result:'ok'});return item;
}
export function uninstallRemotePlugin(root,id){
  const catalog=readRemotePluginCatalog(root),item=catalog.plugins[id];if(!item||item.status==='uninstalled')throw new Error('远程插件不存在');
  item.status='uninstalled';item.updatedAt=new Date().toISOString();atomic(files(root).catalog,catalog);
  if(item.manifest.credentialProfile)clearRemoteCredential(root,id,item.manifest.credentialProfile);
  record(root,{pluginId:id,version:item.version,action:'uninstall',result:'ok'});return item;
}
export function listRemotePluginEvents(root,limit=100){
  const filePath=files(root).events;if(!fs.existsSync(filePath))return [];
  return fs.readFileSync(filePath,'utf8').trim().split(/\r?\n/).filter(Boolean).slice(-Math.max(1,Math.min(500,limit))).reverse().map(JSON.parse);
}
