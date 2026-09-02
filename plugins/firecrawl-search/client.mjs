const DEFAULT_ENDPOINT = 'https://api.firecrawl.dev/v2/search';

function hostname(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

export async function firecrawlSearch(query, { apiKey, endpoint = DEFAULT_ENDPOINT, maxResults = 5, sourceType = 'web', timeoutMs = 45000 } = {}) {
  if (!apiKey) throw new Error('Firecrawl Search API Key 未配置');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: String(query), limit: Math.min(Math.max(Number(maxResults) || 5, 1), 5), sources: [sourceType === 'news' ? 'news' : 'web'] }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Firecrawl Search API ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`);
    return response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`Firecrawl Search 请求超过 ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function mapSearchResults(data, sourceType = 'web') {
  const payload = data?.data || data || {};
  const items = sourceType === 'news' ? (payload.news || []) : (payload.web || payload.results || []);
  return items.map((item) => ({
    title: String(item?.title || '(无标题)'),
    url: String(item?.url || item?.link || ''),
    snippet: String(item?.description || item?.snippet || item?.content || '').slice(0, 2000),
    source: hostname(item?.url || item?.link),
    publishedAt: String(item?.publishedDate || item?.published_date || item?.date || ''),
  })).filter((item) => item.url);
}
