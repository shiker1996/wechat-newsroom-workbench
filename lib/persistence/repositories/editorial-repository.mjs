export class EditorialRepository {
  constructor(db) {
    this.db = db;
  }

  getArticle(candidateId) {
    return this.db.prepare('SELECT * FROM editorial_sessions WHERE candidate_row_id=?').get(candidateId) ?? {
      candidate_row_id: Number(candidateId), editor_question: '', confirmed_facts: '', author_opinions: '',
      confirmed_experiences: '', rejected_angles: '', open_questions: '', forbidden_claims: '',
      next_action: 'DISCUSS', experience_required: 0, brief_status: 'DISCUSS',
    };
  }

  saveArticle(candidateId, input) {
    const now = new Date().toISOString();
    const fields = ['editor_question', 'confirmed_facts', 'author_opinions', 'confirmed_experiences',
      'rejected_angles', 'open_questions', 'forbidden_claims', 'next_action', 'experience_required', 'brief_status'];
    const current = this.getArticle(candidateId);
    const values = fields.map((key) => {
      const value = input[key] ?? current[key];
      return key === 'experience_required' ? (value ? 1 : 0) : value;
    });
    this.db.prepare(`INSERT INTO editorial_sessions (candidate_row_id,${fields.join(',')},updated_at)
      VALUES (?,${fields.map(() => '?').join(',')},?)
      ON CONFLICT(candidate_row_id) DO UPDATE SET ${fields.map((key) => `${key}=excluded.${key}`).join(',')},updated_at=excluded.updated_at`)
      .run(candidateId, ...values, now);
    return this.getArticle(candidateId);
  }

  addMessage(candidateId, role, content) {
    const result = this.db.prepare('INSERT INTO editorial_messages (candidate_row_id,role,content,created_at) VALUES (?,?,?,?)')
      .run(candidateId, role, String(content), new Date().toISOString());
    return this.db.prepare('SELECT * FROM editorial_messages WHERE id=?').get(Number(result.lastInsertRowid));
  }

  listMessages(candidateId) {
    return this.db.prepare('SELECT * FROM editorial_messages WHERE candidate_row_id=? ORDER BY id').all(candidateId);
  }

  getCard(candidateId) {
    return this.db.prepare('SELECT * FROM card_editorial_sessions WHERE candidate_row_id=?').get(Number(candidateId)) ?? {
      candidate_row_id: Number(candidateId), target_reader: '', pain_point: '', tool_positioning: '', must_highlight: '',
      must_disclose: '', getting_started: '', forbidden_claims: '', output_mode: 'wechat-tool-cards', visual_style: 'ice-blue',
      composition_mode: 'smart', layout_style: 'auto', recommended_pages: 6, card_plan_json: '[]', status: 'DISCUSS', updated_at: '',
    };
  }

  saveCard(candidateId, input) {
    const current = this.getCard(candidateId);
    const now = new Date().toISOString();
    const fields = ['target_reader', 'pain_point', 'tool_positioning', 'must_highlight', 'must_disclose', 'getting_started',
      'forbidden_claims', 'output_mode', 'visual_style', 'composition_mode', 'layout_style', 'recommended_pages', 'card_plan_json', 'status'];
    const values = fields.map((key) => input[key] ?? current[key]);
    this.db.prepare(`INSERT INTO card_editorial_sessions (candidate_row_id,${fields.join(',')},updated_at)
      VALUES (?,${fields.map(() => '?').join(',')},?)
      ON CONFLICT(candidate_row_id) DO UPDATE SET ${fields.map((key) => `${key}=excluded.${key}`).join(',')},updated_at=excluded.updated_at`)
      .run(candidateId, ...values, now);
    return this.getCard(candidateId);
  }
}
