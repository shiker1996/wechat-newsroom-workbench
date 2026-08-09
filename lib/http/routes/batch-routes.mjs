import fs from 'node:fs';
import path from 'node:path';
import { isFreshForBatch, clusterItems, preselection, selectSocialCandidates } from '../../llm/research-pipeline.mjs';
import { buildHotspotAtlas } from '../../domain/hotspot-atlas.mjs';
import { isResearchEligibleHotspot } from '../../domain/hotspot-pipeline-scope.mjs';
import { buildBatchPipelineStatus } from '../../domain/batch-pipeline-status.mjs';
import { getBatchDeleteImpact, deleteBatchPermanently } from '../../domain/batch-deletion.mjs';
import { respond } from '../route-helpers.mjs';

export async function handleBatchRoutes({ request, response, pathname, searchParams, root, store, jobs, body, json,
  batchWorkdir, decorateBatch, batchMaxAgeHours, config, buildStatus = buildBatchPipelineStatus }) {
  if (request.method === 'GET' && pathname === '/api/batches') return respond(json, response, 200, store.listBatches(Number(searchParams.get('limit') ?? 60)));
  if (request.method === 'POST' && pathname === '/api/batches') {
    const input = await body(request);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '') ? input.date : new Date().toISOString().slice(0, 10);
    return respond(json, response, 201, store.createBatch({ date, title: input.title || `${date} 每日选题`, note: input.note }));
  }
  if (request.method === 'POST' && pathname === '/api/batches/breaking') {
    const input = await body(request);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '') ? input.date : new Date().toISOString().slice(0, 10);
    try {
      return respond(json, response, 201, store.createBreakingBatch({ date, title: input.title, note: input.note,
        urls: Array.isArray(input.urls) ? input.urls : String(input.urls || '').split(/\r?\n/),
        requestedTracks: Array.isArray(input.requestedTracks) ? input.requestedTracks : ['article'] }));
    } catch (error) { return respond(json, response, 400, { error: error.message }); }
  }
  const batchMatch = pathname.match(/^\/api\/batches\/([^/]+)$/);
  if (batchMatch && request.method === 'GET') {
    const batch = decorateBatch(store.getBatch(decodeURIComponent(batchMatch[1])));
    if (batch) {
      try {
        const cardFile = path.join(batchWorkdir(batch), 'sources', 'event-cards.json');
        const cardCount = fs.existsSync(cardFile) ? (JSON.parse(fs.readFileSync(cardFile, 'utf8'))?.items || []).length : 0;
        const tagged = batch.hotspots.filter((item) => !item.is_stale && isResearchEligibleHotspot(item)).filter((item) => {
          try { const tags = JSON.parse(item.raw_json).aiTags; return Boolean(tags?.eventKey && tags?.preScores); } catch { return false; }
        });
        const cardTotal = clusterItems(tagged).length;
        batch.event_cards = { count: cardTotal ? Math.min(cardCount, cardTotal) : 0, total: cardTotal };
      } catch { batch.event_cards = { count: 0, total: 0 }; }
      batch.pipeline_status = buildStatus({ hotspotCount: batch.ai_status.total, tagged: batch.ai_status.tagged,
        total: batch.ai_status.total, cardsCount: batch.event_cards.count, cardsTotal: batch.event_cards.total,
        latestResearch: batch.ai_status.latestResearch });
    }
    return respond(json, response, batch ? 200 : 404, batch ?? { error: '批次不存在' });
  }
  if (batchMatch && request.method === 'PATCH') {
    const input = await body(request);
    if (input.lifecycleStatus != null) {
      if (!['active', 'completed', 'archived'].includes(input.lifecycleStatus)) return respond(json, response, 400, { error: '批次生命周期状态无效' });
      input.lifecycle_status = input.lifecycleStatus;
      delete input.lifecycleStatus;
    }
    const updated = store.updateBatch(decodeURIComponent(batchMatch[1]), input);
    return respond(json, response, updated ? 200 : 404, updated ?? { error: '批次不存在' });
  }
  const batchDeleteImpactMatch = pathname.match(/^\/api\/batches\/([^/]+)\/delete-impact$/);
  if (batchDeleteImpactMatch && request.method === 'GET') {
    const impact = getBatchDeleteImpact(root, store, decodeURIComponent(batchDeleteImpactMatch[1]));
    return respond(json, response, impact ? 200 : 404, impact ?? { error: '批次不存在' });
  }
  if (batchMatch && request.method === 'DELETE') {
    const batchId = decodeURIComponent(batchMatch[1]);
    const batch = store.getBatch(batchId);
    if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    if ((batch.lifecycle_status || 'active') !== 'archived') return respond(json, response, 409, { error: '只有已归档批次可以彻底删除，请先归档' });
    if (request.headers['x-admin-confirm'] !== 'DELETE-BATCH') return respond(json, response, 400, { error: '缺少彻底删除确认头 x-admin-confirm: DELETE-BATCH' });
    const result = deleteBatchPermanently(root, store, batchId);
    return respond(json, response, 200, { ok: true, ...result });
  }
  const collectMatch = pathname.match(/^\/api\/batches\/([^/]+)\/collect$/);
  if (collectMatch && request.method === 'POST') {
    const input = await body(request);
    const sources = [...new Set((input.sources ?? ['reddit', 'rsshub', 'github']).filter((item) => ['reddit', 'rsshub', 'github'].includes(item)))];
    if (!sources.length) return respond(json, response, 400, { error: '没有可执行的数据源' });
    const batchId = decodeURIComponent(collectMatch[1]);
    let maxAgeHours = null;
    if (input.maxAgeHours != null) {
      maxAgeHours = Number(input.maxAgeHours);
      if (![24, 48, 72, 120, 168].includes(maxAgeHours)) return respond(json, response, 400, { error: '时间范围只支持 24、48、72、120、168 小时' });
      store.updateBatch(batchId, { max_age_hours: maxAgeHours });
    }
    return respond(json, response, 202, jobs.startCollection(batchId, sources, maxAgeHours));
  }
  const overviewMatch = pathname.match(/^\/api\/batches\/([^/]+)\/overview$/);
  const rankingMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ranking$/);
  const socialRankingMatch = pathname.match(/^\/api\/batches\/([^/]+)\/social-ranking$/);
  if (socialRankingMatch && request.method === 'GET') {
    const batchId = decodeURIComponent(socialRankingMatch[1]); const batch = store.getBatch(batchId);
    if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    const file = path.join(batchWorkdir(batch), 'sources', 'social-card-ranking.json');
    let items = []; try { items = JSON.parse(fs.readFileSync(file, 'utf8')).items || []; } catch {}
    if (!items.length) {
      const eligible = batch.hotspots.filter(isResearchEligibleHotspot).filter((item) => isFreshForBatch(item, batch.batch_date, batchMaxAgeHours(batch)));
      const tagged = eligible.filter((item) => { try { const tags = JSON.parse(item.raw_json || '{}').aiTags; return tags?.eventKey && tags?.preScores; } catch { return false; } });
      if (tagged.length) items = selectSocialCandidates(preselection(clusterItems(tagged), batch.batch_date), tagged.length, true).map((item, index) => ({ ...item, socialRank: index + 1, selected: index < 10 && item.eligible }));
    }
    const inPoolIds = new Set(store.listCandidates(batchId, 'social_cards').map((item) => item.hotspot_id));
    return respond(json, response, 200, items.map((item) => ({ ...item, inPool: inPoolIds.has(item.hotspotId) })));
  }
  if (rankingMatch && request.method === 'GET') {
    const batchId = decodeURIComponent(rankingMatch[1]); const batch = store.getBatch(batchId);
    if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    const items = batch.hotspots.filter((item) => !item.is_stale).map((item) => {
      const raw = (() => { try { return JSON.parse(item.raw_json || '{}'); } catch { return {}; } })();
      const tags = raw.aiTags || {}; const preScores = tags.preScores || {};
      const base = ['conflict', 'audience', 'informationGain', 'emotion', 'timeliness', 'impact', 'sourceReliability'].reduce((s, k) => s + (preScores[k] || 0), 0);
      return { hotspotId: item.id, title: item.title, category: item.category, marketScope: item.market_scope,
        riskLevel: tags.riskLevel || item.category, score: base + (tags.categoryPreference || 0) + (tags.credibleScoop || 0) - (tags.saturationPenalty || 0),
        eliminationReason: raw.eliminationReason || '', inPool: false };
    }).sort((a, b) => b.score - a.score).map((item, idx) => ({ ...item, rank: idx + 1 }));
    const inPoolIds = new Set(store.listCandidates(batchId).map((c) => c.hotspot_id));
    for (const item of items) if (inPoolIds.has(item.hotspotId)) item.inPool = true;
    return respond(json, response, 200, items);
  }
  if (overviewMatch && request.method === 'GET') {
    const batchId = decodeURIComponent(overviewMatch[1]); const batch = store.getBatch(batchId);
    if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    const eligible = batch.hotspots.filter(isResearchEligibleHotspot).filter((item) => isFreshForBatch(item, batch.batch_date, batchMaxAgeHours(batch)));
    const taggedCount = eligible.filter((item) => { try { const tags = JSON.parse(item.raw_json).aiTags; return Boolean(tags?.eventKey && tags?.relevanceReason && tags?.preScores); } catch { return false; } }).length;
    const atlas = buildHotspotAtlas({ clusters: clusterItems(eligible), totalArticles: eligible.length, taggedCount, excludedStale: batch.hotspots.length - eligible.length });
    try {
      const cardFile = path.join(batchWorkdir(batch), 'sources', 'event-cards.json');
      if (fs.existsSync(cardFile)) {
        const cardMap = new Map((JSON.parse(fs.readFileSync(cardFile, 'utf8'))?.items || []).map((item) => [item.event_id, item]));
        for (const event of atlas.events || []) { const card = cardMap.get(event.event_id); if (card) event.card = card; }
        for (const node of atlas.graph?.nodes || []) if (node.type === 'event') { const card = cardMap.get(String(node.id).replace(/^event:/, '')); if (card?.conclusion) node.summary = card.conclusion; }
      }
    } catch { /* event cards are optional */ }
    return respond(json, response, 200, atlas);
  }
  return false;
}
