import { SkillRegistry } from '../skills/registry.mjs';
import { getToolRegistry } from '../tools/index.mjs';
import { readToolPluginCatalog } from '../tools/package-manager.mjs';
import { readRemotePluginCatalog } from '../tools/remote-package-manager.mjs';
import { readCollectorPluginCatalog } from '../collectors/package-manager.mjs';
import { BUILTIN_COLLECTOR_MANIFESTS } from '../collectors/builtin-registry.mjs';
import { modelProviderManifest } from './model-provider-configuration.mjs';

const object=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});
const string=(title,extra={})=>({type:'string',title,...extra});
const integer=(title,minimum,maximum,extra={})=>({type:'integer',title,minimum,maximum,...extra});

function systemResources(){return [{id:'workbench',name:'工作台系统参数',type:'system',kind:'system',manifest:{id:'workbench',name:'工作台系统参数',configuration:object({port:integer('监听端口',1,65535,{default:4317}),python:string('Python 可执行文件'),maxConcurrent:integer('AI 后台任务并发',1,20,{default:2}),minVisibleChars:integer('文章最少可见字符',100,20000,{default:1300}),maxVisibleChars:integer('文章最多可见字符',100,30000,{default:2000}),discussionResearchTopK:integer('讨论研判 Top-K',5,10,{default:8,enum:[5,8,10],enumNames:['Top 5','Top 8','Top 10']})})}}];}

function modelResources(config){return Object.entries(config.llm?.providers||{}).map(([id,provider])=>({id,name:provider.label||id,type:'model-provider',kind:'model-provider',manifest:modelProviderManifest(id,provider,config.llm.defaultProvider===id)}));}

export async function buildConfigurationCatalog({root,config}){
  const skills=new SkillRegistry({workspaceRoot:root}).list().filter((manifest)=>manifest.configuration).map((manifest)=>({id:manifest.id,name:manifest.name,type:'skill',kind:manifest.kind,manifest}));
  const registry=await getToolRegistry(),local=readToolPluginCatalog(root),remote=readRemotePluginCatalog(root);
  const toolManifests=new Map([...registry.listPlugins(),...Object.values(local.plugins).filter((item)=>item.status!=='uninstalled').map((item)=>item.manifest),...Object.values(remote.plugins).filter((item)=>item.status!=='uninstalled').map((item)=>item.manifest)].filter((manifest)=>manifest.configuration).map((manifest)=>[manifest.id,manifest]));
  const tools=[...toolManifests.values()].map((manifest)=>({id:manifest.id,name:manifest.name||manifest.id,type:'tool',kind:'tool',manifest}));
  const installedCollectors=Object.values(readCollectorPluginCatalog(root).plugins).filter((item)=>item.status!=='uninstalled'&&item.manifest.configuration).map((item)=>item.manifest);const collectorManifests=new Map([...BUILTIN_COLLECTOR_MANIFESTS,...installedCollectors].filter((manifest)=>manifest.configuration).map((manifest)=>[manifest.id,manifest]));const collectors=[...collectorManifests.values()].map((manifest)=>({id:manifest.id,name:manifest.name,type:'collector',kind:manifest.type||manifest.kind,manifest}));
  return [...systemResources(),...modelResources(config),...skills,...tools,...collectors].sort((a,b)=>a.type.localeCompare(b.type)||a.name.localeCompare(b.name));
}

export function findConfigurationResource(items,type,id){return items.find((item)=>item.type===type&&item.id===id)||null;}
