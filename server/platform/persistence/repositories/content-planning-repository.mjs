import fs from 'node:fs';
import path from 'node:path';

const SOURCE_TYPES = new Set(['conversation', 'reading', 'life', 'project', 'text']);
const PLAN_STATUSES = new Set(['idea', 'planned', 'writing', 'done', 'cancelled']);
const WECHAT_CONTENT_TYPES = new Set(['unknown', 'article', 'social']);
const ARTICLE_MATCH_ARTIFACT_TYPES = new Set(['文章终稿', '早报终稿', '图文发布文案']);

function jsonValue(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return fallback; } }
  return value;
}

function now() { return new Date().toISOString(); }
function int(value, fallback = 0) { const n = Number(String(value ?? '').replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n) : fallback; }
function real(value, fallback = null) { const n = Number(String(value ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : fallback; }
function dateValue(value) {
  const text = String(value ?? '').trim();
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`;
  if (/^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(text)) return text.replace(/[./]/g, '-').replace(/-(\d)(?!\d)/g, '-0$1');
  return text;
}

function writerSkillFromManifest(filePath) {
  if (!filePath) return '';
  const directory = path.dirname(filePath);
  const manifestPaths = [
    path.join(directory, '00-skill-manifest.json'),
    path.join(directory, '..', '00-skill-manifest.json'),
  ];
  for (const manifestPath of manifestPaths) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const skill = manifest.writerSkill || manifest.writerSkillSelection?.selectedSkill || manifest.stageSkills?.drafting?.skill;
      if (skill) return String(skill).trim();
    } catch { /* Try the parent article directory for daily artifacts. */ }
  }
  return '';
}
function rowsFromSheet(sheets = []) { return sheets.flatMap((sheet) => sheet?.rows || []); }
function headerIndex(rows, required) {
  return rows.findIndex((row) => required.every((name) => row.some((cell) => String(cell ?? '').trim() === name)));
}
function headerIndexes(headers, name) {
  return headers.reduce((indexes, value, index) => {
    if (value === name) indexes.push(index);
    return indexes;
  }, []);
}
function cell(row, name, headers) { const index = headers.findIndex((item) => item === name); return index < 0 ? '' : row[index] ?? ''; }

export class ContentPlanningRepository {
  constructor(db) { this.db = db; }

  listColumns({ includeInactive = false } = {}) {
    const rows = this.db.prepare(`SELECT * FROM content_columns ${includeInactive ? '' : 'WHERE active=1'} ORDER BY active DESC,id ASC`).all();
    return rows.map((row) => ({ ...row, active: Boolean(row.active), writing_modes: jsonValue(row.writing_modes_json, ['experience']) }));
  }

  saveColumn({ id = null, name, description = '', writingModes = ['experience'], active = true } = {}) {
    const safeName = String(name || '').trim();
    if (!safeName) throw new Error('栏目名称不能为空');
    const modes = [...new Set((Array.isArray(writingModes) ? writingModes : ['experience']).filter((item) => ['experience', 'tutorial'].includes(item)))];
    if (!modes.length) modes.push('experience');
    const timestamp = now();
    if (id) this.db.prepare(`UPDATE content_columns SET name=?,description=?,writing_modes_json=?,active=?,updated_at=? WHERE id=?`)
      .run(safeName, String(description || '').trim(), JSON.stringify(modes), active ? 1 : 0, timestamp, Number(id));
    else this.db.prepare(`INSERT INTO content_columns(name,description,writing_modes_json,active,created_at,updated_at) VALUES(?,?,?,?,?,?)`)
      .run(safeName, String(description || '').trim(), JSON.stringify(modes), active ? 1 : 0, timestamp, timestamp);
    const row = this.db.prepare('SELECT * FROM content_columns WHERE name=?').get(safeName);
    return { ...row, active: Boolean(row.active), writing_modes: jsonValue(row.writing_modes_json, ['experience']) };
  }

  createMaterial({ sourceType = 'text', title = '', rawText, capturedAt = '', tags = [], evidence = [], iteration = {}, nextTeaser = '' } = {}) {
    if (!SOURCE_TYPES.has(sourceType)) sourceType = 'text';
    const text = String(rawText || '').trim(); if (!text) throw new Error('素材正文不能为空');
    const timestamp = now();
    const result = this.db.prepare(`INSERT INTO writing_materials(source_type,title,raw_text,captured_at,tags_json,evidence_json,iteration_json,next_teaser,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(sourceType, String(title || '').trim(), text, dateValue(capturedAt) || timestamp.slice(0, 10), JSON.stringify(tags), JSON.stringify(evidence), JSON.stringify(iteration), String(nextTeaser || '').trim(), timestamp, timestamp);
    return this.getMaterial(Number(result.lastInsertRowid));
  }

  getMaterial(id) {
    const row = this.db.prepare(`SELECT m.*,c.name AS recommended_column_name
      FROM writing_materials m LEFT JOIN content_columns c ON c.id=m.recommended_column_id WHERE m.id=?`).get(Number(id));
    return row ? this.#material(row) : null;
  }

  listMaterials({ status = '', sourceType = '', query = '', limit = 200 } = {}) {
    const where = ['1=1']; const values = [];
    if (status) { where.push('m.status=?'); values.push(status); }
    if (sourceType) { where.push('m.source_type=?'); values.push(sourceType); }
    if (query) { where.push('(m.title LIKE ? OR m.raw_text LIKE ? OR m.tags_json LIKE ?)'); const q = `%${query}%`; values.push(q, q, q); }
    values.push(Math.min(Math.max(Number(limit) || 200, 1), 500));
    return this.db.prepare(`SELECT m.*,c.name AS recommended_column_name FROM writing_materials m
      LEFT JOIN content_columns c ON c.id=m.recommended_column_id WHERE ${where.join(' AND ')} ORDER BY m.updated_at DESC,m.id DESC LIMIT ?`).all(...values).map((row) => this.#material(row));
  }

  updateMaterial(id, input = {}) {
    const current = this.getMaterial(id); if (!current) return null;
    const fields = [], values = [];
    const assign = (column, value) => { fields.push(`${column}=?`); values.push(value); };
    if (input.title !== undefined) assign('title', String(input.title || '').trim());
    if (input.rawText !== undefined) { const text = String(input.rawText || '').trim(); if (!text) throw new Error('素材正文不能为空'); assign('raw_text', text); }
    if (input.sourceType !== undefined) assign('source_type', SOURCE_TYPES.has(input.sourceType) ? input.sourceType : 'text');
    if (input.status !== undefined) assign('status', ['inbox', 'developing', 'planned', 'archived'].includes(input.status) ? input.status : 'inbox');
    if (input.tags !== undefined) assign('tags_json', JSON.stringify(input.tags));
    if (input.evidence !== undefined) assign('evidence_json', JSON.stringify(input.evidence));
    if (input.iteration !== undefined) assign('iteration_json', JSON.stringify(input.iteration));
    if (input.assessment !== undefined) assign('assessment_json', JSON.stringify(input.assessment));
    if (input.recommendedColumnId !== undefined) assign('recommended_column_id', input.recommendedColumnId || null);
    if (input.nextTeaser !== undefined) assign('next_teaser', String(input.nextTeaser || '').trim());
    if (!fields.length) return current;
    assign('updated_at', now()); values.push(Number(id));
    this.db.prepare(`UPDATE writing_materials SET ${fields.join(',')} WHERE id=?`).run(...values);
    return this.getMaterial(id);
  }

  saveAssessment(id, assessment) {
    const payload = { ...assessment, assessed_at: now() };
    return this.updateMaterial(id, { assessment: payload, recommendedColumnId: assessment.recommended_column_id || null });
  }

  createPlan({ materialId, columnId = null, titleDirection = '', titleIntent = '', planType = 'draft', plannedDate = null, status = 'idea', teaser = '' } = {}) {
    if (!this.getMaterial(materialId)) throw new Error('素材不存在');
    if (!PLAN_STATUSES.has(status)) status = 'idea';
    const timestamp = now();
    const result = this.db.prepare(`INSERT INTO material_content_plans(material_id,column_id,title_direction,title_intent,plan_type,planned_date,status,teaser,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(Number(materialId), columnId || null, String(titleDirection || '').trim(), String(titleIntent || '').trim(), String(planType || 'draft'), dateValue(plannedDate), status, String(teaser || '').trim(), timestamp, timestamp);
    if (status === 'planned') this.updateMaterial(materialId, { status: 'planned' });
    return this.getPlan(Number(result.lastInsertRowid));
  }

  getPlan(id) {
    const row = this.db.prepare(`SELECT p.*,m.title AS material_title,m.source_type,m.raw_text,c.name AS column_name
      FROM material_content_plans p JOIN writing_materials m ON m.id=p.material_id LEFT JOIN content_columns c ON c.id=p.column_id WHERE p.id=?`).get(Number(id));
    return row || null;
  }

  listPlans({ month = '', limit = 300 } = {}) {
    const values = []; const where = ['1=1'];
    if (month) { where.push("substr(p.planned_date,1,7)=?"); values.push(month); }
    values.push(Math.min(Math.max(Number(limit) || 300, 1), 500));
    return this.db.prepare(`SELECT p.*,m.title AS material_title,m.source_type,m.raw_text,c.name AS column_name,
      ap.id AS publication_id,ap.status AS publication_status,ap.content_url AS publication_url,ap.published_at AS publication_published_at,
      ap.title_at_publish AS publication_title_at_publish
      FROM material_content_plans p JOIN writing_materials m ON m.id=p.material_id LEFT JOIN content_columns c ON c.id=p.column_id
      LEFT JOIN article_publications ap ON ap.plan_id=p.id
      WHERE ${where.join(' AND ')} ORDER BY COALESCE(p.planned_date,'9999-12-31'),p.updated_at DESC LIMIT ?`).all(...values);
  }

  updatePlan(id, input = {}) {
    const fields = [], values = [];
    for (const [column, value] of [['title_direction', input.titleDirection], ['title_intent', input.titleIntent], ['teaser', input.teaser], ['planned_date', input.plannedDate]]) {
      if (value !== undefined) { fields.push(`${column}=?`); values.push(column === 'planned_date' ? dateValue(value) : String(value || '').trim()); }
    }
    if (input.columnId !== undefined) { fields.push('column_id=?'); values.push(input.columnId || null); }
    if (input.status !== undefined && PLAN_STATUSES.has(input.status)) { fields.push('status=?'); values.push(input.status); }
    if (!fields.length) return this.getPlan(id);
    fields.push('updated_at=?'); values.push(now(), Number(id));
    this.db.prepare(`UPDATE material_content_plans SET ${fields.filter(Boolean).join(',')} WHERE id=?`).run(...values);
    return this.getPlan(id);
  }

  getArticlePublication({ id = null, planId = null, documentId = null } = {}) {
    let row = null;
    if (id) row = this.db.prepare(`SELECT ap.*,c.name AS column_name FROM article_publications ap LEFT JOIN content_columns c ON c.id=ap.column_id WHERE ap.id=?`).get(Number(id));
    else if (documentId) row = this.db.prepare(`SELECT ap.*,c.name AS column_name FROM article_publications ap LEFT JOIN content_columns c ON c.id=ap.column_id WHERE ap.document_id=?`).get(Number(documentId));
    else if (planId) row = this.db.prepare(`SELECT ap.*,c.name AS column_name FROM article_publications ap LEFT JOIN content_columns c ON c.id=ap.column_id WHERE ap.plan_id=?`).get(Number(planId));
    return row || null;
  }

  listArticlePublications() {
    return this.db.prepare(`SELECT ap.*,p.material_id,p.column_id AS plan_column_id
      FROM article_publications ap LEFT JOIN material_content_plans p ON p.id=ap.plan_id
      ORDER BY ap.updated_at DESC`).all();
  }

  listColumnPerformance() {
    return this.db.prepare(`SELECT COALESCE(c.name, '未分栏') AS column_name,
      COUNT(DISTINCT wm.id) AS sample_count,
      SUM(COALESCE(wm.reads, 0)) AS total_reads,
      ROUND(AVG(COALESCE(wm.reads, 0))) AS avg_reads,
      SUM(COALESCE(wm.follows_after_read, 0)) AS total_follows,
      CASE WHEN SUM(COALESCE(wm.reads, 0)) > 0 THEN ROUND(SUM(COALESCE(wm.follows_after_read, 0)) * 1000.0 / SUM(COALESCE(wm.reads, 0)), 2) ELSE 0 END AS follows_per_thousand_reads
      FROM article_publications ap
      LEFT JOIN material_content_plans p ON p.id=ap.plan_id
      LEFT JOIN content_columns c ON c.id=COALESCE(ap.column_id,p.column_id)
      JOIN article_artifact_index aa ON (ap.document_id IS NOT NULL AND aa.document_id=ap.document_id) OR (ap.plan_id IS NOT NULL AND aa.plan_id=ap.plan_id)
      JOIN wechat_article_metric_matches mm ON mm.article_artifact_id=aa.id AND mm.status IN ('confirmed','auto_confirmed')
      JOIN wechat_article_metrics wm ON wm.id=mm.metric_id
      GROUP BY c.id,c.name ORDER BY avg_reads DESC,column_name ASC`).all().map((row) => ({ ...row, sample_count: Number(row.sample_count || 0), total_reads: Number(row.total_reads || 0), avg_reads: Number(row.avg_reads || 0), total_follows: Number(row.total_follows || 0), follows_per_thousand_reads: Number(row.follows_per_thousand_reads || 0) }));
  }

  saveArticlePublication(input = {}) {
    const id = input.id ? Number(input.id) : null;
    const planId = input.planId == null || input.planId === '' ? null : Number(input.planId);
    const documentId = input.documentId == null || input.documentId === '' ? null : Number(input.documentId);
    if (!planId && !documentId) throw new Error('发布信息必须关联内容计划或文章文档');
    if (planId && !this.getPlan(planId)) throw new Error('内容计划不存在');
    if (documentId && !this.db.prepare('SELECT id FROM documents WHERE id=?').get(documentId)) throw new Error('文章文档不存在');
    const current = id ? this.getArticlePublication({ id }) : this.getArticlePublication({ planId, documentId });
    if (id && !current) throw new Error('发布信息不存在');
    if (current && planId && current.plan_id && current.plan_id !== planId) throw new Error('发布信息已关联其他内容计划');
    if (current && documentId && current.document_id && current.document_id !== documentId) throw new Error('发布信息已关联其他文章文档');
    const contentUrl = String(input.contentUrl ?? current?.content_url ?? '').trim();
    if (contentUrl) {
      let parsed;
      try { parsed = new URL(contentUrl); } catch { throw new Error('公众号文章 URL 无效'); }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('公众号文章 URL 仅支持 HTTP/HTTPS');
    }
    const publishedAt = dateValue(input.publishedAt ?? current?.published_at ?? '');
    const titleAtPublish = String(input.titleAtPublish ?? current?.title_at_publish ?? '').trim();
    const columnId = input.columnId === undefined ? (current?.column_id ?? (planId ? this.getPlan(planId)?.column_id : null)) : (input.columnId || null);
    const contentPillar = String(input.contentPillar ?? current?.content_pillar ?? '').trim();
    const contentRole = String(input.contentRole ?? current?.content_role ?? '').trim();
    const distributionLane = String(input.distributionLane ?? current?.distribution_lane ?? '').trim();
    const suppliedStatus = ['pending', 'registered', 'awaiting_metrics', 'reviewed'].includes(input.status) ? input.status : '';
    const status = suppliedStatus || (contentUrl && publishedAt ? 'awaiting_metrics' : contentUrl || publishedAt || titleAtPublish ? 'registered' : 'pending');
    const timestamp = now();
    if (current) {
      this.db.prepare(`UPDATE article_publications SET plan_id=?,document_id=?,content_url=?,published_at=?,title_at_publish=?,column_id=?,content_pillar=?,content_role=?,distribution_lane=?,status=?,updated_at=? WHERE id=?`)
        .run(planId ?? current.plan_id, documentId ?? current.document_id, contentUrl, publishedAt, titleAtPublish, columnId, contentPillar, contentRole, distributionLane, status, timestamp, current.id);
      return this.getArticlePublication({ id: current.id });
    }
    const result = this.db.prepare(`INSERT INTO article_publications(plan_id,document_id,content_url,published_at,title_at_publish,column_id,content_pillar,content_role,distribution_lane,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(planId, documentId, contentUrl, publishedAt, titleAtPublish, columnId, contentPillar, contentRole, distributionLane, status, timestamp, timestamp);
    return this.getArticlePublication({ id: Number(result.lastInsertRowid) });
  }

  importWechat({ fileName, importType, format, sheets }) {
    const rows = rowsFromSheet(sheets);
    if (!['user_growth', 'notified_articles', 'unnotified_articles', 'content_trends', 'regular_readers'].includes(importType)) throw new Error('公众号导出类型无效');
    const importedAt = now();
    const batch = this.db.prepare('INSERT INTO wechat_import_batches(file_name,import_type,format,imported_at) VALUES(?,?,?,?)').run(String(fileName || '导出文件'), importType, format || 'unknown', importedAt);
    const batchId = Number(batch.lastInsertRowid);
    try {
      const count = importType === 'user_growth' ? this.#importGrowth(batchId, rows)
        : importType === 'content_trends' ? this.#importTrends(batchId, rows)
          : importType === 'regular_readers' ? this.#importRegular(batchId, rows)
            : this.#importArticles(batchId, rows, importType === 'notified_articles');
      this.db.prepare('UPDATE wechat_import_batches SET row_count=? WHERE id=?').run(count, batchId);
      return { id: batchId, file_name: fileName, import_type: importType, format, row_count: count, imported_at: importedAt };
    } catch (error) {
      this.db.prepare('UPDATE wechat_import_batches SET error=? WHERE id=?').run(error.message, batchId);
      throw error;
    }
  }

  #findTable(rows, required) { const index = headerIndex(rows, required); if (index < 0) throw new Error(`未找到导出表头：${required.join('、')}`); return { headers: rows[index].map((value) => String(value || '').trim()), data: rows.slice(index + 1) }; }
  #importGrowth(batchId, rows) {
    const table = this.#findTable(rows, ['时间', '新关注人数', '净增关注人数']); let count = 0;
    const stmt = this.db.prepare(`INSERT INTO wechat_user_growth_daily(import_batch_id,stat_date,new_followers,unfollowers,net_followers,total_followers)
      VALUES(?,?,?,?,?,?) ON CONFLICT(stat_date) DO UPDATE SET import_batch_id=excluded.import_batch_id,new_followers=excluded.new_followers,unfollowers=excluded.unfollowers,net_followers=excluded.net_followers,total_followers=excluded.total_followers`);
    for (const row of table.data) { const date = dateValue(cell(row, '时间', table.headers)); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue; stmt.run(batchId, date, int(cell(row, '新关注人数', table.headers)), int(cell(row, '取消关注人数', table.headers)), int(cell(row, '净增关注人数', table.headers)), int(cell(row, '累积关注人数', table.headers))); count += 1; }
    return count;
  }
  #importArticles(batchId, rows, notified) {
    const required = ['内容标题', '发表日期', '阅读人数', '分享人数', '阅读后关注人数']; const table = this.#findTable(rows, required); let count = 0;
    const stmt = this.db.prepare(`INSERT INTO wechat_article_metrics(import_batch_id,notified,title,published_date,reads,shares,follows_after_read,delivery,delivery_rate,completion_rate,content_url)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(notified,title,published_date) DO UPDATE SET import_batch_id=excluded.import_batch_id,reads=excluded.reads,shares=excluded.shares,follows_after_read=excluded.follows_after_read,delivery=excluded.delivery,delivery_rate=excluded.delivery_rate,completion_rate=excluded.completion_rate,content_url=excluded.content_url`);
    for (const row of table.data) { const title = String(cell(row, '内容标题', table.headers) || '').trim(); const date = dateValue(cell(row, '发表日期', table.headers)); if (!title || !date) continue; const rate = real(cell(row, '送达完成率', table.headers)); stmt.run(batchId, notified ? 1 : 0, title, date, int(cell(row, '阅读人数', table.headers)), int(cell(row, '分享人数', table.headers)), int(cell(row, '阅读后关注人数', table.headers)), table.headers.includes('送达人数') ? int(cell(row, '送达人数', table.headers)) : null, rate, real(cell(row, '阅读完成率', table.headers)), String(cell(row, '内容url', table.headers) || '')); count += 1; }
    return count;
  }
  #importTrends(batchId, rows) {
    const table = this.#findTable(rows, ['日期', '渠道', '阅读人数']); let count = 0;
    const dateIndexes = headerIndexes(table.headers, '日期');
    const channelIndexes = headerIndexes(table.headers, '渠道');
    const readsIndexes = headerIndexes(table.headers, '阅读人数');
    const sharesIndex = table.headers.indexOf('分享人数');
    const originalReadsIndex = table.headers.indexOf('跳转阅读原文人数');
    const favoritesIndex = table.headers.indexOf('微信收藏人数');
    const publishedCountIndex = table.headers.indexOf('发表篇数');
    const articleChannelIndex = table.headers.indexOf('传播渠道');
    const articleTitleIndex = table.headers.indexOf('内容标题');
    const articleDateIndex = dateIndexes[1] ?? -1;
    const articleReadsIndex = readsIndexes[1] ?? -1;
    const articleShareIndex = table.headers.indexOf('阅读人数占比');
    const stmt = this.db.prepare(`INSERT INTO wechat_content_trends(import_batch_id,stat_date,channel,reads,shares,original_reads,favorites,published_count,article_channel,article_title,article_date,article_reads,article_read_share)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(stat_date,channel,article_channel,article_title) DO UPDATE SET import_batch_id=excluded.import_batch_id,reads=excluded.reads,shares=excluded.shares,original_reads=excluded.original_reads,favorites=excluded.favorites,published_count=excluded.published_count,article_date=excluded.article_date,article_reads=excluded.article_reads,article_read_share=excluded.article_read_share`);
    for (const row of table.data) {
      const date = dateValue(row[dateIndexes[0] ?? -1]); const articleDate = dateValue(row[articleDateIndex]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) && !articleDate) continue;
      stmt.run(batchId, date || articleDate, String(row[channelIndexes[0] ?? -1] || ''), int(row[readsIndexes[0] ?? -1], null), int(row[sharesIndex], null), int(row[originalReadsIndex], null), int(row[favoritesIndex], null), int(row[publishedCountIndex], null), String(row[articleChannelIndex] || ''), String(row[articleTitleIndex] || ''), articleDate, int(row[articleReadsIndex], null), real(row[articleShareIndex], null)); count += 1;
    }
    return count;
  }
  #importRegular(batchId, rows) {
    const table = this.#findTable(rows, ['时间', '常读用户数']); let count = 0;
    const stmt = this.db.prepare(`INSERT INTO wechat_regular_reader_trends(import_batch_id,period,regular_readers,regular_reader_rate) VALUES(?,?,?,?)
      ON CONFLICT(period) DO UPDATE SET import_batch_id=excluded.import_batch_id,regular_readers=excluded.regular_readers,regular_reader_rate=excluded.regular_reader_rate`);
    for (const row of table.data) { const period = String(cell(row, '时间', table.headers) || '').trim(); if (!period) continue; stmt.run(batchId, period, int(cell(row, '常读用户数', table.headers)), real(cell(row, '常读用户比例', table.headers))); count += 1; }
    return count;
  }

  listWechatImports({ limit = 50 } = {}) { return this.db.prepare('SELECT * FROM wechat_import_batches ORDER BY imported_at DESC,id DESC LIMIT ?').all(Math.min(Math.max(Number(limit) || 50, 1), 200)); }
  listWechatArticleMetrics() { return this.db.prepare('SELECT * FROM wechat_article_metrics ORDER BY published_date DESC,id DESC').all(); }
  getWechatArticleMetricMatchByMetric(metricId) { return this.#decorateMatch(this.db.prepare('SELECT * FROM wechat_article_metric_matches WHERE metric_id=?').get(Number(metricId))); }
  getWechatArticleMetricMatch(id) {
    return this.#decorateMatch(this.db.prepare(`SELECT mm.*,wm.notified,wm.title AS metric_title,wm.published_date,wm.reads,wm.shares,wm.follows_after_read,wm.content_url,
      aa.title AS artifact_title,aa.article_date,aa.version_label,aa.artifact_type,aa.file_path
      FROM wechat_article_metric_matches mm JOIN wechat_article_metrics wm ON wm.id=mm.metric_id
      LEFT JOIN article_artifact_index aa ON aa.id=mm.article_artifact_id WHERE mm.id=?`).get(Number(id)));
  }
  listWechatArticleMetricMatches({ status = '', limit = 200 } = {}) {
    const values = []; const where = ['1=1'];
    if (status) { where.push('mm.status=?'); values.push(status); }
    values.push(Math.min(Math.max(Number(limit) || 200, 1), 1000));
    return this.db.prepare(`SELECT mm.*,wm.notified,wm.title AS metric_title,wm.published_date,wm.reads,wm.shares,wm.follows_after_read,wm.content_url,
      aa.title AS artifact_title,aa.article_date,aa.version_label,aa.artifact_type,aa.file_path
      FROM wechat_article_metric_matches mm JOIN wechat_article_metrics wm ON wm.id=mm.metric_id
      LEFT JOIN article_artifact_index aa ON aa.id=mm.article_artifact_id
      WHERE ${where.join(' AND ')} ORDER BY CASE mm.status WHEN 'pending' THEN 0 WHEN 'unmatched' THEN 1 ELSE 2 END,wm.published_date DESC,mm.id DESC LIMIT ?`).all(...values).map((row) => this.#decorateMatch(row));
  }
  listWechatMatchArtifacts() {
    return this.db.prepare(`SELECT id,title,artifact_type,article_date,version_label,file_path,content_url
      FROM article_artifact_index WHERE artifact_type IN ('文章终稿','早报终稿','图文发布文案')
      ORDER BY CASE artifact_type WHEN '文章终稿' THEN 0 WHEN '早报终稿' THEN 1 ELSE 2 END,article_date DESC,modified_at DESC,id DESC`).all();
  }
  wechatArticleMetricMatchStats() {
    const rows = this.db.prepare('SELECT status,COUNT(*) AS count FROM wechat_article_metric_matches GROUP BY status').all();
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  }
  upsertWechatArticleMetricMatch(input = {}) {
    const metricId = Number(input.metricId); const result = input.result || input;
    const current = this.getWechatArticleMetricMatchByMetric(metricId);
    if (current && ['confirmed', 'rejected'].includes(current.status) && !input.force) return current;
    const timestamp = now();
    const candidateIds = (result.candidates || []).map((item) => Number(item.id)).filter(Number.isFinite);
    const matchedTitle = result.articleArtifactId ? (result.candidates || []).find((item) => Number(item.id) === Number(result.articleArtifactId))?.title || '' : '';
    const artifact = result.articleArtifactId ? this.db.prepare('SELECT artifact_type,title FROM article_artifact_index WHERE id=?').get(Number(result.articleArtifactId)) : null;
    const contentType = WECHAT_CONTENT_TYPES.has(result.contentType) ? result.contentType : artifact?.artifact_type === '图文发布文案' ? 'social' : artifact ? 'article' : 'unknown';
    if (current) {
      this.db.prepare(`UPDATE wechat_article_metric_matches SET article_artifact_id=?,content_type=?,match_method=?,confidence=?,status=?,candidate_ids_json=?,candidate_snapshot_json=?,matched_title=?,note=?,updated_at=?,confirmed_at=? WHERE id=?`)
        .run(result.articleArtifactId ?? null, contentType, result.method || 'unmatched', result.confidence || 'none', result.status || 'unmatched', JSON.stringify(candidateIds), JSON.stringify(result.candidates || []), matchedTitle || artifact?.title || '', '', timestamp, result.status === 'auto_confirmed' ? timestamp : null, current.id);
      this.db.prepare(`INSERT INTO wechat_article_match_logs(match_id,action,from_artifact_id,to_artifact_id,match_method,confidence,note,created_at) VALUES(?,?,?,?,?,?,?,?)`)
        .run(current.id, 'rematch', current.article_artifact_id ?? null, result.articleArtifactId ?? null, result.method || 'unmatched', result.confidence || 'none', '', timestamp);
      return this.getWechatArticleMetricMatch(current.id);
    }
    const inserted = this.db.prepare(`INSERT INTO wechat_article_metric_matches(metric_id,article_artifact_id,content_type,match_method,confidence,status,candidate_ids_json,candidate_snapshot_json,matched_title,note,created_at,updated_at,confirmed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(metricId, result.articleArtifactId ?? null, contentType, result.method || 'unmatched', result.confidence || 'none', result.status || 'unmatched', JSON.stringify(candidateIds), JSON.stringify(result.candidates || []), matchedTitle || artifact?.title || '', '', timestamp, timestamp, result.status === 'auto_confirmed' ? timestamp : null);
    this.db.prepare(`INSERT INTO wechat_article_match_logs(match_id,action,to_artifact_id,match_method,confidence,note,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run(Number(inserted.lastInsertRowid), result.status === 'auto_confirmed' ? 'auto_match' : 'rematch', result.articleArtifactId ?? null, result.method || 'unmatched', result.confidence || 'none', '', timestamp);
    return this.getWechatArticleMetricMatch(Number(inserted.lastInsertRowid));
  }
  updateWechatArticleMetricMatch(id, { action, articleArtifactId = null, contentType = 'unknown', note = '' } = {}) {
    const current = this.getWechatArticleMetricMatch(id); if (!current) return null;
    const timestamp = now();
    if (action === 'confirm') {
      const artifact = this.db.prepare('SELECT id,title,artifact_type FROM article_artifact_index WHERE id=?').get(Number(articleArtifactId));
      if (!artifact) throw new Error('文章产物候选不存在');
      if (!ARTICLE_MATCH_ARTIFACT_TYPES.has(artifact.artifact_type)) throw new Error('只能匹配文章终稿、早报终稿或图文发布文案');
      const resolvedType = artifact.artifact_type === '图文发布文案' ? 'social' : 'article';
      if (contentType !== 'unknown' && contentType !== resolvedType) throw new Error('内容类型与所选产物类型不一致');
      this.db.prepare(`UPDATE wechat_article_metric_matches SET article_artifact_id=?,content_type=?,match_method='manual_confirm',confidence='high',status='confirmed',matched_title=?,note=?,updated_at=?,confirmed_at=? WHERE id=?`).run(artifact.id, resolvedType, artifact.title || '', String(note || '').trim(), timestamp, timestamp, current.id);
    } else if (action === 'reject') {
      this.db.prepare(`UPDATE wechat_article_metric_matches SET article_artifact_id=NULL,content_type='unknown',match_method='manual_reject',confidence='none',status='rejected',matched_title='',note=?,updated_at=?,confirmed_at=NULL WHERE id=?`).run(String(note || '').trim(), timestamp, current.id);
    } else if (action === 'skip') {
      if (!['article', 'social'].includes(contentType)) throw new Error('请先选择内容类型');
      this.db.prepare(`UPDATE wechat_article_metric_matches SET article_artifact_id=NULL,content_type=?,match_method='manual_skip',confidence='none',status='rejected',matched_title='',note=?,updated_at=?,confirmed_at=NULL WHERE id=?`).run(contentType, String(note || '跳过本地产物匹配').trim(), timestamp, current.id);
    } else throw new Error('匹配确认动作无效');
    this.db.prepare(`INSERT INTO wechat_article_match_logs(match_id,action,from_artifact_id,to_artifact_id,match_method,confidence,note,created_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(current.id, action === 'skip' ? 'reject' : action, current.article_artifact_id ?? null, action === 'confirm' ? Number(articleArtifactId) : null, action === 'confirm' ? 'manual_confirm' : action === 'skip' ? 'manual_skip' : 'manual_reject', action === 'confirm' ? 'high' : 'none', String(note || '').trim(), timestamp);
    return this.getWechatArticleMetricMatch(id);
  }
  getCurrentArticleContentSnapshot(metricId) {
    const row = this.db.prepare('SELECT * FROM article_content_snapshots WHERE metric_id=? AND is_current=1 ORDER BY id DESC LIMIT 1').get(Number(metricId));
    return this.#decorateContentSnapshot(row);
  }
  listArticleContentLinks({ limit = 200 } = {}) {
    const rows = this.db.prepare(`SELECT mm.id AS match_id,mm.status AS match_status,mm.confidence,mm.match_method,
      wm.id AS metric_id,wm.notified,wm.title AS metric_title,wm.published_date,wm.reads,wm.shares,wm.follows_after_read,wm.content_url,
      aa.id AS article_artifact_id,aa.title AS artifact_title,aa.article_date,aa.version_label,aa.artifact_type,aa.file_path,
      s.id AS snapshot_id,s.source_kind,s.source_path,s.source_url,s.final_url,s.title AS snapshot_title,s.content_chars,s.status AS content_status,s.error AS content_error,s.fetched_at
      FROM wechat_article_metric_matches mm JOIN wechat_article_metrics wm ON wm.id=mm.metric_id
      LEFT JOIN article_artifact_index aa ON aa.id=mm.article_artifact_id
      LEFT JOIN article_content_snapshots s ON s.metric_id=mm.metric_id AND s.is_current=1
      WHERE mm.status IN ('confirmed','auto_confirmed')
      ORDER BY wm.published_date DESC,wm.id DESC LIMIT ?`).all(Math.min(Math.max(Number(limit) || 200, 1), 1000));
    return rows.map((row) => ({ ...row, evidence_assets: row.article_artifact_id ? this.listArticleEvidenceAssets({ artifactId: row.article_artifact_id }) : [] }));
  }
  saveArticleContentSnapshot(input = {}) {
    const metricId = Number(input.metricId); if (!metricId) throw new Error('缺少公众号文章指标');
    const sourceKinds = new Set(['local_final', 'local_reviewed', 'local_humanized', 'local_draft', 'local_html', 'external_url']);
    const sourceKind = sourceKinds.has(input.sourceKind) ? input.sourceKind : 'external_url';
    const status = input.status === 'error' ? 'error' : 'ok'; const timestamp = now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE article_content_snapshots SET is_current=0 WHERE metric_id=? AND is_current=1').run(metricId);
      const result = this.db.prepare(`INSERT INTO article_content_snapshots
        (metric_id,article_artifact_id,source_kind,source_path,source_url,final_url,title,content,content_chars,status,error,fetched_at,is_current,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        metricId, input.articleArtifactId ?? null, sourceKind, String(input.sourcePath || ''), String(input.sourceUrl || ''), String(input.finalUrl || ''),
        String(input.title || ''), String(input.content || ''), Number(input.contentChars ?? String(input.content || '').length), status,
        String(input.error || ''), String(input.fetchedAt || timestamp), 1, timestamp,
      );
      this.db.exec('COMMIT');
      return this.#decorateContentSnapshot(this.db.prepare('SELECT * FROM article_content_snapshots WHERE id=?').get(Number(result.lastInsertRowid)));
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  listArticleEvidenceAssets({ artifactId = null } = {}) {
    const rows = artifactId
      ? this.db.prepare('SELECT * FROM article_evidence_assets WHERE article_artifact_id=? ORDER BY id DESC').all(Number(artifactId))
      : this.db.prepare('SELECT * FROM article_evidence_assets ORDER BY id DESC').all();
    return rows.map((row) => ({ ...row }));
  }
  replaceArticleEvidenceAssets({ artifactId, snapshotId = null, assets = [] } = {}) {
    const id = Number(artifactId); if (!id) return [];
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM article_evidence_assets WHERE article_artifact_id=?').run(id);
      const insert = this.db.prepare(`INSERT INTO article_evidence_assets(article_artifact_id,content_snapshot_id,asset_path,asset_type,label,detected_method,created_at)
        VALUES(?,?,?,?,?,?,?)`);
      const timestamp = now();
      for (const asset of Array.isArray(assets) ? assets : []) {
        const assetPath = String(asset.path || asset.assetPath || '').trim(); if (!assetPath) continue;
        insert.run(id, snapshotId ?? null, assetPath, String(asset.type || 'other'), String(asset.label || ''), String(asset.detectedMethod || 'filename'), timestamp);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.listArticleEvidenceAssets({ artifactId: id });
  }
  listArticleContentAnalyses({ limit = 1000 } = {}) {
    const rows = this.db.prepare(`SELECT mm.id AS match_id,mm.status AS match_status,mm.confidence,mm.match_method,
      aa.id AS article_artifact_id,aa.title AS artifact_title,aa.article_date,aa.version_label,aa.artifact_type,aa.file_path,
      wm.id AS metric_id,wm.import_batch_id,wm.notified,wm.title AS metric_title,wm.published_date,wm.reads,wm.shares,wm.follows_after_read,wm.content_url,
      s.id AS snapshot_id,s.source_kind,s.source_path,s.source_url,s.final_url,s.title AS snapshot_title,s.content,s.content_chars,s.status AS content_status,s.error AS content_error,s.fetched_at,
      f.id AS feature_id,f.extraction_version,f.features_json,f.extracted_at
      FROM wechat_article_metric_matches mm
      JOIN wechat_article_metrics wm ON wm.id=mm.metric_id
      LEFT JOIN article_artifact_index aa ON aa.id=mm.article_artifact_id
      JOIN article_content_snapshots s ON s.metric_id=mm.metric_id AND s.is_current=1
      LEFT JOIN article_content_features f ON f.content_snapshot_id=s.id
      WHERE mm.status IN ('confirmed','auto_confirmed')
      ORDER BY wm.published_date DESC,wm.id DESC LIMIT ?`).all(Math.min(Math.max(Number(limit) || 1000, 1), 2000));
    return rows.map((row) => ({ ...row, writer_skill_id: writerSkillFromManifest(row.file_path), features: jsonValue(row.features_json, null), evidence_assets: row.snapshot_id ? this.listArticleEvidenceAssets({ artifactId: row.article_artifact_id }) : [] }));
  }
  getArticleContentFeatures(snapshotId) {
    const row = this.db.prepare('SELECT * FROM article_content_features WHERE content_snapshot_id=?').get(Number(snapshotId));
    return this.#decorateContentFeatures(row);
  }
  saveArticleContentFeatures({ snapshotId, metricId, features = {}, extractionVersion = 'v1', extractedAt = '' } = {}) {
    const snapshot = this.db.prepare('SELECT id,metric_id FROM article_content_snapshots WHERE id=?').get(Number(snapshotId));
    if (!snapshot) throw new Error('正文快照不存在');
    const timestamp = extractedAt || now();
    this.db.prepare(`INSERT INTO article_content_features(content_snapshot_id,metric_id,extraction_version,features_json,extracted_at)
      VALUES(?,?,?,?,?) ON CONFLICT(content_snapshot_id) DO UPDATE SET metric_id=excluded.metric_id,extraction_version=excluded.extraction_version,features_json=excluded.features_json,extracted_at=excluded.extracted_at`)
      .run(Number(snapshotId), Number(metricId || snapshot.metric_id), String(extractionVersion || 'v1'), JSON.stringify(features || {}), timestamp);
    return this.getArticleContentFeatures(snapshotId);
  }
  getLatestContentFeedbackSnapshot() {
    const row = this.db.prepare('SELECT * FROM content_feedback_snapshots ORDER BY id DESC LIMIT 1').get();
    return this.#decorateFeedbackSnapshot(row);
  }
  listContentFeedbackSnapshots({ limit = 20 } = {}) {
    return this.db.prepare('SELECT * FROM content_feedback_snapshots ORDER BY id DESC LIMIT ?').all(Math.min(Math.max(Number(limit) || 20, 1), 100)).map((row) => this.#decorateFeedbackSnapshot(row));
  }
  saveContentFeedbackSnapshot(input = {}) {
    const result = this.db.prepare(`INSERT INTO content_feedback_snapshots
      (generated_at,metric_window_start,metric_window_end,source_metric_ids_json,source_batch_ids_json,linked_article_count,feature_count,confidence,topic_signals_json,title_signals_json,body_signals_json,channel_signals_json,recommendations_json,unresolved_questions_json,writer_skill_evidence_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      String(input.generatedAt || input.generated_at || now()), String(input.metricWindowStart || input.metric_window_start || ''), String(input.metricWindowEnd || input.metric_window_end || ''),
      JSON.stringify(input.sourceMetricIds || input.source_metric_ids || []), JSON.stringify(input.sourceBatchIds || input.source_batch_ids || []), Number(input.linkedArticleCount ?? input.linked_article_count ?? 0), Number(input.featureCount ?? input.feature_count ?? 0),
      ['low', 'medium', 'high'].includes(input.confidence) ? input.confidence : 'low', JSON.stringify(input.topicSignals || input.topic_signals || []), JSON.stringify(input.titleSignals || input.title_signals || []), JSON.stringify(input.bodySignals || input.body_signals || []), JSON.stringify(input.channelSignals || input.channel_signals || []), JSON.stringify(input.recommendations || []), JSON.stringify(input.unresolvedQuestions || input.unresolved_questions || []), JSON.stringify(input.writerSkillEvidence || input.writer_skill_evidence || []),
    );
    return this.#decorateFeedbackSnapshot(this.db.prepare('SELECT * FROM content_feedback_snapshots WHERE id=?').get(Number(result.lastInsertRowid)));
  }
  listContentFeedbackAdjustmentDrafts({ limit = 20 } = {}) {
    return this.db.prepare('SELECT * FROM content_feedback_adjustment_drafts ORDER BY id DESC LIMIT ?').all(Math.min(Math.max(Number(limit) || 20, 1), 100)).map((row) => this.#decorateAdjustmentDraft(row));
  }
  getContentFeedbackAdjustmentDraft(id) {
    return this.#decorateAdjustmentDraft(this.db.prepare('SELECT * FROM content_feedback_adjustment_drafts WHERE id=?').get(Number(id)));
  }
  saveContentFeedbackAdjustmentDraft(input = {}) {
    const result = this.db.prepare(`INSERT INTO content_feedback_adjustment_drafts
      (feedback_snapshot_id,generated_at,status,provider,model,summary,source_json,changes_json,warnings_json)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      input.feedback_snapshot_id ? Number(input.feedback_snapshot_id) : null, String(input.generated_at || now()), 'pending', String(input.provider || ''), String(input.model || ''), String(input.summary || ''),
      JSON.stringify(input.source || {}), JSON.stringify(input.changes || []), JSON.stringify(input.warnings || []),
    );
    return this.getContentFeedbackAdjustmentDraft(Number(result.lastInsertRowid));
  }
  updateContentFeedbackAdjustmentDraftStatus(id, status) {
    if (!['confirmed', 'rejected'].includes(status)) throw new Error('调整草案状态无效');
    this.db.prepare('UPDATE content_feedback_adjustment_drafts SET status=?,confirmed_at=? WHERE id=? AND status=?').run(status, now(), Number(id), 'pending');
    return this.getContentFeedbackAdjustmentDraft(id);
  }
  deleteContentFeedbackAdjustmentDraft(id) {
    const draft = this.getContentFeedbackAdjustmentDraft(id);
    if (!draft) { const error = new Error('调整草案不存在'); error.code = 'ADJUSTMENT_DRAFT_NOT_FOUND'; throw error; }
    if (draft.status !== 'rejected') { const error = new Error('只有已跳过的调整草案可以删除'); error.code = 'ADJUSTMENT_DRAFT_DELETE_NOT_ALLOWED'; throw error; }
    this.db.prepare("DELETE FROM content_feedback_adjustment_drafts WHERE id=? AND status='rejected'").run(Number(id));
    return { id: Number(id), deleted: true };
  }
  getWechatReview({ month = '' } = {}) {
    const monthWhere = month ? 'WHERE substr(published_date,1,7)=?' : ''; const values = month ? [month] : [];
    const articles = this.db.prepare(`SELECT * FROM wechat_article_metrics ${monthWhere} ORDER BY published_date DESC,id DESC`).all(...values);
    const aggregate = (notified) => { const rows = articles.filter((item) => Boolean(item.notified) === notified); return { count: rows.length, reads: rows.reduce((sum, item) => sum + Number(item.reads || 0), 0), shares: rows.reduce((sum, item) => sum + Number(item.shares || 0), 0), follows: rows.reduce((sum, item) => sum + Number(item.follows_after_read || 0), 0), delivery: rows.reduce((sum, item) => sum + Number(item.delivery || 0), 0) }; };
    const topArticles = [...articles].sort((a, b) => Number(b.reads || 0) - Number(a.reads || 0)).slice(0, 8);
    const weekly = this.db.prepare(`SELECT strftime('%Y-W%W',published_date) AS week,COUNT(*) AS articles,SUM(COALESCE(reads,0)) AS reads,SUM(COALESCE(shares,0)) AS shares,SUM(COALESCE(follows_after_read,0)) AS follows FROM wechat_article_metrics ${monthWhere} GROUP BY week ORDER BY week DESC LIMIT 12`).all(...values);
    const growth = this.db.prepare(`SELECT * FROM wechat_user_growth_daily ${month ? 'WHERE substr(stat_date,1,7)=?' : ''} ORDER BY stat_date ASC`).all(...(month ? [month] : []));
    const trendWhere = ["stat_date GLOB '????-??-??'", "channel != ''"];
    const trendValues = [];
    if (month) { trendWhere.push('substr(stat_date,1,7)=?'); trendValues.push(month); }
    const trends = this.db.prepare(`SELECT stat_date,SUM(COALESCE(reads,0)) AS reads,SUM(COALESCE(shares,0)) AS shares,SUM(COALESCE(favorites,0)) AS favorites,SUM(COALESCE(published_count,0)) AS published_count FROM wechat_content_trends WHERE ${trendWhere.join(' AND ')} GROUP BY stat_date ORDER BY stat_date ASC`).all(...trendValues);
    const channels = this.db.prepare(`SELECT channel,SUM(COALESCE(reads,0)) AS reads FROM wechat_content_trends WHERE ${trendWhere.join(' AND ')} GROUP BY channel ORDER BY reads DESC`).all(...trendValues);
    const regularReaders = this.db.prepare('SELECT * FROM wechat_regular_reader_trends ORDER BY period ASC').all();
    return { growth, articles, top_articles: topArticles, weekly, notified: aggregate(true), unnotified: aggregate(false), trends, channels, regular_readers: regularReaders, imports: this.listWechatImports() };
  }

  listCalendarPlans(month) { return this.listPlans({ month }).map((plan) => ({ content_type: 'writing_plan', id: plan.id, title: plan.title_direction || plan.material_title || '待发展素材', batch_date: plan.planned_date, updated_at: plan.updated_at, pool_role: plan.column_name || '主动写作', plan_status: plan.status, column_name: plan.column_name, column_id: plan.column_id, material_id: plan.material_id, material_title: plan.material_title, raw_text: plan.raw_text, title_direction: plan.title_direction, title_intent: plan.title_intent, teaser: plan.teaser, publication_id: plan.publication_id, publication_status: plan.publication_status, publication_url: plan.publication_url, publication_published_at: plan.publication_published_at })); }

  #material(row) { return { ...row, tags: jsonValue(row.tags_json, []), evidence: jsonValue(row.evidence_json, []), iteration: jsonValue(row.iteration_json, {}), assessment: jsonValue(row.assessment_json, {}), recommended_column_id: row.recommended_column_id ? Number(row.recommended_column_id) : null }; }
  #decorateMatch(row) { return row ? { ...row, candidate_ids: jsonValue(row.candidate_ids_json, []), candidate_snapshot: jsonValue(row.candidate_snapshot_json, []) } : null; }
  #decorateContentSnapshot(row) { return row ? { ...row, content_chars: Number(row.content_chars || 0), is_current: Boolean(row.is_current) } : null; }
  #decorateContentFeatures(row) { return row ? { ...row, features: jsonValue(row.features_json, {}) } : null; }
  #decorateFeedbackSnapshot(row) {
    return row ? {
      ...row,
      source_metric_ids: jsonValue(row.source_metric_ids_json, []),
      source_batch_ids: jsonValue(row.source_batch_ids_json, []),
      linked_article_count: Number(row.linked_article_count || 0),
      feature_count: Number(row.feature_count || 0),
      topic_signals: jsonValue(row.topic_signals_json, []),
      title_signals: jsonValue(row.title_signals_json, []),
      body_signals: jsonValue(row.body_signals_json, []),
      channel_signals: jsonValue(row.channel_signals_json, []),
      recommendations: jsonValue(row.recommendations_json, []),
      unresolved_questions: jsonValue(row.unresolved_questions_json, []),
      writer_skill_evidence: jsonValue(row.writer_skill_evidence_json, []),
    } : null;
  }
  #decorateAdjustmentDraft(row) {
    return row ? {
      ...row,
      feedback_snapshot_id: row.feedback_snapshot_id ? Number(row.feedback_snapshot_id) : null,
      source: jsonValue(row.source_json, {}),
      changes: jsonValue(row.changes_json, []),
      warnings: jsonValue(row.warnings_json, []),
    } : null;
  }
}
