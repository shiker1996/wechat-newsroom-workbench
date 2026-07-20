import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHotspotAtlas } from '../lib/hotspot-atlas.mjs';

test('热点全景按事件覆盖聚合且报道数守恒', () => {
  const clusters=[{
    event_id:'E0001',representative_title:'同一事件',market_scope:'国内',china_relevance_score:10,china_relevance_reason:'影响国内开发者',
    topic_category:'🤖 AI/技术动态',keywords:['模型','AI'],source_count:2,report_count:2,cluster_confidence:'medium',latest_time:'2026-07-19T10:00:00Z',
    articles:[{category_id:'G1',source:'rsshub',title:'报道一',risk_level:'低'},{category_id:'G2',source:'reddit',title:'Report two',risk_level:'中'}],tags:{}
  },{
    event_id:'E0002',representative_title:'另一事件',market_scope:'国外',china_relevance_score:3,china_relevance_reason:'海外观察',
    topic_category:'📰 综合资讯',keywords:['开源'],source_count:1,report_count:1,cluster_confidence:'low',articles:[{category_id:'G3',source:'reddit',title:'第三篇',risk_level:'低'}],tags:{}
  }];
  const atlas=buildHotspotAtlas({clusters,totalArticles:3,taggedCount:3});
  assert.equal(atlas.eventCount,2); assert.equal(atlas.sourceCount,2); assert.equal(atlas.multiSourceCount,1);
  assert.deepEqual(atlas.scopes,{国内:1,全球性:0,国外:1}); assert.equal(atlas.events[0].event_id,'E0001');
  assert.equal(atlas.events[0].risk_level,'中'); assert.equal(atlas.keywords.some((item)=>item.name==='AI'),false);
  assert.equal(atlas.gate.valid,true); assert.equal(atlas.gate.reportSum,3);
});
