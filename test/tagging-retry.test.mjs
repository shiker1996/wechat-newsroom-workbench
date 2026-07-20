import test from 'node:test';
import assert from 'node:assert/strict';
import { tagBatch } from '../lib/llm/tasks.mjs';

test('打标 JSON 截断时标记 invalid_output 并自动拆分重试', async () => {
  const hotspots=[1,2].map((id)=>({id,title:`热点${id}`,source:'rsshub',url:`https://example.com/${id}`,raw_json:'{}'}));
  const invalid=[]; const updated=[]; let calls=0;
  const store={
    getBatch(){return {hotspots};},
    updateModelCall(id,fields){invalid.push({id,...fields});},
    updateHotspotTags(id,tags){updated.push({id,tags});},
  };
  const gateway={config:{defaultProvider:'deepseek',providers:{deepseek:{maxOutputTokens:8192}}},async complete(input){
    calls+=1; const rows=JSON.parse(input.messages[1].content);
    if(rows.length>1)return {callId:1,content:'{"items":[',finishReason:'length',model:'test',context:{compressed:false,afterTokens:10},usage:{completion_tokens:5000}};
    return {callId:calls,content:JSON.stringify({items:[{id:rows[0].id,category:'🤖 AI/技术动态',marketScope:'全球性',chinaRelevance:8,relevanceReason:'相关',riskLevel:'低',score:80,eventKey:`事件${rows[0].id}`,preScores:{conflict:10}}]}),finishReason:'stop',model:'test',context:{compressed:false,afterTokens:10},usage:{completion_tokens:100}};
  }};
  const result=await tagBatch({gateway,store,batchId:'b1',provider:'deepseek'});
  assert.equal(calls,3); assert.equal(updated.length,2); assert.equal(result.updated,2);
  assert.equal(invalid[0].status,'invalid_output'); assert.match(invalid[0].error,/截断/);
});
