// 本地段落检索：把长正文切块后用 BM25 选出与当前问题最相关的段落，
// 供编辑室等场景替代「全文截断注入」。纯本地计算，无网络、无外部依赖。
// 分词策略：英文/数字按词，中文按 bigram（不引入分词库，召回优先）。

const CJK = /^[\u3400-\u4dbf\u4e00-\u9fff]$/;
const TOKEN_RE = /[a-zA-Z0-9_]+|[\u3400-\u4dbf\u4e00-\u9fff]/g;

export function tokenize(text) {
  const tokens = [];
  let prevCjk = '';
  for (const match of String(text || '').toLowerCase().matchAll(TOKEN_RE)) {
    const t = match[0];
    if (CJK.test(t)) {
      if (prevCjk) tokens.push(prevCjk + t);
      prevCjk = t;
    } else {
      tokens.push(t);
      prevCjk = '';
    }
  }
  return tokens;
}

// 按空行/换行切段，再打包到 chunkChars 左右；过长段落硬切。
export function chunkPassage(content, chunkChars = 500) {
  const paragraphs = String(content || '').split(/\n{2,}|\r?\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (paragraph.length > chunkChars) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < paragraph.length; i += chunkChars) chunks.push(paragraph.slice(i, i + chunkChars));
      continue;
    }
    if (current && current.length + paragraph.length + 2 > chunkChars) { chunks.push(current); current = ''; }
    current = current ? `${current}\n${paragraph}` : paragraph;
  }
  if (current) chunks.push(current);
  return chunks;
}

// BM25（k1=1.5, b=0.75），返回按原文顺序排列的 top-k 块索引。
export function bm25TopChunks(chunks, queryTokens, k = 4) {
  if (!chunks.length || !queryTokens.length) return [];
  const avgLen = chunks.reduce((sum, c) => sum + tokenize(c).length, 0) / chunks.length || 1;
  const df = new Map();
  const chunkTokens = chunks.map((c) => {
    const tf = new Map();
    for (const t of tokenize(c)) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return tf;
  });
  const scored = chunkTokens.map((tf, index) => {
    const len = [...tf.values()].reduce((a, b) => a + b, 0);
    let score = 0;
    for (const t of queryTokens) {
      const f = tf.get(t) || 0;
      if (!f) continue;
      const idf = Math.log(1 + (chunks.length - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
      score += idf * (f * 2.5) / (f + 1.5 * (1 - 0.75 + 0.75 * (len / avgLen)));
    }
    return { index, score };
  }).filter((item) => item.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((item) => item.index).sort((a, b) => a - b);
}

// 混合摘录：头部 headChars 原样保留（导语通常含核心事实），
// 其余部分若超出预算则用 BM25 选 top-k 相关块，按原文顺序以省略号衔接。
export function buildExcerpt(content, query, { k = 4, headChars = 1500, chunkChars = 500, maxCharsPerDoc = 6000 } = {}) {
  const text = String(content || '');
  if (text.length <= maxCharsPerDoc) return { excerpt: text, chunks: 1, totalChunks: 1 };
  const head = text.slice(0, headChars);
  const chunks = chunkPassage(text.slice(headChars), chunkChars);
  const picked = bm25TopChunks(chunks, tokenize(query), k);
  if (!picked.length) return { excerpt: text.slice(0, maxCharsPerDoc), chunks: 0, totalChunks: chunks.length + 1 };
  const parts = [head];
  let budget = maxCharsPerDoc - head.length;
  let lastIndex = -1;
  for (const index of picked) {
    const chunk = chunks[index];
    if (chunk.length > budget) break;
    if (index > lastIndex + 1 && lastIndex !== -1) parts.push('…');
    parts.push(chunk);
    budget -= chunk.length + 1;
    lastIndex = index;
  }
  return { excerpt: parts.join('\n'), chunks: picked.length, totalChunks: chunks.length + 1 };
}

export async function execute(input) {
  const { documents, query, k, headChars, chunkChars, maxCharsPerDoc } = input;
  const selections = documents.map((doc) => {
    const result = buildExcerpt(doc.content, query, { k, headChars, chunkChars, maxCharsPerDoc });
    return { id: doc.id, excerpt: result.excerpt, chunks: result.chunks, totalChunks: result.totalChunks };
  });
  return { status: 'ok', data: { selections }, artifacts: [], warnings: [], provenance: { plugin: 'local-passage-retrieval', via: 'local-bm25' } };
}

export async function health() {
  const probe = buildExcerpt('测试正文。'.repeat(2000), '测试');
  return probe.excerpt.length
    ? { status: 'ok', data: { available: true }, artifacts: [], warnings: [], provenance: { plugin: 'local-passage-retrieval' } }
    : { status: 'error', error: { code: 'OUTPUT_INVALID', message: '段落检索自检失败' } };
}

export default { execute, health };
