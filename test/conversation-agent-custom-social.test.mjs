import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../lib/core/store.mjs';
import { ToolRegistry } from '../lib/tools/registry.mjs';
import { runCustomSocialAgentTurn } from '../lib/agent/custom-social-adapter.mjs';

function registry(){const value=new ToolRegistry();value.register({manifest:{id:'search',name:'搜索',version:'1.0.0',capabilities:['content.web.search'],riskLevel:'network-read',inputSchema:{type:'object',required:['query'],properties:{query:{type:'string'},maxResults:{type:'integer'}}},outputSchema:{type:'object'}},adapter:{async execute(){return {status:'ok',data:{answer:'公开资料',results:[{title:'官方说明',url:'https://docs.example.com/guide'}]},artifacts:[],warnings:[],provenance:{}};}}});value.register({manifest:{id:'repo',name:'仓库',version:'1.0.0',capabilities:['content.repository.inspect'],riskLevel:'network-read',inputSchema:{type:'object',required:['sourceUrl'],properties:{sourceUrl:{type:'string'}}},outputSchema:{type:'object'}},adapter:{async execute(input){return {status:'ok',data:{sourceUrl:input.sourceUrl,description:'仓库事实',readmeMarkdown:'安装说明'},artifacts:[],warnings:[],provenance:{}};}}});return value;}
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'custom-social-agent-')),store=new Store(path.join(root,'test.db')),batch=store.createBatch({date:'2026-08-14',title:'自定义图文 Agent'});t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});return {root,store,batch};}

test('自定义图文显式搜索并把外部结果强制标为带 URL 的【素材】',async(t)=>{const {root,store,batch}=fixture(t);let calls=0;const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete({messages}){calls+=1;if(calls===1)return {callId:'s1',content:JSON.stringify({type:'tool_requests',assistant_note:'搜索资料',requests:[{requestId:'tr_search',capability:'content.web.search',arguments:{query:'Agent 教程'},reason:'补充公开资料'}]}),model:'mock',usage:{}};assert.ok(messages.some((item)=>item.role==='tool'&&item.content.includes('docs.example.com')));return {callId:'s2',content:JSON.stringify({type:'final',assistantReply:'方案已整理',briefUpdates:{content_type:'tutorial',channel:'wechat',topic:'Agent 教程',audience:'开发者',points:['【体验】官方文档给出安装方式','【建议】先测试','【建议】保留边界'],steps:['安装','运行'],expected_pages:6}}),model:'mock',usage:{}};}};const result=await runCustomSocialAgentTurn({gateway,store,registry:registry(),batchId:batch.id,draft:{},workspaceRoot:root});assert.equal(result.toolCalls,1);assert.match(result.formUpdates.points[0],/^【素材】/);assert.match(result.formUpdates.points[0],/https:\/\/docs\.example\.com\/guide/);assert.deepEqual(result.formUpdates.materialUrls,['https://docs.example.com/guide']);const attachments=store.listConversationFactAttachments({batchId:batch.id,entryPoint:'custom-social'});assert.equal(attachments.length,1);assert.equal(attachments[0].capability,'content.web.search');});

test('仓库分析只接受用户提供的 GitHub 资源',async(t)=>{const {root,store,batch}=fixture(t);let repoExecutions=0,step=0;const tools=registry(),original=tools.execute.bind(tools);tools.execute=async(...args)=>{if(args[0]==='content.repository.inspect')repoExecutions+=1;return original(...args);};const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete(){step+=1;if(step===1)return {callId:'r1',content:JSON.stringify({type:'tool_requests',assistant_note:'读仓库',requests:[{requestId:'tr_repo',capability:'content.repository.inspect',arguments:{resourceId:'material:999'},reason:'分析仓库'}]}),model:'mock',usage:{}};return {callId:'r2',content:JSON.stringify({type:'final',assistantReply:'请提供仓库',briefUpdates:{}}),model:'mock',usage:{}};}};const result=await runCustomSocialAgentTurn({gateway,store,registry:tools,batchId:batch.id,draft:{materialUrls:['https://example.com/not-github']},workspaceRoot:root});assert.equal(repoExecutions,0);assert.equal(result.ready,false);const call=store.listAgentToolCalls(result.agentRunId)[0];assert.equal(call.error_code,'RESOURCE_NOT_ALLOWED');});

test('自定义图文生产链关闭 provider 隐式搜索并复用事实附件',()=>{const adapter=fs.readFileSync(new URL('../lib/agent/custom-social-adapter.mjs',import.meta.url),'utf8'),route=fs.readFileSync(new URL('../lib/http/routes/candidate-routes.mjs',import.meta.url),'utf8');assert.match(adapter,/webSearch:false/);assert.match(route,/runCustomSocialAgentTurn/);assert.doesNotMatch(route,/runCustomSocialChatStream/);assert.match(route,/entryPoint:'custom-social'/);assert.match(route,/materialCache/);});

// 扩展方案阶段 A：custom-social 接入 filesystem.project.read（explicit-resource）
function registryWithProject(captured){const value=registry();value.register({manifest:{id:'project-reader',name:'项目读取',version:'1.0.0',capabilities:['filesystem.project.read'],riskLevel:'read-only',inputSchema:{type:'object',required:['path'],properties:{path:{type:'string'}}},outputSchema:{type:'object'}},adapter:{async execute(input,context){captured.push({input,context});return {status:'ok',data:{summary:'项目摘要',files:[{path:'README.md',size:10,excerpt:'内容',truncated:false}],totalFiles:1,totalChars:10,truncated:false,skipped:[],absoluteRoot:'/不应泄漏/absolute',extraSecret:'不应进入模型'},artifacts:[],warnings:[],provenance:{}};}}});return value;}
const finalWith=(points)=>({callId:'f',content:JSON.stringify({type:'final',assistantReply:'好',briefUpdates:{points}}),model:'mock',usage:{}});

test('提供项目路径：目录 resourceId 化、授权边界逐项对照、项目读取结果走【体验】降级链路',async(t)=>{
  const {root,store,batch}=fixture(t);const captured=[];const tools=registryWithProject(captured);
  const projectPath=path.join(root,'demo-proj'),documentRoot=path.join(root,'docs');let step=0,seenCatalog='';
  const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete({messages}){step+=1;
    if(step===1){seenCatalog=messages.filter((item)=>item.role==='system').map((item)=>item.content).join('\n');
      assert.ok(seenCatalog.includes('"filesystem.project.read"'),'目录缺少项目读取能力');
      assert.ok(seenCatalog.includes('project:current'),'资源目录缺少 project:current');
      assert.ok(!seenCatalog.includes('demo-proj'),'模型目录泄漏本地绝对路径');
      return {callId:'p1',content:JSON.stringify({type:'tool_requests',assistant_note:'读取项目',requests:[{requestId:'tr_p',capability:'filesystem.project.read',arguments:{resourceId:'project:current'},reason:'核对实际项目'}]}),model:'mock',usage:{}};}
    return finalWith(['【体验】项目实际运行表现稳定']);}};
  const result=await runCustomSocialAgentTurn({gateway,store,registry:tools,batchId:batch.id,draft:{},workspaceRoot:root,projectPath,documentRoots:[documentRoot]});
  // allowedRoots 组成：workspaceRoot + documentRoots + projectPath
  assert.equal(captured.length,1);assert.equal(captured[0].input.path,projectPath);
  assert.deepEqual(captured[0].context.allowedRoots,[root,documentRoot,projectPath]);
  // 结果裁剪：摘要字段保留，绝对路径与多余字段不进入模型/附件
  const attachments=store.listConversationFactAttachments({batchId:batch.id,entryPoint:'custom-social'});
  assert.equal(attachments.length,1);assert.equal(attachments[0].capability,'filesystem.project.read');
  assert.equal(attachments[0].data.summary,'项目摘要');
  assert.ok(!('absoluteRoot' in attachments[0].data)&&!('extraSecret' in attachments[0].data),'裁剪失效');
  // §3.4 风险覆盖：项目读取派生的新【体验】被降级改写为【素材】
  assert.match(result.formUpdates.points[0],/^【素材】项目实际运行表现稳定/);
});

test('未提供项目路径：不注册资源、不出现项目读取确定性调用、越界 resourceId 被拒绝',async(t)=>{
  const {root,store,batch}=fixture(t);const captured=[];const tools=registryWithProject(captured);let step=0,seenCatalog='';
  const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete({messages}){step+=1;
    if(step===1){seenCatalog=messages.filter((item)=>item.role==='system').map((item)=>item.content).join('\n');
      assert.ok(seenCatalog.includes('"project":null'),'未提供路径时资源目录不得出现 project:current');
      return {callId:'x1',content:JSON.stringify({type:'tool_requests',assistant_note:'尝试读取',requests:[{requestId:'tr_x',capability:'filesystem.project.read',arguments:{resourceId:'project:current'},reason:'试探'}]}),model:'mock',usage:{}};}
    return finalWith([]);}};
  const result=await runCustomSocialAgentTurn({gateway,store,registry:tools,batchId:batch.id,draft:{},workspaceRoot:root});
  assert.equal(captured.length,0,'未授权资源不得执行');
  const call=store.listAgentToolCalls(result.agentRunId)[0];
  assert.equal(call.error_code,'RESOURCE_NOT_ALLOWED');assert.match(JSON.parse(call.result_summary_json).message,/项目资源不属于当前请求/);
});

test('提供项目路径但能力未启用时报错引导去技能配置开启',async(t)=>{
  const {root,store,batch}=fixture(t);
  const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete(){throw new Error('不应到达模型');}};
  await assert.rejects(
    runCustomSocialAgentTurn({gateway,store,registry:registryWithProject([]),batchId:batch.id,draft:{},workspaceRoot:root,projectPath:path.join(root,'demo-proj'),allowedCapabilities:['content.web.search']}),
    (error)=>error.message.includes('自定义图文当前未启用本地项目读取能力')&&error.message.includes('filesystem.project.read'));
});
