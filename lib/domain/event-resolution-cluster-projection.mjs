import { buildEventTitle } from './event-resolution-shadow.mjs';

function parseRaw(hotspot) {
  try { return JSON.parse(hotspot?.raw_json || '{}'); } catch { return {}; }
}

function sourceOf(article) {
  return article.source || article.channel || '未知来源';
}

/**
 * Convert stable resolver events back to the legacy cluster shape consumed by
 * the article-selection pipeline. The stable event id remains the only id used
 * for ranking; legacy clusters are retained only for artifact compatibility.
 */
export function projectStableEvents({ shadowEvents = [], legacyClusters = [], hotspots = [], heatByEvent = new Map() } = {}) {
  const legacyByHotspot = new Map();
  for (const cluster of legacyClusters) for (const article of cluster.articles || []) legacyByHotspot.set(Number(article.hotspot_id), { cluster, article });
  const hotspotById = new Map(hotspots.map((hotspot) => [Number(hotspot.id), hotspot]));
  return shadowEvents.map((stableEvent) => {
    const members = (stableEvent.hotspot_ids || []).map((hotspotId) => {
      const mapped = legacyByHotspot.get(Number(hotspotId));
      const hotspot = hotspotById.get(Number(hotspotId));
      if (mapped) return { ...mapped.article, hotspot_id: Number(hotspotId), legacy_event_id: mapped.cluster.event_id };
      const raw = parseRaw(hotspot); const tags = raw.aiTags || {};
      return { category_id: `G${String(hotspotId).padStart(5, '0')}`, hotspot_id: Number(hotspotId), title: hotspot?.title || stableEvent.title,
        source: hotspot?.source_name || hotspot?.source_group || hotspot?.source || '未知来源', channel: hotspot?.source || '', url: hotspot?.url || null,
        heat: hotspot?.score ?? null, time: hotspot?.published_at || hotspot?.created_at || null, risk_level: tags.riskLevel || '待评估', summary: raw.summary || '' };
    }).filter(Boolean);
    const lead = members[0] || {};
    const legacy = legacyByHotspot.get(Number(lead.hotspot_id))?.cluster;
    const leadHotspot = hotspotById.get(Number(lead.hotspot_id));
    const leadTags = leadHotspot ? parseRaw(leadHotspot).aiTags || {} : (legacy?.tags || {});
    const normalized = stableEvent.normalized || {};
    const heat = heatByEvent.get(stableEvent.event_id) || {};
    const eventParts = { ...(leadTags.eventParts || {}), who: normalized.whoKey || leadTags.eventParts?.who || '',
      what: normalized.triggerKey || leadTags.eventParts?.what || stableEvent.title, object: normalized.objectKey || leadTags.eventParts?.object || '',
      actionType: normalized.actionType || leadTags.eventParts?.actionType || '其他' };
    const tags = { ...leadTags, eventKey: normalized.eventKey || leadTags.eventKey || '', eventParts };
    const sourceSet = new Set(members.map(sourceOf).filter(Boolean));
    const latest = members.map((article) => article.time).filter(Boolean).sort().at(-1) || stableEvent.last_seen_at || null;
    return {
      event_id: stableEvent.event_id,
      stable_event_id: stableEvent.event_id,
      // 事件标题来自稳定事件语义，不使用报道的噱头标题；报道标题仍保留在 articles 供溯源。
      representative_title: buildEventTitle({ ...(normalized || {}), actionType: normalized.actionType }) || stableEvent.title || '未命名事件',
      representativeHotspotId: Number(lead.hotspot_id) || members[0]?.hotspot_id || null,
      market_scope: legacy?.market_scope || leadHotspot?.market_scope || '待标注',
      china_relevance_score: Number(heat.chinaRelevanceScore ?? leadTags.chinaRelevance ?? legacy?.china_relevance_score ?? 0),
      china_relevance_reason: leadTags.relevanceReason || legacy?.china_relevance_reason || '',
      global_exception: Boolean(leadTags.globalException),
      topic_category: legacy?.topic_category || leadHotspot?.category || '📰 综合资讯',
      keywords: [...new Set(members.flatMap((article) => article.keywords || []).concat(leadTags.keywords || []))].slice(0, 12),
      source_count: sourceSet.size,
      report_count: members.length,
      peak_source_percentile: null,
      latest_time: latest,
      cluster_confidence: members.length > 1 ? 'medium' : 'low',
      articles: members,
      tags,
      repositoryMeta: legacy?.repositoryMeta || null,
      eventHeatScore: heat.heatScore ?? null,
      eventValue: heat.eventValue ?? heat.heatScore ?? null,
      t: heat.t ?? heat.eventValue ?? heat.heatScore ?? null,
      eventHeatRank: heat.rank ?? null,
      eventHeatState: heat.state || null,
      eventHistoryRepeatDays: Number(heat.repeatDays || 0),
      duplicatePenalty: heat.state === 'stale' ? 15 : Math.min(12, Math.max(0, Number(heat.repeatDays || 0) - 1) * 4),
      card: legacy?.card || null,
    };
  });
}
