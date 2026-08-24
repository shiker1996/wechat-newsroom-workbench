export class CustomArticleRepository {
  constructor(db) {
    this.db = db;
  }

  find(batchId, { requestId = '', fingerprint = '' } = {}) {
    if (requestId) {
      const found = this.db.prepare('SELECT * FROM custom_article_requests WHERE batch_id=? AND request_id=?')
        .get(batchId, requestId);
      if (found) return found;
    }
    return fingerprint
      ? this.db.prepare('SELECT * FROM custom_article_requests WHERE batch_id=? AND fingerprint=?').get(batchId, fingerprint) ?? null
      : null;
  }

  create({ batchId, requestId, fingerprint }) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT OR IGNORE INTO custom_article_requests
      (batch_id,request_id,fingerprint,created_at,updated_at) VALUES (?,?,?,?,?)`)
      .run(batchId, requestId, fingerprint, now, now);
    return this.find(batchId, { requestId, fingerprint });
  }

  update(id, { candidateId, latestJobId } = {}) {
    const entries = [];
    if (candidateId !== undefined) entries.push(['candidate_row_id', candidateId]);
    if (latestJobId !== undefined) entries.push(['latest_job_id', latestJobId]);
    if (!entries.length) return this.get(id);
    entries.push(['updated_at', new Date().toISOString()]);
    this.db.prepare(`UPDATE custom_article_requests SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=?`)
      .run(...entries.map(([, value]) => value), id);
    return this.get(id);
  }

  get(id) {
    return this.db.prepare('SELECT * FROM custom_article_requests WHERE id=?').get(id) ?? null;
  }

  getByCandidate(candidateId) {
    return this.db.prepare('SELECT * FROM custom_article_requests WHERE candidate_row_id=? ORDER BY id DESC LIMIT 1')
      .get(Number(candidateId)) ?? null;
  }

  listProjects(batchId) {
    return this.db.prepare(`SELECT c.id,c.candidate_id,c.status,c.created_at,c.updated_at,
      h.title,ct.output_mode,ct.status AS track_status,
      r.latest_job_id,ar.status AS job_status,ar.progress AS job_progress,ar.error AS job_error,
      d.id AS document_id,d.kind AS document_kind,d.title AS document_title,d.updated_at AS document_updated_at
      FROM candidates c
      JOIN candidate_tracks ct ON ct.candidate_row_id=c.id AND ct.track='article'
      LEFT JOIN hotspots h ON h.id=c.hotspot_id
      LEFT JOIN custom_article_requests r ON r.candidate_row_id=c.id
      LEFT JOIN ai_runs ar ON ar.id=r.latest_job_id
      LEFT JOIN documents d ON d.id=(
        SELECT id FROM documents WHERE batch_id=c.batch_id AND candidate_row_id=c.id
        AND kind IN ('final','draft') ORDER BY CASE kind WHEN 'final' THEN 0 ELSE 1 END,updated_at DESC LIMIT 1
      )
      WHERE c.batch_id=? AND ct.output_mode IN ('wechat-experience','wechat-tutorial')
      ORDER BY c.updated_at DESC,c.id DESC`).all(batchId);
  }
}
