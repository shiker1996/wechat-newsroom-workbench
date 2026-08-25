const PROJECT_SIGNAL = /github|开源|仓库|开源项目|工具项目|开发工具|工具|项目|插件|框架|sdk\b|cli\b|agent\s*skills?/i;
const PURE_PROJECT_HISTORICAL_TYPES = new Set(['github_tool']);

function textOf(value) {
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(textOf).filter(Boolean).join(' ');
  return String(value ?? '').trim();
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

export { PURE_PROJECT_HISTORICAL_TYPES };
