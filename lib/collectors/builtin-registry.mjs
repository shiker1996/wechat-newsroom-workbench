import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectorFailure, validateCollectorManifest } from './contracts.mjs';
import { CollectorRegistry } from './registry.mjs';

const pluginRoot=path.resolve(import.meta.dirname,'../../plugins/collectors');
const pending=(id)=>({collect:async()=>collectorFailure('DEPENDENCY_MISSING',`${id} 尚未加载执行入口`,{action:'检查 Collector 插件入口'})});

export function discoverBuiltinCollectorManifests(root=pluginRoot){
  const manifests=[];
  for(const entry of fs.readdirSync(root,{withFileTypes:true}).filter((item)=>item.isDirectory()&&!item.name.startsWith('_')).sort((a,b)=>a.name.localeCompare(b.name))){
    const directory=path.join(root,entry.name),file=path.join(directory,'manifest.json');
    if(!fs.existsSync(file))continue;
    const manifest=JSON.parse(fs.readFileSync(file,'utf8')),issues=validateCollectorManifest(manifest);
    if(issues.length)throw new Error(`内置 Collector Manifest 无效：${entry.name}/${issues[0].field} ${issues[0].message}`);
    const adapterFile=path.resolve(directory,manifest.entry||'');
    if(!adapterFile.startsWith(`${directory}${path.sep}`)||!fs.existsSync(adapterFile))throw new Error(`内置 Collector 入口无效：${manifest.id}`);
    manifests.push(Object.freeze({...manifest,__directory:directory,__adapterFile:adapterFile}));
  }
  return manifests;
}

export const BUILTIN_COLLECTOR_MANIFESTS=Object.freeze(discoverBuiltinCollectorManifests().map(({__directory,__adapterFile,...manifest})=>Object.freeze(manifest)));

export function createBuiltinCollectorRegistry(adapters={},settings={}){const registry=new CollectorRegistry({settings});for(const manifest of BUILTIN_COLLECTOR_MANIFESTS)registry.register({manifest,adapter:adapters[manifest.id]||pending(manifest.id)});return registry;}

export async function loadBuiltinCollectorPlugins(context={}){
  const plugins=[];
  for(const item of discoverBuiltinCollectorManifests()){
    const {__directory,__adapterFile,...manifest}=item,module=await import(pathToFileURL(__adapterFile).href);
    if(typeof module.createAdapter!=='function')throw new Error(`内置 Collector 缺少 createAdapter：${manifest.id}`);
    plugins.push({manifest,adapter:await module.createAdapter({...context,configuration:context.collectorConfigurations?.[manifest.id]||{}})});
  }
  return plugins;
}
