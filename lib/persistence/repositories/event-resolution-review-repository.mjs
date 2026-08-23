function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

const DECISION_TYPES = new Set(['merge', 'split', 'misreport']);

export class EventResolutionReviewRepository {
  constructor(db) { this.db = db; }

  record({ batchId, eventId = '', decisionType, targetEventId = '', hotspotIds = [], reason = '', actor = 'editor', metadata = {} } = {}) {
    if (!batchId) throw new Error('人工校正必须关联批次');
    if (!DECISION_TYPES.has(decisionType)) throw new Error('人工校正类型无效');
    const ids = [...new Set((Array.isArray(hotspotIds) ? hotspotIds : []).map(Number).filter(Number.isFinite))];
    const now = new Date().toISOString();
    const result = this.db.prepare(`INSERT INTO event_resolution_decisions
      (batch_id,event_id,decision_type,target_event_id,hotspot_ids_json,reason,actor,metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(String(batchId), String(eventId || ''), decisionType, String(targetEventId || ''),
      JSON.stringify(ids), String(reason || ''), String(actor || 'editor'), JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {}), now);
    return this.get(Number(result.lastInsertRowid));
  }

  get(id) {
    const row = this.db.prepare('SELECT * FROM event_resolution_decisions WHERE id=?').get(Number(id));
    return row ? this.#map(row) : null;
  }

  list({ batchId = null, eventId = null, since = null, activeOnly = false, limit = 500 } = {}) {
    const where = []; const values = [];
    if (batchId) { where.push('batch_id=?'); values.push(String(batchId)); }
    if (eventId) { where.push('event_id=?'); values.push(String(eventId)); }
    if (since) { where.push('created_at>=?'); values.push(String(since)); }
    if (activeOnly) where.push('reverted_at IS NULL');
    values.push(Math.max(1, Math.min(5000, Number(limit) || 500)));
    const rows = this.db.prepare(`SELECT * FROM event_resolution_decisions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC,id DESC LIMIT ?`).all(...values);
    return rows.map((row) => this.#map(row));
  }

  revert(id) {
    const now = new Date().toISOString();
    const result = this.db.prepare('UPDATE event_resolution_decisions SET reverted_at=? WHERE id=? AND reverted_at IS NULL').run(now, Number(id));
    return result.changes ? this.get(id) : null;
  }

  #map(row) {
    return { ...row, hotspot_ids: parseJson(row.hotspot_ids_json, []), metadata: parseJson(row.metadata_json, {}) };
  }
}

export { DECISION_TYPES };
