const VALID_STAGES = new Set(['collect', 'tag', 'event-card', 'research']);
const VALID_STATUSES = new Set(['open', 'retrying', 'resolved', 'skipped', 'superseded']);

function json(value) {
  try { return JSON.stringify(value && typeof value === 'object' ? value : {}); }
  catch { return '{}'; }
}

function hydrate(row) {
  if (!row) return null;
  let detail = {};
  try { detail = JSON.parse(row.detail_json || '{}'); } catch {}
  return { ...row, detail };
}

export class PipelineFailureRepository {
  constructor(db) { this.db = db; }

  record(input) {
    if (!VALID_STAGES.has(input.stage)) throw new Error(`未知流水线阶段：${input.stage}`);
    const objectType = String(input.objectType || '').trim();
    const objectKey = String(input.objectKey || '').trim();
    const errorMessage = String(input.errorMessage || '').trim();
    if (!input.batchId || !objectType || !objectKey || !errorMessage) throw new Error('失败记录缺少批次、对象或错误信息');
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO pipeline_failures
      (batch_id,run_id,stage,object_type,object_key,source_run_id,subscription_run_id,hotspot_id,candidate_row_id,
       title,url,error_code,error_message,detail_json,status,retry_count,first_failed_at,last_failed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?)
      ON CONFLICT(batch_id,stage,object_type,object_key) DO UPDATE SET
        run_id=excluded.run_id,
        source_run_id=COALESCE(excluded.source_run_id,pipeline_failures.source_run_id),
        subscription_run_id=COALESCE(excluded.subscription_run_id,pipeline_failures.subscription_run_id),
        hotspot_id=COALESCE(excluded.hotspot_id,pipeline_failures.hotspot_id),
        candidate_row_id=COALESCE(excluded.candidate_row_id,pipeline_failures.candidate_row_id),
        title=excluded.title,url=excluded.url,error_code=excluded.error_code,error_message=excluded.error_message,
        detail_json=excluded.detail_json,status='open',last_failed_at=excluded.last_failed_at,updated_at=excluded.updated_at`)
      .run(input.batchId, input.runId || null, input.stage, objectType, objectKey,
        input.sourceRunId ?? null, input.subscriptionRunId ?? null, input.hotspotId ?? null, input.candidateRowId ?? null,
        String(input.title || ''), input.url || null, input.errorCode || null, errorMessage, json(input.detail),
        VALID_STATUSES.has(input.status) ? input.status : 'open', now, now, now, now);
    return this.getByKey(input.batchId, input.stage, objectType, objectKey);
  }

  getByKey(batchId, stage, objectType, objectKey) {
    return hydrate(this.db.prepare(`SELECT * FROM pipeline_failures
      WHERE batch_id=? AND stage=? AND object_type=? AND object_key=?`).get(batchId, stage, objectType, objectKey));
  }

  get(id) {
    return hydrate(this.db.prepare('SELECT * FROM pipeline_failures WHERE id=?').get(Number(id)));
  }

  startRetry(id) {
    const now=new Date().toISOString();
    const result=this.db.prepare("UPDATE pipeline_failures SET status='retrying',retry_count=retry_count+1,updated_at=? WHERE id=? AND status IN ('open','retrying')")
      .run(now,Number(id));
    return result.changes ? this.get(id) : null;
  }

  resolve(id) {
    const now=new Date().toISOString();
    this.db.prepare("UPDATE pipeline_failures SET status='resolved',resolved_at=?,updated_at=? WHERE id=?").run(now,now,Number(id));
    return this.get(id);
  }

  retryFailed(id, errorMessage, detail = null) {
    const current=this.get(id);if(!current)return null;const now=new Date().toISOString();
    this.db.prepare("UPDATE pipeline_failures SET status='open',error_message=?,detail_json=?,last_failed_at=?,updated_at=? WHERE id=?")
      .run(String(errorMessage||current.error_message),json(detail||current.detail),now,now,Number(id));
    return this.get(id);
  }

  skip(id, reason = '') {
    const now=new Date().toISOString();
    const result=this.db.prepare("UPDATE pipeline_failures SET status='skipped',skipped_at=?,skip_reason=?,updated_at=? WHERE id=? AND status IN ('open','retrying')")
      .run(now,String(reason||''),now,Number(id));
    return result.changes?this.get(id):null;
  }

  reopen(id) {
    const now=new Date().toISOString();
    const result=this.db.prepare("UPDATE pipeline_failures SET status='open',resolved_at=NULL,skipped_at=NULL,skip_reason=NULL,updated_at=? WHERE id=? AND status IN ('skipped','resolved')")
      .run(now,Number(id));
    return result.changes?this.get(id):null;
  }

  listBatch(batchId, { statuses = [], stages = [] } = {}) {
    const safeStatuses = statuses.filter((value) => VALID_STATUSES.has(value));
    const safeStages = stages.filter((value) => VALID_STAGES.has(value));
    const clauses = ['batch_id=?']; const params = [batchId];
    if (safeStatuses.length) { clauses.push(`status IN (${safeStatuses.map(() => '?').join(',')})`); params.push(...safeStatuses); }
    if (safeStages.length) { clauses.push(`stage IN (${safeStages.map(() => '?').join(',')})`); params.push(...safeStages); }
    return this.db.prepare(`SELECT * FROM pipeline_failures WHERE ${clauses.join(' AND ')}
      ORDER BY CASE stage WHEN 'collect' THEN 1 WHEN 'tag' THEN 2 WHEN 'event-card' THEN 3 ELSE 4 END,
      last_failed_at DESC,id DESC`).all(...params).map(hydrate);
  }
}
