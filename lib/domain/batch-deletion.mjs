// 批次彻底删除：影响范围统计与不可逆清理（开源清单 3.3）。
// 可恢复的删除走「归档」（batches.lifecycle_status），本模块只服务已归档批次的彻底删除。
import fs from 'node:fs';
import path from 'node:path';
import { batchArticlesDir, batchTopicsDir, candidateArticleDir, candidateSocialCardDir } from '../core/workspace-paths.mjs';

function dirStats(dir) {
  if (!fs.existsSync(dir)) return { path: dir, exists: false, files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        files += 1;
        bytes += fs.statSync(full).size;
      }
    }
  };
  walk(dir);
  return { path: dir, exists: true, files, bytes };
}

// 收集批次占用的产物目录。按日期命名的遗留目录可能被同日其它批次共享（ID 目录隔离规则
// 生效前的历史数据），此时标记 skipped 不纳入删除，避免误删共享数据。
export function batchWorkspaceDirs(workspaceRoot, store, batch) {
  const sharedDate = store
    .listBatches(1000)
    .some((item) => item.id !== batch.id && item.batch_date === batch.batch_date);
  const resolved = [
    ['articles', batchArticlesDir(workspaceRoot, batch)],
    ['topics', batchTopicsDir(workspaceRoot, batch)],
  ];
  for (const candidate of store.listCandidates(batch.id, 'article')) {
    resolved.push(['articles', candidateArticleDir(workspaceRoot, batch, candidate)]);
  }
  for (const candidate of store.listCandidates(batch.id, 'social_cards')) {
    resolved.push(['social-cards', candidateSocialCardDir(workspaceRoot, batch, candidate)]);
  }
  const seen = new Set();
  const dirs = [];
  for (const [kind, dir] of resolved) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    const isLegacyDateDir = batch.batch_type !== 'breaking'
      && path.basename(dir).startsWith(String(batch.batch_date))
      && !path.basename(dir).startsWith(String(batch.id));
    dirs.push({ kind, dir, skipped: isLegacyDateDir && sharedDate });
  }
  return dirs;
}

export function getBatchDeleteImpact(workspaceRoot, store, batchId) {
  const batch = store.getBatch(batchId);
  if (!batch) return null;
  return {
    batch: {
      id: batch.id,
      title: batch.title,
      batchDate: batch.batch_date,
      lifecycleStatus: batch.lifecycle_status || 'active',
    },
    counts: store.getBatchDeleteCounts(batchId),
    directories: batchWorkspaceDirs(workspaceRoot, store, batch).map((entry) => ({
      ...entry,
      ...dirStats(entry.dir),
    })),
  };
}

// 调用方必须先完成生命周期与确认头校验（见 server.mjs DELETE /api/batches/:id）。
export function deleteBatchPermanently(workspaceRoot, store, batchId) {
  const batch = store.getBatch(batchId);
  if (!batch) return null;
  if ((batch.lifecycle_status || 'active') !== 'archived') {
    throw new Error('只有已归档批次可以彻底删除');
  }
  const removedDirectories = [];
  for (const entry of batchWorkspaceDirs(workspaceRoot, store, batch)) {
    if (entry.skipped || !fs.existsSync(entry.dir)) continue;
    fs.rmSync(entry.dir, { recursive: true, force: true });
    removedDirectories.push(entry.dir);
  }
  // 数据库行删除，子表由外键 ON DELETE CASCADE 清理，审计类表（model_calls 等）按 SET NULL 脱钩保留。
  store.deleteBatch(batchId);
  return { deleted: true, removedDirectories };
}
