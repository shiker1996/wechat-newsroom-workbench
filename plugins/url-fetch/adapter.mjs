import { fetchUrlContentImplementation } from '../../lib/integrations/source-fetcher-core.mjs';
import { failure, ok } from '../../lib/tools/schemas.mjs';

export async function execute(input) {
  let url;
  try { url = new URL(input.targetUrl); } catch { return failure('INVALID_INPUT', 'URL 格式无效'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return failure('INVALID_INPUT', '只允许不含凭据的 HTTP/HTTPS URL');
  }
  try {
    const record = await fetchUrlContentImplementation(input);
    return ok(record, {
      provenance:{
        requestedUrl:input.targetUrl,
        finalUrl:record.final_url || input.targetUrl,
        fetchMethod:record.fetch_method || 'unknown',
        fetchedAt:record.fetched_at || new Date().toISOString(),
      },
      warnings:record.error ? [record.error] : [],
    });
  } catch (error) {
    return failure(/timeout/i.test(String(error.message)) ? 'TIMEOUT' : 'FETCH_FAILED',
      String(error.message || error), { retryable:/timeout|ECONNRESET|EAI_AGAIN/i.test(String(error.message)) });
  }
}

export async function health() {
  return ok({ available:true, strategies:['rss-content', 'github-api', 'python', 'firecrawl-mcp'] });
}
