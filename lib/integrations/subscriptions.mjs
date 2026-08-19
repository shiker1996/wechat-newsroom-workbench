import { sourceInputForPlugin } from '../collectors/source-service.mjs';

function cleanText(value, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function twitterHandle(value) {
  const text = cleanText(value, 120).replace(/^@/, '');
  const match = text.match(/^(?:https?:\/\/(?:www\.)?x\.com\/)?([A-Za-z0-9_]{1,15})(?:[/?#].*)?$/i);
  if (!match) throw new Error('请输入有效的 X 用户名，例如 OpenAI 或 @OpenAI');
  return match[1];
}

function normalizeRoute(value) {
  const route = cleanText(value, 500);
  if (!route.startsWith('/') || route.startsWith('//')) throw new Error('RSSHub 路由必须以单个 / 开头');
  return route.includes('limit=') ? route : `${route}${route.includes('?') ? '&' : '?'}limit=30`;
}

function normalizeDirectUrl(value) {
  let url;
  try { url = new URL(cleanText(value, 2000)); } catch { throw new Error('请输入完整的 RSS/Atom URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('直连订阅只支持 HTTP 或 HTTPS');
  return url.href;
}

// 兼容层：按 kind + value 定位 collection_sources 行（前端旧入口仍按来源类型/值下发）
function findSource(repository, kind, value) {
  const text = String(value || '');
  const list = repository.list();
  if (kind === 'direct') return list.find((item) => item.source_type === 'direct' && (item.config?.url === text || item.source_key === `direct:${text}`)) || null;
  if (kind === 'twitter') {
    const routeMatch = text.match(/^\/twitter\/user\/([^/?#]+)/i);
    const handle = routeMatch ? decodeURIComponent(routeMatch[1]) : text.replace(/^@/, '').trim();
    return list.find((item) => item.source_type === 'twitter' && item.config?.route === `/twitter/user/${handle}?limit=30`) || null;
  }
  if (kind === 'github') {
    if (text === 'github:search') return list.find((item) => item.source_type === 'github' && item.source_key === 'github:search') || null;
    const period = text.match(/^\/github\/trending\/(daily|weekly|monthly)\//i)?.[1] || 'daily';
    return list.find((item) => item.source_type === 'github' && (item.config?.route === text || item.source_key === `github:trending:${period}`)) || null;
  }
  const identity = text.replace(/([?&])limit=\d+(?:&|$)/i, '$1').replace(/[?&]$/, '');
  return list.find((item) => item.source_type === 'rsshub' && (item.config?.route === text || item.source_key === `rsshub:${identity}`)) || null;
}

export function listSubscriptions(repository, health = []) {
  const healthMap = new Map((health || []).map((item) => [item.source_key, item]));
  const items = repository.list().map((item) => {
    const kind = item.source_type;
    const value = item.config?.subreddit ? `r/${item.config.subreddit}` : item.config?.url || item.config?.route || item.source_key;
    return { kind, value, label: item.label, enabled: item.enabled, managed: item.managed, health: healthMap.get(item.source_key) || null };
  });
  return {
    items,
    summary: {
      total: items.length,
      enabled: items.filter((item) => item.enabled).length,
      twitter: items.filter((item) => item.kind === 'twitter').length,
      rsshub: items.filter((item) => item.kind === 'rsshub').length,
      github: items.filter((item) => item.kind === 'github').length,
      direct: items.filter((item) => item.kind === 'direct').length,
      failed: items.filter((item) => item.health?.status === 'failed').length,
    },
  };
}

function createSource(repository, pluginId, normalized, label) {
  if (repository.getByKey(normalized.sourceKey)) throw new Error('这个订阅已经存在');
  return repository.upsert({
    pluginId,
    pluginVersion: 'builtin',
    sourceType: normalized.sourceType,
    sourceKey: normalized.sourceKey,
    label: normalized.label || label || normalized.sourceKey,
    config: normalized.config,
    enabled: true,
    origin: 'unified-api',
  });
}

export function addSubscription(repository, input) {
  const kind = cleanText(input.kind, 20);
  const label = cleanText(input.label, 80);
  if (kind === 'direct') {
    const url = normalizeDirectUrl(input.value || input.url);
    const normalized = sourceInputForPlugin('feed-collector', { value: url, label: label || new URL(url).hostname });
    return createSource(repository, 'feed-collector', normalized, label);
  }
  if (kind === 'twitter') {
    const handle = twitterHandle(input.value);
    const normalized = sourceInputForPlugin('rsshub-collector', { value: `/twitter/user/${handle}?limit=30`, label: label || `@${handle}` });
    return createSource(repository, 'rsshub-collector', normalized, label);
  }
  if (kind === 'rsshub' || kind === 'github') {
    const route = normalizeRoute(input.value || input.route);
    if (kind === 'github' && !/^\/github\/trending\//i.test(route)) throw new Error('GitHub 类型只支持 /github/trending/ 路由');
    const normalized = sourceInputForPlugin('rsshub-collector', { value: route, label });
    if (kind === 'github') {
      const period = route.match(/^\/github\/trending\/(daily|weekly|monthly)\//i)?.[1] || 'daily';
      normalized.sourceType = 'github';
      normalized.sourceKey = `github:trending:${period}`;
    }
    return createSource(repository, 'rsshub-collector', normalized, label);
  }
  throw new Error('未知订阅类型');
}

export function updateSubscription(repository, input) {
  const kind = cleanText(input.kind, 20);
  const value = cleanText(input.value, 2000);
  const enabled = input.enabled !== false;
  const source = findSource(repository, kind, value);
  if (!source) throw new Error('订阅不存在');
  if (kind === 'direct' && input.label !== undefined && String(input.label).trim()) {
    repository.update(source.id, { enabled, label: cleanText(input.label, 80) });
  } else {
    repository.setEnabled(source.id, enabled);
  }
  return listSubscriptions(repository);
}

export function removeSubscription(repository, input) {
  const kind = cleanText(input.kind, 20);
  const value = cleanText(input.value, 2000);
  const source = findSource(repository, kind, value);
  if (!source) throw new Error('订阅不存在');
  repository.remove(source.id);
  return listSubscriptions(repository);
}

export function subscriptionTestInput(input) {
  const kind = cleanText(input.kind, 20);
  if (kind === 'twitter') {
    const storedRoute = cleanText(input.value, 500).match(/^\/twitter\/user\/([^/?#]+)(?:[/?#].*)?$/i);
    const handle = twitterHandle(storedRoute ? decodeURIComponent(storedRoute[1]) : input.value);
    return { kind, value: `/twitter/user/${handle}?limit=3` };
  }
  if (kind === 'rsshub' || kind === 'github') return { kind, value: normalizeRoute(input.value).replace(/([?&])limit=30(?:&|$)/, '$1limit=3&').replace(/&$/, '') };
  if (kind === 'direct') return { kind, value: normalizeDirectUrl(input.value || input.url) };
  throw new Error('未知订阅类型');
}
