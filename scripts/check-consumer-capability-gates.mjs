// 阶段 6 治理门禁（设计文档 §10 阶段 6）：消费者—能力反向一致性检查，CI 可跑。
// 门禁 A「配置声明但无适配」：agent 登记中 adapterStatus=missing 的依赖、
//   内置技能 Manifest 声明了命中 agent 入口但未在消费者登记中的能力；
// 门禁 B「适配存在但未登记」：Adapter 能力常量与 capability-consumers.json 登记双向交叉验证。
// 第三方技能的能力声明扩展仍由 auditSkillCapabilityReferences 的 warning 机制覆盖（见 SkillRegistry），不在此失败级门禁内。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditSkillCapabilityReferences, readAgentConsumers } from '../lib/tools/dependency-baseline.mjs';
import { readCapabilityCatalog } from '../lib/tools/capability-catalog.mjs';
import { EDITORIAL_AGENT_CAPABILITIES } from '../lib/agent/editorial-adapter.mjs';
import { TUTORIAL_AGENT_CAPABILITIES } from '../lib/agent/tutorial-adapter.mjs';
import { CUSTOM_SOCIAL_AGENT_CAPABILITIES } from '../lib/agent/custom-social-adapter.mjs';
import { isResourceAdaptedCapability, CAPABILITY_RESOURCE_PROFILE, resolveCatalogResourceProfiles } from '../lib/agent/resource-adaptation.mjs';

const ADAPTER_CONSTANTS=Object.freeze({
  EDITORIAL_AGENT_CAPABILITIES,
  TUTORIAL_AGENT_CAPABILITIES,
  CUSTOM_SOCIAL_AGENT_CAPABILITIES,
});

export function checkConsumerCapabilityGates(root){
  const issues=[],agents=readAgentConsumers(root),byConstant=new Map(agents.map((agent)=>[agent.capabilityConstant,agent]));
  // 门禁 B：适配（Adapter 能力常量）与登记交叉验证（机制二语义：常量=适配代码能力上界）
  // - 常量 ⊆ 登记：常量已接线但登记缺失 → 报错；
  // - 资源类能力登记了但既无档案（静态表与目录 resourceKind 声明）又未列入常量 → 报错（缺少适配）；
  //   档案命中（静态表或目录声明）即有默认适配路径，即使常量未含也合法；
  // - 纯参数能力登记超出常量 → 放行（登记即生效）。
  const catalogProfiles=resolveCatalogResourceProfiles(root);
  for(const [constantName,capabilities] of Object.entries(ADAPTER_CONSTANTS)){
    const consumer=byConstant.get(constantName);
    if(!consumer){issues.push(`适配常量 ${constantName} 没有对应的 agent 消费者登记`);continue;}
    const registered=new Set((consumer.dependencies||[]).map((dependency)=>dependency.capability));
    for(const capability of capabilities)
      if(!registered.has(capability))issues.push(`${consumer.id}: Adapter 已接线 ${capability} 但未在登记中声明`);
    for(const dependency of consumer.dependencies||[])
      if(!capabilities.includes(dependency.capability)&&isResourceAdaptedCapability(dependency.capability,catalogProfiles)&&!CAPABILITY_RESOURCE_PROFILE[dependency.capability]&&!catalogProfiles[dependency.capability])
        issues.push(`${consumer.id}: 登记了资源类能力 ${dependency.capability} 但 ${constantName} 未包含（缺少适配代码）`);
  }
  // 门禁 A1：登记声明了能力但适配缺失
  for(const agent of agents)
    for(const dependency of agent.dependencies||[])
      if(dependency.adapterStatus==='missing')issues.push(`${agent.id}/${dependency.capability}: 登记声明但适配缺失（adapterStatus=missing）`);
  // 门禁 A2：内置技能 Manifest 声明命中 agent 入口的能力但未在消费者登记中（或引用了目录外能力）
  const agentEntryPoints=new Set(agents.map((agent)=>agent.entryPoint));
  const skillsRoot=path.join(root,'skills');
  for(const entry of fs.readdirSync(skillsRoot,{withFileTypes:true}).filter((item)=>item.isDirectory())){
    const file=path.join(skillsRoot,entry.name,'skill.json');
    if(!fs.existsSync(file))continue;
    const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!(manifest.entryPoints||[]).some((entryPoint)=>agentEntryPoints.has(entryPoint)))continue;
    for(const warning of auditSkillCapabilityReferences(root,{skillId:manifest.id,entryPoints:manifest.entryPoints||[],
      capabilities:[...(manifest.requiredCapabilities||[]),...(manifest.optionalCapabilities||[])]}))
      issues.push(`内置技能 ${warning.message}`);
  }
  return issues;
}

// 门禁 R4（warning 级，不阻断）：实现侧声明了目录外能力（registered:false 占位），提示补目录条目。
// 扫描内置/第三方/远程工具与采集器的 Manifest capabilities，与 config/capabilities.json 对比。
export function checkConsumerCapabilityWarnings(root){
  const registered=new Set(Object.keys(readCapabilityCatalog(root).capabilities)),declared=new Map();
  const note=(source,capabilities)=>{for(const capability of capabilities||[])if(!registered.has(capability)){if(!declared.has(capability))declared.set(capability,[]);declared.get(capability).push(source);}};
  const pluginsRoot=path.join(root,'plugins');
  if(fs.existsSync(pluginsRoot))
    for(const entry of fs.readdirSync(pluginsRoot,{withFileTypes:true}).filter((item)=>item.isDirectory())){
      const manifestFile=path.join(pluginsRoot,entry.name,'manifest.json');
      if(!fs.existsSync(manifestFile))continue;
      try{note(`内置插件 ${entry.name}`,JSON.parse(fs.readFileSync(manifestFile,'utf8')).capabilities);}catch{}
    }
  for(const file of ['tool-plugins.json','remote-tool-plugins.json','collector-plugins.json']){
    const catalogFile=path.join(root,'data',file);
    if(!fs.existsSync(catalogFile))continue;
    try{
      const catalog=JSON.parse(fs.readFileSync(catalogFile,'utf8'));
      for(const item of Object.values(catalog.plugins||{}))
        if(item.status!=='uninstalled')note(`${file} ${item.id}`,item.manifest?.capabilities);
    }catch{}
  }
  return [...declared.entries()].map(([capability,sources])=>`能力 ${capability} 未登记（${sources.join('、')} 声明）：实现仅可调试，不得启用或设为路由首选；请补 config/capabilities.json 条目`);
}

if(import.meta.main){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const issues=checkConsumerCapabilityGates(root),warnings=checkConsumerCapabilityWarnings(root);
  for(const warning of warnings)console.warn(`[warning] ${warning}`);
  if(issues.length){console.error(`消费者—能力治理门禁未通过：\n${issues.map((issue)=>`- ${issue}`).join('\n')}`);process.exitCode=1;}
  else console.log(`消费者—能力治理门禁通过：配置声明均有适配，适配均已登记${warnings.length?`（${warnings.length} 条未登记能力 warning）`:''}`);
}
