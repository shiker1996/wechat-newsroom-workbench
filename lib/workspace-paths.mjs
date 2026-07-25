import fs from 'node:fs';
import path from 'node:path';

export function batchWorkspaceStem(batch) {
  return batch?.id || batch?.batch_date;
}

// 同日常规批次共享 topics 目录曾导致事件卡/进度串档：现在一律按批次 ID 隔离。
// 兼容规则：批次 ID 目录不存在、且存在按日期命名的历史目录时，回退到历史目录（旧批次数据仍可读写）。
export function batchTopicsDir(workspaceRoot, batch) {
  const idDir = path.join(workspaceRoot, 'topics', `${batch.id}-orchestrated`);
  if (batch?.batch_type === 'breaking') return idDir;
  if (fs.existsSync(idDir)) return idDir;
  const legacyDir = path.join(workspaceRoot, 'topics', `${batch.batch_date}-orchestrated`);
  return fs.existsSync(legacyDir) ? legacyDir : idDir;
}

function candidateDir(workspaceRoot, kind, batch, candidate) {
  const suffix = candidate.candidate_id.toLowerCase();
  const idDir = path.join(workspaceRoot, kind, `${batch.id}-${suffix}`);
  if (batch?.batch_type === 'breaking') return idDir;
  if (fs.existsSync(idDir)) return idDir;
  const legacyDir = path.join(workspaceRoot, kind, `${batch.batch_date}-${suffix}`);
  return fs.existsSync(legacyDir) ? legacyDir : idDir;
}

// 无候选的批次级文稿目录同样按批次 ID 隔离，避免同日多批次共用 articles/<date>/ 互相覆盖。
export function batchArticlesDir(workspaceRoot, batch) {
  const idDir = path.join(workspaceRoot, 'articles', batch.id);
  if (batch?.batch_type === 'breaking') return idDir;
  if (fs.existsSync(idDir)) return idDir;
  const legacyDir = path.join(workspaceRoot, 'articles', batch.batch_date);
  return fs.existsSync(legacyDir) ? legacyDir : idDir;
}

export function candidateArticleDir(workspaceRoot, batch, candidate) {
  return candidateDir(workspaceRoot, 'articles', batch, candidate);
}

export function candidateSocialCardDir(workspaceRoot, batch, candidate) {
  return candidateDir(workspaceRoot, 'social-cards', batch, candidate);
}
