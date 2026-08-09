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

  saveDraft({ id, target, label, definitionJson }) {
    const now = new Date().toISOString(); const existing = this.get(id);
    if (existing) this.db.prepare("UPDATE theme_definitions SET target=?,label=?,draft_json=?,status=CASE WHEN status='archived' THEN 'draft' ELSE status END,updated_at=? WHERE id=?").run(target, label, definitionJson, now, id);
    else this.db.prepare("INSERT INTO theme_definitions(id,owner_scope,target,label,source,status,draft_json,created_at,updated_at) VALUES(?,'workspace',?,?,'user','draft',?,?,?)").run(id, target, label, definitionJson, now, now);
    return this.get(id);
  }

  publish({ id, version, definitionJson, contentHash }) {
    const now = new Date().toISOString(); this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare(`INSERT INTO theme_versions(theme_id,version,schema_version,definition_json,content_hash,status,created_at,published_at) VALUES(?,?,1,?,?,'published',?,?)`).run(id, version, definitionJson, contentHash, now, now);
      this.db.prepare("UPDATE theme_definitions SET active_version_id=?,status='published',draft_json=?,updated_at=? WHERE id=?").run(result.lastInsertRowid, definitionJson, now, id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.get(id);
  }

  archive(id) {
    const result = this.db.prepare("UPDATE theme_definitions SET status='archived',updated_at=? WHERE id=?").run(new Date().toISOString(), id);
    return result.changes ? this.get(id) : null;
  }

  versions(id) { return this.db.prepare('SELECT id,theme_id,version,schema_version,content_hash,status,created_at,published_at FROM theme_versions WHERE theme_id=? ORDER BY id DESC').all(id); }
  getVersion(id, version) { return this.db.prepare('SELECT * FROM theme_versions WHERE theme_id=? AND version=?').get(id, version) || null; }
  recordUsage({ themeId, version, target, source, batchId = null, candidateId = null }) { this.db.prepare('INSERT INTO theme_usage(theme_id,version,target,source,batch_id,candidate_row_id,used_at) VALUES(?,?,?,?,?,?,?)').run(themeId, version, target, source, batchId, candidateId, new Date().toISOString()); }

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
