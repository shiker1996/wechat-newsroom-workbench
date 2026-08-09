import { DatabaseSync } from 'node:sqlite';

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export class DatabaseRestoreService {
  constructor(db) {
    this.db = db;
  }

  restore(backupPath) {
    const sourceDb = new DatabaseSync(backupPath, { readOnly: true });
    try {
      const current = this.db.prepare("SELECT name,sql FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      const source = sourceDb.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      if (JSON.stringify(current) !== JSON.stringify(source)) throw new Error('备份数据库结构与当前版本不匹配');
      const violations = sourceDb.prepare('PRAGMA foreign_key_check').all();
      if (violations.length) throw new Error('备份数据库存在关联完整性错误');
      const snapshots = current.map(({ name }) => ({
        name,
        columns: sourceDb.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all().map((item) => item.name),
        rows: sourceDb.prepare(`SELECT * FROM ${quoteIdentifier(name)}`).all(),
      }));
      this.db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
      try {
        for (const { name } of current.slice().reverse()) this.db.exec(`DELETE FROM ${quoteIdentifier(name)}`);
        for (const table of snapshots) {
          if (!table.rows.length) continue;
          const quotedColumns = table.columns.map(quoteIdentifier).join(',');
          const placeholders = table.columns.map(() => '?').join(',');
          const insert = this.db.prepare(`INSERT INTO ${quoteIdentifier(table.name)} (${quotedColumns}) VALUES (${placeholders})`);
          for (const row of table.rows) insert.run(...table.columns.map((name) => row[name]));
        }
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      } finally {
        this.db.exec('PRAGMA foreign_keys=ON');
      }
    } finally {
      sourceDb.close();
    }
    return this.db.prepare('SELECT COUNT(*) AS count FROM batches').get();
  }
}
