import fs from 'node:fs';
import path from 'node:path';
import { batchTopicsDir } from '../core/workspace-paths.mjs';
import { isResearchEligibleHotspot } from './hotspot-pipeline-scope.mjs';
import { clusterItems } from '../llm/research-pipeline.mjs';
import { loadShadowHistory, resolveEventShadow } from './event-resolution-shadow.mjs';

function readJson(filePath) {
  try { if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
  return null;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, filePath);
  const stat = fs.statSync(filePath);
  return { size: stat.size, modifiedAt: stat.mtime.toISOString() };
}

function sortOldestFirst(left, right) {
  return String(left.batch_date || '').localeCompare(String(right.batch_date || ''))
    || String(left.created_at || '').localeCompare(String(right.created_at || ''))
    || String(left.id || '').localeCompare(String(right.id || ''));
}

function recentBatches(store, limit) {
  return (store?.listBatches?.(Math.max(30, limit * 3)) || [])
    .filter((batch) => batch?.id && Number(batch.hotspot_count || 0) > 0)
    .sort((left, right) => String(right.batch_date || '').localeCompare(String(left.batch_date || ''))
      || String(right.created_at || '').localeCompare(String(left.created_at || '')))
    .slice(0, limit)
    .sort(sortOldestFirst);
}

function stableByHotspot(events) {
  const map = new Map();
  for (const event of events || []) for (const hotspotId of event.hotspot_ids || []) map.set(Number(hotspotId), event.event_id);
  return map;
}

function migrateEventCards({ store, workspaceRoot, batch, shadow }) {
  const workdir = batchTopicsDir(workspaceRoot, batch);
  const sourcesDir = path.join(workdir, 'sources');
  const cardsPath = path.join(sourcesDir, 'event-cards.json');
  const clustersPath = path.join(sourcesDir, 'event-clusters.json');
  const cards = readJson(cardsPath);
  const clusters = readJson(clustersPath);
  if (!cards || !Array.isArray(cards.items) || !clusters || !Array.isArray(clusters.events)) {
    return { status: 'missing', migrated: 0, needsReview: 0, path: null };
  }
  const legacyHotspots = new Map();
  for (const cluster of clusters.events) legacyHotspots.set(cluster.event_id, (cluster.articles || []).map((article) => Number(article.hotspot_id)).filter(Number.isFinite));
  const stableMap = stableByHotspot(shadow.events);
  const migratedItems = [];
  let migrated = 0; let needsReview = 0;
  for (const card of cards.items) {
    const hotspotIds = legacyHotspots.get(card.event_id) || [];
    const stableIds = [...new Set(hotspotIds.map((id) => stableMap.get(id)).filter(Boolean))];
    if (stableIds.length === 1) {
      migratedItems.push({ ...card, legacy_event_id: card.event_id, event_record_id: stableIds[0], event_id: stableIds[0] });
      migrated += 1;
    } else {
      migratedItems.push({ ...card, legacy_event_id: card.event_id, event_record_id: null, migration_status: 'needs_review' });
      needsReview += 1;
    }
  }
  const output = { ...cards, schema_version: 2, generated_at: new Date().toISOString(), source_event_cards: path.basename(cardsPath), items: migratedItems };
  const stablePath = path.join(sourcesDir, 'event-cards-stable.json');
  const stat = writeJson(stablePath, output);
  store?.upsertArtifact?.({ batchId: batch.id, kind: '稳定事件事实卡', name: 'event-cards-stable.json', path: stablePath, ...stat });
  return { status: 'ready', migrated, needsReview, path: stablePath };
}

export function runEventResolutionBackfill({ store, workspaceRoot, limit = 14, apply = false } = {}) {
  if (!store) throw new Error('回填需要 Store');
  if (!workspaceRoot) throw new Error('回填需要 workspaceRoot');
  const batches = recentBatches(store, limit);
  const history = new Map();
  // 若已有影子产物，先纳入历史候选；正式回填仍按最早批次到最新批次重算。
  const selectedBatchIds = new Set(batches.map((batch) => batch.id));
  for (const event of loadShadowHistory({ store, workspaceRoot, currentBatchId: null, limit: Math.max(30, limit * 3) })) {
    if (selectedBatchIds.has(event.historyBatchId)) continue;
    if (event?.event_id && !history.has(event.event_id)) history.set(event.event_id, event);
  }
  const batchReports = [];
  for (const batch of batches) {
    const fullBatch = store.getBatch(batch.id) || batch;
    const hotspots = (fullBatch.hotspots || []).filter(isResearchEligibleHotspot);
    const legacyClusters = clusterItems(hotspots);
    const shadow = resolveEventShadow({ batch: fullBatch, hotspots, legacyClusters, history: [...history.values()] });
    let migration = { status: 'dry-run', migrated: 0, needsReview: 0, path: null };
    if (apply) {
      store.saveEventResolutionShadow(fullBatch.id, shadow);
      migration = migrateEventCards({ store, workspaceRoot, batch: fullBatch, shadow });
    }
    for (const event of shadow.events || []) history.set(event.event_id, event);
    batchReports.push({
      batch_id: batch.id, batch_date: batch.batch_date, batch_type: batch.batch_type,
      input_count: shadow.input_count, legacy_event_count: shadow.legacy.event_count, shadow_event_count: shadow.shadow.event_count,
      conservation: shadow.conservation, merges: shadow.differences.merges.length, splits: shadow.differences.splits.length,
      review_queue: shadow.differences.review_queue.length, event_card_migration: migration,
      persisted: Boolean(apply),
    });
  }
  const report = {
    schema_version: 1, resolver_version: 'shadow-v1', algorithm_version: 'structured-v1',
    mode: apply ? 'apply' : 'dry-run', generated_at: new Date().toISOString(), batch_limit: limit,
    batch_count: batchReports.length,
    totals: {
      input_count: batchReports.reduce((sum, item) => sum + item.input_count, 0),
      legacy_event_count: batchReports.reduce((sum, item) => sum + item.legacy_event_count, 0),
      shadow_event_count: batchReports.reduce((sum, item) => sum + item.shadow_event_count, 0),
      merges: batchReports.reduce((sum, item) => sum + item.merges, 0),
      splits: batchReports.reduce((sum, item) => sum + item.splits, 0),
      review_queue: batchReports.reduce((sum, item) => sum + item.review_queue, 0),
      conservation_ok: batchReports.every((item) => item.conservation.ok),
    },
    batches: batchReports,
  };
  return report;
}

export function writeEventResolutionBackfillReport(workspaceRoot, report) {
  return writeJson(path.join(workspaceRoot, 'topics', 'event-resolution-backfill.json'), report);
}
