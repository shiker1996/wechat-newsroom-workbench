export function applyAgentHarnessSchema(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(agent_runs)').all().map((column) => column.name));
  if (!columns.has('generation_snapshot_id')) db.exec('ALTER TABLE agent_runs ADD COLUMN generation_snapshot_id INTEGER REFERENCES generation_snapshots(id) ON DELETE SET NULL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_run_events (
      agent_run_id TEXT NOT NULL, sequence INTEGER NOT NULL,
      event_json TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(agent_run_id, sequence),
      FOREIGN KEY(agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS agent_steps (
      agent_run_id TEXT NOT NULL, step_index INTEGER NOT NULL, phase TEXT NOT NULL,
      summary_json TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(agent_run_id, step_index, phase),
      FOREIGN KEY(agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS agent_checkpoints (
      agent_run_id TEXT NOT NULL, sequence INTEGER NOT NULL,
      state_json TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(agent_run_id, sequence),
      FOREIGN KEY(agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS agent_resume_claims (
      agent_run_id TEXT PRIMARY KEY, claim_token TEXT NOT NULL,
      claimed_at TEXT NOT NULL, lease_until TEXT NOT NULL,
      FOREIGN KEY(agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS agent_tool_idempotency (
      idempotency_key TEXT PRIMARY KEY, capability TEXT NOT NULL,
      plugin TEXT, version TEXT, result_json TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_tool_idempotency_capability ON agent_tool_idempotency(capability,created_at);
  `);
}
