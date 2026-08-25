const PROJECT_SIGNAL = /github|开源|仓库|开源项目|工具项目|开发工具|工具|项目|插件|框架|sdk\b|cli\b|agent\s*skills?/i;
const PURE_PROJECT_HISTORICAL_TYPES = new Set(['github_tool']);
const CONTENT_CLASSES = new Set(['github_project', 'open_source_technology', 'open_source_trend', 'news_event']);
const CLASSIFICATION_STATUSES = new Set(['auto', 'model_validated', 'needs_review', 'manual']);
const TECHNICAL_SIGNAL = /架构|原理|机制|技术文档|技术报告|论文|benchmark|基准|性能|兼容|部署|源码|实现|api|sdk|cli/i;
const TREND_SIGNAL = /采用|迁移|生态|兼容|竞争|标准|政策|治理|社区|趋势|增长|多家|多个|厂商|组织|开发者|产业/i;

function textOf(value) {
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(textOf).filter(Boolean).join(' ');
  return String(value ?? '').trim();
}

function sourceIdOf(article, index) {
  return String(article?.source_id || article?.sourceId || (article?.hotspot_id != null ? `hotspot:${article.hotspot_id}` : `source:${index + 1}`));
}

function sourceClassOf(article) {
  const url = String(article?.url || '').toLowerCase();
  const text = textOf([article?.title, article?.source, article?.channel]);
  if (/github\.com\//i.test(url) || /github|仓库|repository/i.test(text)) return 'github_repository';
  if (/benchmark|基准|性能测试/i.test(text)) return 'benchmark';
  if (/论文|paper|arxiv/i.test(text)) return 'technical_paper';
  if (/文档|docs?|架构|技术/i.test(text)) return 'official_docs';
  if (/公告|发布|官方|company|announcement/i.test(text)) return 'company_announcement';
  if (/政策|标准|监管/i.test(text)) return 'policy_or_standard';
  return 'media_report';
}

function distinctNonEmpty(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

export function deriveClassificationFeatures(event = {}) {
  const articles = Array.isArray(event.articles) ? event.articles : [];
  const articleText = textOf(articles.map((article) => [article?.title, article?.summary, article?.source, article?.channel]));
  const eventText = textOf([event.representative_title, event.title, event.keywords, event.tags?.eventParts, event.eventParts]);
  const allText = `${eventText} ${articleText}`;
  const sourceClasses = articles.map(sourceClassOf);
  const sourceEvidence = articles.map((article, index) => ({
    sourceId: sourceIdOf(article, index),
    sourceClass: sourceClasses[index],
    source: String(article?.source || article?.channel || '').trim(),
    title: String(article?.title || '').trim().slice(0, 120),
    status: String(article?.source_status || article?.status || 'ok'),
  }));
  const independentSources = distinctNonEmpty(articles.map((article) => article?.source || article?.channel || article?.url));
  const projectUrls = distinctNonEmpty(articles.map((article) => {
    const match = String(article?.url || '').match(/^https?:\/\/github\.com\/([^/?#]+\/[^/?#]+)/i);
    return match?.[1]?.toLowerCase();
  }));
  const subjects = distinctNonEmpty([
    event.normalized?.whoKey,
    event.tags?.eventParts?.who,
    event.eventParts?.who,
    ...articles.map((article) => article?.source),
  ]);
  const hasGithubRepository = sourceClasses.includes('github_repository')
    || articles.some((article) => /github\.com\//i.test(String(article?.url || '')));
  const hasTechnicalDocs = sourceClasses.some((value) => ['official_docs', 'technical_paper', 'benchmark'].includes(value)) || TECHNICAL_SIGNAL.test(allText);
  const hasAdoptionSignal = /采用|迁移|落地|接入|使用|集成|adopt|migration/i.test(allText);
  const hasCompatibilitySignal = /兼容|适配|替代|互操作|compatible|interoperab/i.test(allText);
  const hasPolicyOrStandardSignal = /政策|标准|规范|监管|治理|policy|standard/i.test(allText);
  const hasTimeline = distinctNonEmpty(articles.map((article) => article?.time || article?.published_at)).length > 1
    || Boolean(event.first_seen_at && event.last_seen_at && event.first_seen_at !== event.last_seen_at);
  const hasTrendSignal = TREND_SIGNAL.test(allText) || hasAdoptionSignal || hasCompatibilitySignal || hasPolicyOrStandardSignal;
  const projectSignal = hasGithubRepository || PROJECT_SIGNAL.test(eventText);
  return {
    hasGithubRepository,
    repositoryCount: projectUrls.length || (hasGithubRepository ? 1 : 0),
    projectCount: projectUrls.length || (projectSignal ? 1 : 0),
    independentSourceCount: independentSources.length,
    subjectCount: subjects.length,
    hasTimeline,
    hasTechnicalDocs,
    hasPaper: sourceClasses.includes('technical_paper'),
    hasBenchmark: sourceClasses.includes('benchmark'),
    hasRelease: /release|版本|更新|发布/i.test(allText),
    hasAdoptionSignal,
    hasMigrationSignal: /迁移|migration/i.test(allText),
    hasCompatibilitySignal,
    hasPolicyOrStandardSignal,
    hasTrendSignal,
    sourceEvidence,
  };
}

function boundedText(value, max = 180) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizedEvidence(value, validSourceIds) {
  const evidence = Array.isArray(value) ? value : [];
  return evidence.map((item) => {
    const sourceId = String(item?.sourceId ?? item?.source_id ?? '').trim();
    return { sourceId, role: boundedText(item?.role, 40), claim: boundedText(item?.claim, 180) };
  }).filter((item) => validSourceIds.has(item.sourceId) && item.role && item.claim).slice(0, 8);
}

function fallbackClassification(event, features, reason = '') {
  const project = features.hasGithubRepository || (features.projectCount > 0 && !features.hasTechnicalDocs && !features.hasTrendSignal);
  if (project) {
    return {
      contentClass: 'github_project', confidence: features.hasGithubRepository ? 0.96 : 0.78, status: 'auto',
      reason: reason || '当前事件主要由具体项目或仓库资料构成，尚未形成技术机制或生态变化证据',
      evidence: features.sourceEvidence.slice(0, 4).map((source) => ({ sourceId: source.sourceId, role: 'project_signal', claim: source.title || '项目来源' })),
      articleEligibilityReason: '纯项目默认适合图文拆解，不自动进入文章路线',
      missingEvidence: ['技术机制或架构证据', '多主体/多来源的生态变化证据'],
      articleEligible: false, socialEligible: true, defaultRoute: 'social_cards',
    };
  }
  return {
    contentClass: 'news_event', confidence: 0.35, status: 'needs_review',
    reason: reason || '暂未识别到足以升级为开源技术或开源趋势的证据', evidence: [],
    articleEligibilityReason: '按普通事件进入文章路线；如要升级为开源技术或趋势，仍需补充分类证据',
    missingEvidence: ['更明确的内容类型证据'],
    articleEligible: true, socialEligible: true, defaultRoute: 'article',
  };
}

export function normalizeEventClassification(raw = {}, { event = {}, features = deriveClassificationFeatures(event) } = {}) {
  const input = raw?.classification && typeof raw.classification === 'object' ? raw.classification : raw;
  const validSourceIds = new Set(features.sourceEvidence.map((source) => source.sourceId));
  let contentClass = String(input?.contentClass ?? input?.content_class ?? '').trim();
  const modelEvidence = normalizedEvidence(input?.evidence, validSourceIds);
  const fallback = fallbackClassification(event, features);
  if (!CONTENT_CLASSES.has(contentClass)) return { ...fallback, features };

  let status = CLASSIFICATION_STATUSES.has(String(input?.status ?? input?.classificationStatus ?? '').trim())
    ? String(input.status ?? input.classificationStatus).trim() : 'model_validated';
  let reason = boundedText(input?.reason || fallback.reason, 220);
  let missingEvidence = Array.isArray(input?.missingEvidence || input?.missing_evidence)
    ? (input.missingEvidence || input.missing_evidence).map((value) => boundedText(value, 100)).filter(Boolean).slice(0, 6) : [];
  const confidence = Math.min(1, Math.max(0, Number.isFinite(Number(input?.confidence)) ? Number(input.confidence) : 0.5));
  const onlyProjectSources = features.hasGithubRepository
    && features.sourceEvidence.length > 0
    && features.sourceEvidence.every((source) => source.sourceClass === 'github_repository');
  const hasExternalUpgradeEvidence = features.sourceEvidence.some((source) => source.sourceClass !== 'github_repository');
  // GitHub Search/Trending 的 README 描述可以提供项目事实，但不能仅凭一条项目来源
  // 把仓库介绍升级成文章级的开源技术。必须有外部技术证据或生态/采用信号。
  if (['open_source_technology', 'open_source_trend'].includes(contentClass)
    && onlyProjectSources && !hasExternalUpgradeEvidence) {
    contentClass = 'github_project';
    status = 'auto';
    reason = '当前只有 GitHub 项目来源，README 自述的标准、兼容或采用信号不能替代外部证据，按纯项目处理';
    missingEvidence = distinctNonEmpty([...missingEvidence, '外部技术证据或生态影响证据']);
  }
  if (contentClass === 'github_project' && !features.hasGithubRepository && !features.projectCount) {
    contentClass = 'news_event';
    status = 'needs_review';
    reason = '模型标记为项目，但输入中未发现可核验的项目或仓库证据';
    missingEvidence = ['项目或仓库来源'];
  }
  if (contentClass === 'open_source_technology' && !features.hasTechnicalDocs && modelEvidence.every((item) => !['technical_mechanism', 'performance_evidence'].includes(item.role))) {
    contentClass = features.hasGithubRepository ? 'github_project' : 'news_event';
    status = 'needs_review';
    reason = '缺少技术机制、架构、论文或基准测试证据，不能自动归为开源技术';
    missingEvidence = distinctNonEmpty([...missingEvidence, '技术机制/架构/性能证据']);
  }
  if (contentClass === 'open_source_trend' && features.independentSourceCount < 2 && features.subjectCount < 2
    && !features.hasAdoptionSignal && !features.hasCompatibilitySignal && !features.hasPolicyOrStandardSignal && !features.hasTimeline) {
    status = 'needs_review';
    reason = '趋势证据不足，尚未证明存在多来源、多主体或生态变化';
    missingEvidence = distinctNonEmpty([...missingEvidence, '多来源、多主体或跨时间生态变化证据']);
  }
  if (contentClass === 'github_project' && status === 'model_validated') status = 'auto';
  // needs_review 表示“分类升级证据不足”，不等于普通事件不能写文章。
  // 只有纯项目是默认 social_only；文章事实门禁仍会在成稿前拦截证据不足的候选。
  const articleEligible = contentClass !== 'github_project';
  return {
    contentClass,
    confidence,
    status,
    reason,
    evidence: modelEvidence.length ? modelEvidence : (contentClass === 'github_project' ? fallback.evidence : []),
    articleEligibilityReason: boundedText(input?.articleEligibilityReason || input?.article_eligibility_reason || (articleEligible ? '具备文章路线资格，仍需通过编辑和事实门禁' : '纯项目或证据不足，不自动进入文章路线'), 220),
    missingEvidence,
    articleEligible,
    socialEligible: true,
    defaultRoute: contentClass === 'github_project' ? 'social_cards' : 'article',
    features,
  };
}

export function isPureProjectEvent(event) {
  if (!event || typeof event !== 'object') return false;
  const articles = Array.isArray(event.articles) ? event.articles : [];
  const hasGithub = Boolean(event.repositoryMeta)
    || articles.some((article) => /^https:\/\/github\.com\//i.test(String(article?.url || '')));
  const text = textOf([
    event.representative_title,
    event.title,
    event.keywords,
    event.tags?.eventParts,
    event.eventParts,
  ]);
  return hasGithub || PROJECT_SIGNAL.test(text);
}

export function classifyContentRoute(card = {}, { event = null, requestedRoute = '' } = {}) {
  const classified = card.contentClass || card.content_class || card.source?.contentClass || card.source?.content_class;
  if (CONTENT_CLASSES.has(String(classified || '').trim())) {
    const contentClass = String(classified).trim();
    const articleEligible = contentClass !== 'github_project'
      && card.articleEligible !== false && card.article_eligible !== false
      && card.source?.articleEligible !== false && card.source?.article_eligible !== false;
    return {
      contentRoute: contentClass === 'github_project' ? 'social_only' : (articleEligible ? 'article' : 'editorial_review'),
      articleEligible,
      pureProject: contentClass === 'github_project',
      warning: contentClass === 'github_project' ? '纯项目默认进入图文池；如要写文章需人工晋级分类' : (articleEligible ? '' : '分类证据不足，暂不能进入文章路线'),
    };
  }
  const format = String(card.format || '').trim();
  const historicalType = String(card.hProfile?.historicalType || card.historicalType || '').trim();
  const materialType = String(card.materialType || '').trim();
  const pureProject = format === '贴图'
    || PURE_PROJECT_HISTORICAL_TYPES.has(historicalType)
    || PROJECT_SIGNAL.test(materialType)
    || isPureProjectEvent(event);
  if (pureProject) {
    return {
      contentRoute: requestedRoute === 'article' ? 'manual_review' : 'social_only',
      articleEligible: requestedRoute === 'article',
      pureProject: true,
      warning: requestedRoute === 'article' ? '纯项目候选已人工申请文章路线，需补充方法论或实践证据' : '纯项目默认进入图文池；如要写文章需人工补充方法论或实践证据',
    };
  }
  return { contentRoute: 'article', articleEligible: true, pureProject: false, warning: '' };
}

export function scoreStatusForCard(card = {}) {
  const source = card.source || {};
  const rawEventValue = source.eventValue ?? source.t ?? source.eventHeatScore;
  const hasEventValue = rawEventValue !== null && rawEventValue !== undefined && Number.isFinite(Number(rawEventValue));
  if (source.scoreStatus === 'needs_source_data' || source.composite && !hasEventValue) {
    return { scoreStatus: 'needs_source_data', scoreWarning: source.scoreWarning || '缺少事件价值 T 或可核验事实，暂不生成正式 F 分' };
  }
  return { scoreStatus: 'ready', scoreWarning: '' };
}

export { CONTENT_CLASSES, CLASSIFICATION_STATUSES, PURE_PROJECT_HISTORICAL_TYPES };
