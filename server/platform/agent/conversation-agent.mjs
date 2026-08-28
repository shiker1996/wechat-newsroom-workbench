import { CONVERSATION_AGENT_BUDGET_DEFAULTS, CONVERSATION_AGENT_BUDGET_LIMITS } from './contracts.mjs';
import { compactAgentHistory, compactToolResult, toolCallFingerprint } from './context.mjs';
import { agentEvent } from './events.mjs';
import { AgentContractError, validateAgentEnvelope, toolError } from './tool-protocol.mjs';
import { executeConversationTool } from './tool-executor.mjs';

function budgets(input={}){const out={};for(const [key,value] of Object.entries(CONVERSATION_AGENT_BUDGET_DEFAULTS))out[key]=Math.min(CONVERSATION_AGENT_BUDGET_LIMITS[key],Math.max(1,Number(input[key])||value));return Object.freeze(out);}
function runId(){return `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;}
function withTimeout(promise,timeoutMs){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new AgentContractError('AGENT_BUDGET_EXCEEDED',`Agent 已超过总耗时预算（${timeoutMs}ms）`)),timeoutMs);Promise.resolve(promise).then((value)=>{clearTimeout(timer);resolve(value);},(error)=>{clearTimeout(timer);reject(error);});});}
function completedEvent(result){const data=result?.data||{},url=data.final_url||data.url||result?.provenance?.finalUrl||result?.provenance?.requestedUrl,title=data.title||'',chars=String(data.content||data.excerpt||data.text||'').length;return {summary:chars?`已读取 ${chars} 字`:title?'资料读取完成':'工具执行完成',sources:url?[{title,url}]:[]};}

export async function runConversationAgent({entryPoint,modelStep,messages=[],registry,catalog,toolContext={},resolveArguments,sanitizeToolResult=(result)=>result,cacheLookup=null,onEvent=()=>{},store=null,budget={},signal=null}={}){
  if(typeof modelStep!=='function')throw new TypeError('modelStep 必须是函数');
  const limits=budgets(budget),id=runId(),started=Date.now(),history=[...messages],seen=new Map();let toolCalls=0,totalResultChars=0;
  store?.startAgentRun?.({id,entryPoint,...toolContext});
  const emit=(type,payload={})=>onEvent(agentEvent(type,{agentRunId:id,...payload}));
  try{
    for(let step=0;step<limits.maxModelSteps;step+=1){
      if(signal?.aborted)throw new AgentContractError('AGENT_ABORTED','Agent 已取消');
      if(Date.now()-started>limits.timeoutMs)throw new AgentContractError('AGENT_BUDGET_EXCEEDED',`Agent 已超过总耗时预算（${limits.timeoutMs}ms）`);
      const remaining=Math.max(1,limits.timeoutMs-(Date.now()-started));
      const modelHistory=compactAgentHistory(history,limits.maxHistoryChars);
      const envelope=validateAgentEnvelope(await withTimeout(modelStep({entryPoint,messages:modelHistory,catalog,step,signal,emit}),remaining),{maxRequests:limits.maxParallelToolCalls});
      if(envelope.type==='final'){
        store?.finishAgentRun?.(id,{status:'completed',modelSteps:step+1,toolCalls});
        emit('done',{status:'completed'});return {agentRunId:id,...envelope,modelSteps:step+1,toolCalls};
      }
      const results=[];
      for(let offset=0;offset<envelope.requests.length;offset+=limits.maxParallelToolCalls){
        const group=envelope.requests.slice(offset,offset+limits.maxParallelToolCalls);
        const groupResults=await Promise.all(group.map(async(request)=>{
          emit('tool.requested',{requestId:request.requestId,capability:request.capability,reason:request.reason});
          const fingerprint=toolCallFingerprint(request),count=seen.get(fingerprint)||0;seen.set(fingerprint,count+1);
          store?.startAgentToolCall?.({agentRunId:id,request});let result;
          if(count>=limits.maxDuplicateCalls)result=toolError(request,'AGENT_BUDGET_EXCEEDED','相同工具与参数在本轮中不得重复调用',false);
          else if(!(catalog||[]).some((item)=>item.capability===request.capability))result=toolError(request,'CAPABILITY_NOT_VISIBLE',`当前对话未授权能力：${request.capability}`,false);
          else if(toolCalls>=limits.maxToolCalls)result=toolError(request,'AGENT_BUDGET_EXCEEDED','已达到工具调用预算',false);
          else {toolCalls+=1;result=await executeConversationTool(request,{registry,catalog,context:{...toolContext,store,signal},resolveArguments,cacheLookup,onEvent:(type,payload)=>emit(type,payload)});result=await sanitizeToolResult(result,request,{agentRunId:id});}
          result=compactToolResult(result,Math.min(limits.maxToolResultChars,Math.max(256,limits.maxTotalToolResultChars-totalResultChars)));totalResultChars+=JSON.stringify(result).length;store?.finishAgentToolCall?.({agentRunId:id,request,result});
          emit(result.status==='ok'?'tool.completed':'tool.failed',{requestId:request.requestId,capability:request.capability,status:result.status,error:result.error,...(result.status==='ok'?completedEvent(result):{})});return result;
        }));
        results.push(...groupResults);
      }
      history.push({role:'assistant',content:JSON.stringify(envelope),protected:true},{role:'tool',content:JSON.stringify(results),protected:true});
      if(totalResultChars>=limits.maxTotalToolResultChars){store?.finishAgentRun?.(id,{status:'limit',modelSteps:step+1,toolCalls,error:'达到工具结果字符预算'});emit('agent.limit',{reason:'达到工具结果字符预算'});return {agentRunId:id,type:'limit',modelSteps:step+1,toolCalls,messages:history};}
    }
    store?.finishAgentRun?.(id,{status:'limit',modelSteps:limits.maxModelSteps,toolCalls,error:'达到模型步骤预算'});emit('agent.limit',{reason:'达到模型步骤预算'});
    return {agentRunId:id,type:'limit',modelSteps:limits.maxModelSteps,toolCalls,messages:history};
  }catch(error){store?.finishAgentRun?.(id,{status:error.code==='AGENT_ABORTED'?'aborted':'failed',toolCalls,error:error.message});emit('error',{code:error.code||'INVALID_AGENT_ENVELOPE',message:error.message});throw error;}
}
