import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runConversationAgent } from '../server/platform/agent/conversation-agent.mjs';
import { compactAgentHistory } from '../server/platform/agent/context.mjs';
import { buildConversationToolCatalog } from '../server/platform/agent/tool-catalog.mjs';
import { AgentContractError, validateAgentEnvelope } from '../server/platform/agent/tool-protocol.mjs';
import { ToolRegistry } from '../server/platform/tools/registry.mjs';
import { Store } from '../server/platform/core/store.mjs';

function registry(){
  const value=new ToolRegistry();
  value.register({manifest:{id:'read-demo',name:'只读演示',version:'1.0.0',capabilities:['content.demo.read'],riskLevel:'read-only',inputSchema:{type:'object',additionalProperties:false,properties:{query:{type:'string'}},required:['query']},outputSchema:{type:'object',properties:{answer:{type:'string'}},required:['answer']}},adapter:{async execute(input){return {status:'ok',data:{answer:`result:${input.query}`},artifacts:[],warnings:[],provenance:{},metrics:{durationMs:0}};}}});
  value.register({manifest:{id:'write-demo',name:'写入演示',version:'1.0.0',capabilities:['content.demo.write'],riskLevel:'external-write',inputSchema:{type:'object'},outputSchema:{type:'object'}},adapter:{async execute(){return {status:'ok',data:{written:true},artifacts:[],warnings:[],provenance:{},metrics:{durationMs:0}};}}});
  return value;
}

test('Agent 协议拒绝未知字段、重复 requestId 和混合 final/tool 输出',()=>{
  assert.throws(()=>validateAgentEnvelope({type:'final',assistantReply:'ok',output:{},requests:[]}),AgentContractError);
  assert.throws(()=>validateAgentEnvelope({type:'tool_requests',assistant_note:'',requests:[
    {requestId:'tr_a',capability:'content.demo.read',arguments:{query:'a'},reason:'a'},
    {requestId:'tr_a',capability:'content.demo.read',arguments:{query:'b'},reason:'b'},
  ]}),/requestId 重复/);
});

test('final 信封打平：业务字段平铺顶层，兼容旧嵌套 output 层',()=>{
  const flat=validateAgentEnvelope({type:'final',assistantReply:'ok',nextQuestion:'q',candidateUpdates:{angle:'a'}});
  assert.deepEqual(flat.output,{assistantReply:'ok',nextQuestion:'q',candidateUpdates:{angle:'a'}});
  const nested=validateAgentEnvelope({type:'final',assistantReply:'ok',output:{nextQuestion:'q',editorial:{next_action:'DISCUSS'}}});
  assert.deepEqual(nested.output,{nextQuestion:'q',editorial:{next_action:'DISCUSS'}});
});

test('工具目录取入口、技能授权、启用实现和只读风险的交集',()=>{
  const tools=registry();
  const catalog=buildConversationToolCatalog({registry:tools,entryCapabilities:['content.demo.read','content.demo.write'],allowedCapabilities:['content.demo.read','content.demo.write']});
  assert.deepEqual(catalog.map((item)=>item.capability),['content.demo.read']);
  assert.equal(catalog[0].inputSchema.required[0],'query');
});

test('Agent 支持单工具结果回送模型后返回 final，并发送统一事件',async()=>{
  const tools=registry(),catalog=buildConversationToolCatalog({registry:tools,entryCapabilities:['content.demo.read']});
  const events=[];let calls=0;
  const result=await runConversationAgent({entryPoint:'editorial',registry:tools,catalog,onEvent:(event)=>events.push(event),modelStep:async({messages})=>{
    calls+=1;if(calls===1)return {type:'tool_requests',assistant_note:'查资料',requests:[{requestId:'tr_one',capability:'content.demo.read',arguments:{query:'hello'},reason:'核对资料'}]};
    assert.match(messages.at(-1).content,/result:hello/);return {type:'final',assistantReply:'完成',output:{ready:true}};
  }});
  assert.equal(result.type,'final');assert.equal(result.toolCalls,1);assert.equal(result.modelSteps,2);
  for(const type of ['tool.requested','tool.running','tool.completed','done'])assert.ok(events.some((event)=>event.type===type));
});

test('Agent 历史上下文超限时保留事实读取和最近审计并压缩旧轮次',()=>{
  const history=[
    {role:'system',protected:true,content:'系统提示'},
    {role:'user',protected:true,content:'初始请求'},
    {role:'assistant',content:'旧补丁 1'},
    {role:'tool',content:JSON.stringify([{capability:'filesystem.project.read',status:'ok',data:{answer:'事实'.repeat(3000)}}])},
    {role:'assistant',content:'旧补丁 2'},
    {role:'tool',content:JSON.stringify([{capability:'content.social_card.layout_audit',status:'ok',data:{summary:'旧审计'.repeat(1000)}}])},
    {role:'assistant',content:'最新补丁'},
    {role:'tool',content:JSON.stringify([{capability:'content.social_card.layout_audit',status:'ok',data:{summary:'最新审计'.repeat(1000)}}])},
  ];
  const compacted=compactAgentHistory(history,5000);
  assert.ok(compacted.length<history.length);
  assert.ok(compacted.some((message)=>message.content==='系统提示'));
  assert.ok(compacted.some((message)=>message.content.includes('上下文压缩')));
  assert.ok(compacted.some((message)=>message.role==='tool'&&message.content.includes('filesystem.project.read')));
  assert.ok(compacted.at(-1).content.includes('最新审计'));
});

test('Agent 同一步并行多个只读工具并拒绝不可见能力',async()=>{
  const tools=registry(),catalog=buildConversationToolCatalog({registry:tools,entryCapabilities:['content.demo.read']});let secondMessages;
  const result=await runConversationAgent({entryPoint:'custom-social',registry:tools,catalog,modelStep:async({step,messages})=>{
    if(step===0)return {type:'tool_requests',assistant_note:'并行',requests:[
      {requestId:'tr_a',capability:'content.demo.read',arguments:{query:'a'},reason:'a'},
      {requestId:'tr_b',capability:'content.demo.write',arguments:{},reason:'b'},
    ]};secondMessages=messages;return {type:'final',assistantReply:'done',output:{}};
  }});
  const payload=JSON.parse(secondMessages.at(-1).content);assert.equal(payload[0].status,'ok');assert.equal(payload[1].error.code,'CAPABILITY_NOT_VISIBLE');assert.equal(result.toolCalls,1);
});

test('Agent 阻止相同调用重复执行并在模型步骤、工具数和时间超限时终止',async()=>{
  const tools=registry(),catalog=buildConversationToolCatalog({registry:tools,entryCapabilities:['content.demo.read']});
  const repeated=await runConversationAgent({entryPoint:'independent-writing',registry:tools,catalog,budget:{maxModelSteps:2},modelStep:async()=>({type:'tool_requests',assistant_note:'again',requests:[{requestId:`tr_${Math.random().toString(36).slice(2)}`,capability:'content.demo.read',arguments:{query:'same'},reason:'same'}]})});
  assert.equal(repeated.type,'limit');assert.equal(repeated.toolCalls,1);assert.match(repeated.messages.at(-1).content,/AGENT_BUDGET_EXCEEDED/);
  await assert.rejects(runConversationAgent({entryPoint:'editorial',registry:tools,catalog,budget:{timeoutMs:10},modelStep:()=>new Promise((resolve)=>setTimeout(()=>resolve({type:'final',assistantReply:'late',output:{}}),40))}),(error)=>error.code==='AGENT_BUDGET_EXCEEDED');
});

test('Agent 运行与工具调用持久化关联，且不保存原始参数值',async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-core-')),store=new Store(path.join(root,'test.db'));t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  const tools=registry(),catalog=buildConversationToolCatalog({registry:tools,entryCapabilities:['content.demo.read']});let calls=0;
  const result=await runConversationAgent({entryPoint:'editorial',registry:tools,catalog,store,toolContext:{skillId:'editorial-room-chat',provider:'mock'},modelStep:async()=>++calls===1?{type:'tool_requests',assistant_note:'read',requests:[{requestId:'tr_db',capability:'content.demo.read',arguments:{query:'secret-value'},reason:'read'}]}:{type:'final',assistantReply:'ok',output:{}}});
  const run=store.getAgentRun(result.agentRunId),toolCalls=store.listAgentToolCalls(result.agentRunId);
  assert.equal(run.status,'completed');assert.equal(run.model_steps,2);assert.equal(toolCalls.length,1);assert.equal(toolCalls[0].status,'ok');assert.deepEqual(toolCalls[0].input_summary,{keys:['query']});assert.doesNotMatch(JSON.stringify(toolCalls),/secret-value/);
  const executions=store.listToolExecutions({capability:'content.demo.read'});assert.equal(executions.length,1);assert.equal(executions[0].skill_id,'editorial-room-chat');
});
