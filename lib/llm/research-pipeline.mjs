import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { batchTopicsDir } from '../core/workspace-paths.mjs';
import { formatAccountContext, getAccountContext } from '../domain/account-context.mjs';
import { enforceNotificationQuota, resolveDistributionDecision, resolveNotificationPolicy } from '../domain/distribution-strategy.mjs';
import { isResearchEligibleHotspot } from '../domain/hotspot-pipeline-scope.mjs';
import { selectionPrompt } from './selection-prompts.mjs';

const CATEGORIES = ['🤖 AI/技术动态','📰 综合资讯','🏢 大厂战略','📈 行业趋势','💼 职场生态'];
const CATEGORY_PREFERENCE = { '🏢 大厂战略': 6, '🤖 AI/技术动态': 4, '📈 行业趋势': 3, '📰 综合资讯': 1, '💼 职场生态': 0 };
const P_BASE = { '🏢 大厂战略': 50, '🤖 AI/技术动态': 40, '📈 行业趋势': 30, '📰 综合资讯': 20, '💼 职场生态': 10 };
const H_BASE = { worker_social: 48, bigtech: 33, owned_experience: 35, controversial_return: 30, key_person_move: 33, github_tool: 25, ai_tool_test: 25, financing: 10, career_anxiety: 5, contrarian_bigtech: 35 };

// 评分参数默认值。account-context.json 可用 scoring 段覆盖：
// {"scoring":{"weights":{"h":0.6,"b":0.25,"p":0.15},"accountFitBonus":6,
//   "categoryPreference":{"📰 综合资讯":1},"pBase":{...},"hBase":{...}}}
// 只写想改的键，未提供的键回退到这里的默认值；F = H×h + B×b + P×p - S。
const DEFAULT_SCORING = Object.freeze({
  weights: Object.freeze({ h: 0.6, b: 0.25, p: 0.15 }),
  categoryPreference: CATEGORY_PREFERENCE,
  pBase: P_BASE,
  hBase: H_BASE,
  accountFitBonus: 6,
  toolEngineeringBonus: 10,
  minimumToolCandidates: 2,
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
  return {
    weights: {
      h: num(weights.h, DEFAULT_SCORING.weights.h),
      b: num(weights.b, DEFAULT_SCORING.weights.b),
      p: num(weights.p, DEFAULT_SCORING.weights.p),
    },
    categoryPreference: mergeTable(CATEGORY_PREFERENCE, scoring.categoryPreference),
    pBase: mergeTable(P_BASE, scoring.pBase),
    hBase: mergeTable(H_BASE, scoring.hBase),
    accountFitBonus: num(scoring.accountFitBonus, DEFAULT_SCORING.accountFitBonus),
    toolEngineeringBonus: num(scoring.toolEngineeringBonus, DEFAULT_SCORING.toolEngineeringBonus),
    minimumToolCandidates: Math.max(0, Math.floor(num(scoring.minimumToolCandidates, DEFAULT_SCORING.minimumToolCandidates))),
    notificationPolicy: resolveNotificationPolicy(ctx),
  };
}

export function isSocialCardCandidate(item) {
  if (!item || item.status === 'NO_ANGLE' || item.writeReadiness === 'SKIP' || item.source?.riskLevel === '高') return false;
  if (String(item.format || '').trim() === '贴图') return true;
  const historicalType = String(item.hProfile?.historicalType || '');
  if (historicalType === 'github_tool' || historicalType === 'ai_tool_test') return true;
  const materialType = String(item.materialType || '').toLowerCase();
  return /github|开源|仓库|工具|教程|产品演示/.test(materialType);
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
function parseJson(content) { return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
function parseModelJson(result, store) {
  try { return parseJson(result.content); }
  catch (error) {
    const reason = result.finishReason === 'length' ? '模型达到输出上限，JSON 被截断' : `模型返回的 JSON 无效：${error.message}`;
    store.updateModelCall(result.callId,{status:'invalid_output',error:reason});
    throw new Error(reason);
  }
}
function tagsOf(item) { try { return JSON.parse(item.raw_json).aiTags ?? {}; } catch { return {}; } }
function summaryOf(item, maxLength = 800) {
  let raw={}; try { raw=JSON.parse(item.raw_json); } catch {}
  return String(raw.summary||'').replace(/\s+/g,' ').trim().slice(0,maxLength);
}
function repositoryMetaOf(item) {
  let raw={}; try { raw=JSON.parse(item.raw_json); } catch {}
  const isRepository=item.source_group==='github'||item.source==='github'||/^https:\/\/github\.com\//i.test(String(item.url||''));
  if(!isRepository)return null;
  return {repository:raw.repository||item.title,description:raw.description||'',language:raw.language||'',
    stars:Number.isFinite(Number(raw.stars))?Number(raw.stars):null,topics:Array.isArray(raw.topics)?raw.topics:[],
    createdAt:raw.createdAt||null,updatedAt:raw.updatedAt||null,
    discoveryChannels:Array.isArray(raw.discoveryChannels)?raw.discoveryChannels:[],primaryDiscovery:raw.primaryDiscovery||item.source_type||'',
    trendingPeriods:Array.isArray(raw.periods)?raw.periods:raw.period?[raw.period]:[],mentionedBy:Array.isArray(raw.mentionedBy)?raw.mentionedBy:[]};
}
function provenanceOf(item) {
  let raw={}; try { raw=JSON.parse(item.raw_json); } catch {}
  if(item.source_name) return {source:item.source_name,channel:raw.route||item.source_name};
  if((item.source_group==='rsshub'||item.source==='rsshub')&&raw.route) {
    const slug=String(raw.route).split('?')[0].split('/').filter(Boolean)[0]||'rsshub';
    const labels={latepost:'晚点 LatePost',huxiu:'虎嗅',techcrunch:'TechCrunch',anthropic:'Anthropic',jiemian:'界面新闻',readhub:'ReadHub',solidot:'Solidot',openai:'OpenAI','36kr':'36氪'};
    return {source:labels[slug]||`RSSHub · ${slug}`,channel:String(raw.route).split('?')[0]};
  }
  if(item.source_group==='reddit'||item.source==='reddit') return {source:'Reddit',channel:raw.subreddit?`r/${raw.subreddit}`:'Reddit'};
  return {source:item.source,channel:item.source};
}
function safeKey(value, id) { return String(value || `singleton-${id}`).trim().toLowerCase().replace(/\s+/g, ' '); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, content, 'utf8'); fs.renameSync(temporary, filePath);
  const stat = fs.statSync(filePath);
  return { size: stat.size, modifiedAt: stat.mtime.toISOString() };
}

export function isFreshForBatch(item, batchDate, maxAgeHours = 168) {
  const published = Date.parse(item.published_at || '');
  if (!Number.isFinite(published)) return true;
  // 优先按实际抓取时间（hotspot.created_at）划定有效窗口，与采集时的 filterRecentItems 一致；
  // 缺失抓取时间时回退到批次日期 23:59:59（+08:00）的旧行为。
  const collected = Date.parse(item.created_at || '');
  const reference = Number.isFinite(collected) ? collected : Date.parse(`${batchDate}T23:59:59+08:00`);
  if (!Number.isFinite(reference)) return true;
  return published >= reference - maxAgeHours*60*60*1000 && published <= reference + 6*60*60*1000;
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
  const entries = [{ label: '账号上下文', file: 'account-context.json', content: formatAccountContext() }];
  const assetsFile = path.join(workspaceRoot, '.agents', 'wechat-author-assets.md');
  if (fs.existsSync(assetsFile)) entries.push({ label: '作者资产', file: assetsFile, content: fs.readFileSync(assetsFile, 'utf8').slice(0, 16000) });
  return entries;
}

// 账号内容支柱 → 打标五类映射（类目前列优先）。contentPillars 形如“AI 行业热点：描述”，按前缀匹配。
const PILLAR_CATEGORY_MAP = {
  'AI 行业热点': ['🤖 AI/技术动态', '🏢 大厂战略'],
  '大厂战略': ['🏢 大厂战略', '🤖 AI/技术动态'],
  '开源与工程实践': ['🤖 AI/技术动态'],
  '技术认知': ['📈 行业趋势'],
  '程序员成长': ['💼 职场生态'],
};

export function focusedCategories(ctx = getAccountContext()) {
  const pillars = Array.isArray(ctx?.contentPillars) ? ctx.contentPillars : [];
  const names = pillars.map((pillar) => String(pillar).split(/[：:]/)[0].trim());
  return new Set(names.flatMap((name) => PILLAR_CATEGORY_MAP[name] || []));
}

export function clusterItems(items) {
  const groups = new Map();
  for (const item of items) {
    const tags = tagsOf(item); const key = safeKey(tags.eventKey, item.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ item, tags });
  }
  return [...groups.entries()].map(([key, members]) => {
    // event_id 由事件指纹（eventKey/单条回退键）哈希派生：与输入顺序、成员增减无关，
    // 保证事件卡文件与后续重新聚类的结果稳定对应，避免顺序编号导致的事件卡错配。
    members.sort((a,b) => Number(b.item.score || 0) - Number(a.item.score || 0) || a.item.id - b.item.id);
    const lead = members[0]; const provenances=members.map(({item})=>provenanceOf(item));
    const repositoryMember=members.find(({item})=>repositoryMetaOf(item));
    return {
      event_id: `E${crypto.createHash('sha1').update(key).digest('hex').slice(0, 10).toUpperCase()}`,
      representative_title: lead.item.title,
      representativeHotspotId: lead.item.id,
      market_scope: lead.item.market_scope,
      china_relevance_score: clamp(lead.tags.chinaRelevance, 0, 12),
      china_relevance_reason: lead.tags.relevanceReason || '模型未提供具体理由，需编辑核验',
      global_exception: Boolean(lead.tags.globalException),
      topic_category: CATEGORIES.includes(lead.item.category) ? lead.item.category : '📰 综合资讯',
      keywords: [...new Set(members.flatMap((m) => m.tags.keywords || []))].slice(0, 8),
      source_count: new Set(provenances.map((source) => source.source)).size,
      report_count: members.length,
      peak_source_percentile: null,
      latest_time: members.map((m) => m.item.published_at).filter(Boolean).sort().at(-1) || null,
      cluster_confidence: members.length > 1 ? 'medium' : 'low',
      articles: members.map(({ item, tags },articleIndex) => ({ category_id: `G${String(item.id).padStart(5,'0')}`, hotspot_id: item.id,
        title: item.title, source: provenances[articleIndex].source, channel:provenances[articleIndex].channel, url: item.url, heat: item.score, time: item.published_at,
        risk_level: tags.riskLevel || '待评估', summary: summaryOf(item) })),
      tags: lead.tags,
      repositoryMeta:repositoryMember?repositoryMetaOf(repositoryMember.item):null,
    };
  });
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

export const DIMENSION_POOL_ROLES = Object.freeze({ who:'主体动态', what:'横向对比', where:'场合盘点', event:'事件深挖' });

const DIMENSION_RISK_RANK = { '高':3, '较高':3, '中':2, '低':1 };

function dimensionPartsOf(event) {
  const parts = event?.tags?.eventParts || {};
  if (parts.who) return parts;
  // 旧数据缺 eventParts 时从 eventKey（who|what 规范化键）回退提取 who，保证主体维度可用；
  // actionType/object/occasion 无法回退，对应维度自动跳过。
  const eventKey = String(event?.tags?.eventKey || '');
  const [who, what] = eventKey.split('|');
  return who ? { who, what: what || '', labels: {} } : {};
}

// who/what/where 三维度选题分组：按写文章的目的聚合事件。
// who = 主体动态综述（同主体 ≥2 事件）；what = 同类动作/对象横向对比（≥2 个不同主体）；
// where = 命名场合盘点（同场合 ≥2 事件）。旧数据缺 actionType/object/occasion 时自动跳过对应分组。
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

  // who 维度：同一主体 ≥2 个事件 → 主体近期动态 + 思考评价
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
      // 叙事张力：发布/获奖/开源等正面动作与诉讼/争议回应共存时，主体故事最有戏剧结构
      const tension = (actions.has('争议回应') || actions.has('诉讼')) && (actions.has('发布') || actions.has('获奖') || actions.has('开源') || actions.has('融资')) ? 6 : 0;
      const score = Math.round(Math.max(...events.map(preScore)) + Math.min(events.length - 1, 3) * 4 + tension);
      return { dimension:'who', key:who, title:`${labelOf(events, 'who', who)}近期动态`, events, score, riskLevel:topRisk(events), leads:events.map((event) => event.representative_title).slice(0, 3) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, whoLimit);
  groups.push(...whoGroups);

  // what 维度两层：actionType 同类动作对比 + object 同赛道对比，均要求 ≥2 个不同主体
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
    whatCandidates.push({ dimension:'what', key:`action:${action}`, title:`近期${action}汇总`, events, score:whatScore(events), riskLevel:topRisk(events), leads:events.map((event) => event.representative_title).slice(0, 3) });
  }
  for (const [object, events] of byObject) {
    if (distinctWhos(events).size < 2 || events.length > maxObjectEvents) continue;
    whatCandidates.push({ dimension:'what', key:`object:${object}`, title:`近期“${labelOf(events, 'object', object)}”汇总`, events, score:whatScore(events), riskLevel:topRisk(events), leads:events.map((event) => event.representative_title).slice(0, 3) });
  }
  // 两层去重：成员事件集合完全相同的组只保留一个
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

  // where 维度：同一命名场合 ≥2 个事件 → 场合盘点
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
      return { dimension:'where', key:occasion, title:`“${labelOf(events, 'occasion', occasion)}”场合盘点`, events, score, riskLevel:topRisk(events), leads:events.map((event) => event.representative_title).slice(0, 3) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, whereLimit);
  groups.push(...whereGroups);

  return groups;
}

export function preselection(clusters, batchDate = new Date().toISOString().slice(0,10), scoring = DEFAULT_SCORING) {
  const coverage = hotwordEventCoverage(clusters);
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
    return { eventId:event.event_id, hotspotId:event.representativeHotspotId, title:event.representative_title,
      category:event.topic_category, marketScope:event.market_scope, chinaRelevance:event.china_relevance_score,
      chinaRelevanceReason:event.china_relevance_reason || '',
      riskLevel:event.tags.riskLevel || '待评估', riskReason:event.tags.riskReason || '', preScores:parts, base,
      categoryPreference, credibleScoop, saturationPenalty,
      keywords:event.keywords || [], articles:event.articles || [], repositoryMeta:event.repositoryMeta||null,
      blackHorseSignals:event.tags.blackHorseSignals || [], topicHeatBonus, finalPreScore:base+categoryPreference+credibleScoop+topicHeatBonus-saturationPenalty };
  }).sort((a,b) => b.finalPreScore-a.finalPreScore || b.credibleScoop-a.credibleScoop || b.preScores.informationGain-a.preScores.informationGain || a.title.localeCompare(b.title));
}

export function selectSocialCandidates(ranking, limit = 10, includeBelowThreshold = false) {
  return ranking.map((item) => {
    if (item.riskLevel === '高') return null;
    const githubArticle = (item.articles || []).find((article) => /^https:\/\/github\.com\//i.test(String(article.url || '')));
    const repository=item.repositoryMeta||null;
    const text = [item.title, item.chinaRelevanceReason, repository?.description, repository?.language,
      ...(item.keywords || []), ...(repository?.topics || []), ...(repository?.discoveryChannels || [])].join(' ');
    const demonstrable = /工具|教程|学习资源|框架|跨平台|开发者|开发|临时邮箱|隐私|窗口管理器|代码审查|架构图|音频处理|文件传输|监控|skill|workflow|framework|library|plugin|server|cli|agent/i.test(text);
    if (githubArticle && !demonstrable) return null;
    const trending=/github\s*trending/i.test(text)||repository?.discoveryChannels?.includes('trending');
    const hasDescription=Boolean(String(repository?.description||'').trim()), topicCount=repository?.topics?.length||0;
    const toolClarity=Math.min(20,(githubArticle?10:0)+(hasDescription?8:2)+Math.min(6,topicCount*2));
    const scenarioValue=Math.min(15,(demonstrable?9:3)+Math.min(6,Number(item.chinaRelevance||0)/2));
    const demonstrability=Math.min(15,demonstrable?12+(repository?.language?3:0):4);
    const visualPotential=Math.min(15,6+(demonstrable?4:0)+Math.min(5,topicCount));
    const saveSearchValue=Math.min(15,5+(trending?4:0)+(Number(repository?.stars)>=1000?4:1)+(repository?.discoveryChannels?.includes('mentioned')?2:0));
    const sourceCompleteness=Math.min(20,(hasDescription?5:0)+(repository?.language?3:0)+(topicCount?4:0)+(Number(repository?.stars)>0?3:0)+(repository?.createdAt?2:0)+((repository?.discoveryChannels?.length||0)?3:0));
    const factGapPenalty=(hasDescription?0:4)+(topicCount?0:1), permissionRiskPenalty=0, saturationPenalty=Math.min(10,Number(item.saturationPenalty||0));
    const score=Math.max(0,Math.min(100,toolClarity+scenarioValue+demonstrability+visualPotential+saveSearchValue+sourceCompleteness-factGapPenalty-permissionRiskPenalty-saturationPenalty));
    const socialScoreDetails={toolClarity,scenarioValue,demonstrability,visualPotential,saveSearchValue,sourceCompleteness,
      factGapPenalty,permissionRiskPenalty,saturationPenalty,finalScore:Number(score.toFixed(1)),scoreStage:'discovery'};
    const reasons=[githubArticle?'GitHub 仓库':null,trending?'Trending':null,repository?.discoveryChannels?.includes('search')?'近期增长发现':null,
      repository?.discoveryChannels?.includes('mentioned')?'热点提及':null,Number(repository?.stars)>=1000?`${repository.stars} Stars`:null,demonstrable?'可演示工具':null].filter(Boolean);
    if (score < 45 && !includeBelowThreshold) return null;
    return { ...item, hotspotId:githubArticle?.hotspot_id || item.hotspotId,
      title:githubArticle?.title || item.title, sourceUrl:githubArticle?.url || '', socialScore:socialScoreDetails.finalScore,socialScoreDetails,
      eligible:score>=45,rejectionReason:score>=45?'':`Social Fit ${socialScoreDetails.finalScore}，低于预选线 45`,reasons };
  }).filter(Boolean).sort((a,b) => b.socialScore-a.socialScore || b.finalPreScore-a.finalPreScore).slice(0, Math.max(1, Number(limit) || 10));
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

// 维度优先的统一选题：who（含单事件主体=事件深挖）/ what / where 三个维度产生候选，
// 维度分 = 结构分 + 账号契合加分（命中 contentPillars 对应类目加分，默认 +6，可用 scoring.accountFitBonus 覆盖），按分数全局混排取核心 8，
// 黑马 2 仍按 blackHorseSignals 选择，候补 3 条保留。事件级排名回填入池身份与淘汰原因。
export function selectDimensionPool(clusters, ranking, { coreLimit = 8, blackLimit = 2, backupLimit = 3, accountContext } = {}) {
  const groups = dimensionSelections(clusters, ranking, { whoLimit: 99, whatLimit: 99, whereLimit: 99, minWhoEvents: 1 });
  const focused = focusedCategories(accountContext);
  const scoring = resolveScoring(accountContext);
  const scored = groups.map((group) => {
    const leadRank = ranking.find((entry) => entry.eventId === group.events[0].event_id) || {};
    const category = leadRank.category || group.events[0].topic_category;
    const accountFit = focused.has(category) ? scoring.accountFitBonus : 0;
    const toolSignalCount = group.events.filter((event) => {
      const parts = dimensionPartsOf(event);
      const text = [parts.actionType, parts.object, parts.what, event.representative_title, ...(event.keywords || [])].join(' ');
      const hasGithub = Boolean(event.repositoryMeta) || (event.articles || []).some((article) => /^https:\/\/github\.com\//i.test(String(article.url || '')));
      return hasGithub || /开源|开发工具|工程实践|代码模型|代码助手|编程工具|框架|插件|技能库|agent\s*skills?|cli\b|sdk\b/i.test(text);
    }).length;
    const toolEngineering = toolSignalCount > 0 && toolSignalCount / group.events.length >= 0.5;
    const toolEngineeringBonus = toolEngineering ? scoring.toolEngineeringBonus : 0;
    return { ...group, category, accountFit, toolEngineering, toolEngineeringBonus, score: group.score + accountFit + toolEngineeringBonus };
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
  const minimumTools = Math.min(coreLimit, scoring.minimumToolCandidates);
  const selectedKeys = new Set(coreGroups.map((group) => `${group.dimension}:${group.key}`));
  const selectedToolCount = () => coreGroups.filter((group) => group.toolEngineering).length;
  for (const toolGroup of distinct.filter((group) => group.toolEngineering && !selectedKeys.has(`${group.dimension}:${group.key}`))) {
    if (selectedToolCount() >= minimumTools) break;
    let replaceIndex = -1;
    for (let index = coreGroups.length - 1; index >= 0; index -= 1) {
      if (!coreGroups[index].toolEngineering) { replaceIndex = index; break; }
    }
    if (replaceIndex < 0) break;
    selectedKeys.delete(`${coreGroups[replaceIndex].dimension}:${coreGroups[replaceIndex].key}`);
    coreGroups[replaceIndex] = toolGroup;
    selectedKeys.add(`${toolGroup.dimension}:${toolGroup.key}`);
  }
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

const BRAINSTORM_SYSTEM = `你是热点探索编辑。不得补造事实、作者经历、引语或数据。对输入候选生成临时探索卡，不代表作者最终立场。风险只标记不删除。
返回严格 JSON：{"items":[{"candidateId":字符串,"status":"PASS|NO_ANGLE","angle":字符串,"thesis":字符串,"hypotheses":[{"claim":字符串,"support":字符串,"counter":字符串,"verify":字符串,"readerValue":字符串}],"evidenceBoundary":字符串,"counterEvidence":字符串,"editorQuestion":字符串,"writeReadiness":"READY_PUBLIC_ANALYSIS|NEED_AUTHOR_INPUT|NEED_EXPERIMENT|SHORT_COMMENT_ONLY|SKIP","packaging":{"contentPillar":字符串,"readerJob":字符串,"mode":"搜索型|分享型|双栖型","distributionLane":"推荐池|通知池|实验池","readerStake":字符串,"notificationFit":0到5,"notificationReason":字符串,"titleDirection":字符串,"hook":字符串,"outline":[字符串],"practicalIncrement":字符串,"materialGaps":字符串},"bScores":{"angleUniqueness":0到5,"emotionSpread":0到5,"titleHook":0到5,"audienceRelevance":0到5,"factSupport":0到5},"hProfile":{"historicalType":"worker_social|bigtech|owned_experience|controversial_return|key_person_move|github_tool|ai_tool_test|financing|career_anxiety|contrarian_bigtech","fiveSenseCount":0到5,"fiveQuestionCount":0到5,"recommendationFit":0到10,"emotionTheme":0到10,"searchFriendly":0到5},"materialType":字符串,"format":"文章|贴图","recommendedSkill":"wechat-mp-tech-hotspot|wechat-mp-tech-deep|wechat-mp-deep-dive|wechat-mp-gossip-chill"}]}。
每条只给2个互不等价命题和反证；outline只给3项。通知池是稀缺池，允许整批为空；必须达到账号配置的通知适配分与事实支持分，风险等级不得命中禁入项。readerStake 必须写明具体读者、需要改变的决策或动作、以及工作/收入/岗位/效率/成本/选择中的具体后果；“影响职业方向”“影响技术选择”之类泛化表述不合格。传闻、未证实重大事件、健康或生物安全题默认进入实验池，不能靠情绪或标题张力晋级。没有读者利益的宏观事件不得仅凭主体知名度获得高 audienceRelevance。除标题外，每个字符串控制在80个汉字以内。没有可靠事实支撑时降低 factSupport 并写明待核验，不能用流畅包装掩盖证据缺口。不要输出 Markdown、解释或 JSON 之外的文字。`;

export async function brainstorm(gateway, store, selected, account, batchId, provider, onProgress, workspaceRoot) {
  const { prompt: brainstormSystem } = selectionPrompt({ workspaceRoot, skillName: 'hotspot-brainstorm', fallback: BRAINSTORM_SYSTEM });
  const cards = [];
  const providerConfig=gateway.config.providers[provider||gateway.config.defaultProvider];
  const candidates=selected.map((item,index)=>({...item,candidateId:`C${String(index+1).padStart(3,'0')}`}));
  async function processGroup(group,label,retry=false) {
    onProgress(`探索脑暴 ${label}（已完成 ${cards.length}/${selected.length}）`);
    const result = await gateway.complete({ provider, purpose:'hotspot-brainstorm-explore', batchId, jsonMode:true,
      messages:[{role:'system',content:brainstormSystem,protected:true},
        {role:'user',content:`${retry?'【极简重试】每个字符串不超过40个汉字，严格闭合JSON。\n':''}【账号与作者资产】\n${account.map((x)=>`${x.label}:\n${x.content}`).join('\n\n')}\n\n【候选】\n${JSON.stringify(group)}`,protected:true}] ,
      maxOutputTokens:Math.min(6500,providerConfig.maxOutputTokens) });
    let parsed;
    try { parsed=parseModelJson(result,store); }
    catch(error) {
      if(group.length>1) {
        const middle=Math.ceil(group.length/2); onProgress(`脑暴输出被截断；自动拆分为 ${middle} + ${group.length-middle} 条重试`);
        await processGroup(group.slice(0,middle),`${label}.1`); await processGroup(group.slice(middle),`${label}.2`); return;
      }
      if(!retry) { onProgress('单张分析卡仍过长，切换极简结构重试'); await processGroup(group,`${label}.R`,true); return; }
      throw error;
    }
    for (const raw of parsed.items ?? []) {
      const source = group.find((item) => item.candidateId === raw.candidateId);
      if (source) cards.push({ ...raw, source });
    }
  }
  for(let i=0;i<candidates.length;i+=2) await processGroup(candidates.slice(i,i+2),`${Math.floor(i/2)+1}/${Math.ceil(candidates.length/2)}`);
  return cards;
}

const SYNTHESIS_SYSTEM = `你是热点综合研判器。比较全部临时包装后，只输出竞争修正，不直接计算最终总分。返回严格 JSON：{"items":[{"candidateId":字符串,"saturationPenalty":0到15,"audienceRelevance":0到5,"reason":字符串}],"metaNarratives":[字符串],"combination":{"primary":字符串,"stable":字符串,"darkHorse":字符串,"reason":字符串}}。S 是同类内容与角度饱和度（市场同类选题泛滥程度）。同一事件换主体、维度或标题重复出现时，必须提高后出现候选的饱和度并在 reason 点明重复对象；组合推荐不得同时选择实质相同的事件角度。风险标签不参与竞争分，但通知资格由下游硬门禁单独处理。reason不超过40个汉字，metaNarratives最多3条且每条不超过50字。不要输出JSON之外的文字。`;

export async function synthesize(gateway, store, cards, batchId, provider, onProgress, workspaceRoot) {
  const { prompt: synthesisSystem } = selectionPrompt({ workspaceRoot, skillName: 'hotspot-synthesis', fallback: SYNTHESIS_SYSTEM });
  onProgress('执行全局竞争、受众与重复扫描');
  const compact = cards.map((card) => ({ candidateId:card.candidateId, title:card.source.title, category:card.source.category,
    poolRole:card.source.poolRole, angle:card.angle, thesis:card.thesis, packaging:card.packaging, bScores:card.bScores,
    riskLevel:card.source.riskLevel }));
  const providerConfig=gateway.config.providers[provider||gateway.config.defaultProvider];
  for(let attempt=0;attempt<2;attempt+=1) {
    const result = await gateway.complete({ provider, purpose:'hotspot-synthesis-provisional', batchId, jsonMode:true,
      maxOutputTokens:Math.min(5000,providerConfig.maxOutputTokens), messages:[{role:'system',content:synthesisSystem,protected:true},
        {role:'user',content:`${attempt?'极简重试：reason缩短到20字。\n':''}${JSON.stringify(compact)}`,protected:true}] });
    try { return parseModelJson(result,store); }
    catch(error) { if(attempt) throw error; onProgress('综合复排输出被截断，切换极简结构重试'); }
  }
}

export function scoreCards(cards, synthesis, scoring = DEFAULT_SCORING) {
  const corrections = new Map((synthesis.items ?? []).map((item) => [item.candidateId,item]));
  const normalized = cards.filter((card) => card.status !== 'NO_ANGLE').map((card) => {
    const b = card.bScores ?? {}; const hp = card.hProfile ?? {}; const correction = corrections.get(card.candidateId) ?? {};
    const distribution = resolveDistributionDecision({ ...card.packaging, title:card.source?.title, angle:card.angle, thesis:card.thesis,
      evidenceBoundary:card.evidenceBoundary, materialGaps:card.packaging?.materialGaps, factSupport:b.factSupport,
      riskLevel:card.source?.riskLevel, riskReason:card.source?.riskReason }, scoring.notificationPolicy);
    const audience = correction.audienceRelevance == null ? clamp(b.audienceRelevance,0,5) : clamp(correction.audienceRelevance,0,5);
    const bParts = [clamp(b.angleUniqueness,0,5),clamp(b.emotionSpread,0,5),clamp(b.titleHook,0,5),audience,clamp(b.factSupport,0,5)];
    const B = bParts.reduce((s,n)=>s+n,0)*4;
    const H = clamp((scoring.hBase[hp.historicalType] ?? 10) + clamp(hp.fiveSenseCount,0,5)*2 + clamp(hp.fiveQuestionCount,0,5)*5 + clamp(hp.recommendationFit,0,10) + clamp(hp.emotionTheme,0,10) + clamp(hp.searchFriendly,0,5),0,100);
    const P = clamp((scoring.pBase[card.source.category] ?? 20) + (card.source.category === '🏢 大厂战略' ? card.source.credibleScoop/12*50 : 0),0,100);
    const S = clamp(correction.saturationPenalty,0,15); const D=0;
    const F = clamp(H*scoring.weights.h+B*scoring.weights.b+P*scoring.weights.p-S,0,100);
    const allowedSkills = new Set(['wechat-mp-tech-hotspot','wechat-mp-tech-deep','wechat-mp-deep-dive','wechat-mp-gossip-chill']);
    const fallbackSkill = card.source?.category === '🤖 AI/技术动态' ? 'wechat-mp-tech-hotspot' : 'wechat-mp-deep-dive';
    const recommendedSkill = allowedSkills.has(card.recommendedSkill) ? card.recommendedSkill : fallbackSkill;
    return { ...card, recommendedSkill, distributionLane:distribution.distributionLane, readerStake:distribution.readerStake,
      notificationFit:distribution.notificationFit, notificationEligible:distribution.notificationEligible,
      notificationBlockers:distribution.notificationBlockers,
      h:H, b:B, p:P, s:S, d:D, f:Number(F.toFixed(1)), bParts,
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
  const topicSection = dimensionGroups.length ? `\n## 维度候选\n\n| 维度 | 选题 | 维度分 | 风险 | 覆盖事件 | 代表报道 |\n|---|---|---:|---|---:|---|\n${dimensionGroups.map((t)=>`| ${DIMENSION_POOL_ROLES[t.dimension] || t.dimension} | ${t.title.replace(/\|/g,'/')} | ${t.score} | ${t.riskLevel} | ${t.events.length} | ${t.leads.map((x)=>x.replace(/\|/g,'/')).join('、')} |`).join('\n')}\n` : '';
  return `# 综合选题研判报告（临时排名，待编辑会确认）\n\n## 爆款总榜\n\n| # | 身份 | 分发池 | 分类 | 选题 | H | B | P | S | F | 等级 | 风险 |\n|---:|---|---|---|---|---:|---:|---:|---:|---:|:---:|---|\n${scored.map((c)=>`| ${c.finalRank} | ${c.source.poolRole} | ${c.distributionLane} | ${c.source.category} | ${c.source.title.replace(/\|/g,'/')} | ${c.h} | ${c.b} | ${c.p.toFixed(1)} | ${c.s} | ${c.f} | ${grade(c.f)} | ${c.source.riskLevel} |`).join('\n')}\n\n## 综合研判\n\n### 元叙事\n${(synthesis.metaNarratives||[]).map((x)=>`- ${x}`).join('\n') || '- 暂无明确跨题元叙事'}\n\n### 组合推荐\n- 主推：${synthesis.combination?.primary || '待定'}\n- 稳定：${synthesis.combination?.stable || '待定'}\n- 黑马：${synthesis.combination?.darkHorse || '待定'}\n- 理由：${synthesis.combination?.reason || ''}\n\n## 逐条评分\n\n${scored.map((c)=>`### #${c.finalRank} ${c.candidateId} · ${c.source.title}\n- H/B/P/S/F：${c.h}/${c.b}/${c.p.toFixed(1)}/${c.s}/${c.f}\n- 脑暴五项：${c.bParts.join('/')}\n- 核心角度：${c.angle}\n- 临时命题：${c.thesis}\n- 分发池：${c.distributionLane}\n- 读者利益：${c.readerStake || '待明确'}\n- 受众与竞争校正：${c.synthesisReason || '无额外校正'}\n- 合规风险：${c.source.riskLevel} ${c.source.riskReason || ''}\n- 推荐技能：${c.recommendedSkill || 'wechat-mp-deep-dive'}\n`).join('\n')}\n\n*评分公式：F = H×${pct(scoring.weights.h)} + B×${pct(scoring.weights.b)} + P×${pct(scoring.weights.p)} - S*\n${topicSection}`;
}

function overviewHtml(clusters) {
  const payload = clusters.map(({tags,representativeHotspotId,...event})=>event);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>热点全量事件聚类</title><style>body{font:14px/1.65 system-ui;background:#f4f0e6;color:#17201e;margin:0;padding:32px}main{max-width:1100px;margin:auto}h1{font:700 34px Georgia,serif}.note{border-left:5px solid #e44b3f;padding:12px;background:#fff}.event{background:#fff;border:1px solid #d8d0c0;margin:12px 0;padding:18px}.event b{color:#c53b31}.links a{display:block;color:#355f55;margin:4px 0}</style><main><h1>热点全量事件聚类</h1><p class="note">展示本批采集覆盖结构，不等于真实舆情热度或事实可信度。共 ${payload.reduce((s,e)=>s+e.report_count,0)} 条报道、${payload.length} 个事件。</p>${payload.sort((a,b)=>b.source_count-a.source_count||b.report_count-a.report_count).map((e)=>`<article class="event"><b>${e.source_count} 个来源 / ${e.report_count} 条报道</b><h2>${esc(e.representative_title)}</h2><p>${esc(e.topic_category)} · ${esc(e.market_scope)} · 国内相关度 ${e.china_relevance_score}/12</p><p>${esc(e.china_relevance_reason)}</p><div class="links">${e.articles.map((a)=>a.url?`<a href="${esc(a.url)}">${esc(a.source)} · ${esc(a.title)}</a>`:`<span>${esc(a.source)} · ${esc(a.title)}</span>`).join('')}</div></article>`).join('')}</main></html>`;
}

const EVENT_CARD_SYSTEM = `你是事件事实卡生成器。每个事件给你若干报道的标题、RSS 摘要、来源和发布时间。摘要只是 RSS 节选，不是完整正文。
为输入中的每个事件生成一张事件卡，严格区分：已确认事实（多来源一致或官方来源明确陈述）、来源增量（单一来源独有的信息）、分歧（来源之间的说法冲突）、待核内容（摘要不足以确认的信息）。
不得补写输入中没有的事实、数字、引语或时间。信息不足时对应字段留空数组，不要用流畅表述掩盖证据缺口。
返回严格 JSON：{"items":[{"event_id":"E1A2B3C4D5","conclusion":"一句话事件结论","background":"背景","confirmed_facts":[字符串],"source_increment":[{"source":字符串,"adds":字符串}],"disagreements":[字符串],"timeline":[{"time":字符串,"fact":字符串}],"unverified":[字符串],"angles":[字符串]}]}。
每个字符串不超过80个汉字；confirmed_facts 最多5条；timeline 最多5条；angles 最多3条。`;

function normalizeEventCard(raw) {
  const text = (value, max = 120) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const list = (value, max = 5) => (Array.isArray(value) ? value : []).map((item) => text(item)).filter(Boolean).slice(0, max);
  return {
    conclusion: text(raw.conclusion, 160),
    background: text(raw.background, 120),
    confirmed_facts: list(raw.confirmed_facts, 5),
    source_increment: (Array.isArray(raw.source_increment) ? raw.source_increment : []).map((item) => ({ source: text(item?.source, 40), adds: text(item?.adds, 120) })).filter((item) => item.source || item.adds).slice(0, 6),
    disagreements: list(raw.disagreements, 4),
    timeline: (Array.isArray(raw.timeline) ? raw.timeline : []).map((item) => ({ time: text(item?.time, 30), fact: text(item?.fact, 120) })).filter((item) => item.fact).slice(0, 5),
    unverified: list(raw.unverified, 4),
    angles: list(raw.angles, 3),
  };
}

export async function generateEventCards({ gateway, store, clusters, batchId, provider, workspaceRoot, onProgress = () => {} }) {
  const { prompt: eventCardSystem } = selectionPrompt({ workspaceRoot, skillName: 'event-card-generator', fallback: EVENT_CARD_SYSTEM });
  const providerConfig = gateway.config.providers[provider || gateway.config.defaultProvider];
  const cards = new Map();
  const failed = [];
  const chunkSize = Math.max(1, Math.min(6, Number(providerConfig.eventCardChunkSize) || 3));
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
      articles: event.articles.map((article) => ({ title: article.title, source: article.source, time: article.time, summary: article.summary || '' })),
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
      cards.set(event.event_id, normalizeEventCard(rawCard));
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
// regenerate=false 时只补生成缺失事件的事件卡；eventKey 变化导致 event_id 对不上时会整体重建。
export async function ensureBatchEventCards({ gateway, store, batchId, provider, workspaceRoot, maxAgeHours = 168, regenerate = false, eventIds = null, runId = null, onProgress = () => {} }) {
  const batch = store.getBatch(batchId); if (!batch) throw new Error('批次不存在');
  const workdir = batchTopicsDir(workspaceRoot, batch);
  const eventCardsPath = path.join(workdir, 'sources', 'event-cards.json');
  const eligible = batch.hotspots.filter(isResearchEligibleHotspot)
    .filter((item) => isFreshForBatch(item, batch.batch_date, maxAgeHours));
  const tagged = eligible.filter((item) => { const tags = tagsOf(item); return tags.eventKey && tags.preScores; });
  if (!tagged.length) return { generated: 0, cached: 0, total: 0, failed: [], path: eventCardsPath, clusters: [] };
  const skippedEventIds=new Set((store.listPipelineFailures?.(batchId,{statuses:['skipped'],stages:['event-card']})||[])
    .map((item)=>String(item.detail?.eventId||item.object_key.replace(/^event:/,''))));
  const clusters = clusterItems(tagged).filter((event)=>!skippedEventIds.has(event.event_id));
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
  for (const event of clusters) { const card = cachedCards.get(event.event_id); if (card) event.card = card; }
  const items = clusters.filter((event) => event.card).map((event) => ({ event_id: event.event_id, title: event.representative_title, ...normalizeEventCard(event.card) }));
  writeFile(eventCardsPath, JSON.stringify({ generated_at: new Date().toISOString(), total_events: clusters.length, failed, items }, null, 2));
  try {
    const stat = fs.statSync(eventCardsPath);
    store.upsertArtifact({ batchId, kind: '事件事实卡', name: 'event-cards.json', path: eventCardsPath, size: stat.size, modifiedAt: stat.mtime.toISOString() });
  } catch {}
  return { generated: missing.length, cached: clusters.length - missing.length, total: clusters.length, failed, path: eventCardsPath, clusters };
}

const GENERIC_WORDS_HOTWORD = new Set(['ai','公司','发布','消息','最新','回应','宣布','科技','行业','全球','技术','产品','平台','企业','市场','今日','新闻']);


export async function runResearchPipeline({ gateway, store, batchId, provider, workspaceRoot, maxAgeHours = 168, onProgress = () => {} }) {
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
  onProgress('生成全量语义事件聚类');
  const allClusters = clusterItems(eligibleHotspots);
  const skippedEventIds=new Set((store.listPipelineFailures?.(batchId,{statuses:['skipped'],stages:['event-card']})||[])
    .map((item)=>String(item.detail?.eventId||item.object_key.replace(/^event:/,''))));
  const skippedEvents=allClusters.filter((event)=>skippedEventIds.has(event.event_id));
  const skippedHotspotIds=new Set(skippedEvents.flatMap((event)=>event.articles||[]).map((item)=>Number(item.hotspot_id)).filter(Boolean));
  const researchHotspots=eligibleHotspots.filter((item)=>!skippedHotspotIds.has(item.id));
  const clusters = allClusters.filter((event)=>!skippedEventIds.has(event.event_id));
  if(!researchHotspots.length)throw new Error('所有有效事件均已跳过，当前批次没有可研判内容');
  if (clusters.reduce((sum,event)=>sum+event.report_count,0) !== researchHotspots.length) throw new Error('事件聚类门禁失败：报道数不守恒');
  if(skippedEvents.length)onProgress(`已按人工决策排除 ${skippedEvents.length} 个事件、${skippedHotspotIds.size} 条报道`);
  const phaseG = { generated_at:new Date().toISOString(), excluded_stale_count:staleCount,excluded_skipped_event_count:skippedEvents.length, items:researchHotspots.map((item)=>({category_id:`G${String(item.id).padStart(5,'0')}`, hotspot_id:item.id,title:item.title,source:item.source,url:item.url,published_at:item.published_at,topic_category:item.category,market_scope:item.market_scope,...tagsOf(item)})) };
  const clustersJson = { generated_at:new Date().toISOString(), total_articles:researchHotspots.length,excluded_stale_count:staleCount,excluded_skipped_event_count:skippedEvents.length,total_events:clusters.length,events:clusters.map(({tags,representativeHotspotId,...event})=>event) };
  writeFile(path.join(sourcesDir,'phase-G-output.json'),JSON.stringify(phaseG,null,2));
  writeFile(path.join(sourcesDir,'event-clusters.json'),JSON.stringify(clustersJson,null,2));
  writeFile(path.join(workdir,'hotspot-overview.html'),overviewHtml(clusters));
  onProgress('检查事件事实卡');
  const eventCardsPath = path.join(sourcesDir,'event-cards.json');
  const eventCardResult = await ensureBatchEventCards({gateway,store,batchId,provider,workspaceRoot,maxAgeHours,onProgress});
  const cardsByEvent = new Map((eventCardResult.clusters || []).map((event) => [event.event_id, event.card]));
  for (const event of clusters) { const card = cardsByEvent.get(event.event_id); if (card) event.card = card; }
  onProgress('执行全量预评估并按维度选择核心8条 + 黑马2条');
  const breaking=batch.batch_type==='breaking';
  if(breaking)onProgress('执行突发事件单题研判，不参与常规 8+2 竞争');
  const accountContext = getAccountContext();
  const scoring = resolveScoring(accountContext);
  const ranking = preselection(clusters, batch.batch_date, scoring);
  // 维度优先统一选题：who（含单事件主体）/ what / where 混排，账号契合加分来自 account-context.json
  const pool = breaking
    ? {selected:ranking.map((item)=>({...item,poolRole:'突发专题',eliminationReason:'',dimension:'event',events:null})),backup:[],groups:[]}
    : selectDimensionPool(clusters, ranking, { accountContext });
  const socialRanking = breaking ? [] : selectSocialCandidates(ranking, ranking.length, true).map((item,index)=>({...item,socialRank:index+1,selected:index<10&&item.eligible}));
  const socialPool = socialRanking.filter((item)=>item.selected);
  // 维度候选映射为脑暴输入（事件候选即单事件主体组，突发批次直接用事件排名条目）
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
    };
  });
  writeFile(path.join(sourcesDir,'preselection-ranking.json'),JSON.stringify({generated_at:new Date().toISOString(),items:ranking},null,2));
  writeFile(path.join(sourcesDir,'social-card-preselection.json'),JSON.stringify({generated_at:new Date().toISOString(),items:socialPool},null,2));
  writeFile(path.join(sourcesDir,'social-card-ranking.json'),JSON.stringify({generated_at:new Date().toISOString(),items:socialRanking},null,2));
  store.saveEliminationReasons(batchId,ranking);
  const cards = await brainstorm(gateway,store,breaking?pool.selected:dimensionEntries,account,batchId,provider,onProgress,workspaceRoot);
  if (!cards.length) throw new Error('探索脑暴没有返回有效候选');
  const synthesis = breaking
    ? {items:cards.map((card)=>({candidateId:card.candidateId,saturationPenalty:0,audienceRelevance:Number(card.bScores?.audienceRelevance||12),reason:'突发单题不参与批次竞争'})),metaNarratives:[],combination:{}}
    : await synthesize(gateway,store,cards,batchId,provider,onProgress,workspaceRoot);
  const scored = scoreCards(cards,synthesis,scoring);
  if (!scored.length) throw new Error('全部候选均为 NO_ANGLE，请检查标注或更换批次');
  // 成稿门槛前置：F 低于 55 的候选不进选题池（进池也过不了成稿门禁）；全灭时保留第 1 名兜底
  const DRAFT_FLOOR = 55;
  const draftable = breaking ? scored : scored.filter((item) => item.f >= DRAFT_FLOOR);
  const dropped = scored.length - draftable.length;
  if (dropped) onProgress(`${dropped} 个候选 F 低于成稿线 ${DRAFT_FLOOR}，未进入选题池`);
  if (!draftable.length) { draftable.push(scored[0]); onProgress('全部候选低于成稿线，保留最高分候选供参考'); }
  onProgress('写入临时总榜、编辑议题卡与选题池');
  writeFile(path.join(workdir,'editorial-agenda.md'),markdownAgenda(scored));
  writeFile(path.join(workdir,'topics-ranked.md'),markdownRanked(scored,synthesis,pool.selected.filter((group)=>group.events),scoring));
  store.saveAnalyzedCandidates(batchId,draftable.map((item)=>({hotspotId:item.source.hotspotId,
    hotspotIds:(item.source.articles||[]).map((article)=>article.hotspot_id).filter(Boolean),title:item.source.title,
    poolRole:item.source.poolRole,riskLevel:item.source.riskLevel,dimension:item.source.dimension || 'event',
    angle:item.angle,thesis:item.thesis,editorQuestion:item.editorQuestion,h:item.h,b:item.b,p:item.p,s:item.s,d:item.d,f:item.f,
    distributionLane:item.distributionLane,readerStake:item.readerStake,
    format:item.format || '',materialType:item.materialType || '',historicalType:item.hProfile?.historicalType || ''})));
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
    if (pool.selected.length) onProgress(`已生成 ${pool.selected.length} 个维度候选：${pool.selected.map((group) => `${group.poolRole}·${group.title}`).join('、')}`);
  }
  const artifacts = [
    ['账号上下文快照','account-context-snapshot.md',snapshotPath],['Phase G 语义标注','phase-G-output.json',path.join(sourcesDir,'phase-G-output.json')],
    ['全量事件聚类','event-clusters.json',path.join(sourcesDir,'event-clusters.json')],['事件事实卡','event-cards.json',eventCardsPath],
    ['全量预选排名','preselection-ranking.json',path.join(sourcesDir,'preselection-ranking.json')],
    ['图文预选排名','social-card-preselection.json',path.join(sourcesDir,'social-card-preselection.json')],
    ['热点全景','hotspot-overview.html',path.join(workdir,'hotspot-overview.html')],['编辑议题卡','editorial-agenda.md',path.join(workdir,'editorial-agenda.md')],
    ['临时选题总榜','topics-ranked.md',path.join(workdir,'topics-ranked.md')],
  ];
  for (const [kind,name,file] of artifacts) { const stat=fs.statSync(file); store.upsertArtifact({batchId,kind,name,path:file,size:stat.size,modifiedAt:stat.mtime.toISOString()}); }
  store.updateBatch(batchId,{stage:'editorial',status:'review'});
  onProgress(`热点研判完成：${clusters.length} 个事件，${scored.length} 条编辑候选`);
  return { articles:eligibleHotspots.length, excludedStale:staleCount, events:clusters.length, selected:scored.length, top:scored.slice(0,3).map((x)=>({candidateId:x.candidateId,title:x.source.title,f:x.f})) };
}
