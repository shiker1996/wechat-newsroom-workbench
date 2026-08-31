import fs from 'node:fs';
import path from 'node:path';
import { isInsideRoots } from '../../platform/artifacts/artifact-indexer.mjs';
import { fetchUrlContent } from '../../platform/integrations/source-fetcher.mjs';

const LOCAL_PRIORITY = { '文章终稿': 6, '早报终稿': 6, '排版 HTML': 5, '审阅稿': 4, '去 AI 稿': 3, '文章初稿': 2, '文章简报': 1 };
const MAX_CONTENT_CHARS = 1_000_000;
const SOCIAL_COPY_TYPE = '图文发布文案';

function sourceKind(artifactType = '') {
  if (artifactType === '文章终稿' || artifactType === '早报终稿') return 'local_final';
  if (artifactType === '审阅稿') return 'local_reviewed';
  if (artifactType === '去 AI 稿') return 'local_humanized';
  if (artifactType === '文章初稿') return 'local_draft';
  if (artifactType.includes('HTML')) return 'local_html';
  return 'local_draft';
}

function evidenceType(filePath = '') {
  const value = String(filePath).toLowerCase();
  const name = path.basename(value);
  if (/截图|screenshot|screen[-_ ]?shot|\.png$|\.jpg$|\.jpeg$|\.webp$/.test(value)) return 'screenshot';
  if (/差异|diff|patch/.test(value) || /\.(diff|patch)$/.test(name)) return 'code_diff';
  if (/日志|log/.test(value) || /\.log$/.test(name)) return 'log';
  if (/失败|failure|error/.test(value)) return 'failure';
  if (/结果|result|output/.test(value)) return 'result';
  if (/图表|chart|figure|data/.test(value) || /\.(csv|json)$/.test(name)) return 'chart';
  return 'other';
}

function evidenceLabel(filePath = '', type = 'other') {
  const labels = { screenshot: '截图', log: '日志', code_diff: '代码差异', chart: '数据图或数据', failure: '失败结果', result: '结果证据', other: '证据资产' };
  return `${labels[type] || labels.other} · ${path.basename(filePath)}`;
}

function localCandidates(selected, artifacts) {
  const selectedDir = selected ? path.dirname(path.resolve(selected.file_path)) : '';
  return (artifacts || []).filter((item) => {
    if (!item?.file_path) return false;
    const sameDir = selectedDir && path.dirname(path.resolve(item.file_path)) === selectedDir;
    const sameArticle = item.normalized_title === selected.normalized_title && item.article_date === selected.article_date;
    return sameDir || sameArticle;
  }).sort((left, right) => (LOCAL_PRIORITY[right.artifact_type] || 0) - (LOCAL_PRIORITY[left.artifact_type] || 0) || Number(right.modified_at > left.modified_at) - Number(left.modified_at > right.modified_at));
}

function readLocalArtifact(artifact, roots) {
  const filePath = path.resolve(String(artifact?.file_path || ''));
  if (!filePath || !isInsideRoots(filePath, roots) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error('本地文章产物不存在或不在授权目录内');
  const content = fs.readFileSync(filePath, 'utf8').slice(0, MAX_CONTENT_CHARS);
  if (!content.trim()) throw new Error('本地文章产物为空');
  return { filePath, content };
}

function localSnapshotInput(metric, artifact, roots) {
  const { filePath, content } = readLocalArtifact(artifact, roots);
  const evidence = (artifact.evidence_paths || []).map((filePathValue) => {
    const type = evidenceType(filePathValue);
    return { path: filePathValue, type, label: evidenceLabel(filePathValue, type), detectedMethod: 'article-indexer' };
  });
  return {
    metricId: metric.metric_id || metric.id,
    articleArtifactId: artifact.id,
    sourceKind: sourceKind(artifact.artifact_type),
    sourcePath: filePath,
    sourceUrl: '',
    finalUrl: '',
    title: artifact.title || metric.metric_title || metric.title || '',
    content,
    contentChars: content.length,
    status: 'ok',
    error: '',
    fetchedAt: new Date().toISOString(),
    evidence,
  };
}

function matchIsConfirmed(match) { return ['confirmed', 'auto_confirmed'].includes(match?.match_status || match?.status); }

export function linkWechatArticleContent(store, { matchId, root, artifactRoots = [] } = {}) {
  const match = store.getWechatArticleMetricMatch(Number(matchId));
  if (!match) throw new Error('公众号文章关联不存在');
  if (!matchIsConfirmed(match)) return { status: 'needs_match', match_id: Number(matchId), title: match.metric_title || '' };
  const roots = [...new Set([root, ...artifactRoots].filter(Boolean).map((item) => path.resolve(item)))];
  const artifacts = store.listArticleArtifacts({ limit: 1000 });
  const selected = artifacts.find((item) => Number(item.id) === Number(match.article_artifact_id));
  const candidates = localCandidates(selected, artifacts);
  const local = candidates[0] || selected;
  if (!local) return { status: 'needs_external', match_id: Number(matchId), title: match.metric_title || '', source_url: match.content_url || '' };
  try {
    const snapshot = localSnapshotInput(match, local, roots);
    if (local.artifact_type === SOCIAL_COPY_TYPE) return { status: 'social_copy', match_id: Number(matchId), copy: snapshot.content, artifact: local };
    const saved = store.saveArticleContentSnapshot(snapshot);
    const evidence = store.replaceArticleEvidenceAssets({ artifactId: local.id, snapshotId: saved.id, assets: snapshot.evidence });
    return { status: 'linked_local', match_id: Number(matchId), snapshot: saved, evidence_assets: evidence, artifact: local };
  } catch (error) {
    const saved = store.saveArticleContentSnapshot({ metricId: match.metric_id, articleArtifactId: local.id, sourceKind: sourceKind(local.artifact_type), sourcePath: local.file_path, title: local.title || match.metric_title || '', status: 'error', error: error.message, fetchedAt: new Date().toISOString() });
    return { status: 'error', match_id: Number(matchId), snapshot: saved, error: error.message, artifact: local };
  }
}

export function linkWechatArticlesContent(store, { root, artifactRoots = [] } = {}) {
  const matches = store.listArticleContentLinks({ limit: 1000 });
  let linked = 0; let socialCopy = 0; let needsExternal = 0; let failed = 0;
  for (const match of matches) {
    const result = linkWechatArticleContent(store, { matchId: match.match_id, root, artifactRoots });
    if (result.status === 'linked_local') linked += 1;
    else if (result.status === 'social_copy') socialCopy += 1;
    else if (result.status === 'needs_external') needsExternal += 1;
    else if (result.status === 'error') failed += 1;
  }
  return { total: matches.length, linked, social_copy: socialCopy, needs_external: needsExternal, failed };
}

export async function fetchWechatArticleContent(store, { matchId, root, toolContext = {}, fetchImpl = fetchUrlContent } = {}) {
  const match = store.getWechatArticleMetricMatch(Number(matchId));
  if (!match) throw new Error('公众号文章关联不存在');
  if (!matchIsConfirmed(match)) throw new Error('请先确认文章关联，再获取正文');
  const local = store.listArticleArtifacts({ limit: 1000 }).find((item) => Number(item.id) === Number(match.article_artifact_id));
  if (local) {
    try { readLocalArtifact(local, [root, local.root_path].filter(Boolean)); return { status: 'local_exists', match_id: Number(matchId), message: '本地文章正文已存在，未覆盖本地内容' }; } catch { /* 允许在本地索引已失效时尝试公开 URL */ }
  }
  const url = String(match.content_url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    const snapshot = store.saveArticleContentSnapshot({ metricId: match.metric_id, articleArtifactId: null, sourceKind: 'external_url', sourceUrl: url, title: match.metric_title || '', status: 'error', error: '没有可获取的公开文章 URL', fetchedAt: new Date().toISOString() });
    return { status: 'error', match_id: Number(matchId), snapshot, error: snapshot.error };
  }
  let parsed;
  try {
    parsed = await fetchImpl({ targetUrl: url, title: match.metric_title || '', root, toolContext: { store, ...toolContext } });
  } catch (error) {
    parsed = { status: 'error', error: error.message, content: '', content_chars: 0, fetched_at: new Date().toISOString() };
  }
  const content = String(parsed?.content || '');
  const snapshot = store.saveArticleContentSnapshot({ metricId: match.metric_id, articleArtifactId: null, sourceKind: 'external_url', sourceUrl: url, finalUrl: parsed?.final_url || '', title: parsed?.title || match.metric_title || '', content, contentChars: Number(parsed?.content_chars || content.length), status: parsed?.status === 'ok' && content.trim() ? 'ok' : 'error', error: parsed?.error || (!content.trim() ? '公开 URL 未返回正文' : ''), fetchedAt: parsed?.fetched_at || new Date().toISOString() });
  return { status: snapshot.status === 'ok' ? 'linked_external' : 'error', match_id: Number(matchId), snapshot, error: snapshot.error };
}

export { evidenceType, sourceKind };
