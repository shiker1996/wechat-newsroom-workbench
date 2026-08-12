import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPluginManifests } from './manifest-loader.mjs';
import { ToolRegistry } from './registry.mjs';
import { readToolPluginSettings } from './settings.mjs';
import { installedToolPluginsRoot, readToolPluginCatalog, validateToolPluginDirectory } from './package-manager.mjs';
import { readRemotePluginCatalog } from './remote-package-manager.mjs';
import { createRemoteAdapter } from './remote-adapter.mjs';
import { legacyToolConfiguration } from '../extensions/legacy-tool-configuration.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
function discoverPluginIds(directory){
  if(!fs.existsSync(directory))return [];
  return fs.readdirSync(directory,{withFileTypes:true})
    .filter((entry)=>entry.isDirectory()&&entry.name!=='shared'&&fs.existsSync(path.join(directory,entry.name,'manifest.json')))
    .map((entry)=>entry.name).sort();
}
export const BUILTIN_PLUGINS = Object.freeze(discoverPluginIds(path.join(root,'plugins')));
const phaseAOrder=['local-project-reader','mermaid-render','echarts-render'];
export const PHASE_A_PLUGINS = Object.freeze(BUILTIN_PLUGINS.filter((id)=>phaseAOrder.includes(id)).sort((left,right)=>phaseAOrder.indexOf(left)-phaseAOrder.indexOf(right)));
export const PHASE_B_PLUGINS = Object.freeze(BUILTIN_PLUGINS.filter((id)=>!PHASE_A_PLUGINS.includes(id)));

let registryPromise;
let configurationResolver=(manifest)=>({configured:true,status:'legacy_fallback',values:legacyToolConfiguration(manifest),snapshot:{extensionType:'tool',extensionId:manifest.id,status:'legacy_fallback',configured:true,schemaVersion:1}});
export function setToolConfigurationResolver(resolver){configurationResolver=typeof resolver==='function'?resolver:null;registryPromise=undefined;}
async function loadInstalledPlugins(){
  const installedRoot=installedToolPluginsRoot(root);
  const items=Object.values(readToolPluginCatalog(root).plugins).filter((item)=>item.status==='enabled');
  const loaded=[];
  for(const item of items){
    try{
      const checked=validateToolPluginDirectory(path.join(installedRoot,item.id));
      if(checked.contentHash!==item.contentHash)throw new Error('内容完整性与安装清单不一致');
      loaded.push(...await loadPluginManifests({pluginsRoot:installedRoot,allowlist:[item.id]}));
    }catch(error){
      console.warn(`[tool-plugin] 隔离 ${item.id}: ${error.message}`);
    }
  }
  return loaded;
}
function loadRemotePlugins(){
  return Object.values(readRemotePluginCatalog(root).plugins).filter((item)=>item.status==='enabled')
    .map((item)=>({manifest:Object.freeze(item.manifest),adapter:createRemoteAdapter({root,manifest:item.manifest})}));
}
export function getToolRegistry() {
  registryPromise ||= Promise.all([
    loadPluginManifests({ pluginsRoot:path.join(root, 'plugins'), allowlist:BUILTIN_PLUGINS }),
    loadInstalledPlugins(),
    Promise.resolve(loadRemotePlugins()),
  ]).then(([builtins,installed,remote]) => [...builtins,...installed,...remote].reduce((registry, plugin) => registry.register(plugin),
      new ToolRegistry({settings:readToolPluginSettings(root),configurationResolver})));
  return registryPromise;
}

export function reloadToolRegistry() {
  registryPromise=undefined;
  return getToolRegistry();
}
