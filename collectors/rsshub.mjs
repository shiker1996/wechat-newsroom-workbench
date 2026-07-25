import fs from 'node:fs';
import { spawn } from 'node:child_process';
import dns from 'node:dns/promises';
import net from 'node:net';
import { discoverGitHubRepositories } from './github-discovery.mjs';

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

export function filterRecentItems(items, config, now = Date.now()) {
  const maxAgeMs = Math.max(1, Number(config.maxAgeHours ?? 168)) * 60 * 60 * 1000;
  const kept = []; const stale = []; const undated = [];
  for (const item of items) {
    const timestamp = Date.parse(item.publishedAt ?? '');
    if (!Number.isFinite(timestamp)) {
      if (config.allowUndated !== false) { kept.push(item); undated.push(item); }
      else stale.push(item);
    } else if (timestamp >= now - maxAgeMs && timestamp <= now + 6 * 60 * 60 * 1000) kept.push(item);
    else stale.push(item);
  }
  return { kept, stale, undated };
}

export function parseFeed(xml, route) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  return blocks.map((block, index) => ({
    id: field(block, ['guid', 'id']) ?? `${route}-${index}`,
    title: field(block, ['title']) ?? '无标题',
    url: field(block, ['link']) ?? block.match(/<link[^>]+href=["']([^"']+)/i)?.[1] ?? null,
    publishedAt: normalizeDate(field(block, ['pubDate', 'published', 'updated'])),
    summary:field(block,['description','summary','content'])||'',githubRepositories:[...new Set([...block.matchAll(/https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/gi)].map((match)=>match[0].replace(/[),.;]+$/,'')))],route, rank:index+1,
  }));
}

export function githubTrendingPeriod(route){return String(route).match(/^\/github\/trending\/(daily|weekly|monthly)\//i)?.[1]?.toLowerCase()||null;}
export function normalizeGitHubTrendingItem(item,route){const period=githubTrendingPeriod(route);if(!period)return item;let url;try{url=new URL(item.url);}catch{return item;}if(url.hostname.toLowerCase()!=='github.com')return item;const parts=url.pathname.split('/').filter(Boolean).slice(0,2);if(parts.length<2)return item;const repository=`${parts[0]}/${parts[1].replace(/\.git$/i,'')}`;const labels={daily:'Daily',weekly:'Weekly',monthly:'Monthly'};return {...item,id:`github:${repository.toLowerCase()}`,title:repository,url:`https://github.com/${repository}`,sourceGroup:'github',sourceType:'trending',sourceKey:'github:trending',sourceName:`GitHub Trending · ${labels[period]}`,repository,period,periods:[period],rank:item.rank||null};}

async function probe(url, timeoutMs = 5000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const normalized = address.toLowerCase();
  return normalized === '::1' || normalized === '::' || normalized.startsWith('fc')
    || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9')
    || normalized.startsWith('fea') || normalized.startsWith('feb');
}

async function assertPublicFeedUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入完整的 RSS/Atom URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('订阅地址只支持 HTTP 或 HTTPS');
  if (url.username || url.password) throw new Error('订阅地址不能包含账号密码');
  if (['localhost', 'localhost.localdomain'].includes(url.hostname.toLowerCase())) throw new Error('不能订阅本机地址');
  const addresses = net.isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('订阅地址解析到了本机或内网');
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
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > 12_000_000) throw new Error('订阅源超过 12 MB 安全上限');
    const xml = await response.text();
    if (xml.length > 12_000_000) throw new Error('订阅源超过 12 MB 安全上限');
    const items = parseFeed(xml, url.href);
    const title = field(xml.match(/<channel\b[\s\S]*?<\/channel>|<feed\b[\s\S]*?<\/feed>/i)?.[0] ?? xml, ['title']);
    if (!items.length) throw new Error('没有识别到 RSS/Atom 条目');
    return { url: url.href, title: title || url.hostname, items };
  }
  throw new Error('订阅源重定向次数过多');
}

export async function testSubscription(config, input) {
  if (input.kind === 'direct') {
    const feed = await fetchDirectFeed(input.value || input.url, 20000);
    return { ok: true, title: feed.title, itemCount: feed.items.length, url: feed.url };
  }
  const route = String(input.value || input.route || '').trim();
  if (!route.startsWith('/')) throw new Error('RSSHub 路由必须以 / 开头');
  const response = await fetch(new URL(route, config.baseUrl), { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${route} 返回 HTTP ${response.status}`);
  const xml = await response.text();
  const items = parseFeed(xml, route);
  if (!items.length) throw new Error('路由没有返回可识别条目');
  const title = field(xml.match(/<channel\b[\s\S]*?<\/channel>|<feed\b[\s\S]*?<\/feed>/i)?.[0] ?? xml, ['title']);
  return { ok: true, title: title || route, itemCount: items.length, route };
}

function runPowerShell(scriptPath, args = [], timeoutMs = 190000) {
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    throw new Error(`RSSHub 管理脚本不存在：${scriptPath}`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`RSSHub 脚本超时：${scriptPath}`));
    }, timeoutMs);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `RSSHub 脚本退出码 ${code}`));
    });
  });
}

export async function ensureStarted(config, onProgress) {
  if (await probe(config.baseUrl)) return false;
  onProgress('RSSHub 未运行，正在启动本地服务');
  const port=String(new URL(config.baseUrl).port||1200);
  await runPowerShell(config.startScript, ['-RsshubDir',config.rootDir,'-PidFile',config.pidFile,'-Port',port,'-StartupTimeoutSeconds',String(Math.ceil(config.startupTimeoutMs/1000))], config.startupTimeoutMs + 10000);
  onProgress('RSSHub 进程已拉起，正在等待健康检查');
  const deadline = Date.now() + config.startupTimeoutMs;
  while (Date.now() < deadline) {
    if (await probe(config.baseUrl)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('RSSHub 启动后未通过根地址健康检查');
}

function titleOfFeed(xml, fallback) {
  return field(xml.match(/<channel\b[\s\S]*?<\/channel>|<feed\b[\s\S]*?<\/feed>/i)?.[0] ?? xml, ['title']) || fallback;
}

function withoutLimit(value) {
  return String(value).replace(/([?&])limit=\d+(?:&|$)/i, '$1').replace(/[?&]$/, '');
}

export function collectionScopeAllows(scope, target) {
  const group=target?.kind==='route'&&githubTrendingPeriod(String(target.value))?'github':'rsshub';
  return !scope||scope==='all'||scope===group;
}

async function mapConcurrent(items, limit, worker) {
  const results=new Array(items.length); let cursor=0;
  async function run() {
    while(cursor<items.length) { const index=cursor++; results[index]=await worker(items[index],index); }
  }
  await Promise.all(Array.from({length:Math.min(Math.max(1,limit),items.length)},()=>run()));
  return results;
}

export async function collectRssHub(config, onProgress = () => {}, onSourceResult = () => {}) {
  let startedHere = false;
  try {
    const disabled = new Set(config.disabledRoutes ?? []);
    const activeRoutes = (config.routes ?? []).filter((route) => !disabled.has(route));
    const activeFeeds = (config.directFeeds ?? []).filter((feed) => feed && feed.enabled !== false && feed.url);
    const targets=[
      ...activeRoutes.map((value)=>({kind:'route',value})),
      ...activeFeeds.map((value)=>({kind:'direct',value})),
    ].filter((target)=>collectionScopeAllows(config.collectionScope,target));
    if (targets.some((target)=>target.kind==='route')) startedHere = await ensureStarted(config, onProgress);
    const results=await mapConcurrent(targets,Number(config.concurrency||5),async(target)=>{
      const startedAt=new Date().toISOString(); const started=Date.now();
      let sourceType='rsshub',sourceKey='',sourceName='',items=[];
      try {
        if(target.kind==='route') {
          const configuredRoute=target.value;
          const route=configuredRoute.includes('limit=')?configuredRoute:`${configuredRoute}${configuredRoute.includes('?')?'&':'?'}limit=30`;
          const identity=withoutLimit(configuredRoute); sourceType=/^\/twitter\/user\//i.test(identity)?'twitter':'rsshub';
          sourceKey=`${sourceType}:${identity}`; sourceName=identity;
          onProgress(`正在读取 RSSHub ${route}`);
          // 抓取型路由（anthropic、readhub、latepost 等）需要 RSSHub 回源抓上游页面，
          // 冷缓存时经常超过 30s：超时放宽到 90s，超时后自动重试一次（此时 RSSHub 缓存通常已预热）。
          const routeTimeoutMs = Number(config.routeTimeoutMs) || 90000;
          let response;
          try {
            response = await fetch(new URL(route, config.baseUrl), { signal: AbortSignal.timeout(routeTimeoutMs) });
          } catch (error) {
            if (!/aborted|timeout/i.test(String(error?.message || error))) throw error;
            onProgress(`${identity} 首次读取超时，重试一次`);
            response = await fetch(new URL(route, config.baseUrl), { signal: AbortSignal.timeout(routeTimeoutMs) });
          }
          if(!response.ok)throw new Error(`${route} 返回 HTTP ${response.status}`);
          const xml=await response.text(); sourceName=titleOfFeed(xml,identity);
          const filtered=filterRecentItems(parseFeed(xml,route).slice(0,30),config); items=filtered.kept.map((item)=>normalizeGitHubTrendingItem(item,identity));
          if(filtered.stale.length)onProgress(`${sourceName} 已忽略 ${filtered.stale.length} 条过期或未来时间异常内容`);
          if(filtered.undated.length)onProgress(`${sourceName} 有 ${filtered.undated.length} 条缺少有效发布时间`);
          const trendingPeriod=githubTrendingPeriod(identity);if(trendingPeriod){sourceType='trending';sourceKey=`github:trending:${trendingPeriod}`;sourceName=`GitHub Trending · ${trendingPeriod[0].toUpperCase()+trendingPeriod.slice(1)}`;}
          items=items.map((item)=>trendingPeriod?item:({...item,sourceKey,sourceType,sourceName}));
        } else {
          const feedConfig=target.value; sourceType='direct';sourceKey=`direct:${feedConfig.url}`;sourceName=feedConfig.label||feedConfig.url;
          onProgress(`正在读取直连 RSS ${sourceName}`);
          const feed=await fetchDirectFeed(feedConfig.url); sourceName=feedConfig.label||feed.title;
          const filtered=filterRecentItems(feed.items.slice(0,30),config);items=filtered.kept;
          if(filtered.stale.length)onProgress(`${sourceName} 已忽略 ${filtered.stale.length} 条过期内容`);
          if(filtered.undated.length)onProgress(`${sourceName} 有 ${filtered.undated.length} 条缺少有效发布时间`);
          items=items.map((item)=>({...item,route:feedConfig.url,feedLabel:sourceName,sourceKey,sourceType,sourceName}));
        }
        onSourceResult({sourceGroup:githubTrendingPeriod(String(target.value))?'github':'rsshub',sourceType,sourceKey,sourceName,status:'success',itemCount:items.length,durationMs:Date.now()-started,startedAt,endedAt:new Date().toISOString()});
        return {ok:true,items};
      } catch(error) {
        onProgress(`${sourceName||sourceKey||'RSS 来源'} 读取失败，已跳过：${error.message}`);
        onSourceResult({sourceGroup:githubTrendingPeriod(String(target.value))?'github':'rsshub',sourceType,sourceKey:sourceKey||`${sourceType}:${String(target.value?.url||target.value)}`,sourceName:sourceName||String(target.value?.label||target.value?.url||target.value),status:'failed',itemCount:0,durationMs:Date.now()-started,error:error.message,startedAt,endedAt:new Date().toISOString()});
        return {ok:false,items:[]};
      }
    });
    const successfulSources=results.filter((result)=>result.ok).length;
    const rawItems=results.flatMap((result)=>result.items);const github=new Map();const allItems=[];for(const item of rawItems){if(item.sourceGroup!=='github'){allItems.push(item);continue;}const key=item.repository.toLowerCase();const existing=github.get(key);if(!existing){github.set(key,item);continue;}existing.periods=[...new Set([...(existing.periods||[]),...(item.periods||[])])];existing.periodRanks={...(existing.periodRanks||{[existing.period]:existing.rank}),[item.period]:item.rank};existing.sourceName=`GitHub Trending · ${existing.periods.map((period)=>period[0].toUpperCase()+period.slice(1)).join(' / ')}`;}allItems.push(...github.values().map((item)=>({...item,periodRanks:item.periodRanks||{[item.period]:item.rank}})));
    if (targets.length && successfulSources === 0) throw new Error('所有 RSS 来源均未返回有效条目');
    const discovery=config.collectionScope==='rsshub'?{...(config.githubDiscovery||{}),enabled:false}:config.githubDiscovery||{};
    return await discoverGitHubRepositories(allItems,discovery,onProgress,onSourceResult);
  } finally {
    if (startedHere && !config.keepAlive) {
      onProgress('采集完成，正在停止本次启动的 RSSHub');
      const port=String(new URL(config.baseUrl).port||1200);
      try { await runPowerShell(config.stopScript, ['-PidFile',config.pidFile,'-Port',port], 30000); } catch (error) {
        onProgress(`RSSHub 停止失败，需要人工检查：${error.message}`);
      }
    }
  }
}

export async function checkRssHub(config) {
  return { ok: await probe(config.baseUrl), baseUrl: config.baseUrl };
}
