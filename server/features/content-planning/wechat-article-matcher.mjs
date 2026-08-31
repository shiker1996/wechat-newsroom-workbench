function normalize(value = '') {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
}

function dateDistance(left, right) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(left) || !/^\d{4}-\d{2}-\d{2}$/.test(right)) return null;
  return Math.abs((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000);
}

function dice(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const grams = (value) => new Set([...value].map((_, index) => value.slice(index, index + 2)).filter((item) => item.length === 2));
  const a = grams(left); const b = grams(right);
  let overlap = 0; for (const item of a) if (b.has(item)) overlap += 1;
  return (2 * overlap) / Math.max(1, a.size + b.size);
}

const VERSION_PRIORITY = { '文章终稿': 5, '早报终稿': 5, '排版 HTML': 4, '审阅稿': 3, '去 AI 稿': 2, '文章初稿': 1 };
const ARTICLE_FINAL_TYPES = new Set(['文章终稿', '早报终稿']);
const SOCIAL_COPY_TYPE = '图文发布文案';

function dedupeArtifacts(artifacts) {
  const groups = new Map();
  for (const item of artifacts || []) {
    const key = `${item.normalized_title || normalize(item.title)}|${item.article_date || ''}`;
    const current = groups.get(key);
    if (!current || (VERSION_PRIORITY[item.artifact_type] || 0) > (VERSION_PRIORITY[current.artifact_type] || 0)) groups.set(key, item);
  }
  return [...groups.values()];
}

function snapshot(item, score, method) {
  return { id: item.id, title: item.title, article_date: item.article_date, version_label: item.version_label, artifact_type: item.artifact_type, file_path: item.file_path, score: Number(score.toFixed(3)), method };
}

export function matchWechatArticle(metric = {}, artifacts = []) {
  const title = String(metric.title || '').trim(); const normalizedTitle = normalize(title);
  const pool = dedupeArtifacts((artifacts || []).filter((item) => ARTICLE_FINAL_TYPES.has(item.artifact_type)));
  const byPriority = (items) => [...items].sort((left, right) => (VERSION_PRIORITY[right.artifact_type] || 0) - (VERSION_PRIORITY[left.artifact_type] || 0));
  const url = String(metric.content_url || '').trim();
  const urlMatches = url ? byPriority(pool.filter((item) => String(item.content_url || '').trim() === url)) : [];
  if (urlMatches.length === 1) return { status: 'auto_confirmed', articleArtifactId: urlMatches[0].id, contentType: 'article', method: 'url_exact', confidence: 'high', candidates: [snapshot(urlMatches[0], 1, 'url_exact')] };

  const rawMatches = byPriority(pool.filter((item) => String(item.title || '').trim() === title));
  if (rawMatches.length === 1) return { status: 'auto_confirmed', articleArtifactId: rawMatches[0].id, contentType: 'article', method: 'title_exact', confidence: 'high', candidates: [snapshot(rawMatches[0], 0.98, 'title_exact')] };

  const normalizedMatches = byPriority(pool.filter((item) => normalize(item.title) === normalizedTitle));
  if (normalizedMatches.length) {
    const candidates = normalizedMatches.slice(0, 5).map((item) => snapshot(item, dateDistance(metric.published_date, item.article_date) === 0 ? 0.97 : 0.92, 'title_normalized'));
    return { status: 'pending', articleArtifactId: null, method: 'title_normalized', confidence: 'medium', candidates };
  }

  const similar = pool.map((item) => {
    const titleScore = dice(normalizedTitle, normalize(item.title)); const distance = dateDistance(metric.published_date, item.article_date);
    const dateScore = distance === 0 ? 0.12 : distance != null && distance <= 7 ? 0.05 : 0;
    return { item, score: titleScore * 0.88 + dateScore, distance };
  }).filter((item) => item.score >= 0.48).sort((left, right) => right.score - left.score || (left.distance ?? 999) - (right.distance ?? 999)).slice(0, 5);
  if (!similar.length) return { status: 'unmatched', articleArtifactId: null, method: 'unmatched', confidence: 'none', candidates: [] };
  const candidates = similar.map(({ item, score }) => snapshot(item, score, 'title_date_similarity'));
  const confidence = similar[0].score >= 0.8 ? 'medium' : 'low';
  return { status: 'pending', articleArtifactId: null, method: 'title_date_similarity', confidence, candidates };
}

export function matchWechatSocialCopy(metric = {}, artifacts = []) {
  const title = String(metric.title || '').trim(); const normalizedTitle = normalize(title);
  const pool = dedupeArtifacts((artifacts || []).filter((item) => item.artifact_type === SOCIAL_COPY_TYPE));
  const byPriority = (items) => [...items].sort((left, right) => Number(right.modified_at > left.modified_at) - Number(left.modified_at > right.modified_at));
  const rawMatches = byPriority(pool.filter((item) => String(item.title || '').trim() === title));
  if (rawMatches.length === 1) return { status: 'auto_confirmed', articleArtifactId: rawMatches[0].id, contentType: 'social', method: 'social_copy_exact', confidence: 'high', candidates: [snapshot(rawMatches[0], 0.98, 'social_copy_exact')] };
  const normalizedMatches = byPriority(pool.filter((item) => normalize(item.title) === normalizedTitle));
  if (normalizedMatches.length) {
    const candidates = normalizedMatches.slice(0, 5).map((item) => snapshot(item, dateDistance(metric.published_date, item.article_date) === 0 ? 0.97 : 0.92, 'social_copy_normalized'));
    return { status: 'pending', articleArtifactId: null, method: 'social_copy_normalized', confidence: 'medium', candidates };
  }
  const similar = pool.map((item) => {
    const titleScore = dice(normalizedTitle, normalize(item.title)); const distance = dateDistance(metric.published_date, item.article_date);
    const dateScore = distance === 0 ? 0.12 : distance != null && distance <= 7 ? 0.05 : 0;
    return { item, score: titleScore * 0.88 + dateScore, distance };
  }).filter((item) => item.score >= 0.48).sort((left, right) => right.score - left.score || (left.distance ?? 999) - (right.distance ?? 999)).slice(0, 5);
  if (!similar.length) return { status: 'unmatched', articleArtifactId: null, method: 'social_copy_unmatched', confidence: 'none', candidates: [] };
  const candidates = similar.map(({ item, score }) => snapshot(item, score, 'social_copy_similarity'));
  const confidence = similar[0].score >= 0.8 ? 'medium' : 'low';
  return { status: 'pending', articleArtifactId: null, method: 'social_copy_similarity', confidence, candidates };
}

function combinePendingResults(articleResult, socialResult) {
  const candidates = [...(articleResult.candidates || []), ...(socialResult.candidates || [])]
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
    .filter((item, index, all) => all.findIndex((candidate) => Number(candidate.id) === Number(item.id)) === index)
    .slice(0, 5);
  return candidates.length
    ? { status: 'pending', articleArtifactId: null, method: 'mixed_candidates', confidence: candidates[0].score >= 0.8 ? 'medium' : 'low', candidates }
    : articleResult;
}

export function matchWechatArticles(store, { force = false } = {}) {
  const metrics = store.listWechatArticleMetrics();
  const artifacts = store.listArticleArtifacts({ limit: 1000 });
  let matched = 0; let pending = 0; let unmatched = 0; let preserved = 0;
  for (const metric of metrics) {
    const existing = store.getWechatArticleMetricMatchByMetric(metric.id);
    if (existing && ['confirmed', 'rejected'].includes(existing.status) && !force) { preserved += 1; continue; }
    const articleResult = matchWechatArticle(metric, artifacts);
    const socialResult = matchWechatSocialCopy(metric, artifacts);
    const result = articleResult.status === 'auto_confirmed'
      ? articleResult
      : socialResult.status === 'auto_confirmed'
        ? socialResult
        : articleResult.status === 'pending' && socialResult.status === 'pending'
          ? combinePendingResults(articleResult, socialResult)
          : articleResult.status === 'pending' ? articleResult : socialResult;
    const normalizedResult = result.status === 'unmatched'
      ? { ...result, contentType: 'unknown', method: 'unmatched' }
      : result;
    store.upsertWechatArticleMetricMatch({ metricId: metric.id, ...normalizedResult, force });
    if (normalizedResult.status === 'auto_confirmed') matched += 1;
    else if (normalizedResult.status === 'pending') pending += 1;
    else unmatched += 1;
  }
  return { metrics: metrics.length, matched, pending, unmatched, preserved };
}

export { normalize as normalizeWechatTitle };
