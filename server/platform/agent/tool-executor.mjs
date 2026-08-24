import { visibleCapabilitySet } from './tool-catalog.mjs';
import { toolError, toolSuccess } from './tool-protocol.mjs';
import { createStoreExecutionLogger } from '../tools/execution-log.mjs';

const ERROR_MAP={DEPENDENCY_MISSING:'TOOL_DEPENDENCY_MISSING',PERMISSION_DENIED:'TOOL_PERMISSION_DENIED',PATH_OUTSIDE_ALLOWED_ROOTS:'RESOURCE_NOT_ALLOWED',INVALID_INPUT:'INVALID_TOOL_ARGUMENTS',TIMEOUT:'TOOL_TIMEOUT',OUTPUT_INVALID:'TOOL_OUTPUT_INVALID'};

export async function executeConversationTool(request,{registry,catalog,context={},resolveArguments=(value)=>value,cacheLookup=null,onEvent=()=>{}}={}){
  if(!visibleCapabilitySet(catalog).has(request.capability))return toolError(request,'CAPABILITY_NOT_VISIBLE',`当前对话未授权能力：${request.capability}`,false);
  let args;try{args=await resolveArguments(request.arguments,request);}catch(error){return toolError(request,error.code==='RESOURCE_NOT_ALLOWED'?'RESOURCE_NOT_ALLOWED':'INVALID_TOOL_ARGUMENTS',error.message,false);}
  onEvent('tool.running',{requestId:request.requestId,capability:request.capability});
  // 可选缓存短路（由 Adapter 注入，如编辑室复用已抓取来源正文）；查询失败不阻断真实执行
  if(typeof cacheLookup==='function'){
    let cached=null;try{cached=await cacheLookup(request,args);}catch{cached=null;}
    if(cached?.status==='ok')return toolSuccess(request,cached);
  }
  const executionLog=context.executionLog||createStoreExecutionLogger(context.store,context);
  let result;try{result=await registry.execute(request.capability,args,{...context,executionLog,authorizedExternalWrite:false});}catch(error){return toolError(request,'TOOL_EXECUTION_FAILED',error.message,false);}
  if(result?.status==='ok')return toolSuccess(request,result);
  const code=ERROR_MAP[result?.error?.code]||'TOOL_EXECUTION_FAILED';
  return toolError(request,code,result?.error?.message||'工具执行失败',Boolean(result?.error?.retryable));
}
