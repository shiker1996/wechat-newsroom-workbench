import { materializeStableEvents } from './event-resolution-shadow.mjs';

/**
 * Convert stable resolver events back to the legacy cluster shape consumed by
 * the article-selection pipeline. The stable event id remains the only id used
 * for ranking; legacy clusters are retained only for artifact compatibility.
 */
export function projectStableEvents({ shadowEvents = [], legacyClusters = [], hotspots = [], heatByEvent = new Map() } = {}) {
  const legacyByHotspot = new Map();
  for (const cluster of legacyClusters) for (const article of cluster.articles || []) legacyByHotspot.set(Number(article.hotspot_id), cluster);
  return materializeStableEvents({ shadowEvents, hotspots, heatByEvent }).map((event) => ({
    ...event,
    card: legacyClusters.find((cluster) => cluster.event_id === event.event_id)?.card || null,
    articles: event.articles.map((article) => ({ ...article, legacy_event_id: legacyByHotspot.get(Number(article.hotspot_id))?.event_id || null })),
  }));
}
