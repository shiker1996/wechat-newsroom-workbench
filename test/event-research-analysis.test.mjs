import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enrichEventAnalysis, readEventAnalysisCache, sourceInput } from '../server/features/research/application/event-research-analysis.mjs';

function groups(content='报道正文：系统新增了缓存机制。'){
  return [{event_id:'E1',hotspots:[{source_id:'hotspot:1',title:'报道标题',url:'https://example.com/a',source:'媒体',time:'2026-08-26',sourceDoc:{status:'ok',content}}]}];
}

test('事件深度分析输入包含关联报道正文',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'event-research-analysis-'));const cachePath=path.join(root,'event-analysis.json');
  const calls=[];
  const gateway={config:{defaultProvider:'test',providers:{test:{maxOutputTokens:7000}}},complete:async(input)=>{calls.push(input);return {content:JSON.stringify({context:[{claim:'系统新增缓存机制',source_ids:['hotspot:1']}],mechanisms:[{claim:'减少重复读取',source_ids:['hotspot:1']}],sourceAudit:{independentSourceCount:1,issues:[],neededMaterials:[]}})};}};
  try{
    const baseRecord={synthesized:true,analysis:{eventSummary:'事件摘要',factBase:{confirmedFacts:[],claims:[]},sources:[{source_id:'hotspot:1',status:'ok'}],sourceAudit:{issues:[],neededMaterials:[]}}};
    const result=await enrichEventAnalysis({gateway,store:null,batchId:1,candidateId:2,provider:'test',baseRecord,groups:groups(),skillBundle:{prompt:'只输出 JSON'},cachePath});
    assert.equal(result.enriched,true);assert.equal(result.analysis.factBase.context[0].claim,'系统新增缓存机制');
    assert.match(calls[0].messages[1].content,/报道正文：系统新增了缓存机制/);
    assert.ok(fs.existsSync(cachePath));
    assert.deepEqual(readEventAnalysisCache(cachePath,groups()).factBase.context,result.analysis.factBase.context);
    const cached=await enrichEventAnalysis({gateway:{...gateway,complete:async()=>{throw new Error('不应再次调用模型');}},store:null,batchId:1,candidateId:2,provider:'test',baseRecord,groups:groups(),skillBundle:{prompt:'只输出 JSON'},cachePath});
    assert.equal(cached.cached,true);
    assert.equal(readEventAnalysisCache(cachePath,groups('内容已变化')),null);
    assert.equal(sourceInput(groups())[0].content,'报道正文：系统新增了缓存机制。');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
