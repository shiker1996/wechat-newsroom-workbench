import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { firecrawlScrape } from '../lib/firecrawl-mcp.mjs';

test('Firecrawl MCP 客户端完成握手并调用 firecrawl_scrape', async (t) => {
  const methods=[];
  const server=http.createServer(async (request,response)=>{
    let body='';for await(const chunk of request)body+=chunk;const input=JSON.parse(body);methods.push(input.method);
    if(input.method==='notifications/initialized'){response.writeHead(202);response.end();return;}
    response.setHeader('content-type','application/json');response.setHeader('mcp-session-id','session-1');
    if(input.method==='initialize')response.end(JSON.stringify({jsonrpc:'2.0',id:input.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'test',version:'1'}}}));
    else response.end(JSON.stringify({jsonrpc:'2.0',id:input.id,result:{content:[{type:'text',text:JSON.stringify({data:{markdown:'# 原文\n\n'+('这是 Firecrawl 返回的正文。'.repeat(30)),metadata:{title:'来源标题',sourceURL:'https://example.com/article'}}})}]}}));
  });
  await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const address=server.address();const result=await firecrawlScrape('https://example.com/article',{endpoint:`http://127.0.0.1:${address.port}/mcp`});
  assert.deepEqual(methods,['initialize','notifications/initialized','tools/call']);assert.equal(result.fetch_method,'firecrawl-mcp');assert.equal(result.status,'ok');assert.equal(result.title,'来源标题');
});

test('Firecrawl MCP 客户端拒绝向外部服务提交内网目标', async () => {
  await assert.rejects(()=>firecrawlScrape('http://127.0.0.1/private'),/拒绝/);
});
