/**
 * SEO 关键词搜索信号评分（JS 版）
 * 从百度、360 搜索联点接口获取联想数据，计算相对搜索信号分数。
 * 相当于 seo-keyword-scoring 技能的 Python 版逻辑的 JS 移植。
 */

const FETCH_TIMEOUT = 8000;
const USER_AGENT = 'Mozilla/5.0 (compatible; seo-keyword-scanner/1.0)';

async function fetchJson(url, params) {
  const qs = new URLSearchParams(params);
  const response = await fetch(`${url}?${qs}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function baiduSuggestions(keyword) {
  const data = await fetchJson('https://suggestion.baidu.com/su', {
    wd: keyword, action: 'opensearch', ie: 'utf-8', cb: '',
  });
  if (!Array.isArray(data) || data.length < 2 || !Array.isArray(data[1])) {
    throw new Error('百度联想 API 返回格式异常');
  }
  return data[1].map(String);
}

async function so360Suggestions(keyword) {
  const data = await fetchJson('https://sug.so.360.cn/suggest', {
    word: keyword, encodein: 'utf-8', encodeout: 'utf-8', format: 'json',
  });
  if (!data || !Array.isArray(data.result)) throw new Error('360 联想 API 返回格式异常');
  return data.result.map((item) => String(item.word));
}

async function querySource(name, fetcher, keyword) {
  try {
    const suggestions = await fetcher(keyword);
    return { status: 'ok', count: suggestions.length, suggestions: suggestions.slice(0, 10) };
  } catch (err) {
    return { status: 'unavailable', count: null, suggestions: [], error: err.message };
  }
}

export async function scoreKeyword(keyword) {
  const sources = {
    baidu: await querySource('baidu', baiduSuggestions, keyword),
    so360: await querySource('so360', so360Suggestions, keyword),
  };
  const available = Object.values(sources).filter((s) => s.status === 'ok');
  const score = available.length
    ? Math.round(available.reduce((sum, s) => sum + Math.min(s.count, 10), 0) / available.length * 10) / 10
    : null;
  const related = [...new Set(
    Object.values(sources).flatMap((s) => s.suggestions)
  )].slice(0, 10);
  return { keyword, seo_score: score, available_sources: available.length, source_status: sources, related_keywords: related };
}

export async function scoreKeywords(keywords) {
  return Promise.all(keywords.map((kw) => scoreKeyword(kw.trim()).catch((err) => ({
    keyword: kw.trim(), seo_score: null, available_sources: 0,
    source_status: { error: err.message }, related_keywords: [], error: err.message,
  }))));
}
