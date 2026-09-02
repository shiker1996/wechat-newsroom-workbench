import fs from 'node:fs';
import path from 'node:path';
import { batchTopicsDir } from '../../../platform/core/workspace-paths.mjs';
import { formatAccountContext, getAccountContext } from '../../../shared/domain/account-context.mjs';
import { parseModelJson as parseSharedModelJson } from '../../../platform/llm/model-json.mjs';
import { enforceNotificationQuota, isConcreteReaderStake, resolveDistributionDecision, resolveNotificationPolicy } from '../../../shared/domain/distribution-strategy.mjs';
import { isResearchEligibleHotspot } from '../domain/hotspot-pipeline-scope.mjs';
import { selectionPrompt } from '../llm/selection-prompts.mjs';
import { loadShadowHistory, resolveEventShadow } from '../domain/event-resolution-shadow.mjs';
import { buildEventHeatRanking, loadPreviousEventHeatItems } from '../domain/event-heat-ranking.mjs';
import { DISCUSSION_RESEARCH_TOP_K, buildDiscussionResearch, discussionResearchMarkdown, resolveDiscussionResearchTopK } from '../domain/discussion-research.mjs';
import { buildTopicCandidates, selectTopicCandidates, topicCandidatesMarkdown } from '../domain/topic-candidate-generation.mjs';
import { materializeStableEvents } from '../domain/event-resolution-shadow.mjs';
import { duplicatePenaltyForHeat } from '../domain/event-resolution-policy.mjs';
import { clusterItems, isFreshForBatch, tagsOf } from '../domain/hotspot-clustering.mjs';
import { DIMENSION_POOL_ROLES, dimensionPartsOf, dimensionSelections } from '../domain/hotspot-dimensions.mjs';
import { ensureBatchEventCards, generateEventCards, overviewHtml, readEventCardsFile } from './research/event-card-stage.mjs';
import { brainstorm, breakingSynthesis, synthesize } from './research/editorial-exploration.mjs';
import { classifyContentRoute, scoreStatusForCard } from '../domain/content-routing.mjs';
import { G_SOCIAL_CLASS_CAPS, G_SOCIAL_THRESHOLDS, G_SOCIAL_WEIGHTS, scoreSocialCandidate, selectSocialCandidates, selectSocialPool } from '../domain/social-scoring.mjs';
import { generateDiscussionResearchSinglePass, generateDiscussionResearchTopics } from './research/discussion-research-stage.mjs';

// 研究子阶段仍统一通过 selectionPrompt 加载项目技能：hotspot-brainstorm、hotspot-synthesis、event-card-generator。
// 实现分别位于 research/editorial-exploration.mjs 与 research/event-card-stage.mjs，保留这些契约标记便于结构扫描。
// selectionPrompt({ workspaceRoot, skillName: 'hotspot-brainstorm' });
// selectionPrompt({ workspaceRoot, skillName: 'hotspot-synthesis' });
// selectionPrompt({ workspaceRoot, skillName: 'event-card-generator' });

// 兼容旧调用方：聚类和有效期判断已迁移到纯领域模块。
export { clusterItems, isFreshForBatch };
export { DIMENSION_POOL_ROLES, dimensionSelections };
export { ensureBatchEventCards, generateEventCards, overviewHtml, readEventCardsFile };
export { brainstorm, breakingSynthesis, synthesize };
export { G_SOCIAL_CLASS_CAPS, G_SOCIAL_THRESHOLDS, G_SOCIAL_WEIGHTS, scoreSocialCandidate, selectSocialCandidates, selectSocialPool };
export { DISCUSSION_RESEARCH_TOP_K, buildDiscussionResearch, discussionResearchMarkdown, resolveDiscussionResearchTopK };
export { buildTopicCandidates, selectTopicCandidates, topicCandidatesMarkdown };

const CATEGORIES = ['🤖 AI/技术动态','📰 综合资讯','🏢 大厂战略','📈 行业趋势','💼 职场生态'];
const CATEGORY_PREFERENCE = { '🏢 大厂战略': 6, '🤖 AI/技术动态': 4, '📈 行业趋势': 3, '📰 综合资讯': 1, '💼 职场生态': 0 };
const P_BASE = { '🏢 大厂战略': 50, '🤖 AI/技术动态': 40, '📈 行业趋势': 30, '📰 综合资讯': 20, '💼 职场生态': 10 };
const H_BASE = { worker_social: 48, bigtech: 33, owned_experience: 35, controversial_return: 30, key_person_move: 33, ai_tool_test: 20, financing: 10, career_anxiety: 5, contrarian_bigtech: 35 };
const ACCOUNT_FIT_LEVEL_SCORE = Object.freeze({ strong: 80, explore: 45, weak: 25 });

// 评分参数默认值。account-context.json 可用 scoring 段覆盖：
// {"scoring":{"weights":{"h":0.6,"b":0.25,"p":0.15},"eventValueWeight":0.25,"researchValueWeight":0.2,"accountFit":{"🤖 AI/技术动态":80},
//   "accountFitBonus":6,"categoryPreference":{"📰 综合资讯":1},"pBase":{...},"hBase":{...}}}
// accountFit 是 P 的唯一来源；accountFitBonus/pBase 仅为旧维度报告保留兼容。
const DEFAULT_SCORING = Object.freeze({
  weights: Object.freeze({ h: 0.6, b: 0.25, p: 0.15 }),
  eventValueWeight: 0.25,
  researchValueWeight: 0.20,
  categoryPreference: CATEGORY_PREFERENCE,
  pBase: P_BASE,
  hBase: H_BASE,
  accountFitBonus: 6,
});

export function resolveScoring(ctx = getAccountContext()) {
  const scoring = ctx?.scoring && typeof ctx.scoring === 'object' ? ctx.scoring : {};
  const weights = scoring.weights && typeof scoring.weights === 'object' ? scoring.weights : {};
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const mergeTable = (defaults, overrides) => {
    const table = { ...defaults };
    if (overrides && typeof overrides === 'object') {
      for (const [key, value] of Object.entries(overrides)) table[key] = num(value, defaults[key] ?? 0);
    }
    return table;
  };
  const accountFitOverrides = scoring.accountFit && typeof scoring.accountFit === 'object' ? scoring.accountFit : {};
  return {
    weights: {
      h: num(weights.h, DEFAULT_SCORING.weights.h),
      b: num(weights.b, DEFAULT_SCORING.weights.b),
      p: num(weights.p, DEFAULT_SCORING.weights.p),
    },
    eventValueWeight: Math.max(0.25, Math.min(0.40, num(scoring.eventValueWeight, DEFAULT_SCORING.eventValueWeight))),
    researchValueWeight: Math.max(0.10, Math.min(0.30, num(scoring.researchValueWeight, DEFAULT_SCORING.researchValueWeight))),
    categoryPreference: mergeTable(CATEGORY_PREFERENCE, scoring.categoryPreference),
    pBase: mergeTable(P_BASE, scoring.pBase),
    hBase: mergeTable(H_BASE, scoring.hBase),
    accountFitByCategory: Object.fromEntries(CATEGORIES.map((category) => [
      category, clamp(num(accountFitOverrides[category], accountFitForCategory(category, ctx)), 0, 100),
    ])),
    accountFitBonus: num(scoring.accountFitBonus, DEFAULT_SCORING.accountFitBonus),
    notificationPolicy: resolveNotificationPolicy(ctx),
  };
}

export function isSocialCardCandidate(item) {
  if (!item || item.status === 'NO_ANGLE' || item.writeReadiness === 'SKIP' || item.source?.riskLevel === '高') return false;
  return classifyContentRoute(item).pureProject;
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
function parseJson(content) { return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
function parseModelJson(result, store) {
  return parseSharedModelJson(result,{store,label:'研判模型'});
}
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, content, 'utf8'); fs.renameSync(temporary, filePath);
  const stat = fs.statSync(filePath);
  return { size: stat.size, modifiedAt: stat.mtime.toISOString() };
}

export function deterministicTimeliness(value, batchDate) {
  const published=Date.parse(value||''); const reference=Date.parse(`${batchDate}T23:59:59+08:00`);
  if(!Number.isFinite(published)||!Number.isFinite(reference)) return 0;
  const hours=(reference-published)/3600000;
  if(hours< -6) return 0; if(hours<=24) return 10; if(hours<=48) return 8; if(hours<=72) return 6; if(hours<=168) return 3; return 0;
}

function accountSnapshot(workspaceRoot) {
  // 账号定位以结构化配置 account-context.json 为准（getAccountContext 有默认值兜底）；
  // .agents 下的作者资产档案存在时作为补充注入。
  const entries = [{ label: '账号上下文', file: 'account-context.json', content: formatAccountContext({workspaceRoot}) }];
  const assetsFile = path.join(workspaceRoot, '.agents', 'wechat-author-assets.md');
  if (fs.existsSync(assetsFile)) entries.push({ label: '作者资产', file: assetsFile, content: fs.readFileSync(assetsFile, 'utf8').slice(0, 16000) });
  return entries;
}

// 账号内容支柱 → 打标五类映射（类目前列优先）。contentPillars 形如“AI 行业热点：描述”，按前缀匹配。
const PILLAR_CATEGORY_MAP = {
  'AI 行业热点': ['🤖 AI/技术动态', '🏢 大厂战略'],
  'AI/技术动态': ['🤖 AI/技术动态', '🏢 大厂战略'],
  '大厂战略': ['🏢 大厂战略', '🤖 AI/技术动态'],
  '大厂战略分析': ['🏢 大厂战略', '🤖 AI/技术动态'],
  '开源与工程实践': ['🤖 AI/技术动态'],
  '技术认知': ['📈 行业趋势'],
  '行业深度': ['📈 行业趋势'],
  '程序员工作与切身利益': ['💼 职场生态', '🤖 AI/技术动态'],
  '职场与成长': ['💼 职场生态'],
};

export function focusedCategories(ctx = getAccountContext()) {
  const pillars = Array.isArray(ctx?.contentPillars) ? ctx.contentPillars : [];
  const names = pillars.map((pillar) => String(pillar).split(/[：:]/)[0].trim());
  return new Set(names.flatMap((name) => PILLAR_CATEGORY_MAP[name] || []));
}

export function accountFitForCategory(category, ctx = getAccountContext()) {
  const focused = focusedCategories(ctx);
  if (!Array.isArray(ctx?.contentPillars) || !ctx.contentPillars.length) return ACCOUNT_FIT_LEVEL_SCORE.explore;
  return focused.has(String(category || '').trim())
    ? ACCOUNT_FIT_LEVEL_SCORE.strong
    : ACCOUNT_FIT_LEVEL_SCORE.weak;
}

function hotwordEventCoverage(clusters) {
  const coverage = new Map();
  for (const event of clusters) {
    const words = new Set((event.keywords || []).map((k) => String(k).trim().toLowerCase()).filter(Boolean));
    for (const word of words) {
      if (GENERIC_WORDS_HOTWORD.has(word)) continue;
      coverage.set(word, (coverage.get(word) || 0) + 1);
    }
  }
  return coverage;
}

const DIRECT_DEVELOPER_IMPACT = /计费|价格|费用|成本|免费|涨价|降价|额度|调用|效率|迁移|接口|兼容|开源|工具|api|sdk|cli/i;

function eventText(event) {
  const parts = dimensionPartsOf(event);
  return [event?.representative_title, ...(event?.keywords || []), parts.actionType, parts.object, parts.what].filter(Boolean).join(' ');
}

function topicValueParts(event, rankingItem = {}) {
  const scores = rankingItem.preScores || {};
  const text = eventText(event);
  const directDeveloperImpact = DIRECT_DEVELOPER_IMPACT.test(text);
  const rawEventValue = rankingItem.eventValue ?? rankingItem.t ?? rankingItem.eventHeatScore;
  const parsedEventValue = Number(rawEventValue);
  const eventValue = Number.isFinite(parsedEventValue) ? parsedEventValue : null;
  const heatBase = eventValue == null ? Number(rankingItem.finalPreScore || 0) : eventValue;
  const heat = clamp(heatBase / 100 * 30, 0, 30);
  // Phase 2：T 只承接事件级价值。开发者直接利益保留为结构化信号，暂不写入 T。
  const reader = clamp(Number(scores.audience) / 20 * 20, 0, 20);
  const hook = clamp((Number(scores.conflict) + Number(scores.emotion) + Number(scores.impact)) / 45 * 25, 0, 25);
  const evidence = clamp((Number(scores.informationGain) + Number(scores.sourceReliability)) / 25 * 15, 0, 15);
  const freshnessSpace = clamp((10 - Number(rankingItem.saturationPenalty || 0)) / 10 * 5, 0, 5)
    + clamp((15 - Number(rankingItem.duplicatePenalty || 0)) / 15 * 5, 0, 5);
  return {
    heat: Number(heat.toFixed(1)),
    reader: Number(reader.toFixed(1)),
    hook: Number(hook.toFixed(1)),
    evidence: Number(evidence.toFixed(1)),
    freshnessSpace: Number(freshnessSpace.toFixed(1)),
    eventValue: eventValue == null ? null : Number(clamp(eventValue, 0, 100).toFixed(1)),
    legacyTopicValue: Number((heat + reader + hook + evidence + freshnessSpace).toFixed(1)),
    // 有事件热榜时，topicValue/T 直接采用唯一事件价值；无热榜时保留兼容回退。
    topicValue: eventValue == null ? Number((heat + reader + hook + evidence + freshnessSpace).toFixed(1)) : Number(clamp(heatBase, 0, 100).toFixed(1)),
    directDeveloperImpact,
  };
}

export function topicValueForEvent(event, rankingItem = {}) {
  return topicValueParts(event, rankingItem);
}

export function preselection(clusters, batchDate = new Date().toISOString().slice(0,10), scoring = DEFAULT_SCORING, eventHeat = []) {
  const coverage = hotwordEventCoverage(clusters);
  const heatByEvent = new Map((Array.isArray(eventHeat) ? eventHeat : []).map((item) => [item.eventId, item]));
  return clusters.map((event) => {
    const p = event.tags.preScores ?? {};
    const parts = {
      conflict: clamp(p.conflict,0,20), audience: clamp(p.audience,0,20), informationGain: clamp(p.informationGain,0,15),
      emotion: clamp(p.emotion,0,15), timeliness: deterministicTimeliness(event.latest_time,batchDate), impact: clamp(p.impact,0,10),
      sourceReliability: clamp(p.sourceReliability,0,10),
    };
    const base = Object.values(parts).reduce((sum,n) => sum+n, 0);
    const categoryPreference = scoring.categoryPreference[event.topic_category] ?? 0;
    const credibleScoop = clamp(event.tags.credibleScoop,0,12);
    const saturationPenalty = clamp(event.tags.saturationPenalty,0,15);
    const topicCover = Math.max(0, ...(event.keywords || []).map((kw) => coverage.get(String(kw).trim().toLowerCase()) || 0));
    const topicHeatBonus = topicCover >= 2 ? Math.min(8, (Math.min(topicCover, 6) - 1) * 2) : 0;
    const heat = heatByEvent.get(event.event_id) || {};
    const card = event.card || {};
    const classification = card.classification || event.classification || {};
    const classificationEvidence = Array.isArray(classification.evidence) ? classification.evidence : [];
    const sourceCount = new Set((event.articles || []).map((article) => article.source || article.channel || article.url).filter(Boolean)).size;
    return { eventId:event.event_id, hotspotId:event.representativeHotspotId, title:event.representative_title,
      category:event.topic_category, marketScope:event.market_scope, chinaRelevance:event.china_relevance_score,
      chinaRelevanceReason:event.china_relevance_reason || '',
      riskLevel:event.tags.riskLevel || '待评估', riskReason:event.tags.riskReason || '', preScores:parts, base,
      categoryPreference, credibleScoop, saturationPenalty,
      keywords:event.keywords || [], articles:event.articles || [], repositoryMeta:event.repositoryMeta||null,
      blackHorseSignals:event.tags.blackHorseSignals || [], topicHeatBonus,
      eventHeatScore: heat.heatScore ?? event.eventHeatScore ?? null,
      eventValue: heat.eventValue ?? heat.t ?? heat.heatScore ?? event.eventValue ?? event.t ?? event.eventHeatScore ?? null,
      t: heat.t ?? heat.eventValue ?? heat.heatScore ?? event.t ?? event.eventValue ?? event.eventHeatScore ?? null,
      eventHeatRank: heat.rank ?? event.eventHeatRank ?? null,
      eventHeatState: heat.state || event.eventHeatState || null, eventHistoryRepeatDays: Number(heat.repeatDays ?? event.eventHistoryRepeatDays ?? 0),
      contentClass: classification.contentClass || classification.content_class || '',
      classificationStatus: classification.status || classification.classification_status || '',
      classificationConfidence: classification.confidence ?? classification.classification_confidence ?? null,
      classificationReason: classification.reason || classification.classification_reason || '',
      classificationEvidence,
      classificationFeatures: classification.features || classification.classification_features || {},
      articleEligible: classification.articleEligible ?? classification.article_eligible,
      articleEligibilityReason: classification.articleEligibilityReason || classification.article_eligibility_reason || '',
      confirmedFactCount: Array.isArray(card.confirmed_facts) ? card.confirmed_facts.length : 0,
      timelineCount: Array.isArray(card.timeline) ? card.timeline.length : 0,
      disagreementCount: Array.isArray(card.disagreements) ? card.disagreements.length : 0,
      unverifiedCount: Array.isArray(card.unverified) ? card.unverified.length : 0,
      sourceCount,
      duplicatePenalty: Number(event.duplicatePenalty ?? duplicatePenaltyForHeat({ state: heat.state, repeatDays: heat.repeatDays })),
      finalPreScore:base+categoryPreference+credibleScoop+topicHeatBonus-saturationPenalty };
  }).sort((a,b) => b.finalPreScore-a.finalPreScore || b.credibleScoop-a.credibleScoop || b.preScores.informationGain-a.preScores.informationGain || a.title.localeCompare(b.title));
}

function eventEliminationReason(item) {
  const parts = [];
  if (item.marketScope === '国外' && (item.chinaRelevance || 0) <= 3) parts.push('市场范围为国外且国内相关度低');
  if (item.finalPreScore < 30) parts.push('综合预选得分过低(' + item.finalPreScore + '分)');
  if (item.saturationPenalty > 5) parts.push('同类饱和度较高(减值' + item.saturationPenalty + '分)');
  if ((item.preScores?.informationGain || 10) < 4) parts.push('信息增量不足');
  if (item.riskLevel === '高' || item.riskLevel === '较高') parts.push('风险等级: ' + (item.riskLevel || '') + ' ' + (item.riskReason || ''));
  if (!parts.length) parts.push('未进入任何入选维度组');
  return parts.join('；');
}

// 兼容旧调用的维度评分：who / what / where 只用于审计与旧报告；生产文章池使用 selectArticlePool，早报使用 selectBriefPool。
// 维度分 = 结构分 + 账号契合加分（命中 contentPillars 对应类目加分，默认 +6，可用 scoring.accountFitBonus 覆盖），按分数全局混排取核心 8，
// 黑马 2 仍按 blackHorseSignals 选择，候补 3 条保留。事件级排名回填入池身份与淘汰原因。
export function selectDimensionPool(clusters, ranking, { coreLimit = 8, blackLimit = 2, backupLimit = 3, accountContext } = {}) {
  const EVENT_HEAT_ARTICLE_LIMIT = 50;
  const rankedHeatItems = (ranking || []).filter((item) => Number.isFinite(Number(item.eventHeatRank)))
    .sort((left, right) => Number(left.eventHeatRank) - Number(right.eventHeatRank));
  const hotlistEventIds = new Set(rankedHeatItems.slice(0, EVENT_HEAT_ARTICLE_LIMIT).map((item) => item.eventId));
  const hasHeatRanking = rankedHeatItems.length > 0;
  const activeClusters = clusters.filter((event) => event.eventHeatState !== 'stale'
    && (!hasHeatRanking || hotlistEventIds.has(event.event_id)));
  const groups = dimensionSelections(activeClusters, ranking, { whoLimit: 99, whatLimit: 99, whereLimit: 99, minWhoEvents: 1 });
  const focused = focusedCategories(accountContext);
  const scoring = resolveScoring(accountContext);
  const scored = groups.map((group) => {
    const leadRank = ranking.find((entry) => entry.eventId === group.events[0].event_id) || {};
    const category = leadRank.category || group.events[0].topic_category;
    const accountFit = focused.has(category) ? scoring.accountFitBonus : 0;
    return { ...group, category, accountFit, score: group.score + accountFit };
  }).sort((a, b) => b.score - a.score);
  // 跨维度事件去重：仅在事件集合高度重合，或两个小组明显互为子集时去重。
  // 被去重组仍保留在 groups 中供审计，避免同一事件以“主体动态”和“发布汇总”重复占位。
  const distinct = [];
  const audited = scored.map((group) => {
    const ids = new Set(group.events.map((event) => event.event_id));
    const duplicate = distinct.find((kept) => {
      const keptIds = new Set(kept.events.map((event) => event.event_id));
      const overlap = [...ids].filter((id) => keptIds.has(id)).length;
      const union = ids.size + keptIds.size - overlap;
      const jaccard = union ? overlap / union : 0;
      const smallSubset = Math.min(ids.size, keptIds.size) <= 2
        && Math.max(ids.size, keptIds.size) <= 4
        && overlap / Math.min(ids.size, keptIds.size) >= 0.5;
      return overlap > 0 && (jaccard >= 0.5 || smallSubset);
    });
    if (duplicate) return { ...group, duplicateOf: `${duplicate.dimension}:${duplicate.key}` };
    distinct.push(group);
    return group;
  });
  const coreGroups = distinct.slice(0, coreLimit);
  const selectedKeys = new Set(coreGroups.map((group) => `${group.dimension}:${group.key}`));
  coreGroups.sort((a, b) => b.score - a.score);
  const core = coreGroups.map((group) => ({ ...group, poolRole: DIMENSION_POOL_ROLES[group.dimension] }));
  const coreKeys = new Set(coreGroups.map((group) => `${group.dimension}:${group.key}`));
  const remaining = distinct.filter((group) => !coreKeys.has(`${group.dimension}:${group.key}`));
  const blackSignals = (group) => group.events.reduce((sum, event) => {
    const rank = ranking.find((entry) => entry.eventId === event.event_id);
    return sum + (rank?.blackHorseSignals?.length || event.tags?.blackHorseSignals?.length || 0);
  }, 0);
  const black = [...remaining].sort((a, b) => blackSignals(b) - blackSignals(a) || b.score - a.score)
    .slice(0, blackLimit).map((group) => ({ ...group, poolRole: '黑马2条' }));
  const blackKeys = new Set(black.map((group) => `${group.dimension}:${group.key}`));
  const backup = remaining.filter((group) => !blackKeys.has(`${group.dimension}:${group.key}`)).slice(0, backupLimit)
    .map((group) => ({ ...group, poolRole: '候补3条' }));
  const roleByEvent = new Map();
  for (const group of [...core, ...black]) for (const event of group.events) {
    if (!roleByEvent.has(event.event_id)) roleByEvent.set(event.event_id, group.poolRole);
  }
  ranking.forEach((item, index) => {
    item.preRank = index + 1;
    item.poolRole = roleByEvent.get(item.eventId) || '未入选';
    item.eliminationReason = item.poolRole === '未入选' ? eventEliminationReason(item) : '';
  });
  return { selected: [...core, ...black], backup, groups: audited };
}

function activeHotlistClusters(clusters, ranking, limit = 50, { eventIds = null } = {}) {
  const rankedHeatItems = (ranking || []).filter((item) => Number.isFinite(Number(item.eventHeatRank)))
    .sort((left, right) => Number(left.eventHeatRank) - Number(right.eventHeatRank));
  const hotlistEventIds = eventIds || new Set(rankedHeatItems.slice(0, limit).map((item) => item.eventId));
  const hasHeatRanking = rankedHeatItems.length > 0;
  return clusters.filter((event) => event.eventHeatState !== 'stale'
    && (!hasHeatRanking || hotlistEventIds.has(event.event_id)));
}

function classificationForEvent(event) {
  return event?.card?.classification || event?.classification || null;
}

function articleRouteForEvent(event) {
  const classification = classificationForEvent(event);
  if (classification && (classification.content_class || classification.contentClass)) {
    const contentClass = classification.content_class || classification.contentClass;
    return {
      contentRoute: contentClass === 'github_project' ? 'social_only' : (classification.article_eligible === false || classification.articleEligible === false ? 'editorial_review' : 'article'),
      articleEligible: contentClass !== 'github_project' && classification.article_eligible !== false && classification.articleEligible !== false,
      pureProject: contentClass === 'github_project',
    };
  }
  return classifyContentRoute({}, { event });
}

function articleBoardEventIds(eventHeatRanking, ranking, limit = 50) {
  const boards = eventHeatRanking?.rankings || {};
  const articleClasses = ['news_event', 'open_source_technology', 'open_source_trend'];
  const ids = new Set();
  let foundBoard = false;
  for (const contentClass of articleClasses) {
    const items = boards[contentClass]?.items;
    if (!Array.isArray(items)) continue;
    foundBoard = true;
    for (const item of items.slice(0, limit)) ids.add(item.eventId);
  }
  // 榜单结构已存在但文章三类均为空时，不能把整个文章池误筛成 0 条；
  // 例如本批只有项目榜，仍应回退到普通预选热榜供文章路线继续研判。
  if (foundBoard && ids.size) return ids;
  return new Set((ranking || []).filter((item) => Number.isFinite(Number(item.eventHeatRank)))
    .sort((left, right) => Number(left.eventHeatRank) - Number(right.eventHeatRank))
    .slice(0, limit).map((item) => item.eventId));
}

function articleCandidateOf(event, rankingItem, scoring, accountContext) {
  const parts = topicValueParts(event, rankingItem);
  const accountFit = scoring.accountFitByCategory?.[event.topic_category]
    ?? accountFitForCategory(event.topic_category, accountContext);
  const contentRoute = articleRouteForEvent(event);
  const classification = classificationForEvent(event) || {};
  const contentClass = classification.content_class || classification.contentClass || 'news_event';
  return {
    dimension: 'event', key: event.event_id, title: event.representative_title, events: [event],
    // Phase 2：事件池只按 T 排序；accountFit 只用于同分优先级和审计，不再叠加到事件分。
    score: Number(parts.topicValue.toFixed(1)), topicValue: parts.topicValue,
    eventValue: parts.eventValue, t: parts.eventValue,
    topicValueParts: parts, accountFit,
    contentRoute: contentRoute.contentRoute, articleEligible: contentRoute.articleEligible,
    contentClass, classificationStatus: classification.status || classification.classification_status || 'needs_review',
    classificationConfidence: classification.confidence, classificationReason: classification.reason || '',
    classificationEvidence: classification.evidence || [], classificationFeatures: classification.features || {},
    articleEligibilityReason: classification.article_eligibility_reason || classification.articleEligibilityReason || '',
    developerImpact: parts.directDeveloperImpact, category: event.topic_category,
    riskLevel: rankingItem.riskLevel || event.tags?.riskLevel || '待评估',
    leads: (event.articles || []).map((article) => article.title).slice(0, 3),
    eventHeatRank: rankingItem.eventHeatRank ?? null,
  };
}

function blackHorseSignalsOf(group, ranking) {
  return group.events.reduce((sum, event) => {
    const rank = ranking.find((item) => item.eventId === event.event_id);
    return sum + (rank?.blackHorseSignals?.length || event.tags?.blackHorseSignals?.length || 0);
  }, 0);
}

/**
 * 文章池的事件优先入口。单事件和真正的跨事件角度不再由维度组默认占位；
 * 维度组由 selectBriefPool 提供给早报候选。T/J 是候选预选依据，
 * F 由脑暴后的 T/J/A/C 公式负责最终文章排序。
 */
export function selectArticlePool(clusters, ranking, { coreLimit = 8, blackLimit = 2, backupLimit = 3, accountContext, eventHeatRanking = null } = {}) {
  const scoring = resolveScoring(accountContext);
  // 四类榜单分别取前 50，再合并文章路线候选；项目榜不会因为 T 高而挤占文章榜前 50。
  const active = activeHotlistClusters(clusters, ranking, 50, { eventIds: articleBoardEventIds(eventHeatRanking, ranking) });
  const rankingByEvent = new Map((ranking || []).map((item) => [item.eventId, item]));
  const candidates = active.map((event) => articleCandidateOf(event, rankingByEvent.get(event.event_id) || {}, scoring, accountContext));
  const articleCandidates = candidates.filter((candidate) => candidate.articleEligible);
  const sorted = articleCandidates.sort((left, right) => right.score - left.score
    || right.accountFit - left.accountFit
    || Number(left.eventHeatRank || 9999) - Number(right.eventHeatRank || 9999));
  const coreGroups = sorted.slice(0, coreLimit);
  const selectedKeys = new Set(coreGroups.map((group) => group.key));
  const replaceCore = (predicate, replacementPredicate) => {
    if (coreGroups.some(predicate)) return;
    const replacement = sorted.find((group) => !selectedKeys.has(group.key) && replacementPredicate(group));
    if (!replacement) return;
    let replaceIndex = -1;
    for (let index = coreGroups.length - 1; index >= 0; index -= 1) {
      if (!predicate(coreGroups[index])) { replaceIndex = index; break; }
    }
    if (replaceIndex < 0) return;
    selectedKeys.delete(coreGroups[replaceIndex].key);
    coreGroups[replaceIndex] = replacement;
    selectedKeys.add(replacement.key);
  };
  // 开发者直接利益保护位：热榜前 5 且影响成本、效率、接口或额度的事件至少保留 1 条。
  replaceCore((group) => group.developerImpact && Number.isFinite(Number(group.eventHeatRank)) && Number(group.eventHeatRank) <= 5,
    (group) => group.developerImpact && Number.isFinite(Number(group.eventHeatRank)) && Number(group.eventHeatRank) <= 5);
  coreGroups.sort((left, right) => right.score - left.score || right.accountFit - left.accountFit);
  const core = coreGroups.map((group) => ({ ...group, poolRole: DIMENSION_POOL_ROLES.event }));
  const remaining = sorted.filter((group) => !selectedKeys.has(group.key));
  const black = remaining.sort((left, right) => blackHorseSignalsOf(right, ranking) - blackHorseSignalsOf(left, ranking)
    || right.score - left.score).slice(0, blackLimit).map((group) => ({ ...group, poolRole: '黑马2条' }));
  const blackKeys = new Set(black.map((group) => group.key));
  const backup = remaining.filter((group) => !blackKeys.has(group.key)).slice(0, backupLimit)
    .map((group) => ({ ...group, poolRole: '候补3条' }));
  const roleByEvent = new Map([...core, ...black].map((group) => [group.key, group.poolRole]));
  ranking.forEach((item, index) => {
    item.preRank = index + 1;
    item.poolRole = roleByEvent.get(item.eventId) || '未入选';
    item.eliminationReason = item.poolRole === '未入选' ? eventEliminationReason(item) : '';
  });
  return { selected: [...core, ...black], backup, groups: sorted, articleCandidates: sorted,
    socialOnly: candidates.filter((candidate) => !candidate.articleEligible) };
}

/** 维度组只作为早报/行业盘点候选，不直接占文章池席位。 */
export function selectBriefPool(clusters, ranking, { limit = 12 } = {}) {
  const active = activeHotlistClusters(clusters, ranking);
  return dimensionSelections(active, ranking, { whoLimit: limit, whatLimit: limit, whereLimit: limit, minWhoEvents: 2 })
    .map((group) => ({ ...group, poolRole: '早报维度组', candidateType: 'early_report_group' }))
    .slice(0, limit);
}

const RESEARCH_SIGNAL_POINTS = Object.freeze({ anomaly: 14, interest_conflict: 22, divergence: 8 });
const RESEARCH_RELATION_POINTS = Object.freeze({ sequence: 16, response: 22, comparison: 18, trend: 24, counterexample: 24 });
const CONFIDENCE_FACTOR = Object.freeze({ high: 1, medium: 0.75, low: 0.4 });
const EVIDENCE_FACTOR = Object.freeze({ full_text: 1, summary_only: 0.7, repository_meta: 0.45, title_only: 0.25 });

function researchList(value) { return Array.isArray(value) ? value : []; }
function evidenceFactor(item) {
  const levels = researchList(item?.evidence_levels || item?.evidenceLevels).map((value) => String(value));
  if (!levels.length) return 0.75;
  return Math.max(...levels.map((level) => EVIDENCE_FACTOR[level] ?? 0.35));
}
function confidenceFactor(item) { return CONFIDENCE_FACTOR[String(item?.confidence || 'medium')] ?? 0.75; }

/**
 * 研判价值 J：只衡量候选命题背后的模型研判增量，不重新判断语义真假。
 * 语义关系由阶段 1/2 模型判断；这里仅按已确认的信号、关系、置信度和证据等级计分。
 */
export function researchValueForCandidate(card = {}) {
  const source = card.source || card;
  const context = source.research_context || source.researchContext || card.research_context || {};
  const topic = source.topic_candidate || source.topicCandidate || {};
  const signalRefs = new Set(researchList(topic.internal_signal_refs || topic.signal_refs).map((value) => String(typeof value === 'object' ? value.signal_id || value.id : value)));
  const signalSeen = new Set();
  const signals = researchList(context.internal_signals || context.internal_research || source.internal_signals || source.internal_research)
    .flatMap((item) => [
      ...researchList(item?.anomalies || item?.anomaly_points || item?.internal_research?.anomalies),
      ...researchList(item?.conflicts || item?.interest_conflicts || item?.internal_research?.interest_conflicts),
      ...researchList(item?.divergences || item?.divergence_directions || item?.internal_research?.divergence_directions),
    ])
    .filter((item) => {
      const key = String(item?.signal_id || item?.id || `${item?.kind || ''}|${item?.statement || item?.question || ''}`);
      if (signalRefs.size && !signalRefs.has(key)) return false;
      if (signalSeen.has(key)) return false;
      signalSeen.add(key); return true;
    });
  const relationIds = new Set(researchList(topic.relation_ids).map((value) => String(value)));
  const relationSeen = new Set();
  const relations = researchList(context.relations || context.inter_event_research || source.relations || source.inter_event_research)
    .filter((item) => {
      const key = String(item?.relation_id || `${item?.relation_kind || ''}|${researchList(item?.event_ids).join('|')}`);
      if (relationIds.size && !relationIds.has(key)) return false;
      if (relationSeen.has(key)) return false;
      relationSeen.add(key); return true;
    });
  const internalRaw = signals.reduce((sum, item) => {
    const kind = String(item?.kind || '').trim();
    const points = RESEARCH_SIGNAL_POINTS[kind] || 0;
    return sum + points * confidenceFactor(item) * evidenceFactor(item);
  }, 0);
  const relationRaw = relations.reduce((sum, item) => {
    const points = RESEARCH_RELATION_POINTS[String(item?.relation_kind || '').trim()] || 0;
    return sum + points * confidenceFactor(item) * evidenceFactor(item);
  }, 0);
  const internal = Math.min(60, internalRaw);
  const interEvent = Math.min(60, relationRaw);
  return {
    score: Number(Math.min(100, internal + interEvent).toFixed(1)),
    internal: Number(internal.toFixed(1)),
    interEvent: Number(interEvent.toFixed(1)),
    signalCount: signals.length,
    relationCount: relations.length,
  };
}

export function scoreCards(cards, synthesis, scoring = resolveScoring()) {
  const corrections = new Map((synthesis.items ?? []).map((item) => [item.candidateId,item]));
  const normalized = cards.filter((card) => card.status !== 'NO_ANGLE').map((card) => {
    const b = card.bScores ?? {}; const hp = card.hProfile ?? {}; const correction = corrections.get(card.candidateId) ?? {};
    const sourceClass = String(card.source?.contentClass || card.source?.content_class || '').trim();
    const route = sourceClass
      ? { contentRoute: sourceClass === 'github_project' ? 'social_only' : (card.source.articleEligible === false ? 'editorial_review' : 'article'), articleEligible: sourceClass !== 'github_project' && card.source.articleEligible !== false, pureProject: sourceClass === 'github_project' }
      : classifyContentRoute(card);
    const scoreStatus = route.articleEligible ? scoreStatusForCard(card) : { scoreStatus: 'article_route_blocked', scoreWarning: sourceClass === 'github_project' ? '纯项目默认只进入图文路线，请先人工晋级分类' : '分类证据不足，暂不能进入文章路线' };
    const distribution = resolveDistributionDecision({ ...card.packaging, title:card.source?.title, angle:card.angle, thesis:card.thesis,
      evidenceBoundary:card.evidenceBoundary, materialGaps:card.packaging?.materialGaps, factSupport:b.factSupport,
      riskLevel:card.source?.riskLevel, riskReason:card.source?.riskReason }, scoring.notificationPolicy);
    // 阶段 4：结构化 readerStakeScore 是 B 的唯一受众利益输入；旧 audienceRelevance 仅作历史数据兼容回退。
    const hasStructuredReaderStake = correction.readerStakeScore != null || card.packaging?.readerStakeScore != null || b.readerStakeScore != null;
    const rawReaderStakeScore = clamp(correction.readerStakeScore ?? card.packaging?.readerStakeScore ?? b.readerStakeScore
      ?? correction.audienceRelevance ?? b.audienceRelevance, 0, 5);
    // 新结构化候选若文字利益仍是泛化表述，受众分封顶 2；旧批次没有结构化字段时保留兼容分。
    const readerStakeScore = hasStructuredReaderStake && !isConcreteReaderStake(distribution.readerStake, scoring.notificationPolicy)
      ? Math.min(rawReaderStakeScore, 2) : rawReaderStakeScore;
    const audience = readerStakeScore;
    const bParts = [clamp(b.angleUniqueness,0,5),clamp(b.emotionSpread,0,5),clamp(b.titleHook,0,5),audience,clamp(b.factSupport,0,5)];
    const B = bParts.reduce((s,n)=>s+n,0)*4;
    const H = clamp((scoring.hBase[hp.historicalType] ?? 10) + clamp(hp.fiveSenseCount,0,5)*2 + clamp(hp.fiveQuestionCount,0,5)*5 + clamp(hp.recommendationFit,0,10) + clamp(hp.emotionTheme,0,10) + clamp(hp.searchFriendly,0,5),0,100);
    // Phase 3：P 只来自 L2 accountFit；pBase/可信独家旧口径不再参与最终评分。
    const P = clamp(Number(card.source?.accountFit ?? scoring.accountFitByCategory?.[card.source?.category] ?? 0), 0, 100);
    const S = clamp(correction.saturationPenalty,0,15);
    const D = clamp(Number(card.source?.duplicatePenalty || 0), 0, 20);
    const research = researchValueForCandidate(card);
    const C = clamp(S + D, 0, 35);
    const eventValue = scoreStatus.scoreStatus === 'needs_source_data'
      ? null
      : clamp(Number(card.source?.eventValue ?? card.source?.t ?? card.source?.eventHeatScore ?? 0), 0, 100);
    // 阶段 5：A 是文章化质量，T 是事件热度，J 是研判增量，C 合并竞争与重复扣分。
    const A = clamp(H*scoring.weights.h+B*scoring.weights.b+P*scoring.weights.p, 0, 100);
    const articleWeight = clamp(1 - scoring.eventValueWeight - scoring.researchValueWeight, 0, 1);
    const F = eventValue == null ? null : clamp(A*articleWeight+eventValue*scoring.eventValueWeight+research.score*scoring.researchValueWeight-C,0,100);
    const allowedSkills = new Set(['wechat-mp-tech-hotspot','wechat-mp-tech-deep','wechat-mp-deep-dive','wechat-mp-gossip-chill']);
    const fallbackSkill = card.source?.category === '🤖 AI/技术动态' ? 'wechat-mp-tech-hotspot' : 'wechat-mp-deep-dive';
    const recommendedSkill = allowedSkills.has(card.recommendedSkill) ? card.recommendedSkill : fallbackSkill;
    return { ...card, topicValue: Number(card.source?.topicValue ?? 0) || 0, eventValue, t: eventValue, recommendedSkill, distributionLane:distribution.distributionLane, readerStake:distribution.readerStake,
      readerStakeScore, readerTarget:String(card.packaging?.readerTarget || '').trim(), readerAction:String(card.packaging?.readerAction || '').trim(),
      readerConsequence:String(card.packaging?.readerConsequence || '').trim(), readerStakeEvidence:String(card.packaging?.readerStakeEvidence || '').trim(),
      notificationFit:distribution.notificationFit, notificationEligible:distribution.notificationEligible,
      notificationBlockers:distribution.notificationBlockers,
      a:Number(A.toFixed(1)), h:H, b:B, p:P, j:research.score, researchValue:research.score, researchInternal:research.internal, researchInterEvent:research.interEvent,
      s:S, d:D, c:C, competitionPenalty:C, duplicatePenalty:D,
      f:F == null ? null : Number(F.toFixed(1)), bParts,
      contentRoute: route.contentRoute, articleEligible: route.articleEligible, pureProject: route.pureProject,
      scoreStatus: scoreStatus.scoreStatus, scoreWarning: scoreStatus.scoreWarning,
      synthesisReason:correction.reason || '', audienceRelevance:audience };
  }).sort((a,b) => b.f-a.f || a.candidateId.localeCompare(b.candidateId));
  return enforceNotificationQuota(normalized, scoring.notificationPolicy)
    .map((item,index) => ({...item,finalRank:index+1}));
}

function markdownAgenda(scored) {
  return `# 编辑议题卡（探索阶段）\n\n> 临时包装不代表作者最终立场。进入成稿前必须完成编辑会并锁定 article-brief.md。\n\n${scored.map((c) => `## ${c.candidateId} · ${c.source.title}\n\n- 原分类：${c.source.category}\n- 入池身份：${c.source.poolRole}\n- 合规风险：${c.source.riskLevel} ${c.source.riskReason || ''}\n- 表面新闻：${c.source.title}\n- 临时角度：${c.angle}\n- 临时命题：${c.thesis}\n- 事实边界：${c.evidenceBoundary || '待核验'}\n- 反证/替代解释：${c.counterEvidence || '待补充'}\n- 写作就绪度：${c.writeReadiness}\n- 当前关键问题：${c.editorQuestion}\n\n### 可验证命题\n${(c.hypotheses||[]).map((h,i)=>`${i+1}. **${h.claim}**\n   - 支持：${h.support}\n   - 反证：${h.counter}\n   - 待核验：${h.verify}\n   - 读者价值：${h.readerValue}`).join('\n')}\n\n### 临时包装\n- 内容支柱：${c.packaging?.contentPillar || '探索项'}\n- 读者任务：${c.packaging?.readerJob || '待明确'}\n- 模式：${c.packaging?.mode || '待定'}\n- 分发池：${c.distributionLane}${c.packaging?.distributionLane && c.packaging.distributionLane !== c.distributionLane ? `（原建议 ${c.packaging.distributionLane}，通知资格不足已降级）` : ''}\n- 读者利益：${c.readerStake || '待明确'}\n- 通知匹配：${c.notificationFit}/5${c.packaging?.notificationReason ? `；${c.packaging.notificationReason}` : ''}\n- 标题方向：${c.packaging?.titleDirection || ''}\n- 开头钩子：${c.packaging?.hook || ''}\n- 实用增量：${c.packaging?.practicalIncrement || '暂无'}\n- 素材缺口：${c.packaging?.materialGaps || '待核验'}\n\n---`).join('\n\n')}`;
}

export function markdownRanked(scored, synthesis, dimensionGroups = [], scoring = DEFAULT_SCORING) {
  const grade = (f) => f>=85?'S+':f>=70?'S':f>=55?'A+':f>=40?'A':f>=25?'B':'C';
  const pct = (value) => `${Math.round(value * 100)}%`;
  const topicSection = dimensionGroups.length ? `\n## 维度候选（早报）\n\n| 维度 | 选题 | 维度分 | 风险 | 覆盖事件 | 代表报道 |\n|---|---|---:|---|---:|---|\n${dimensionGroups.map((t)=>`| ${DIMENSION_POOL_ROLES[t.dimension] || t.dimension} | ${t.title.replace(/\|/g,'/')} | ${t.score} | ${t.riskLevel} | ${t.events.length} | ${t.leads.map((x)=>x.replace(/\|/g,'/')).join('、')} |`).join('\n')}\n` : '';
  return `# 综合选题研判报告（临时排名，待编辑会确认）\n\n## 爆款总榜\n\n| # | 身份 | 分发池 | 分类 | 选题 | T 热度 | J 研判 | A 文章 | C 竞争 | F 最终 | 等级 | 风险 |\n|---:|---|---|---|---|---:|---:|---:|---:|---:|:---:|---|\n${scored.map((c)=>`| ${c.finalRank} | ${c.source.poolRole} | ${c.distributionLane} | ${c.source.category} | ${c.source.title.replace(/\|/g,'/')} | ${c.eventValue.toFixed(1)} | ${c.j} | ${c.a} | ${c.c} | ${c.f} | ${grade(c.f)} | ${c.source.riskLevel} |`).join('\n')}\n\n## 综合研判\n\n### 元叙事\n${(synthesis.metaNarratives||[]).map((x)=>`- ${x}`).join('\n') || '- 暂无明确跨题元叙事'}\n\n### 组合推荐\n- 主推：${synthesis.combination?.primary || '待定'}\n- 稳定：${synthesis.combination?.stable || '待定'}\n- 黑马：${synthesis.combination?.darkHorse || '待定'}\n- 理由：${synthesis.combination?.reason || ''}\n\n## 逐条评分\n\n${scored.map((c)=>`### #${c.finalRank} ${c.candidateId} · ${c.source.title}\n- T/J/A/C/F：${c.eventValue.toFixed(1)}/${c.j}/${c.a}/${c.c}/${c.f}\n- A 内部：H ${c.h} · B ${c.b} · P ${c.p.toFixed(1)}\n- J 内部：事件内 ${c.researchInternal} · 事件间 ${c.researchInterEvent}\n- 脑暴五项：${c.bParts.join('/')}\n- 核心角度：${c.angle}\n- 临时命题：${c.thesis}\n- 分发池：${c.distributionLane}\n- 读者利益：${c.readerStake || '待明确'}\n- 竞争扣分构成：同题饱和 ${c.s} · 重复 ${c.d}\n- 受众与竞争校正：${c.synthesisReason || '无额外校正'}\n- 合规风险：${c.source.riskLevel} ${c.source.riskReason || ''}\n- 推荐技能：${c.recommendedSkill || 'wechat-mp-deep-dive'}\n`).join('\n')}\n\n*评分公式：A = H×${pct(scoring.weights.h)} + B×${pct(scoring.weights.b)} + P×${pct(scoring.weights.p)}；F = A×${pct(1-scoring.eventValueWeight-scoring.researchValueWeight)} + T×${pct(scoring.eventValueWeight)} + J×${pct(scoring.researchValueWeight)} - C（C = S + D）\n${topicSection}`;
}

const GENERIC_WORDS_HOTWORD = new Set(['ai','公司','发布','消息','最新','回应','宣布','科技','行业','全球','技术','产品','平台','企业','市场','今日','新闻']);


export async function runResearchPipeline({ gateway, store, batchId, provider, workspaceRoot, maxAgeHours = 168, onProgress = () => {}, resumeFrom = '' }) {
  const batch = store.getBatch(batchId); if (!batch) throw new Error('批次不存在');
  if(batch.batch_type==='breaking')throw new Error('突发专题必须执行事实基座与双评分分析，不能进入常规 8+2 研判');
  if (!batch.hotspots.length) throw new Error('当前批次没有热点，请先完成采集');
  const scopedHotspots=batch.hotspots.filter(isResearchEligibleHotspot);
  const eligibleHotspots=scopedHotspots.filter((item)=>isFreshForBatch(item,batch.batch_date,maxAgeHours));
  const staleCount=scopedHotspots.length-eligibleHotspots.length;
  if(staleCount) onProgress(`已排除 ${staleCount} 条超过 ${maxAgeHours} 小时的旧闻；仍保留在历史档案`);
  if(!eligibleHotspots.length) throw new Error('当前批次没有处于有效时间窗口内的热点');
  const missing = eligibleHotspots.filter((item) => !tagsOf(item).eventKey || !tagsOf(item).preScores).length;
  if (missing) throw new Error(`仍有 ${missing} 条热点缺少完整语义标注，请先执行“打标”`);
  const workdir = batchTopicsDir(workspaceRoot, batch);
  const sourcesDir = path.join(workdir, 'sources');
  onProgress('冻结账号上下文与作者资产');
  const account = accountSnapshot(workspaceRoot);
  const snapshotText = `# 账号上下文快照\n\n生成时间：${new Date().toISOString()}\n\n${account.map((x)=>`## ${x.label}\n来源：${x.file || '降级模式'}\n\n${x.content}`).join('\n\n')}`;
  const snapshotPath = path.join(sourcesDir,'account-context-snapshot.md'); writeFile(snapshotPath,snapshotText);
  onProgress('生成稳定语义事件');
  const shadowPath = path.join(sourcesDir, 'event-resolution-shadow.json');
  const shadowDiffPath = path.join(sourcesDir, 'event-resolution-shadow-diff.json');
  let shadowResult;
  try {
    const history = loadShadowHistory({ store, workspaceRoot, currentBatchId: batch.id, limit: 30 });
    shadowResult = resolveEventShadow({ batch, hotspots: eligibleHotspots, legacyClusters: [], history });
    writeFile(shadowPath, JSON.stringify(shadowResult, null, 2));
    writeFile(shadowDiffPath, JSON.stringify({
      schema_version: shadowResult.schema_version,
      resolver_version: shadowResult.resolver_version,
      algorithm_version: shadowResult.algorithm_version,
      generated_at: shadowResult.generated_at,
      batch_id: shadowResult.batch_id,
      input_count: shadowResult.input_count,
      legacy: shadowResult.legacy,
      shadow: shadowResult.shadow,
      conservation: shadowResult.conservation,
      differences: shadowResult.differences,
    }, null, 2));
    store.saveEventResolutionShadow?.(batch.id, shadowResult);
    if (!shadowResult.conservation.ok) throw new Error('稳定事件解析报道数不守恒');
    onProgress(`稳定事件解析完成：${shadowResult.shadow.event_count} 组，待复核 ${shadowResult.differences.review_queue.length} 条`);
  } catch (error) {
    const message = String(error?.message || error);
    writeFile(shadowPath, JSON.stringify({ schema_version: 1, resolver_version: 'stable-v1', algorithm_version: 'structured-v1', mode: 'stable', generated_at: new Date().toISOString(), batch_id: batch.id, status: 'error', error: message }, null, 2));
    writeFile(shadowDiffPath, JSON.stringify({ status: 'error', error: message }, null, 2));
    throw Object.assign(new Error(`稳定事件解析失败：${message}`), { stage: 'research-event-resolution' });
  }
  // 事件卡尚未生成时不能确定内容类型；先装配稳定事件，分类和 T 在事件卡之后统一生成。
  let resolvedEvents = materializeStableEvents({ shadowEvents: shadowResult.events || [], hotspots: eligibleHotspots });
  let eventHeatRanking = { schemaVersion: 2, titleVersion: 2, generatedAt: new Date().toISOString(), batchId: batch.id, items: [] };
  const skippedEventIds=new Set((store.listPipelineFailures?.(batchId,{statuses:['skipped'],stages:['event-card']})||[])
    .map((item)=>String(item.detail?.eventId||item.object_key.replace(/^event:/,''))));
  const skippedEvents=resolvedEvents.filter((event)=>skippedEventIds.has(event.event_id));
  const skippedHotspotIds=new Set(skippedEvents.flatMap((event)=>event.articles||[]).map((item)=>Number(item.hotspot_id)).filter(Boolean));
  const researchHotspots=eligibleHotspots.filter((item)=>!skippedHotspotIds.has(item.id));
  const researchEvents=resolvedEvents.filter((event)=>!skippedEventIds.has(event.event_id));
  if(!researchHotspots.length)throw new Error('所有有效事件均已跳过，当前批次没有可研判内容');
  if (researchEvents.reduce((sum,event)=>sum+event.report_count,0) !== researchHotspots.length) throw new Error('稳定事件门禁失败：报道数不守恒');
  if(skippedEvents.length)onProgress(`已按人工决策排除 ${skippedEvents.length} 个事件、${skippedHotspotIds.size} 条报道`);
  const phaseG = { generated_at:new Date().toISOString(), excluded_stale_count:staleCount,excluded_skipped_event_count:skippedEvents.length, items:researchHotspots.map((item)=>({category_id:`G${String(item.id).padStart(5,'0')}`, hotspot_id:item.id,title:item.title,source:item.source,url:item.url,published_at:item.published_at,topic_category:item.category,market_scope:item.market_scope,...tagsOf(item)})) };
  const clustersJson = { generated_at:new Date().toISOString(), total_articles:researchHotspots.length,excluded_stale_count:staleCount,excluded_skipped_event_count:skippedEvents.length,total_events:researchEvents.length,events:researchEvents };
  writeFile(path.join(sourcesDir,'phase-G-output.json'),JSON.stringify(phaseG,null,2));
  writeFile(path.join(sourcesDir,'event-clusters.json'),JSON.stringify(clustersJson,null,2));
  writeFile(path.join(workdir,'hotspot-overview.html'),overviewHtml(researchEvents));
  onProgress('检查事件事实卡');
  const eventCardsPath = path.join(sourcesDir,'event-cards.json');
  const eventCardResult = await ensureBatchEventCards({gateway,store,batchId,provider,workspaceRoot,maxAgeHours,events:researchEvents,onProgress});
  const cardsByEvent = new Map((eventCardResult.clusters || []).map((event) => [event.event_id, event.card]));
  for (const event of researchEvents) { const card = cardsByEvent.get(event.event_id); if (card) event.card = card; }
  let clusters = researchEvents;
  for (const event of clusters) {
    if (event.card) continue;
    const member = event.articles?.find((article) => cardsByEvent.has(article.legacy_event_id));
    if (member) event.card = cardsByEvent.get(member.legacy_event_id);
  }
  // 分类完成后再计算 T：news_event 使用新闻热度模型，技术/趋势/项目使用各自的价值模型。
  const eventHeatPath = path.join(sourcesDir, 'event-heat-ranking.json');
  try {
    const previousItems = loadPreviousEventHeatItems({ store, workspaceRoot, batch });
    for (const event of researchEvents) {
      if (event.card?.classification) event.classification = event.card.classification;
    }
    eventHeatRanking = buildEventHeatRanking({ store, batch, previousItems, events: researchEvents });
    writeFile(eventHeatPath, JSON.stringify(eventHeatRanking, null, 2));
    onProgress(`四类事件榜单生成完成：${eventHeatRanking.totalEvents || 0} 个稳定事件`);
  } catch (error) {
    eventHeatRanking = { schemaVersion: 1, generatedAt: new Date().toISOString(), batchId: batch.id, status: 'error', error: String(error?.message || error), items: [] };
    writeFile(eventHeatPath, JSON.stringify(eventHeatRanking, null, 2));
    onProgress(`四类事件榜单生成失败，已保留旧选题流程：${eventHeatRanking.error}`);
  }
  const heatByEvent = new Map((eventHeatRanking.items || []).map((item) => [item.eventId, item]));
  for (const event of resolvedEvents) {
    const heat = heatByEvent.get(event.event_id);
    const card = cardsByEvent.get(event.event_id) || event.card;
    if (heat) Object.assign(event, { eventHeatScore: heat.heatScore, eventValue: heat.eventValue, t: heat.t, eventHeatRank: heat.rank, eventHeatState: heat.state, eventHistoryRepeatDays: heat.repeatDays, scoreModel: heat.scoreModel, scoreParts: heat.scoreParts });
    if (card) event.card = card;
    if (card?.classification) event.classification = card.classification;
  }
  clusters = resolvedEvents.filter((event) => !skippedEventIds.has(event.event_id));
  writeFile(path.join(sourcesDir,'event-clusters.json'),JSON.stringify({ generated_at:new Date().toISOString(), total_articles:researchHotspots.length,excluded_stale_count:staleCount,excluded_skipped_event_count:skippedEvents.length,total_events:clusters.length,events:clusters },null,2));
  writeFile(path.join(workdir,'hotspot-overview.html'),overviewHtml(clusters));
  // 阶段 0 只冻结 T 榜前 K 事件；语义研判交给模型，程序只做输入裁剪和输出门禁。
  const configuredDiscussionResearchTopK = store.getExtensionSetting?.('system', 'workbench')?.value?.discussionResearchTopK;
  const discussionResearchTopK = resolveDiscussionResearchTopK(configuredDiscussionResearchTopK);
  const stage3CheckpointPath = path.join(sourcesDir, 'discussion-research-stage3-input.json');
  let resumeSnapshot = null;
  if (resumeFrom === 'topic_generation') {
    try {
      const parsed = JSON.parse(fs.readFileSync(stage3CheckpointPath, 'utf8'));
      if (parsed?.batch_id === batch.id && parsed?.single_pass?.reports && parsed?.base_report) resumeSnapshot = parsed;
    } catch { /* 旧批次没有阶段 3 快照时走完整研判兼容路径。 */ }
    if (resumeSnapshot?.clusters?.length) clusters = resumeSnapshot.clusters;
    if (resumeSnapshot?.event_heat_ranking?.items?.length) eventHeatRanking = resumeSnapshot.event_heat_ranking;
    onProgress(resumeSnapshot ? '重试阶段 3：复用已完成的阶段 1/2 研判产物' : '未找到阶段 3 快照，兼容执行完整研判');
  }
  const currentDiscussionResearchBase = buildDiscussionResearch({ events: clusters, eventHeatRanking, batchId: batch.id, topK: discussionResearchTopK });
  const discussionResearchBase = resumeSnapshot?.base_report || currentDiscussionResearchBase;
  const topkResearchScopePath = path.join(sourcesDir, 'topk-research-scope.json');
  writeFile(topkResearchScopePath, JSON.stringify({
    schema_version: discussionResearchBase.schema_version,
    generated_at: discussionResearchBase.generated_at,
    batch_id: batch.id,
    mode: discussionResearchBase.mode,
    ...discussionResearchBase.policy,
    ...discussionResearchBase.scope,
  }, null, 2));
  onProgress(`阶段 0 完成：冻结 T 榜前 ${discussionResearchBase.scope.selected_count} 个非项目事件，保留 ${discussionResearchBase.scope.items.reduce((sum, item) => sum + (item.source_refs?.length || 0), 0)} 个来源指针`);
  const discussionResearchInputPath = path.join(sourcesDir, 'discussion-research-input.json');
  const discussionResearchReportsPath = path.join(sourcesDir, 'discussion-research-reports.md');
  const previousResearchInput = resumeSnapshot ? (() => {
    try { return JSON.parse(fs.readFileSync(discussionResearchInputPath, 'utf8')); } catch { return null; }
  })() : null;
  const discussionResearchModelRequests = Array.isArray(previousResearchInput?.phases) ? previousResearchInput.phases : [];
  const persistDiscussionResearchInput = () => writeFile(discussionResearchInputPath, JSON.stringify({
    schema_version: 4,
    generated_at: new Date().toISOString(),
    batch_id: batch.id,
    purpose: 'discussion-research',
    provider,
    phases: discussionResearchModelRequests,
    note: '每个 Top-K 事件执行一次完整模型研判交互；模型在同一次交互中完成事件内和事件外研判并返回 Markdown。程序只记录模型输入、原生联网调用和响应审计；正文抓取延迟到编辑室。第 3 阶段关闭联网，只读取研判报告。',
  }, null, 2));
  const recordDiscussionResearchModelRequest = (pass, request) => {
    discussionResearchModelRequests.push({
      phase: request.phase,
      attempt: request.attempt,
      pass,
      output_format: request.outputFormat || 'markdown',
      tool_choice: request.toolChoice || null,
      web_search_mode: request.webSearchMode || 'disabled',
      input: request.input,
      skill: request.messages.skill,
      prompt_source: request.messages.prompt_source,
      messages: request.messages.messages,
    });
    persistDiscussionResearchInput();
  };
  const recordDiscussionResearchModelResponse = (response) => {
    const request = [...discussionResearchModelRequests].reverse().find((item) => (
      item.phase === response.phase
      && item.attempt === response.attempt
      && !item.response
    ));
    if (!request) return;
    request.response = {
      tool_choice: response.toolChoice || null,
      call_id: response.result?.callId || null,
      finish_reason: response.result?.finishReason || null,
      tool_calls: Array.isArray(response.result?.toolCalls) ? response.result.toolCalls : [],
      usage: response.result?.usage || null,
      ...(response.error ? { error: response.error } : {}),
    };
    persistDiscussionResearchInput();
  };
  const singlePass = resumeSnapshot?.single_pass || await generateDiscussionResearchSinglePass({
    gateway,
    store,
    events: clusters,
    baseReport: discussionResearchBase,
    batchId: batch.id,
    provider,
    workspaceRoot,
    onProgress,
    onModelRequest: (request) => recordDiscussionResearchModelRequest('single_event_research', request),
    onModelResponse: recordDiscussionResearchModelResponse,
  });
  const researchReports = singlePass.reports || [];
  writeFile(stage3CheckpointPath, JSON.stringify({
    schema_version: 1,
    batch_id: batch.id,
    generated_at: new Date().toISOString(),
    base_report: discussionResearchBase,
    clusters,
    event_heat_ranking: eventHeatRanking,
    single_pass: {
      reports: singlePass.reports || [],
      internalResearch: singlePass.internalResearch || [],
      relations: singlePass.relations || [],
      referenceEvents: singlePass.referenceEvents || [],
      verifiedResearchMaterials: singlePass.verifiedResearchMaterials || [],
    },
  }, null, 2));
  const reportMarkdown = researchReports.map((report, index) => [
    `## ${index + 1}. ${report.title || report.event_id || '事件研判'}`,
    '',
    `事件 ID：${report.event_id || '—'}`,
    '',
    report.report_markdown || '（模型未返回报告）',
    '',
  ].join('\n')).join('\n');
  writeFile(discussionResearchReportsPath, `# 单事件模型研判报告\n\n${reportMarkdown}`);
  const topicResult = await generateDiscussionResearchTopics({
    gateway,
    store,
    events: clusters,
    baseReport: discussionResearchBase,
    internalResearch: singlePass.internalResearch,
    relations: singlePass.relations,
    verifiedResearchMaterials: singlePass.verifiedResearchMaterials,
    researchReports,
    relationSearchTasks: [],
    referenceEvents: singlePass.referenceEvents,
    batchId: batch.id,
    provider,
    workspaceRoot,
    onProgress,
    onModelRequest: (request) => recordDiscussionResearchModelRequest('topic_generation', request),
    onModelResponse: recordDiscussionResearchModelResponse,
  });
  const discussionResearch = {
    ...discussionResearchBase,
    mode: 'model_analysis',
    research_source: 'model',
    internal_signals: singlePass.internalResearch,
    internal_research: singlePass.internalResearch,
    relations: singlePass.relations,
    inter_event_research: singlePass.relations,
    verified_research_materials: singlePass.verifiedResearchMaterials,
    research_reports: researchReports,
    reference_events: singlePass.referenceEvents,
    topic_candidates: topicResult.topics,
    topic_candidate: topicResult.topics[0] || null,
    topic_generation_audit: topicResult.audit,
    model_research: {
      status: 'completed',
      phase_count: 2,
      research_stage: 'single_event_model_research',
      model_interaction_count: researchReports.length,
      failed_event_count: researchReports.filter((item) => item.error).length,
      model_report_count: researchReports.filter((item) => item.report_markdown && !item.error).length,
      verified_material_count: singlePass.verifiedResearchMaterials.filter((item) => item.status === 'verified').length,
      needs_review_material_count: singlePass.verifiedResearchMaterials.filter((item) => item.status === 'needs_review' || item.status === 'model_reported').length,
      research_material_count: singlePass.verifiedResearchMaterials.length,
      relation_pair_count: singlePass.relations.length,
      relation_group_count: 0,
      external_anchor_count: singlePass.referenceEvents.length,
      relation_search_task_count: 0,
      reference_event_count: singlePass.referenceEvents.length,
      selected_event_count: clusters.filter((event) => discussionResearchBase.scope.items.some((item) => item.event_id === event.event_id)).length,
      relation_count: singlePass.relations.length,
      topic_count: topicResult.topics.length,
      relation_topic_required: topicResult.audit?.required || 0,
      relation_topic_count: topicResult.audit?.actual || 0,
      relation_topic_repair_attempted: Boolean(topicResult.audit?.repair_attempted),
    },
  };
  persistDiscussionResearchInput();
  const discussionResearchPath = path.join(sourcesDir, 'discussion-research.json');
  const internalSignalsPath = path.join(sourcesDir, 'internal-signals.json');
  const eventRelationsPath = path.join(sourcesDir, 'event-relations.json');
  const verifiedResearchMaterialsPath = path.join(sourcesDir, 'verified-research-materials.json');
  const discussionResearchReportPath = path.join(workdir, 'discussion-research-report.md');
  writeFile(discussionResearchPath, JSON.stringify(discussionResearch, null, 2));
  writeFile(internalSignalsPath, JSON.stringify({ generated_at: discussionResearch.generated_at, batch_id: batch.id, mode: discussionResearch.mode, items: discussionResearch.internal_signals }, null, 2));
  writeFile(eventRelationsPath, JSON.stringify({ generated_at: discussionResearch.generated_at, batch_id: batch.id, mode: discussionResearch.mode, items: discussionResearch.relations, reference_events: discussionResearch.reference_events || [], verified_research_materials: discussionResearch.verified_research_materials || [] }, null, 2));
  writeFile(verifiedResearchMaterialsPath, JSON.stringify({ generated_at: discussionResearch.generated_at, batch_id: batch.id, mode: discussionResearch.mode, items: discussionResearch.verified_research_materials || [] }, null, 2));
  writeFile(discussionResearchReportPath, discussionResearchMarkdown(discussionResearch));
  onProgress(`阶段 1-3 模型讨论研判完成：T 榜前 ${discussionResearch.scope.selected_count} 个事件，形成 ${discussionResearch.verified_research_materials.length} 条研判素材和 ${discussionResearch.relations.length} 条有证据关系`);
  onProgress('执行事件级兼容预评估，并从 Top-K 研判候选中按讨论价值选择核心8条 + 黑马2条');
  const breaking=batch.batch_type==='breaking';
  if(breaking)onProgress('执行突发事件单题研判，不参与常规 8+2 竞争');
  const accountContext = getAccountContext({workspaceRoot});
  const scoring = resolveScoring(accountContext);
  const ranking = preselection(clusters, batch.batch_date, scoring, eventHeatRanking.items || []);
  const topicCandidates = buildTopicCandidates({ events: clusters, discussionResearch, ranking });
  const topicSelection = selectTopicCandidates(topicCandidates, { coreLimit: 8, blackLimit: 2, backupLimit: 3 });
  const topicRoleById = new Map([...topicSelection.core, ...topicSelection.black, ...topicSelection.backup].map((item) => [item.candidate_id, item.poolRole]));
  const topicCandidatesWithRoles = topicSelection.all.map((item) => ({ ...item, poolRole: topicRoleById.get(item.candidate_id) || '未入选' }));
  const topicCandidatePath = path.join(sourcesDir, 'topic-candidate-generation.json');
  const topicPreselectionPath = path.join(sourcesDir, 'topic-preselection-ranking.json');
  const topicCandidateReportPath = path.join(workdir, 'topic-candidate-report.md');
  writeFile(topicCandidatePath, JSON.stringify({ generated_at: new Date().toISOString(), batch_id: batch.id, policy: { source_scope: 'event-heat-ranking-top-k', t_unchanged: true, final_f_unchanged: true }, items: topicCandidatesWithRoles }, null, 2));
  writeFile(topicPreselectionPath, JSON.stringify({ generated_at: new Date().toISOString(), batch_id: batch.id, core: topicSelection.core, black: topicSelection.black, backup: topicSelection.backup, items: topicCandidatesWithRoles }, null, 2));
  writeFile(topicCandidateReportPath, topicCandidatesMarkdown({ candidates: topicCandidatesWithRoles, selection: topicSelection }));
  onProgress(`阶段 3 候选生成完成：${topicSelection.all.length} 条（核心 ${topicSelection.core.length}、黑马 ${topicSelection.black.length}、候补 ${topicSelection.backup.length}）`);
  // 维度优先统一选题：who（含单事件主体）/ what / where 混排，账号契合加分来自 account-context.json
  const pool = breaking
    ? {selected:ranking.map((item)=>({...item,poolRole:'突发专题',eliminationReason:'',dimension:'event',events:null})),backup:[],groups:[]}
    : selectArticlePool(clusters, ranking, { accountContext, eventHeatRanking });
  const briefPool = breaking ? [] : selectBriefPool(clusters, ranking);
  const socialScored = breaking ? [] : selectSocialCandidates(ranking, ranking.length, true);
  const socialPoolKeys = new Set(selectSocialPool(socialScored, 10, G_SOCIAL_CLASS_CAPS).map((item) => item.eventId ?? item.hotspotId ?? item.title));
  const socialRanking = socialScored.map((item,index)=>({...item,socialRank:index+1,selected:socialPoolKeys.has(item.eventId ?? item.hotspotId ?? item.title)}));
  const socialPool = socialRanking.filter((item)=>item.selected);
  // 事件候选映射为脑暴输入（早报维度组单独写入 brief-pool.json）
  const dimensionEntries = breaking ? [] : pool.selected.map((group) => {
    const articles = group.events.flatMap((event) => event.articles || []);
    const leadRank = ranking.find((entry) => entry.eventId === group.events[0].event_id) || {};
    return {
      eventId: `${group.dimension}:${group.key}`, hotspotId: articles[0]?.hotspot_id ?? group.events[0].representativeHotspotId,
      title: group.title, category: group.category || leadRank.category || group.events[0].topic_category,
      marketScope: leadRank.marketScope || group.events[0].market_scope,
      chinaRelevance: leadRank.chinaRelevance ?? group.events[0].china_relevance_score,
      chinaRelevanceReason: '', riskLevel: group.riskLevel, riskReason: '',
      preScores: leadRank.preScores || {}, base: group.score, categoryPreference: group.accountFit || 0, credibleScoop: 0,
      saturationPenalty: 0, keywords: [...new Set(group.events.flatMap((event) => event.keywords || []))].slice(0, 8),
      articles, repositoryMeta: null, blackHorseSignals: [], topicHeatBonus: 0,
      finalPreScore: group.score, poolRole: group.poolRole, dimension: group.dimension,
      topicValue: group.topicValue ?? null, topicValueParts: group.topicValueParts || null,
      eventValue: group.eventValue ?? group.t ?? null, t: group.t ?? group.eventValue ?? null,
      contentClass: group.contentClass || 'news_event', classificationStatus: group.classificationStatus || 'needs_review',
      classificationConfidence: group.classificationConfidence, classificationReason: group.classificationReason || '',
      classificationEvidence: group.classificationEvidence || [], classificationFeatures: group.classificationFeatures || {},
      articleEligible: group.articleEligible !== false, articleEligibilityReason: group.articleEligibilityReason || '',
      accountFit: group.accountFit || 0, developerImpact: Boolean(group.developerImpact),
      eventHeatScore: leadRank.eventHeatScore ?? null, eventHeatRank: leadRank.eventHeatRank ?? null,
      eventHeatState: leadRank.eventHeatState || null, eventHistoryRepeatDays: leadRank.eventHistoryRepeatDays || 0,
      duplicatePenalty: leadRank.duplicatePenalty || 0,
    };
  });
  writeFile(path.join(sourcesDir,'preselection-ranking.json'),JSON.stringify({generated_at:new Date().toISOString(),items:ranking},null,2));
  writeFile(path.join(sourcesDir,'brief-pool.json'),JSON.stringify({generated_at:new Date().toISOString(),items:briefPool},null,2));
  writeFile(path.join(sourcesDir,'social-card-preselection.json'),JSON.stringify({generated_at:new Date().toISOString(),items:socialPool},null,2));
  writeFile(path.join(sourcesDir,'social-card-ranking.json'),JSON.stringify({generated_at:new Date().toISOString(),items:socialRanking},null,2));
  store.saveEliminationReasons(batchId,ranking);
  const hasResearchBasis = (candidate) => {
    const topic = candidate?.topic_candidate || candidate?.research_context?.topic_candidate || {};
    const context = candidate?.research_context || {};
    return [
      ...researchList(topic.material_ids),
      ...researchList(topic.internal_signal_refs || topic.signal_refs),
      ...researchList(topic.relation_ids),
      ...researchList(context.verified_research_materials),
    ].length > 0;
  };
  // 常规脑暴只能消费研判阶段产生的候选；不再用普通事件池作为无依据的降级输入。
  const brainstormInputs = breaking ? pool.selected : topicSelection.selected.filter(hasResearchBasis);
  if (!breaking && topicSelection.selected.length && !brainstormInputs.length) {
    onProgress('候选均缺少事件内/事件间研判依据，已阻止普通事件摘要进入脑暴');
  }
  const hasBrainstormInputs = brainstormInputs.length > 0;
  const cards = hasBrainstormInputs
    ? await brainstorm(gateway,store,brainstormInputs,account,batchId,provider,onProgress,workspaceRoot)
    : [];
  if (!cards.length && hasBrainstormInputs) throw new Error('探索脑暴没有返回有效候选');
  if (!hasBrainstormInputs && !breaking) onProgress('文章池暂无可研判候选，已跳过探索脑暴；可查看图文池或补充分类证据后重试');
  const synthesis = cards.length
    ? (breaking ? breakingSynthesis(cards) : await synthesize(gateway,store,cards,batchId,provider,onProgress,workspaceRoot))
    : { items: [], metaNarratives: [], combination: {} };
  const scored = cards.length ? scoreCards(cards,synthesis,scoring) : [];
  if (!scored.length && hasBrainstormInputs) throw new Error('全部候选均为 NO_ANGLE，请检查标注或更换批次');
  // 当前先开放完整研判结果供人工检查；成稿门禁仍由后续编辑会/成稿流程负责。
  // 复盘结束后再恢复正式成稿线，避免阶段 3 的候选被展示层提前截断。
  const DRAFT_FLOOR = 0;
  const draftable = breaking
    ? scored.filter((item) => item.scoreStatus === 'ready')
    : scored.filter((item) => item.scoreStatus === 'ready' && item.f >= DRAFT_FLOOR);
  const dropped = scored.length - draftable.length;
  if (dropped) onProgress(`${dropped} 个候选 F 低于成稿线 ${DRAFT_FLOOR}，未进入选题池`);
  if (!draftable.length && hasBrainstormInputs) throw new Error('没有可评分候选：请先补齐事件价值 T 和可核验事实');
  onProgress('写入临时总榜、编辑议题卡与选题池');
  writeFile(path.join(workdir,'editorial-agenda.md'),markdownAgenda(scored));
  writeFile(path.join(workdir,'topics-ranked.md'),markdownRanked(scored,synthesis,briefPool,scoring));
  if (!breaking) {
    const cleared = store.clearGeneratedArticleCandidates(batchId);
    if (cleared) onProgress(`已清理上一轮 ${cleared} 条自动文章候选，保留人工锁定与成稿中候选`);
  }
  // Keep the established saveAnalyzedCandidates(batchId,draftable.map(...)) input contract auditable while retaining the persisted rows below.
  const analyzedRecords = draftable.map((item)=>({hotspotId:item.source.hotspotId,
    hotspotIds:(item.source.articles||[]).map((article)=>article.hotspot_id).filter(Boolean),title:item.source.title,
    poolRole:item.source.poolRole,riskLevel:item.source.riskLevel,dimension:item.source.dimension || 'event',
    topicValue:item.source.topicValue, eventValue:item.eventValue, a:item.a,
    angle:item.angle,thesis:item.thesis,editorQuestion:item.editorQuestion,h:item.h,b:item.b,p:item.p,j:item.j,researchValue:item.researchValue,competitionPenalty:item.competitionPenalty,s:item.s,d:item.d,f:item.f,
    distributionLane:item.distributionLane,readerStake:item.readerStake,readerStakeScore:item.readerStakeScore,
    format:item.format || '',materialType:item.materialType || '',historicalType:item.hProfile?.historicalType || '',
    contentRoute:item.contentRoute || 'article', scoreStatus:item.scoreStatus || 'ready', scoreWarning:item.scoreWarning || '',
    contentClass:item.source.contentClass, classificationStatus:item.source.classificationStatus, classificationConfidence:item.source.classificationConfidence,
    classificationReason:item.source.classificationReason, classificationEvidence:item.source.classificationEvidence, classificationFeatures:item.source.classificationFeatures,
    articleEligible:item.source.articleEligible, articleEligibilityReason:item.source.articleEligibilityReason }));
  store.saveAnalyzedCandidates(batchId, analyzedRecords);
  const persistedCandidates = store.listCandidates(batchId, 'article');
  if(breaking){
    const tracks=batch.requested_tracks_list||['article'];
    for(const record of scored){
      const candidate=store.listCandidates(batchId,'article').find((item)=>Number(item.hotspot_id)===Number(record.source.hotspotId)
        || (item.composite && store.candidateHotspots(item.id).some((hotspot)=>Number(hotspot.id)===Number(record.source.hotspotId))));
      if(!candidate)continue;
      if(tracks.includes('social_cards'))store.addCandidateTracks(candidate.id,['social_cards'],{status:'pooled',pool_role:'突发专题',output_mode:'wechat-event-cards'});
      if(!tracks.includes('article'))store.removeCandidateTrack(candidate.id,'article');
    }
  } else {
    store.saveSocialPreselection(batchId, socialPool);
    if (topicSelection.selected.length) onProgress(`已生成 ${topicSelection.selected.length} 个讨论导向选题候选：${topicSelection.selected.map((group) => `${group.poolRole}·${group.title}`).join('、')}`);
    if (briefPool.length) onProgress(`已生成 ${briefPool.length} 个早报维度组：${briefPool.map((group) => group.title).join('、')}`);
  }
  const artifacts = [
    ['账号上下文快照','account-context-snapshot.md',snapshotPath],['Phase G 语义标注','phase-G-output.json',path.join(sourcesDir,'phase-G-output.json')],
    ['全量事件聚类','event-clusters.json',path.join(sourcesDir,'event-clusters.json')],['事件归并影子结果','event-resolution-shadow.json',shadowPath],
    ['事件归并影子差异','event-resolution-shadow-diff.json',shadowDiffPath],['事件热榜','event-heat-ranking.json',eventHeatPath],['事件事实卡','event-cards.json',eventCardsPath],
    ['讨论研判总览','discussion-research.json',discussionResearchPath],['讨论研判模型输入','discussion-research-input.json',discussionResearchInputPath],['Top-K 研判范围','topk-research-scope.json',topkResearchScopePath],
    ['单事件模型研判报告','discussion-research-reports.md',discussionResearchReportsPath],['阶段 3 重试快照','discussion-research-stage3-input.json',stage3CheckpointPath],
    ['事件内研判信号','internal-signals.json',internalSignalsPath],['事件间关系','event-relations.json',eventRelationsPath],['研判素材','verified-research-materials.json',verifiedResearchMaterialsPath],
    ['讨论研判报告','discussion-research-report.md',discussionResearchReportPath],
    ['候选选题生成','topic-candidate-generation.json',topicCandidatePath],['候选选题预选','topic-preselection-ranking.json',topicPreselectionPath],
    ['候选选题研判报告','topic-candidate-report.md',topicCandidateReportPath],
    ['全量预选排名','preselection-ranking.json',path.join(sourcesDir,'preselection-ranking.json')],
    ['早报维度组','brief-pool.json',path.join(sourcesDir,'brief-pool.json')],
    ['图文预选排名','social-card-preselection.json',path.join(sourcesDir,'social-card-preselection.json')],
    ['热点全景','hotspot-overview.html',path.join(workdir,'hotspot-overview.html')],['编辑议题卡','editorial-agenda.md',path.join(workdir,'editorial-agenda.md')],
    ['临时选题总榜','topics-ranked.md',path.join(workdir,'topics-ranked.md')],
  ];
  for (const [kind,name,file] of artifacts) { const stat=fs.statSync(file); store.upsertArtifact({batchId,kind,name,path:file,size:stat.size,modifiedAt:stat.mtime.toISOString()}); }
  store.updateBatch(batchId,{stage:'editorial',status:'review'});
  onProgress(`热点研判完成：${clusters.length} 个稳定事件，${scored.length} 条编辑候选`);
  return { articles:eligibleHotspots.length, excludedStale:staleCount, events:clusters.length, selected:scored.length, top:scored.slice(0,3).map((x)=>({candidateId:x.candidateId,title:x.source.title,f:x.f})) };
}
