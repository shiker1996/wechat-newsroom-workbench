function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function mergeIds(previous, next) {
  return [...new Set([...(Array.isArray(previous) ? previous : []), ...(Array.isArray(next) ? next : [])].map(String).filter(Boolean))];
}

function confidenceOf(event) {
  if (event.historical_match?.method === 'exact') return 'high';
  if (Number(event.historical_match?.score || 0) >= 90) return 'high';
  if (event.historical_match || (event.hotspot_ids || []).length > 1) return 'medium';
  return 'low';
}

export class EventResolutionRepository {
  constructor(db) { this.db = db; }

  upsertShadow(batchId, shadow) {
    if (!batchId || !shadow || shadow.status === 'error') return { events: 0, memberships: 0, skipped: true };
    const now = new Date().toISOString();
    const events = Array.isArray(shadow.events) ? shadow.events : [];
    const hotspotIds = [...new Set(events.flatMap((event) => event.hotspot_ids || []).map(Number).filter(Number.isFinite))];
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (hotspotIds.length) {
        const placeholders = hotspotIds.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM event_hotspots WHERE batch_id=? AND hotspot_id IN (${placeholders})`).run(batchId, ...hotspotIds);
      }
      const upsertEvent = this.db.prepare(`INSERT INTO event_records
        (id,canonical_key,title,who,action_type,object,first_seen_at,last_seen_at,last_update_at,status,confidence,event_state,legacy_ids_json,normalized_json,resolver_version,algorithm_version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET canonical_key=excluded.canonical_key,title=excluded.title,who=excluded.who,
        action_type=excluded.action_type,object=excluded.object,first_seen_at=CASE
          WHEN event_records.first_seen_at IS NULL THEN excluded.first_seen_at
          WHEN excluded.first_seen_at IS NULL THEN event_records.first_seen_at
          WHEN excluded.first_seen_at < event_records.first_seen_at THEN excluded.first_seen_at
          ELSE event_records.first_seen_at END,
        last_seen_at=CASE
          WHEN event_records.last_seen_at IS NULL THEN excluded.last_seen_at
          WHEN excluded.last_seen_at IS NULL THEN event_records.last_seen_at
          WHEN excluded.last_seen_at > event_records.last_seen_at THEN excluded.last_seen_at
          ELSE event_records.last_seen_at END,
        last_update_at=CASE WHEN excluded.event_state IN ('new_event','new_update') THEN excluded.last_update_at ELSE NULL END,status=excluded.status,
        confidence=excluded.confidence,event_state=excluded.event_state,legacy_ids_json=excluded.legacy_ids_json,
        normalized_json=excluded.normalized_json,resolver_version=excluded.resolver_version,
        algorithm_version=excluded.algorithm_version,updated_at=excluded.updated_at`);
      const upsertMembership = this.db.prepare(`INSERT INTO event_hotspots
        (event_id,hotspot_id,batch_id,relation,match_method,match_confidence,is_new_information,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(event_id,hotspot_id) DO UPDATE SET batch_id=excluded.batch_id,relation=excluded.relation,
        match_method=excluded.match_method,match_confidence=excluded.match_confidence,
        is_new_information=excluded.is_new_information,updated_at=excluded.updated_at`);
      let memberships = 0;
      for (const event of events) {
        const normalized = event.normalized || {};
        const previous = this.db.prepare('SELECT legacy_ids_json FROM event_records WHERE id=?').get(event.event_id);
        const legacyIds = mergeIds(parseJson(previous?.legacy_ids_json, []), event.legacy_event_ids || []);
        const historicalMatch = event.historical_match || null;
        const eventState = historicalMatch ? (event.update_type === 'new_update' ? 'new_update' : 'continuing') : 'new_event';
        upsertEvent.run(event.event_id, event.canonical_key || '', event.title || '', normalized.whoKey || '', normalized.actionType || '其他',
          normalized.objectKey || '', event.first_seen_at || null, event.last_seen_at || null,
          eventState === 'new_update' || eventState === 'new_event' ? event.last_seen_at || null : null, 'active', confidenceOf(event), eventState,
          JSON.stringify(legacyIds), JSON.stringify(normalized), shadow.resolver_version || '', shadow.algorithm_version || '', now, now);
        const method = historicalMatch?.method || ((event.hotspot_ids || []).length > 1 ? 'structured' : 'exact');
        const matchConfidence = historicalMatch ? Math.min(1, Math.max(0, Number(historicalMatch.score || 0) / 100)) : ((event.hotspot_ids || []).length > 1 ? 0.82 : 0.5);
        for (const [index, hotspotId] of (event.hotspot_ids || []).entries()) {
          const numericId = Number(hotspotId);
          if (!Number.isFinite(numericId)) continue;
          upsertMembership.run(event.event_id, numericId, batchId, index === 0 ? 'primary' : 'duplicate', method, matchConfidence,
            event.event_state === 'new_event' || event.event_state === 'new_update' ? 1 : 0, now, now);
          memberships += 1;
        }
      }
      this.db.exec('COMMIT');
      return { events: events.length, memberships, skipped: false };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  get(eventId) {
    const row = this.db.prepare('SELECT * FROM event_records WHERE id=?').get(eventId);
    if (!row) return null;
    return { ...row, legacy_ids: parseJson(row.legacy_ids_json, []), normalized: parseJson(row.normalized_json, {}) };
  }

  list({ status = null, limit = 200 } = {}) {
    const rows = status
      ? this.db.prepare('SELECT * FROM event_records WHERE status=? ORDER BY COALESCE(last_update_at,last_seen_at) DESC LIMIT ?').all(status, limit)
      : this.db.prepare('SELECT * FROM event_records ORDER BY COALESCE(last_update_at,last_seen_at) DESC LIMIT ?').all(limit);
    return rows.map((row) => ({ ...row, legacy_ids: parseJson(row.legacy_ids_json, []), normalized: parseJson(row.normalized_json, {}) }));
  }

  listHotspots({ eventId = null, batchId = null, limit = 100000 } = {}) {
    const where = []; const values = [];
    if (eventId) { where.push('event_id=?'); values.push(eventId); }
    if (batchId) { where.push('batch_id=?'); values.push(batchId); }
    values.push(limit);
    return this.db.prepare(`SELECT eh.*, b.batch_date FROM event_hotspots eh LEFT JOIN batches b ON b.id=eh.batch_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY eh.created_at DESC LIMIT ?`).all(...values);
  }
}
