import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../server/platform/core/config.mjs';
import { Store } from '../../server/platform/core/store.mjs';
import { runEventResolutionBackfill, writeEventResolutionBackfillReport } from '../../server/features/research/index.mjs';
import { clusterItems } from '../../server/features/research/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = loadConfig(root);
const args = new Set(process.argv.slice(2));
const valueOf = (name, fallback) => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
};
const limit = Math.max(1, Math.min(60, Number(valueOf('batches', 14)) || 14));
const workspaceRoot = path.resolve(valueOf('workspace', config.workspaceRoot));
const dbPath = path.resolve(valueOf('db', path.join(root, 'data', 'workbench.db')));
const apply = args.has('--apply');
const store = new Store(dbPath);
try {
  const report = runEventResolutionBackfill({ store, workspaceRoot, limit, apply, clusterItems });
  const reportPath = path.join(workspaceRoot, 'topics', 'event-resolution-backfill.json');
  writeEventResolutionBackfillReport(workspaceRoot, report);
  console.log(JSON.stringify({ ...report, report_path: reportPath }, null, 2));
  if (!apply) console.error('当前为 dry-run；确认报告后，追加 --apply 才会写入事件表并生成稳定事件卡。');
} finally {
  store.close();
}
