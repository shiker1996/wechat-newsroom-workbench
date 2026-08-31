import fs from 'node:fs';
import path from 'node:path';

const ARTICLE_FILES = new Map([
  ['00-article-brief.md', '文章简报'],
  ['01-personal-materials.md', '个人素材'],
  ['02-outline.md', '文章大纲'],
  ['03-titles.md', '标题候选'],
  ['04-draft.md', '文章初稿'],
  ['05-humanized.md', '去 AI 稿'],
  ['06-reviewed.md', '审阅稿'],
  ['08-seo-optimized.md', 'SEO 优化稿'],
  ['09-final.md', '文章终稿'],
  ['article.ai.draft.html', '排版 HTML 初稿'],
  ['article.ai.html', '排版 HTML'],
]);
const SOCIAL_COPY_FILE = 'copy.txt';
const SOCIAL_COPY_TYPE = '图文发布文案';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'data', 'RSSHub', '.node-runtime']);
const EVIDENCE_NAME = /证据|截图|screenshot|screen[-_ ]?shot|日志|log|diff|差异|失败|failure|结果|result|fact[-_ ]?base|personal[-_ ]?materials|image[-_ ]?assets/i;
const EVIDENCE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.log', '.txt', '.json', '.patch', '.diff']);

function walk(root, maxDepth = 7, depth = 0) {
  if (depth > maxDepth || !fs.existsSync(root)) return [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath, maxDepth, depth + 1));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function normalizeTitle(value = '') {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[`*_~>#]/g, '')
    .replace(/[\p{P}\p{S}\s]+/gu, '')
    .trim();
}

function stripMarkup(value = '') {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function readFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf8').slice(0, 1_000_000); } catch { return null; }
}

function frontMatter(text = '') {
  const match = String(text).match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) return {};
  return Object.fromEntries(match[1].split(/\r?\n/).flatMap((line) => {
    const item = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/);
    return item ? [[item[1].toLowerCase(), item[2].replace(/^['"]|['"]$/g, '')]] : [];
  }));
}

function titleFromText(text, extension, metadata) {
  if (metadata.title) return stripMarkup(metadata.title);
  if (extension === '.html') {
    const heading = String(text).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    const pageTitle = String(text).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    return stripMarkup(heading?.[1] || pageTitle?.[1] || '');
  }
  const heading = String(text).match(/^\s*#\s+(.+?)\s*$/m);
  return stripMarkup(heading?.[1] || '');
}

function titleFromSocialCopy(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => stripMarkup(line.replace(/^#+\s*/, ''))).filter((line) => line && !/^[-*_]{3,}$/.test(line));
  const heading = String(text || '').split(/\r?\n/).map((line) => line.match(/^#{1,6}\s+(.+?)\s*$/)?.[1] || '').map(stripMarkup).find(Boolean);
  if (heading) return heading;
  return lines.find((line) => !/^(好的|遵照|根据|以下|我将|下面|本次)/.test(line)) || lines[0] || '';
}

function dateFromPath(filePath, text, metadata, modifiedAt) {
  const explicit = metadata.article_date || metadata.published_at || metadata.date;
  const match = String(explicit || filePath).match(/20\d{2}[-_.]\d{1,2}[-_.]\d{1,2}/);
  if (match) return match[0].replace(/[_.]/g, '-').replace(/-(\d)(?!\d)/g, '-0$1');
  const bodyDate = String(text).match(/(?:文章日期|article[_ -]?date|published[_ -]?at)\s*[:：]\s*(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})/i);
  if (bodyDate) return bodyDate[1].replace(/[/.]/g, '-').replace(/-(\d)(?!\d)/g, '-0$1');
  return String(modifiedAt || '').slice(0, 10);
}

function contentUrl(text, metadata) {
  const explicit = metadata.content_url || metadata.published_url || metadata.publish_url || metadata.url;
  if (/^https?:\/\//i.test(String(explicit || '').trim())) return String(explicit).trim();
  const match = String(text).match(/(?:content[_ -]?url|published[_ -]?url|publish[_ -]?url|发布\s*URL|文章\s*URL)\s*[:：]\s*(https?:\/\/\S+)/i);
  return match ? match[1].replace(/[)\]}>。，、；;]+$/, '') : '';
}

function versionLabel(name) {
  const lower = name.toLowerCase();
  if (lower === SOCIAL_COPY_FILE) return '图文发布文案';
  if (lower === '03-final.md') return '早报终稿';
  if (lower === '09-final.md') return '终稿';
  if (lower === '04-draft.md') return '初稿';
  if (lower === 'article.ai.html') return '排版 HTML';
  if (lower === 'article.ai.draft.html') return '排版 HTML 初稿';
  if (lower.includes('title')) return '标题候选';
  if (lower.includes('review')) return '审阅稿';
  return '生产中间稿';
}

function artifactDefinition(filePath) {
  const name = path.basename(filePath).toLowerCase();
  const parts = path.resolve(filePath).split(path.sep).map((item) => item.toLowerCase());
  if (name === '03-final.md' && path.basename(path.dirname(filePath)).toLowerCase() === 'daily') return { name, artifactType: '早报终稿' };
  if (ARTICLE_FILES.has(name)) return { name, artifactType: ARTICLE_FILES.get(name) };
  if (name === SOCIAL_COPY_FILE && parts.includes('social-cards')) return { name, artifactType: SOCIAL_COPY_TYPE };
  return null;
}

function evidencePaths(articleDir, primaryPath) {
  return walk(articleDir, 3).filter((filePath) => {
    if (path.resolve(filePath) === path.resolve(primaryPath)) return false;
    const relative = path.relative(articleDir, filePath);
    const parts = relative.split(path.sep);
    const ext = path.extname(filePath).toLowerCase();
    return parts.some((part) => /^(images?|evidence|证据|截图|proof|assets?)$/i.test(part))
      || EVIDENCE_NAME.test(path.basename(filePath))
      || EVIDENCE_EXT.has(ext) && parts.length > 1;
  }).slice(0, 100);
}

function samePath(left, right) {
  return left && right && path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function resolveRelation({ store, filePath, title, normalizedTitle, documents, publications, plans }) {
  const document = documents.find((item) => samePath(item.file_path, filePath)) || null;
  const publication = document
    ? publications.find((item) => Number(item.document_id) === Number(document.id)) || null
    : publications.find((item) => normalizeTitle(item.title_at_publish) === normalizedTitle) || null;
  let plan = publication?.plan_id ? plans.find((item) => Number(item.id) === Number(publication.plan_id)) : null;
  let relationMethod = publication?.document_id ? 'document-publication' : publication?.plan_id ? 'title-publication' : '';
  let relationConfidence = publication ? 'high' : document ? 'medium' : 'none';
  let ambiguous = false;
  if (!plan && normalizedTitle) {
    const matches = plans.filter((item) => [item.material_title, item.title_direction, item.title_at_publish].some((value) => normalizeTitle(value) === normalizedTitle));
    if (matches.length === 1) {
      plan = matches[0]; relationMethod = 'title-plan'; relationConfidence = 'medium';
    } else if (matches.length > 1) {
      ambiguous = true; relationMethod = 'title-plan-ambiguous'; relationConfidence = 'low';
    }
  }
  const materialId = plan?.material_id ?? null;
  const columnId = publication?.column_id ?? plan?.column_id ?? null;
  return {
    documentId: document?.id ?? null,
    planId: plan?.id ?? null,
    materialId,
    columnId,
    batchId: document?.batch_id ?? null,
    relationMethod,
    relationConfidence,
    status: ambiguous ? 'ambiguous' : 'indexed',
    // 保留参数让调用点语义明确；关联只使用只读数据。
    title,
    store,
  };
}

export function indexArticleArtifacts(store, roots = []) {
  const resolvedRoots = [...new Set(roots.filter(Boolean).map((root) => path.resolve(root)))];
  const documents = store.listAllDocuments();
  const publications = store.listArticlePublications();
  const plans = store.listWritingPlans({ limit: 1000 });
  const startedAt = new Date().toISOString();
  const errors = [];
  const keepPaths = [];
  let filesSeen = 0; let indexedCount = 0; let skippedCount = 0;
  for (const root of resolvedRoots) {
    for (const filePath of walk(root)) {
      const definition = artifactDefinition(filePath);
      if (!definition) continue;
      const { name, artifactType } = definition;
      filesSeen += 1;
      const stat = (() => { try { return fs.statSync(filePath); } catch { return null; } })();
      if (!stat) { skippedCount += 1; continue; }
      keepPaths.push(filePath);
      const text = readFile(filePath);
      const articleDir = path.dirname(filePath);
      const metadata = frontMatter(text || '');
      const extension = path.extname(filePath).toLowerCase();
      const title = artifactType === SOCIAL_COPY_TYPE
        ? titleFromSocialCopy(text || '') || path.basename(articleDir)
        : titleFromText(text || '', extension, metadata) || path.basename(articleDir);
      const normalizedTitle = normalizeTitle(title);
      const relation = resolveRelation({ store, filePath, title, normalizedTitle, documents, publications, plans });
      const evidence = evidencePaths(articleDir, filePath);
      let status = relation.status;
      let scanError = '';
      if (text === null) { status = 'unreadable'; scanError = '文件无法读取'; }
      try {
        store.upsertArtifact({
          batchId: relation.batchId,
          candidateId: null,
          track: 'article',
          kind: artifactType,
          name: path.basename(filePath),
          path: filePath,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
        const genericArtifact = store.getArtifactByPath(filePath);
        store.upsertArticleArtifact({
          artifactId: genericArtifact?.id ?? null,
          filePath,
          rootPath: resolvedRoots.find((item) => samePath(filePath, item) || filePath.toLowerCase().startsWith(`${item.toLowerCase()}${path.sep}`)) || root,
          artifactType,
          title,
          normalizedTitle,
          articleDate: dateFromPath(filePath, text || '', metadata, stat.mtime.toISOString()),
          versionLabel: versionLabel(name),
          contentUrl: contentUrl(text || '', metadata),
          batchId: relation.batchId,
          documentId: relation.documentId,
          planId: relation.planId,
          materialId: relation.materialId,
          columnId: relation.columnId,
          evidencePaths: evidence,
          relationMethod: relation.relationMethod,
          relationConfidence: relation.relationConfidence,
          status,
          scanError,
          fileSize: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          indexedAt: new Date().toISOString(),
        });
        indexedCount += 1;
      } catch (error) {
        skippedCount += 1;
        if (errors.length < 50) errors.push({ file_path: filePath, error: error.message });
      }
    }
  }
  const removed = store.pruneArticleArtifacts({ roots: resolvedRoots, keepPaths });
  const finishedAt = new Date().toISOString();
  const run = store.recordArticleArtifactIndexRun({
    roots: resolvedRoots,
    status: errors.length ? (indexedCount ? 'partial' : 'failed') : 'completed',
    filesSeen,
    indexedCount,
    skippedCount,
    errors,
    startedAt,
    finishedAt,
  });
  return { files_seen: filesSeen, indexed: indexedCount, skipped: skippedCount, removed, errors, run };
}

export { normalizeTitle };
