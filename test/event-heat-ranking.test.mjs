import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreEventHeat, buildEventHeatRanking } from '../server/features/research/index.mjs';

const asOf = Date.parse('2026-08-23T12:00:00Z');

function hotspot(id, { title = `事件 ${id}`, source = 'rss', marketScope = '国内', publishedAt = '2026-08-23T10:00:00Z', relevance = 8 } = {}) {
  return { id, title, source, source_group: source, source_name: source, market_scope: marketScope, published_at: publishedAt,
    url: `https://example.com/${id}`, raw_json: JSON.stringify({ aiTags: { chinaRelevance: relevance, keywords: [title] } }) };
}

function membership(eventId, hotspotId, createdAt, isNew = 0) {
  return { event_id: eventId, hotspot_id: hotspotId, created_at: createdAt, updated_at: createdAt, is_new_information: isNew };
}

test('新事件和来源扩散会得到增量分，单事件只返回一个排名项', () => {
  const event = { id: 'SNEW', title: '新事件', event_state: 'new_event', confidence: 'high', first_seen_at: '2026-08-23T10:00:00Z', last_seen_at: '2026-08-23T10:00:00Z' };
  const current = [membership('SNEW', 1, '2026-08-23T10:00:00Z'), membership('SNEW', 2, '2026-08-23T11:00:00Z')];
  const score = scoreEventHeat({ event, currentMemberships: current, historicalMemberships: current, hotspotsById: new Map([[1, hotspot(1, { source: 'rss' })], [2, hotspot(2, { source: 'news' })]]), asOf });
  assert.equal(score.eventId, 'SNEW');
  assert.equal(score.reportCount, 2);
  assert.equal(score.sourceCount, 2);
  assert.equal(score.newReportCount, 2);
  assert.equal(score.state, 'new_event');
  assert.equal(score.eventValue, score.heatScore);
  assert.equal(score.t, score.heatScore);
  assert.ok(score.incrementScore > 0);
});

test('连续出现但无新信息的事件会衰减为过时', () => {
  const event = { id: 'SOLD', title: '旧事件', event_state: 'continuing', confidence: 'low', first_seen_at: '2026-08-20T10:00:00Z', last_seen_at: '2026-08-20T10:00:00Z' };
  const history = [
    membership('SOLD', 1, '2026-08-20T10:00:00Z'),
    membership('SOLD', 2, '2026-08-21T10:00:00Z'),
    membership('SOLD', 3, '2026-08-22T10:00:00Z'),
  ];
  const score = scoreEventHeat({ event, currentMemberships: [history[2]], historicalMemberships: history, hotspotsById: new Map([[3, hotspot(3, { publishedAt: '2026-08-20T10:00:00Z' })]]), asOf });
  assert.equal(score.state, 'stale');
  assert.equal(score.newReportCount, 0);
  assert.ok(score.historyDecayScore >= 10);
});

test('热榜以稳定事件为单位，不会因同一事件多条报道重复占位', () => {
  const rows = [membership('S1', 1, '2026-08-23T10:00:00Z'), membership('S1', 2, '2026-08-23T11:00:00Z'), membership('S2', 3, '2026-08-23T11:00:00Z')];
  const records = [
    { id: 'S1', title: '聚合事件', event_state: 'new_event', confidence: 'medium', first_seen_at: '2026-08-23T10:00:00Z', last_seen_at: '2026-08-23T11:00:00Z' },
    { id: 'S2', title: '另一事件', event_state: 'new_event', confidence: 'medium', first_seen_at: '2026-08-23T11:00:00Z', last_seen_at: '2026-08-23T11:00:00Z' },
  ];
  const store = {
    listEventHotspots: ({ batchId } = {}) => batchId ? rows : rows,
    listEventRecords: () => records,
  };
  const ranking = buildEventHeatRanking({ store, batch: { id: 'B1', hotspots: [hotspot(1), hotspot(2), hotspot(3)] }, asOf });
  assert.equal(ranking.items.length, 2);
  assert.equal(ranking.items[0].eventId, 'S1');
  assert.deepEqual(ranking.items[0].hotspotIds, [1, 2]);
});
