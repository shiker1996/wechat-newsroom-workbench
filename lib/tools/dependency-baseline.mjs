import fs from 'node:fs';
import path from 'node:path';

const CALL_MARKER=/capability-call:\s*([^\r\n]+)/g;
const PRODUCTION_ROOTS=['lib/http','lib/integrations','lib/jobs','lib/llm','lib/skills'];
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

export function scanProductionCapabilityCalls(root){return PRODUCTION_ROOTS.flatMap((directory)=>walk(path.join(root,directory))).flatMap((file)=>{const source=fs.readFileSync(file,'utf8');if(!CALL_PATTERN.test(source))return [];const capabilities=[...source.matchAll(CALL_MARKER)].flatMap((match)=>match[1].split(',')).map((item)=>item.trim()).filter(Boolean);return [{sourceFile:path.relative(root,file).replaceAll('\\','/'),capabilities:[...new Set(capabilities)].sort()}];}).sort((a,b)=>a.sourceFile.localeCompare(b.sourceFile));}

export function auditCapabilityConsumers(root){
  const consumers=readCapabilityConsumers(root),calls=scanProductionCapabilityCalls(root),issues=[],owners=new Map();
  for(const consumer of consumers){const declared=new Set((consumer.dependencies||[]).map((item)=>item.capability));if(!/^feature\.[a-z0-9.-]+$/.test(consumer.id||''))issues.push(`${consumer.id||'<missing>'}: consumer id 无效`);for(const dependency of consumer.dependencies||[]){if(!['required','optional','conditional'].includes(dependency.requirement))issues.push(`${consumer.id}/${dependency.capability}: requirement 无效`);if(!['block','continue-with-warning','skip'].includes(dependency.failurePolicy))issues.push(`${consumer.id}/${dependency.capability}: failurePolicy 无效`);}for(const sourceFile of consumer.sourceFiles||[]){if(owners.has(sourceFile))issues.push(`${sourceFile}: 被多个功能消费者重复声明`);owners.set(sourceFile,{consumer,declared});if(!fs.existsSync(path.join(root,sourceFile)))issues.push(`${consumer.id}: 源文件不存在 ${sourceFile}`);}}
  const callsByFile=new Map(calls.map((item)=>[item.sourceFile,item]));
  for(const call of calls){const owner=owners.get(call.sourceFile);if(!owner){issues.push(`${call.sourceFile}: 存在工具调用但未登记功能消费者`);continue;}if(!call.capabilities.length)issues.push(`${call.sourceFile}: 工具调用缺少 capability-call 声明`);for(const capability of call.capabilities)if(!owner.declared.has(capability))issues.push(`${call.sourceFile}: ${capability} 未在 ${owner.consumer.id} 声明`);}
  for(const [sourceFile,{consumer}] of owners)if(!callsByFile.has(sourceFile))issues.push(`${consumer.id}: 已登记源文件没有工具调用 ${sourceFile}`);
  for(const consumer of consumers)for(const {capability} of consumer.dependencies||[])if(!(consumer.sourceFiles||[]).some((file)=>callsByFile.get(file)?.capabilities.includes(capability)))issues.push(`${consumer.id}: 声明的能力没有代码调用标记 ${capability}`);
  return {consumers,calls,issues};
}

export function buildToolCallBaseline(root){
  const {consumers,calls,issues}=auditCapabilityConsumers(root);
  const manifests=pluginManifestFiles(path.join(root,'plugins')).map((file)=>JSON.parse(fs.readFileSync(file,'utf8')));
  const tools=manifests.filter((item)=>item.kind==='tool').map(({id,name,version,kind,capabilities,riskLevel})=>({id,name,version,kind,capabilities,riskLevel})).sort((a,b)=>a.id.localeCompare(b.id));
  const collectors=manifests.filter((item)=>item.kind==='collector').map(({id,name,version,kind,capabilities,riskLevel})=>({id,name,version,kind,capabilities,riskLevel})).sort((a,b)=>a.id.localeCompare(b.id));
  const skills=fs.readdirSync(path.join(root,'skills'),{withFileTypes:true}).filter((entry)=>entry.isDirectory()).flatMap((entry)=>{const file=path.join(root,'skills',entry.name,'skill.json');if(!fs.existsSync(file))return [];const manifest=JSON.parse(fs.readFileSync(file,'utf8'));return [{id:manifest.id,name:manifest.name,requiredCapabilities:manifest.requiredCapabilities||[],optionalCapabilities:manifest.optionalCapabilities||[]}];}).sort((a,b)=>a.id.localeCompare(b.id));
  return {schemaVersion:1,generatedFrom:'repository manifests and capability-call markers',tools,collectors,skills,features:consumers,codeCalls:calls,audit:{pass:issues.length===0,issues}};
}
