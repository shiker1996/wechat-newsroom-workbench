import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';

function workspace(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'model-call-audit-'));
  const store=new Store(path.join(root,'test.db'));
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  return store;
}

test('统一日志查询的模型分支返回调用详情字段',t=>{
  const store=workspace(t);
  store.saveExtensionSetting({extensionType:'model-connection',extensionId:'openrouter',value:{label:'OpenRouter'},configured:true,status:'ready'});
  store.saveExtensionSetting({extensionType:'model-provider',extensionId:'or-deepseek',value:{connectionId:'openrouter',model:'deepseek/deepseek-v4-flash-0731'},configured:true,status:'ready'});
  store.recordModelCall({
    provider:'or-deepseek',model:'deepseek/deepseek-v4-flash-0731',purpose:'hotspot-tagging',status:'completed',
    estimatedInputTokens:120,promptTokens:100,completionTokens:30,reasoningTokens:12,
    latencyMs:456,compressed:true,outputBudget:{maxTokens:8192},
    outputText:'{"items":[]}',reasoningText:'先分析再输出',
    toolCalls:[{id:'call-1',name:'cap_filesystem_project_document_write',input:{operation:'append'}}],
  });
  const [row]=store.listLogs({logType:'model'});
  assert.equal(row.log_type,'model');
  assert.equal(row.provider,'or-deepseek');
  assert.equal(row.provider_display,'OpenRouter · deepseek/deepseek-v4-flash-0731');
  assert.equal(row.model,'deepseek/deepseek-v4-flash-0731');
  assert.equal(row.output_text,'{"items":[]}');
  assert.equal(row.reasoning_text,'先分析再输出');
  assert.deepEqual(JSON.parse(row.tool_calls_json),[{id:'call-1',name:'cap_filesystem_project_document_write',input:{operation:'append'}}]);
  assert.equal(row.prompt_tokens,100);
  assert.equal(row.completion_tokens,30);
  assert.equal(row.reasoning_tokens,12);
  assert.equal(row.estimated_input_tokens,120);
  assert.equal(row.latency_ms,456);
  assert.equal(row.compressed,1);
  assert.deepEqual(JSON.parse(row.output_budget_json),{maxTokens:8192});
  // 其他日志类型的详情字段以 NULL 占位，保持统一结构
  const batch=store.createBatch({date:'2026-08-16',title:'占位'});
  const runId=store.startSourceRun(batch.id,'reddit');
  store.finishSourceRun(runId,'ok',0,null);
  const [source]=store.listLogs({logType:'source'});
  assert.equal(source.output_text,null);
  assert.equal(source.model,null);
});

test('model_calls 保留最近 2000 条，超出后旧行被清理',t=>{
  const store=workspace(t);
  for(let i=0;i<2100;i++){
    store.recordModelCall({provider:'test',model:'m',purpose:'retention',status:'completed'});
  }
  const calls=store.listModelCalls(3000);
  assert.equal(calls.length,2000);
  const ids=calls.map((row)=>row.id);
  assert.equal(Math.max(...ids),2100);
  assert.equal(Math.min(...ids),101);
});
