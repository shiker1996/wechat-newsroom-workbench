import dns from 'node:dns/promises';
import net from 'node:net';
import { failure, ok } from './schemas.mjs';
import { getRemoteCredential } from './remote-credentials.mjs';

export function privateIp(address){
  if(net.isIPv4(address)){
    const [a,b]=address.split('.').map(Number);
    return a===10||a===127||a===0||(a===100&&b>=64&&b<=127)||(a===169&&b===254)
      ||(a===172&&b>=16&&b<=31)||(a===192&&[0,2,168].includes(b))||(a===198&&(b===18||b===19||b===51))
      ||(a===203&&b===0)||(a>=224);
  }
  const value=address.toLowerCase();
  if(value.startsWith('::ffff:')){
    const mapped=value.slice(7);return net.isIPv4(mapped)?privateIp(mapped):true;
  }
  return !/^[23][0-9a-f]{0,3}:/.test(value)||value.startsWith('2001:db8:')||value.startsWith('2001:10:')||value.startsWith('2001:2:');
}

function containsLocalPath(value){
  if(typeof value==='string')return /^[A-Za-z]:[\\/]/.test(value)||value.startsWith('\\\\')||/^\/(?:home|Users|var|etc|tmp|opt|root)\//.test(value);
  if(Array.isArray(value))return value.some(containsLocalPath);
  if(value&&typeof value==='object')return Object.values(value).some(containsLocalPath);
  return false;
}

export async function assertSafeRemoteUrl(url,allowedDomains,dnsLookup=dns.lookup){
  const target=new URL(url);
  if(target.protocol!=='https:'||target.username||target.password)throw new Error('只允许无内嵌凭据的 HTTPS URL');
  if(!allowedDomains.includes(target.hostname.toLowerCase()))throw new Error(`远程域名未授权：${target.hostname}`);
  const addresses=net.isIP(target.hostname)?[{address:target.hostname}]:await dnsLookup(target.hostname,{all:true,verbatim:true});
  if(!addresses.length||addresses.some((item)=>privateIp(item.address)))throw new Error('远程地址解析到内网或保留地址');
  return target;
}

async function readLimitedJson(response,maxBytes){
  const reader=response.body?.getReader();
  if(!reader)return null;
  const chunks=[];let size=0;
  while(true){
    const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new Error('远程响应超过大小限制');}
    chunks.push(Buffer.from(value));
  }
  const text=Buffer.concat(chunks).toString('utf8');
  if(!text.trim())return null;
  try{return JSON.parse(text);}catch{
    const payload=text.split(/\r?\n/).filter((line)=>line.startsWith('data:')).map((line)=>line.slice(5).trim()).find((line)=>line&&line!=='[DONE]');
    if(payload)try{return JSON.parse(payload);}catch{}
    throw new Error('远程响应不是有效 JSON');
  }
}

async function safeFetch(url,options,manifest,{fetchImpl=fetch,dnsLookup=dns.lookup}={}){
  let current=url;
  for(let redirects=0;redirects<=3;redirects+=1){
    await assertSafeRemoteUrl(current,manifest.allowedDomains,dnsLookup);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),manifest.timeoutMs);
    try{
      const response=await fetchImpl(current,{...options,redirect:'manual',signal:controller.signal});
      if([301,302,303,307,308].includes(response.status)){
        const location=response.headers.get('location');if(!location)throw new Error('重定向缺少 Location');
        current=new URL(location,current).href;continue;
      }
      const data=await readLimitedJson(response,manifest.maxResponseBytes);
      if(!response.ok)throw new Error(`远程服务返回 HTTP ${response.status}`);
      return {data,response};
    }finally{
      clearTimeout(timer);
    }
  }
  throw new Error('远程重定向次数超过限制');
}

function headersFor(root,manifest,extra={}){
  const token=getRemoteCredential(root,manifest.credentialProfile);
  return {'content-type':'application/json','accept':'application/json, text/event-stream',...(token?{authorization:`Bearer ${token}`}:{}) ,...extra};
}

async function executeApi(root,manifest,input,dependencies){
  const {data,response}=await safeFetch(manifest.endpoint,{method:'POST',headers:headersFor(root,manifest),body:JSON.stringify(input)},manifest,dependencies);
  const payload=data?.status==='ok'&&data.data!==undefined?data.data:data;
  return ok(payload??{},{
    provenance:{remoteHost:new URL(manifest.endpoint).hostname,remoteRequestId:response.headers.get('x-request-id')||''},
    metrics:{durationMs:0,rateLimitRemaining:response.headers.get('x-ratelimit-remaining')||''},
  });
}

async function mcpRequest(root,manifest,method,params,id,dependencies,session=''){
  return safeFetch(manifest.endpoint,{method:'POST',headers:headersFor(root,manifest,session?{'mcp-session-id':session}:{}),
    body:JSON.stringify({jsonrpc:'2.0',id,method,params})},manifest,dependencies);
}

async function initializeMcp(root,manifest,dependencies){
  const initialized=await mcpRequest(root,manifest,'initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'write-assistant',version:'0.1.0'}},1,dependencies);
  if(initialized.data?.error)throw new Error(initialized.data.error.message||'MCP 初始化失败');
  const session=initialized.response.headers.get('mcp-session-id')||'';
  await safeFetch(manifest.endpoint,{method:'POST',headers:headersFor(root,manifest,session?{'mcp-session-id':session}:{}),
    body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})},manifest,dependencies);
  return session;
}

async function executeMcp(root,manifest,input,dependencies){
  const session=await initializeMcp(root,manifest,dependencies);
  const called=await mcpRequest(root,manifest,'tools/call',{name:manifest.toolName,arguments:input},2,dependencies,session);
  if(called.data?.error)throw new Error(called.data.error.message||'MCP 工具调用失败');
  const result=called.data?.result;
  if(result?.isError)throw new Error(result.content?.map((item)=>item.text||'').join('\n')||'MCP 工具返回错误');
  let data=result?.structuredContent;
  if(data===undefined){
    const text=result?.content?.find((item)=>item.type==='text')?.text||'';
    try{data=JSON.parse(text);}catch{data={text};}
  }
  return ok(data??{},{provenance:{remoteHost:new URL(manifest.endpoint).hostname,mcpTool:manifest.toolName}});
}

export function createRemoteAdapter({root,manifest,dependencies={}}){
  const execute=(input)=>manifest.type==='mcp'?executeMcp(root,manifest,input,dependencies):executeApi(root,manifest,input,dependencies);
  return {
    async execute(input){
      try{
        if(containsLocalPath(input))throw new Error('远程插件输入禁止包含本地绝对路径');
        return await execute(input);
      }
      catch(error){
        const timeout=error?.name==='AbortError';
        return failure(timeout?'TIMEOUT':'FETCH_FAILED',timeout?'远程插件请求超时':error.message,{retryable:timeout});
      }
    },
    async health(){
      try{
        if(manifest.type==='mcp')await initializeMcp(root,manifest,dependencies);
        else {
          const checked=await safeFetch(manifest.healthEndpoint||manifest.endpoint,{method:'GET',headers:headersFor(root,manifest)},manifest,dependencies);
          return ok({available:true,endpointHost:new URL(manifest.endpoint).hostname,credentialConfigured:Boolean(getRemoteCredential(root,manifest.credentialProfile)),
            rateLimitRemaining:checked.response.headers.get('x-ratelimit-remaining')||'',rateLimitReset:checked.response.headers.get('x-ratelimit-reset')||''});
        }
        return ok({available:true,endpointHost:new URL(manifest.endpoint).hostname,credentialConfigured:Boolean(getRemoteCredential(root,manifest.credentialProfile))});
      }catch(error){return failure(error?.name==='AbortError'?'TIMEOUT':'FETCH_FAILED',error.message,{retryable:true});}
    },
  };
}
