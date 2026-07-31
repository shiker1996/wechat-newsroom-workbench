import dns from 'node:dns/promises';
import net from 'node:net';
import { fetchUrlContentImplementation } from '../../lib/integrations/source-fetcher-core.mjs';
import { privateIp } from '../../lib/tools/remote-adapter.mjs';
import { failure, ok } from '../../lib/tools/schemas.mjs';

// SSRF 第一级防线：仅校验初始 URL 的解析结果，后续重定向由抓取侧（Python/Firecrawl）自行处理
async function publicTargetError(url) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (['localhost', 'localhost.localdomain'].includes(hostname.toLowerCase())) return '不允许抓取本机地址';
  try {
    const addresses = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => privateIp(address))) return '目标地址解析到了本机或内网';
  } catch {
    return '目标地址无法解析';
  }
  return '';
}

export async function execute(input) {
  let url;
  try { url = new URL(input.targetUrl); } catch { return failure('INVALID_INPUT', 'URL 格式无效'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return failure('INVALID_INPUT', '只允许不含凭据的 HTTP/HTTPS URL');
  }
  const blocked = await publicTargetError(url);
  if (blocked) return failure('INVALID_INPUT', blocked);
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
