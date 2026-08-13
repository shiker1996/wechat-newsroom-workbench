import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from '../version.mjs';
import { validateConfigurationSchema } from '../extensions/configuration-schema.mjs';
import { scanPluginPackageBoundaryIssues } from '../plugins/boundary-audit.mjs';

const MAX_FILES=100;
const MAX_BYTES=10_000_000;
const ALLOWED_EXTENSIONS=new Set(['.mjs','.json','.md','.txt','.py','.ps1']);
const SOURCE_TYPES=new Set(['trusted-repository','reviewed-package']);
const RISK_LEVELS=new Set(['read-only','local-write','network-read','external-write']);
const ALLOWED_RUNTIME_DEPENDENCIES=new Set(['puppeteer','@aws-sdk/client-s3']);

function locations(root){
  return {
    installed:path.join(root,'data','installed-tool-plugins'),
    archive:path.join(root,'data','tool-plugin-archive'),
    catalog:path.join(root,'data','tool-plugins.json'),
    events:path.join(root,'data','tool-plugin-install-events.jsonl'),
  };
}

function inside(candidate,root){
  const relative=path.relative(path.resolve(root),path.resolve(candidate));
  return relative===''||(!relative.startsWith('..')&&!path.isAbsolute(relative));
}

function atomicJson(filePath,value){
  fs.mkdirSync(path.dirname(filePath),{recursive:true});
  const temporary=`${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary,`${JSON.stringify(value,null,2)}\n`,'utf8');
  fs.renameSync(temporary,filePath);
}

export function readToolPluginCatalog(root){
  if(!fs.existsSync(locations(root).catalog))return {schemaVersion:1,plugins:{}};
  const value=JSON.parse(fs.readFileSync(locations(root).catalog,'utf8'));
  if(value.schemaVersion!==1||!value.plugins)throw new Error('工具插件安装清单无效');
  return value;
}

// A restart request is an edge-triggered state: once a new process has applied
// the catalog entry, it must not remain visible forever. Changes made after the
// current process started are deliberately left pending for the next restart.
export function acknowledgeToolPluginRestarts(root,{pluginIds=[],processStartedAt=Date.now()}={}){
  const catalog=readToolPluginCatalog(root),allowed=new Set(pluginIds);
  let changed=false;
  for(const item of Object.values(catalog.plugins)){
    if(!allowed.has(item.id)||!item.restartRequired)continue;
    const changedAt=Date.parse(item.updatedAt||item.installedAt||'');
    if(!Number.isFinite(changedAt)||changedAt>processStartedAt)continue;
    item.restartRequired=false;
    changed=true;
  }
  if(changed)atomicJson(locations(root).catalog,catalog);
  return changed;
}

function event(root,input){
  const filePath=locations(root).events;
  fs.mkdirSync(path.dirname(filePath),{recursive:true});
  fs.appendFileSync(filePath,`${JSON.stringify({createdAt:new Date().toISOString(),...input})}\n`,'utf8');
}

function tuple(value){
  const match=String(value).match(/(\d+)\.(\d+)\.(\d+)/);
  return match?match.slice(1).map(Number):null;
}

function compatible(range){
  const current=tuple(APP_VERSION),minimum=tuple(range);
  if(!current||!minimum)return false;
  for(let index=0;index<3;index+=1){
    if(current[index]>minimum[index])return true;
    if(current[index]<minimum[index])return false;
  }
  return true;
}

function filesIn(directory){
  const files=[];
  function visit(current){
    for(const entry of fs.readdirSync(current,{withFileTypes:true})){
      const filePath=path.join(current,entry.name);
      if(entry.isSymbolicLink())throw new Error(`插件包禁止符号链接：${path.relative(directory,filePath)}`);
      if(entry.isDirectory())visit(filePath);
      else if(entry.isFile())files.push(filePath);
      else throw new Error(`插件包包含不支持的文件：${entry.name}`);
    }
  }
  visit(directory);return files;
}

function validateManifest(manifest,directory){
  const required=['schemaVersion','id','name','version','type','capabilities','entry','riskLevel','inputSchema','outputSchema','source','compatibleApp','permissions'];
  const missing=required.filter((key)=>manifest[key]===undefined);
  if(missing.length)throw new Error(`插件 manifest 缺少字段：${missing.join(', ')}`);
  if(manifest.schemaVersion!==1||manifest.type!=='local-adapter')throw new Error('P3 只接受 schemaVersion 1 的 local-adapter');
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version))throw new Error('插件 ID 或版本无效');
  if(!Array.isArray(manifest.capabilities)||!manifest.capabilities.length||manifest.capabilities.some((item)=>typeof item!=='string'||!item.trim())||new Set(manifest.capabilities).size!==manifest.capabilities.length)throw new Error('插件 capabilities 无效');
  for(const field of ['requiredCapabilities','optionalCapabilities']){const values=manifest[field]||[];if(!Array.isArray(values)||values.some((item)=>typeof item!=='string'||!item.trim())||new Set(values).size!==values.length)throw new Error(`插件 ${field} 无效`);}
  if((manifest.requiredCapabilities||[]).some((item)=>(manifest.optionalCapabilities||[]).includes(item)))throw new Error('插件能力依赖不能同时声明为必需和可选');
  if(!RISK_LEVELS.has(manifest.riskLevel)||manifest.inputSchema?.type!=='object'||manifest.outputSchema?.type!=='object')throw new Error('插件风险等级或契约无效');
  if(!SOURCE_TYPES.has(manifest.source?.type)||!String(manifest.source?.url||'').trim())throw new Error('插件必须声明受信来源 URL');
  if(!compatible(manifest.compatibleApp))throw new Error(`插件需要 ${manifest.compatibleApp}，当前工作台为 ${APP_VERSION}`);
  const permissions=manifest.permissions;
  for(const key of ['networkDomains','pathAccess','credentials'])if(!Array.isArray(permissions[key]))throw new Error(`permissions.${key} 必须是数组`);
  if(typeof permissions.externalWrite!=='boolean')throw new Error('permissions.externalWrite 必须是布尔值');
  if(manifest.riskLevel==='external-write'&&!permissions.externalWrite)throw new Error('外部写入插件必须声明 externalWrite 权限');
  const configurationIssues=manifest.configuration?validateConfigurationSchema(manifest.configuration):[];
  if(configurationIssues.length)throw new Error(`插件 configuration 无效：${configurationIssues[0].message}`);
  const entry=path.resolve(directory,manifest.entry);
  if(!inside(entry,directory)||path.extname(entry)!=='.mjs'||!fs.existsSync(entry))throw new Error('插件 entry 必须指向包内 .mjs 文件');
}

function validateImports(directory,files){
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8')),declared=new Set(manifest.runtimeDependencies||[]);
  if([...declared].some((item)=>!ALLOWED_RUNTIME_DEPENDENCIES.has(item)))throw new Error('插件声明了宿主未授权的 runtimeDependencies');
  for(const filePath of files.filter((file)=>path.extname(file)==='.mjs')){
    const content=fs.readFileSync(filePath,'utf8');
    const imports=[
      ...content.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g),
      ...content.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
    ].map((match)=>match[1]);
    for(const specifier of imports){
      if(specifier.startsWith('node:'))continue;
      if(!specifier.startsWith('.')){const packageName=specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0];if(!declared.has(packageName))throw new Error(`本地 adapter 禁止未声明的包依赖：${specifier}`);continue;}
      const target=path.resolve(path.dirname(filePath),specifier);
      if(!inside(target,directory))throw new Error(`adapter import 超出插件包：${specifier}`);
      if(!fs.existsSync(target))throw new Error(`adapter import 不存在：${specifier}`);
    }
  }
}

export function validateToolPluginDirectory(directory){
  const root=fs.realpathSync.native(path.resolve(directory));
  if(!fs.statSync(root).isDirectory())throw new Error('插件包路径必须是目录');
  const files=filesIn(root);
  if(!files.length||files.length>MAX_FILES)throw new Error(`插件包文件数必须为 1–${MAX_FILES}`);
  let totalBytes=0;
  for(const filePath of files){
    const relative=path.relative(root,filePath).replaceAll('\\','/');
    if(!inside(filePath,root)||!ALLOWED_EXTENSIONS.has(path.extname(filePath).toLowerCase()))throw new Error(`插件包包含不允许的文件：${relative}`);
    totalBytes+=fs.statSync(filePath).size;
  }
  if(totalBytes>MAX_BYTES)throw new Error(`插件包不能超过 ${MAX_BYTES} 字节`);
  const manifestPath=path.join(root,'manifest.json');
  if(!fs.existsSync(manifestPath))throw new Error('插件包缺少 manifest.json');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  validateManifest(manifest,root);
  validateImports(root,files);
  const boundaryIssues=scanPluginPackageBoundaryIssues(root,{runtimeDependencies:manifest.runtimeDependencies||[]});
  if(boundaryIssues.length)throw new Error(`插件包边界无效：${boundaryIssues[0]}`);
  const digest=crypto.createHash('sha256');
  for(const filePath of [...files].sort()){
    digest.update(path.relative(root,filePath).replaceAll('\\','/'));
    digest.update(fs.readFileSync(filePath));
  }
  return {directory:root,manifest,files:files.map((file)=>path.relative(root,file).replaceAll('\\','/')),totalBytes,contentHash:`sha256:${digest.digest('hex')}`};
}

function copyPackage(source,target,files){
  fs.mkdirSync(target,{recursive:true});
  for(const relative of files){
    const destination=path.join(target,relative);
    fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.copyFileSync(path.join(source,relative),destination);
  }
}

export function installToolPlugin({workspaceRoot,directory,builtinIds=[]}){
  let staging=null,target=null,archived=null,identity={pluginId:'',version:''};
  try{
    const checked=validateToolPluginDirectory(directory);
    const {id,version}=checked.manifest;identity={pluginId:id,version};
    if(builtinIds.includes(id)||fs.existsSync(path.join(workspaceRoot,'plugins',id)))throw new Error(`插件 ID 与内置插件冲突：${id}`);
    const paths=locations(workspaceRoot),catalog=readToolPluginCatalog(workspaceRoot),previous=catalog.plugins[id]||null;
    target=path.join(paths.installed,id);
    if(previous?.version===version&&previous.contentHash===checked.contentHash&&previous.status!=='uninstalled')return {...previous,reused:true,restartRequired:true};
    fs.mkdirSync(paths.installed,{recursive:true});
    staging=fs.mkdtempSync(path.join(paths.installed,`.install-${id}-`));
    copyPackage(checked.directory,staging,checked.files);
    if(fs.existsSync(target)){
      const archiveName=previous?.version||`unknown-${Date.now()}`;
      archived=path.join(paths.archive,id,archiveName);
      if(fs.existsSync(archived))archived=path.join(paths.archive,id,`${archiveName}-${String(previous?.contentHash||Date.now()).replace(/[^a-z0-9]/gi,'').slice(-12)}`);
      if(fs.existsSync(archived))throw new Error('相同插件历史归档已存在');
      fs.mkdirSync(path.dirname(archived),{recursive:true});fs.renameSync(target,archived);
    }
    fs.renameSync(staging,target);staging=null;
    const installed={id,version,name:checked.manifest.name,status:'disabled',installPath:path.relative(workspaceRoot,target).replaceAll('\\','/'),
      contentHash:checked.contentHash,manifest:checked.manifest,installedAt:new Date().toISOString(),restartRequired:true};
    catalog.plugins[id]=installed;atomicJson(paths.catalog,catalog);
    event(workspaceRoot,{...identity,action:previous?'update':'install',result:'ok',contentHash:checked.contentHash});
    return installed;
  }catch(error){
    if(target&&archived&&!fs.existsSync(target)&&fs.existsSync(archived))fs.renameSync(archived,target);
    event(workspaceRoot,{...identity,action:'install',result:'error',error:error.message});throw error;
  }finally{if(staging&&fs.existsSync(staging))fs.rmSync(staging,{recursive:true,force:true});}
}

export function setInstalledToolPluginStatus(root,id,status){
  if(!['enabled','disabled'].includes(status))throw new Error('插件状态无效');
  const catalog=readToolPluginCatalog(root),item=catalog.plugins[id];
  if(!item||item.status==='uninstalled')throw new Error('第三方插件不存在');
  item.status=status;item.updatedAt=new Date().toISOString();item.restartRequired=true;
  atomicJson(locations(root).catalog,catalog);event(root,{pluginId:id,version:item.version,action:status,result:'ok'});
  return item;
}

export function uninstallToolPlugin(root,id){
  const catalog=readToolPluginCatalog(root),item=catalog.plugins[id];
  if(!item||item.status==='uninstalled')throw new Error('第三方插件不存在');
  item.status='uninstalled';item.updatedAt=new Date().toISOString();item.restartRequired=true;
  atomicJson(locations(root).catalog,catalog);event(root,{pluginId:id,version:item.version,action:'uninstall',result:'ok'});
  return item;
}

export function rollbackToolPlugin(root,id,version){
  const paths=locations(root),catalog=readToolPluginCatalog(root),item=catalog.plugins[id];
  if(!item||item.status==='uninstalled')throw new Error('第三方插件不存在');
  const archived=path.join(paths.archive,id,version);
  if(!fs.existsSync(archived))throw new Error(`归档版本不存在：${version}`);
  const checked=validateToolPluginDirectory(archived);
  if(checked.manifest.id!==id)throw new Error('归档插件 ID 不匹配');
  const current=path.join(paths.installed,id),currentArchive=path.join(paths.archive,id,item.version);
  if(fs.existsSync(currentArchive))throw new Error(`当前版本归档已存在：${item.version}`);
  fs.renameSync(current,currentArchive);
  try{fs.renameSync(archived,current);}
  catch(error){fs.renameSync(currentArchive,current);throw error;}
  item.version=checked.manifest.version;item.manifest=checked.manifest;item.contentHash=checked.contentHash;
  item.status='disabled';item.updatedAt=new Date().toISOString();item.restartRequired=true;
  atomicJson(paths.catalog,catalog);event(root,{pluginId:id,version:item.version,action:'rollback',result:'ok'});
  return item;
}

export function listToolPluginVersions(root,id){
  const directory=path.join(locations(root).archive,id);
  if(!fs.existsSync(directory))return [];
  return fs.readdirSync(directory,{withFileTypes:true}).filter((entry)=>entry.isDirectory()).map((entry)=>entry.name).sort().reverse();
}

export function listToolPluginInstallEvents(root,limit=100){
  const filePath=locations(root).events;
  if(!fs.existsSync(filePath))return [];
  return fs.readFileSync(filePath,'utf8').trim().split(/\r?\n/).filter(Boolean).slice(-Math.max(1,Math.min(500,limit))).reverse().map(JSON.parse);
}

export function installedToolPluginsRoot(root){return locations(root).installed;}
