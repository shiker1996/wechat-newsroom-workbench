/** Read-only cross-table queries for event-resolution operational metrics. */
export class EventResolutionQueryService {
  constructor(db) { this.db = db; }

  crossBatchRepeatPoolRate(batches = []) {
    const db = this.db;
    if (!db || !batches.length) return { candidateCount: 0, repeatCandidateCount: 0, rate: 0 };
    const ids = batches.map((batch) => batch.id);
    const placeholders = ids.map(() => '?').join(',');
    const candidates = db.prepare(`SELECT c.id,c.batch_id,b.batch_date,c.hotspot_id
      FROM candidates c JOIN batches b ON b.id=c.batch_id WHERE c.batch_id IN (${placeholders})`).all(...ids);
    const hotspotRows = db.prepare(`SELECT ch.candidate_row_id,ch.hotspot_id,eh.event_id
      FROM candidate_hotspots ch JOIN event_hotspots eh ON eh.hotspot_id=ch.hotspot_id
      WHERE ch.candidate_row_id IN (SELECT id FROM candidates WHERE batch_id IN (${placeholders}))`).all(...ids);
    const byCandidate = new Map();
    for (const row of hotspotRows) {
      if (!byCandidate.has(row.candidate_row_id)) byCandidate.set(row.candidate_row_id, new Set());
      byCandidate.get(row.candidate_row_id).add(row.event_id);
    }
    const eventHistory = db.prepare(`SELECT eh.event_id,b.batch_date FROM event_hotspots eh JOIN batches b ON b.id=eh.batch_id
      WHERE eh.event_id IS NOT NULL ORDER BY b.batch_date ASC`).all();
    const prior = new Map();
    for (const row of eventHistory) {
      if (!prior.has(row.event_id)) prior.set(row.event_id, []);
      prior.get(row.event_id).push(String(row.batch_date || ''));
    }
    let repeatCandidateCount = 0;
    let eligibleCandidateCount = 0;
    for (const candidate of candidates) {
      const events = byCandidate.get(candidate.id) || new Set();
      if (!events.size && Number.isFinite(Number(candidate.hotspot_id))) {
        const fallback = db.prepare('SELECT event_id FROM event_hotspots WHERE hotspot_id=?').all(Number(candidate.hotspot_id));
        for (const row of fallback) events.add(row.event_id);
      }
      if (!events.size) continue;
      eligibleCandidateCount += 1;
      const repeated = [...events].some((eventId) => (prior.get(eventId) || []).some((date) => date < String(candidate.batch_date || '')));
      if (repeated) repeatCandidateCount += 1;
    }
    return {
      candidateCount: eligibleCandidateCount,
      repeatCandidateCount,
      rate: eligibleCandidateCount ? repeatCandidateCount / eligibleCandidateCount : 0,
    };
  }
}
