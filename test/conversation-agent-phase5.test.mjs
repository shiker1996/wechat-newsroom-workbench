import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {Store} from '../server/platform/core/store.mjs';

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
