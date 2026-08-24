import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertSafeRemoteUrl, createRemoteAdapter } from '../server/platform/tools/remote-adapter.mjs';
import { setRemoteCredential } from '../server/platform/tools/remote-credentials.mjs';
import {
  installRemotePlugin, readRemotePluginCatalog, setRemotePluginStatus, uninstallRemotePlugin,
  validateRemotePluginManifest,
} from '../server/platform/tools/remote-package-manager.mjs';

function manifest(overrides={}){
  return {
    schemaVersion:1,id:'remote-demo',name:'Remote Demo',version:'1.0.0',type:'remote-api',
    capabilities:['remote.demo'],riskLevel:'network-read',endpoint:'https://api.example.com/tool',
    credentialProfile:'remote-demo',inputSchema:{type:'object'},outputSchema:{type:'object'},
    timeoutMs:5000,maxResponseBytes:2048,compatibleApp:'>=0.1.0',...overrides,
  };
}
const publicDns=async()=>[{address:'93.184.216.34',family:4}];

test('remote manifest cannot declare local code and lifecycle requires credentials',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'remote-plugin-'));
  try{
    assert.throws(()=>validateRemotePluginManifest(manifest({entry:'./adapter.mjs'})),/本地 entry/);
    const installed=installRemotePlugin(root,manifest());
    assert.equal(installed.status,'disabled');
    assert.throws(()=>setRemotePluginStatus(root,'remote-demo','enabled'),/配置插件凭据/);
    setRemoteCredential(root,'remote-demo','remote-demo','secret-token');
    assert.equal(setRemotePluginStatus(root,'remote-demo','enabled').status,'enabled');
    assert.equal(readRemotePluginCatalog(root).plugins['remote-demo'].manifest.allowedDomains[0],'api.example.com');
    uninstallRemotePlugin(root,'remote-demo');
    assert.equal(readRemotePluginCatalog(root).plugins['remote-demo'].status,'uninstalled');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('remote URL policy rejects private addresses and cross-domain redirects',async()=>{
  await assert.rejects(()=>assertSafeRemoteUrl('https://127.0.0.1/tool',['127.0.0.1']),/内网或保留地址/);
  const adapter=createRemoteAdapter({root:'',manifest:validateRemotePluginManifest(manifest({credentialProfile:undefined})),dependencies:{
    dnsLookup:publicDns,
    fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://evil.example/tool'}}),
  }});
  const result=await adapter.execute({query:'x'});
  assert.equal(result.status,'error');
  assert.match(result.error.message,/域名未授权/);
});

test('remote API injects only its own credential and normalizes JSON response',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'remote-credential-'));
  try{
    setRemoteCredential(root,'remote-demo','remote-demo','secret-token');
    let requestHeaders;
    const adapter=createRemoteAdapter({root,manifest:validateRemotePluginManifest(manifest()),dependencies:{
      dnsLookup:publicDns,
      fetchImpl:async(_url,options)=>{
        requestHeaders=options.headers;
        return new Response(JSON.stringify({answer:42}),{status:200,headers:{'content-type':'application/json','x-request-id':'req-1'}});
      },
    }});
    const result=await adapter.execute({query:'x'});
    assert.equal(result.status,'ok');assert.equal(result.data.answer,42);
    assert.equal(requestHeaders.authorization,'Bearer secret-token');
    assert.equal(JSON.stringify(result).includes('secret-token'),false);
    const rejected=await adapter.execute({path:'C:\\Users\\author\\draft.md'});
    assert.equal(rejected.status,'error');assert.match(rejected.error.message,/本地绝对路径/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('MCP streamable HTTP initializes then calls the declared tool',async()=>{
  const calls=[];
  const mcpManifest=validateRemotePluginManifest(manifest({type:'mcp',toolName:'search',credentialProfile:undefined}));
  const adapter=createRemoteAdapter({root:'',manifest:mcpManifest,dependencies:{
    dnsLookup:publicDns,
    fetchImpl:async(_url,options)=>{
      const request=JSON.parse(options.body);calls.push(request.method);
      if(request.method==='initialize')return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-03-26'}}),{status:200,headers:{'mcp-session-id':'s1'}});
      return new Response(JSON.stringify({jsonrpc:'2.0',id:2,result:{structuredContent:{items:[1,2]}}}),{status:200});
    },
  }});
  const result=await adapter.execute({query:'x'});
  assert.equal(result.status,'ok');assert.deepEqual(result.data.items,[1,2]);
  assert.deepEqual(calls,['initialize','notifications/initialized','tools/call']);
});
