import { socialRouteForContentClass } from '../../social-cards/domain/social-routing.mjs';
const CONTENT_CLASSES = new Set(['github_project', 'open_source_technology', 'open_source_trend', 'news_event']);

export const G_SOCIAL_WEIGHTS = Object.freeze({
  factSupport: 0.25,
  visualPotential: 0.20,
  readerValue: 0.20,
  contentClarity: 0.20,
  productionReadiness: 0.15,
});

export const G_SOCIAL_THRESHOLDS = Object.freeze({ candidate: 55, auto: 70 });
export const G_SOCIAL_CLASS_CAPS = Object.freeze({ github_project: 6 });

const DEMONSTRABLE_PATTERN = /工具|教程|学习资源|框架|跨平台|开发者|开发|临时邮箱|隐私|窗口管理器|代码审查|架构图|音频处理|文件传输|监控|skill|workflow|framework|library|plugin|server|cli|agent/i;
const TECHNICAL_EVIDENCE_PATTERN = /机制|架构|原理|性能|基准|benchmark|兼容|协议|标准|实现|技术栈|模型结构|technical_mechanism|architecture|benchmark|performance/i;
const TREND_SIGNAL_PATTERN = /采用|迁移|生态|竞争|标准|政策|规范|趋势|增长|发布|合作|集成|adoption|migration|ecosystem|standard|policy|trend/i;

function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : 0));
}

function round(value) { return Number(clamp(value).toFixed(1)); }

function textOf(values) {
  return values.flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => value != null && String(value).trim())
    .map((value) => String(value).trim())
    .join(' ');
}

function articlesOf(item) { return Array.isArray(item?.articles) ? item.articles : []; }

function sourceCountOf(item) {
  const sources = new Set(articlesOf(item).map((article) => article?.source || article?.channel || article?.url).filter(Boolean));
  return Math.max(Number(item?.sourceCount || item?.source_count || 0), sources.size);
}

function articleCountOf(item) { return Math.max(articlesOf(item).length, Number(item?.reportCount || item?.report_count || 0)); }

function evidenceOf(item) {
  return Array.isArray(item?.classificationEvidence)
    ? item.classificationEvidence
    : Array.isArray(item?.classification_evidence) ? item.classification_evidence : [];
}

function evidenceTextOf(item) {
  return textOf(evidenceOf(item).map((evidence) => [evidence?.role, evidence?.claim, evidence?.source_id]));
}

function cardCountOf(item, key) {
  const direct = Number(item?.[key]);
  if (Number.isFinite(direct)) return Math.max(0, direct);
  const cardKey = { confirmedFactCount: 'confirmed_facts', timelineCount: 'timeline', disagreementCount: 'disagreements', unverifiedCount: 'unverified' }[key];
  return Array.isArray(item?.card?.[cardKey]) ? item.card[cardKey].length : 0;
}

function uniqueTimeCount(item) {
  const values = articlesOf(item).map((article) => String(article?.time || '').slice(0, 10)).filter(Boolean);
  return new Set(values).size + Math.max(0, cardCountOf(item, 'timelineCount') - values.length);
}

function normalizeContentClass(item) {
  const value = String(item?.contentClass || item?.content_class || '').trim();
  if (CONTENT_CLASSES.has(value)) return value;
  const repository = item?.repositoryMeta;
  const github = articlesOf(item).some((article) => /github\.com\//i.test(String(article?.url || '')));
  return repository || github ? 'github_project' : 'news_event';
}

function repositorySignals(item, text) {
  const repository = item?.repositoryMeta || {};
  const topics = Array.isArray(repository.topics) ? repository.topics : [];
  const demonstrable = DEMONSTRABLE_PATTERN.test(text);
  const hasDescription = Boolean(String(repository.description || '').trim());
  const hasSource = Boolean(articlesOf(item)[0]?.url || item.sourceUrl);
  return {
    factSupport: clamp(30 + (hasDescription ? 22 : 0) + (topics.length ? 10 : 0) + (hasSource ? 16 : 0) + (Number(repository.stars) > 0 ? 10 : 0)),
    visualPotential: clamp(28 + (demonstrable ? 32 : 0) + Math.min(20, topics.length * 4) + (repository.language ? 8 : 0)),
    productionReadiness: clamp(25 + (hasDescription ? 20 : 0) + (repository.language ? 10 : 0) + (topics.length ? 10 : 0) + (repository.createdAt ? 10 : 0) + (Number(repository.stars) > 0 ? 10 : 0) + (hasSource ? 10 : 0)),
  };
}

function eventSignals(item, text, sourceCount, articleCount) {
  const confirmedFacts = cardCountOf(item, 'confirmedFactCount');
  const timeline = cardCountOf(item, 'timelineCount');
  const disagreements = cardCountOf(item, 'disagreementCount');
  return {
    factSupport: clamp(10 + confirmedFacts * 12 + Math.min(30, sourceCount * 14) + Math.min(15, articleCount * 4)),
    visualPotential: clamp(18 + Math.min(35, timeline * 14) + Math.min(20, disagreements * 10) + (TREND_SIGNAL_PATTERN.test(text) ? 10 : 0)),
    productionReadiness: clamp(18 + Math.min(35, confirmedFacts * 12) + Math.min(25, sourceCount * 12) + Math.min(15, timeline * 8)),
  };
}

function technologySignals(item, text, sourceCount) {
  const evidenceText = evidenceTextOf(item);
  const technicalEvidence = TECHNICAL_EVIDENCE_PATTERN.test(`${text} ${evidenceText}`);
  const architectureEvidence = /架构|原理|机制|architecture|technical_mechanism/i.test(`${text} ${evidenceText}`);
  const benchmarkEvidence = /性能|基准|benchmark|performance/i.test(`${text} ${evidenceText}`);
  return {
    technicalEvidence,
    factSupport: clamp(12 + (technicalEvidence ? 38 : 0) + (architectureEvidence ? 20 : 0) + (benchmarkEvidence ? 15 : 0) + Math.min(15, sourceCount * 7)),
    visualPotential: clamp(20 + (architectureEvidence ? 28 : 0) + (benchmarkEvidence ? 20 : 0) + (technicalEvidence ? 18 : 0)),
    productionReadiness: clamp(15 + (technicalEvidence ? 35 : 0) + (architectureEvidence ? 22 : 0) + (benchmarkEvidence ? 13 : 0) + Math.min(15, sourceCount * 7)),
  };
}

function trendSignals(item, text, sourceCount) {
  const evidenceText = evidenceTextOf(item);
  const combined = `${text} ${evidenceText}`;
  const signal = TREND_SIGNAL_PATTERN.test(combined);
  const actorCount = Number(item?.actorCount || item?.actor_count || 0);
  const timeCount = Math.max(Number(item?.timeSignalCount || item?.time_signal_count || 0), uniqueTimeCount(item));
  return {
    signal,
    actorCount,
    timeCount,
    factSupport: clamp(8 + Math.min(35, sourceCount * 16) + Math.min(22, actorCount * 11) + (signal ? 20 : 0) + Math.min(15, timeCount * 8)),
    visualPotential: clamp(15 + Math.min(25, actorCount * 12) + Math.min(25, timeCount * 12) + (signal ? 20 : 0)),
    productionReadiness: clamp(12 + Math.min(35, sourceCount * 16) + Math.min(20, actorCount * 10) + Math.min(20, timeCount * 10) + (signal ? 13 : 0)),
  };
}

function commonSignals(item, text, sourceCount, articleCount) {
  const china = clamp(Number(item?.chinaRelevance || item?.china_relevance_score || 0) / 12 * 60);
  const audience = clamp(Number(item?.preScores?.audience || 0) / 20 * 40);
  const readerValue = clamp(china + audience);
  const keywords = Array.isArray(item?.keywords) ? item.keywords.length : 0;
  const hasTitle = Boolean(String(item?.title || '').trim());
  const hasSummary = articlesOf(item).some((article) => String(article?.summary || '').trim());
  const clarity = clamp((hasTitle ? 25 : 0) + Math.min(25, keywords * 5) + (hasSummary ? 18 : 0) + (sourceCount ? 12 : 0) + (articleCount > 1 ? 10 : 0) + (text.length > 80 ? 10 : 0));
  return { readerValue, contentClarity: clarity };
}

function qualificationFor(item, contentClass, signals) {
  const sourceCount = sourceCountOf(item);
  const articleCount = articleCountOf(item);
  if (item?.riskLevel === '高') return { status: 'blocked', reason: '风险等级为高', candidateEligible: false, autoEligible: false };
  if (contentClass === 'github_project') {
    const repository = item?.repositoryMeta || {};
    const text = textOf([item?.title, item?.chinaRelevanceReason, repository.description, repository.language, repository.topics, repository.discoveryChannels]);
    if (!DEMONSTRABLE_PATTERN.test(text)) return { status: 'type_gate_blocked', reason: '项目缺少可演示的工具或使用场景证据', candidateEligible: false, autoEligible: false };
  }
  if (contentClass === 'news_event' && (signals.confirmedFacts < 1 || sourceCount < 1)) {
    return { status: 'type_gate_blocked', reason: '普通事件缺少已确认事实或来源证据', candidateEligible: false, autoEligible: false };
  }
  if (contentClass === 'open_source_technology' && !signals.technicalEvidence) {
    return { status: 'type_gate_blocked', reason: '开源技术缺少机制、架构或性能证据', candidateEligible: false, autoEligible: false };
  }
  if (contentClass === 'open_source_trend' && (sourceCount < 2 || (!signals.signal && signals.actorCount < 2 && signals.timeCount < 2))) {
    return { status: 'type_gate_blocked', reason: '开源趋势缺少多来源、多主体或跨时间变化信号', candidateEligible: false, autoEligible: false };
  }
  const candidateEligible = signals.gSocial >= G_SOCIAL_THRESHOLDS.candidate;
  const autoEligible = signals.gSocial >= G_SOCIAL_THRESHOLDS.auto;
  if (autoEligible) return { status: 'auto_eligible', reason: '通过类型门禁和自动图文线', candidateEligible, autoEligible };
  if (candidateEligible) return { status: 'candidate', reason: `G_social ${signals.gSocial}，达到候选线但未达到自动图文线 ${G_SOCIAL_THRESHOLDS.auto}`, candidateEligible, autoEligible };
  return { status: 'below_threshold', reason: `G_social ${signals.gSocial}，低于候选线 ${G_SOCIAL_THRESHOLDS.candidate}`, candidateEligible, autoEligible };
}

export function scoreSocialCandidate(item) {
  const contentClass = normalizeContentClass(item);
  const repository = item?.repositoryMeta || {};
  const text = textOf([item?.title, item?.chinaRelevanceReason, item?.keywords, item?.articles?.map((article) => [article?.title, article?.summary, article?.source]), repository.description, repository.language, repository.topics, repository.discoveryChannels, evidenceTextOf(item)]);
  const sourceCount = sourceCountOf(item);
  const articleCount = articleCountOf(item);
  const common = commonSignals(item, text, sourceCount, articleCount);
  const typeSignals = contentClass === 'github_project'
    ? repositorySignals(item, text)
    : contentClass === 'open_source_technology'
      ? technologySignals(item, text, sourceCount)
      : contentClass === 'open_source_trend'
        ? trendSignals(item, text, sourceCount)
        : eventSignals(item, text, sourceCount, articleCount);
  const dimensions = {
    factSupport: round(typeSignals.factSupport),
    visualPotential: round(typeSignals.visualPotential),
    readerValue: round(common.readerValue),
    contentClarity: round(common.contentClarity),
    productionReadiness: round(typeSignals.productionReadiness),
  };
  const saturationPenalty = clamp(Number(item?.saturationPenalty || 0), 0, 10);
  const riskPenalty = item?.riskLevel === '较高' ? 12 : item?.riskLevel === '中' ? 5 : 0;
  const missingEvidencePenalty = contentClass === 'open_source_technology' && !typeSignals.technicalEvidence ? 15
    : contentClass === 'open_source_trend' && !typeSignals.signal ? 10 : 0;
  const penalties = { saturationPenalty: round(saturationPenalty), riskPenalty: round(riskPenalty), missingEvidencePenalty: round(missingEvidencePenalty) };
  const weighted = Object.entries(G_SOCIAL_WEIGHTS).reduce((sum, [key, weight]) => sum + dimensions[key] * weight, 0);
  const gSocial = round(weighted - saturationPenalty - riskPenalty - missingEvidencePenalty);
  const signals = { ...dimensions, ...penalties, gSocial, confirmedFacts: cardCountOf(item, 'confirmedFactCount'), technicalEvidence: Boolean(typeSignals.technicalEvidence), signal: Boolean(typeSignals.signal), actorCount: Number(typeSignals.actorCount || 0), timeCount: Number(typeSignals.timeCount || uniqueTimeCount(item)), sourceCount, articleCount };
  const qualification = qualificationFor(item, contentClass, { ...signals, gSocial });
  const repositoryText = textOf([item?.title, repository.description, repository.language, repository.topics, repository.discoveryChannels]);
  const trending = /github\s*trending/i.test(repositoryText) || repository?.discoveryChannels?.includes('trending');
  const demonstrable = DEMONSTRABLE_PATTERN.test(repositoryText);
  const reasons = [
    contentClass === 'github_project' ? 'GitHub 项目' : contentClass === 'open_source_technology' ? '开源技术' : contentClass === 'open_source_trend' ? '开源趋势' : '普通事件',
    signals.technicalEvidence ? '有技术证据' : null,
    signals.signal ? '有趋势信号' : null,
    sourceCount > 1 ? `${sourceCount} 个独立来源` : null,
    trending ? 'Trending' : null,
    repository?.discoveryChannels?.includes('search') ? '近期增长发现' : null,
    repository?.discoveryChannels?.includes('mentioned') ? '热点提及' : null,
    Number(repository?.stars) >= 1000 ? `${repository.stars} Stars` : null,
    demonstrable ? '可演示工具' : null,
  ].filter(Boolean);
  return {
    contentClass,
    ...socialRouteForContentClass(contentClass),
    gSocial,
    socialScore: gSocial,
    socialScoreDetails: { ...dimensions, ...penalties, finalScore: gSocial, scoreStage: 'discovery', scoreModel: 'g_social-v1', weights: G_SOCIAL_WEIGHTS,
      contentClass, qualificationStatus: qualification.status, qualificationReason: qualification.reason,
      candidateEligible: qualification.candidateEligible, autoEligible: qualification.autoEligible },
    qualificationStatus: qualification.status,
    qualificationReason: qualification.reason,
    candidateEligible: qualification.candidateEligible,
    autoEligible: qualification.autoEligible,
    eligible: qualification.autoEligible,
    rejectionReason: qualification.reason,
    reasons,
  };
}

export function selectSocialPool(ranking, limit = 10, classCaps = G_SOCIAL_CLASS_CAPS) {
  const selected = [];
  const counts = new Map();
  for (const item of Array.isArray(ranking) ? ranking : []) {
    if (!item?.autoEligible && !item?.eligible) continue;
    const contentClass = String(item.contentClass || 'news_event');
    const cap = classCaps && Number.isFinite(Number(classCaps[contentClass])) ? Number(classCaps[contentClass]) : Infinity;
    const count = counts.get(contentClass) || 0;
    if (count >= cap) continue;
    selected.push(item);
    counts.set(contentClass, count + 1);
    if (selected.length >= Math.max(1, Number(limit) || 10)) break;
  }
  return selected;
}

export function selectSocialCandidates(ranking, limit = 10, includeBelowThreshold = false) {
  const scored = (Array.isArray(ranking) ? ranking : []).map((item) => ({ ...item, ...scoreSocialCandidate(item) }));
  const filtered = includeBelowThreshold ? scored : scored.filter((item) => item.candidateEligible);
  return filtered
    .sort((a, b) => b.gSocial - a.gSocial || (b.finalPreScore || 0) - (a.finalPreScore || 0) || String(a.title || '').localeCompare(String(b.title || '')))
    .slice(0, Math.max(1, Number(limit) || 10));
}
