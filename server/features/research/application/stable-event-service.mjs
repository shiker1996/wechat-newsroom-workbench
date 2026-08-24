import fs from 'node:fs';
import path from 'node:path';
import { batchTopicsDir } from '../../../platform/core/workspace-paths.mjs';
import { loadShadowHistory, materializeStableEvents, resolveEventShadow } from '../domain/event-resolution-shadow.mjs';

function readJson(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {}
  return null;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function hotspotIdsOf(events) {
  return new Set((events || []).flatMap((event) => [
    ...(event.hotspot_ids || []),
    ...(event.articles || []).map((article) => article?.hotspot_id),
  ]).map(Number).filter(Number.isFinite));
}

function coversHotspots(events, hotspots) {
  const expected = new Set((hotspots || []).map((hotspot) => Number(hotspot.id)).filter(Number.isFinite));
  const actual = hotspotIdsOf(events);
  return expected.size > 0 && expected.size === actual.size && [...expected].every((id) => actual.has(id));
}

function sourcesDir(workspaceRoot, batch) {
  return path.join(batchTopicsDir(workspaceRoot, batch), 'sources');
}

// 生产链路的稳定事件唯一入口：优先复用当前批次稳定事件产物，缺失时在事件卡阶段前置解析。
export function loadStableBatchEvents({ workspaceRoot, batch, hotspots = [] } = {}) {
  const dir = sourcesDir(workspaceRoot, batch);
  const clusters = readJson(path.join(dir, 'event-clusters.json'))?.events;
  if (Array.isArray(clusters) && clusters.length && clusters.every((event) => String(event.event_id || '').startsWith('S')) && coversHotspots(clusters, hotspots)) return clusters;
  const shadow = readJson(path.join(dir, 'event-resolution-shadow.json'));
  if (Array.isArray(shadow?.events) && shadow.events.length && coversHotspots(shadow.events, hotspots)) {
    return materializeStableEvents({ shadowEvents: shadow.events, hotspots });
  }
  return [];
}

export function resolveStableBatchEvents({ store, workspaceRoot, batch, hotspots = [], onProgress = () => {} } = {}) {
  const existing = loadStableBatchEvents({ workspaceRoot, batch, hotspots });
  if (existing.length) return existing;

  const history = loadShadowHistory({ store, workspaceRoot, currentBatchId: batch.id, limit: 30 });
  const shadow = resolveEventShadow({ batch, hotspots, legacyClusters: [], history });
  const dir = sourcesDir(workspaceRoot, batch);
  const shadowPath = path.join(dir, 'event-resolution-shadow.json');
  const diffPath = path.join(dir, 'event-resolution-shadow-diff.json');
  writeJson(shadowPath, shadow);
  writeJson(diffPath, {
    schema_version: shadow.schema_version,
    resolver_version: shadow.resolver_version,
    algorithm_version: shadow.algorithm_version,
    generated_at: shadow.generated_at,
    batch_id: shadow.batch_id,
    input_count: shadow.input_count,
    legacy: shadow.legacy,
    shadow: shadow.shadow,
    conservation: shadow.conservation,
    differences: shadow.differences,
  });
  store?.saveEventResolutionShadow?.(batch.id, shadow);
  if (!shadow.conservation?.ok) throw new Error('稳定事件解析报道数不守恒');

  const events = materializeStableEvents({ shadowEvents: shadow.events || [], hotspots });
  writeJson(path.join(dir, 'event-clusters.json'), {
    generated_at: new Date().toISOString(),
    total_articles: hotspots.length,
    total_events: events.length,
    events,
  });
  onProgress(`稳定事件解析完成：${events.length} 组`);
  return events;
}
