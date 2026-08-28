export const MODEL_JSON_ERROR_CODES=Object.freeze({TRUNCATED:'MODEL_JSON_TRUNCATED',INVALID:'MODEL_JSON_INVALID',REPAIR_FAILED:'MODEL_JSON_REPAIR_FAILED'});

export class ModelJsonError extends Error{constructor(code,message,{cause,raw=''}={}){super(message,{cause});this.name='ModelJsonError';this.code=code;this.raw=raw;}}

export function stripJsonFence(value){return String(value??'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'').trim();}
export function parseJsonText(value){return JSON.parse(stripJsonFence(value));}

export function locateJsonValue(value){const text=stripJsonFence(value);for(let start=0;start<text.length;start+=1){if(!'{['.includes(text[start]))continue;const stack=[];let quoted=false,escaped=false;for(let index=start;index<text.length;index+=1){const char=text[index];if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}if(char==='"'){quoted=true;continue;}if(char==='{'||char==='[')stack.push(char);else if(char==='}'||char===']'){const open=stack.pop();if((open==='{'&&char!=='}')||(open==='['&&char!==']'))break;if(!stack.length)return {text:text.slice(start,index+1),truncated:false};}}if(stack.length||quoted)return {text:text.slice(start),truncated:true};}return {text,truncated:false};}

function closeCompleteOuterObject(text){
  const value=String(text||'').trim();
  if(!value.endsWith(']'))return null;
  const stack=[];let quoted=false,escaped=false;
  for(const char of value){
    if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
    if(char==='"'){quoted=true;continue;}
    if(char==='{'||char==='[')stack.push(char);
    else if(char==='}'||char===']'){const open=stack.pop();if((open==='{'&&char!=='}')||(open==='['&&char!==']'))return null;}
  }
  // 模型常在输出上限处只漏掉最外层 tool_requests 对象的最后一个 "}"。
  // 仅允许这一种可证明安全的补全；若字符串或内部结构仍未闭合，继续报截断。
  return !quoted&&stack.length===1&&stack[0]==='{' ? `${value}}` : null;
}

function repairTruncatedToolRequest(text){
  const value=String(text||'').trim();
  if(!value.startsWith('{"type":"tool_requests"')||!value.includes('"pages":[{"page"')||!value.includes('"page_html"')||value.split('"}}],"reason"').length!==2||!value.endsWith('"}}]'))return null;
  // 部分模型在输出上限处会把 page 对象、pages 数组、patch/arguments 的闭合顺序写成 `}}]`，
  // 并在请求结尾再次写成 `}}]`。只修复这两个精确模式，绝不截短或猜测 HTML/CSS 内容。
  return value.replace('"}}],"reason"','"}]}},"reason"').replace(/"\}\}\]$/,'"}]}');
}

export function parseModelJson(result,{store=null,label='模型'}={}){const raw=String(result?.content??result??'');const located=locateJsonValue(raw);try{let jsonText=located.text;if(located.truncated){jsonText=closeCompleteOuterObject(jsonText)||repairTruncatedToolRequest(jsonText);}if(!jsonText)throw new ModelJsonError(MODEL_JSON_ERROR_CODES.TRUNCATED,`${label}输出达到上限，JSON 被截断或结构未闭合`,{raw});const parsed=JSON.parse(jsonText);if(!parsed||typeof parsed!=='object')throw new Error('顶层必须是对象或数组');return parsed;}catch(error){const normalized=error instanceof ModelJsonError?error:new ModelJsonError(MODEL_JSON_ERROR_CODES.INVALID,`${label}返回无效 JSON：${error.message}`,{cause:error,raw});if(store&&result?.callId!=null)store.updateModelCall(result.callId,{status:'invalid_output',error:`[${normalized.code}] ${normalized.message}`});throw normalized;}}

export async function parseModelJsonWithRepair(result,{repair,...options}={}){try{return parseModelJson(result,options);}catch(first){if(typeof repair!=='function')throw first;const repaired=await repair(first);try{return parseModelJson(repaired,options);}catch(second){throw new ModelJsonError(MODEL_JSON_ERROR_CODES.REPAIR_FAILED,`${options.label||'模型'} JSON 结构修复失败：${second.message}`,{cause:second,raw:String(repaired?.content??'')});}}}
