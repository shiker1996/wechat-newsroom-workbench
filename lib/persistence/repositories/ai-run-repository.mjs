export class AiRunRepository {
  constructor(db) { this.db = db; }

  create({ id, batchId, type, provider }) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO ai_runs (id,batch_id,type,provider,status,progress,created_at,updated_at)
      VALUES (?,?,?,?, 'running','准备执行',?,?)`).run(id, batchId, type, provider, now, now);
    return this.get(id);
  }

  update(id, fields) {
    const allowed = ['status', 'progress', 'result_json', 'error'];
    const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
    if (!entries.length) return this.get(id);
    entries.push(['updated_at', new Date().toISOString()]);
    this.db.prepare(`UPDATE ai_runs SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=?`)
      .run(...entries.map(([, value]) => value), id);
    return this.get(id);
  }

  get(id) { return this.db.prepare('SELECT * FROM ai_runs WHERE id=?').get(id) ?? null; }

  listByBatch(batchId, limit = 30) {
    return this.db.prepare('SELECT * FROM ai_runs WHERE batch_id=? ORDER BY created_at DESC LIMIT ?').all(batchId, limit);
  }

  listRecent(limit = 30) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 30));
    return this.db.prepare('SELECT * FROM ai_runs ORDER BY updated_at DESC LIMIT ?').all(safeLimit);
  }

  listRecentWork(limit = 40) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 40));
    return this.db.prepare(`SELECT id, 'ai' AS run_kind, batch_id, type, provider, status, progress,
      error, created_at, updated_at FROM ai_runs
      UNION ALL
      SELECT 'source:' || id, 'source' AS run_kind, batch_id, source, source, status,
      CASE WHEN status='success' THEN '采集完成' ELSE COALESCE(error, status) END,
      error, started_at, COALESCE(ended_at, started_at) FROM source_runs
      ORDER BY updated_at DESC LIMIT ?`).all(safeLimit);
  }
}
