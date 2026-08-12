import { readCapabilityConsumers } from './dependency-baseline.mjs';
import { SkillRegistry } from '../skills/registry.mjs';
import { readActiveSkillConfig } from '../skills/configuration.mjs';
import { capabilityMetadata, readCapabilityCatalog } from './capability-catalog.mjs';

const unique=(items)=>[...new Set(items)];
const capabilityNodeId=(id)=>`capability:${id}`;
const consumerNodeId=(type,id)=>`consumer:${type}:${id}`;
const implementationNodeId=(type,id)=>`implementation:${type}:${id}`;

function capabilityStatus(implementations,consumers){
  const ready=implementations.filter((item)=>item.available);
  if(!consumers.length)return 'unused';
  if(!ready.length)return 'blocked';
  if(ready.length===1||implementations.some((item)=>item.enabled&&!item.configured))return 'degraded';
  return 'ready';
}

export function buildCapabilityGraph({root,tools=[],collectors=[],collectionSources=[],routes={},configurationState=()=>({configured:true})}){
  const catalog=readCapabilityCatalog(root),skillItems=new SkillRegistry({workspaceRoot:root}).list(),features=readCapabilityConsumers(root);
  const consumers=[],implementations=[];
  for(const skill of skillItems){
    const active=readActiveSkillConfig(root,skill.id),authorization=active?.allowedTools?.length?[...active.allowedTools]:null;
    consumers.push({id:skill.id,name:skill.name,type:'skill',enabled:skill.enabled!==false,authorization,dependencies:[
      ...(skill.requiredCapabilities||[]).map((capability)=>({capability,requirement:'required',failurePolicy:'block',source:'skill-manifest'})),
      ...(skill.optionalCapabilities||[]).map((capability)=>({capability,requirement:'optional',failurePolicy:'continue-with-warning',source:'skill-manifest'})),
    ]});
  }
  for(const feature of features)consumers.push({...feature,enabled:true,dependencies:(feature.dependencies||[]).map((item)=>({...item,source:'feature-manifest'}))});
  for(const source of collectionSources.filter((item)=>item.enabled!==false))consumers.push({id:String(source.id),name:source.label||source.source_key,type:'collection-source',enabled:true,dependencies:[{capability:`collect.${source.source_type}`,requirement:'required',failurePolicy:'block',source:'collection-source'}]});
  for(const tool of tools){const state=tool.configuration?configurationState('tool',tool.id,tool):{configured:true};for(const capability of tool.capabilities||[])implementations.push({id:tool.id,name:tool.name||tool.id,type:'tool',capability,version:tool.version||'',enabled:tool.enabled!==false,configured:state.configured!==false,available:tool.enabled!==false&&state.configured!==false,priority:Number(tool.priority)||0,riskLevel:tool.riskLevel||'read-only'});}
  for(const collector of collectors){const state=collector.configuration?configurationState('collector',collector.id,collector):{configured:true};for(const capability of collector.capabilities||[])implementations.push({id:collector.id,name:collector.name||collector.id,type:'collector',capability,version:collector.version||'',enabled:collector.enabled!==false,configured:state.configured!==false,available:collector.available!==false&&collector.enabled!==false&&state.configured!==false,priority:Number(collector.priority)||0,riskLevel:collector.riskLevel||'network-read'});}
  const capabilityIds=unique([...Object.keys(catalog.capabilities),...consumers.flatMap((item)=>item.dependencies.map((edge)=>edge.capability)),...implementations.map((item)=>item.capability)]).sort();
  const capabilities=capabilityIds.map((id)=>{const metadata=capabilityMetadata(catalog,id),capabilityConsumers=consumers.flatMap((consumer)=>consumer.dependencies.filter((edge)=>edge.capability===id).map((edge)=>({consumerId:consumer.id,consumerType:consumer.type,consumerName:consumer.name,enabled:consumer.enabled,...edge})));const preferredImplementationId=routes[id]?.preferredImplementationId||'';const candidates=implementations.filter((item)=>item.capability===id).sort((a,b)=>Number(b.id===preferredImplementationId)-Number(a.id===preferredImplementationId)||b.priority-a.priority||a.id.localeCompare(b.id));return {...metadata,status:capabilityStatus(candidates,capabilityConsumers.filter((item)=>item.enabled)),preferredImplementationId,consumers:capabilityConsumers,implementations:candidates};});
  const nodes=[...consumers.map((item)=>({id:consumerNodeId(item.type,item.id),kind:'consumer',refId:item.id,subtype:item.type,name:item.name,enabled:item.enabled})),...capabilities.map((item)=>({id:capabilityNodeId(item.id),kind:'capability',refId:item.id,name:item.name,description:item.description,category:item.category,status:item.status})),...unique(implementations.map((item)=>`${item.type}:${item.id}`)).map((key)=>{const [type,...idParts]=key.split(':'),id=idParts.join(':'),item=implementations.find((entry)=>entry.type===type&&entry.id===id);return {id:implementationNodeId(type,id),kind:'implementation',refId:id,subtype:type,name:item.name,enabled:item.enabled,available:item.available};})];
  const edges=[...consumers.flatMap((consumer)=>consumer.dependencies.map((dependency)=>({from:consumerNodeId(consumer.type,consumer.id),to:capabilityNodeId(dependency.capability),relation:'depends-on',requirement:dependency.requirement,failurePolicy:dependency.failurePolicy,source:dependency.source}))),...implementations.map((item)=>({from:capabilityNodeId(item.capability),to:implementationNodeId(item.type,item.id),relation:'implemented-by',priority:item.priority,available:item.available}))];
  return {schemaVersion:1,aggregationOrder:['catalog','consumers','implementations','routes'],summary:{consumers:consumers.length,capabilities:capabilities.length,implementations:unique(implementations.map((item)=>`${item.type}:${item.id}`)).length,ready:capabilities.filter((item)=>item.status==='ready').length,degraded:capabilities.filter((item)=>item.status==='degraded').length,blocked:capabilities.filter((item)=>item.status==='blocked').length,unregistered:capabilities.filter((item)=>!item.registered).length},capabilities,consumers,implementations,nodes,edges};
}

export function analyzeImplementationImpact(graph,{type,id}){
  const directlyAffected=graph.capabilities.filter((capability)=>capability.implementations.some((item)=>item.type===type&&item.id===id)).map((capability)=>{
    const remaining=capability.implementations.filter((item)=>!(item.type===type&&item.id===id)&&item.available),enabledConsumers=capability.consumers.filter((item)=>item.enabled),requiredConsumers=enabledConsumers.filter((item)=>item.requirement==='required');
    return {capability:capability.id,currentStatus:capability.status,nextStatus:capabilityStatus(remaining,enabledConsumers),remainingImplementations:remaining.map((item)=>({type:item.type,id:item.id,name:item.name,priority:item.priority})),consumers:enabledConsumers,wouldBlock:remaining.length===0&&requiredConsumers.length>0,wouldDegrade:remaining.length>0&&(remaining.length===1||capability.status==='ready')};
  });
  return {schemaVersion:1,implementation:{type,id},exists:directlyAffected.length>0,canDisable:!directlyAffected.some((item)=>item.wouldBlock),blocking:directlyAffected.filter((item)=>item.wouldBlock),degraded:directlyAffected.filter((item)=>!item.wouldBlock&&item.wouldDegrade),unaffected:directlyAffected.filter((item)=>!item.wouldBlock&&!item.wouldDegrade),capabilities:directlyAffected};
}
