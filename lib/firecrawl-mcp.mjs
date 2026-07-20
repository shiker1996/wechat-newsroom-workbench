import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

function validatePublicUrl(value) {
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Firecrawl 只接受公开 HTTP/HTTPS URL');
  const host=url.hostname.toLowerCase(); const ipType=net.isIP(host);
  if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||ipType&&(/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host)||host==='::1'))throw new Error('拒绝向 Firecrawl 提交本机或内网 URL');
  return url.href;
}

function parseResponseText(text,contentType) {
  if(!text.trim())return null;
  if(contentType.includes('text/event-stream')) {
    const messages=text.split(/\r?\n/).filter((line)=>line.startsWith('data:')).map((line)=>line.slice(5).trim()).filter(Boolean);
    if(!messages.length)return null; return JSON.parse(messages.at(-1));
  }
  return JSON.parse(text);
}

async function rpc(endpoint,apiKey,payload,sessionId='',timeoutMs=45000) {
  const headers={'content-type':'application/json','accept':'application/json, text/event-stream'};
  if(apiKey)headers.authorization=`Bearer ${apiKey}`;
  if(sessionId)headers['mcp-session-id']=sessionId;
  const body=JSON.stringify(payload);headers['content-length']=Buffer.byteLength(body);
  const response=await new Promise((resolve,reject)=>{
    const target=new URL(endpoint);const transport=target.protocol==='https:'?https:http;
    const request=transport.request(target,{method:'POST',headers},(incoming)=>{let text='';incoming.setEncoding('utf8');incoming.on('data',(chunk)=>{text+=chunk;if(text.length>10_000_000)request.destroy(new Error('Firecrawl MCP 响应超过 10MB'));});incoming.on('end',()=>resolve({status:incoming.statusCode||0,headers:incoming.headers,text}));});
    request.setTimeout(timeoutMs,()=>request.destroy(new Error(`Firecrawl MCP 请求超过 ${timeoutMs}ms`)));request.on('error',reject);request.end(body);
  });
  if(response.status<200||response.status>=300)throw new Error(`Firecrawl MCP HTTP ${response.status}：${response.text.slice(0,300)}`);
  const message=parseResponseText(response.text,String(response.headers['content-type']||''));
  if(message?.error)throw new Error(`Firecrawl MCP ${message.error.code}：${message.error.message}`);
  return {message,sessionId:String(response.headers['mcp-session-id']||sessionId)};
}

function findScrapePayload(result) {
  const candidates=[];
  if(result?.structuredContent)candidates.push(result.structuredContent);
  for(const block of result?.content||[])if(block.type==='text'&&block.text){try{candidates.push(JSON.parse(block.text));}catch{candidates.push({markdown:block.text});}}
  for(const candidate of candidates) {
    const data=candidate?.data||candidate;
    const markdown=data?.markdown||data?.content;
    if(markdown)return {markdown:String(markdown),metadata:data.metadata||candidate.metadata||{}};
  }
  throw new Error('Firecrawl MCP 未返回可用 Markdown');
}

export async function firecrawlScrape(url,{endpoint=process.env.FIRECRAWL_MCP_URL||'https://mcp.firecrawl.dev/v2/mcp',apiKey=process.env.FIRECRAWL_API_KEY||'',timeoutMs=45000}={}) {
  const safeUrl=validatePublicUrl(url); let nextId=1;
  const initialized=await rpc(endpoint,apiKey,{jsonrpc:'2.0',id:nextId++,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'write-assistant',version:'0.1.0'}}},'',timeoutMs);
  const sessionId=initialized.sessionId;
  await rpc(endpoint,apiKey,{jsonrpc:'2.0',method:'notifications/initialized',params:{}},sessionId,timeoutMs);
  const called=await rpc(endpoint,apiKey,{jsonrpc:'2.0',id:nextId++,method:'tools/call',params:{name:'firecrawl_scrape',arguments:{url:safeUrl,formats:['markdown'],onlyMainContent:true}}},sessionId,timeoutMs);
  const {markdown,metadata}=findScrapePayload(called.message?.result);
  const content=markdown.trim().slice(0,30000);
  return {status:content.length>=200?'ok':'partial',url:safeUrl,final_url:metadata.sourceURL||metadata.url||safeUrl,title:metadata.title||'',description:metadata.description||'',
    author:metadata.author||'',published_at:metadata.publishedTime||metadata.datePublished||'',content,content_chars:content.length,
    fetched_at:new Date().toISOString(),error:content.length>=200?'':'Firecrawl 返回内容不足 200 字',fetch_method:'firecrawl-mcp'};
}
