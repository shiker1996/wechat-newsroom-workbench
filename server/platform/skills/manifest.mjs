import fs from 'node:fs';
import path from 'node:path';
import { validateConfigurationSchema } from '../extensions/configuration-schema.mjs';

export const SKILL_KINDS=Object.freeze([
  'writer','storyboard','reviewer','title','humanizer','seo','image-planner','typesetter','stage',
]);

export const SKILL_ENTRY_POINTS=Object.freeze([
  'hotspot-article','independent-writing','batch-daily',
  'social-tool','social-custom','social-event','wechat-typeset',
  // 会话 Agent 入口（contracts.mjs CONVERSATION_AGENT_ENTRY_POINTS）；custom-card-storyboard
  // 声明 custom-social 与会话 Agent 对齐，路由侧 'social-custom' 由 entry-routing 别名兼容
  'custom-social',
]);

const ID_PATTERN=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_PATTERN=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CONTRACT_PATTERN=/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

function stringArray(value) {
  return Array.isArray(value)&&value.every((item)=>typeof item==='string'&&item.trim())
    &&new Set(value).size===value.length;
}

export function validateSkillManifest(input, { expectedId = '' } = {}) {
  const issues=[];
  if(!input||typeof input!=='object'||Array.isArray(input)){
    return [{field:'manifest',level:'error',message:'skill.json 必须是对象'}];
  }
  const allowedFields=new Set(['schemaVersion','id','name','version','kind','entryPoints','contentTypes',
    'inputContract','outputContract','requiredCapabilities','optionalCapabilities','compatibleApp','source','configuration']);
  const unknownFields=Object.keys(input).filter((field)=>!allowedFields.has(field));
  if(unknownFields.length)issues.push({field:'manifest',level:'error',message:`skill.json 包含未知字段：${unknownFields.join('、')}`});
  if(input.schemaVersion!==1)issues.push({field:'schemaVersion',level:'error',message:'schemaVersion 必须为 1'});
  if(!ID_PATTERN.test(input.id||''))issues.push({field:'id',level:'error',message:'技能 ID 必须使用小写 kebab-case'});
  if(expectedId&&input.id!==expectedId)issues.push({field:'id',level:'error',message:`技能 ID 必须与目录名一致：${expectedId}`});
  if(typeof input.name!=='string'||!input.name.trim())issues.push({field:'name',level:'error',message:'技能名称不能为空'});
  if(!VERSION_PATTERN.test(input.version||''))issues.push({field:'version',level:'error',message:'技能版本必须使用 SemVer'});
  if(!SKILL_KINDS.includes(input.kind))issues.push({field:'kind',level:'error',message:`未知技能角色：${input.kind||''}`});
  if(!stringArray(input.entryPoints)||input.entryPoints.some((item)=>!SKILL_ENTRY_POINTS.includes(item))){
    issues.push({field:'entryPoints',level:'error',message:'技能入口包含未知值或重复值'});
  }
  if(!stringArray(input.contentTypes))issues.push({field:'contentTypes',level:'error',message:'contentTypes 必须是无重复字符串数组'});
  for(const field of ['inputContract','outputContract']){
    if(!CONTRACT_PATTERN.test(input[field]||''))issues.push({field,level:'error',message:`${field} 必须使用 snake_case`});
  }
  for(const field of ['requiredCapabilities','optionalCapabilities']){
    if(!stringArray(input[field]))issues.push({field,level:'error',message:`${field} 必须是无重复字符串数组`});
  }
  const overlap=(input.requiredCapabilities||[]).filter((item)=>(input.optionalCapabilities||[]).includes(item));
  if(overlap.length)issues.push({field:'capabilities',level:'error',message:`工具能力不能同时声明为必需和可选：${overlap.join('、')}`});
  if(typeof input.compatibleApp!=='string'||!/^>=\d+\.\d+\.\d+$/.test(input.compatibleApp)){
    issues.push({field:'compatibleApp',level:'error',message:'compatibleApp 当前只支持 >=x.y.z'});
  }
  if(!input.source||!['builtin','installed'].includes(input.source.type)
    ||typeof input.source.url!=='string'
    ||Object.keys(input.source).some((field)=>!['type','url'].includes(field))){
    issues.push({field:'source',level:'error',message:'source.type 必须是 builtin 或 installed'});
  }
  if(input.configuration)issues.push(...validateConfigurationSchema(input.configuration));
  return issues;
}

export function readSkillManifest(skillDirectory, expectedId = path.basename(skillDirectory)) {
  const filePath=path.join(skillDirectory,'skill.json');
  if(!fs.existsSync(filePath)){
    return {filePath,manifest:null,status:'missing',
      issues:[{field:'skill.json',level:'warning',message:'缺少结构化技能清单，按旧版技能处理'}]};
  }
  let manifest;
  try{manifest=JSON.parse(fs.readFileSync(filePath,'utf8'));}
  catch(error){return {filePath,manifest:null,status:'invalid',
    issues:[{field:'skill.json',level:'error',message:`skill.json 无法解析：${error.message}`}]};}
  const issues=validateSkillManifest(manifest,{expectedId});
  return {filePath,manifest,status:issues.some((item)=>item.level==='error')?'invalid':'valid',issues};
}
