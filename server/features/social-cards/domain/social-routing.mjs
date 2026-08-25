const CONTENT_CLASS_ROUTE_TABLE = Object.freeze({
  github_project: { contentType: 'repository', storyboardSkill: 'repository-card-storyboard', poolRole: 'AI 工具图文预选', labels: { wechat: '工具图文', xiaohongshu: '工具图文' } },
  news_event: { contentType: 'event', storyboardSkill: 'event-card-storyboard', poolRole: 'AI 事件图文预选', labels: { wechat: '事件图文', xiaohongshu: '事件图文' } },
  open_source_technology: { contentType: 'event', storyboardClass: 'technology', storyboardSkill: 'open-source-technology-storyboard', poolRole: 'AI 事件图文预选', labels: { wechat: '事件图文 · 开源技术', xiaohongshu: '事件图文 · 开源技术' } },
  open_source_trend: { contentType: 'event', storyboardClass: 'trend', storyboardSkill: 'open-source-trend-storyboard', poolRole: 'AI 事件图文预选', labels: { wechat: '事件图文 · 开源趋势', xiaohongshu: '事件图文 · 开源趋势' } },
});

export const SOCIAL_ROUTE_VERSION = 'social-route-v2';
// technology/trend 保留在读取兼容层，但不再作为顶层生产类型。
export const SOCIAL_CONTENT_TYPES = Object.freeze(['repository', 'event', 'technology', 'trend', 'custom']);

export function normalizeSocialContentClass(value) {
  const normalized = String(value || '').trim();
  return Object.hasOwn(CONTENT_CLASS_ROUTE_TABLE, normalized) ? normalized : 'news_event';
}

export function socialRouteForContentClass(contentClass, channel = 'wechat') {
  const normalizedClass = normalizeSocialContentClass(contentClass);
  const normalizedChannel = channel === 'xiaohongshu' ? 'xiaohongshu' : 'wechat';
  const route = CONTENT_CLASS_ROUTE_TABLE[normalizedClass];
  return Object.freeze({
    contentClass: normalizedClass,
    contentType: route.contentType,
    outputMode: `${normalizedChannel}-${route.contentType === 'repository' ? 'tool' : route.contentType === 'custom' ? 'custom' : 'event'}-cards`,
    storyboardSkill: route.storyboardSkill,
    poolRole: route.poolRole,
    label: route.labels[normalizedChannel],
    channel: normalizedChannel,
    routeVersion: SOCIAL_ROUTE_VERSION,
  });
}

export function socialRouteForContentType(contentType, channel = 'wechat') {
  const type = String(contentType || '').trim();
  if (type === 'custom') return { contentClass: 'custom', contentType: 'custom', outputMode: `${channel === 'xiaohongshu' ? 'xiaohongshu' : 'wechat'}-custom-cards`, storyboardSkill: 'custom-card-storyboard', poolRole: '自定义图文', label: '自定义图文', channel: channel === 'xiaohongshu' ? 'xiaohongshu' : 'wechat', routeVersion: SOCIAL_ROUTE_VERSION };
  if (type === 'technology') return socialRouteForContentClass('open_source_technology', channel);
  if (type === 'trend') return socialRouteForContentClass('open_source_trend', channel);
  const entry = Object.entries(CONTENT_CLASS_ROUTE_TABLE).find(([, route]) => route.contentType === type);
  return socialRouteForContentClass(entry?.[0] || 'news_event', channel);
}

export function contentTypeForSocialRoute(candidate = {}) {
  const explicitClass = candidate.content_class || candidate.contentClass;
  if (explicitClass && explicitClass !== 'news_event') return socialRouteForContentClass(explicitClass).contentType;
  const mode = String(candidate?.tracks?.find((item) => item.track === 'social_cards')?.output_mode || candidate.output_mode || '');
  if (mode.includes('custom-cards')) return 'custom';
  if (mode.includes('event-cards')) return 'event';
  if (mode.includes('technology-cards')) return 'event';
  if (mode.includes('trend-cards')) return 'event';
  if (mode.includes('tool-cards')) return 'repository';
  return 'event';
}

export function socialStoryboardClassForContentClass(contentClass) {
  const normalizedClass = normalizeSocialContentClass(contentClass);
  return CONTENT_CLASS_ROUTE_TABLE[normalizedClass].storyboardClass || CONTENT_CLASS_ROUTE_TABLE[normalizedClass].contentType;
}

export function socialStoryboardSkillForContentClass(contentClass) {
  const normalizedClass = normalizeSocialContentClass(contentClass);
  return CONTENT_CLASS_ROUTE_TABLE[normalizedClass].storyboardSkill;
}
