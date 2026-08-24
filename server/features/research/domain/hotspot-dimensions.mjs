const DIMENSION_RISK_RANK = { '高': 3, '较高': 3, '中': 2, '低': 1 };

export const DIMENSION_POOL_ROLES = Object.freeze({ who: '主体动态', what: '横向对比', where: '场合盘点', event: '事件深挖' });

export function dimensionPartsOf(event) {
  const parts = event?.tags?.eventParts || {};
  if (parts.who) return parts;
  // 旧数据缺 eventParts 时从 eventKey（who|what 规范化键）回退提取 who。
  const eventKey = String(event?.tags?.eventKey || '');
  const [who, what] = eventKey.split('|');
  return who ? { who, what: what || '', labels: {} } : {};
}

// who/what/where 三维度选题分组：按写文章的目的聚合事件。
export function dimensionSelections(clusters, ranking = [], { whoLimit = 3, whatLimit = 3, whereLimit = 2, minWhoEvents = 2,
  maxActionEvents = 8, maxObjectEvents = 10 } = {}) {
  const scoreByEvent = new Map(ranking.map((item) => [item.eventId, item]));
  const preScore = (event) => scoreByEvent.get(event.event_id)?.finalPreScore ?? 0;
  const riskOf = (event) => scoreByEvent.get(event.event_id)?.riskLevel || event.tags?.riskLevel || '';
  const topRisk = (events) => events.map(riskOf).sort((a, b) => (DIMENSION_RISK_RANK[b] || 0) - (DIMENSION_RISK_RANK[a] || 0))[0] || '待评估';
  const distinctWhos = (events) => new Set(events.map((event) => dimensionPartsOf(event).who).filter(Boolean));
  const disagreements = (events) => events.reduce((sum, event) => sum + (Array.isArray(event.card?.disagreements) ? event.card.disagreements.length : 0), 0);
  const labelOf = (events, field, fallback) => events.map((event) => dimensionPartsOf(event).labels?.[field]).find(Boolean) || fallback;
  const groups = [];

  const byWho = new Map();
  for (const event of clusters) {
    const who = dimensionPartsOf(event).who;
    if (!who) continue;
    if (!byWho.has(who)) byWho.set(who, []);
    byWho.get(who).push(event);
  }
  const whoGroups = [...byWho.entries()]
    .filter(([, events]) => events.length >= minWhoEvents)
    .map(([who, events]) => {
      const actions = new Set(events.map((event) => dimensionPartsOf(event).actionType).filter(Boolean));
      const tension = (actions.has('争议回应') || actions.has('诉讼')) && (actions.has('发布') || actions.has('获奖') || actions.has('开源') || actions.has('融资')) ? 6 : 0;
      const score = Math.round(Math.max(...events.map(preScore)) + Math.min(events.length - 1, 3) * 4 + tension);
      return { dimension: 'who', key: who, title: `${labelOf(events, 'who', who)}近期动态`, events, score, riskLevel: topRisk(events), leads: events.map((event) => event.representative_title).slice(0, 3) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, whoLimit);
  groups.push(...whoGroups);

  const whatCandidates = [];
  const byAction = new Map();
  const byObject = new Map();
  for (const event of clusters) {
    const parts = dimensionPartsOf(event);
    if (parts.actionType && parts.actionType !== '其他') {
      if (!byAction.has(parts.actionType)) byAction.set(parts.actionType, []);
      byAction.get(parts.actionType).push(event);
    }
    if (parts.object) {
      if (!byObject.has(parts.object)) byObject.set(parts.object, []);
      byObject.get(parts.object).push(event);
    }
  }
  const whatScore = (events) => {
    const whos = distinctWhos(events).size;
    const categories = new Set(events.map((event) => event.topic_category));
    const tierBonus = categories.has('🏢 大厂战略') && categories.size > 1 ? 4 : 0;
    return Math.round(Math.max(...events.map(preScore)) + Math.min(whos, 4) * 3 + tierBonus + Math.min(disagreements(events), 3) * 2);
  };
  for (const [action, events] of byAction) {
    if (distinctWhos(events).size < 2 || events.length > maxActionEvents) continue;
    whatCandidates.push({ dimension: 'what', key: `action:${action}`, title: `近期${action}汇总`, events, score: whatScore(events), riskLevel: topRisk(events), leads: events.map((event) => event.representative_title).slice(0, 3) });
  }
  for (const [object, events] of byObject) {
    if (distinctWhos(events).size < 2 || events.length > maxObjectEvents) continue;
    whatCandidates.push({ dimension: 'what', key: `object:${object}`, title: `近期“${labelOf(events, 'object', object)}”汇总`, events, score: whatScore(events), riskLevel: topRisk(events), leads: events.map((event) => event.representative_title).slice(0, 3) });
  }
  const seenSets = new Set();
  const whatGroups = whatCandidates
    .sort((a, b) => b.score - a.score)
    .filter((group) => {
      const signature = group.events.map((event) => event.event_id).sort().join(',');
      if (seenSets.has(signature)) return false;
      seenSets.add(signature);
      return true;
    })
    .slice(0, whatLimit);
  groups.push(...whatGroups);

  const byOccasion = new Map();
  for (const event of clusters) {
    const occasion = dimensionPartsOf(event).occasion;
    if (!occasion) continue;
    if (!byOccasion.has(occasion)) byOccasion.set(occasion, []);
    byOccasion.get(occasion).push(event);
  }
  const whereGroups = [...byOccasion.entries()]
    .filter(([, events]) => events.length >= 2)
    .map(([occasion, events]) => {
      const whos = distinctWhos(events).size;
      const score = Math.round(Math.max(...events.map(preScore)) + Math.min(events.length, 4) * 2 + Math.min(whos, 4) * 2);
      return { dimension: 'where', key: occasion, title: `“${labelOf(events, 'occasion', occasion)}”场合盘点`, events, score, riskLevel: topRisk(events), leads: events.map((event) => event.representative_title).slice(0, 3) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, whereLimit);
  groups.push(...whereGroups);

  return groups;
}
