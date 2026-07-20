import test from 'node:test';
import assert from 'node:assert/strict';
import { brainstorm, clusterItems, deterministicTimeliness, isFreshForBatch, preselection, choosePool, scoreCards } from '../lib/llm/research-pipeline.mjs';

function hotspot(id, title, eventKey, source='rsshub') {
  return { id, title, source, url:`https://example.com/${id}`, category:'🤖 AI/技术动态', market_scope:'全球性', score:80,
    raw_json:JSON.stringify({aiTags:{eventKey,chinaRelevance:8,relevanceReason:'影响国内开发者',riskLevel:'低',keywords:['模型'],
      preScores:{conflict:14,audience:16,informationGain:12,emotion:10,timeliness:9,impact:8,sourceReliability:8},
      credibleScoop:0,saturationPenalty:2,duplicatePenalty:0,blackHorseSignals:['信息稀缺']}}) };
}

test('语义事件指纹合并同事件且报道数守恒', () => {
  const events=clusterItems([hotspot(1,'A报道','主体|发布|模型','reddit'),hotspot(2,'B报道','主体|发布|模型','rsshub'),hotspot(3,'另一事件','主体|裁员|团队')]);
  assert.equal(events.length,2);
  assert.equal(events.reduce((sum,event)=>sum+event.report_count,0),3);
  assert.equal(events.find((event)=>event.report_count===2).source_count,2);
});

test('研判使用真实发布时间过滤并确定性计算时效', () => {
  const old={published_at:'2026-07-01T12:07:00.000Z'};
  const recent={published_at:'2026-07-19T08:00:00.000Z'};
  assert.equal(isFreshForBatch(old,'2026-07-19',168),false);
  assert.equal(isFreshForBatch(recent,'2026-07-19',168),true);
  assert.equal(deterministicTimeliness(old.published_at,'2026-07-19'),0);
  assert.equal(deterministicTimeliness(recent.published_at,'2026-07-19'),10);
});

test('预选按证据得分排序并生成8+2角色', () => {
  const clusters=clusterItems(Array.from({length:13},(_,i)=>hotspot(i+1,`事件${i+1}`,`主体${i+1}|动作|对象`)));
  const ranking=preselection(clusters); const pool=choosePool(ranking);
  assert.equal(pool.selected.length,10);
  assert.equal(pool.selected.filter((item)=>item.poolRole==='核心8条').length,8);
  assert.equal(pool.selected.filter((item)=>item.poolRole==='黑马2条').length,2);
  assert.equal(pool.backup.length,3);
});

test('H/B/P/S/D/F由服务端公式计算', () => {
  const source={candidateId:'C001',title:'事件',category:'🤖 AI/技术动态',poolRole:'核心8条',credibleScoop:0,riskLevel:'低'};
  const cards=[{candidateId:'C001',status:'PASS',source,bScores:{angleUniqueness:4,emotionSpread:4,titleHook:4,audienceRelevance:4,factSupport:4},
    hProfile:{historicalType:'bigtech',fiveSenseCount:4,fiveQuestionCount:3,recommendationFit:6,emotionTheme:4,searchFriendly:3}}];
  const result=scoreCards(cards,{items:[{candidateId:'C001',saturationPenalty:5,duplicatePenalty:2,audienceRelevance:4,reason:'测试'}]})[0];
  assert.equal(result.b,80); assert.equal(result.p,40); assert.equal(result.s,5); assert.equal(result.d,2);
  assert.equal(result.f,60.4);
});

test('探索脑暴输出截断时自动从双卡拆成单卡', async () => {
  const invalid=[]; let calls=0;
  const store={updateModelCall(id,fields){invalid.push({id,...fields});}};
  const gateway={config:{defaultProvider:'deepseek',providers:{deepseek:{maxOutputTokens:8192}}},async complete(input){
    calls+=1; const text=input.messages[1].content; const ids=[...text.matchAll(/"candidateId":"(C\d+)"/g)].map((m)=>m[1]);
    if(ids.length>1)return {callId:calls,content:'{"items":[',finishReason:'length'};
    const candidateId=ids[0]; return {callId:calls,finishReason:'stop',content:JSON.stringify({items:[{candidateId,status:'PASS',angle:'角度',thesis:'命题',hypotheses:[],packaging:{},bScores:{},hProfile:{}}]})};
  }};
  const selected=[1,2].map((id)=>({hotspotId:id,title:`热点${id}`,category:'🤖 AI/技术动态',poolRole:'核心8条'}));
  const cards=await brainstorm(gateway,store,selected,[{label:'降级',content:'无'}],'b1','deepseek',()=>{});
  assert.equal(calls,3); assert.equal(cards.length,2); assert.equal(invalid[0].status,'invalid_output');
});
