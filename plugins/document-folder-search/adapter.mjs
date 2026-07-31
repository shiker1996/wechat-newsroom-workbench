import fs from 'node:fs';
import path from 'node:path';
import { failure, ok } from '../../lib/tools/schemas.mjs';

// 本地知识库检索（content.document.search）：
// 只读扫描用户明确授权的文档根目录（如 Obsidian vault），按关键词打分返回片段。
// 不建索引库——个人知识库量级（数千篇 Markdown）一次全量扫描仅数百毫秒；
// 审计侧只记录路径与命中数（执行日志本就只记参数名），正文不离开本机。

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
const SKIP_DIRECTORIES = new Set(['.obsidian', '.git', '.trash', 'node_modules', '.smart-env', '.canvas']);
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 1024 * 1024;
const SNIPPET_RADIUS = 120;

function terms(query) {
  return [...new Set(String(query).toLowerCase()
    .split(/[\s,，、。：:；;！？!?（）()\[\]【】"'“”]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2))];
}

function walk(root, collected = []) {
  if (collected.length >= MAX_FILES) return collected;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return collected; }
  for (const entry of entries) {
    if (collected.length >= MAX_FILES) break;
    if (entry.name.startsWith('.') && SKIP_DIRECTORIES.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) walk(full, collected);
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      try {
        const stat = fs.statSync(full);
        if (stat.size > 0 && stat.size <= MAX_FILE_BYTES) collected.push(full);
      } catch { /* 单文件不可读时跳过 */ }
    }
  }
  return collected;
}

function scoreDocument(content, basename, queryTerms) {
  const lower = content.toLowerCase();
  const name = basename.toLowerCase();
  let score = 0;
  let firstIndex = -1;
  for (const term of queryTerms) {
    if (name.includes(term)) score += 10;
    let index = lower.indexOf(term);
    let occurrences = 0;
    while (index !== -1 && occurrences < 20) {
      occurrences += 1;
      if (firstIndex === -1) firstIndex = index;
      index = lower.indexOf(term, index + term.length);
    }
    score += occurrences;
  }
  return { score, firstIndex };
}

function titleOf(content, basename) {
  const heading = content.match(/^#\s+(.+)$/m);
  return (heading ? heading[1].trim() : basename.replace(/\.[^.]+$/, '')) || basename;
}

function snippetOf(content, firstIndex) {
  const start = Math.max(0, (firstIndex === -1 ? 0 : firstIndex) - SNIPPET_RADIUS);
  const end = Math.min(content.length, (firstIndex === -1 ? 0 : firstIndex) + SNIPPET_RADIUS);
  const before = content.slice(0, start);
  const after = content.slice(0, end);
  const startLine = before.split('\n').length;
  const endLine = after.split('\n').length;
  const snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
  return { snippet, lineRange: `${startLine}-${endLine}` };
}

export async function execute(input) {
  const queryTerms = terms(input.query);
  if (!queryTerms.length) return failure('INVALID_INPUT', '查询词过短，至少需要 2 个字符的有效关键词');
  const root = String(input.root || '');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return failure('INVALID_INPUT', `知识库目录不存在或不是目录：${root}`);
  }
  const maxResults = Number.isInteger(input.maxResults) ? Math.min(Math.max(input.maxResults, 1), 10) : 5;
  const documents = [];
  for (const file of walk(root)) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const { score, firstIndex } = scoreDocument(content, path.basename(file), queryTerms);
    if (score <= 0) continue;
    documents.push({
      docId: path.relative(root, file).split(path.sep).join('/'),
      title: titleOf(content, path.basename(file)),
      ...snippetOf(content, firstIndex),
      scope: root,
      score,
    });
  }
  documents.sort((left, right) => right.score - left.score || left.docId.localeCompare(right.docId));
  const hits = documents.slice(0, maxResults).map((item) => ({
    docId: item.docId, title: item.title, snippet: item.snippet,
    lineRange: item.lineRange, scope: item.scope, score: item.score,
  }));
  return ok(
    { documents: hits },
    {
      provenance: { provider: 'document-folder-search', query: String(input.query), root, searchedAt: new Date().toISOString() },
      warnings: hits.length ? [] : ['知识库中没有命中任何文档'],
    },
  );
}

export async function health() {
  return ok({ available: true, provider: 'document-folder-search', note: '需在 config.local.json 的 documentSearch.roots 中配置授权知识库目录' });
}
