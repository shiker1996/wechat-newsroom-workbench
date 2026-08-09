import { markdownVisibleChars } from '../../domain/markdown-visible-chars.mjs';

export class ContentRepository {
  constructor(db) { this.db = db; }

  saveDocument({ batchId, candidateId = null, kind, title = '', content = '', filePath = null, status = 'draft' }) {
    const now = new Date().toISOString(); const visibleChars = markdownVisibleChars(content);
    const previous = this.getDocument(batchId, candidateId, kind);
    if (previous && candidateId == null) {
      this.db.prepare(`UPDATE documents SET title=?,content=?,file_path=?,visible_chars=?,status=?,updated_at=? WHERE id=?`)
        .run(title, content, filePath, visibleChars, status, now, previous.id);
    } else {
      this.db.prepare(`INSERT INTO documents
        (batch_id,candidate_row_id,kind,title,content,file_path,visible_chars,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(batch_id,candidate_row_id,kind) DO UPDATE SET title=excluded.title,content=excluded.content,
        file_path=excluded.file_path,visible_chars=excluded.visible_chars,status=excluded.status,updated_at=excluded.updated_at`)
        .run(batchId, candidateId, kind, title, content, filePath, visibleChars, status, now, now);
    }
    const document = this.getDocument(batchId, candidateId, kind);
    if (!previous || previous.title !== title || previous.content !== content || previous.status !== status) {
      this.db.prepare(`INSERT INTO document_revisions
        (document_id,title,content,visible_chars,status,reason,created_at) VALUES (?,?,?,?,?,?,?)`)
        .run(document.id, title, content, visibleChars, status, previous ? 'save' : 'initial', now);
      this.db.prepare(`DELETE FROM document_revisions WHERE document_id=? AND id NOT IN
        (SELECT id FROM document_revisions WHERE document_id=? ORDER BY id DESC LIMIT 50)`).run(document.id, document.id);
    }
    return document;
  }

  getDocument(batchId, candidateId, kind) {
    const clause = candidateId == null ? 'candidate_row_id IS NULL' : 'candidate_row_id=?';
    const values = candidateId == null ? [batchId, kind] : [batchId, candidateId, kind];
    return this.db.prepare(`SELECT * FROM documents WHERE batch_id=? AND ${clause} AND kind=?`).get(...values) ?? null;
  }

  getDocumentContent(id) { return this.db.prepare('SELECT content, title, kind FROM documents WHERE id=?').get(id) ?? null; }

  getDocumentById(id) { return this.db.prepare('SELECT * FROM documents WHERE id=?').get(id) ?? null; }

  listDocumentRevisions(documentId) {
    return this.db.prepare(`SELECT id,document_id,title,visible_chars,status,reason,created_at,
      length(content) AS content_length FROM document_revisions WHERE document_id=? ORDER BY id DESC`).all(documentId);
  }

  getDocumentRevision(documentId, revisionId) {
    return this.db.prepare('SELECT * FROM document_revisions WHERE document_id=? AND id=?').get(documentId, revisionId) ?? null;
  }

  listDocuments(batchId) {
    return this.db.prepare(`SELECT d.*, c.candidate_id, h.title AS hotspot_title FROM documents d
      LEFT JOIN candidates c ON c.id=d.candidate_row_id LEFT JOIN hotspots h ON h.id=c.hotspot_id
      WHERE d.batch_id=? ORDER BY d.updated_at DESC`).all(batchId);
  }

  upsertArtifact(artifact) {
    this.db.prepare(`INSERT INTO artifacts
      (batch_id, kind, name, file_path, size, modified_at, status, candidate_row_id, track)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET batch_id=excluded.batch_id, kind=excluded.kind,
        name=excluded.name, size=excluded.size, modified_at=excluded.modified_at, status=excluded.status,
        candidate_row_id=COALESCE(excluded.candidate_row_id,artifacts.candidate_row_id),track=CASE WHEN excluded.track='' THEN artifacts.track ELSE excluded.track END`)
      .run(artifact.batchId ?? null, artifact.kind, artifact.name, artifact.path, artifact.size, artifact.modifiedAt,
        artifact.status ?? 'ready', artifact.candidateId ?? null, artifact.track ?? '');
  }

  listArtifacts({ limit = 300, batchId } = {}) {
    const select = `SELECT a.*, b.batch_date, b.title AS batch_title, c.candidate_id, COALESCE(h.title,c.hotspot_titles) AS hotspot_title
      FROM artifacts a LEFT JOIN batches b ON b.id=a.batch_id LEFT JOIN candidates c ON c.id=a.candidate_row_id LEFT JOIN hotspots h ON h.id=c.hotspot_id`;
    if (batchId) return this.db.prepare(`${select} WHERE a.batch_id=? ORDER BY a.modified_at DESC LIMIT ?`).all(batchId, limit);
    return this.db.prepare(`${select} ORDER BY a.modified_at DESC LIMIT ?`).all(limit);
  }

  getArtifact(id) { return this.db.prepare('SELECT * FROM artifacts WHERE id=?').get(id) ?? null; }
}
