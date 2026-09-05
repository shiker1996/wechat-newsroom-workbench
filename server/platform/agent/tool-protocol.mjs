import { CONVERSATION_AGENT_ERROR_CODES } from './contracts.mjs';

const ERROR_CODES=new Set(CONVERSATION_AGENT_ERROR_CODES);
const CAPABILITY=/^cap_[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$/;
const REQUEST_ID=/^tr_[A-Za-z0-9_-]{1,61}$/;
const object=(value)=>value&&typeof value==='object'&&!Array.isArray(value);

export class AgentContractError extends Error{
  constructor(code,message,issues=[]){super(message);this.name='AgentContractError';this.code=ERROR_CODES.has(code)?code:'INVALID_AGENT_ENVELOPE';this.issues=issues;}
}

// 模型生成的工具理由只是可观测性说明，不应因为说明过长阻断实际工具调用。
// 调用方在进入严格校验前可使用此函数做边界归一化；协议本身仍保持 1–160 字符约束。
export function normalizeToolRequest(value,{fallbackReason='执行工具调用'}={}){
  if(!object(value))return value;
  const reason=String(value.reason??'').trim()||fallbackReason;
  return {...value,reason:[...reason].slice(0,160).join('')};
}

// assistant_note 和 reason 只用于过程可观测性，不改变工具路由或写入语义。
// 统一在严格校验前补齐，避免每个 Agent 都重复处理模型省略的说明字段。
export function normalizeAgentEnvelope(value,{fallbackAssistantNote='执行工具调用',fallbackReason='执行工具调用'}={}){
  if(!object(value)||value.type!=='tool_requests')return value;
  const normalized={...value};
  if(!Object.prototype.hasOwnProperty.call(normalized,'assistant_note'))normalized.assistant_note=fallbackAssistantNote;
  if(Array.isArray(normalized.requests))normalized.requests=normalized.requests.map((request)=>normalizeToolRequest(request,{fallbackReason}));
  return normalized;
}

function exactKeys(value,allowed,path){
  const unknown=Object.keys(value).filter((key)=>!allowed.includes(key));
  if(unknown.length)throw new AgentContractError('INVALID_AGENT_ENVELOPE',`${path} 包含未知字段：${unknown.join('、')}`,unknown.map((field)=>({path:`${path}.${field}`,code:'UNKNOWN_FIELD'})));
}

export function validateToolRequest(value){
  if(!object(value))throw new AgentContractError('INVALID_AGENT_ENVELOPE','ToolRequest 必须是对象');
  exactKeys(value,['requestId','capability','arguments','reason'],'request');
  if(!REQUEST_ID.test(String(value.requestId||'')))throw new AgentContractError('INVALID_AGENT_ENVELOPE','ToolRequest requestId 无效');
  if(!CAPABILITY.test(String(value.capability||''))||String(value.capability).length>120)throw new AgentContractError('INVALID_AGENT_ENVELOPE','ToolRequest capability 无效');
  if(!object(value.arguments))throw new AgentContractError('INVALID_AGENT_ENVELOPE','ToolRequest arguments 必须是对象');
  const reason=String(value.reason||'').trim();if(!reason||reason.length>160)throw new AgentContractError('INVALID_AGENT_ENVELOPE','ToolRequest reason 长度必须为 1–160');
  return Object.freeze({requestId:String(value.requestId),capability:String(value.capability),arguments:structuredClone(value.arguments),reason});
}

export function validateAgentEnvelope(value,{maxRequests=4}={}){
  value=normalizeAgentEnvelope(value);
  if(!object(value))throw new AgentContractError('INVALID_AGENT_ENVELOPE','AgentEnvelope 必须是对象');
  if(value.type==='final'){
    // final 打平：业务字段直接平铺在信封顶层，协议只强制 type+assistantReply；
    // output 契约保持不变（= 信封内除 type 外的全部业务字段，assistantReply 同时保留在 output 内）。
    // 兼容旧嵌套格式 {"type":"final","assistantReply":"...","output":{业务对象}}：仅有 output 一个业务字段时展开之。
    if(typeof value.assistantReply!=='string')throw new AgentContractError('INVALID_AGENT_ENVELOPE','final 响应缺少 assistantReply');
    if('requests' in value)throw new AgentContractError('INVALID_AGENT_ENVELOPE','final 响应不得包含 requests 字段（final 与 tool_requests 不得混写）');
    const {type,...rest}=value;
    const businessKeys=Object.keys(rest).filter((key)=>key!=='assistantReply');
    const legacyNested=businessKeys.length===1&&businessKeys[0]==='output'&&object(rest.output);
    const output=legacyNested?rest.output:rest;
    return Object.freeze({type:'final',assistantReply:value.assistantReply,output:structuredClone(output)});
  }
  if(value.type==='tool_requests'){
    exactKeys(value,['type','assistant_note','requests'],'envelope');
    if(typeof value.assistant_note!=='string'||value.assistant_note.length>300)throw new AgentContractError('INVALID_AGENT_ENVELOPE','assistant_note 无效');
    if(!Array.isArray(value.requests)||!value.requests.length||value.requests.length>maxRequests)throw new AgentContractError('INVALID_AGENT_ENVELOPE',`requests 数量必须为 1–${maxRequests}`);
    const requests=value.requests.map(validateToolRequest),ids=new Set();
    for(const request of requests){if(ids.has(request.requestId))throw new AgentContractError('INVALID_AGENT_ENVELOPE',`requestId 重复：${request.requestId}`);ids.add(request.requestId);}
    return Object.freeze({type:'tool_requests',assistant_note:value.assistant_note,requests:Object.freeze(requests)});
  }
  throw new AgentContractError('INVALID_AGENT_ENVELOPE','AgentEnvelope type 必须是 final 或 tool_requests');
}

export function toolError(request,code,message,retryable=false){return Object.freeze({requestId:request.requestId,capability:request.capability,status:'error',error:{code:ERROR_CODES.has(code)?code:'TOOL_EXECUTION_FAILED',message:String(message||'工具执行失败'),retryable:Boolean(retryable)}});}

export function toolSuccess(request,result){return Object.freeze({requestId:request.requestId,capability:request.capability,status:'ok',data:structuredClone(result.data||{}),warnings:(result.warnings||[]).map(String),provenance:{provider:String(result.provenance?.provider||result.provenance?.plugin||''),fetchedAt:new Date().toISOString()}});}
