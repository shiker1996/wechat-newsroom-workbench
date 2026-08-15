import { readActiveSkillConfig, describeActiveSkillConfig, writeVersionedSkillConfig } from './configuration.mjs';

// 阶段 4b：技能能力授权编辑（设计文档 §6.3、§10 阶段 4）。
// 只允许启停"已声明且 declaration=optional 且 adapterStatus=ready"的能力；
// required 与未适配（degraded/missing/未声明）能力不能通过配置制造可用性变化（原则 3）。
// 扩展方案阶段 C（§5.1）：无归属入口的技能作为独立消费者参与授权——其"已声明"以 Manifest 声明为准，
// 适配状态恒为 ready（技能的"适配"就是 Manifest 声明 + allowedTools 过滤）。

export function agentConsumersForSkill(graph,skillId){
  return graph.consumers.filter((consumer)=>consumer.type==='agent'&&(consumer.runtimeSkillIds||[]).includes(skillId));
}

// 授权视角的消费者集合：agent 归属技能按 agent 消费者登记（登记为权威，Manifest 不能扩权）；
// 无归属技能回退到自身的 skill 消费者（Manifest 声明即声明集合）
function authorizationConsumersForSkill(graph,skillId){
  const agents=agentConsumersForSkill(graph,skillId);
  if(agents.length)return agents;
  const self=graph.consumers.find((consumer)=>consumer.type==='skill'&&consumer.id===skillId);
  return self?[self]:[];
}

export function skillWhitelist(root,skillId){
  const active=readActiveSkillConfig(root,skillId);
  // null=未配置（全放行）；显式空数组=全部禁止
  return Array.isArray(active?.allowedTools)?[...active.allowedTools]:null;
}

// 该技能在授权视角下声明的能力集合（agent 归属技能取登记，无归属技能取自身 Manifest；含 degraded/required，用于白名单基线）
function declaredCapabilitiesForSkill(graph,skillId){
  const declared=new Map();
  for(const consumer of authorizationConsumersForSkill(graph,skillId))
    for(const dependency of consumer.dependencies||[]){
      const entry=declared.get(dependency.capability)||{capability:dependency.capability,declaration:dependency.declaration||dependency.requirement,adapterStatus:dependency.adapterStatus||'ready',consumers:[]};
      entry.consumers.push(consumer.id);
      if(dependency.declaration==='required'||dependency.requirement==='required')entry.declaration='required';
      if((dependency.adapterStatus||'ready')!=='ready')entry.adapterStatus=dependency.adapterStatus;
      declared.set(dependency.capability,entry);
    }
  return [...declared.values()];
}

export function describeSkillAuthorization(root,graph,skillId){
  const consumers=authorizationConsumersForSkill(graph,skillId);
  if(!consumers.length)return {isAgentRuntimeSkill:false,editable:[],locked:[],whitelist:null,version:0,configHash:'',integrity:'missing'};
  const declared=declaredCapabilitiesForSkill(graph,skillId);
  const editable=declared.filter((item)=>item.declaration==='optional'&&item.adapterStatus==='ready').map((item)=>item.capability).sort();
  const locked=declared.filter((item)=>!editable.includes(item.capability)).map((item)=>({
    capability:item.capability,
    reason:item.declaration==='required'?'必需能力由入口契约固定，不提供开关':`适配状态为 ${item.adapterStatus}，不能通过配置制造可用性`,
  }));
  const state=describeActiveSkillConfig(root,skillId);
  return {isAgentRuntimeSkill:true,editable,locked,whitelist:skillWhitelist(root,skillId),
    version:state.version,configHash:state.configHash,parentHash:state.parentHash,integrity:state.integrity};
}

// 消费者在某次假设白名单下的授权：任一运行时技能放行即授权（与 skillAllowedFor 一致）；
// 无归属技能消费者（type:'skill'）的授权载体即其自身
function allowedWithWhitelist(root,consumer,skillId,nextWhitelist,capability){
  const ids=consumer.type==='skill'&&consumer.id===skillId?[skillId]:(consumer.runtimeSkillIds||[]);
  return ids.some((id)=>{
    const whitelist=id===skillId?nextWhitelist:skillWhitelist(root,id);
    return !whitelist||whitelist.includes(capability);
  });
}

export function previewSkillAuthorizationChange(root,graph,{skillId,capabilities}){
  const nextWhitelist=Array.isArray(capabilities)?capabilities.map(String):null;
  const changes=[];
  for(const consumer of authorizationConsumersForSkill(graph,skillId))
    for(const state of graph.consumerStates.filter((item)=>item.consumerId===consumer.id&&item.declared)){
      const allowedAfter=allowedWithWhitelist(root,consumer,skillId,nextWhitelist,state.capability);
      const factorsOk=state.adapterStatus!=='missing'&&state.implementationStatus==='healthy';
      const before=state.available,after=factorsOk&&allowedAfter;
      if(before!==after)changes.push({consumerId:consumer.id,consumerName:consumer.name,capability:state.capability,capabilityName:state.capabilityName,from:before?'available':'unavailable',to:after?'available':'unavailable'});
    }
  return {skillId,nextWhitelist,changes};
}

function authorizationError(message,issues){
  const error=new Error(message);error.code='CAPABILITY_AUTHORIZATION_INVALID';error.issues=issues;return error;
}

// 服务端强制校验：白名单只能改变 editable 能力的授权状态
export function assertAuthorizationChange(root,graph,skillId,capabilities){
  const description=describeSkillAuthorization(root,graph,skillId);
  if(!description.isAgentRuntimeSkill)throw authorizationError('该技能不是 Agent 运行时技能，没有可编辑的能力授权',[{field:'skillId',message:'不是 Agent 运行时技能'}]);
  if(capabilities===null||capabilities===undefined)return description;
  if(!Array.isArray(capabilities)||capabilities.some((item)=>typeof item!=='string'||!item.trim()))
    throw authorizationError('capabilityAuthorization.capabilities 必须是字符串数组',[{field:'capabilities',message:'必须是字符串数组'}]);
  const next=new Set(capabilities.map(String)),current=description.whitelist?new Set(description.whitelist):null;
  const registered=new Set(graph.capabilities.filter((item)=>item.registered!==false).map((item)=>item.id));
  const declared=new Set(declaredCapabilitiesForSkill(graph,skillId).map((item)=>item.capability));
  const editable=new Set(description.editable),issues=[];
  for(const capability of next){
    if(!registered.has(capability))issues.push({field:'capabilities',capability,message:`能力目录中不存在：${capability}`});
    else if(!declared.has(capability)&&!(current?.has(capability)))issues.push({field:'capabilities',capability,message:`${capability} 未在该技能的消费者登记中声明，不能通过配置引入`});
  }
  // 已声明但不可编辑的能力，授权状态不得被改变
  for(const item of declaredCapabilitiesForSkill(graph,skillId)){
    if(editable.has(item.capability))continue;
    const before=current?current.has(item.capability):true,after=next.has(item.capability);
    if(before!==after)issues.push({field:'capabilities',capability:item.capability,
      message:item.declaration==='required'?`必需能力 ${item.capability} 由入口契约固定，不得停用`:`${item.capability} 适配状态为 ${item.adapterStatus}，不能通过配置改变可用性`});
  }
  if(issues.length)throw authorizationError('能力授权变更被拒绝',issues);
  return description;
}

// 写入：保留 active.json 既有字段（prompt/gates 等），仅更新 capabilityAuthorization/allowedTools，并接入版本协商
// 阶段 6：expectedVersion 强制必传（乐观锁），防止丢失更新；前端与既有调用方均已总传
export function saveSkillAuthorization(root,graph,skillId,{capabilities,expectedVersion}={}){
  if(expectedVersion===undefined||expectedVersion===null||!Number.isFinite(Number(expectedVersion)))
    throw authorizationError('expectedVersion 必传：技能授权写入必须携带基于读取时版本的乐观锁',[{field:'expectedVersion',message:'必须是有限数值'}]);
  const description=assertAuthorizationChange(root,graph,skillId,capabilities);
  const impact=previewSkillAuthorizationChange(root,graph,{skillId,capabilities});
  const current=describeActiveSkillConfig(root,skillId),base=current.config||{};
  const next={...base};
  if(capabilities===null||capabilities===undefined){delete next.capabilityAuthorization;delete next.allowedTools;}
  else{const list=[...new Set(capabilities.map(String))];next.capabilityAuthorization={mode:'allow-list',capabilities:list};next.allowedTools=list;}
  const written=writeVersionedSkillConfig(root,skillId,next,{expectedVersion});
  return {skillId,...written,editable:description.editable,locked:description.locked,impact:impact.changes};
}
