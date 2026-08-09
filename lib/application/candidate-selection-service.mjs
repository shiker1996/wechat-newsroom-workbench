function repositoryKey(url, rawJson = '') {
  let raw = {}; try { raw = JSON.parse(rawJson || '{}'); } catch {}
  const declared = String(raw.repository || '').trim().replace(/\.git$/i, '').toLowerCase();
  if (declared) return declared;
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.hostname.toLowerCase() !== 'github.com') return '';
    const parts = parsed.pathname.split('/').filter(Boolean).slice(0, 2);
    return parts.length === 2 ? parts.join('/').replace(/\.git$/i, '').toLowerCase() : '';
  } catch { return ''; }
}

export class CandidateSelectionService {
  constructor(db, repositories, candidateQueries) {
    this.db = db;
    this.repositories = repositories;
    this.candidateQueries = candidateQueries;
  }

  saveAnalyzed(batchId, records) {
    for (const item of records) {
      const ids = [...new Set((Array.isArray(item.hotspotIds) && item.hotspotIds.length
        ? item.hotspotIds : [item.hotspotId]).filter((value) => value != null).map(Number))];
      item._hotspotIds = ids;
      item._rowId = null;
      if (ids.length > 1) item._rowId = this.repositories.candidates.createComposite(batchId, ids, {
        title: item.title || '', poolRole: item.poolRole || '综合选题', tracks: ['article'], dimension: item.dimension || 'event',
      });
      else if (ids.length === 1) this.repositories.candidates.addFromHotspots(batchId, ids);
    }
    for (const item of records) {
      const row = item._rowId ? { id: item._rowId } : this.db.prepare('SELECT id FROM candidates WHERE batch_id=? AND hotspot_id=?')
        .get(batchId, item._hotspotIds?.[0] ?? item.hotspotId);
      if (!row) continue;
      this.repositories.candidates.update(row.id, { pool_role: item.poolRole, risk_level: item.riskLevel,
        angle: item.angle, thesis: item.thesis, distribution_lane: item.distributionLane || '推荐池',
        reader_stake: item.readerStake || '', h_score: item.h, b_score: item.b, p_score: item.p,
        s_score: item.s, d_score: item.d, f_score: item.f, status: 'analyzed' });
      const editorial = this.repositories.editorial.getArticle(row.id);
      if (!editorial.editor_question && item.editorQuestion) this.repositories.editorial.saveArticle(row.id,
        { ...editorial, editor_question: item.editorQuestion, next_action: 'DISCUSS', brief_status: 'DISCUSS' });
    }
    return this.candidateQueries.list(batchId);
  }

  saveSocialPreselection(batchId, records) {
    const selectedCandidateIds = [];
    const completedRepositories = new Set(this.db.prepare(`SELECT h.url,h.raw_json
      FROM artifacts a JOIN candidates c ON c.id=a.candidate_row_id JOIN hotspots h ON h.id=c.hotspot_id
      WHERE a.track='social_cards' AND a.name='my-design.html' AND a.status='ready' AND c.batch_id<>?`).all(batchId)
      .map((row) => repositoryKey(row.url, row.raw_json)).filter(Boolean));
    for (const item of records || []) {
      const hotspot = this.db.prepare('SELECT url,raw_json FROM hotspots WHERE id=? AND batch_id=?').get(item.hotspotId, batchId);
      const repository = repositoryKey(hotspot?.url, hotspot?.raw_json);
      if (repository && completedRepositories.has(repository)) continue;
      this.repositories.candidates.addFromHotspots(batchId, [item.hotspotId], { tracks: ['social_cards'] });
      const row = this.db.prepare('SELECT id FROM candidates WHERE batch_id=? AND hotspot_id=? ORDER BY id LIMIT 1')
        .get(batchId, item.hotspotId);
      if (!row) continue;
      selectedCandidateIds.push(row.id);
      this.repositories.candidates.addTracks(row.id, ['social_cards'], { status: 'pooled', score: item.socialScore ?? null,
        pool_role: 'AI 图文预选', output_mode: 'wechat-tool-cards' });
      if (item.socialScoreDetails) this.repositories.socialCandidates.saveScore(row.id, item.socialScoreDetails);
    }
    const placeholders = selectedCandidateIds.map(() => '?').join(',');
    this.db.prepare(`DELETE FROM candidate_tracks WHERE track='social_cards' AND pool_role='AI 图文预选'
      AND candidate_row_id IN (SELECT id FROM candidates WHERE batch_id=?)
      ${selectedCandidateIds.length ? `AND candidate_row_id NOT IN (${placeholders})` : ''}`)
      .run(batchId, ...selectedCandidateIds);
    return this.candidateQueries.list(batchId, 'social_cards');
  }
}
