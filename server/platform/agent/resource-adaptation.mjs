// 阶段 5：三个会话 Agent 共用的通用资源适配层（设计文档 §9）。
// 下沉内容：URL/本地路径识别、资源 ID 建立、本次请求授权检查（RESOURCE_NOT_ALLOWED）、
// allowedRoots 组装、通用 capability 参数转换、通用结果裁剪、确定性前置 ToolRequest。
// 不下沉：业务 Prompt、业务输出 Schema、工具结果进入业务事实结构的规则（事实附件、【体验】判定）、
// 入口特有门禁——这些保留在各 Adapter。
// 授权边界语义与迁移前逐场景一致：模型只见 resourceId，本地路径/root/allowedRoots 不进入工具目录。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { saveFactAttachment } from './fact-attachments.mjs';

export const RESOURCE_ID_SCHEMA=Object.freeze({type:'object',required:['resourceId'],additionalProperties:false,properties:{resourceId:{type:'string'}}});
export const RESOURCE_ID_QUERY_SCHEMA=Object.freeze({type:'object',required:['resourceId','query'],additionalProperties:false,properties:{resourceId:{type:'string'},query:{type:'string'}}});
export const PASSAGE_RESOURCE_SCHEMA=Object.freeze({type:'object',required:['resourceIds','query'],additionalProperties:false,properties:{resourceIds:{type:'array',items:{type:'string'},minItems:1},query:{type:'string'},k:{type:'integer'}}});

// 按能力把目录条目的入参 Schema 改写为资源绑定形式（各 Adapter 原 publicCatalog/catalogFor 的通用化）
export function withResourceInputSchemas(catalog,overrides={}){
  return catalog.map((item)=>overrides[item.capability]?{...item,inputSchema:overrides[item.capability]}:item);
}

export function extractUrlsFromText(text){return String(text||'').match(/https?:\/\/[^\s<>"']+/gi)||[];}

// 草稿素材 URL + 回答中的 URL 去重合并（tutorial/custom-social 的发现逻辑）
export function mergeMaterialUrls(draftUrls=[],answer='',limit=5){
  return [...new Set([...(draftUrls||[]),...extractUrlsFromText(answer)])].slice(0,limit);
}

export function registerMaterialUrls(resources,urls,{prefix='material'}={}){
  urls.forEach((url,index)=>resources.set(`${prefix}:${index+1}`,{id:`${prefix}:${index+1}`,url}));
  return resources;
}

export function registerDocumentRoots(resources,roots=[]){
  roots.forEach((root,index)=>resources.set(`document-root:${index+1}`,{root}));
  return resources;
}

export function registerProjectResource(resources,projectPath){
  if(projectPath)resources.set('project:current',{id:'project:current',path:projectPath});
  return resources;
}

// allowedRoots 组装下沉：保持各入口原有的候选顺序，仅做空值过滤（不做去重，语义与现状一致）
export function buildAllowedRoots(...candidates){return candidates.filter(Boolean);}

// 资源注册器表（阶段 1 代码内注册表）：materials 的 limit 语义对齐 mergeMaterialUrls 的截断；
// hotspotSources/candidateUrls 从 editorial-adapter 的 resourcesFor 抽出，条目 id 与字段逐字节对齐。
export const RESOURCE_SOURCE_REGISTRARS=Object.freeze({
  materials:(resources,urls,{limit}={})=>registerMaterialUrls(resources,typeof limit==='number'?urls.slice(0,limit):urls),
  documentRoots:(resources,roots)=>registerDocumentRoots(resources,roots),
  project:(resources,projectPath)=>registerProjectResource(resources,projectPath),
  hotspotSources:(resources,events=[])=>{
    for(const event of events)for(const hotspot of event.hotspots||[]){
      const id=`source:${hotspot.id}`;resources.set(id,{id,eventId:String(event.event_id),url:hotspot.sourceDoc?.final_url||hotspot.sourceDoc?.url||hotspot.url,title:hotspot.sourceDoc?.title||hotspot.title,content:String(hotspot.sourceDoc?.content||'')});
    }
    return resources;
  },
  candidateUrls:(resources,urls=[])=>{
    urls.forEach((url,index)=>resources.set(`candidate-source:${index+1}`,{id:`candidate-source:${index+1}`,url,title:url,content:''}));
    return resources;
  },
});

export function resourceNotAllowed(message){const error=new Error(message);error.code='RESOURCE_NOT_ALLOWED';return error;}

const sanitizeQuery=(value,max)=>String(value||'').replace(/[\u0000-\u001f]/g,' ').slice(0,max);
const clampInt=(value,min,max,fallback)=>Math.min(max,Math.max(min,Number(value)||fallback));

// resourceId 模式能力 = 命中 CAPABILITY_RESOURCE_PROFILE（有默认档案）或列入
// RESOURCE_ADAPTED_CAPABILITIES 常量的能力；这些能力依赖适配代码（资源注册、参数改写、输入 Schema 注入）。
// 其余能力（content.web.search/content.news.search 只做 query 清洗与 maxResults 截断，
// default 直接透传）是纯参数能力：无需适配代码，登记即生效。
export const RESOURCE_ADAPTED_CAPABILITIES=Object.freeze(['filesystem.project.read','content.url.fetch','content.document.search','content.repository.inspect','content.passage.retrieve']);
// catalogProfiles（resolveCatalogResourceProfiles 的结果）可选传入：目录声明了 resourceKind 的能力同样算资源类
export const isResourceAdaptedCapability=(capability,catalogProfiles={})=>CAPABILITY_RESOURCE_PROFILE[capability]!=null||catalogProfiles[capability]!=null||RESOURCE_ADAPTED_CAPABILITIES.includes(capability);

// resourceKind 档案表（阶段 1 代码内注册表）：resolve(resource, args, ctx) 与迁移前 switch 分支
// 行为逐字节一致；拒绝文案按 ctx.capability 从 options.messages（agent+capability 二维）取，内联字符串为最终兜底。
export const RESOURCE_KIND_PROFILES=Object.freeze({
  'project-path':{
    schema:RESOURCE_ID_SCHEMA,
    resolve(resource,args,{messages,capability}){if(!resource?.path)throw resourceNotAllowed(messages[capability]||'项目资源不属于当前请求');return {path:resource.path,options:{}};},
  },
  'url-fetch':{
    schema:RESOURCE_ID_SCHEMA,
    resolve(resource,args,{messages,workspaceRoot,capability}){if(!resource?.url)throw resourceNotAllowed(messages[capability]||'URL 资源不属于当前请求');return {targetUrl:resource.url,...(resource.title?{title:resource.title}:{}),root:workspaceRoot};},
  },
  'document-root':{
    schema:RESOURCE_ID_QUERY_SCHEMA,
    resolve(resource,args,{messages,capability}){if(!resource?.root)throw resourceNotAllowed(messages[capability]||'文档目录未授权');return {root:resource.root,query:String(args?.query||'').slice(0,300),maxResults:5};},
  },
  'github-url':{
    schema:RESOURCE_ID_SCHEMA,
    resolve(resource,args,{messages,capability}){if(!resource?.url||!/^https:\/\/github\.com\//i.test(resource.url))throw resourceNotAllowed(messages[capability]||'仓库不属于用户授权的 GitHub 素材');return {sourceUrl:resource.url};},
  },
  'passage-content':{
    schema:PASSAGE_RESOURCE_SCHEMA,
    // resourceIds 命中资源目录时按已抓取正文严格执行；否则透传（tutorial/custom-social 的兼容回退）
    resolve(resource,args,{resources,messages,capability}){
      const ids=Array.isArray(args?.resourceIds)?args.resourceIds.map(String):[];
      if(!ids.length)return args;
      const selected=ids.map((id)=>resources.get(id));
      if(!selected.length||selected.some((item)=>!item?.content))throw resourceNotAllowed(messages[capability]||'段落资源不存在、未抓取或不属于当前候选');
      return {documents:selected.map((item)=>({id:item.id,content:item.content})),query:sanitizeQuery(args?.query,500),k:clampInt(args?.k,1,8,6)};
    },
  },
});

// 能力 → resourceKind 档案映射（静态权威表）
export const CAPABILITY_RESOURCE_PROFILE=Object.freeze({
  'filesystem.project.read':'project-path',
  'content.url.fetch':'url-fetch',
  'content.document.search':'document-root',
  'content.repository.inspect':'github-url',
  'content.passage.retrieve':'passage-content',
});

// 阶段 3：目录条目（config/capabilities.json）声明的 resourceKind 派生映射。
// 直读 JSON 防依赖环（同 entry-capabilities.mjs 惯例）；文件缺失返回 {}（嵌入式/测试工作区回退）。
// 合并规则：静态表优先——catalog 为静态表内能力声明了不同的 resourceKind 时报错（冲突即配置错误）；
// 相同则视为冗余声明忽略；静态表外能力的合法声明全部采纳。
export function resolveCatalogResourceProfiles(root){
  const file=path.join(root,'config','capabilities.json');
  if(!fs.existsSync(file))return {};
  const parsed=JSON.parse(fs.readFileSync(file,'utf8'));
  const profiles={};
  for(const [id,value] of Object.entries(parsed.capabilities||{})){
    const kind=value?.resourceKind==null?null:String(value.resourceKind);
    if(!kind)continue;
    if(!RESOURCE_KIND_PROFILES[kind])throw new Error(`能力目录条目 resourceKind 无效：${id}（${kind}），合法取值：${Object.keys(RESOURCE_KIND_PROFILES).join(', ')}`);
    const staticProfile=CAPABILITY_RESOURCE_PROFILE[id];
    if(staticProfile){
      if(staticProfile!==kind)throw new Error(`能力 ${id} 的目录 resourceKind（${kind}）与静态档案映射（${staticProfile}）冲突`);
      continue;
    }
    profiles[id]=kind;
  }
  return profiles;
}

// 静态映射 ∪ catalog 映射（静态优先，已由 resolveCatalogResourceProfiles 排除冲突）
export function mergedResourceProfiles(catalogProfiles={}){return {...catalogProfiles,...CAPABILITY_RESOURCE_PROFILE};}

// 通用 capability 参数转换 + 本次请求授权检查。
// options.messages：capability → 拒绝文案的映射（来自 config/agent-adaptation-messages.json 的 agent 条目）；
// options.searchMaxResults：false 时搜索类能力不附加 maxResults（编辑室现状），数值时按 1..n 截断；
// options.profiles：静态 ∪ catalog 的合并映射（buildAdaptation 装配时注入），缺省仅用静态表（旧调用方兼容）。
export function resolveResourceArguments(args,request,{resources,workspaceRoot,messages={},searchMaxResults=5,profiles}={}){
  const profile=RESOURCE_KIND_PROFILES[(profiles||CAPABILITY_RESOURCE_PROFILE)[request.capability]];
  if(profile){
    const resource=resources.get(String(args?.resourceId||''));
    return profile.resolve(resource,args,{resources,workspaceRoot,messages,capability:request.capability});
  }
  switch(request.capability){
    case 'content.web.search':
    case 'content.news.search':{
      const query=sanitizeQuery(args?.query,300);
      return searchMaxResults===false?{...args,query}:{...args,query,maxResults:clampInt(args?.maxResults,1,searchMaxResults,5)};
    }
    default:return args;
  }
}

// 通用结果裁剪：本地项目读取只保留摘要字段（本地绝对路径不额外扩散；path 为文件相对/授权内路径）
export function trimProjectReadResult(result){
  if(result?.status!=='ok')return result;
  const {data}=result;
  return {...result,data:{summary:data.summary,files:(data.files||[]).map(({path,size,excerpt,truncated})=>({path,size,excerpt,truncated})),totalFiles:data.totalFiles,totalChars:data.totalChars,truncated:data.truncated,skipped:data.skipped}};
}

// 通用清洗分发：业务解释（事实附件、【素材】升级判定）不在此层
export function sanitizeCapabilityResult(result,request){
  return request.capability==='filesystem.project.read'?trimProjectReadResult(result):result;
}

// 确定性前置 ToolRequest（deterministic-first-step）：用户明确给出本地项目时首步发起读取
export function deterministicProjectReadRequest({resources,skip=false,note,reason}={}){
  if(skip||!resources.has('project:current'))return null;
  return {type:'tool_requests',assistant_note:note,requests:[{requestId:'tr_project_current',capability:'filesystem.project.read',arguments:{resourceId:'project:current'},reason}]};
}

// 结果 data 中的 http(s) URL 收集（原 custom-social-adapter 的 sourceUrls，字段与过滤规则不变）
export function collectResultSourceUrls(data){return [...new Set([data?.url,data?.final_url,data?.sourceUrl,...(data?.results||[]).map((item)=>item.url),...(data?.documents||[]).map((item)=>item.url)].filter((url)=>/^https?:\/\//i.test(String(url))))];}

// tutorial 项目附件的指纹参数（sha256 pathKey；原 tutorial-adapter 上移，Adapter 再导出兼容）
const pathKey=(value)=>crypto.createHash('sha256').update(String(value||'')).digest('hex');
export const tutorialProjectAttachmentArguments=(value)=>({pathKey:pathKey(value)});

// 阶段 2：Schema 注入通用化。仅对 bindings 声明列出的能力注入对应档案的输入 Schema——
// 未声明的资源类能力保持目录原样（tutorial/custom-social 的 passage.retrieve 现状即不注入）。
// 阶段 3 追加：root 传入时读取目录 resourceKind 声明，声明了 resourceKind 的能力自动注入对应档案
// Schema（新能力的默认路径不需要 Adapter 在 bindings 里加项）；存量五能力无 catalog 声明，不受影响。
export function applyCatalogSchemas(catalog,bindings=[],root){
  const bound=new Set(bindings),catalogProfiles=root?resolveCatalogResourceProfiles(root):{};
  return catalog.map((item)=>{
    const profileName=CAPABILITY_RESOURCE_PROFILE[item.capability]||catalogProfiles[item.capability];
    const profile=RESOURCE_KIND_PROFILES[profileName];
    return (bound.has(item.capability)||catalogProfiles[item.capability])&&profile?{...item,inputSchema:profile.schema}:item;
  });
}

// 阶段 4：资源来源条目的运行时值自取（调用方只给一个标准 inputs 对象）。
// materials 的合并/去重/截断语义即 mergeMaterialUrls 现状（limit 来自声明条目，缺省 5）。
const SOURCE_INPUT_VALUE={
  materials:(inputs,{limit}={})=>mergeMaterialUrls(inputs.materialUrls,inputs.answer,limit??5),
  documentRoots:(inputs)=>inputs.documentRoots,
  project:(inputs)=>inputs.projectPath,
  hotspotSources:(inputs)=>inputs.events,
  candidateUrls:(inputs)=>inputs.suppliedUrls,
};

// 阶段 4：Agent 适配声明从登记条目读取（直读 JSON 防环，同 entry-capabilities 惯例）。
// 返回 {resourceSources, resultHandlers, defaultResultHandler, handlerOptions} 或 null
// （文件缺失 / 消费者不存在 / 无 adaptation 字段 → null，调用方回退内联声明）。
// 非法 source/handler 名启动报错（校验在读取处）。
export function loadAgentAdaptation(root,consumerId){
  const file=path.join(root,'config','capability-consumers.json');
  if(!fs.existsSync(file))return null;
  const parsed=JSON.parse(fs.readFileSync(file,'utf8'));
  const consumer=(parsed.consumers||[]).find((item)=>item.id===consumerId&&item.type==='agent');
  const adaptation=consumer?.adaptation;
  if(!adaptation)return null;
  const resourceSources=adaptation.resourceSources||[];
  if(!Array.isArray(resourceSources))throw new Error(`${consumerId}: adaptation.resourceSources 必须是数组`);
  for(const entry of resourceSources){
    if(!RESOURCE_SOURCE_REGISTRARS[entry?.source])throw new Error(`${consumerId}: adaptation 引用了未知资源注册器：${entry?.source}`);
    if(entry.limit!==undefined&&!(Number.isInteger(entry.limit)&&entry.limit>0))throw new Error(`${consumerId}: adaptation ${entry.source} 的 limit 无效`);
  }
  const resultHandlers=adaptation.resultHandlers||{};
  for(const [capability,name] of Object.entries(resultHandlers))
    if(!RESULT_HANDLERS[name])throw new Error(`${consumerId}: adaptation 引用了未知结果处理器：${capability} → ${name}`);
  const defaultResultHandler=adaptation.defaultResultHandler||'sanitize-only';
  if(!RESULT_HANDLERS[defaultResultHandler])throw new Error(`${consumerId}: adaptation 的默认结果处理器未知：${defaultResultHandler}`);
  return {resourceSources,resultHandlers,defaultResultHandler,handlerOptions:adaptation.handlerOptions||{}};
}

export function requireAgentAdaptation(root,consumerId){
  const adaptation=loadAgentAdaptation(root,consumerId);
  if(!adaptation)throw new Error(`${consumerId} 缺少统一 adaptation 配置，请先在 config/capability-consumers.json 中完成登记`);
  return adaptation;
}

// 阶段 5：授权拒绝文案外置到 config/agent-adaptation-messages.json，按 consumerId + capability 二维维护
// （直读 JSON 防环，同 loadAgentAdaptation 惯例）；文件缺失/无该 agent 条目返回 {}，
// 档案内联兜底字符串为最终回退（嵌入式/测试工作区）。
export function loadAdaptationMessages(root,consumerId){
  const file=path.join(root,'config','agent-adaptation-messages.json');
  if(!fs.existsSync(file))return {};
  return (JSON.parse(fs.readFileSync(file,'utf8')).messages||{})[consumerId]||{};
}

// 阶段 2：声明 + 通用装配；阶段 4：声明来自 config（loadAgentAdaptation），Adapter 只给 inputs。
// sources 按声明顺序逐个调 RESOURCE_SOURCE_REGISTRARS 构建资源目录（值按 source 名从 inputs 自取，
// 缺来源的输入即空值，注册器自身容错跳过）；
// resolveArguments/sanitizeToolResult 为 runConversationAgent 的同名钩子闭包；
// state 为可变对象，handler 的副作用（projectContext、externalSources）写在这里。
// 阶段 3：装配时读一次目录 resourceKind 映射（静态优先合并）缓存进 resolveArguments 闭包。
// 阶段 5：拒绝文案按 consumerId 从 config 读取（capability → 文案），配置未覆盖的由档案内联兜底。
export function buildAdaptation({adaptation={},inputs={},workspaceRoot,store,batchId,consumerId,searchMaxResults=5}={}){
  const {resourceSources=[],resultHandlers={},defaultResultHandler='sanitize-only',handlerOptions={}}=adaptation;
  const messages=workspaceRoot&&consumerId?loadAdaptationMessages(workspaceRoot,consumerId):{};
  const resources=new Map(),state={},profiles=mergedResourceProfiles(workspaceRoot?resolveCatalogResourceProfiles(workspaceRoot):{});
  for(const entry of resourceSources){
    const registrar=RESOURCE_SOURCE_REGISTRARS[entry.source];
    if(!registrar)throw new Error(`未知资源注册器：${entry.source}`);
    registrar(resources,SOURCE_INPUT_VALUE[entry.source](inputs,entry));
  }
  if(handlerOptions.collectSources)state.externalSources=new Set();
  return {
    resources,
    state,
    resolveArguments:(args,request)=>resolveResourceArguments(args,request,{resources,workspaceRoot,messages,searchMaxResults,profiles}),
    sanitizeToolResult:(result,request,{agentRunId}={})=>{
      const handler=RESULT_HANDLERS[resultHandlers[request.capability]||defaultResultHandler];
      if(!handler)throw new Error(`未知结果处理器：${resultHandlers[request.capability]||defaultResultHandler}`);
      return handler(result,request,{store,batchId,agentRunId,state,options:handlerOptions,inputs,resources});
    },
  };
}

// 结果处理器注册表（阶段 1 代码内注册表）。
// ctx 形态：{store, batchId, agentRunId, state, options, inputs, resources}；state 为 buildAdaptation 提供的可变对象
// （projectContext、externalSources 副作用写在这里），inputs 为调用方运行时输入值。
// options：fact-attachment 支持 entryPoint/collectSources；project-fact-attachment 的附件参数
// 由 handler 内部用 tutorialProjectAttachmentArguments(inputs.projectPath) 自取（sha256 pathKey）。
// 非 ok 结果一律直接返回不处理。
export const RESULT_HANDLERS=Object.freeze({
  'sanitize-only':(result,request)=>sanitizeCapabilityResult(result,request),
  'fact-attachment':(result,request,{store,batchId,agentRunId,state,options={},resources}={})=>{
    if(result?.status!=='ok')return result;
    const trimmed=sanitizeCapabilityResult(result,request),data={...trimmed.data,_agentQuery:String(request.arguments?.query||'')};
    // passage content 回填（设计文档 §13）：tutorial/custom-social 的素材资源注册时不含正文，
    // url.fetch 成功后把正文写回资源目录条目，后续 passage.retrieve 的 resourceIds 即可走严格分支
    if(request.capability==='content.url.fetch'){
      const resource=resources?.get(String(request.arguments?.resourceId||'')),content=String(data.content||data.text||data.excerpt||'');
      if(resource&&!resource.content&&content)resource.content=content;
    }
    if(options.collectSources)for(const url of collectResultSourceUrls(data))state?.externalSources?.add(url);
    saveFactAttachment(store,{batchId,...(options.entryPoint?{entryPoint:options.entryPoint}:{}),capability:request.capability,arguments:request.arguments,agentRunId,data});
    return {...trimmed,data};
  },
  'project-fact-attachment':(result,request,{store,batchId,agentRunId,state,inputs={}}={})=>{
    if(result?.status!=='ok')return result;
    const trimmed=sanitizeCapabilityResult(result,request);
    if(state)state.projectContext=trimmed.data;
    saveFactAttachment(store,{batchId,capability:request.capability,arguments:tutorialProjectAttachmentArguments(inputs.projectPath),agentRunId,data:trimmed.data});
    return trimmed;
  },
});
