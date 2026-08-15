// 批次彻底删除与缓存清理（开源清单 3.3）：影响范围、级联删除、遗留目录共享保护、缓存清理路由。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/core/store.mjs';
import { batchWorkspaceDirs, deleteBatchPermanently, getBatchDeleteImpact } from '../lib/domain/batch-deletion.mjs';
import { handleSystemRoutes } from '../lib/http/routes/system-routes.mjs';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'batch-delete-'));
}

function seedBatch(store, { id, date, lifecycle = 'active', type = 'regular' }) {
  const now = '2026-01-01T00:00:00Z';
  store.db.prepare(`INSERT INTO batches (id, batch_date, title, batch_type, status, lifecycle_status, stage, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'done', ?, 'deliver', '', ?, ?)`).run(id, date, `${id} 批次`, type, lifecycle, now, now);
}

function seedContent(store, batchId) {
  const now = '2026-01-01T00:00:00Z';
  store.db.prepare(`INSERT INTO hotspots (batch_id, source, title, created_at) VALUES (?, 'weibo', '热点A', ?)`).run(batchId, now);
  store.db.prepare(`INSERT INTO candidates (batch_id, candidate_id, created_at, updated_at) VALUES (?, 'CAND-A', ?, ?)`).run(batchId, now, now);
  const candidateId = store.db.prepare('SELECT id FROM candidates WHERE batch_id=?').get(batchId).id;
  store.db.prepare(`INSERT INTO documents (batch_id, candidate_row_id, kind, title, created_at, updated_at) VALUES (?, ?, 'article', '成稿A', ?, ?)`).run(batchId, candidateId, now, now);
  store.db.prepare(`INSERT INTO artifacts (batch_id, kind, name, file_path, modified_at) VALUES (?, 'article', 'a.md', ?, ?)`)
    .run(batchId, path.join(tmpdir(), `artifact-${batchId}.md`), now);
}

test('影响范围统计返回各表计数与产物目录', () => {
  const root = tmpdir();
  const store = new Store(path.join(root, 'test.db'));
  seedBatch(store, { id: 'b-1', date: '2026-01-01' });
  seedContent(store, 'b-1');
  fs.mkdirSync(path.join(root, 'articles', 'b-1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'articles', 'b-1', 'draft.md'), 'x');

  const impact = getBatchDeleteImpact(root, store, 'b-1');
  assert.equal(impact.batch.lifecycleStatus, 'active');
  assert.equal(impact.counts.hotspots, 1);
  assert.equal(impact.counts.candidates, 1);
  assert.equal(impact.counts.documents, 1);
  assert.equal(impact.counts.artifacts, 1);
  const articleDir = impact.directories.find((item) => item.dir.endsWith(path.join('articles', 'b-1')));
  assert.equal(articleDir.exists, true);
  assert.equal(articleDir.files, 1);
  assert.equal(getBatchDeleteImpact(root, store, 'missing'), null);
});

test('彻底删除级联清理子表、审计表脱钩保留、产物目录一并删除', () => {
  const root = tmpdir();
  const store = new Store(path.join(root, 'test.db'));
  seedBatch(store, { id: 'b-1', date: '2026-01-01', lifecycle: 'archived' });
  seedContent(store, 'b-1');
  const workDir = path.join(root, 'articles', 'b-1');
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, 'draft.md'), 'x');

  const result = deleteBatchPermanently(root, store, 'b-1');
  assert.equal(result.deleted, true);
  assert.ok(result.removedDirectories.some((dir) => dir === workDir));
  assert.equal(fs.existsSync(workDir), false);
  assert.equal(store.getBatch('b-1'), null);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM hotspots WHERE batch_id=?').get('b-1').n, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM candidates WHERE batch_id=?').get('b-1').n, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM documents WHERE batch_id=?').get('b-1').n, 0);
  const orphan = store.db.prepare('SELECT batch_id FROM artifacts WHERE kind=?').get('article');
  assert.equal(orphan.batch_id, null);
});

test('未归档批次拒绝彻底删除', () => {
  const root = tmpdir();
  const store = new Store(path.join(root, 'test.db'));
  seedBatch(store, { id: 'b-1', date: '2026-01-01', lifecycle: 'completed' });
  assert.throws(() => deleteBatchPermanently(root, store, 'b-1'), /已归档/);
  assert.ok(store.getBatch('b-1'));
});

test('按日期命名的遗留目录在多个批次共享时不纳入删除', () => {
  const root = tmpdir();
  const store = new Store(path.join(root, 'test.db'));
  seedBatch(store, { id: 'b-1', date: '2026-01-01', lifecycle: 'archived' });
  seedBatch(store, { id: 'b-2', date: '2026-01-01' });
  const legacyDir = path.join(root, 'topics', '2026-01-01-orchestrated');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'shared.json'), '{}');

  const batch = store.getBatch('b-1');
  const dirs = batchWorkspaceDirs(root, store, batch);
  const legacy = dirs.find((item) => item.dir === legacyDir);
  assert.equal(legacy.skipped, true);
  deleteBatchPermanently(root, store, 'b-1');
  assert.equal(fs.existsSync(legacyDir), true);

  // b-2 归档后成为同日唯一批次，遗留目录不再共享，可以随删除清理
  store.updateBatch('b-2', { lifecycle_status: 'archived' });
  deleteBatchPermanently(root, store, 'b-2');
  assert.equal(fs.existsSync(legacyDir), false);
});

function json(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

async function body(request) {
  let text = '';
  for await (const chunk of request) text += chunk;
  return text ? JSON.parse(text) : {};
}

async function startSystemRoutes(t, root) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    try {
      const handled = await handleSystemRoutes({
        request, response, pathname: url.pathname, searchParams: url.searchParams,
        root, config: {}, store: {}, json, body, binaryBody: body, createWorkbenchBackup: async () => {},
      });
      if (!handled) json(response, 404, { error: 'not found' });
    } catch (error) {
      if (!response.headersSent) json(response, 500, { error: error.message });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('缓存清理路由清空 github-cache 与 source-cache，拒绝未知类型', async (t) => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, 'data', 'github-cache'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data', 'source-cache'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'github-cache', 'a.json'), '{}');
  fs.writeFileSync(path.join(root, 'data', 'source-cache', 'b.json'), '{}');
  const base = await startSystemRoutes(t, root);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const bad = await fetch(`${base}/api/system/cache/clear`, { method: 'POST', body: JSON.stringify({ kind: 'workbench.db' }) });
  assert.equal(bad.status, 400);

  const ok = await fetch(`${base}/api/system/cache/clear`, { method: 'POST', body: JSON.stringify({ kind: 'all' }) });
  assert.equal(ok.status, 200);
  const result = await ok.json();
  assert.equal(result.cleared.reduce((sum, item) => sum + item.removed, 0), 2);
  assert.equal(fs.readdirSync(path.join(root, 'data', 'github-cache')).length, 0);
  assert.equal(fs.readdirSync(path.join(root, 'data', 'source-cache')).length, 0);
});

test('server.mjs 的批次删除路由保留生命周期与确认头双重校验', () => {
  const source = fs.readFileSync(new URL('../lib/http/routes/batch-routes.mjs', import.meta.url), 'utf8');
  assert.match(source, /\/api\\\/batches\\\/\(\[\^\/\]\+\)\\\/delete-impact/);
  assert.match(source, /只有已归档批次可以彻底删除/);
  assert.match(source, /localSecurity\?\.consume\(request, 'batch-delete'\)/);
});
