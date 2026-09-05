import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {Store} from '../server/platform/core/store.mjs';
import { handleSystemRoutes } from '../server/platform/http/routes/system-routes.mjs';
import { runConversationAgent } from '../server/platform/agent/conversation-agent.mjs';

const projectRoot=path.resolve(import.meta.dirname,'..');

test('阶段 5 运行概览关联同一次 Agent run 与工具调用并聚合健康指标',(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-overview-')),store=new Store(path.join(root,'test.db'));t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  const batch=store.createBatch({date:'2026-08-14',title:'Agent 概览'}),id='agent-phase5';
  store.startAgentRun({id,entryPoint:'custom-social',batchId:batch.id,provider:'mock'});
  const request={requestId:'tr_1',capability:'cap_content_web_search',arguments:{query:'test'},reason:'补充来源'};
  store.startAgentToolCall({agentRunId:id,request});store.finishAgentToolCall({agentRunId:id,request,result:{status:'ok',data:{results:[]},provenance:{provider:'mock-search'}}});store.finishAgentRun(id,{status:'completed',modelSteps:2,toolCalls:1});
  const overview=store.getAgentOperationsOverview();
  assert.equal(overview.summary.runs,1);assert.equal(overview.summary.successRate,100);assert.equal(overview.summary.estimatedCost,null);
  assert.equal(overview.runs[0].toolCalls[0].capability,'cap_content_web_search');assert.equal(overview.byEntryPoint[0].entry_point,'custom-social');assert.equal(overview.byCapability[0].capability,'cap_content_web_search');
});

test('阶段 5 Agent Run Trace 聚合事件、步骤、工具和可恢复 checkpoint，并支持增量事件',async (t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-trace-')),store=new Store(path.join(root,'test.db'));t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  const id='agent-trace';store.startAgentRun({id,entryPoint:'editorial',skillId:'editorial-room-chat',rootRunId:'root-trace',workflowRunId:'workflow-trace',stageId:'editorial-stage',parentRunId:'parent-trace'});
  store.appendAgentRunEvent(id,{schemaVersion:1,type:'model.text',text:'hello'});
  store.appendAgentRunEvent(id,{schemaVersion:1,type:'tool.completed',capability:'cap_content_web_search'});
  store.saveAgentStep({agentRunId:id,step:0,phase:'tools_completed',summary:{toolCalls:1}});
  store.saveAgentCheckpoint(id,{schemaVersion:1,phase:'tools_completed',nextStep:1,resumable:true});
  store.recordModelCall({provider:'mock',model:'trace-model',purpose:'editorial',status:'completed',agentRunId:id,agentStep:0,rootRunId:'root-trace',workflowRunId:'workflow-trace',stageId:'editorial-stage'});
  const request={requestId:'tr_trace',capability:'cap_content_web_search',arguments:{query:'test'},reason:'补充来源'};
  store.startAgentToolCall({agentRunId:id,request});store.finishAgentToolCall({agentRunId:id,request,result:{status:'ok',data:{results:[]},provenance:{provider:'mock-search'}}});
  store.saveToolExecution({agentRunId:id,agentToolCallId:`${id}:${request.requestId}`,rootRunId:'root-trace',workflowRunId:'workflow-trace',stageId:'editorial-stage',record:{capability:request.capability,plugin:'mock-search',version:'1',status:'ok',errorCode:null,inputKeys:['query'],authorizedExternalWrite:false,startedAt:new Date(0).toISOString(),finishedAt:new Date(1).toISOString(),durationMs:1}});
  const trace=store.getAgentRunTrace(id);assert.equal(trace.schemaVersion,1);assert.equal(trace.events.length,2);assert.equal(trace.run.root_run_id,'root-trace');assert.equal(trace.run.workflow_run_id,'workflow-trace');assert.equal(trace.run.stage_id,'editorial-stage');assert.equal(trace.run.parent_run_id,'parent-trace');assert.equal(trace.steps[0].phase,'tools_completed');assert.equal(trace.modelCalls[0].agent_run_id,id);assert.equal(trace.modelCalls[0].root_run_id,'root-trace');assert.equal(trace.modelCalls[0].agent_step,0);assert.equal(trace.toolCalls[0].capability,'cap_content_web_search');assert.equal(trace.toolCalls[0].root_run_id,'root-trace');assert.equal(trace.toolExecutions[0].agent_run_id,id);assert.equal(trace.toolExecutions[0].root_run_id,'root-trace');assert.equal(trace.toolExecutions[0].side_effect,'none');assert.equal(trace.toolExecutions[0].replay_policy,'never');assert.equal(trace.resumable,true);
  const incremental=store.getAgentRunTrace(id,{afterSequence:1});assert.equal(incremental.events.length,1);assert.equal(incremental.events[0].sequence,2);
  assert.equal(store.getAgentRunTrace(id,{eventLimit:1}).events.length,1);
  let response;const handled=await handleSystemRoutes({request:{method:'GET'},response:{},pathname:`/api/system/conversation-agent-runs/${id}/trace`,searchParams:new URLSearchParams(),root:projectRoot,config:{},store,json:(_res,status,data)=>{response={status,data};},body:async()=>({})});
  assert.equal(handled,true);assert.equal(response.status,200);assert.equal(response.data.run.id,id);
});

test('生产 Agent Run 支持通过系统接口取消活动执行并持久化 aborted 状态',async (t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-cancel-')),store=new Store(path.join(root,'test.db'));t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  let activeId='';
  const running=runConversationAgent({entryPoint:'editorial',catalog:[],store,modelStep:({agentRunId,signal})=>{activeId=agentRunId;return new Promise((resolve,reject)=>{const abort=()=>reject(Object.assign(new Error('cancelled'),{code:'AGENT_ABORTED'}));if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});});}});
  for(let i=0;i<20&&!activeId;i+=1)await new Promise((resolve)=>setTimeout(resolve,5));
  assert.ok(activeId);
  let response;const handled=await handleSystemRoutes({request:{method:'POST'},response:{},pathname:`/api/system/conversation-agent-runs/${encodeURIComponent(activeId)}/cancel`,searchParams:new URLSearchParams(),root,config:{},store,json:(_res,status,data)=>{response={status,data};},body:async()=>({})});
  assert.equal(handled,true);assert.equal(response.status,202);assert.equal(response.data.status,'cancelling');
  await assert.rejects(running,(error)=>error.code==='AGENT_ABORTED');assert.equal(store.getAgentRun(activeId).status,'aborted');
});

test('阶段 5 三入口共享工具卡协议且新编辑室不再转换 fetchEvents',()=>{
  const renderer=fs.readFileSync(new URL('../public/src/core/agent-events.js',import.meta.url),'utf8');
  const adapter=fs.readFileSync(new URL('../server/features/articles/application/agent/editorial-adapter.mjs',import.meta.url),'utf8');
  const routes=fs.readFileSync(new URL('../server/platform/http/routes/system-routes.mjs',import.meta.url),'utf8');
  assert.match(renderer,/tool\.requested/);assert.match(renderer,/assistant\.thinking/);assert.match(renderer,/agent\.limit/);
  assert.doesNotMatch(adapter,/compatibilityRequests/);assert.doesNotMatch(adapter,/tr_legacy_/);
  assert.match(routes,/conversation-agent-runs/);
});

test('阶段 5 能力编排台展示 Agent 运行概览和关联工具历史',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),ui=fs.readFileSync(new URL('../public/src/views/skills.js',import.meta.url),'utf8');
  assert.match(html,/agent-run-history-panel/);assert.match(html,/load-agent-run-history/);assert.match(ui,/conversation-agent-runs\?limit=100/);assert.match(ui,/run\.toolCalls/);assert.match(ui,/estimatedCost/);
});
