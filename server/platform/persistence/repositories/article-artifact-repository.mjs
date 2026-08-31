function json(value, fallback = []) {
  try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; }
}

export class ArticleArtifactRepository {
  constructor(db) { this.db = db; }

  upsert(input = {}) {
    const timestamp = input.indexedAt || new Date().toISOString();
    this.db.prepare(`INSERT INTO article_artifact_index
      (artifact_id,file_path,root_path,artifact_type,title,normalized_title,article_date,version_label,content_url,
       batch_id,document_id,plan_id,material_id,column_id,evidence_paths_json,relation_method,relation_confidence,
       status,scan_error,file_size,modified_at,indexed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(file_path) DO UPDATE SET
        artifact_id=excluded.artifact_id,root_path=excluded.root_path,artifact_type=excluded.artifact_type,
        title=excluded.title,normalized_title=excluded.normalized_title,article_date=excluded.article_date,
        version_label=excluded.version_label,content_url=excluded.content_url,batch_id=excluded.batch_id,
        document_id=excluded.document_id,plan_id=excluded.plan_id,material_id=excluded.material_id,
        column_id=excluded.column_id,evidence_paths_json=excluded.evidence_paths_json,
        relation_method=excluded.relation_method,relation_confidence=excluded.relation_confidence,
        status=excluded.status,scan_error=excluded.scan_error,file_size=excluded.file_size,
        modified_at=excluded.modified_at,indexed_at=excluded.indexed_at`)
      .run(
        input.artifactId ?? null,
        String(input.filePath || ''),
        String(input.rootPath || ''),
        String(input.artifactType || 'article-artifact'),
        String(input.title || ''),
        String(input.normalizedTitle || ''),
        String(input.articleDate || ''),
        String(input.versionLabel || ''),
        String(input.contentUrl || ''),
        input.batchId ?? null,
        input.documentId ?? null,
        input.planId ?? null,
        input.materialId ?? null,
        input.columnId ?? null,
        JSON.stringify(Array.isArray(input.evidencePaths) ? input.evidencePaths : []),
        String(input.relationMethod || ''),
        String(input.relationConfidence || 'none'),
        ['indexed', 'ambiguous', 'unreadable'].includes(input.status) ? input.status : 'indexed',
        String(input.scanError || ''),
        Number(input.fileSize || 0),
        String(input.modifiedAt || timestamp),
        timestamp,
      );
    return this.getByPath(input.filePath);
  }

  getByPath(filePath) {
    const row = this.db.prepare(`SELECT a.*,b.batch_date,b.title AS batch_title,
      d.kind AS document_kind,COALESCE(p.title_direction,m.title) AS plan_title,m.title AS material_title,c.name AS column_name,
      (SELECT COUNT(*) FROM wechat_article_metric_matches mm WHERE mm.article_artifact_id=a.id AND mm.status IN ('confirmed','auto_confirmed')) AS metric_match_count,
      (SELECT COALESCE(SUM(wm.reads),0) FROM wechat_article_metric_matches mm JOIN wechat_article_metrics wm ON wm.id=mm.metric_id WHERE mm.article_artifact_id=a.id AND mm.status IN ('confirmed','auto_confirmed')) AS metric_reads,
      (SELECT COALESCE(SUM(wm.shares),0) FROM wechat_article_metric_matches mm JOIN wechat_article_metrics wm ON wm.id=mm.metric_id WHERE mm.article_artifact_id=a.id AND mm.status IN ('confirmed','auto_confirmed')) AS metric_shares,
      (SELECT COALESCE(SUM(wm.follows_after_read),0) FROM wechat_article_metric_matches mm JOIN wechat_article_metrics wm ON wm.id=mm.metric_id WHERE mm.article_artifact_id=a.id AND mm.status IN ('confirmed','auto_confirmed')) AS metric_follows
      FROM article_artifact_index a
      LEFT JOIN batches b ON b.id=a.batch_id
      LEFT JOIN documents d ON d.id=a.document_id
      LEFT JOIN material_content_plans p ON p.id=a.plan_id
      LEFT JOIN writing_materials m ON m.id=a.material_id
      LEFT JOIN content_columns c ON c.id=a.column_id
      WHERE a.file_path=?`).get(String(filePath || ''));
    return row ? this.#decorate(row) : null;
  }

  list({ query = '', status = '', limit = 300 } = {}) {
    const where = ['1=1']; const values = [];
    if (query) {
      where.push('(a.title LIKE ? OR a.normalized_title LIKE ? OR a.file_path LIKE ? OR a.content_url LIKE ?)');
      const q = `%${query}%`; values.push(q, q, q, q);
    }
    if (status) { where.push('a.status=?'); values.push(status); }
    values.push(Math.min(Math.max(Number(limit) || 300, 1), 1000));
    return this.db.prepare(`SELECT a.*,b.batch_date,b.title AS batch_title,
      d.kind AS document_kind,COALESCE(p.title_direction,m.title) AS plan_title,m.title AS material_title,c.name AS column_name,
      (SELECT COUNT(*) FROM wechat_article_metric_matches mm WHERE mm.article_artifact_id=a.id AND mm.status IN ('confirmed','auto_confirmed')) AS metric_match_count,
      (SELECT COALESCE(SUM(wm.reads),0) FROM wechat_article_metric_matches mm JOIN wechat_article_metrics wm ON wm.id=mm.metric_id WHERE mm.article_artifact_id=a.id AND mm.status IN ('confirmed','auto_confirmed')) AS metric_reads,
      (SELECT COALESCE(SUM(wm.shares),0) FROM wechat_article_metric_matches mm JOIN wechat_article_metrics wm ON wm.id=mm.metric_id WHERE mm.article_artifact_id=a.id AND mm.status IN ('confirmed','auto_confirmed')) AS metric_shares,
      (SELECT COALESCE(SUM(wm.follows_after_read),0) FROM wechat_article_metric_matches mm JOIN wechat_article_metrics wm ON wm.id=mm.metric_id WHERE mm.article_artifact_id=a.id AND mm.status IN ('confirmed','auto_confirmed')) AS metric_follows
      FROM article_artifact_index a
      LEFT JOIN batches b ON b.id=a.batch_id
      LEFT JOIN documents d ON d.id=a.document_id
      LEFT JOIN material_content_plans p ON p.id=a.plan_id
      LEFT JOIN writing_materials m ON m.id=a.material_id
      LEFT JOIN content_columns c ON c.id=a.column_id
      WHERE ${where.join(' AND ')} ORDER BY a.article_date DESC,a.modified_at DESC,a.id DESC LIMIT ?`).all(...values).map((row) => this.#decorate(row));
  }

  recordRun(input = {}) {
    const result = this.db.prepare(`INSERT INTO article_artifact_index_runs
      (roots_json,status,files_seen,indexed_count,skipped_count,error_json,started_at,finished_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(
        JSON.stringify(Array.isArray(input.roots) ? input.roots : []),
        ['running', 'completed', 'partial', 'failed'].includes(input.status) ? input.status : 'completed',
        Number(input.filesSeen || 0), Number(input.indexedCount || 0), Number(input.skippedCount || 0),
        JSON.stringify(Array.isArray(input.errors) ? input.errors : []),
        String(input.startedAt || new Date().toISOString()), input.finishedAt || null,
      );
    return this.getRun(Number(result.lastInsertRowid));
  }

  getRun(id) {
    const row = this.db.prepare('SELECT * FROM article_artifact_index_runs WHERE id=?').get(Number(id));
    return row ? this.#decorateRun(row) : null;
  }

  latestRun() {
    const row = this.db.prepare('SELECT * FROM article_artifact_index_runs ORDER BY id DESC LIMIT 1').get();
    return row ? this.#decorateRun(row) : null;
  }

  stats() {
    const row = this.db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='indexed' THEN 1 ELSE 0 END) AS indexed,
      SUM(CASE WHEN document_id IS NOT NULL THEN 1 ELSE 0 END) AS linked_documents,
      SUM(CASE WHEN plan_id IS NOT NULL THEN 1 ELSE 0 END) AS linked_plans,
      SUM(CASE WHEN evidence_paths_json<>'[]' THEN 1 ELSE 0 END) AS with_evidence,
      (SELECT COUNT(DISTINCT article_artifact_id) FROM wechat_article_metric_matches WHERE article_artifact_id IS NOT NULL AND status IN ('confirmed','auto_confirmed')) AS matched_metrics
      FROM article_artifact_index`).get();
    return { ...row, matched_metrics: Number(row.matched_metrics || 0), latest_run: this.latestRun() };
  }

  pruneMissing({ roots = [], keepPaths = [] } = {}) {
    const normalizedRoots = roots.map((item) => String(item || '').toLowerCase().replaceAll('/', '\\'));
    const keep = new Set(keepPaths.map((item) => String(item || '').toLowerCase()));
    const rows = this.db.prepare('SELECT id,file_path FROM article_artifact_index').all();
    let removed = 0;
    const remove = this.db.prepare('DELETE FROM article_artifact_index WHERE id=?');
    for (const row of rows) {
      const filePath = String(row.file_path || '').toLowerCase();
      const inRoots = normalizedRoots.some((root) => filePath === root || filePath.startsWith(`${root}\\`));
      if (inRoots && !keep.has(filePath)) { remove.run(row.id); removed += 1; }
    }
    return removed;
  }

  #decorate(row) {
    return {
      ...row,
      evidence_paths: json(row.evidence_paths_json, []),
    };
  }

  #decorateRun(row) {
    return { ...row, roots: json(row.roots_json, []), errors: json(row.error_json, []) };
  }
}
