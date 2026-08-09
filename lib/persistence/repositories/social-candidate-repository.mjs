export class SocialCandidateRepository {
  constructor(db) {
    this.db = db;
  }

  getFactSheet(candidateId) {
    const row = this.db.prepare('SELECT * FROM repository_fact_sheets WHERE candidate_row_id=?').get(Number(candidateId));
    if (!row) return null;
    try { return { ...row, data: JSON.parse(row.data_json || '{}') }; }
    catch { return { ...row, data: {} }; }
  }

  saveFactSheet(candidateId, input) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO repository_fact_sheets
      (candidate_row_id,repository,source_url,status,data_json,checked_at,error,updated_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(candidate_row_id) DO UPDATE SET
      repository=excluded.repository,source_url=excluded.source_url,status=excluded.status,data_json=excluded.data_json,
      checked_at=excluded.checked_at,error=excluded.error,updated_at=excluded.updated_at`)
      .run(candidateId, input.repository || '', input.sourceUrl || '', input.status || 'ok',
        JSON.stringify(input.data || input), input.checkedAt || now, input.error || '', now);
    return this.getFactSheet(candidateId);
  }

  getScore(candidateId) {
    const row = this.db.prepare('SELECT * FROM candidate_social_scores WHERE candidate_row_id=?').get(Number(candidateId));
    if (!row) return null;
    try { return { ...row, score: JSON.parse(row.score_json || '{}') }; }
    catch { return { ...row, score: {} }; }
  }

  saveScore(candidateId, score) {
    const now = new Date().toISOString();
    const finalScore = score.finalScore ?? null;
    this.db.prepare(`INSERT INTO candidate_social_scores (candidate_row_id,score_json,final_score,updated_at)
      VALUES (?,?,?,?) ON CONFLICT(candidate_row_id) DO UPDATE SET
      score_json=excluded.score_json,final_score=excluded.final_score,updated_at=excluded.updated_at`)
      .run(candidateId, JSON.stringify(score), finalScore, now);
    this.db.prepare("UPDATE candidate_tracks SET score=?,updated_at=? WHERE candidate_row_id=? AND track='social_cards'")
      .run(finalScore, now, candidateId);
    return this.getScore(candidateId);
  }
}
