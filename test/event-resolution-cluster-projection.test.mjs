import test from 'node:test';
import assert from 'node:assert/strict';
import { projectStableEvents } from '../server/features/research/index.mjs';

test('文章研判消费稳定事件 ID，同时保留原事件卡与报道成员', () => {
  const hotspots = [
    { id: 1, title: '张丹丹发言', category: '📰 综合资讯', market_scope: '国内', raw_json: JSON.stringify({ aiTags: { eventKey: '张丹丹|发言争议', eventParts: { who: '张丹丹', what: '发言争议', actionType: '争议回应' }, keywords: ['社保'] } }) },
    { id: 2, title: '张丹丹回应', category: '📰 综合资讯', market_scope: '国内', raw_json: JSON.stringify({ aiTags: { eventKey: '张丹丹|回应争议', eventParts: { who: '张丹丹', what: '回应争议', actionType: '争议回应' }, keywords: ['社保'] } }) },
  ];
  const legacy = [{ event_id: 'EOLD', representative_title: '旧聚类', market_scope: '国内', topic_category: '📰 综合资讯', tags: {}, articles: [
    { hotspot_id: 1, title: '张丹丹发言', source: 'RSS', time: '2026-08-23T08:00:00Z' },
    { hotspot_id: 2, title: '张丹丹回应', source: '新闻', time: '2026-08-23T09:00:00Z' },
  ] }];
  const [event] = projectStableEvents({
    shadowEvents: [{ event_id: 'S-STABLE', title: '张丹丹发言争议', normalized: { whoKey: '张丹丹', objectKey: '社保', triggerKey: '发言争议', actionType: '争议回应', eventKey: '张丹丹|发言争议' }, hotspot_ids: [1, 2] }],
    legacyClusters: legacy, hotspots,
    heatByEvent: new Map([['S-STABLE', { heatScore: 72, rank: 3, state: 'continuing', repeatDays: 2 }]]),
  });
  assert.equal(event.event_id, 'S-STABLE');
  assert.deepEqual(event.articles.map((item) => item.hotspot_id), [1, 2]);
  assert.equal(event.card, null);
  assert.equal(event.eventHeatRank, 3);
  assert.equal(event.duplicatePenalty, 4);
  assert.equal(event.tags.eventParts.who, '张丹丹');
});
