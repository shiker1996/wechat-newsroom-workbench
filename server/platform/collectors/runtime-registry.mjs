import { BUILTIN_COLLECTOR_MANIFESTS, loadBuiltinCollectorPlugins } from './builtin-registry.mjs';
import { CollectorRegistry } from './registry.mjs';
import { loadInstalledCollectorPlugins, readCollectorPluginCatalog } from './package-manager.mjs';
import { registerCollectorPlugins } from './registry.mjs';
import { readCollectorToolSettings } from './settings.mjs';

export async function createCollectorRuntime({root,config,onProgress=()=>{},githubQueries=[],dependencies={},configurationResolver=null}={}){
  const collectorConfigurations={};if(configurationResolver)for(const manifest of BUILTIN_COLLECTOR_MANIFESTS.filter((item)=>item.configuration)){const state=configurationResolver(manifest);if(state?.configured)collectorConfigurations[manifest.id]=state.values;}
  const settings=readCollectorToolSettings(root),registry=new CollectorRegistry({settings});registerCollectorPlugins(registry,await loadBuiltinCollectorPlugins({config,onProgress,githubQueries,collectorConfigurations,pageDependencies:dependencies.pageDependencies||{}}));
  const plugins=await loadInstalledCollectorPlugins(root,dependencies);
  for(const plugin of plugins)if(plugin.manifest.configuration&&configurationResolver){const resolved=configurationResolver(plugin.manifest);if(!resolved.configured)continue;const collect=plugin.adapter.collect,test=plugin.adapter.test;plugin.adapter={...plugin.adapter,collect:(source,context)=>collect({...resolved.values,...source},context),...(test?{test:(source,context)=>test({...resolved.values,...source},context)}:{})};}
  return registerCollectorPlugins(registry,plugins);
}
export function listCollectorPluginStates(root,builtinManifests=[]){const settings=readCollectorToolSettings(root);const decorate=(item)=>{const state=settings[item.id]||{};return {...item,enabled:state.enabled!==false,priority:Number(state.priority)||0,available:item.available&&state.enabled!==false};};const builtin=builtinManifests.map((manifest)=>decorate({...manifest,builtin:true,status:'enabled',available:true,permissions:{networkDomains:[],pathAccess:[],externalWrite:false,credentials:[]},sourceCount:0}));const installed=Object.values(readCollectorPluginCatalog(root).plugins).filter((item)=>item.status!=='uninstalled').map((item)=>decorate({...item.manifest,builtin:false,status:item.status,available:item.status==='enabled',firstRunConfirmedAt:item.firstRunConfirmedAt||'',permissions:item.manifest.permissions,contentHash:item.contentHash}));return [...builtin,...installed].sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));}
