import fs from 'node:fs';
import path from 'node:path';
import { batchTopicsDir } from './workspace-paths.mjs';
import { clusterItems, isFreshForBatch } from './llm/research-pipeline.mjs';

// 选题与事件为一对多：候选的关联热点分属哪些事件，哪些事件就是本选题的关联事件；
// 原文绑定在事件下：每个事件携带其全部热点的原文抓取快照。contentLimit 控制快照正文截断。
// （自 server.mjs 下沉，供事件图文事实基座在路由与管线两侧复用）
export function eventGroupsForCandidate({ store, workspaceRoot, candidate, contentLimit = 2000, defaultMaxAgeHours = 24 }) {
  const batch = store.getBatch(candidate.batch_id);
  if (!batch) return [];
  const maxAgeHours = Number(batch?.max_age_hours) || defaultMaxAgeHours;
  const eligible = batch.hotspots.filter((item) => isFreshForBatch(item, batch.batch_date, maxAgeHours));
  let cardMap = new Map();
  try {
    const cardFile = path.join(batchTopicsDir(workspaceRoot, batch), 'sources', 'event-cards.json');
    if (fs.existsSync(cardFile)) cardMap = new Map((JSON.parse(fs.readFileSync(cardFile, 'utf8'))?.items || []).map((item) => [item.event_id, item]));
  } catch {}
  const wanted = new Set(candidate.composite ? store.candidateHotspots(candidate.id).map((h) => h.id) : [candidate.hotspot_id]);
  const groups = [];
  for (const event of clusterItems(eligible)) {
    if (!event.articles.some((article) => wanted.has(article.hotspot_id))) continue;
    groups.push({
      event_id: event.event_id,
      title: event.representative_title,
      card: cardMap.get(event.event_id) || null,
      hotspots: event.articles.map((article) => {
        const doc = store.getHotspotSource(article.hotspot_id);
        return { id: article.hotspot_id, title: article.title, url: article.url, source: article.source, time: article.time,
          representative: wanted.has(article.hotspot_id),
          sourceDoc: doc ? { ...doc, content: String(doc.content || '').slice(0, contentLimit) } : null };
      }),
    });
  }
  return groups;
}

// 日常批次的事件图文事实基座：从事件卡（ai/event-cards 产物）与来源快照合成
// 与突发分析（store.getBreakingAnalysis）相同的 analysis 形状，供事件门禁、故事板与渲染管线复用
export function synthesizeEventAnalysis(groups) {
  const list = Array.isArray(groups) ? groups : [];
  const cards = list.map((group) => group.card).filter(Boolean);
  const sources = list.flatMap((group) => (group.hotspots || []).map((hotspot) => {
    const doc = hotspot.sourceDoc;
    return doc
      ? { status: doc.status, url: doc.final_url || doc.url || hotspot.url, title: doc.title || hotspot.title, error: doc.error || null }
      : { status: 'missing', url: hotspot.url || '', title: hotspot.title || '', error: '尚未抓取原文' };
  }));
  if (!cards.length && !sources.length) return null;
  return {
    eventSummary: cards.map((card) => card.conclusion).filter(Boolean).join('\n'),
    factBase: {
      confirmedFacts: cards.flatMap((card) => card.confirmed_facts || []),
      claims: cards.flatMap((card) => card.unverified || []),
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
  const groups = eventGroupsForCandidate({ store, workspaceRoot, candidate, contentLimit: 4000, defaultMaxAgeHours });
  const analysis = synthesizeEventAnalysis(groups);
  return analysis ? { analysis, synthesized: true } : null;
}
