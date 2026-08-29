import { repairJsonSyntaxOnly, stripJsonFence } from './model-json-repair.mjs';

export { stripJsonFence } from './model-json-repair.mjs';

export const MODEL_JSON_ERROR_CODES=Object.freeze({TRUNCATED:'MODEL_JSON_TRUNCATED',INVALID:'MODEL_JSON_INVALID',REPAIR_FAILED:'MODEL_JSON_REPAIR_FAILED'});

export class ModelJsonError extends Error{constructor(code,message,{cause,raw=''}={}){super(message,{cause});this.name='ModelJsonError';this.code=code;this.raw=raw;}}

export function parseJsonText(value){return JSON.parse(stripJsonFence(value));}

export function locateJsonValue(value){const text=stripJsonFence(value);for(let start=0;start<text.length;start+=1){if(!'{['.includes(text[start]))continue;const stack=[];let quoted=false,escaped=false;for(let index=start;index<text.length;index+=1){const char=text[index];if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}if(char==='"'){quoted=true;continue;}if(char==='{'||char==='[')stack.push(char);else if(char==='}'||char===']'){const open=stack.pop();if((open==='{'&&char!=='}')||(open==='['&&char!==']'))break;if(!stack.length)return {text:text.slice(start,index+1),truncated:false};}}if(stack.length||quoted)return {text:text.slice(start),truncated:true};}return {text,truncated:false};}

export function parseModelJson(result,{store=null,label='模型',allowMissingToolRequestReason=false,allowMissingToolRequestAssistantNote=false}={}){const raw=String(result?.content??result??'');const located=locateJsonValue(raw);try{let jsonText=located.text;if(located.truncated){jsonText=repairJsonSyntaxOnly(jsonText,{allowMissingToolRequestReason,allowMissingToolRequestAssistantNote})?.text||null;}if(!jsonText||(result?.finishReason==='length'||result?.finish_reason==='length')&&!located.truncated)throw new ModelJsonError(MODEL_JSON_ERROR_CODES.TRUNCATED,`${label}输出达到上限，JSON 被截断或结构未闭合`,{raw});const parsed=JSON.parse(jsonText);if(!parsed||typeof parsed!=='object')throw new Error('顶层必须是对象或数组');return parsed;}catch(error){const normalized=error instanceof ModelJsonError?error:new ModelJsonError(MODEL_JSON_ERROR_CODES.INVALID,`${label}返回无效 JSON：${error.message}`,{cause:error,raw});if(store&&result?.callId!=null)store.updateModelCall(result.callId,{status:'invalid_output',error:`[${normalized.code}] ${normalized.message}`});throw normalized;}}

export async function parseModelJsonWithRepair(result,{repair,maxRepairAttempts=1,...options}={}){
  let current=result;
  let firstError=null;
  for(let attempt=0;attempt<=Math.max(0,Number(maxRepairAttempts)||0);attempt+=1){
    try{return parseModelJson(current,options);}catch(error){
      if(!firstError)firstError=error;
      if(typeof repair!=='function'||attempt>=Math.max(0,Number(maxRepairAttempts)||0)){
        if(attempt===0)throw error;
        throw new ModelJsonError(MODEL_JSON_ERROR_CODES.REPAIR_FAILED,`${options.label||'模型'} JSON 结构修复失败：${error.message}`,{cause:error,raw:String(current?.content??'')});
      }
      current=await repair(error,{attempt:attempt+1,maxAttempts:Math.max(0,Number(maxRepairAttempts)||0),firstError});
    }
  }
  throw firstError;
}
