const GENERIC_WORDS = new Set(['ai','公司','发布','消息','最新','回应','宣布','科技','行业','全球','技术','产品','平台','企业','市场','今日','新闻']);

function timeValue(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function riskWeight(value) {
  const text = String(value || '');
  if (text.includes('高') || text.includes('红')) return 3;
  if (text.includes('中') || text.includes('黄')) return 2;
  if (text.includes('低') || text.includes('绿')) return 1;
  return 0;
}

export function buildHotspotAtlas({ clusters, totalArticles, taggedCount, excludedStale = 0 }) {
  const events = clusters.map(({ tags, representativeHotspotId, ...event }) => {
    const articles = event.articles.map((article) => ({ ...article }));
    const hotspotIds = articles.map(a => a.hotspot_id).filter(Boolean);
    const risk = [...articles].sort((a,b) => riskWeight(b.risk_level)-riskWeight(a.risk_level))[0]?.risk_level || '待评估';
    return { ...event, articles, risk_level:risk, hotspot_ids:hotspotIds, hotspot_count:hotspotIds.length };
  }).sort((a,b) => b.source_count-a.source_count || b.report_count-a.report_count || timeValue(b.latest_time)-timeValue(a.latest_time) || a.event_id.localeCompare(b.event_id));
  const articleIds = events.flatMap((event) => event.articles.map((article) => article.category_id));
  const uniqueArticleIds = new Set(articleIds);
  const reportSum = events.reduce((sum,event) => sum + event.report_count, 0);
  const sourceSet = new Set(events.flatMap((event) => event.articles.map((article) => article.source).filter(Boolean)));
  const scopes = Object.fromEntries(['国内','全球性','国外'].map((scope) => [scope, events.filter((event) => event.market_scope === scope).length]));
  const categories = [...new Set(events.map((event) => event.topic_category).filter(Boolean))].map((name) => ({ name, count:events.filter((event) => event.topic_category === name).length })).sort((a,b) => b.count-a.count || a.name.localeCompare(b.name));
  const sourceCounts = new Map();
  for (const event of events) for (const source of new Set(event.articles.map((article) => article.source).filter(Boolean))) sourceCounts.set(source,(sourceCounts.get(source)||0)+1);
  const sources = [...sourceCounts].map(([name,eventCount]) => ({ name,eventCount,reportCount:events.reduce((sum,event) => sum+event.articles.filter((article)=>article.source===name).length,0) })).sort((a,b)=>b.eventCount-a.eventCount||b.reportCount-a.reportCount||a.name.localeCompare(b.name));
  const wordWeights = new Map();
  for (const event of events) {
    const multiplier = 1 + Math.log2(1 + Math.max(1,event.source_count));
    for (const raw of new Set(event.keywords || [])) {
      const word=String(raw).trim(); if(!word||GENERIC_WORDS.has(word.toLowerCase()))continue;
      const current=wordWeights.get(word)||{name:word,weight:0,eventCount:0}; current.weight+=multiplier;current.eventCount+=1;wordWeights.set(word,current);
    }
  }
  // Build hotword summary lookup from events
  const hotwordSummaryMap = new Map();
  for (const event of events) {
    for (const hs of (event.hotword_summaries || [])) {
      if (hs.summary && !hotwordSummaryMap.has(hs.hotword.toLowerCase())) {
        hotwordSummaryMap.set(hs.hotword.toLowerCase(), hs.summary);
      }
    }
  }
  const keywords=[...wordWeights.values()].sort((a,b)=>b.weight-a.weight||b.eventCount-a.eventCount||a.name.localeCompare(b.name)).slice(0,40).map((item)=>({...item,weight:Number(item.weight.toFixed(3)),summary:hotwordSummaryMap.get(item.name.toLowerCase())||''}));
  return {
    generatedAt:new Date().toISOString(), totalArticles, taggedCount, excludedStale, eventCount:events.length,
    sourceCount:sourceSet.size, multiSourceCount:events.filter((event)=>event.source_count>=2).length,
    scopes,categories,sources,keywords,events,
    gate:{ valid:reportSum===totalArticles&&articleIds.length===uniqueArticleIds.size, reportSum, uniqueArticleIds:uniqueArticleIds.size,
      complete:taggedCount===totalArticles, issues:[...(reportSum===totalArticles?[]:[`报道守恒失败：${reportSum}/${totalArticles}`]),...(articleIds.length===uniqueArticleIds.size?[]:['category_id 重复']),...(taggedCount===totalArticles?[]:[`仍有 ${totalArticles-taggedCount} 条未完整打标`])] },
  };
}
