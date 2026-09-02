import { firecrawlSearch, mapSearchResults } from './client.mjs';

const fallback = {
  ok: (data = {}, extras = {}) => ({ status: 'ok', data, artifacts: [], provenance: {}, warnings: [], metrics: { durationMs: 0 }, ...extras }),
  failure: (code, message, options = {}) => ({ status: 'error', error: { code, message: String(message), retryable: Boolean(options.retryable), ...(options.action ? { action: options.action } : {}) } }),
};

export async function execute(input, context = {}) {
  const { failure, ok } = context.result || fallback;
  const configuration = context.configuration || {};
  if (!configuration.apiKey) return failure('DEPENDENCY_MISSING', 'Firecrawl Search 凭据未配置', { action: '前往系统与配置中心完成 Firecrawl 搜索配置' });
  try {
    const sourceType = input.sourceType === 'news' ? 'news' : 'web';
    const data = await firecrawlSearch(input.query, {
      apiKey: configuration.apiKey,
      endpoint: configuration.endpoint,
      maxResults: input.maxResults,
      sourceType,
    });
    const results = mapSearchResults(data, sourceType).slice(0, 5);
    return ok({ results }, {
      provenance: { provider: 'firecrawl', searchType: sourceType, query: String(input.query), searchedAt: new Date().toISOString() },
      warnings: results.length ? [] : ['Firecrawl Search 没有返回结果'],
    });
  } catch (error) {
    const message = String(error?.message || error);
    return failure(/timeout/i.test(message) ? 'TIMEOUT' : 'FETCH_FAILED', message, { retryable: /timeout|429|5\d{2}|ECONNRESET|EAI_AGAIN/i.test(message) });
  }
}

export async function health(context = {}) {
  const { failure, ok } = context.result || fallback;
  return context.configuration?.apiKey
    ? ok({ available: true, provider: 'firecrawl', capabilities: ['content.research.search'] })
    : failure('DEPENDENCY_MISSING', 'Firecrawl Search 凭据未配置', { action: '前往系统与配置中心完成 Firecrawl 搜索配置' });
}
