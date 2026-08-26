import fs from 'node:fs';
import path from 'node:path';
import { batchTopicsDir } from '../../../platform/core/workspace-paths.mjs';
import { isFreshForBatch } from '../domain/hotspot-clustering.mjs';
import { isResearchEligibleHotspot } from '../domain/hotspot-pipeline-scope.mjs';
import { loadStableBatchEvents } from './stable-event-service.mjs';

// 选题与事件为一对多：候选的关联热点分属哪些事件，哪些事件就是本选题的关联事件；
// 原文绑定在事件下：每个事件携带其全部热点的原文抓取快照。contentLimit 控制快照正文截断。
// （自 server.mjs 下沉，供事件图文事实基座在路由与管线两侧复用）
export function eventGroupsForCandidate({ store, workspaceRoot, candidate, contentLimit = 2000, defaultMaxAgeHours = 24 }) {
  const batch = store.getBatch(candidate.batch_id);
  if (!batch) return [];
  const maxAgeHours = Number(batch?.max_age_hours) || defaultMaxAgeHours;
  const eligible = batch.hotspots.filter(isResearchEligibleHotspot).filter((item) => isFreshForBatch(item, batch.batch_date, maxAgeHours));
  const cardFile = path.join(batchTopicsDir(workspaceRoot, batch), 'sources', 'event-cards.json');
  let cardMap = new Map();
  try { cardMap = new Map((JSON.parse(fs.readFileSync(cardFile, 'utf8'))?.items || []).map((item) => [String(item.event_id), item])); } catch {}
  const stableEvents = loadStableBatchEvents({ workspaceRoot, batch, hotspots: eligible });
  const wanted = new Set(candidate.composite ? store.candidateHotspots(candidate.id).map((h) => h.id) : [candidate.hotspot_id]);
  const groups = [];
  for (const event of stableEvents) {
    if (!event.articles.some((article) => wanted.has(article.hotspot_id))) continue;
    groups.push({
      event_id: event.event_id,
      title: event.representative_title,
      card: cardMap.get(String(event.event_id)) || null,
      hotspots: event.articles.flatMap((article) => {
        const doc = store.getHotspotSource(article.hotspot_id);
        const materials = !doc && typeof store.listHotspotMaterials === 'function'
          ? store.listHotspotMaterials(article.hotspot_id).filter((item) => item?.status === 'ok' && String(item.content || item.description || '').trim())
          : [];
        const docs = doc ? [doc] : materials.length ? materials : [null];
        return docs.map((sourceDoc,index) => {
          const materialId=sourceDoc?.id||sourceDoc?.material_id;
          const sourceId=doc ? (article.hotspot_id ? `hotspot:${article.hotspot_id}` : '') : materialId ? `material:${materialId}` : article.hotspot_id ? `hotspot:${article.hotspot_id}` : '';
          return { id: article.hotspot_id, source_id: sourceId, title: sourceDoc?.title || article.title, url: sourceDoc?.final_url || sourceDoc?.url || article.url, source: sourceDoc?.source || article.source, time: sourceDoc?.fetched_at || article.time,
            representative: wanted.has(article.hotspot_id)&&index===0,
            sourceDoc: sourceDoc ? { ...sourceDoc, content: String(sourceDoc.content || sourceDoc.description || '').slice(0, contentLimit) } : null };
        });
      }),
    });
  }
  // 编辑室粘贴的补充链接抓取快照：作为候选级合成来源分组追加，模型在事实基座中直接可见
  const supplied = typeof store.listCandidateSources === 'function' ? store.listCandidateSources(candidate.id) : [];
  if (supplied.length) {
    groups.push({
      event_id: 'user-supplied',
      title: '用户补充来源',
      card: null,
      hotspots: supplied.map((row) => ({ id: 0, title: row.title || row.url, url: row.url, source: '用户补充', time: row.fetched_at,
        source_id: row.url ? `candidate:${row.url}` : '',
        representative: true,
        sourceDoc: { ...row, content: String(row.content || '').slice(0, contentLimit) } })),
    });
  }
  return groups;
}

// 日常批次的事件图文事实基座：从事件卡（ai/event-cards 产物）与来源快照合成
// 与突发分析（store.getBreakingAnalysis）相同的 analysis 形状，供事件门禁、故事板与渲染管线复用
export function synthesizeEventAnalysis(groups) {
  const list = Array.isArray(groups) ? groups : [];
  const cardGroups = list.filter((group) => group?.card);
  const cards = cardGroups.map((group) => group.card).filter(Boolean);
  const classificationEvidence = cards.flatMap((card) => card.classification?.evidence || card.classification_evidence || []);
  const timeline = cards.flatMap((card) => card.timeline || []);
  const technicalEvidence = classificationEvidence.filter((item) => /technical|mechanism|architecture|benchmark|performance|机制|架构|性能|基准/i.test(`${item?.role || ''} ${item?.claim || ''}`));
  const trendEvidence = classificationEvidence.filter((item) => /trend|adoption|migration|ecosystem|signal|趋势|采用|迁移|生态|变化/i.test(`${item?.role || ''} ${item?.claim || ''}`));
  const sources = list.flatMap((group) => (group.hotspots || []).map((hotspot) => {
    const doc = hotspot.sourceDoc;
    return doc
      ? { source_id: hotspot.source_id || (hotspot.id ? `hotspot:${hotspot.id}` : ''), status: doc.status, url: doc.final_url || doc.url || hotspot.url, title: doc.title || hotspot.title, source: hotspot.source || '', time: hotspot.time || '', content_excerpt: String(doc.content || '').trim(), error: doc.error || null }
      : { source_id: hotspot.source_id || (hotspot.id ? `hotspot:${hotspot.id}` : ''), status: 'missing', url: hotspot.url || '', title: hotspot.title || '', source: hotspot.source || '', time: hotspot.time || '', content_excerpt: '', error: '尚未抓取原文' };
  }));
  if (!cards.length && !sources.length) return null;
  const sourceIdsByGroup = (group) => (group.hotspots || []).map((item) => item.source_id || (item.id ? `hotspot:${item.id}` : '')).filter(Boolean);
  const cardField = (field) => cardGroups.flatMap((group) => {
    const value = group.card?.[field];
    if (!Array.isArray(value)) return [];
    return value.map((item) => ({
      value: item,
      source_ids: sourceIdsByGroup(group),
      event_id: group.event_id,
    }));
  });
  const backgrounds = cardField('background');
  const sourceIncrements = cardGroups.flatMap((group) => (Array.isArray(group.card?.source_increment) ? group.card.source_increment : []).map((item) => ({
    source: item?.source || '', adds: item?.adds || '', source_ids: sourceIdsByGroup(group), event_id: group.event_id,
  })));
  const angles = cardGroups.flatMap((group) => (Array.isArray(group.card?.angles) ? group.card.angles : []).map((item) => ({
    angle: item, source_ids: sourceIdsByGroup(group), event_id: group.event_id,
  })));
  return {
    schemaVersion: 2,
    eventSummary: cards.map((card) => card.conclusion).filter(Boolean).join('\n'),
    factBase: {
      confirmedFacts: cards.flatMap((card) => card.confirmed_facts || []),
      claims: cards.flatMap((card) => card.unverified || []),
      backgrounds,
      sourceIncrements,
      angles,
      disagreements: cards.flatMap((card) => card.disagreements || []),
      classificationEvidence,
      mechanisms: technicalEvidence.filter((item) => /mechanism|机制/i.test(`${item?.role || ''} ${item?.claim || ''}`)),
      architecture: technicalEvidence.filter((item) => /architecture|架构/i.test(`${item?.role || ''} ${item?.claim || ''}`)),
      benchmarks: technicalEvidence.filter((item) => /benchmark|performance|性能|基准/i.test(`${item?.role || ''} ${item?.claim || ''}`)),
      signals: trendEvidence,
      timeline,
      actors: trendEvidence.filter((item) => /actor|主体|参与方/i.test(`${item?.role || ''} ${item?.claim || ''}`)),
    },
    sources,
    sourceAudit: {
      independentSourceCount: new Set(sources.map((item) => item.url).filter(Boolean)).size,
      issues: cards.flatMap((card) => card.disagreements || []),
      neededMaterials: sources.filter((item) => item.status !== 'ok').map((item) => `待抓取：${item.title || item.url}`),
    },
  };
}

// 事件图文统一取数：突发批次用突发分析，日常批次（热点全景加入图文池的综合候选）用事件卡合成
export function resolveEventAnalysis({ store, workspaceRoot, candidate, defaultMaxAgeHours = 24 }) {
  const breaking = store.getBreakingAnalysis(candidate.batch_id);
  if (breaking?.analysis?.eventSummary) return breaking;
  const groups = eventGroupsForCandidate({ store, workspaceRoot, candidate, contentLimit: 9000, defaultMaxAgeHours });
  const analysis = synthesizeEventAnalysis(groups);
  return analysis ? { analysis, synthesized: true } : null;
}
