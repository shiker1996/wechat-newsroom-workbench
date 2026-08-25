import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHotspotAtlas } from '../server/features/research/index.mjs';

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
  assert.equal(atlas.events[0].risk_level,'中'); assert.equal('keywords' in atlas,false);
  assert.equal(atlas.gate.valid,true); assert.equal(atlas.gate.reportSum,3);
});

test('事件关系图使用固定视窗、缩放平移和确定性维度排序', () => {
  const ui = fs.readFileSync(new URL('../public/src/views/atlas.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(ui, /viewportHeight = 500/);
  assert.match(ui, /zoomGraph/);
  assert.match(ui, /pointermove/);
  assert.match(ui, /graphAutoFocusPending/);
  assert.match(ui, /graphView\.scale=1\.22/);
  assert.match(ui, /priorityRank/);
  assert.match(ui, /localeCompare\(String\(b\.label\), "zh-CN"\)/);
  assert.match(html, /data-graph-zoom="reset"/);
  assert.match(html, /data-graph-lens="what"[^>]*>动作/);
  assert.match(css, /\.event-graph \{[^}]*height:500px/);
  assert.match(ui, /data-event-tracks="article">加入文章池/);
  assert.match(ui, /data-event-tracks="social_cards">加入图文池/);
  assert.match(ui, /socialContentClass: tracks\.includes\("social_cards"\)/);
});

test('事件关系图连接事件与维度节点，孤立主体不建维度节点', () => {
  const parts = (who, actionType, extra = {}) => ({ who, what:`${actionType}某事`, actionType, labels:{ who }, ...extra });
  const clusters=[1,2,3,4].map((n)=>({
    event_id:`E000${n}`,representative_title:`事件${n}`,market_scope:'国内',china_relevance_score:8,china_relevance_reason:'相关',
    topic_category:'🤖 AI/技术动态',keywords:[],source_count:1,report_count:1,cluster_confidence:'low',latest_time:'2026-07-19T10:00:00Z',
    articles:[{category_id:`G${n}`,source:'rsshub',title:`报道${n}`,risk_level:'低',hotspot_id:n}],
    tags:{ eventParts: n<=2 ? parts('openai', n===1?'发布':'争议回应') : parts(`solo${n}`, '发布') },
  }));
  const atlas=buildHotspotAtlas({clusters,totalArticles:4,taggedCount:4});
  const { nodes, edges } = atlas.graph;
  assert.equal(nodes.filter((node)=>node.type==='event').length, 4);
  assert.equal(nodes.filter((node)=>node.type==='event')[0].priorityRank,0);
  const whoNodes = nodes.filter((node)=>node.type==='who');
  assert.equal(whoNodes.length, 1);
  assert.equal(whoNodes[0].id, 'who:openai');
  assert.ok(whoNodes[0].score > 0);
  assert.equal(edges.filter((edge)=>edge.to==='who:openai').length, 2);
  for (const edge of edges) {
    assert.ok(nodes.some((node)=>node.id===edge.from), `边起点缺失 ${edge.from}`);
    assert.ok(nodes.some((node)=>node.id===edge.to), `边终点缺失 ${edge.to}`);
  }
});
