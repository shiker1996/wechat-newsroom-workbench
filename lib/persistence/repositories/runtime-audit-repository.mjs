export class RuntimeAuditRepository {
  constructor(db) { this.db = db; }

  recordModelCall(input) {
    const snapshotId = input.generationSnapshotId ?? (input.batchId ? this.db.prepare(`SELECT id FROM generation_snapshots
      WHERE batch_id=? AND ((? IS NULL AND candidate_row_id IS NULL) OR candidate_row_id=?)
      ORDER BY id DESC LIMIT 1`).get(input.batchId, input.candidateId ?? null, input.candidateId ?? null)?.id : null);
    const result = this.db.prepare(`INSERT INTO model_calls
      (provider,model,purpose,batch_id,candidate_row_id,estimated_input_tokens,prompt_tokens,
       completion_tokens,reasoning_tokens,compressed,latency_ms,status,error,generation_snapshot_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.provider, input.model, input.purpose || 'unknown', input.batchId ?? null, input.candidateId ?? null,
      input.estimatedInputTokens ?? 0, input.promptTokens ?? null, input.completionTokens ?? null,
      input.reasoningTokens ?? null, input.compressed ? 1 : 0, input.latencyMs ?? 0, input.status,
      input.error ?? null, snapshotId ?? null, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  updateModelCall(id, fields) {
    const entries = Object.entries(fields).filter(([key]) => ['status', 'error'].includes(key));
    if (!entries.length) return;
    this.db.prepare(`UPDATE model_calls SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=?`)
      .run(...entries.map(([, value]) => value), id);
  }

  listModelCalls(limit = 100) { return this.db.prepare('SELECT * FROM model_calls ORDER BY id DESC LIMIT ?').all(limit); }

  saveSnapshot({ batchId = null, candidateId = null, purpose, snapshot }) {
    const now = new Date().toISOString();
    const result = this.db.prepare(`INSERT INTO generation_snapshots
      (batch_id,candidate_row_id,purpose,snapshot_json,created_at) VALUES (?,?,?,?,?)`)
      .run(batchId, candidateId, purpose, JSON.stringify(snapshot), now);
    return { id: Number(result.lastInsertRowid), batchId, candidateId, purpose, snapshot, createdAt: now };
  }

  listSnapshots({ batchId = null, candidateId = null, limit = 50 } = {}) {
    const where = []; const values = [];
    if (batchId) { where.push('batch_id=?'); values.push(batchId); }
    if (candidateId) { where.push('candidate_row_id=?'); values.push(candidateId); }
    values.push(Math.min(200, Math.max(1, Number(limit) || 50)));
    return this.db.prepare(`SELECT * FROM generation_snapshots ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`)
      .all(...values).map((row) => ({ ...row, snapshot: JSON.parse(row.snapshot_json) }));
  }

  getSnapshot(id) {
    const row = this.db.prepare('SELECT * FROM generation_snapshots WHERE id=?').get(id);
    return row ? { ...row, snapshot: JSON.parse(row.snapshot_json) } : null;
  }

  findLatestSnapshot({ batchId, candidateId = null, purposes = [] }) {
    if (!batchId || !purposes.length) return null;
    const row = this.db.prepare(`SELECT * FROM generation_snapshots
      WHERE batch_id=? AND ((? IS NULL AND candidate_row_id IS NULL) OR candidate_row_id=?)
        AND purpose IN (${purposes.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`)
      .get(batchId, candidateId, candidateId, ...purposes);
    return row ? { ...row, snapshot: JSON.parse(row.snapshot_json) } : null;
  }

  saveToolExecution({ batchId = null, candidateId = null, generationSnapshotId = null, skillId = null, record }) {
    const result = this.db.prepare(`INSERT INTO tool_executions
      (batch_id,candidate_row_id,generation_snapshot_id,skill_id,capability,plugin,plugin_version,status,error_code,
       input_keys_json,authorized_external_write,started_at,finished_at,duration_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(batchId, candidateId, generationSnapshotId, skillId, record.capability, record.plugin, record.version,
        record.status, record.errorCode, JSON.stringify(record.inputKeys || []), record.authorizedExternalWrite ? 1 : 0,
        record.startedAt, record.finishedAt, Number(record.durationMs) || 0);
    return { id: Number(result.lastInsertRowid), batchId, candidateId, generationSnapshotId, skillId, ...record };
  }

  listToolExecutions({ batchId = null, candidateId = null, capability = null, limit = 100 } = {}) {
    const where = []; const values = [];
    if (batchId) { where.push('batch_id=?'); values.push(batchId); }
    if (candidateId) { where.push('candidate_row_id=?'); values.push(candidateId); }
    if (capability) { where.push('capability=?'); values.push(capability); }
    values.push(Math.min(500, Math.max(1, Number(limit) || 100)));
    return this.db.prepare(`SELECT * FROM tool_executions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`)
      .all(...values).map((row) => ({ ...row, input_keys: JSON.parse(row.input_keys_json), authorized_external_write: Boolean(row.authorized_external_write) }));
  }

  saveSkillVersion({ skillId, config, configHash, publish = false }) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM skill_versions WHERE skill_id=?').get(skillId);
      const version = Number(current.version) + 1; const now = new Date().toISOString();
      if (publish) this.db.prepare("UPDATE skill_versions SET status='archived' WHERE skill_id=? AND status='published'").run(skillId);
      const result = this.db.prepare(`INSERT INTO skill_versions
        (skill_id,version,status,config_json,config_hash,created_at,published_at) VALUES (?,?,?,?,?,?,?)`)
        .run(skillId, version, publish ? 'published' : 'draft', JSON.stringify(config), configHash, now, publish ? now : null);
      this.db.exec('COMMIT');
      return { id: Number(result.lastInsertRowid), skillId, version, status: publish ? 'published' : 'draft', config, configHash, createdAt: now, publishedAt: publish ? now : null };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  removeSkillVersion(id) { this.db.prepare('DELETE FROM skill_versions WHERE id=?').run(id); }
  setPublishedSkillVersion(skillId, version) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("UPDATE skill_versions SET status='archived' WHERE skill_id=? AND status='published'").run(skillId);
      this.db.prepare("UPDATE skill_versions SET status='published',published_at=COALESCE(published_at,?) WHERE skill_id=? AND version=?").run(new Date().toISOString(), skillId, version);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  getSkillVersion(skillId, version = null) {
    const row = version
      ? this.db.prepare('SELECT * FROM skill_versions WHERE skill_id=? AND version=?').get(skillId, version)
      : this.db.prepare("SELECT * FROM skill_versions WHERE skill_id=? ORDER BY CASE status WHEN 'published' THEN 0 ELSE 1 END, version DESC LIMIT 1").get(skillId);
    return row ? { ...row, config: JSON.parse(row.config_json) } : null;
  }

  listSkillVersions(skillId) {
    return this.db.prepare('SELECT * FROM skill_versions WHERE skill_id=? ORDER BY version DESC').all(skillId)
      .map((row) => ({ ...row, config: JSON.parse(row.config_json) }));
  }
}
