import { CONVERSATION_AGENT_BUDGET_DEFAULTS, CONVERSATION_AGENT_BUDGET_LIMITS } from './contracts.mjs';
import { compactAgentHistory, compactToolResult, toolCallFingerprint } from './context.mjs';
import { agentEvent } from './events.mjs';
import { AgentContractError, normalizeAgentEnvelope, validateAgentEnvelope, toolError } from './tool-protocol.mjs';
import { executeConversationTool } from './tool-executor.mjs';
import { capabilityForToolName } from './tool-catalog.mjs';
import { CONVERSATION_FINISH_CAPABILITY } from './conversation-finish-tool.mjs';

function budgets(input={}){const out={};for(const [key,value] of Object.entries(CONVERSATION_AGENT_BUDGET_DEFAULTS))out[key]=Math.min(CONVERSATION_AGENT_BUDGET_LIMITS[key],Math.max(1,Number(input[key])||value));return Object.freeze(out);}
function runId(){return `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;}
function withTimeout(promise,timeoutMs){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new AgentContractError('AGENT_BUDGET_EXCEEDED',`Agent 已超过总耗时预算（${timeoutMs}ms）`)),timeoutMs);Promise.resolve(promise).then((value)=>{clearTimeout(timer);resolve(value);},(error)=>{clearTimeout(timer);reject(error);});});}
function completedEvent(result){const data=result?.data||{},url=data.final_url||data.url||result?.provenance?.finalUrl||result?.provenance?.requestedUrl,title=data.title||'',chars=String(data.content||data.excerpt||data.text||'').length;return {summary:chars?`已读取 ${chars} 字`:title?'资料读取完成':'工具执行完成',sources:url?[{title,url}]:[]};}
function nativeRequestId(call,index){const value=String(call?.id||`call_${index+1}`).replace(/[^A-Za-z0-9_-]/g,'_');return `tr_native_${value}_${index+1}`.slice(0,63);}
function nativeToolEnvelope(modelTurn,catalog,maxRequests){
  const calls=Array.isArray(modelTurn?.toolCalls)?modelTurn.toolCalls:[];
  if(!calls.length)return null;
  if(calls.length>maxRequests)throw new AgentContractError('INVALID_AGENT_ENVELOPE',`原生工具调用数量超过上限：${calls.length}`);
  const callByRequestId=new Map();
  const requests=calls.map((call,index)=>{
    const requestId=nativeRequestId(call,index);
    const capability=capabilityForToolName(call?.name,catalog)||'model.unknown-tool';
    const request={requestId,capability,arguments:call?.input&&typeof call.input==='object'&&!Array.isArray(call.input)?call.input:{},reason:'模型原生工具调用'};
    callByRequestId.set(requestId,call);
    return request;
  });
  return {envelope:{type:'tool_requests',assistant_note:'执行模型原生工具调用',requests},callByRequestId};
}
function nativeHistory(modelTurn,results,callByRequestId){
  const calls=Array.isArray(modelTurn?.toolCalls)?modelTurn.toolCalls:[];
  return [
    {role:'assistant',content:modelTurn.content?String(modelTurn.content):null,tool_calls:calls.map((call,index)=>({id:String(call.id||`call_${index+1}`),type:'function',function:{name:String(call.name||''),arguments:JSON.stringify(call.input||{})}})),protected:true},
    ...results.map((result)=>{const call=callByRequestId.get(result.requestId);return {role:'tool',tool_call_id:String(call?.id||result.requestId),name:call?.name?String(call.name):undefined,content:JSON.stringify(result),protected:true};}),
  ];
}

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
      const modelEnvelope=await withTimeout(modelStep({entryPoint,messages:modelHistory,catalog,step,signal,emit}),remaining);
      const native = nativeToolEnvelope(modelEnvelope,catalog,limits.maxParallelToolCalls);
      // 对话 Agent 可以在没有业务工具需求时直接返回普通文本。
      // 普通文本只作为本轮回复，不再回退到旧 JSON 信封解析；若模型主动调用
      // agent.conversation.finish，则仍按显式结束工具处理。
      if (modelEnvelope?.nativeTools === true && !native) {
        const assistantReply = String(modelEnvelope.content || '').trim();
        if (assistantReply) {
          store?.finishAgentRun?.(id, { status: 'completed', modelSteps: step + 1, toolCalls });
          emit('done', { status: 'completed' });
          return { agentRunId: id, type: 'final', assistantReply, output: {}, modelSteps: step + 1, toolCalls };
        }
        throw new AgentContractError('EMPTY_AGENT_REPLY', '模型未返回工具调用或有效文本回复');
      }
      const envelope=native?.envelope||validateAgentEnvelope(normalizeAgentEnvelope(modelEnvelope),{maxRequests:limits.maxParallelToolCalls});
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
        // 显式结束也是业务工具调用，而不是模型输出中的 final JSON。
        // 允许同一轮先写表单再结束；所有同组工具执行完后再提交最终回复。
        const finishEntries = group
          .map((request, index) => ({ request, result: groupResults[index] }))
          .filter(({ request }) => request.capability === CONVERSATION_FINISH_CAPABILITY);
        const successfulFinish = finishEntries.find(({ result }) => result?.status === 'ok');
        if (successfulFinish) {
          const assistantReply = String(successfulFinish.result.data?.assistantReply || '').trim();
          if (!assistantReply) throw new AgentContractError('INVALID_AGENT_ENVELOPE', '结束工具未返回有效 assistantReply');
          store?.finishAgentRun?.(id,{status:'completed',modelSteps:step+1,toolCalls});
          emit('done',{status:'completed'});
          return {agentRunId:id,type:'final',assistantReply,output:{},modelSteps:step+1,toolCalls};
        }
      }
      if(native) history.push(...nativeHistory(modelEnvelope,results,native.callByRequestId));
      else history.push({role:'assistant',content:JSON.stringify(envelope),protected:true},{role:'tool',content:JSON.stringify(results),protected:true});
      if(totalResultChars>=limits.maxTotalToolResultChars){store?.finishAgentRun?.(id,{status:'limit',modelSteps:step+1,toolCalls,error:'达到工具结果字符预算'});emit('agent.limit',{reason:'达到工具结果字符预算'});return {agentRunId:id,type:'limit',modelSteps:step+1,toolCalls,messages:history};}
    }
    store?.finishAgentRun?.(id,{status:'limit',modelSteps:limits.maxModelSteps,toolCalls,error:'达到模型步骤预算'});emit('agent.limit',{reason:'达到模型步骤预算'});
    return {agentRunId:id,type:'limit',modelSteps:limits.maxModelSteps,toolCalls,messages:history};
  }catch(error){store?.finishAgentRun?.(id,{status:error.code==='AGENT_ABORTED'?'aborted':'failed',toolCalls,error:error.message});emit('error',{code:error.code||'INVALID_AGENT_ENVELOPE',message:error.message});throw error;}
}
