import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';
import { mapBreakingArticleScore, normalizeScore, routeBreakingAnalysis } from '../server/features/articles/llm/breaking-analysis-pipeline.mjs';

function createStore(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'breaking-analysis-'));
  return {root,store:new Store(path.join(root,'test.db'))};
}

test('双评分由服务端按维度上限和扣分确定性计算',()=>{
  const score=normalizeScore({dimensions:{a:99,b:10},penalties:{risk:4,other:99}},{a:20,b:15},{risk:10,other:5});
  assert.deepEqual(score,{dimensions:{a:20,b:10},penalties:{risk:4,other:5},baseScore:30,penalty:9,finalScore:21});
});

test('突发文章 H/B/P/S/D 映射可复算并保持 F 为双评分结果',()=>{
  const mapped=mapBreakingArticleScore({finalScore:72,dimensions:{conflict:16,emotionalTension:12,timeliness:14,informationGain:12,audienceRelevance:17,sourceReliability:4,impact:8},penalties:{saturation:3}});
  const recalculated=Number((mapped.h*.6+mapped.b*.25+mapped.p*.15-mapped.s+mapped.d).toFixed(1));
  assert.equal(recalculated,72);assert.equal(mapped.f,72);assert.equal(mapped.s,3);assert.notEqual(mapped.d,0);
});

test('突发素材分别保存抓取状态和正文',()=>{
  const {root,store}=createStore();
  try{
    const batch=store.createBreakingBatch({date:'2026-07-23',title:'事件',urls:['https://example.com/a','https://example.com/b'],requestedTracks:['article']});
    const material=batch.hotspots[0].materials[1];
    store.saveHotspotMaterialResult(material.id,{status:'ok',title:'来源 B',content:'正文',content_chars:2,fetch_method:'test'});
    const saved=store.listHotspotMaterials(batch.hotspots[0].id)[1];
    assert.equal(saved.status,'ok');assert.equal(saved.title,'来源 B');assert.equal(saved.content,'正文');
  }finally{store.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('突发专题可以在分析后继续补充素材链接',()=>{
  const {root,store}=createStore();
  try{
    const batch=store.createBreakingBatch({date:'2026-07-23',title:'事件',urls:['https://example.com/a'],requestedTracks:['social_cards']});
    const materials=store.addBreakingMaterials(batch.id,['https://example.com/b','https://example.com/a']);
    assert.deepEqual(materials.map((item)=>item.url),['https://example.com/a','https://example.com/b']);
  }finally{store.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('确认分流后文章和事件图文使用各自评分',()=>{
  const {root,store}=createStore();
  try{
    const batch=store.createBreakingBatch({date:'2026-07-23',title:'事件',urls:['https://example.com/a'],requestedTracks:['article','social_cards']});
    store.saveBreakingAnalysis(batch.id,{
      eventSummary:'事件摘要',sourceAudit:{issues:[],neededMaterials:[]},
      article:{finalScore:82,baseScore:88,penalty:6,dimensions:{audienceRelevance:17,sourceReliability:4},angle:'文章角度',thesis:'文章命题',risks:[]},
      social:{finalScore:74,dimensions:{informationDensity:16,visualNarrative:15},penalties:{singleSource:5},recommendation:'recommend'},
    });
    const result=routeBreakingAnalysis({store,batchId:batch.id,tracks:['article','social_cards']});
    const tracks=store.listCandidateTracks(result.candidate.id);
    assert.equal(tracks.find((item)=>item.track==='article').score,82);
    assert.equal(tracks.find((item)=>item.track==='social_cards').score,74);
    assert.equal(store.getSocialScore(result.candidate.id).score.scoreProfile,'event');
    assert.equal(store.getCandidate(result.candidate.id).f_score,82);
    store.saveBreakingAnalysis(batch.id,{
      eventSummary:'事件摘要',sourceAudit:{issues:[],neededMaterials:[]},
      article:{finalScore:76,baseScore:80,penalty:4,dimensions:{conflict:15,emotionalTension:12,timeliness:13,informationGain:12,audienceRelevance:16,sourceReliability:4,impact:8},penalties:{saturation:2},angle:'新角度',thesis:'新命题',risks:[]},
      social:{finalScore:79,dimensions:{informationDensity:17},penalties:{singleSource:2},recommendation:'recommend'},
    });
    routeBreakingAnalysis({store,batchId:batch.id,tracks:['article','social_cards']});
    const refreshed=store.listCandidateTracks(result.candidate.id);
    assert.equal(refreshed.find((item)=>item.track==='article').score,76);
    assert.equal(refreshed.find((item)=>item.track==='social_cards').score,79);
  }finally{store.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('突发批次页面提供分析和人工确认分流',()=>{
  const ui=fs.readFileSync(new URL('../public/src/views/batch-drawer.js',import.meta.url),'utf8');
  assert.match(ui,/事实基座与双评分/);
  assert.match(ui,/breaking-analysis\/route/);
  assert.match(ui,/data-breaking-analyze/);
  assert.match(ui,/data-breaking-route/);
});
