import test from 'node:test';
import assert from 'node:assert/strict';
import { tagBatch, buildTaggingInput, normalizeEventPart, normalizeEventParts, normalizeActionType, deriveEventKey } from '../lib/llm/tasks.mjs';

test('eventParts 规范化为小写无标点形式，缺 who/what 时返回 null', () => {
  assert.equal(normalizeEventPart(' Moonshot AI '), 'moonshotai');
  assert.equal(normalizeEventPart('发布开源模型 K3。'), '发布开源模型k3');
  assert.equal(normalizeEventPart('欧盟, '), '欧盟');
  assert.equal(normalizeEventPart(''), '');
  assert.equal(normalizeEventPart(null), '');
  const parts = normalizeEventParts({ who: '月之暗面', what: '发布 K3', where: '国内', when: '2026-07' });
  assert.deepEqual(parts, { who: '月之暗面', what: '发布k3', where: '国内', when: '2026-07', actionType: '其他', object: '', occasion: '',
    labels: { who: '月之暗面', what: '发布 K3', object: '', occasion: '' } });
  assert.equal(normalizeEventParts({ who: '', what: '发布K3' }), null);
  assert.equal(normalizeEventParts(null), null);
});

test('actionType 校验枚举，非法值归一为其他，occasion 保留展示写法', () => {
  assert.equal(normalizeActionType('发布'), '发布');
  assert.equal(normalizeActionType('开源发布'), '其他');
  assert.equal(normalizeActionType(''), '其他');
  assert.equal(normalizeActionType(null), '其他');
  const parts = normalizeEventParts({ who: 'OpenAI', what: '发布 GPT-5', where: '全球', when: '2026-07', actionType: '发布', object: 'GPT-5', occasion: 'WAIC 大会' });
  assert.equal(parts.actionType, '发布');
  assert.equal(parts.object, 'gpt-5');
  assert.equal(parts.occasion, 'waic大会');
  assert.equal(parts.labels.object, 'GPT-5');
  assert.equal(parts.labels.occasion, 'WAIC 大会');
  assert.equal(parts.labels.who, 'OpenAI');
});

test('eventKey 优先由 who|what 派生，缺 eventParts 时回退模型原值', () => {
  assert.equal(deriveEventKey({ eventParts: { who: 'Moonshot', what: '发布 K3' }, eventKey: '随意指纹' }), 'moonshot|发布k3');
  assert.equal(deriveEventKey({ eventKey: ' 旧指纹 ' }), '旧指纹');
  assert.equal(deriveEventKey({}), '');
});

test('打标保存时以规范化 who|what 生成 eventKey 并保留四要素', async () => {
  const hotspots=[1,2].map((id)=>({id,title:`热点${id}`,source:'rsshub',url:`https://example.com/${id}`,raw_json:'{}'}));
  const updated=[];
  const store={
    getBatch(){return {hotspots};},
    updateModelCall(){},
    updateHotspotTags(id,tags){updated.push({id,tags});},
  };
  const gateway={config:{defaultProvider:'deepseek',providers:{deepseek:{maxOutputTokens:8192,taggingChunkSize:2}}},async complete(){
    return {callId:1,content:JSON.stringify({items:[
      {id:1,eventParts:{who:'Moonshot AI',what:'发布开源模型 K3',where:'国内',when:'2026-07'},preScores:{conflict:10}},
      {id:2,eventParts:{who:'moonshot ai',what:'发布开源模型K3。',where:'',when:''},preScores:{conflict:10}},
    ]}),finishReason:'stop',model:'test',context:{compressed:false,afterTokens:10},usage:{}};
  }};
  await tagBatch({gateway,store,batchId:'b1',provider:'deepseek'});
  assert.equal(updated.length,2);
  assert.equal(updated[0].tags.eventKey,'moonshotai|发布开源模型k3');
  assert.equal(updated[1].tags.eventKey,'moonshotai|发布开源模型k3');
  assert.equal(updated[0].tags.eventParts.where,'国内');
  assert.equal(updated[1].tags.eventParts.when,'');
});

test('打标输入注入 RSS 摘要并截断，无摘要时不携带该字段', () => {
  const withSummary = buildTaggingInput({ id:1, source:'rsshub', title:'t', url:'https://example.com/1', raw_json: JSON.stringify({ summary: '  摘要 内容  ' }) });
  assert.equal(withSummary.summary, '摘要 内容');
  const long = buildTaggingInput({ id:2, source:'rsshub', title:'t', url:'https://example.com/2', raw_json: JSON.stringify({ summary: 'x'.repeat(800) }) });
  assert.equal(long.summary.length, 500);
  const none = buildTaggingInput({ id:3, source:'reddit', title:'t', url:'https://example.com/3', raw_json: '{}' });
  assert.equal('summary' in none, false);
});

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
  const thinkingCalls=[];
  const origComplete=gateway.complete.bind(gateway);
  gateway.complete=async(input)=>{if(input.thinking)thinkingCalls.push(input);return origComplete(input);};
  const result=await tagBatch({gateway,store,batchId:'b1',provider:'deepseek'});
  // 截断后先开 thinking 重试一次（仍失败），再进入拆分逻辑：1 + 1 + 2 = 4 次调用
  assert.equal(calls,4); assert.equal(thinkingCalls.length,1);
  assert.equal(updated.length,2); assert.equal(result.updated,2);
  assert.equal(invalid[0].status,'invalid_output'); assert.match(invalid[0].error,/截断/);
});

test('单条热点反复打标失败时跳过并记录，不拖垮整批', async () => {
  const hotspots=[1,2].map((id)=>({id,title:`热点${id}`,source:'rsshub',url:`https://example.com/${id}`,raw_json:'{}'}));
  const updated=[];
  const store={
    getBatch(){return {hotspots};},
    updateModelCall(){},
    updateHotspotTags(id,tags){updated.push(id);},
  };
  const gateway={config:{defaultProvider:'deepseek',providers:{deepseek:{maxOutputTokens:8192,taggingChunkSize:1}}},async complete(input){
    const rows=JSON.parse(input.messages[1].content);
    if(rows[0].id===1)return {callId:1,content:'{"items":[',finishReason:'length',model:'test',context:{compressed:false,afterTokens:10},usage:{}};
    return {callId:2,content:JSON.stringify({items:[{id:2,eventParts:{who:'主体',what:'动作'},preScores:{conflict:10}}]}),finishReason:'stop',model:'test',context:{compressed:false,afterTokens:10},usage:{}};
  }};
  const result=await tagBatch({gateway,store,batchId:'b1',provider:'deepseek'});
  assert.deepEqual(updated,[2]);
  assert.equal(result.updated,1);
  assert.equal(result.failed,1);
  assert.deepEqual(result.failedIds,[1]);
});

test('大批量打标使用持续补位工作池和服务商批次配置', async () => {
  const hotspots=Array.from({length:25},(_,index)=>({id:index+1,title:`热点${index+1}`,source:'rsshub',url:`https://example.com/${index+1}`,raw_json:'{}'}));
  let active=0;let maxActive=0;let calls=0;const updated=[];
  const store={
    getBatch(){return {hotspots};},
    updateModelCall(){},
    updateHotspotTags(id){updated.push(id);},
  };
  const gateway={config:{defaultProvider:'deepseek',providers:{deepseek:{maxOutputTokens:8192,taggingChunkSize:4,taggingConcurrency:3}}},async complete(input){
    calls+=1;active+=1;maxActive=Math.max(maxActive,active);
    const rows=JSON.parse(input.messages[1].content);
    await new Promise((resolve)=>setTimeout(resolve,rows[0].id % 3 === 0 ? 12 : 3));
    active-=1;
    return {callId:calls,content:JSON.stringify({items:rows.map((row)=>({id:row.id,eventKey:`事件${row.id}`,preScores:{conflict:10}}))}),finishReason:'stop',model:'test',context:{compressed:false,afterTokens:10},usage:{}};
  }};
  const result=await tagBatch({gateway,store,batchId:'b1',provider:'deepseek'});
  assert.equal(calls,7);
  assert.equal(maxActive,3);
  assert.equal(updated.length,25);
  assert.equal(result.chunks,7);
  assert.equal(result.concurrency,3);
});


test('超过有效时间窗口的旧闻跳过打标，不发送给模型', async () => {
  const hotspots=[
    {id:1,title:'新鲜热点',source:'rsshub',url:'https://example.com/1',published_at:'2026-07-23T10:00:00+08:00',raw_json:'{}'},
    {id:2,title:'旧闻',source:'rsshub',url:'https://example.com/2',published_at:'2026-07-01T10:00:00+08:00',raw_json:'{}'},
  ];
  const updated=[]; const progress=[]; let calls=0;
  const store={
    getBatch(){return {hotspots,batch_date:'2026-07-24'};},
    updateModelCall(){},
    updateHotspotTags(id,tags){updated.push({id,tags});},
  };
  const gateway={config:{defaultProvider:'deepseek',providers:{deepseek:{maxOutputTokens:8192}}},async complete(input){
    calls+=1;
    const rows=JSON.parse(input.messages[1].content);
    return {callId:calls,content:JSON.stringify({items:rows.map((row)=>({id:row.id,eventKey:`事件${row.id}`,preScores:{conflict:10}}))}),finishReason:'stop',model:'test',context:{compressed:false,afterTokens:10},usage:{}};
  }};
  const result=await tagBatch({gateway,store,batchId:'b1',provider:'deepseek',maxAgeHours:168,onProgress:(m)=>progress.push(m)});
  assert.equal(calls,1);
  assert.deepEqual(updated.map((x)=>x.id),[1]);
  assert.equal(result.updated,1);
  assert.equal(result.skippedStale,1);
  assert.ok(progress.some((m)=>m.includes('已跳过 1 条')));
});

test('模型回显输入（0 条有效标注）时自动开启 thinking 重试', async () => {
  const hotspots=[1,2].map((id)=>({id,title:`热点${id}`,source:'rsshub',url:`https://example.com/${id}`,raw_json:'{}'}));
  const updated=[]; let calls=0; const thinkingFlags=[];
  const store={
    getBatch(){return {hotspots};},
    updateModelCall(){},
    updateHotspotTags(id){updated.push(id);},
  };
  const gateway={config:{defaultProvider:'deepseek',providers:{deepseek:{maxOutputTokens:8192,taggingChunkSize:2}}},async complete(input){
    calls+=1; thinkingFlags.push(Boolean(input.thinking));
    const rows=JSON.parse(input.messages[1].content);
    if(!input.thinking)return {callId:calls,content:JSON.stringify({items:rows}),finishReason:'stop',model:'test',context:{compressed:false,afterTokens:10},usage:{}};
    return {callId:calls,content:JSON.stringify({items:rows.map((row)=>({id:row.id,eventKey:`事件${row.id}`,preScores:{conflict:10}}))}),finishReason:'stop',model:'test',context:{compressed:false,afterTokens:10},usage:{}};
  }};
  const result=await tagBatch({gateway,store,batchId:'b1',provider:'deepseek'});
  assert.equal(calls,2);
  assert.deepEqual(thinkingFlags,[false,true]);
  assert.deepEqual(updated,[1,2]);
  assert.equal(result.updated,2);
  assert.equal(result.failed,0);
});
