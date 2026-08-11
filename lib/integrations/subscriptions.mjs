import fs from 'node:fs';
import path from 'node:path';

function cleanText(value, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function routeKind(route) {
  return /^\/twitter\/user\//i.test(route) ? 'twitter' : /^\/github\/trending\//i.test(route) ? 'github' : 'rsshub';
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

function sourceKey(kind,value) {
  if(kind==='direct')return `direct:${value}`;
  const identity=String(value).replace(/([?&])limit=\d+(?:&|$)/i,'$1').replace(/[?&]$/,'');
  if(kind==='github'){const period=identity.match(/^\/github\/trending\/(daily|weekly|monthly)\//i)?.[1]||'unknown';return `github:trending:${period}`;}
  return `${kind==='twitter'?'twitter':'rsshub'}:${identity}`;
}

export function listSubscriptions(config, health = []) {
  const disabled = new Set(config.rsshub.disabledRoutes ?? []);
  const healthMap=new Map(health.map((item)=>[item.source_key,item]));
  const routes = (config.rsshub.routes ?? []).map((value) => {
    const kind=routeKind(value);return {
    kind, value, enabled: !disabled.has(value), health:healthMap.get(sourceKey(kind,value))||null,
    label: kind === 'twitter'
      ? `@${decodeURIComponent(value.match(/^\/twitter\/user\/([^?]+)/i)?.[1] ?? value)}`
      : kind==='github'?`GitHub Trending · ${(value.match(/^\/github\/trending\/(daily|weekly|monthly)\//i)?.[1]||'').replace(/^./,(x)=>x.toUpperCase())}`:value.split('?')[0],
  }});
  const direct = (config.rsshub.directFeeds ?? []).filter(Boolean).map((feed) => ({
    kind: 'direct', value: feed.url, label: feed.label || new URL(feed.url).hostname, enabled: feed.enabled !== false,
    health:healthMap.get(sourceKey('direct',feed.url))||null,
  }));
  const githubSearch=config.githubDiscovery? [{kind:'github',value:'github:search',label:`GitHub Search · 最近 ${config.githubDiscovery.createdWithinDays||30} 天新建且 Star ≥ ${config.githubDiscovery.minStars||1000}`,
    enabled:config.githubDiscovery.enabled!==false,managed:true,health:healthMap.get('github:search')||null}]:[];
  const items = [...routes, ...githubSearch, ...direct];
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

function save(root, config) {
  const filePath = path.join(root, 'config.local.json');
  const local = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {};
  local.rsshub = {
    ...(local.rsshub ?? {}),
    routes: config.rsshub.routes,
    disabledRoutes: config.rsshub.disabledRoutes ?? [],
    directFeeds: config.rsshub.directFeeds ?? [],
  };
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(local, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

export function addSubscription(root, config, input) {
  const kind = cleanText(input.kind, 20);
  if (!['twitter', 'rsshub', 'direct'].includes(kind)) throw new Error('未知订阅类型');
  if (kind === 'direct') {
    const url = normalizeDirectUrl(input.value || input.url);
    const feeds = config.rsshub.directFeeds ?? (config.rsshub.directFeeds = []);
    if (feeds.some((feed) => feed.url === url)) throw new Error('这个直连 RSS 已经存在');
    feeds.push({ url, label: cleanText(input.label, 80) || new URL(url).hostname, enabled: true });
  } else {
    const route = kind === 'twitter'
      ? `/twitter/user/${twitterHandle(input.value)}?limit=30`
      : normalizeRoute(input.value || input.route);
    if ((config.rsshub.routes ?? []).some((item) => item.toLowerCase() === route.toLowerCase())) throw new Error('这个订阅已经存在');
    config.rsshub.routes.push(route);
  }
  save(root, config);
  return listSubscriptions(config);
}

export function updateSubscription(root, config, input) {
  const kind = cleanText(input.kind, 20);
  const value = cleanText(input.value, 2000);
  const enabled = input.enabled !== false;
  if (kind === 'direct') {
    const feed = (config.rsshub.directFeeds ?? []).find((item) => item.url === value);
    if (!feed) throw new Error('订阅不存在');
    feed.enabled = enabled;
    if (input.label !== undefined) feed.label = cleanText(input.label, 80) || feed.label;
  } else {
    if (!(config.rsshub.routes ?? []).includes(value)) throw new Error('订阅不存在');
    const disabled = new Set(config.rsshub.disabledRoutes ?? []);
    if (enabled) disabled.delete(value); else disabled.add(value);
    config.rsshub.disabledRoutes = [...disabled];
  }
  save(root, config);
  return listSubscriptions(config);
}

export function removeSubscription(root, config, input) {
  const kind = cleanText(input.kind, 20);
  const value = cleanText(input.value, 2000);
  if (kind === 'direct') {
    config.rsshub.directFeeds = (config.rsshub.directFeeds ?? []).filter((item) => item.url !== value);
  } else {
    config.rsshub.routes = (config.rsshub.routes ?? []).filter((item) => item !== value);
    config.rsshub.disabledRoutes = (config.rsshub.disabledRoutes ?? []).filter((item) => item !== value);
  }
  save(root, config);
  return listSubscriptions(config);
}

export function subscriptionTestInput(input) {
  const kind = cleanText(input.kind, 20);
  if (kind === 'twitter') {
    const storedRoute=cleanText(input.value,500).match(/^\/twitter\/user\/([^/?#]+)(?:[/?#].*)?$/i);
    const handle=twitterHandle(storedRoute?decodeURIComponent(storedRoute[1]):input.value);
    return { kind, value: `/twitter/user/${handle}?limit=3` };
  }
  if (kind === 'rsshub'||kind==='github') return { kind, value: normalizeRoute(input.value).replace(/([?&])limit=30(?:&|$)/, '$1limit=3&').replace(/&$/, '') };
  if (kind === 'direct') return { kind, value: normalizeDirectUrl(input.value || input.url) };
  throw new Error('未知订阅类型');
}
