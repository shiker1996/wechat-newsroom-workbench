import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichSourceCandidateFields } from '../server/features/collection/llm/source-field-enricher.mjs';

const candidate={name:'新闻',config:{itemSelector:'article',titleSelector:'h2',linkSelector:'a'},preview:[],enrichmentOptions:[{selector:'p.summary',tag:'p',coverage:1,samples:['摘要一','摘要二']},{selector:'time',tag:'time',attribute:'datetime',coverage:1,samples:['2026-01-01','2026-01-02']}]};

test('AI 只能从白名单选择字段且验证成功后应用',async()=>{let checked;const result=await enrichSourceCandidateFields({gateway:{complete:async()=>({content:'{"items":[{"index":0,"summarySelector":"p.summary","dateSelector":"time","dateAttribute":"datetime"}]}'})},page:{},candidates:[candidate],validate:async(_candidate,config)=>{checked=config;return {applied:true,config,fields:{summary:1,publishedAt:1},preview:[]};}});assert.equal(result.aiFieldsApplied,true);assert.equal(checked.summarySelector,'p.summary');assert.equal(checked.dateSelector,'time');assert.equal(result.candidates[0].enrichmentOptions,undefined);});

test('AI 创造的 selector 被拒绝且不改变基础配置',async()=>{const result=await enrichSourceCandidateFields({gateway:{complete:async()=>({content:'{"items":[{"index":0,"summarySelector":"script.evil"}]}'})},page:{},candidates:[candidate],validate:async(_candidate,config)=>({applied:false,config})});assert.equal(result.aiFieldsApplied,false);assert.deepEqual(result.candidates[0].config,candidate.config);});

test('无模型时剥离内部白名单并保持候选可用',async()=>{const result=await enrichSourceCandidateFields({gateway:null,page:{},candidates:[candidate]});assert.equal(result.candidates[0].enrichmentOptions,undefined);assert.equal(result.candidates[0].config.itemSelector,'article');});
