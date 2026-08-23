const HOUR = 60 * 60 * 1000;

function timeValue(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function parseRaw(hotspot) {
  try { return JSON.parse(hotspot?.raw_json || '{}'); } catch { return {}; }
}

function tagValue(hotspot, key) {
  return parseRaw(hotspot).aiTags?.[key];
}

function dateKey(value) {
  const timestamp = timeValue(value);
  return timestamp ? new Date(timestamp).toISOString().slice(0, 10) : '';
}

function decay(timestamp, asOf, halfLifeHours = 36) {
  if (!timestamp) return 0;
  const ageHours = Math.max(0, (asOf - timestamp) / HOUR);
  return 2 ** (-ageHours / halfLifeHours);
}

function latestTimestamp(values) {
  return values.reduce((latest, value) => Math.max(latest, timeValue(value)), 0);
}

function representativeTitle(event) {
  const semanticTitle = buildEventTitle({ ...(event.normalized || {}), actionType: event.action_type || event.normalized?.actionType });
  return semanticTitle || event.title || event.normalized?.description || event.id;
}

function reasonList({ state, newReportCount, sourceCount, repeatDays, currentCount }) {
  const reasons = [];
  if (state === 'new_event') reasons.push('首次进入事件基座');
  if (state === 'new_update') reasons.push('出现事件新进展');
  if (newReportCount > 0 && state !== 'new_event') reasons.push(`新增 ${newReportCount} 条事实报道`);
  if (sourceCount > 1) reasons.push(`扩散至 ${sourceCount} 个独立来源`);
  if (currentCount > 1) reasons.push(`当前批次 ${currentCount} 条关联报道已归并`);
  if (repeatDays > 1) reasons.push(`已连续出现 ${repeatDays} 天`);
  if (state === 'stale') reasons.push('连续出现但未检测到实质增量');
  return reasons.length ? reasons : ['等待更多可核验信息'];
}

/**
 * Build a deterministic event-level heat ranking. The model/resolver supplies
 * event identity; this function only scores persisted evidence and recency.
 */
export function scoreEventHeat({ event, currentMemberships = [], historicalMemberships = [], hotspotsById = new Map(), asOf = Date.now() }) {
  const currentIds = new Set(currentMemberships.map((membership) => Number(membership.hotspot_id)).filter(Number.isFinite));
  const currentHotspots = [...currentIds].map((id) => hotspotsById.get(id)).filter(Boolean);
  const allMemberships = [...historicalMemberships];
  const seenDates = new Set(allMemberships.map((membership) => dateKey(membership.batch_date || membership.created_at || membership.updated_at)).filter(Boolean));
  const currentSeenDates = new Set(currentMemberships.map((membership) => dateKey(membership.batch_date || membership.created_at || membership.updated_at)).filter(Boolean));
  const repeatDays = Math.max(1, seenDates.size || currentSeenDates.size || 1);
  const latestSeenAt = latestTimestamp([
    event.last_seen_at,
    ...currentHotspots.map((hotspot) => hotspot.published_at || hotspot.created_at),
  ]);
  const lastUpdateAt = event.event_state === 'new_update' || event.event_state === 'new_event'
    ? latestSeenAt : 0;
  const ageHours = latestSeenAt ? Math.max(0, (asOf - latestSeenAt) / HOUR) : Infinity;
  const sourceNames = new Set(currentHotspots.map((hotspot) => hotspot.source_name || hotspot.source_group || hotspot.source).filter(Boolean));
  const sourceGroups = new Set(currentHotspots.map((hotspot) => hotspot.source_group || hotspot.source).filter(Boolean));
  const urlCount = new Set(currentHotspots.map((hotspot) => hotspot.url).filter(Boolean)).size;
  const newInfoCount = currentMemberships.filter((membership) => Number(membership.is_new_information) === 1).length;
  const newReportCount = event.event_state === 'new_event'
    ? currentMemberships.length
    : (event.event_state === 'new_update' ? Math.max(newInfoCount, currentMemberships.length) : newInfoCount);
  const recentCutoff = asOf - 72 * HOUR;
  const recentReportCount = allMemberships.filter((membership) => timeValue(membership.batch_date || membership.created_at || membership.updated_at) >= recentCutoff).length;
  const relevanceValues = currentHotspots.map((hotspot) => Number(tagValue(hotspot, 'chinaRelevance'))).filter(Number.isFinite);
  const chinaRelevance = relevanceValues.length ? Math.max(...relevanceValues) : 0;

  const freshnessScore = Math.round(25 * decay(lastUpdateAt || latestSeenAt, asOf, 36));
  const incrementScore = Math.round(clamp(newReportCount * 8 + Math.max(0, sourceNames.size - 1) * 2, 0, 25));
  const sourceSpreadScore = Math.round(clamp(sourceNames.size * 4 + sourceGroups.size, 0, 15));
  const momentumScore = Math.round(clamp(recentReportCount * 2.5, 0, 15));
  const chinaRelevanceScore = Math.round(clamp(chinaRelevance, 0, 10));
  const evidenceScore = Math.round(clamp(sourceNames.size * 2 + Math.min(urlCount, 4) + (event.confidence === 'high' ? 2 : 1), 0, 10));
  const historyDecayScore = Math.round(clamp(Math.max(0, repeatDays - 1) * 4 + (newReportCount === 0 && repeatDays > 1 ? 5 : 0), 0, 20));
  const stale = (newReportCount === 0 && repeatDays > 1 && ageHours > 24) || ageHours > 72;
  const state = stale ? 'stale' : (event.event_state || 'continuing');
  const heatScore = Math.round(clamp(
    freshnessScore + incrementScore + sourceSpreadScore + momentumScore + chinaRelevanceScore + evidenceScore - historyDecayScore,
    0, 100,
  ));
  return {
    eventId: event.id,
    title: representativeTitle(event),
    state,
    heatScore,
    // 迁移兼容：事件热榜分正式统一称为 eventValue/T，旧 heatScore 保留供现有接口读取。
    eventValue: heatScore,
    t: heatScore,
    freshnessScore,
    incrementScore,
    sourceSpreadScore,
    momentumScore,
    chinaRelevanceScore,
    evidenceScore,
    historyDecayScore,
    reportCount: currentMemberships.length,
    historicalReportCount: allMemberships.length,
    sourceCount: sourceNames.size,
    sourceGroups: sourceGroups.size,
    newReportCount,
    recentReportCount,
    repeatDays,
    firstSeenAt: event.first_seen_at || null,
    lastSeenAt: latestSeenAt ? new Date(latestSeenAt).toISOString() : (event.last_seen_at || null),
    lastUpdateAt: lastUpdateAt ? new Date(lastUpdateAt).toISOString() : null,
    hotspotIds: currentMemberships.map((membership) => Number(membership.hotspot_id)).filter(Number.isFinite),
    marketScopes: [...new Set(currentHotspots.map((hotspot) => hotspot.market_scope).filter(Boolean))],
    keywords: [...new Set(currentHotspots.flatMap((hotspot) => tagValue(hotspot, 'keywords') || []))].slice(0, 12),
    reason: reasonList({ state, newReportCount, sourceCount: sourceNames.size, repeatDays, currentCount: currentMemberships.length }),
  };
}

export function buildEventHeatRanking({ store, batch, previousItems = [], asOf = Date.now() }) {
  if (!store || !batch) return { schemaVersion: 2, titleVersion: 2, generatedAt: new Date(asOf).toISOString(), batchId: batch?.id || null, items: [] };
  const currentMemberships = store.listEventHotspots?.({ batchId: batch.id, limit: 100000 }) || [];
  if (!currentMemberships.length) return { schemaVersion: 2, titleVersion: 2, generatedAt: new Date(asOf).toISOString(), batchId: batch.id, items: [] };
  const historicalMemberships = store.listEventHotspots?.({ limit: 100000 }) || currentMemberships;
  const hotspotsById = new Map((batch.hotspots || []).map((hotspot) => [Number(hotspot.id), hotspot]));
  const currentByEvent = new Map();
  for (const membership of currentMemberships) {
    if (!currentByEvent.has(membership.event_id)) currentByEvent.set(membership.event_id, []);
    currentByEvent.get(membership.event_id).push(membership);
  }
  const historyByEvent = new Map();
  for (const membership of historicalMemberships) {
    if (!historyByEvent.has(membership.event_id)) historyByEvent.set(membership.event_id, []);
    historyByEvent.get(membership.event_id).push(membership);
  }
  const records = new Map((store.listEventRecords?.({ limit: 100000 }) || []).map((event) => [event.id, event]));
  const previous = new Map((previousItems || []).map((item) => [item.eventId, item.rank]));
  const items = [...currentByEvent.entries()].map(([eventId, memberships]) => {
    const event = records.get(eventId) || { id: eventId, title: memberships[0]?.title || eventId, event_state: 'continuing' };
    return scoreEventHeat({ event, currentMemberships: memberships, historicalMemberships: historyByEvent.get(eventId) || memberships, hotspotsById, asOf });
  }).sort((left, right) => right.heatScore - left.heatScore
    || right.incrementScore - left.incrementScore
    || right.sourceCount - left.sourceCount
    || right.reportCount - left.reportCount
    || String(left.lastSeenAt || '').localeCompare(String(right.lastSeenAt || ''))
    || left.eventId.localeCompare(right.eventId));
  const ranked = items.map((item, index) => ({ ...item, rank: index + 1, previousRank: previous.get(item.eventId) ?? null,
    rankDelta: previous.has(item.eventId) ? previous.get(item.eventId) - (index + 1) : null }));
  return {
    schemaVersion: 2,
    titleVersion: 2,
    generatedAt: new Date(asOf).toISOString(),
    batchId: batch.id,
    scoring: { freshness: 25, increment: 25, sourceSpread: 15, momentum: 15, chinaRelevance: 10, evidence: 10, historyDecay: -20, eventValue: 100 },
    totalEvents: ranked.length,
    items: ranked,
  };
}
import { buildEventTitle } from './event-resolution-shadow.mjs';
