import { CdpClient, waitForReady } from '../_shared/cdp-client.mjs';

async function getJson(url, options) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), ...options });
  if (!response.ok) throw new Error(`Chrome CDP 返回 HTTP ${response.status}`);
  return response.json();
}

export function cdpCandidates(configuredUrl) {
  const candidates = [configuredUrl];
  try {
    const parsed = new URL(configuredUrl);
    if (['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname)) {
      candidates.push(`${parsed.protocol}//localhost:${parsed.port || '9222'}`);
    }
    if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') {
      candidates.push(`${parsed.protocol}//[::1]:${parsed.port || '9222'}`);
    }
    if (parsed.hostname === '[::1]' || parsed.hostname === '::1' || parsed.hostname === 'localhost') {
      candidates.push(`${parsed.protocol}//127.0.0.1:${parsed.port || '9222'}`);
    }
  } catch {}
  return [...new Set(candidates)];
}

async function resolveCdpUrl(configuredUrl) {
  const errors = [];
  for (const candidate of cdpCandidates(configuredUrl)) {
    try {
      const version = await getJson(`${candidate}/json/version`);
      if (version.webSocketDebuggerUrl && version['Protocol-Version']) return candidate;
      errors.push(`${candidate}: 不是有效的 Chrome CDP`);
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }
  throw new Error(errors.join('；'));
}

async function acquireTarget(cdpUrl) {
  const targets = await getJson(`${cdpUrl}/json/list`);
  const existing = targets.find((target) => target.type === 'page' && target.url.includes('old.reddit.com'));
  if (existing) return existing;
  const createUrl = `${cdpUrl}/json/new?${encodeURIComponent('https://old.reddit.com/')}`;
  return getJson(createUrl, { method: 'PUT' });
}

const extractionScript = `(() => {
  const blocked = /blocked|security|access denied|whoa there/i.test(document.title + ' ' + document.body.innerText.slice(0, 800));
  if (blocked) return { blocked: true, title: document.title, items: [] };
  const items = [...document.querySelectorAll('.thing')].slice(0, 40).map((node) => {
    const link = node.querySelector('a.title');
    const score = node.querySelector('.score.unvoted');
    const comments = node.querySelector('a.comments');
    return link ? {
      id: node.getAttribute('data-fullname') || node.id,
      title: link.textContent.trim(),
      url: link.href,
      redditUrl: comments?.href || null,
      scoreText: score?.textContent?.trim() || null,
      author: node.getAttribute('data-author') || null,
      timestamp: node.querySelector('time')?.getAttribute('datetime') || null
    } : null;
  }).filter(Boolean);
  return { blocked: false, title: document.title, items };
})()`;

export async function collectReddit(config, onProgress = () => {}, onSourceResult = () => {}) {
  let target;
  try {
    const resolvedCdpUrl = await resolveCdpUrl(config.cdpUrl);
    onProgress(`已连接 Reddit Chrome：${resolvedCdpUrl}`);
    target = await acquireTarget(resolvedCdpUrl);
  } catch (error) {
    throw new Error(`无法连接 Reddit 专用 Chrome。可运行插件内 scripts/start-chrome.ps1 进行手动诊断。${error.message}`);
  }
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  const allItems = [];
  try {
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    let successful=0;
    for (const subreddit of config.subreddits) {
      const started=Date.now();const startedAt=new Date().toISOString();const sourceKey=`reddit:r/${subreddit}`;const sourceName=`r/${subreddit}`;
      try {
        onProgress(`正在读取 ${sourceName}`);
        const url = `https://old.reddit.com/r/${encodeURIComponent(subreddit)}/hot/`;
        await client.send('Page.navigate', { url });
        await waitForReady(client, config.navigationTimeoutMs);
        const result = await client.evaluate(extractionScript);
        if (result.blocked) throw new Error(`Reddit 返回安全页：${result.title}`);
        const items = result.items.slice(0, config.limitPerSubreddit).map((item) => ({
          ...item, subreddit, publishedAt: item.timestamp, sourceKey, sourceType:'reddit', sourceName,
        }));
        allItems.push(...items);successful+=1;
        onSourceResult({sourceGroup:'reddit',sourceType:'reddit',sourceKey,sourceName,status:'success',itemCount:items.length,durationMs:Date.now()-started,startedAt,endedAt:new Date().toISOString()});
      } catch(error) {
        onProgress(`${sourceName} 读取失败，已跳过：${error.message}`);
        onSourceResult({sourceGroup:'reddit',sourceType:'reddit',sourceKey,sourceName,status:'failed',itemCount:0,durationMs:Date.now()-started,error:error.message,startedAt,endedAt:new Date().toISOString()});
      }
    }
    if(config.subreddits.length&&successful===0)throw new Error('所有 Reddit 分区均采集失败');
  } finally {
    client.close();
  }
  return allItems;
}

export async function checkReddit(config) {
  try {
    const resolvedCdpUrl = await resolveCdpUrl(config.cdpUrl);
    const targets = await getJson(`${resolvedCdpUrl}/json/list`);
    return { ok: true, tabs: targets.filter((item) => item.type === 'page').length, cdpUrl: resolvedCdpUrl };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
