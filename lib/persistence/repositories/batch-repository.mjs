export class BatchRepository {
  constructor(db) { this.db = db; }

  create({ date, title, note = '', batchType = 'regular', requestedTracks = ['article'] }) {
    const now = new Date().toISOString();
    const id = `${date}-${Math.random().toString(36).slice(2, 8)}`;
    this.db.prepare(`INSERT INTO batches
      (id, batch_date, title, batch_type, requested_tracks, status, stage, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'draft', 'collect', ?, ?, ?)`)
      .run(id, date, title, batchType, JSON.stringify(requestedTracks), note, now, now);
    return id;
  }

  list(limit = 60) {
    return this.db.prepare(`SELECT b.*,
      (SELECT COUNT(*) FROM hotspots h WHERE h.batch_id=b.id) AS hotspot_count,
      (SELECT COUNT(*) FROM artifacts a WHERE a.batch_id=b.id) AS artifact_count
      FROM batches b ORDER BY batch_date DESC, created_at DESC LIMIT ?`).all(limit);
  }

  latestActive() {
    return this.db.prepare(`SELECT b.*,
      (SELECT COUNT(*) FROM hotspots h WHERE h.batch_id=b.id) AS hotspot_count,
      (SELECT COUNT(*) FROM artifacts a WHERE a.batch_id=b.id) AS artifact_count
      FROM batches b WHERE b.lifecycle_status='active'
      ORDER BY batch_date DESC, created_at DESC LIMIT 1`).get() ?? null;
  }

  update(id, fields) {
    const allowed = ['title', 'status', 'lifecycle_status', 'stage', 'note', 'max_age_hours'];
    const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
    if (!entries.length) return false;
    entries.push(['updated_at', new Date().toISOString()]);
    this.db.prepare(`UPDATE batches SET ${entries.map(([key]) => `${key}=?`).join(', ')} WHERE id=?`)
      .run(...entries.map(([, value]) => value), id);
    return true;
  }

  deleteCounts(batchId) {
    const count = (sql) => this.db.prepare(sql).get(batchId)?.n ?? 0;
    return {
      hotspots: count('SELECT COUNT(*) AS n FROM hotspots WHERE batch_id=?'),
      candidates: count('SELECT COUNT(*) AS n FROM candidates WHERE batch_id=?'),
      documents: count('SELECT COUNT(*) AS n FROM documents WHERE batch_id=?'),
      sourceRuns: count('SELECT COUNT(*) AS n FROM source_runs WHERE batch_id=?'),
      subscriptionRuns: count('SELECT COUNT(*) AS n FROM subscription_runs WHERE batch_id=?'),
      modelCalls: count('SELECT COUNT(*) AS n FROM model_calls WHERE batch_id=?'),
      aiRuns: count('SELECT COUNT(*) AS n FROM ai_runs WHERE batch_id=?'),
      artifacts: count('SELECT COUNT(*) AS n FROM artifacts WHERE batch_id=?'),
    };
  }

  delete(id) { return this.db.prepare('DELETE FROM batches WHERE id=?').run(id).changes > 0; }
}
