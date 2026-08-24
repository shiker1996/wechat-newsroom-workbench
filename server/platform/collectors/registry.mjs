import { validateCollectorManifest } from './contracts.mjs';

export class CollectorRegistry{
  #plugins=new Map();
  #settings={};
  constructor({settings={}}={}){this.#settings=settings;}
  #state(manifest){const value=this.#settings[manifest.id]||{};return {enabled:value.enabled!==false,priority:Number(value.priority)||0};}
  register(plugin){
    const issues=validateCollectorManifest(plugin?.manifest);if(issues.length)throw new Error(`采集器 Manifest 无效：${issues[0].field} ${issues[0].message}`);
    if(!plugin.adapter||typeof plugin.adapter.collect!=='function')throw new Error('采集器 adapter 必须实现 collect');
    if(this.#plugins.has(plugin.manifest.id))throw new Error(`采集器重复注册：${plugin.manifest.id}`);
    this.#plugins.set(plugin.manifest.id,plugin);return this;
  }
  get(id){const plugin=this.#plugins.get(id);return plugin&&this.#state(plugin.manifest).enabled?plugin:null;}
  getManifest(id){return this.#plugins.get(id)?.manifest||null;}
  list(){return [...this.#plugins.values()].map(({manifest})=>({...manifest,...this.#state(manifest)})).sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));}
  resolveSourceType(sourceType){return [...this.#plugins.values()].filter(({manifest})=>manifest.collector.sourceTypes.includes(sourceType)&&this.#state(manifest).enabled).sort((a,b)=>this.#state(b.manifest).priority-this.#state(a.manifest).priority||a.manifest.id.localeCompare(b.manifest.id))[0]||null;}
  resolveSourceTypeCandidates(sourceType){return [...this.#plugins.values()].filter(({manifest})=>manifest.collector.sourceTypes.includes(sourceType)&&this.#state(manifest).enabled).sort((a,b)=>this.#state(b.manifest).priority-this.#state(a.manifest).priority||a.manifest.id.localeCompare(b.manifest.id));}
}

export function registerCollectorPlugins(registry,plugins=[]){for(const plugin of plugins)registry.register(plugin);return registry;}
