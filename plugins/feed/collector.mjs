import dns from 'node:dns/promises';
import net from 'node:net';
import { privateIp } from './network-safety.mjs';

function decodeXml(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '').trim();
}

function field(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match) return decodeXml(match[1]);
  }
  return null;
}

function normalizeDate(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function parseFeed(xml, source) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  return blocks.map((block, index) => ({
    id: field(block, ['guid', 'id']) ?? `${source}-${index}`,
    title: field(block, ['title']) ?? '无标题',
    url: field(block, ['link']) ?? block.match(/<link[^>]+href=["']([^"']+)/i)?.[1] ?? null,
    publishedAt: normalizeDate(field(block, ['pubDate', 'published', 'updated'])),
    summary: field(block, ['description', 'summary', 'content']) || '',
    githubRepositories: [...new Set([...block.matchAll(/https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/gi)]
      .map((match) => match[0].replace(/[),.;]+$/, '')))],
    route: source,
    rank: index + 1,
  }));
}

export function filterRecentItems(items, config = {}, now = Date.now()) {
  const maxAgeMs = Math.max(1, Number(config.maxAgeHours ?? 168)) * 60 * 60 * 1000;
  const kept = []; const stale = []; const undated = [];
  for (const item of items) {
    const timestamp = Date.parse(item.publishedAt ?? '');
    if (!Number.isFinite(timestamp)) {
      if (config.allowUndated !== false) { kept.push(item); undated.push(item); } else stale.push(item);
    } else if (timestamp >= now - maxAgeMs && timestamp <= now + 6 * 60 * 60 * 1000) kept.push(item);
    else stale.push(item);
  }
  return { kept, stale, undated };
}

async function assertPublicFeedUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入完整的 RSS/Atom URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('订阅地址只支持 HTTP 或 HTTPS');
  if (url.username || url.password) throw new Error('订阅地址不能包含账号密码');
  if (['localhost', 'localhost.localdomain'].includes(url.hostname.toLowerCase())) throw new Error('不能订阅本机地址');
  const addresses = net.isIP(url.hostname) ? [{ address: url.hostname }] : await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateIp(address))) throw new Error('订阅地址解析到了本机或内网');
  return url;
}

export async function fetchDirectFeed(value, timeoutMs = 60000) {
  let url = await assertPublicFeedUrl(value);
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    const response = await fetch(url, {
      redirect: 'manual',
      headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.5', 'user-agent': 'WriteAssistant/1.0 RSS Reader' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`订阅源重定向 ${response.status} 但没有 Location`);
      url = await assertPublicFeedUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new Error(`订阅源返回 HTTP ${response.status}`);
    if (Number(response.headers.get('content-length') || 0) > 12_000_000) throw new Error('订阅源超过 12 MB 安全上限');
    const xml = await response.text();
    if (xml.length > 12_000_000) throw new Error('订阅源超过 12 MB 安全上限');
    const items = parseFeed(xml, url.href);
    if (!items.length) throw new Error('没有识别到 RSS/Atom 条目');
    const root = xml.match(/<channel\b[\s\S]*?<\/channel>|<feed\b[\s\S]*?<\/feed>/i)?.[0] ?? xml;
    return { url: url.href, title: field(root, ['title']) || url.hostname, items };
  }
  throw new Error('订阅源重定向次数过多');
}

export async function testFeedSubscription(value) {
  const feed = await fetchDirectFeed(value, 20000);
  return { ok: true, title: feed.title, itemCount: feed.items.length, url: feed.url };
}

export async function collectFeed(source, config = {}, onProgress = () => {}, onSourceResult = () => {}) {
  const url = source.url; const startedAt = new Date().toISOString(); const started = Date.now();
  let sourceName = source.label || url;
  try {
    onProgress(`正在读取直连 RSS ${sourceName}`);
    const feed = await fetchDirectFeed(url); sourceName = source.label || feed.title;
    const filtered = filterRecentItems(feed.items.slice(0, 30), config);
    if (filtered.stale.length) onProgress(`${sourceName} 已忽略 ${filtered.stale.length} 条过期内容`);
    if (filtered.undated.length) onProgress(`${sourceName} 有 ${filtered.undated.length} 条缺少有效发布时间`);
    const sourceKey = `direct:${url}`;
    const items = filtered.kept.map((item) => ({ ...item, route: url, feedLabel: sourceName, sourceKey, sourceType: 'direct', sourceName }));
    onSourceResult({ sourceGroup: 'rsshub', sourceType: 'direct', sourceKey, sourceName, status: 'success', itemCount: items.length, durationMs: Date.now() - started, startedAt, endedAt: new Date().toISOString() });
    return items;
  } catch (error) {
    onSourceResult({ sourceGroup: 'rsshub', sourceType: 'direct', sourceKey: `direct:${url}`, sourceName, status: 'failed', itemCount: 0, durationMs: Date.now() - started, error: error.message, startedAt, endedAt: new Date().toISOString() });
    throw error;
  }
}
