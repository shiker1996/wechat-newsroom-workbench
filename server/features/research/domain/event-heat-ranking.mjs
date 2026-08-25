import fs from 'node:fs';
import path from 'node:path';
import { batchTopicsDir } from '../../../platform/core/workspace-paths.mjs';

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

function classificationOf(event = {}) {
  const raw = event.classification || event.card?.classification || event.event_card?.classification || {};
  const contentClass = String(raw.contentClass || raw.content_class || event.content_class || '').trim();
  const features = raw.features || event.classification_features || {};
  return {
    contentClass: ['github_project', 'open_source_technology', 'open_source_trend', 'news_event'].includes(contentClass)
      ? contentClass : 'news_event',
    status: String(raw.status || raw.classification_status || event.classification_status || 'needs_review'),
    features: features && typeof features === 'object' ? features : {},
  };
}

function eventText(event = {}) {
  return [event.title, event.representative_title, event.normalized?.description, event.keywords,
    event.tags?.eventParts, event.eventParts, ...(event.articles || []).map((article) => [article.title, article.summary, article.source])]
    .flat(4).filter(Boolean).join(' ');
}

function preScoresOf(event = {}) {
  return event.tags?.preScores || event.preScores || {};
}

function sourceStats({ currentHotspots, currentMemberships, features }) {
  const sourceCount = new Set(currentHotspots.map((hotspot) => hotspot.source_name || hotspot.source_group || hotspot.source).filter(Boolean)).size;
  const sourceEvidenceCount = Array.isArray(features.sourceEvidence) ? features.sourceEvidence.length : 0;
  return {
    sourceCount: Math.max(sourceCount, Number(features.independentSourceCount) || 0),
    sourceEvidenceCount,
    reportCount: currentMemberships.length,
  };
}

function scorePartsForClass(contentClass, { event, currentHotspots, currentMemberships, base, asOf }) {
  const features = classificationOf(event).features;
  const scores = preScoresOf(event);
  const stats = sourceStats({ currentHotspots, currentMemberships, features });
  const repositoryMeta = event.repositoryMeta || event.articles?.find((article) => article.repositoryMeta)?.repositoryMeta || null;
  const text = eventText(event);
  const freshness = Math.round(15 * decay(base.lastUpdateAt ? timeValue(base.lastUpdateAt) : timeValue(base.lastSeenAt), asOf, 240));
  if (contentClass === 'open_source_technology') {
    const novelty = clamp((Number(scores.informationGain) || 0) / 15 * 15 + (features.hasPaper ? 5 : 0) + (features.hasBenchmark ? 5 : 0), 0, 25);
    const mechanismDepth = clamp((features.hasTechnicalDocs ? 8 : 0) + (features.hasPaper ? 7 : 0) + (features.hasBenchmark ? 5 : 0), 0, 20);
    const engineeringImpact = clamp((Number(scores.impact) || 0) / 10 * 12 + (features.hasAdoptionSignal ? 4 : 0) + (features.hasCompatibilitySignal ? 4 : 0), 0, 20);
    const reproducibility = clamp((features.hasBenchmark ? 9 : 0) + (features.hasPaper ? 4 : 0) + (features.hasTechnicalDocs ? 4 : 0) + (repositoryMeta ? 3 : 0), 0, 15);
    const timeliness = clamp(Math.round(20 * decay(base.lastUpdateAt ? timeValue(base.lastUpdateAt) : timeValue(base.lastSeenAt), asOf, 168)), 0, 20);
    return { novelty: Number(novelty.toFixed(1)), mechanismDepth: Number(mechanismDepth.toFixed(1)), engineeringImpact: Number(engineeringImpact.toFixed(1)), reproducibility: Number(reproducibility.toFixed(1)), timeliness, sourceCount: stats.sourceCount, scoreValue: Number(clamp(novelty + mechanismDepth + engineeringImpact + reproducibility + timeliness, 0, 100).toFixed(1)) };
  }
  if (contentClass === 'open_source_trend') {
    const breadth = clamp((stats.sourceCount * 4) + ((Number(features.subjectCount) || 0) * 4), 0, 25);
    const trajectory = clamp((features.hasTimeline ? 8 : 0) + (features.hasAdoptionSignal ? 5 : 0) + (features.hasMigrationSignal ? 5 : 0) + (base.repeatDays > 1 ? 2 : 0), 0, 20);
    const ecosystemImpact = clamp((features.hasAdoptionSignal ? 7 : 0) + (features.hasMigrationSignal ? 5 : 0) + (features.hasCompatibilitySignal ? 4 : 0) + (features.hasPolicyOrStandardSignal ? 4 : 0), 0, 20);
    const evidenceQuality = clamp((stats.sourceCount * 4) + (features.hasTechnicalDocs ? 2 : 0) + (stats.sourceEvidenceCount > 2 ? 2 : 0), 0, 20);
    const timeliness = clamp(Math.round(15 * decay(base.lastUpdateAt ? timeValue(base.lastUpdateAt) : timeValue(base.lastSeenAt), asOf, 240)), 0, 15);
    return { breadth: Number(breadth.toFixed(1)), trajectory: Number(trajectory.toFixed(1)), ecosystemImpact: Number(ecosystemImpact.toFixed(1)), evidenceQuality: Number(evidenceQuality.toFixed(1)), timeliness, sourceCount: stats.sourceCount, scoreValue: Number(clamp(breadth + trajectory + ecosystemImpact + evidenceQuality + timeliness, 0, 100).toFixed(1)) };
  }
  if (contentClass === 'github_project') {
    const projectClarity = clamp((repositoryMeta ? 18 : 8) + (features.hasTechnicalDocs ? 5 : 0) + (/工具|框架|插件|workflow|cli|sdk/i.test(text) ? 7 : 0), 0, 30);
    const demonstrability = clamp((features.hasGithubRepository ? 12 : 4) + (features.hasRelease ? 5 : 0) + (repositoryMeta?.language ? 4 : 0) + (repositoryMeta?.topics?.length ? 4 : 0), 0, 25);
    const discoveryFreshness = clamp(Math.round(20 * decay(base.lastUpdateAt ? timeValue(base.lastUpdateAt) : timeValue(base.lastSeenAt), asOf, 96)), 0, 20);
    const sourceCompleteness = clamp(stats.sourceCount * 4 + (stats.sourceEvidenceCount > 1 ? 4 : 0) + (Number(features.repositoryCount) > 0 ? 4 : 0), 0, 15);
    const visualPotential = clamp((features.hasGithubRepository ? 6 : 2) + (repositoryMeta?.topics?.length ? 4 : 0), 0, 10);
    return { projectClarity: Number(projectClarity.toFixed(1)), demonstrability: Number(demonstrability.toFixed(1)), discoveryFreshness, sourceCompleteness: Number(sourceCompleteness.toFixed(1)), visualPotential: Number(visualPotential.toFixed(1)), sourceCount: stats.sourceCount, scoreValue: Number(clamp(projectClarity + demonstrability + discoveryFreshness + sourceCompleteness + visualPotential, 0, 100).toFixed(1)) };
  }
  return {
    freshness: base.freshnessScore,
    increment: base.incrementScore,
    sourceSpread: base.sourceSpreadScore,
    momentum: base.momentumScore,
    chinaRelevance: base.chinaRelevanceScore,
    evidence: base.evidenceScore,
    historyDecay: base.historyDecayScore,
    scoreValue: base.heatScore,
  };
}

/** Score a classified stable event without forcing project/technology/trend into news heat semantics. */
export function scoreClassifiedEvent({ event, currentMemberships = [], historicalMemberships = [], hotspotsById = new Map(), asOf = Date.now() }) {
  const base = scoreEventHeat({ event, currentMemberships, historicalMemberships, hotspotsById, asOf });
  const { contentClass, status } = classificationOf(event);
  const scoreParts = scorePartsForClass(contentClass, { event, currentHotspots: currentMemberships.map((membership) => hotspotsById.get(Number(membership.hotspot_id))).filter(Boolean), currentMemberships, base, asOf });
  const scoreValue = Number.isFinite(Number(scoreParts.scoreValue)) ? Number(scoreParts.scoreValue) : base.heatScore;
  return {
    ...base,
    contentClass,
    classificationStatus: status,
    scoreModel: contentClass,
    scoreValue,
    heatScore: scoreValue,
    eventValue: scoreValue,
    t: scoreValue,
    scoreParts,
    scoreComparable: false,
  };
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

export function buildEventHeatRanking({ store, batch, previousItems = [], events = [], asOf = Date.now() }) {
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
  const eventInputs = new Map((events || []).map((event) => [event.event_id || event.id, event]));
  const previous = new Map((previousItems || []).map((item) => [item.eventId, item]));
  const items = [...currentByEvent.entries()].map(([eventId, memberships]) => {
    const record = records.get(eventId) || { id: eventId, title: memberships[0]?.title || eventId, event_state: 'continuing' };
    const input = eventInputs.get(eventId) || record;
    const classification = input.classification || (record.content_class ? { content_class: record.content_class, status: record.classification_status, features: record.classification_features } : null);
    return scoreClassifiedEvent({ event: { ...record, ...input, id: eventId, classification }, currentMemberships: memberships, historicalMemberships: historyByEvent.get(eventId) || memberships, hotspotsById, asOf });
  }).sort((left, right) => right.scoreValue - left.scoreValue
    || right.incrementScore - left.incrementScore
    || right.sourceCount - left.sourceCount
    || right.reportCount - left.reportCount
    || String(left.lastSeenAt || '').localeCompare(String(right.lastSeenAt || ''))
    || left.eventId.localeCompare(right.eventId));
  const ranked = items.map((item, index) => {
    const prior = previous.get(item.eventId);
    const priorRank = Number.isFinite(Number(prior?.rank)) ? Number(prior.rank) : null;
    return { ...item, rank: index + 1, previousRank: priorRank, rankDelta: priorRank == null ? null : priorRank - (index + 1) };
  });
  const rankings = Object.fromEntries(['news_event', 'open_source_technology', 'open_source_trend', 'github_project'].map((contentClass) => {
    const board = ranked.filter((item) => item.contentClass === contentClass).map((item, index) => {
      const prior = previous.get(item.eventId);
      const priorRank = prior?.contentClass === contentClass && Number.isFinite(Number(prior.rank)) ? Number(prior.rank) : null;
      return { ...item, rank: index + 1, boardRank: index + 1, rankScope: contentClass, previousRank: priorRank, rankDelta: priorRank == null ? null : priorRank - (index + 1) };
    });
    return [contentClass, { contentClass, scoreModel: contentClass, scoreComparable: false, totalEvents: board.length, items: board }];
  }));
  return {
    schemaVersion: 2,
    titleVersion: 2,
    generatedAt: new Date(asOf).toISOString(),
    batchId: batch.id,
    scoring: { freshness: 25, increment: 25, sourceSpread: 15, momentum: 15, chinaRelevance: 10, evidence: 10, historyDecay: -20, eventValue: 100 },
    scoringModels: { news_event: 'T_news', open_source_technology: 'T_technology', open_source_trend: 'T_trend', github_project: 'projectDiscoveryScore' },
    totalEvents: ranked.length,
    rankings,
    items: ranked,
  };
}

/** Read the most recent completed batch's ranking for cross-batch movement. */
export function loadPreviousEventHeatItems({ store, workspaceRoot, batch, limit = 60 } = {}) {
  if (!store || !workspaceRoot || !batch) return [];
  const currentDate = String(batch.batch_date || '');
  const currentCreatedAt = String(batch.created_at || '');
  const previousBatches = (store.listBatches?.(limit) || [])
    .filter((candidate) => candidate?.id && candidate.id !== batch.id)
    .filter((candidate) => {
      const date = String(candidate.batch_date || '');
      if (date < currentDate) return true;
      return date === currentDate && String(candidate.created_at || '') < currentCreatedAt;
    })
    .sort((left, right) => String(right.batch_date || '').localeCompare(String(left.batch_date || ''))
      || String(right.created_at || '').localeCompare(String(left.created_at || '')));
  for (const previous of previousBatches) {
    const file = path.join(batchTopicsDir(workspaceRoot, previous), 'sources', 'event-heat-ranking.json');
    try {
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(payload?.items)) return payload.items;
    } catch {}
  }
  return [];
}
import { buildEventTitle } from './event-resolution-shadow.mjs';
