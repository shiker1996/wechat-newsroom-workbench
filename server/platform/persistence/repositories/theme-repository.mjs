function parseJson(value, fallback = null) { try { return JSON.parse(value); } catch { return fallback; } }

export class ThemeRepository {
  constructor(db) { this.db = db; }

  list({ target = null, includeArchived = false } = {}) {
    const where = []; const params = [];
    if (target) { where.push('d.target=?'); params.push(target); }
    if (!includeArchived) where.push("d.status!='archived'");
    return this.db.prepare(`SELECT d.*,v.version AS active_version,v.definition_json AS active_definition_json,v.content_hash AS active_hash
      FROM theme_definitions d LEFT JOIN theme_versions v ON v.id=d.active_version_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY d.updated_at DESC`).all(...params);
  }

  get(id) {
    return this.db.prepare(`SELECT d.*,v.version AS active_version,v.definition_json AS active_definition_json,v.content_hash AS active_hash
      FROM theme_definitions d LEFT JOIN theme_versions v ON v.id=d.active_version_id WHERE d.id=?`).get(id) || null;
  }

  saveDraft({ id, target, label, definitionJson, metadata = null }) {
    const now = new Date().toISOString(); const existing = this.get(id);
    if (existing) this.db.prepare("UPDATE theme_definitions SET target=?,label=?,draft_json=?,status=CASE WHEN status='archived' THEN 'draft' ELSE status END,updated_at=? WHERE id=?").run(target, label, definitionJson, now, id);
    else this.db.prepare("INSERT INTO theme_definitions(id,owner_scope,target,label,source,status,draft_json,created_at,updated_at) VALUES(?,'workspace',?,?,'user','draft',?,?,?)").run(id, target, label, definitionJson, now, now);
    if (metadata) this.saveMetadata({ themeId: id, metadata });
    return this.get(id);
  }

  publish({ id, version, definitionJson, contentHash, metadata = null }) {
    const now = new Date().toISOString(); this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare(`INSERT INTO theme_versions(theme_id,version,schema_version,definition_json,content_hash,status,created_at,published_at) VALUES(?,?,1,?,?,'published',?,?)`).run(id, version, definitionJson, contentHash, now, now);
      this.db.prepare("UPDATE theme_definitions SET active_version_id=?,status='published',draft_json=?,updated_at=? WHERE id=?").run(result.lastInsertRowid, definitionJson, now, id);
      this.saveVersionMetadata({ themeVersionId: result.lastInsertRowid, metadata: metadata || this.getMetadata(id) || {} });
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.get(id);
  }

  archive(id) {
    const result = this.db.prepare("UPDATE theme_definitions SET status='archived',updated_at=? WHERE id=?").run(new Date().toISOString(), id);
    return result.changes ? this.get(id) : null;
  }

  versions(id) {
    return this.db.prepare(`SELECT v.id,v.theme_id,v.version,v.schema_version,v.content_hash,v.status,v.created_at,v.published_at,m.metadata_json
      FROM theme_versions v LEFT JOIN theme_version_metadata m ON m.theme_version_id=v.id WHERE v.theme_id=? ORDER BY v.id DESC`).all(id).map((row) => ({ ...row, metadata: parseJson(row.metadata_json, null) }));
  }
  getVersion(id, version) { return this.db.prepare('SELECT * FROM theme_versions WHERE theme_id=? AND version=?').get(id, version) || null; }
  getMetadata(themeId) {
    const row = this.db.prepare('SELECT * FROM theme_metadata WHERE theme_id=?').get(themeId);
    if (!row) return null;
    return { schemaVersion: 1, creationMethod: row.creation_method, basedOn: parseJson(row.based_on_json, null), intent: parseJson(row.intent_json, {}), aiProvenance: parseJson(row.ai_provenance_json, {}), designSummary: parseJson(row.design_summary_json, []), repairs: parseJson(row.repairs_json, []), templateMatchEvidence: parseJson(row.template_match_evidence_json, {}) };
  }
  saveMetadata({ themeId, metadata }) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO theme_metadata(theme_id,creation_method,based_on_json,intent_json,ai_provenance_json,design_summary_json,repairs_json,template_match_evidence_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(theme_id) DO UPDATE SET creation_method=excluded.creation_method,based_on_json=excluded.based_on_json,intent_json=excluded.intent_json,ai_provenance_json=excluded.ai_provenance_json,design_summary_json=excluded.design_summary_json,repairs_json=excluded.repairs_json,template_match_evidence_json=excluded.template_match_evidence_json,updated_at=excluded.updated_at`).run(
      themeId, metadata.creationMethod || 'manual', JSON.stringify(metadata.basedOn || null), JSON.stringify(metadata.intent || {}), JSON.stringify(metadata.aiProvenance || {}), JSON.stringify(metadata.designSummary || []), JSON.stringify(metadata.repairs || []), JSON.stringify(metadata.templateMatchEvidence || {}), now, now,
    );
    return this.getMetadata(themeId);
  }
  getVersionMetadata(themeVersionId) {
    const row = this.db.prepare('SELECT metadata_json FROM theme_version_metadata WHERE theme_version_id=?').get(themeVersionId);
    return row ? parseJson(row.metadata_json, {}) : null;
  }
  saveVersionMetadata({ themeVersionId, metadata }) {
    this.db.prepare(`INSERT INTO theme_version_metadata(theme_version_id,metadata_json,created_at) VALUES(?,?,?)
      ON CONFLICT(theme_version_id) DO UPDATE SET metadata_json=excluded.metadata_json`).run(themeVersionId, JSON.stringify(metadata || {}), new Date().toISOString());
    return this.getVersionMetadata(themeVersionId);
  }
  recordUsage({ themeId, version, target, source, batchId = null, candidateId = null }) { this.db.prepare('INSERT INTO theme_usage(theme_id,version,target,source,batch_id,candidate_row_id,used_at) VALUES(?,?,?,?,?,?,?)').run(themeId, version, target, source, batchId, candidateId, new Date().toISOString()); }

  getRoutingDecision({ batchId = null, candidateId = null, target, contentHash }) {
    const candidateKey = candidateId == null ? 'daily' : String(candidateId);
    return this.db.prepare(`SELECT * FROM theme_routing_decisions
      WHERE batch_id IS ? AND candidate_key=? AND target=? AND content_hash=?
      ORDER BY id DESC LIMIT 1`).get(batchId, candidateKey, target, contentHash) || null;
  }

  saveRoutingDecision({ batchId = null, candidateId = null, candidateKey, target, contentHash, mode = 'auto', selectedThemeId, rankedThemes = [], reason = '' }) {
    const key = candidateKey || (candidateId == null ? 'daily' : String(candidateId));
    this.db.prepare(`INSERT OR IGNORE INTO theme_routing_decisions
      (batch_id,candidate_row_id,candidate_key,target,content_hash,mode,selected_theme_id,ranked_themes_json,reason,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      batchId, candidateId, key, target, contentHash, mode, selectedThemeId,
      JSON.stringify(rankedThemes), String(reason || ''), new Date().toISOString(),
    );
    return this.getRoutingDecision({ batchId, candidateId, target, contentHash });
  }

  listRecentRouting({ target, limit = 8 }) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 8));
    return this.db.prepare(`SELECT * FROM theme_routing_decisions
      WHERE target=? AND mode='auto' ORDER BY created_at DESC,id DESC LIMIT ?`).all(target, safeLimit);
  }

  listBatchRouting({ batchId, target, candidateId = null }) {
    const rows = this.db.prepare(`SELECT * FROM theme_routing_decisions
      WHERE batch_id=? AND target=? ORDER BY created_at DESC,id DESC`).all(batchId, target);
    return candidateId == null ? rows : rows.filter((row) => Number(row.candidate_row_id) !== Number(candidateId));
  }

  usageStats(id) {
    const summary = this.db.prepare('SELECT COUNT(*) AS usage_count,MAX(used_at) AS last_used_at,COUNT(DISTINCT batch_id) AS batch_count FROM theme_usage WHERE theme_id=?').get(id);
    const versions = this.db.prepare('SELECT version,COUNT(*) AS usage_count,MAX(used_at) AS last_used_at FROM theme_usage WHERE theme_id=? GROUP BY version ORDER BY last_used_at DESC').all(id);
    return { usageCount: Number(summary.usage_count || 0), lastUsedAt: summary.last_used_at || null, batchCount: Number(summary.batch_count || 0), versions };
  }

  archiveImpact(id) {
    const theme = this.get(id); const usage = this.usageStats(id);
    return { themeId: id, exists: Boolean(theme), status: theme?.status || null, activeVersion: theme?.active_version || null,
      usageCount: usage.usageCount, batchCount: usage.batchCount, lastUsedAt: usage.lastUsedAt,
      historicalVersions: this.versions(id).length, canArchive: Boolean(theme && theme.status !== 'archived'),
      physicalDeleteAllowed: Boolean(theme && theme.status === 'archived' && usage.usageCount === 0) };
  }
}
