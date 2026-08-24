import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSourceCandidates } from '../server/features/collection/llm/source-candidate-ranker.mjs';

const candidates=[
  {name:'栏目导航',reason:'导航链接',validation:{matched:8,itemCount:8},preview:[{title:'新闻发布'}]},
  {name:'主新闻列表',reason:'新闻条目',validation:{matched:24,itemCount:24},preview:[{title:'工业和信息化部发布最新通知'}]},
];

test('无意图或单候选时不调用 AI',async()=>{let calls=0;const result=await rankSourceCandidates({gateway:{complete:async()=>{calls++;}},intent:'',page:{},candidates});assert.equal(calls,0);assert.equal(result.aiApplied,false);});

test('AI 只重排已验证候选，不修改配置',async()=>{const configured=candidates.map((item,index)=>({...item,config:{itemSelector:`.item-${index}`}}));const result=await rankSourceCandidates({gateway:{complete:async()=>({content:'{"order":[1,0],"reason":"第二组更符合主新闻意图"}'})},intent:'采集主新闻列表',page:{title:'新闻'},candidates:configured});assert.equal(result.aiApplied,true);assert.equal(result.candidates[0].config.itemSelector,'.item-1');assert.equal(result.aiReason,'第二组更符合主新闻意图');});

test('AI 返回越界顺序时安全降级为确定性排序',async()=>{const result=await rankSourceCandidates({gateway:{complete:async()=>({content:'{"order":[9,0]}'})},intent:'主新闻',page:{},candidates});assert.equal(result.aiApplied,false);assert.equal(result.candidates[0],candidates[0]);assert.match(result.aiWarning,/保留确定性排序/);});
