import { normalizeResearchPoints } from '../../../shared/domain/research-selection.mjs';

export class EditorialRepository {
  constructor(db) {
    this.db = db;
  }

  getArticle(candidateId) {
    const row = this.db.prepare('SELECT * FROM editorial_sessions WHERE candidate_row_id=?').get(candidateId) ?? {
      candidate_row_id: Number(candidateId), editor_question: '', confirmed_facts: '', research_basis: '', author_opinions: '',
      confirmed_experiences: '', rejected_angles: '', open_questions: '', forbidden_claims: '',
      adopted_research_points_json: '[]', next_action: 'DISCUSS', experience_required: 0, brief_status: 'DISCUSS',
    };
    const { adopted_research_points_json, ...editorial } = row;
    return { ...editorial, adopted_research_points: normalizeResearchPoints(adopted_research_points_json) };
  }

  saveArticle(candidateId, input) {
    const now = new Date().toISOString();
    // excluded_events 列保留在表结构中（避免动迁移历史），但机制已回滚，不再读写
    const fields = ['editor_question', 'confirmed_facts', 'research_basis', 'adopted_research_points_json', 'author_opinions', 'confirmed_experiences',
      'rejected_angles', 'open_questions', 'forbidden_claims', 'next_action', 'experience_required', 'brief_status'];
    const current = this.getArticle(candidateId);
    const values = fields.map((key) => {
      const sourceKey = key === 'adopted_research_points_json' ? 'adopted_research_points' : key;
      const value = key === 'adopted_research_points_json'
        ? JSON.stringify(normalizeResearchPoints(input[sourceKey] ?? current[sourceKey] ?? []))
        : input[sourceKey] ?? current[sourceKey];
      if (key === 'experience_required') return value ? 1 : 0;
      return value;
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
      must_disclose: '', getting_started: '', forbidden_claims: '', output_mode: 'wechat-tool-cards', visual_style: 'auto',
      composition_mode: 'smart', layout_style: 'auto', storyboard_theme_snapshot_json: '{}', recommended_pages: 6, card_plan_json: '[]', status: 'DISCUSS', updated_at: '',
    };
  }

  saveCard(candidateId, input) {
    const current = this.getCard(candidateId);
    const now = new Date().toISOString();
    const fields = ['target_reader', 'pain_point', 'tool_positioning', 'must_highlight', 'must_disclose', 'getting_started',
      'forbidden_claims', 'output_mode', 'visual_style', 'composition_mode', 'layout_style', 'storyboard_theme_snapshot_json', 'recommended_pages', 'card_plan_json', 'status'];
    const values = fields.map((key) => input[key] ?? current[key]);
    this.db.prepare(`INSERT INTO card_editorial_sessions (candidate_row_id,${fields.join(',')},updated_at)
      VALUES (?,${fields.map(() => '?').join(',')},?)
      ON CONFLICT(candidate_row_id) DO UPDATE SET ${fields.map((key) => `${key}=excluded.${key}`).join(',')},updated_at=excluded.updated_at`)
      .run(candidateId, ...values, now);
    return this.getCard(candidateId);
  }
}
