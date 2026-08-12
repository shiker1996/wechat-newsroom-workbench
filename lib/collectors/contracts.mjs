import { validateConfigurationSchema, validateConfigurationValue } from '../extensions/configuration-schema.mjs';
import { validatePluginManifestBase } from '../../plugins/shared/manifest-contract.mjs';

export const COLLECTOR_ERROR_CODES=Object.freeze(['INVALID_SOURCE_CONFIG','DEPENDENCY_MISSING','AUTH_REQUIRED','RATE_LIMITED','TIMEOUT','BLOCKED','SELECTOR_MISMATCH','OUTPUT_INVALID','NETWORK_ERROR','CANCELLED']);
const ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateCollectorManifest(manifest){
  const issues=[...validatePluginManifestBase(manifest)];const add=(field,message)=>issues.push({field,level:'error',message});
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))return issues;
  if(manifest.kind!=='collector')add('kind','kind 必须为 collector');
  if(!Array.isArray(manifest.collector?.sourceTypes)||!manifest.collector.sourceTypes.length||manifest.collector.sourceTypes.some((item)=>!ID.test(item)))add('collector.sourceTypes','collector.sourceTypes 必须是非空 kebab-case 数组');
  if(!Number.isInteger(manifest.runtime?.timeoutMs)||manifest.runtime.timeoutMs<1000||manifest.runtime.timeoutMs>300000)add('runtime.timeoutMs','runtime.timeoutMs 必须为 1000～300000');
  if(!['parallel','sequential','session'].includes(manifest.runtime?.concurrency))add('runtime.concurrency','runtime.concurrency 无效');
  if(manifest.configuration!==undefined)issues.push(...validateConfigurationSchema(manifest.configuration,{field:'configuration'}));
  issues.push(...validateConfigurationSchema(manifest.collector?.sourceConfigSchema,{field:'collector.sourceConfigSchema'}));
  return issues;
}

export function validateSourceConfiguration(manifest,value){return validateConfigurationValue(manifest.collector.sourceConfigSchema,value,'sourceConfig');}

export function collectorFailure(code,message,{retryable=false,action=''}={}){
  return {status:'error',error:{code:COLLECTOR_ERROR_CODES.includes(code)?code:'OUTPUT_INVALID',message:String(message||'采集失败'),retryable:Boolean(retryable),...(action?{action}:{})}};
}

export function normalizeCollectorResult(result,{maxItems=100}={}){
  if(!result||result.status!=='ok'||!Array.isArray(result.items))return collectorFailure('OUTPUT_INVALID','采集器未返回标准成功结果');
  const items=[];
  for(let index=0;index<Math.min(result.items.length,maxItems);index+=1){
    const input=result.items[index]||{};const title=String(input.title||'').trim();let url;
    try{url=new URL(String(input.url||''));if(!['http:','https:'].includes(url.protocol))throw new Error();}catch{return collectorFailure('OUTPUT_INVALID',`第 ${index+1} 条缺少有效标题或 URL`);}
    if(!title)return collectorFailure('OUTPUT_INVALID',`第 ${index+1} 条缺少有效标题或 URL`);
    const raw=input.raw&&typeof input.raw==='object'?input.raw:{};
    if(JSON.stringify(raw).length>100000)return collectorFailure('OUTPUT_INVALID',`第 ${index+1} 条 raw 超过大小限制`);
    items.push({externalId:String(input.externalId||''),title:title.slice(0,500),url:url.href,
      discussionUrl:input.discussionUrl?String(input.discussionUrl):null,summary:String(input.summary||'').slice(0,20000),
      author:String(input.author||'').slice(0,200),publishedAt:input.publishedAt||null,
      metrics:input.metrics&&typeof input.metrics==='object'?input.metrics:{},raw});
  }
  return {status:'ok',items,warnings:Array.isArray(result.warnings)?result.warnings.map(String):[],provenance:result.provenance&&typeof result.provenance==='object'?result.provenance:{}};
}
