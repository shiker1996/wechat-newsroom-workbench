import fs from 'node:fs';
import path from 'node:path';

const known = new Map([
  ['trends-raw.md', '热点原始数据'],
  ['topics-ranked.md', '选题榜单'],
  ['topics-selected.md', '选题决策'],
  ['editorial-agenda.md', '编辑议题'],
  ['editorial-decisions.md', '编辑决策'],
  ['article-brief.md', '锁定简报'],
  ['09-FINAL.md', '文章终稿'],
  ['04-draft.md', '文章初稿'],
  ['magazine-design-tokens.json', '杂志设计令牌'],
  ['article.ai.draft.html', '排版 HTML 初稿'],
  ['article.ai.html', '排版 HTML'],
  ['image-assets.json', '配图资产清单'],
  ['hotspot-overview.html', '热点全景'],
]);

function walk(root, maxDepth = 5, depth = 0) {
  if (depth > maxDepth || !fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'data') continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath, maxDepth, depth + 1));
    else if (known.has(entry.name)) files.push(fullPath);
  }
  return files;
}

function inferBatchId(filePath, batches) {
  const normalized = filePath.replaceAll('\\', '/').toLowerCase();
  // 同日多批次的目录按批次 ID 命名、共享日期前缀，必须先按完整批次 ID 匹配，否则文件会串到同日的其他批次。
  const byId = batches.find((batch) => normalized.includes(String(batch.id).toLowerCase()));
  if (byId) return byId.id;
  return batches.find((batch) => normalized.includes(batch.batch_date))?.id ?? null;
}

export function indexArtifacts(store, roots) {
  const batches = store.listBatches(1000);
  let indexed = 0;
  for (const root of [...new Set(roots.map((item) => path.resolve(item)))]) {
    for (const filePath of walk(root)) {
      const stat = fs.statSync(filePath);
      store.upsertArtifact({
        batchId: inferBatchId(filePath, batches),
        kind: known.get(path.basename(filePath)) ?? '其它',
        name: path.basename(filePath),
        path: filePath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
      indexed += 1;
    }
  }
  return indexed;
}

export function isInsideRoots(filePath, roots) {
  const resolved = path.resolve(filePath).toLowerCase();
  return roots.some((root) => {
    const base = path.resolve(root).toLowerCase();
    return resolved === base || resolved.startsWith(`${base}${path.sep}`);
  });
}
