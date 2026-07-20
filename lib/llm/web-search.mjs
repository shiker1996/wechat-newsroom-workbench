/**
 * Tavily web search integration.
 * Used as fallback for providers that don't support native web search,
 * or as a configurable search layer for the editorial room.
 */

const TAVILY_BASE = 'https://api.tavily.com';

export async function webSearch(query, { apiKey, maxResults = 5 }) {
  if (!apiKey) throw new Error('TAVILY_API_KEY 未配置');
  const response = await fetch(`${TAVILY_BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'advanced',
      max_results: maxResults,
      include_answer: true,
      include_raw_content: false,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Tavily API ${response.status}: ${text}`);
  }
  return response.json();
}

export function formatSearchResults(data) {
  const parts = [];
  if (data.answer) parts.push(`## AI 回答摘要\n\n${data.answer}\n`);
  if (data.results?.length) {
    parts.push('## 搜索到的参考资料\n');
    data.results.forEach((r, i) => {
      parts.push(`### ${i + 1}. ${r.title || '(无标题)'}`);
      if (r.url) parts.push(`来源: ${r.url}`);
      if (r.content) parts.push(r.content.slice(0, 2000));
      parts.push('');
    });
  }
  return parts.join('\n');
}
