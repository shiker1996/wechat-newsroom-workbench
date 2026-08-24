export class VisualDecisionRepository {
  constructor(db) { this.db = db; }

  save({ batchId, candidateId = null, visualType, action, heading = '', purpose = '' }) {
    if (!['mermaid', 'echarts'].includes(visualType) || !['inserted', 'ignored'].includes(action)) {
      throw new Error('可视化决策无效');
    }
    const result = this.db.prepare(`INSERT INTO visual_decisions
      (batch_id,candidate_row_id,visual_type,action,heading,purpose,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run(batchId, candidateId, visualType, action, String(heading), String(purpose), new Date().toISOString());
    return this.db.prepare('SELECT * FROM visual_decisions WHERE id=?').get(result.lastInsertRowid);
  }

  stats() {
    return this.db.prepare(`SELECT visual_type,
      SUM(CASE WHEN action='inserted' THEN 1 ELSE 0 END) AS inserted,
      SUM(CASE WHEN action='ignored' THEN 1 ELSE 0 END) AS ignored
      FROM visual_decisions GROUP BY visual_type`).all();
  }
}
