import fs from 'node:fs';
import path from 'node:path';

const CALL_MARKER=/capability-call:\s*([^\r\n]+)/g;
const PRODUCTION_ROOTS=['server/platform/http','server/platform/integrations','server/platform/jobs','server/platform/llm','server/features','server/platform/skills'];
const CALL_PATTERN=/(?:registry|toolRegistry)\.execute\s*\(|executeCapability\s*\(|executeCapabilityWithPreference\s*\(|executeInformationCapabilitySlot\s*\(/;

function walk(directory){if(!fs.existsSync(directory))return [];return fs.readdirSync(directory,{withFileTypes:true}).flatMap((entry)=>{const target=path.join(directory,entry.name);return entry.isDirectory()?walk(target):entry.isFile()&&entry.name.endsWith('.mjs')?[target]:[];});}
function pluginManifestFiles(directory){
  if(!fs.existsSync(directory))return [];
  const files=[];
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    if(!entry.isDirectory()||entry.name==='shared'||entry.name.startsWith('_'))continue;
    const direct=path.join(directory,entry.name,'manifest.json');
    if(fs.existsSync(direct))files.push(direct);
  }
  const collectors=path.join(directory,'collectors');
  if(fs.existsSync(collectors))for(const entry of fs.readdirSync(collectors,{withFileTypes:true})){
    if(!entry.isDirectory()||entry.name.startsWith('_'))continue;
    const file=path.join(collectors,entry.name,'manifest.json');if(fs.existsSync(file))files.push(file);
  }
  return files;
}

export function readCapabilityConsumers(root){const parsed=JSON.parse(fs.readFileSync(path.join(root,'config','capability-consumers.json'),'utf8'));if(parsed.schemaVersion!==1||!Array.isArray(parsed.consumers))throw new Error('capability-consumers.json 格式无效');return parsed.consumers;}

// 阶段 1：agent 消费者登记（config/capability-consumers.json 中 type:'agent' 的记录）
export function readAgentConsumers(root){return readCapabilityConsumers(root).filter((consumer)=>consumer.type==='agent');}

const CONSUMER_ID_PATTERN=/^(feature|agent)\.[a-z0-9.-]+$/;
const REQUIREMENTS=['required','optional','conditional'],FAILURE_POLICIES=['block','continue-with-warning','skip'];
const DECLARATIONS=['required','optional'],ADAPTER_STATUSES=['ready','missing','degraded'],TRIGGER_POLICIES=['model-request','explicit-resource','deterministic-first-step','code-path'];
const AGENT_DEPENDENCY_STRING_FIELDS=['resultPolicy','source'];
// 扩展方案阶段 B：feature 依赖必须携带适配可见性三字段（适配状态/触发策略/结果去向），
// 防止"工具存在、消费者不可见"回退；resourceKinds/declaration/authorizationAction 为 agent 语义字段，feature 携带时校验、不带放行
const FEATURE_ADAPTATION_REQUIRED=['adapterStatus','triggerPolicy','resultPolicy'];

function auditDependency(consumer,dependency,issues){
  const label=`${consumer.id||'<missing>'}/${dependency.capability||'<missing>'}`;
  if(!REQUIREMENTS.includes(dependency.requirement))issues.push(`${label}: requirement 无效`);
  if(!FAILURE_POLICIES.includes(dependency.failurePolicy))issues.push(`${label}: failurePolicy 无效`);
  if(consumer.type!=='agent'){
    for(const field of FEATURE_ADAPTATION_REQUIRED)if(typeof dependency[field]!=='string'||!dependency[field])issues.push(`${label}: ${field} 缺失或无效（feature 依赖必须登记适配可见性字段）`);
    if(dependency.adapterStatus&&!ADAPTER_STATUSES.includes(dependency.adapterStatus))issues.push(`${label}: adapterStatus 无效`);
    if(dependency.triggerPolicy&&!TRIGGER_POLICIES.includes(dependency.triggerPolicy))issues.push(`${label}: triggerPolicy 无效`);
    if(dependency.resourceKinds!==undefined&&(!Array.isArray(dependency.resourceKinds)||dependency.resourceKinds.some((item)=>typeof item!=='string')))issues.push(`${label}: resourceKinds 必须是字符串数组`);
    if(dependency.declaration!==undefined&&!DECLARATIONS.includes(dependency.declaration))issues.push(`${label}: declaration 无效`);
    if(dependency.authorizationAction!==undefined&&dependency.authorizationAction!==null&&typeof dependency.authorizationAction!=='string')issues.push(`${label}: authorizationAction 必须是字符串或 null`);
    return;
  }
  // agent 消费者必须登记完整的适配字段（设计文档 §4.4）
  if(!DECLARATIONS.includes(dependency.declaration))issues.push(`${label}: declaration 无效`);
  if(!ADAPTER_STATUSES.includes(dependency.adapterStatus))issues.push(`${label}: adapterStatus 无效`);
  if(!Array.isArray(dependency.resourceKinds)||dependency.resourceKinds.some((item)=>typeof item!=='string'))issues.push(`${label}: resourceKinds 必须是字符串数组`);
  if(!TRIGGER_POLICIES.includes(dependency.triggerPolicy))issues.push(`${label}: triggerPolicy 无效`);
  if(dependency.authorizationAction!==null&&typeof dependency.authorizationAction!=='string')issues.push(`${label}: authorizationAction 必须是字符串或 null`);
  for(const field of AGENT_DEPENDENCY_STRING_FIELDS)if(typeof dependency[field]!=='string'||!dependency[field])issues.push(`${label}: ${field} 缺失或无效`);
}

export function auditCapabilityConsumers(root){
  const consumers=readCapabilityConsumers(root),calls=scanProductionCapabilityCalls(root),issues=[],owners=new Map(),ids=new Set();
  for(const consumer of consumers){
    if(ids.has(consumer.id))issues.push(`${consumer.id||'<missing>'}: 消费者重复登记`);ids.add(consumer.id);
    if(!CONSUMER_ID_PATTERN.test(consumer.id||''))issues.push(`${consumer.id||'<missing>'}: consumer id 无效`);
    if(consumer.type==='agent'&&typeof consumer.entryPoint!=='string')issues.push(`${consumer.id}: agent 消费者缺少 entryPoint`);
    const declared=new Set();
    for(const dependency of consumer.dependencies||[]){
      auditDependency(consumer,dependency,issues);
      if(declared.has(dependency.capability))issues.push(`${consumer.id}/${dependency.capability}: 同一消费者重复登记能力`);
      declared.add(dependency.capability);
    }
    // 代码调用标记交叉校验只适用于 feature 消费者；agent 消费者的接线在 server/agent 适配器中，由一致性测试覆盖
    if(consumer.type==='agent'){
      for(const gap of consumer.gaps||[]){
        if(typeof gap.capability!=='string'||!gap.capability)issues.push(`${consumer.id}: gap 缺少 capability`);
        else if(declared.has(gap.capability))issues.push(`${consumer.id}/${gap.capability}: gap 与已登记依赖重复`);
        if(typeof gap.reason!=='string'||!gap.reason)issues.push(`${consumer.id}/${gap.capability||'<missing>'}: gap 缺少原因说明`);
      }
      continue;
    }
    for(const sourceFile of consumer.sourceFiles||[]){if(owners.has(sourceFile))issues.push(`${sourceFile}: 被多个功能消费者重复声明`);owners.set(sourceFile,{consumer,declared});if(!fs.existsSync(path.join(root,sourceFile)))issues.push(`${consumer.id}: 源文件不存在 ${sourceFile}`);}
  }
  const callsByFile=new Map(calls.map((item)=>[item.sourceFile,item]));
  for(const call of calls){const owner=owners.get(call.sourceFile);if(!owner){issues.push(`${call.sourceFile}: 存在工具调用但未登记功能消费者`);continue;}if(!call.capabilities.length)issues.push(`${call.sourceFile}: 工具调用缺少 capability-call 声明`);for(const capability of call.capabilities)if(!owner.declared.has(capability))issues.push(`${call.sourceFile}: ${capability} 未在 ${owner.consumer.id} 声明`);}
  for(const [sourceFile,{consumer}] of owners)if(!callsByFile.has(sourceFile))issues.push(`${consumer.id}: 已登记源文件没有工具调用 ${sourceFile}`);
  for(const consumer of consumers.filter((item)=>item.type!=='agent'))for(const {capability} of consumer.dependencies||[])if(!(consumer.sourceFiles||[]).some((file)=>callsByFile.get(file)?.capabilities.includes(capability)))issues.push(`${consumer.id}: 声明的能力没有代码调用标记 ${capability}`);
  return {consumers,calls,issues};
}

export function scanProductionCapabilityCalls(root){return PRODUCTION_ROOTS.flatMap((directory)=>walk(path.join(root,directory))).flatMap((file)=>{const source=fs.readFileSync(file,'utf8');if(!CALL_PATTERN.test(source))return [];const capabilities=[...source.matchAll(CALL_MARKER)].flatMap((match)=>match[1].split(',')).map((item)=>item.trim()).filter(Boolean);return [{sourceFile:path.relative(root,file).replaceAll('\\','/'),capabilities:[...new Set(capabilities)].sort()}];}).sort((a,b)=>a.sourceFile.localeCompare(b.sourceFile));}

export function buildToolCallBaseline(root){
  const {consumers,calls,issues}=auditCapabilityConsumers(root);
  const manifests=pluginManifestFiles(path.join(root,'plugins')).map((file)=>JSON.parse(fs.readFileSync(file,'utf8')));
  const tools=manifests.filter((item)=>item.kind==='tool').map(({id,name,version,kind,capabilities,riskLevel})=>({id,name,version,kind,capabilities,riskLevel})).sort((a,b)=>a.id.localeCompare(b.id));
  const collectors=manifests.filter((item)=>item.kind==='collector').map(({id,name,version,kind,capabilities,riskLevel})=>({id,name,version,kind,capabilities,riskLevel})).sort((a,b)=>a.id.localeCompare(b.id));
  const skills=fs.readdirSync(path.join(root,'skills'),{withFileTypes:true}).filter((entry)=>entry.isDirectory()).flatMap((entry)=>{const file=path.join(root,'skills',entry.name,'skill.json');if(!fs.existsSync(file))return [];const manifest=JSON.parse(fs.readFileSync(file,'utf8'));return [{id:manifest.id,name:manifest.name,requiredCapabilities:manifest.requiredCapabilities||[],optionalCapabilities:manifest.optionalCapabilities||[]}];}).sort((a,b)=>a.id.localeCompare(b.id));
  // 代码调用链基线只跟踪 feature 消费者；agent 消费者的适配接线由 consumer-capability 测试与基线覆盖
  return {schemaVersion:1,generatedFrom:'repository manifests and capability-call markers',tools,collectors,skills,features:consumers.filter((consumer)=>consumer.type!=='agent'),codeCalls:calls,audit:{pass:issues.length===0,issues}};
}

// 阶段 1 权威源裁定：技能 Manifest 的 capability 声明是对消费者登记的引用。
// 引用目录中不存在的能力、或引用了对应 agent 消费者未登记的能力，产出 warning 级问题
// （由 SkillRegistry 并入 manifestIssues 展示；阶段 1 不 hard error，避免误伤声明扩展能力的第三方技能）。
export function auditSkillCapabilityReferences(root,{skillId,entryPoints=[],capabilities=[]}={}){
  const catalogFile=path.join(root,'config','capabilities.json'),consumersFile=path.join(root,'config','capability-consumers.json');
  if(!fs.existsSync(catalogFile)||!fs.existsSync(consumersFile))return [];
  const catalogIds=new Set(Object.keys(JSON.parse(fs.readFileSync(catalogFile,'utf8')).capabilities||{}));
  const agents=readCapabilityConsumers(root).filter((consumer)=>consumer.type==='agent'&&consumer.entryPoint);
  const issues=[];
  for(const capability of capabilities)
    if(!catalogIds.has(capability))issues.push({field:'capabilities',level:'warning',message:`${skillId} 引用了能力目录中不存在的能力：${capability}`});
  for(const agent of agents.filter((consumer)=>entryPoints.includes(consumer.entryPoint))){
    const registered=new Set((agent.dependencies||[]).map((item)=>item.capability));
    for(const capability of capabilities)
      if(!registered.has(capability))issues.push({field:'capabilities',level:'warning',message:`${skillId} 声明的 ${capability} 未在消费者 ${agent.id} 登记`});
  }
  return issues;
}
