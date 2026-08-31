import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWriteUtf8 } from '../core/atomic-file.mjs';
import { isFreshForBatch, eventGroupsForCandidate, loadStableBatchEvents, resolveEventAnalysis } from '../../features/research/index.mjs';
import { isResearchEligibleHotspot } from '../../features/research/index.mjs';

export function respond(json, response, status, data) {
  json(response, status, data);
  return true;
}

export function boundedLimit(searchParams, fallback, max = 500) {
  const raw=searchParams.get('limit');
  if(raw===null||raw==='')return fallback;
  const value=Number(raw);
  return Number.isInteger(value)&&value>0?Math.min(value,max):fallback;
}

export function pipeFile(response, filePath) {
  const source=fs.createReadStream(filePath);
  source.once('error',(error)=>{console.error(error);if(!response.headersSent)response.writeHead(error.code==='ENOENT'?404:500);if(!response.writableEnded)response.end();});
  response.once('close',()=>{if(!source.destroyed)source.destroy();});
  source.pipe(response);
  return true;
}

export function createNdjsonSession(request,response){
  const controller=new AbortController();let closed=false;
  request.once('aborted',()=>{closed=true;controller.abort(new Error('client aborted'));});
  response.once('close',()=>{if(!response.writableEnded){closed=true;controller.abort(new Error('client disconnected'));}});
  response.once('error',()=>{closed=true;controller.abort(new Error('response failed'));});
  return {signal:controller.signal,send(event){if(closed||response.destroyed||response.writableEnded)return false;return response.write(`${JSON.stringify(event)}\n`);},end(){if(!closed&&!response.destroyed&&!response.writableEnded)response.end();}};
}

export function writeUtf8(filePath, content) {
  return atomicWriteUtf8(filePath,content,{stat:true});
}

export function customArticleFingerprint(batchId, input = {}) {
  const normalized = {};
  for (const key of ['articleMode', 'skillId', 'topic', 'audience', 'thesis', 'environment', 'points', 'steps', 'prerequisites', 'expected_results', 'common_errors', 'limitations', 'materialUrls', 'selectedMaterialIds', 'localProjectPath']) {
    const value = input[key];
    normalized[key] = Array.isArray(value)
      ? value.map((item) => String(item || '').trim()).filter(Boolean)
      : String(value || '').trim().replace(/\r\n/g, '\n');
  }
  normalized.stageSkills = Object.fromEntries(Object.entries(input.stageSkills || {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, String(value || '').trim()]));
  return crypto.createHash('sha256').update(JSON.stringify({ batchId, ...normalized })).digest('hex');
}

export function createRouteHelpers({ store, config, batchWorkdir }) {
  const batchMaxAgeHours = (batch) => Number(batch?.max_age_hours) || config.rsshub.maxAgeHours;

  function decorateBatch(batch) {
    if (!batch) return batch;
    let stale = 0;
    const maxAgeHours = batchMaxAgeHours(batch);
    batch.hotspots = batch.hotspots.map((item) => {
      const is_stale = !isFreshForBatch(item, batch.batch_date, maxAgeHours);
      if (is_stale) stale += 1;
      return { ...item, is_stale };
    });
    batch.freshness = { fresh: batch.hotspots.length - stale, stale, maxAgeHours };
    if (batch.ai_status) {
      const freshItems = batch.hotspots.filter((item) => !item.is_stale && isResearchEligibleHotspot(item));
      batch.ai_status = {
        ...batch.ai_status,
        tagged: freshItems.filter((item) => {
          try { return Boolean(JSON.parse(item.raw_json).aiTags?.eventKey); } catch { return false; }
        }).length,
        total: freshItems.length,
      };
    }
    return batch;
  }

  function candidateEventGroups(candidate, contentLimit = 2000) {
    return eventGroupsForCandidate({
      store,
      workspaceRoot: config.workspaceRoot,
      candidate,
      contentLimit,
      defaultMaxAgeHours: config.rsshub.maxAgeHours,
    });
  }

  function resolveEventAnalysisFor(candidate) {
    return resolveEventAnalysis({
      store,
      workspaceRoot: config.workspaceRoot,
      candidate,
      defaultMaxAgeHours: config.rsshub.maxAgeHours,
    });
  }

  function loadBatchEventCards(batch) {
    try {
      const file = path.join(batchWorkdir(batch), 'sources', 'event-cards.json');
      if (!fs.existsSync(file)) return null;
      const cardMap = new Map((JSON.parse(fs.readFileSync(file, 'utf8'))?.items || []).map((card) => [String(card.event_id), card]));
      const eligible = (batch.hotspots || []).filter(isResearchEligibleHotspot)
        .filter((item) => isFreshForBatch(item, batch.batch_date, batchMaxAgeHours(batch)));
      const clusters = loadStableBatchEvents({ workspaceRoot: config.workspaceRoot, batch, hotspots: eligible });
      const result = new Map();
      for (const cluster of clusters) {
        const card = cardMap.get(String(cluster.event_id));
        if (!card) continue;
        for (const item of cluster.articles || []) if (item.hotspot_id) result.set(item.hotspot_id, card);
      }
      return result;
    } catch { return null; }
  }

  function candidateEventCard(candidate) {
    return candidateEventGroups(candidate).map((group) => group.card).find(Boolean) || null;
  }

  function attachEventConclusions(candidates, batchId) {
    const batch = store.getBatch(batchId);
    const cardMap = batch ? loadBatchEventCards(batch) : null;
    if (!cardMap) return candidates;
    return candidates.map((candidate) => {
      if (candidate.pool_role === '议题综合') return candidate;
      const hotspotIds = candidate.pool_role === '议题综合'
        ? (store.candidateHotspots(candidate.id) || []).map((item) => item.hotspot_id)
        : [candidate.hotspot_id];
      const card = hotspotIds.map((id) => cardMap.get(String(id))).find(Boolean);
      return card?.conclusion ? { ...candidate, event_conclusion: card.conclusion } : candidate;
    });
  }

  return { batchMaxAgeHours, decorateBatch, candidateEventGroups, resolveEventAnalysisFor, loadBatchEventCards, candidateEventCard, attachEventConclusions };
}
