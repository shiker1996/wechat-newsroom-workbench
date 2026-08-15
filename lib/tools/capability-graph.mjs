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

// 阶段 2（设计文档 §5）：消费者—能力关系的运行可用状态。
// available = consumerDeclared && adapterReady && skillAllowed && implementationEnabled && implementationHealthy
// 请求级 callableForRequest（resourcePresent/requestAuthorized/policyAllowed）属于运行时判定，本阶段不在这里建模。
// implementationHealthy：调用方传入 healthByCapability（Map<capability, verdict>，见 lib/tools/health-check.mjs）时
// 用真实健康检查覆盖代理判定；'unknown'（检查异常）回退代理（启用且凭据/配置就绪）并在 warnings 标注。
export const CONSUMER_CAPABILITY_REASON_CODES=Object.freeze([
  'CONSUMER_NOT_DECLARED','ADAPTER_MISSING','ADAPTER_DEGRADED','SKILL_NOT_ALLOWED',
  'NO_ENABLED_IMPLEMENTATION','IMPLEMENTATION_UNHEALTHY','HEALTH_CHECK_UNAVAILABLE',
]);
// 阻断性原因码的评估顺序即优先级；ADAPTER_DEGRADED 只降级不阻断
const BLOCKING_REASON_ORDER=['CONSUMER_NOT_DECLARED','ADAPTER_MISSING','SKILL_NOT_ALLOWED','NO_ENABLED_IMPLEMENTATION','IMPLEMENTATION_UNHEALTHY'];

// 技能授权：无活动配置或未设白名单（null）即放行；显式空数组 = 全部禁止（SKILL_NOT_ALLOWED）
function skillAllowedFor(root,consumer,capability){
  if(consumer.type==='skill')return consumer.authorization?consumer.authorization.includes(capability):true;
  if(consumer.type==='agent'){
    const skillIds=consumer.runtimeSkillIds||[];
    if(!skillIds.length)return true;
    // 消费者按任一运行时技能放行即视为授权（同一入口可能按模式选择不同技能）
    return skillIds.some((skillId)=>{
      const active=readActiveSkillConfig(root,skillId),whitelist=Array.isArray(active?.allowedTools)?active.allowedTools:null;
      return !whitelist||whitelist.includes(capability);
    });
  }
  return true;
}

function consumerCapabilityState(consumer,dependency,capabilityNode,skillAllowed,healthVerdict){
  const implementations=(capabilityNode?.implementations||[]).map((item)=>({
    type:item.type,id:item.id,name:item.name,enabled:item.enabled,configured:item.configured,available:item.available,priority:item.priority,
  }));
  const enabled=implementations.filter((item)=>item.enabled);
  const adapterStatus=dependency.adapterStatus||'ready';
  const reasons=[];
  if(adapterStatus==='missing')reasons.push('ADAPTER_MISSING');
  if(skillAllowed===false)reasons.push('SKILL_NOT_ALLOWED');
  // 真实健康判定：'unhealthy' 覆盖代理为不健康；'unknown'（检查异常）回退代理并标注
  let healthy=enabled.filter((item)=>item.available);
  const warnings=adapterStatus==='degraded'?['ADAPTER_DEGRADED']:[];
  if(healthVerdict==='unhealthy')healthy=[];
  else if(healthVerdict==='unknown')warnings.push('HEALTH_CHECK_UNAVAILABLE');
  if(!enabled.length)reasons.push('NO_ENABLED_IMPLEMENTATION');
  else if(!healthy.length)reasons.push('IMPLEMENTATION_UNHEALTHY');
  const available=!reasons.length;
  const status=!available?'blocked':(warnings.length||healthy.length===1||enabled.some((item)=>!item.configured))?'degraded':'ready';
  return {
    consumerId:consumer.id,consumerType:consumer.type,consumerName:consumer.name,
    capability:dependency.capability,capabilityName:capabilityNode?.name||dependency.capability,
    declared:true,declaration:dependency.declaration||dependency.requirement||'optional',
    requirement:dependency.requirement,failurePolicy:dependency.failurePolicy,
    adapterStatus,resourceKinds:dependency.resourceKinds||[],triggerPolicy:dependency.triggerPolicy||'',
    authorizationAction:dependency.authorizationAction??null,resultPolicy:dependency.resultPolicy||'',
    skillAllowed:skillAllowed!==false,
    implementationStatus:!implementations.length?'none':!enabled.length?'no-enabled-implementation':!healthy.length?'unhealthy':'healthy',
    available,status,reasons,warnings,implementations,
  };
}

// 已知的"工具存在、消费者未适配"缺口（config 中消费者级 gaps 登记）
function consumerGapState(consumer,gap,capabilityNode){
  const implementations=(capabilityNode?.implementations||[]).map((item)=>({
    type:item.type,id:item.id,name:item.name,enabled:item.enabled,configured:item.configured,available:item.available,priority:item.priority,
  }));
  return {
    consumerId:consumer.id,consumerType:consumer.type,consumerName:consumer.name,
    capability:gap.capability,capabilityName:capabilityNode?.name||gap.capability,
    declared:false,declaration:'not-declared',requirement:'optional',failurePolicy:'continue-with-warning',
    adapterStatus:'missing',resourceKinds:[],triggerPolicy:'',authorizationAction:null,resultPolicy:'',
    skillAllowed:false,
    implementationStatus:implementations.some((item)=>item.available)?'healthy':implementations.some((item)=>item.enabled)?'unhealthy':implementations.length?'no-enabled-implementation':'none',
    available:false,status:'blocked',reasons:['CONSUMER_NOT_DECLARED','ADAPTER_MISSING'],warnings:[],
    gapReason:gap.reason||'',implementations,
  };
}


export function buildCapabilityGraph({root,tools=[],collectors=[],collectionSources=[],routes={},configurationState=()=>({configured:true}),healthByCapability=null}){
  const healthOf=healthByCapability?(id)=>healthByCapability instanceof Map?healthByCapability.get(id):healthByCapability[id]:()=>undefined;
  const catalog=readCapabilityCatalog(root),skillItems=new SkillRegistry({workspaceRoot:root}).list(),features=readCapabilityConsumers(root);
  const consumers=[],implementations=[];
  for(const skill of skillItems){
    const active=readActiveSkillConfig(root,skill.id),authorization=Array.isArray(active?.allowedTools)?[...active.allowedTools]:null;
    consumers.push({id:skill.id,name:skill.name,type:'skill',enabled:skill.enabled!==false,authorization,dependencies:[
      ...(skill.requiredCapabilities||[]).map((capability)=>({capability,requirement:'required',failurePolicy:'block',source:'skill-manifest'})),
      ...(skill.optionalCapabilities||[]).map((capability)=>({capability,requirement:'optional',failurePolicy:'continue-with-warning',source:'skill-manifest'})),
    ]});
  }
  for(const feature of features)consumers.push({...feature,enabled:true,dependencies:(feature.dependencies||[]).map((item)=>({...item,source:item.source||`${feature.type||'feature'}-manifest`}))});
  for(const source of collectionSources.filter((item)=>item.enabled!==false))consumers.push({id:String(source.id),name:source.label||source.source_key,type:'collection-source',enabled:true,dependencies:[{capability:`collect.${source.source_type}`,requirement:'required',failurePolicy:'block',source:'collection-source'}]});
  for(const tool of tools){const state=tool.configuration?configurationState('tool',tool.id,tool):{configured:true};for(const capability of tool.capabilities||[])implementations.push({id:tool.id,name:tool.name||tool.id,type:'tool',capability,version:tool.version||'',enabled:tool.enabled!==false,configured:state.configured!==false,available:tool.enabled!==false&&state.configured!==false,priority:Number(tool.priority)||0,riskLevel:tool.riskLevel||'read-only'});}
  for(const collector of collectors){const state=collector.configuration?configurationState('collector',collector.id,collector):{configured:true};for(const capability of collector.capabilities||[])implementations.push({id:collector.id,name:collector.name||collector.id,type:'collector',capability,version:collector.version||'',enabled:collector.enabled!==false,configured:state.configured!==false,available:collector.available!==false&&collector.enabled!==false&&state.configured!==false,priority:Number(collector.priority)||0,riskLevel:collector.riskLevel||'network-read'});}
  const capabilityIds=unique([...Object.keys(catalog.capabilities),...consumers.flatMap((item)=>item.dependencies.map((edge)=>edge.capability)),...implementations.map((item)=>item.capability)]).sort();
  const capabilities=capabilityIds.map((id)=>{const metadata=capabilityMetadata(catalog,id),capabilityConsumers=consumers.flatMap((consumer)=>consumer.dependencies.filter((edge)=>edge.capability===id).map((edge)=>({consumerId:consumer.id,consumerType:consumer.type,consumerName:consumer.name,enabled:consumer.enabled,...edge})));const preferredImplementationId=routes[id]?.preferredImplementationId||'';const candidates=implementations.filter((item)=>item.capability===id).sort((a,b)=>Number(b.id===preferredImplementationId)-Number(a.id===preferredImplementationId)||b.priority-a.priority||a.id.localeCompare(b.id));return {...metadata,status:capabilityStatus(candidates,capabilityConsumers.filter((item)=>item.enabled)),preferredImplementationId,consumers:capabilityConsumers,implementations:candidates};});
  const nodes=[...consumers.map((item)=>({id:consumerNodeId(item.type,item.id),kind:'consumer',refId:item.id,subtype:item.type,name:item.name,enabled:item.enabled})),...capabilities.map((item)=>({id:capabilityNodeId(item.id),kind:'capability',refId:item.id,name:item.name,description:item.description,category:item.category,status:item.status})),...unique(implementations.map((item)=>`${item.type}:${item.id}`)).map((key)=>{const [type,...idParts]=key.split(':'),id=idParts.join(':'),item=implementations.find((entry)=>entry.type===type&&entry.id===id);return {id:implementationNodeId(type,id),kind:'implementation',refId:id,subtype:type,name:item.name,enabled:item.enabled,available:item.available};})];
  const edges=[...consumers.flatMap((consumer)=>consumer.dependencies.map((dependency)=>({from:consumerNodeId(consumer.type,consumer.id),to:capabilityNodeId(dependency.capability),relation:'depends-on',requirement:dependency.requirement,failurePolicy:dependency.failurePolicy,source:dependency.source}))),...implementations.map((item)=>({from:capabilityNodeId(item.capability),to:implementationNodeId(item.type,item.id),relation:'implemented-by',priority:item.priority,available:item.available}))];
  // 阶段 2：消费者—能力关系可用状态（含已知缺口行），并把状态回填到能力的消费者条目上
  const capabilityById=new Map(capabilities.map((item)=>[item.id,item]));
  const consumerStates=consumers.flatMap((consumer)=>[
    ...(consumer.dependencies||[]).map((dependency)=>consumerCapabilityState(consumer,dependency,capabilityById.get(dependency.capability),skillAllowedFor(root,consumer,dependency.capability),healthOf(dependency.capability))),
    ...(consumer.gaps||[]).map((gap)=>consumerGapState(consumer,gap,capabilityById.get(gap.capability))),
  ]);
  const stateByRelation=new Map(consumerStates.map((state)=>[`${state.consumerId}::${state.capability}`,state]));
  for(const capability of capabilities)for(const consumerEntry of capability.consumers){
    const state=stateByRelation.get(`${consumerEntry.consumerId}::${capability.id}`);
    if(state)Object.assign(consumerEntry,{adapterStatus:state.adapterStatus,skillAllowed:state.skillAllowed,available:state.available,consumerStatus:state.status,reasons:state.reasons,warnings:state.warnings});
  }
  return {schemaVersion:1,aggregationOrder:['catalog','consumers','implementations','routes'],summary:{consumers:consumers.length,capabilities:capabilities.length,implementations:unique(implementations.map((item)=>`${item.type}:${item.id}`)).length,ready:capabilities.filter((item)=>item.status==='ready').length,degraded:capabilities.filter((item)=>item.status==='degraded').length,blocked:capabilities.filter((item)=>item.status==='blocked').length,unregistered:capabilities.filter((item)=>!item.registered).length,consumerRelations:{total:consumerStates.length,available:consumerStates.filter((item)=>item.available).length,degraded:consumerStates.filter((item)=>item.status==='degraded').length,blocked:consumerStates.filter((item)=>!item.available).length}},capabilities,consumers,consumerStates,implementations,nodes,edges};
}

export function analyzeImplementationImpact(graph,{type,id}){
  const directlyAffected=graph.capabilities.filter((capability)=>capability.implementations.some((item)=>item.type===type&&item.id===id)).map((capability)=>{
    const remaining=capability.implementations.filter((item)=>!(item.type===type&&item.id===id)&&item.available),enabledConsumers=capability.consumers.filter((item)=>item.enabled),requiredConsumers=enabledConsumers.filter((item)=>item.requirement==='required');
    // 消费者维度（阶段 2）：声明、适配与技能授权不受实现启停影响，剩余可用实现归零时当前可用消费者将失去可用性
    const consumers=enabledConsumers.map((consumer)=>({...consumer,currentlyAvailable:consumer.available??null,availableAfterDisable:Boolean(consumer.available)&&remaining.length>0}));
    return {capability:capability.id,name:capability.name||capability.id,currentStatus:capability.status,nextStatus:capabilityStatus(remaining,enabledConsumers),remainingImplementations:remaining.map((item)=>({type:item.type,id:item.id,name:item.name,priority:item.priority})),consumers,consumersLosingAvailability:consumers.filter((item)=>item.currentlyAvailable===true&&!item.availableAfterDisable).map((item)=>({consumerId:item.consumerId,consumerName:item.consumerName,consumerType:item.consumerType})),wouldBlock:remaining.length===0&&requiredConsumers.length>0,wouldDegrade:remaining.length>0&&(remaining.length===1||capability.status==='ready')};
  });
  return {schemaVersion:1,implementation:{type,id},exists:directlyAffected.length>0,canDisable:!directlyAffected.some((item)=>item.wouldBlock),blocking:directlyAffected.filter((item)=>item.wouldBlock),degraded:directlyAffected.filter((item)=>!item.wouldBlock&&item.wouldDegrade),unaffected:directlyAffected.filter((item)=>!item.wouldBlock&&!item.wouldDegrade),capabilities:directlyAffected};
}
