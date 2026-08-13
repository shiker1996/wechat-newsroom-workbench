export const TOOL_ERROR_CODES=Object.freeze(['INVALID_INPUT','PERMISSION_DENIED','PATH_OUTSIDE_ALLOWED_ROOTS','DEPENDENCY_MISSING','FETCH_FAILED','RENDER_FAILED','UPLOAD_FAILED','TIMEOUT','OUTPUT_INVALID','FIRST_RUN_CONFIRM_REQUIRED']);
export function ok(data={},extras={}){return {status:'ok',data,artifacts:[],provenance:{},warnings:[],metrics:{durationMs:0},...extras};}
export function failure(code,message,options={}){return {status:'error',error:{code:TOOL_ERROR_CODES.includes(code)?code:'OUTPUT_INVALID',message:String(message||'工具执行失败'),retryable:Boolean(options.retryable),...(options.action?{action:options.action}:{})}};}

function validateSchema(schema={},value,field='输入'){
  if(schema.type==='object'){
    if(!value||typeof value!=='object'||Array.isArray(value))return `${field}必须是对象`;
    for(const key of schema.required||[])if(value[key]===undefined||value[key]===null||value[key]==='')return `缺少必要参数：${field==='输入'?'':`${field}.`}${key}`;
    for(const [key,item] of Object.entries(value)){if(item===undefined)continue;const rule=schema.properties?.[key];if(!rule){if(schema.additionalProperties===false)return `${field}.${key} 不是允许的字段`;continue;}const invalid=validateSchema(rule,item,field==='输入'?key:`${field}.${key}`);if(invalid)return invalid;}
  }else if(schema.type==='array'){
    if(!Array.isArray(value))return `${field} 必须是数组`;
    for(let index=0;index<value.length;index+=1){const invalid=validateSchema(schema.items||{},value[index],`${field}[${index}]`);if(invalid)return invalid;}
  }else if(schema.type==='string'&&typeof value!=='string')return `${field} 必须是字符串`;
  else if(schema.type==='number'&&(typeof value!=='number'||!Number.isFinite(value)))return `${field} 必须是数字`;
  else if(schema.type==='integer'&&!Number.isInteger(value))return `${field} 必须是整数`;
  else if(schema.type==='boolean'&&typeof value!=='boolean')return `${field} 必须是布尔值`;
  if(Array.isArray(schema.enum)&&!schema.enum.includes(value))return `${field} 必须是以下值之一：${schema.enum.join('、')}`;
  return '';
}
export function validateInput(schema={},value){return validateSchema(schema,value,'输入');}
export function validateResult(result,outputSchema={}){if(!result||typeof result!=='object'||!['ok','error'].includes(result.status))return '插件未返回标准状态';if(result.status==='error'){if(!result.error?.code||!result.error?.message)return '错误结果缺少 code 或 message';if(!TOOL_ERROR_CODES.includes(result.error.code))return `错误结果使用未知 code：${result.error.code}`;return '';}if(!Array.isArray(result.artifacts)||!Array.isArray(result.warnings)||typeof result.provenance!=='object')return '成功结果缺少标准字段';return validateSchema(outputSchema,result.data,'输出数据');}
