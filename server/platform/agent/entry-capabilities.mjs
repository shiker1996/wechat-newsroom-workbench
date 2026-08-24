import fs from 'node:fs';
import path from 'node:path';
import { isResourceAdaptedCapability, CAPABILITY_RESOURCE_PROFILE, resolveCatalogResourceProfiles } from './resource-adaptation.mjs';

// 机制二「Agent 目录登记驱动」（docs/design/capability-onboarding-configurability-plan.md §4）：
// Agent 工具目录的能力集合从 config/capability-consumers.json 登记派生，
// Adapter 常量（*_AGENT_CAPABILITIES）降级为「本 Adapter 有适配代码的能力上界」校验锚点：
// - 常量 ⊆ 登记：常量中任何能力未登记即报错（启动期一致性）；
// - 资源类能力（命中静态 resourceKind 档案表、目录条目声明了 resourceKind，或列入 RESOURCE_ADAPTED_CAPABILITIES）
//   登记为 ready/degraded：档案命中（静态表或目录声明）即有默认适配路径（合法，即使常量未含）；
//   仅列入常量而两处档案都未命中的仍要求常量包含，都无才报「缺少适配代码」；
//   登记为 missing 的不进入目录（图谱/页面显示「缺少适配」，与现状语义一致）；
// - 纯参数能力无需适配代码：登记（ready/degraded）即生效，允许超出常量；
// - 登记文件缺失时回退常量（兼容无 config 的嵌入式/测试工作区）。
// 依赖路径：本模块只直读登记 JSON + resource-adaptation 的常量集合，不经过 capability-graph，
// 登记 → 图谱 → Adapter 的依赖链不会闭环。
export function deriveAgentEntryCapabilities(root,consumerId,capabilityConstant){
  const file=path.join(root,'config','capability-consumers.json');
  if(!fs.existsSync(file))return capabilityConstant;
  const parsed=JSON.parse(fs.readFileSync(file,'utf8'));
  const consumer=(parsed.consumers||[]).find((item)=>item.id===consumerId&&item.type==='agent');
  if(!consumer)throw new Error(`agent 消费者未登记：${consumerId}`);
  const registered=new Map((consumer.dependencies||[]).map((dependency)=>[dependency.capability,dependency]));
  for(const capability of capabilityConstant)
    if(!registered.has(capability))throw new Error(`${consumerId}: Adapter 常量 ${capability} 未在消费者登记中（常量必须是登记的子集）`);
  const derived=[],catalogProfiles=resolveCatalogResourceProfiles(root);
  for(const [capability,dependency] of registered){
    if(!['ready','degraded'].includes(dependency.adapterStatus))continue;
    // 资源类能力合法性：静态档案命中 或 catalog resourceKind 声明（默认适配路径）或 Adapter 常量包含
    const hasProfile=CAPABILITY_RESOURCE_PROFILE[capability]!=null||catalogProfiles[capability]!=null;
    if(isResourceAdaptedCapability(capability,catalogProfiles)&&!hasProfile&&!capabilityConstant.includes(capability))
      throw new Error(`${consumerId}: 登记了资源类能力 ${capability} 但 Adapter 常量未包含（缺少适配代码）`);
    derived.push(capability);
  }
  return Object.freeze(derived.sort());
}
