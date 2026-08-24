// 跨版本验收样例（开源清单 3.1）：数据库幂等迁移、技能包与工具插件的 schemaVersion/compatibleApp 判定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/platform/core/store.mjs';
import { validateSkillPackageDirectory } from '../server/platform/skills/package-manager.mjs';
import { validateToolPluginDirectory } from '../server/platform/tools/package-manager.mjs';
import { APP_VERSION } from '../server/platform/version.mjs';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'version-compat-'));
}

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

test('应用版本唯一来源是 package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(APP_VERSION, pkg.version);
});

test('旧版数据库（batches/hotspots 缺后期列）经幂等迁移后结构补全且数据保留', () => {
  const dbPath = path.join(tmpdir(), 'old.db');
  const db = new DatabaseSync(dbPath);
  // 模拟 0.0.1 时代的库：batches 无 batch_type/requested_tracks/max_age_hours/lifecycle_status，
  // hotspots 无 source_group/source_type/source_name/research_eligible。
  db.exec(`
    CREATE TABLE batches (
      id TEXT PRIMARY KEY,
      batch_date TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      stage TEXT NOT NULL DEFAULT 'collect',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO batches (id, batch_date, title, status, stage, note, created_at, updated_at)
      VALUES ('b-old', '2026-01-01', '旧批次', 'done', 'deliver', '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    CREATE TABLE hotspots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      source TEXT NOT NULL,
      external_id TEXT,
      title TEXT NOT NULL,
      url TEXT,
      category TEXT NOT NULL DEFAULT '待分类',
      market_scope TEXT NOT NULL DEFAULT '待标注',
      score REAL,
      published_at TEXT,
      raw_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(batch_id, source, title)
    );
    INSERT INTO hotspots (batch_id, source, title, created_at)
      VALUES ('b-old', 'weibo', '旧热点', '2026-01-01T00:00:00Z');
  `);
  db.close();

  const store = new Store(dbPath);
  const batchColumns = new Set(store.db.prepare('PRAGMA table_info(batches)').all().map((c) => c.name));
  for (const col of ['batch_type', 'requested_tracks', 'lifecycle_status']) {
    assert.ok(batchColumns.has(col), `batches 迁移后缺列 ${col}`);
  }
  const hotspotColumns = new Set(store.db.prepare('PRAGMA table_info(hotspots)').all().map((c) => c.name));
  for (const col of ['source_group', 'source_type', 'source_name', 'research_eligible']) {
    assert.ok(hotspotColumns.has(col), `hotspots 迁移后缺列 ${col}`);
  }
  const batch = store.db.prepare('SELECT * FROM batches WHERE id = ?').get('b-old');
  assert.equal(batch.title, '旧批次');
  assert.equal(batch.lifecycle_status, 'active');
  assert.equal(batch.batch_type, 'regular');
  const hotspot = store.db.prepare('SELECT * FROM hotspots WHERE title = ?').get('旧热点');
  assert.equal(hotspot.batch_id, 'b-old');
  assert.equal(hotspot.research_eligible, 1);
});

const skillExample = fileURLToPath(new URL('../docs/examples/skill-package', import.meta.url));
const pluginExample = fileURLToPath(new URL('../docs/examples/tool-plugin', import.meta.url));

function skillPackageWith(overrides) {
  const dir = path.join(tmpdir(), 'skill');
  copyDir(skillExample, dir);
  const manifestPath = path.join(dir, 'skill.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  Object.assign(manifest, overrides);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

function pluginPackageWith(overrides) {
  const dir = path.join(tmpdir(), 'plugin');
  copyDir(pluginExample, dir);
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  Object.assign(manifest, overrides);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

test('当前版本契约的技能包与插件包通过校验', () => {
  const skill = validateSkillPackageDirectory(skillPackageWith({}));
  assert.ok(skill.contentHash.startsWith('sha256:'));
  assert.equal(skill.manifest.schemaVersion, 1);
  const plugin = validateToolPluginDirectory(pluginPackageWith({}));
  assert.ok(plugin.contentHash.startsWith('sha256:'));
  assert.equal(plugin.manifest.schemaVersion, 1);
});

test('compatibleApp 高于当前版本的技能包与插件包被明确拒绝', () => {
  assert.throws(() => validateSkillPackageDirectory(skillPackageWith({ compatibleApp: '>=99.0.0' })), /技能需要/);
  assert.throws(() => validateToolPluginDirectory(pluginPackageWith({ compatibleApp: '>=99.0.0' })), /插件需要/);
});

test('未知 schemaVersion 的技能包与插件包被明确拒绝', () => {
  assert.throws(() => validateSkillPackageDirectory(skillPackageWith({ schemaVersion: 2 })));
  assert.throws(() => validateToolPluginDirectory(pluginPackageWith({ schemaVersion: 2 })), /schemaVersion 1/);
});
