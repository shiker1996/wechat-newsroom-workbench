import fs from 'node:fs';
import path from 'node:path';
import { batchTopicsDir } from '../../../../platform/core/workspace-paths.mjs';
import { isResearchEligibleHotspot } from '../../domain/hotspot-pipeline-scope.mjs';
import { isFreshForBatch, tagsOf } from '../../domain/hotspot-clustering.mjs';
import { resolveStableBatchEvents } from '../stable-event-service.mjs';
import { parseModelJson as parseSharedModelJson } from '../../../../platform/llm/model-json.mjs';
import { selectionPrompt } from '../../llm/selection-prompts.mjs';
import { deriveClassificationFeatures, normalizeEventClassification } from '../../domain/content-routing.mjs';

function parseModelJson(result, store) {
  return parseSharedModelJson(result, { store, label: '事件卡模型' });
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

export function overviewHtml(clusters) {
  const payload = clusters.map(({tags,representativeHotspotId,...event})=>event);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>热点全量事件聚类</title><style>body{font:14px/1.65 system-ui;background:#f4f0e6;color:#17201e;margin:0;padding:32px}main{max-width:1100px;margin:auto}h1{font:700 34px Georgia,serif}.note{border-left:5px solid #e44b3f;padding:12px;background:#fff}.event{background:#fff;border:1px solid #d8d0c0;margin:12px 0;padding:18px}.event b{color:#c53b31}.links a{display:block;color:#355f55;margin:4px 0}</style><main><h1>热点全量事件聚类</h1><p class="note">展示本批采集覆盖结构，不等于真实舆情热度或事实可信度。共 ${payload.reduce((s,e)=>s+e.report_count,0)} 条报道、${payload.length} 个事件。</p>${payload.sort((a,b)=>b.source_count-a.source_count||b.report_count-a.report_count).map((e)=>`<article class="event"><b>${e.source_count} 个来源 / ${e.report_count} 条报道</b><h2>${esc(e.representative_title)}</h2><p>${esc(e.topic_category)} · ${esc(e.market_scope)} · 国内相关度 ${e.china_relevance_score}/12</p><p>${esc(e.china_relevance_reason)}</p><div class="links">${e.articles.map((a)=>a.url?`<a href="${esc(a.url)}">${esc(a.source)} · ${esc(a.title)}</a>`:`<span>${esc(a.source)} · ${esc(a.title)}</span>`).join('')}</div></article>`).join('')}</main></html>`;
}

function classificationArtifact(value) {
  return {
    content_class: value.contentClass,
    confidence: value.confidence,
    status: value.status,
    reason: value.reason,
    evidence: value.evidence,
    article_eligible: value.articleEligible,
    social_eligible: value.socialEligible,
    default_route: value.defaultRoute,
    article_eligibility_reason: value.articleEligibilityReason,
    missing_evidence: value.missingEvidence,
    features: value.features,
  };
}

function normalizeEventCard(raw, event = {}) {
  const text = (value, max = 120) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const list = (value, max = 5) => (Array.isArray(value) ? value : []).map((item) => text(item)).filter(Boolean).slice(0, max);
  const classification = normalizeEventClassification(raw.classification || raw, { event, features: deriveClassificationFeatures(event) });
  return {
    conclusion: text(raw.conclusion, 160),
    background: text(raw.background, 120),
    confirmed_facts: list(raw.confirmed_facts, 5),
    source_increment: (Array.isArray(raw.source_increment) ? raw.source_increment : []).map((item) => ({ source: text(item?.source, 40), adds: text(item?.adds, 120) })).filter((item) => item.source || item.adds).slice(0, 6),
    disagreements: list(raw.disagreements, 4),
    timeline: (Array.isArray(raw.timeline) ? raw.timeline : []).map((item) => ({ time: text(item?.time, 30), fact: text(item?.fact, 120) })).filter((item) => item.fact).slice(0, 5),
    unverified: list(raw.unverified, 4),
    angles: list(raw.angles, 3),
    classification: classificationArtifact(classification),
  };
}

export async function generateEventCards({ gateway, store, clusters, batchId, provider, workspaceRoot, onProgress = () => {} }) {
  const { prompt: eventCardSystem } = selectionPrompt({ workspaceRoot, skillName: 'event-card-generator' });
  const providerConfig = gateway.config.providers[provider || gateway.config.defaultProvider];
  const cards = new Map();
  const failed = [];
  const chunkSize = Math.max(1, Math.min(6, Number(providerConfig.eventCardChunkSize) || 6));
  const concurrency = Math.max(1, Math.min(10, Number(providerConfig.eventCardConcurrency) || Number(providerConfig.taggingConcurrency) || 4));
  const chunks = [];
  for (let i = 0; i < clusters.length; i += chunkSize) chunks.push(clusters.slice(i, i + chunkSize));
  async function processChunk(chunk, label, retry = false) {
    onProgress(`事件卡生成 ${label}（已完成 ${cards.size}/${clusters.length}）`);
    const input = chunk.map((event) => ({
      event_id: event.event_id,
      representative_title: event.representative_title,
      keywords: event.keywords,
      latest_time: event.latest_time,
      classification_features: deriveClassificationFeatures(event),
      articles: event.articles.map((article, index) => ({
        source_id: article.source_id || (article.hotspot_id != null ? `hotspot:${article.hotspot_id}` : `source:${index + 1}`),
        title: article.title,
        source: article.source,
        source_class: deriveClassificationFeatures(event).sourceEvidence.find((item) => item.sourceId === (article.source_id || (article.hotspot_id != null ? `hotspot:${article.hotspot_id}` : `source:${index + 1}`)))?.sourceClass || 'media_report',
        source_status: article.source_status || 'ok',
        url: article.url || null,
        time: article.time,
        summary: article.summary || '',
      })),
    }));
    const result = await gateway.complete({ provider, purpose: 'event-card', batchId, jsonMode: true,
      maxOutputTokens: Math.min(retry ? 2500 : 4500, providerConfig.maxOutputTokens),
      messages: [
        { role: 'system', content: eventCardSystem, protected: true },
        { role: 'user', content: `${retry ? '【极简重试】每个字符串不超过40个汉字，严格闭合JSON。\n' : ''}${JSON.stringify(input)}`, protected: true },
      ] });
    let parsed;
    try { parsed = parseModelJson(result, store); }
    catch (error) {
      if (chunk.length > 1) {
        const middle = Math.ceil(chunk.length / 2);
        onProgress(`事件卡输出无效；自动拆分为 ${middle} + ${chunk.length - middle} 条重试`);
        await processChunk(chunk.slice(0, middle), `${label}.1`);
        await processChunk(chunk.slice(middle), `${label}.2`);
        return;
      }
      if (!retry) { onProgress('单张事件卡仍无效，切换极简结构重试'); await processChunk(chunk, `${label}.R`, true); return; }
      failed.push({ event_id: chunk[0].event_id, error: error.message });
      onProgress(`事件 ${chunk[0].event_id} 事件卡生成失败，已跳过：${error.message}`);
      return;
    }
    const returned = new Set();
    for (const rawCard of Array.isArray(parsed.items) ? parsed.items : []) {
      const event = chunk.find((item) => item.event_id === rawCard.event_id);
      if (!event || !String(rawCard.conclusion || '').trim()) continue;
      returned.add(event.event_id);
      cards.set(event.event_id, normalizeEventCard(rawCard, event));
    }
    const missing = chunk.filter((event) => !returned.has(event.event_id));
    if (missing.length && !retry) {
      onProgress(`模型漏回 ${missing.length} 张事件卡；切换极简结构重试`);
      await processChunk(missing, `${label}.R`, true);
    } else {
      for (const event of missing) failed.push({ event_id: event.event_id, error: '模型未返回该事件的事件卡' });
    }
    onProgress(`事件卡 ${label} 完成（累计 ${cards.size}/${clusters.length}）`);
  }
  // 持续补位的工作池：与打标一致，某批完成后立即领取下一批，避免被慢请求阻塞。
  let nextChunkIndex = 0;
  async function worker() {
    while (nextChunkIndex < chunks.length) {
      const index = nextChunkIndex++;
      await processChunk(chunks[index], `${index + 1}/${chunks.length}`);
    }
  }
  const workerCount = Math.min(concurrency, chunks.length);
  onProgress(clusters.length ? `准备生成事件卡 ${clusters.length} 个：${chunks.length} 批，并发 ${workerCount}` : '本批没有需要生成事件卡的事件');
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  for (const event of clusters) { const card = cards.get(event.event_id); if (card) event.card = card; }
  onProgress(`事件卡生成完成：${cards.size}/${clusters.length} 个事件`);
  return { cards, failed };
}

export function readEventCardsFile(filePath) {
  try { if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
  return null;
}

// 事件卡属于采集后的数据准备：打标完成后即可生成，研判时复用。
// 事件卡阶段先解析稳定事件，再按 S... 事件 ID 增量生成或复用事件卡。
export async function ensureBatchEventCards({ gateway, store, batchId, provider, workspaceRoot, maxAgeHours = 168, regenerate = false, eventIds = null, runId = null, events = null, onProgress = () => {} }) {
  const batch = store.getBatch(batchId); if (!batch) throw new Error('批次不存在');
  const workdir = batchTopicsDir(workspaceRoot, batch);
  const eventCardsPath = path.join(workdir, 'sources', 'event-cards.json');
  const eligible = batch.hotspots.filter(isResearchEligibleHotspot)
    .filter((item) => isFreshForBatch(item, batch.batch_date, maxAgeHours));
  const tagged = eligible.filter((item) => { const tags = tagsOf(item); return tags.eventKey && tags.preScores; });
  if (!tagged.length) return { generated: 0, cached: 0, total: 0, failed: [], path: eventCardsPath, clusters: [] };
  const skippedEventIds=new Set((store.listPipelineFailures?.(batchId,{statuses:['skipped'],stages:['event-card']})||[])
    .map((item)=>String(item.detail?.eventId||item.object_key.replace(/^event:/,''))));
  const stableEvents = Array.isArray(events)
    ? events
    : resolveStableBatchEvents({ store, workspaceRoot, batch, hotspots: tagged, onProgress });
  const clusters = stableEvents.filter((event) => !skippedEventIds.has(event.event_id));
  const cached = regenerate ? null : readEventCardsFile(eventCardsPath);
  const cachedCards = new Map((cached?.items || []).map((item) => [item.event_id, item]));
  const requestedEventIds=Array.isArray(eventIds)?new Set(eventIds.map(String)):null;
  const missing = clusters.filter((event) => !cachedCards.has(event.event_id) && (!requestedEventIds || requestedEventIds.has(event.event_id)));
  let failed = [];
  if (missing.length) {
    const result = await generateEventCards({ gateway, store, clusters: missing, batchId, provider, workspaceRoot, onProgress });
    failed = result.failed;
    for (const failure of failed) {
      const event = missing.find((item) => item.event_id === failure.event_id);
      store.recordPipelineFailure?.({ batchId, runId, stage: 'event-card', objectType: 'event',
        objectKey: `event:${failure.event_id}`, title: event?.representative_title || failure.event_id,
        errorCode: 'event_card_failed', errorMessage: failure.error,
        detail: { eventId: failure.event_id, reportCount: event?.report_count || event?.articles?.length || 0,
          hotspotIds: (event?.articles || []).map((item) => item.id).filter(Boolean) } });
    }
    for (const event of missing) {
      if (event.card) cachedCards.set(event.event_id, { event_id: event.event_id, title: event.representative_title, ...event.card });
    }
  } else {
    onProgress(`事件事实卡已存在，直接复用（${clusters.length} 个事件）`);
  }
  for (const event of clusters) {
    const card = cachedCards.get(event.event_id);
    if (card) event.card = normalizeEventCard(card, event);
    if (event.card?.classification) store.saveEventClassification?.(event.event_id, event.card.classification);
  }
  const items = clusters.filter((event) => event.card).map((event) => ({ event_id: event.event_id, title: event.representative_title, ...event.card }));
  writeFile(eventCardsPath, JSON.stringify({ generated_at: new Date().toISOString(), total_events: clusters.length, failed, items }, null, 2));
  try {
    const stat = fs.statSync(eventCardsPath);
    store.upsertArtifact({ batchId, kind: '事件事实卡', name: 'event-cards.json', path: eventCardsPath, size: stat.size, modifiedAt: stat.mtime.toISOString() });
  } catch {}
  return { generated: missing.length, cached: clusters.length - missing.length, total: clusters.length, failed, path: eventCardsPath, clusters };
}
