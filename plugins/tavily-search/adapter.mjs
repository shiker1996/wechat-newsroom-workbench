import { webSearch } from '../../lib/llm/web-search.mjs';
import { failure, ok } from '../../lib/tools/schemas.mjs';

const NEWS_CAPABILITY = 'content.news.search';
const MISSING_KEY_ACTION = '在 .env 或系统环境变量中配置 TAVILY_API_KEY';

function hostname(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

function mapResults(data) {
  return (data.results || [])
    .map((item) => ({
      title: String(item.title || '(无标题)'),
      url: String(item.url || ''),
      snippet: String(item.content || '').slice(0, 2000),
      source: hostname(item.url),
      publishedAt: item.published_date ? String(item.published_date) : '',
    }))
    .filter((item) => item.url);
}

export async function execute(input, context) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return failure('DEPENDENCY_MISSING', 'TAVILY_API_KEY 未配置', { action: MISSING_KEY_ACTION });
  const isNews = context?.capability === NEWS_CAPABILITY;
  const maxResults = Number.isInteger(input.maxResults) ? Math.min(Math.max(input.maxResults, 1), 10) : 5;
  try {
    const data = await webSearch(String(input.query), {
      apiKey,
      maxResults,
      ...(isNews ? { topic: 'news' } : {}),
      ...(input.timeRange ? { timeRange: input.timeRange } : {}),
    });
    const results = mapResults(data);
    const warnings = [];
    if (isNews) {
      const missingDate = results.filter((item) => !item.publishedAt).length;
      if (missingDate) warnings.push(`${missingDate} 条新闻结果缺少发布时间，需人工核验时效`);
    }
    if (!results.length) warnings.push('搜索没有返回结果');
    return ok(
      { results, ...(data.answer ? { answer: String(data.answer) } : {}) },
      {
        provenance: {
          provider: 'tavily',
          query: String(input.query),
          topic: isNews ? 'news' : 'general',
          searchedAt: new Date().toISOString(),
        },
        warnings,
      },
    );
  } catch (error) {
    const message = String(error?.message || error);
    const timeout = /timeout/i.test(message);
    return failure(timeout ? 'TIMEOUT' : 'FETCH_FAILED', message,
      { retryable: timeout || /ECONNRESET|EAI_AGAIN|429|5\d{2}/i.test(message) });
  }
}

export async function health() {
  if (!process.env.TAVILY_API_KEY) {
    return failure('DEPENDENCY_MISSING', 'TAVILY_API_KEY 未配置', { action: MISSING_KEY_ACTION });
  }
  return ok({ available: true, provider: 'tavily', capabilities: ['content.web.search', NEWS_CAPABILITY] });
}
