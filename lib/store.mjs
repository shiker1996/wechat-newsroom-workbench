import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function publishedTimestamp(item) {
  const value = Date.parse(item.published_at || item.created_at || '');
  return Number.isFinite(value) ? value : 0;
}

function newestFirst(a,b) {
  return publishedTimestamp(b)-publishedTimestamp(a) || Number(b.score ?? -1)-Number(a.score ?? -1) || b.id-a.id;
}

export class Store {
  constructor(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS batches (
        id TEXT PRIMARY KEY,
        batch_date TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        stage TEXT NOT NULL DEFAULT 'collect',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        item_count INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS subscription_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        source_group TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_key TEXT NOT NULL,
        source_name TEXT NOT NULL,
        status TEXT NOT NULL,
        item_count INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS hotspots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        source TEXT NOT NULL,
        external_id TEXT,
        title TEXT NOT NULL,
        url TEXT,
        category TEXT NOT NULL DEFAULT '待分类',
        market_scope TEXT NOT NULL DEFAULT '待标注',
        score REAL,
        published_at TEXT,
        raw_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE(batch_id, source, title),
        FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS hotspot_sources (
        hotspot_id INTEGER PRIMARY KEY,
        url TEXT NOT NULL,
        final_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '',
        published_at TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        content_chars INTEGER NOT NULL DEFAULT 0,
        fetched_at TEXT NOT NULL,
        error TEXT NOT NULL DEFAULT '',
        cache_path TEXT NOT NULL DEFAULT '',
        fetch_method TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(hotspot_id) REFERENCES hotspots(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        file_path TEXT NOT NULL UNIQUE,
        size INTEGER NOT NULL DEFAULT 0,
        modified_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ready',
        FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        hotspot_id INTEGER,
        candidate_id TEXT NOT NULL,
        pool_role TEXT NOT NULL DEFAULT '人工补选',
        risk_level TEXT NOT NULL DEFAULT '待评估',
        angle TEXT NOT NULL DEFAULT '',
        thesis TEXT NOT NULL DEFAULT '',
        h_score REAL,
        b_score REAL,
        p_score REAL,
        s_score REAL,
        d_score REAL,
        f_score REAL,
        status TEXT NOT NULL DEFAULT 'pooled',
        composite INTEGER NOT NULL DEFAULT 0,
        hotspot_titles TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(batch_id, candidate_id),
        FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS candidate_hotspots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_row_id INTEGER NOT NULL,
        hotspot_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(candidate_row_id, hotspot_id),
        FOREIGN KEY(candidate_row_id) REFERENCES candidates(id) ON DELETE CASCADE,
        FOREIGN KEY(hotspot_id) REFERENCES hotspots(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS editorial_sessions (
        candidate_row_id INTEGER PRIMARY KEY,
        editor_question TEXT NOT NULL DEFAULT '',
        confirmed_facts TEXT NOT NULL DEFAULT '',
        author_opinions TEXT NOT NULL DEFAULT '',
        confirmed_experiences TEXT NOT NULL DEFAULT '',
        rejected_angles TEXT NOT NULL DEFAULT '',
        open_questions TEXT NOT NULL DEFAULT '',
        forbidden_claims TEXT NOT NULL DEFAULT '',
        next_action TEXT NOT NULL DEFAULT 'DISCUSS',
        experience_required INTEGER NOT NULL DEFAULT 0,
        brief_status TEXT NOT NULL DEFAULT 'DISCUSS',
        updated_at TEXT NOT NULL,
        FOREIGN KEY(candidate_row_id) REFERENCES candidates(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS editorial_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_row_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(candidate_row_id) REFERENCES candidates(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        candidate_row_id INTEGER,
        kind TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        file_path TEXT,
        visible_chars INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(batch_id, candidate_row_id, kind),
        FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE,
        FOREIGN KEY(candidate_row_id) REFERENCES candidates(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS model_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        purpose TEXT NOT NULL,
        batch_id TEXT,
        candidate_row_id INTEGER,
        estimated_input_tokens INTEGER NOT NULL DEFAULT 0,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        compressed INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE SET NULL,
        FOREIGN KEY(candidate_row_id) REFERENCES candidates(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS ai_runs (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        type TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        progress TEXT NOT NULL DEFAULT '',
        result_json TEXT NOT NULL DEFAULT '{}',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_hotspots_batch ON hotspots(batch_id);
      CREATE INDEX IF NOT EXISTS idx_hotspots_title ON hotspots(title);
      CREATE INDEX IF NOT EXISTS idx_artifacts_batch ON artifacts(batch_id);
      CREATE INDEX IF NOT EXISTS idx_candidates_batch ON candidates(batch_id);
      CREATE INDEX IF NOT EXISTS idx_editorial_messages_candidate ON editorial_messages(candidate_row_id,id);
      CREATE INDEX IF NOT EXISTS idx_documents_batch ON documents(batch_id);
      CREATE INDEX IF NOT EXISTS idx_model_calls_created ON model_calls(created_at);
      CREATE INDEX IF NOT EXISTS idx_ai_runs_batch ON ai_runs(batch_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_subscription_runs_batch ON subscription_runs(batch_id,id);
      CREATE INDEX IF NOT EXISTS idx_subscription_runs_source ON subscription_runs(source_key,id);
    `);
    const sourceColumns=new Set(this.db.prepare('PRAGMA table_info(hotspot_sources)').all().map((column)=>column.name));
    if(!sourceColumns.has('fetch_method'))this.db.exec("ALTER TABLE hotspot_sources ADD COLUMN fetch_method TEXT NOT NULL DEFAULT ''");
    const hotspotColumns=new Set(this.db.prepare('PRAGMA table_info(hotspots)').all().map((column)=>column.name));
    if(!hotspotColumns.has('source_group'))this.db.exec("ALTER TABLE hotspots ADD COLUMN source_group TEXT NOT NULL DEFAULT ''");
    if(!hotspotColumns.has('source_type'))this.db.exec("ALTER TABLE hotspots ADD COLUMN source_type TEXT NOT NULL DEFAULT ''");
    if(!hotspotColumns.has('source_name'))this.db.exec("ALTER TABLE hotspots ADD COLUMN source_name TEXT NOT NULL DEFAULT ''");
    const legacy=this.db.prepare("SELECT id,source,raw_json FROM hotspots WHERE source_group='' OR source_type='' OR source_name=''").all();
    const updateSource=this.db.prepare('UPDATE hotspots SET source=?,source_group=?,source_type=?,source_name=? WHERE id=?');
    for(const row of legacy) {
      let raw={}; try{raw=JSON.parse(row.raw_json);}catch{}
      const sourceGroup=raw.subreddit?'reddit':'rsshub';
      const sourceType=raw.subreddit?'reddit':/^\/twitter\/user\//i.test(raw.route||'')?'twitter':/^https?:/i.test(raw.route||'')?'direct':'rsshub';
      const identity=raw.subreddit?`r/${raw.subreddit}`:String(raw.route||row.source).replace(/[?&]limit=\d+/g,'').replace(/[?&]$/,'');
      const sourceKey=`${sourceType}:${identity}`;
      const sourceName=raw.feedLabel||(raw.subreddit?`r/${raw.subreddit}`:raw.route)||row.source;
      updateSource.run(sourceKey,sourceGroup,sourceType,sourceName,row.id);
    }
    const candidateCols=new Set(this.db.prepare('PRAGMA table_info(candidates)').all().map((col)=>col.name));
    if(!candidateCols.has('composite'))this.db.exec("ALTER TABLE candidates ADD COLUMN composite INTEGER NOT NULL DEFAULT 0");
    if(!candidateCols.has('hotspot_titles'))this.db.exec("ALTER TABLE candidates ADD COLUMN hotspot_titles TEXT NOT NULL DEFAULT ''");
    const linkTableExists=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='candidate_hotspots'").get();
    if(!linkTableExists)this.db.exec(`
      CREATE TABLE candidate_hotspots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_row_id INTEGER NOT NULL,
        hotspot_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(candidate_row_id, hotspot_id),
        FOREIGN KEY(candidate_row_id) REFERENCES candidates(id) ON DELETE CASCADE,
        FOREIGN KEY(hotspot_id) REFERENCES hotspots(id) ON DELETE CASCADE
      )
    `);
    // Migration v3: make hotspot_id nullable (drop NOT NULL + UNIQUE(batch_id,hotspot_id))
    let needsMigration=false;
    try {
      const oldIdx = this.db.prepare('SELECT "unique" FROM pragma_index_list(?) WHERE name=?').get('candidates','sqlite_autoindex_candidates_1');
      if(oldIdx) needsMigration=true;
    } catch{needsMigration=true;}
    if(needsMigration) {
      let cols=[];
      try{cols = this.db.prepare('PRAGMA index_info('+String.fromCharCode(39)+'sqlite_autoindex_candidates_1'+String.fromCharCode(39)+')').all();}catch{}
      if(cols.length===2&&cols.some(c=>c.name==='hotspot_id')) {
        try {
          this.db.exec('BEGIN TRANSACTION');
          this.db.prepare('INSERT INTO candidates (batch_id, hotspot_id, candidate_id, status, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)')
            .run('_mig_test_null','_MIG_TEST_S000','pooled',new Date().toISOString(),new Date().toISOString());
          this.db.prepare('DELETE FROM candidates WHERE batch_id=?').run('_mig_test_null');
          this.db.exec('COMMIT');
        } catch(e) {
          this.db.exec('ROLLBACK');
          this.db.exec('CREATE TABLE candidates_new (id INTEGER PRIMARY KEY AUTOINCREMENT,batch_id TEXT NOT NULL,hotspot_id INTEGER,candidate_id TEXT NOT NULL,pool_role TEXT NOT NULL DEFAULT '+String.fromCharCode(39)+'人工补选'+String.fromCharCode(39)+',risk_level TEXT NOT NULL DEFAULT '+String.fromCharCode(39)+'待评估'+String.fromCharCode(39)+',angle TEXT NOT NULL DEFAULT '+String.fromCharCode(39)+String.fromCharCode(39)+',thesis TEXT NOT NULL DEFAULT '+String.fromCharCode(39)+String.fromCharCode(39)+',h_score REAL,b_score REAL,p_score REAL,s_score REAL,d_score REAL,f_score REAL,status TEXT NOT NULL DEFAULT '+String.fromCharCode(39)+'pooled'+String.fromCharCode(39)+',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,composite INTEGER NOT NULL DEFAULT 0,hotspot_titles TEXT NOT NULL DEFAULT '+String.fromCharCode(39)+String.fromCharCode(39)+',UNIQUE(batch_id, candidate_id),FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE)');
          // Use explicit column names so old table's created_at/updated_at/composite/hotspot_titles map correctly
          this.db.exec('INSERT INTO candidates_new (id,batch_id,hotspot_id,candidate_id,pool_role,risk_level,angle,thesis,h_score,b_score,p_score,s_score,d_score,f_score,status,created_at,updated_at,composite,hotspot_titles) SELECT id,batch_id,hotspot_id,candidate_id,pool_role,risk_level,angle,thesis,h_score,b_score,p_score,s_score,d_score,f_score,status,created_at,updated_at,composite,hotspot_titles FROM candidates');
          this.db.exec('DROP TABLE candidates');
          this.db.exec('ALTER TABLE candidates_new RENAME TO candidates');
          this.db.exec('CREATE INDEX IF NOT EXISTS idx_candidates_batch ON candidates(batch_id)');
        }
      }
    }
  }

  createBatch({ date, title, note = '' }) {
    const now = new Date().toISOString();
    const id = `${date}-${Math.random().toString(36).slice(2, 8)}`;
    this.db.prepare(`INSERT INTO batches
      (id, batch_date, title, status, stage, note, created_at, updated_at)
      VALUES (?, ?, ?, 'draft', 'collect', ?, ?, ?)`)
      .run(id, date, title, note, now, now);
    return this.getBatch(id);
  }

  listBatches(limit = 60) {
    return this.db.prepare(`
      SELECT b.*,
        (SELECT COUNT(*) FROM hotspots h WHERE h.batch_id=b.id) AS hotspot_count,
        (SELECT COUNT(*) FROM artifacts a WHERE a.batch_id=b.id) AS artifact_count
      FROM batches b ORDER BY batch_date DESC, created_at DESC LIMIT ?
    `).all(limit);
  }

  getBatch(id) {
    const batch = this.db.prepare('SELECT * FROM batches WHERE id=?').get(id);
    if (!batch) return null;
    batch.sources = this.db.prepare(
      'SELECT * FROM source_runs WHERE batch_id=? ORDER BY id DESC'
    ).all(id);
    batch.subscription_runs = this.db.prepare(
      'SELECT * FROM subscription_runs WHERE batch_id=? ORDER BY id DESC'
    ).all(id);
    batch.hotspots = this.db.prepare('SELECT * FROM hotspots WHERE batch_id=?').all(id).sort(newestFirst);
    batch.artifacts = this.db.prepare(
      'SELECT * FROM artifacts WHERE batch_id=? ORDER BY modified_at DESC'
    ).all(id);
    batch.ai_runs = this.listAiRuns(id, 20);
    batch.ai_status = {
      tagged: batch.hotspots.filter((item) => {
        try { return Boolean(JSON.parse(item.raw_json).aiTags?.eventKey); } catch { return false; }
      }).length,
      total: batch.hotspots.length,
      latestResearch: batch.ai_runs.find((item) => item.type === 'research') ?? null,
    };
    return batch;
  }

  updateBatch(id, fields) {
    const allowed = ['title', 'status', 'stage', 'note'];
    const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
    if (!entries.length) return this.getBatch(id);
    entries.push(['updated_at', new Date().toISOString()]);
    const sql = `UPDATE batches SET ${entries.map(([key]) => `${key}=?`).join(', ')} WHERE id=?`;
    this.db.prepare(sql).run(...entries.map(([, value]) => value), id);
    return this.getBatch(id);
  }

  startSourceRun(batchId, source) {
    const result = this.db.prepare(`INSERT INTO source_runs
      (batch_id, source, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(batchId, source, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  finishSourceRun(id, status, itemCount = 0, error = null) {
    this.db.prepare(`UPDATE source_runs SET status=?, item_count=?, error=?, ended_at=? WHERE id=?`)
      .run(status, itemCount, error, new Date().toISOString(), id);
  }

  recordSubscriptionRun(batchId, result) {
    const endedAt=result.endedAt||new Date().toISOString();
    const startedAt=result.startedAt||endedAt;
    this.db.prepare(`INSERT INTO subscription_runs
      (batch_id,source_group,source_type,source_key,source_name,status,item_count,duration_ms,error,started_at,ended_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(batchId,result.sourceGroup,result.sourceType,result.sourceKey,result.sourceName,
      result.status,Number(result.itemCount||0),Number(result.durationMs||0),result.error||null,startedAt,endedAt);
  }

  listSubscriptionHealth() {
    return this.db.prepare(`SELECT r.* FROM subscription_runs r
      JOIN (SELECT source_key,MAX(id) id FROM subscription_runs GROUP BY source_key) latest ON latest.id=r.id
      ORDER BY r.source_name`).all();
  }

  recoverInterruptedWork() {
    const now=new Date().toISOString();
    const reason='工作台重启时任务仍在运行，已标记为中断；可从对应步骤重新执行';
    const ai=this.db.prepare("UPDATE ai_runs SET status='interrupted',error=?,progress='任务已中断，可重新执行',updated_at=? WHERE status='running'").run(reason,now).changes;
    const sources=this.db.prepare("UPDATE source_runs SET status='interrupted',error=?,ended_at=? WHERE status='running'").run(reason,now).changes;
    const subscriptions=this.db.prepare("UPDATE subscription_runs SET status='interrupted',error=?,ended_at=? WHERE status='running'").run(reason,now).changes;
    const batches=this.db.prepare("UPDATE batches SET status='interrupted',updated_at=? WHERE status='running'").run(now).changes;
    return {aiRuns:Number(ai),sourceRuns:Number(sources),subscriptionRuns:Number(subscriptions),batches:Number(batches)};
  }

  addHotspots(batchId, sourceGroup, items) {
    const insert = this.db.prepare(`INSERT INTO hotspots
      (batch_id, source, source_group, source_type, source_name, external_id, title, url, category, market_scope, score, published_at, raw_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(batch_id, source, title) DO UPDATE SET
        url=excluded.url, published_at=excluded.published_at, source_group=excluded.source_group,
        source_type=excluded.source_type,source_name=excluded.source_name,raw_json=excluded.raw_json`);
    const now = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      for (const item of items) {
        const sourceKey=item.sourceKey||sourceGroup; const sourceType=item.sourceType||sourceGroup; const sourceName=item.sourceName||sourceKey;
        insert.run(batchId, sourceKey, sourceGroup, sourceType, sourceName, item.id ?? null, item.title, item.url ?? null,
          item.category ?? '待分类', item.marketScope ?? '待标注', item.score ?? null,
          item.publishedAt ?? null, JSON.stringify(item), now);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  addManualHotspot(batchId, { title, url, category, notes }) {
    const safeTitle = String(title || '').trim();
    if (!safeTitle) throw new Error('标题不能为空');
    const key = `manual:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
    const item = {
      sourceKey: key, sourceType: 'manual', sourceName: '手动添加',
      id: key, title: safeTitle, url: url?.trim() || null,
      category: category || '待分类', marketScope: '手动补入',
      publishedAt: new Date().toISOString(), notes: notes?.trim() || '',
    };
    this.addHotspots(batchId, 'manual', [item]);
    return this.db.prepare('SELECT * FROM hotspots WHERE batch_id=? AND source=?').get(batchId, key) ?? null;
  }

  listHotspots({ q = '', source = '', date = '', limit = 200 }) {
    const where = [];
    const values = [];
    if (q) { where.push('h.title LIKE ?'); values.push(`%${q}%`); }
    if (source) { where.push('(h.source_group=? OR h.source=?)'); values.push(source,source); }
    if (date) { where.push('b.batch_date=?'); values.push(date); }
    values.push(limit);
    return this.db.prepare(`SELECT h.*, b.batch_date, b.title AS batch_title
      FROM hotspots h JOIN batches b ON b.id=h.batch_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY b.batch_date DESC, h.id DESC LIMIT ?`).all(...values)
      .sort((a,b) => b.batch_date.localeCompare(a.batch_date) || newestFirst(a,b));
  }

  getHotspot(id) {
    return this.db.prepare('SELECT * FROM hotspots WHERE id=?').get(id) ?? null;
  }

  updateHotspotTags(id, tags) {
    const current = this.getHotspot(id);
    if (!current) return null;
    let raw = {};
    try { raw = JSON.parse(current.raw_json); } catch {}
    raw.aiTags = {
      ...(raw.aiTags ?? {}),
      chinaRelevance: tags.chinaRelevance ?? null,
      relevanceReason: tags.relevanceReason ?? '',
      riskLevel: tags.riskLevel ?? '待评估',
      riskReason: tags.riskReason ?? '',
      eventKey: tags.eventKey ?? '',
      keywords: Array.isArray(tags.keywords) ? tags.keywords.slice(0, 6) : [],
      globalException: Boolean(tags.globalException),
      preScores: tags.preScores ?? null,
      credibleScoop: Number(tags.credibleScoop || 0),
      saturationPenalty: Number(tags.saturationPenalty || 0),
      duplicatePenalty: Number(tags.duplicatePenalty || 0),
      blackHorseSignals: Array.isArray(tags.blackHorseSignals) ? tags.blackHorseSignals.slice(0, 4) : [],
      taggedAt: new Date().toISOString(),
    };
    this.db.prepare(`UPDATE hotspots SET category=?, market_scope=?, score=?, raw_json=? WHERE id=?`)
      .run(tags.category || current.category, tags.marketScope || current.market_scope,
        Number.isFinite(Number(tags.score)) ? Number(tags.score) : current.score, JSON.stringify(raw), id);
    return this.getHotspot(id);
  }

  getBatchOverview(batchId) {
    const items = this.db.prepare('SELECT * FROM hotspots WHERE batch_id=?').all(batchId).sort(newestFirst);
    const channels = new Map();
    const sources = new Map();
    const exactUrls = new Map();
    const wordCounts = new Map();
    const stop = new Set(['the','and','for','with','from','this','that','are','was','you','your','new','how','why','what','into','about','after','before','more','一个','这个','如何','什么','为什么','以及','最新','发布','消息','公司','进行']);
    for (const item of items) {
      const sourceGroup=item.source_group||item.source;
      sources.set(sourceGroup, (sources.get(sourceGroup) ?? 0) + 1);
      let raw = {};
      try { raw = JSON.parse(item.raw_json); } catch {}
      const channel = item.source_name||raw.feedLabel||(raw.subreddit ? `r/${raw.subreddit}` : raw.route)||item.source;
      channels.set(channel, (channels.get(channel) ?? 0) + 1);
      if (item.url) {
        const entry = exactUrls.get(item.url) ?? { url: item.url, titles: new Set(), sources: new Set(), count: 0 };
        entry.titles.add(item.title); entry.sources.add(channel); entry.count += 1; exactUrls.set(item.url, entry);
      }
      const latin = item.title.toLowerCase().match(/[a-z][a-z0-9+.#-]{2,}/g) ?? [];
      const cjkRuns = item.title.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
      const cjk = cjkRuns.flatMap((run) => run.length <= 4 ? [run] : [...Array(run.length - 1)].map((_, i) => run.slice(i, i + 2)));
      for (const word of [...latin, ...cjk]) if (!stop.has(word)) wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }
    const sortMap = (map, limit) => [...map.entries()].map(([name, count]) => ({ name, count })).sort((a,b) => b.count-a.count || a.name.localeCompare(b.name)).slice(0, limit);
    return {
      total: items.length,
      sources: sortMap(sources, 20),
      channels: sortMap(channels, 30),
      keywords: sortMap(wordCounts, 36),
      exactCoverage: [...exactUrls.values()].filter((item) => item.count > 1).map((item) => ({
        url: item.url, title: [...item.titles][0], count: item.count, sourceCount: item.sources.size,
      })).sort((a,b) => b.sourceCount-a.sourceCount || b.count-a.count).slice(0, 20),
      latest: items.slice(0, 30),
    };
  }

  addCandidates(batchId, hotspotIds) {
    const existingCount = this.db.prepare('SELECT COUNT(*) AS n FROM candidates WHERE batch_id=?').get(batchId).n;
    const insert = this.db.prepare('INSERT OR IGNORE INTO candidates (batch_id, hotspot_id, candidate_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    const now = new Date().toISOString();
    let offset = existingCount;
    for (const hotspotId of [...new Set(hotspotIds.map(Number))]) {
      if (!this.db.prepare('SELECT 1 FROM hotspots WHERE id=? AND batch_id=?').get(hotspotId, batchId)) continue;
      const existing=this.db.prepare('SELECT id FROM candidates WHERE batch_id=? AND candidate_id=?').get(batchId,`C${String(offset+1).padStart(3,'0')}`);
      if(existing)continue;
      offset += 1;
      insert.run(batchId, hotspotId, `C${String(offset).padStart(3,'0')}`, now, now);
    }
    return this.listCandidates(batchId);
  }

  createCompositeCandidate(batchId, hotspotIds, { title='', poolRole='综合选题' } = {}) {
    const now = new Date().toISOString();
    const existingCount = this.db.prepare('SELECT COUNT(*) AS n FROM candidates WHERE batch_id=?').get(batchId).n;
    const candidateId = `S${String(existingCount+1).padStart(3,'0')}`;
    const displayTitle = title || hotspotIds.map(id => {
      const h = this.db.prepare('SELECT title FROM hotspots WHERE id=? AND batch_id=?').get(id, batchId);
      return h ? h.title : null;
    }).filter(Boolean).join(' || ');
    const result = this.db.prepare(`INSERT OR IGNORE INTO candidates
      (batch_id, hotspot_id, candidate_id, pool_role, status, composite, hotspot_titles, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pooled', 1, ?, ?, ?)`)
      .run(batchId, null, candidateId, poolRole, displayTitle, now, now);
    const rowId = Number(result.lastInsertRowid);
    if (rowId && hotspotIds.length) {
      const linkInsert = this.db.prepare('INSERT OR IGNORE INTO candidate_hotspots (candidate_row_id, hotspot_id, created_at) VALUES (?, ?, ?)');
      for (const hId of [...new Set(hotspotIds.map(Number))]) {
        if (this.db.prepare('SELECT 1 FROM hotspots WHERE id=? AND batch_id=?').get(hId, batchId)) {
          linkInsert.run(rowId, hId, now);
        }
      }
    }
    return this.getCandidate(rowId);
  }

  listCandidates(batchId) {
    const all = this.db.prepare(`SELECT c.*, h.title AS hotspot_title, h.url, h.source, h.source_group, h.source_type, h.source_name, h.category, h.market_scope,
      e.next_action, e.brief_status, e.editor_question
      FROM candidates c LEFT JOIN hotspots h ON h.id=c.hotspot_id
      LEFT JOIN editorial_sessions e ON e.candidate_row_id=c.id
      WHERE c.batch_id=? ORDER BY COALESCE(c.f_score,-1) DESC, c.id ASC`).all(batchId);
    // For composite candidates, use first segment of hotspot_titles (before || ) as display title
    return all.map(c => {
      if (c.composite) {
        const hotspots = this.candidateHotspots(c.id);
        let fallback = c.hotspot_titles || '';
        if (hotspots[0]?.title) {
          c.hotspot_title = hotspots[0].title.substring(0, 40);
        } else if (fallback) {
          const sep = fallback.indexOf(' || ');
          c.hotspot_title = (sep > 0 ? fallback.substring(0, sep) : fallback).substring(0, 40);
        } else {
          c.hotspot_title = `综合 · ${c.candidate_id}`;
        }
        console.error('composite debug:', c.candidate_id, 'hotspots', hotspots.length, 'fallback exists:', !!c.hotspot_titles, 'final:', c.hotspot_title);
      }
      return c;
    });
  }

  getCandidate(id) {
    const candidate = this.db.prepare(`SELECT c.*, h.title AS hotspot_title, h.url, h.source, h.source_group, h.source_type, h.source_name, h.category, h.market_scope, h.published_at
      FROM candidates c LEFT JOIN hotspots h ON h.id=c.hotspot_id WHERE c.id=?`).get(id);
    if (!candidate) return null;
    // For composite candidates, use the first associated hotspot title or first segment of hotspot_titles as display name
    if (candidate.composite) {
      const hotspots = this.candidateHotspots(candidate.id);
      let fallback = candidate.hotspot_titles || '';
      if (hotspots[0]?.title) {
        candidate.hotspot_title = hotspots[0].title.substring(0, 40);
      } else if (fallback) {
        const sep = fallback.indexOf(' || ');
        candidate.hotspot_title = (sep > 0 ? fallback.substring(0, sep) : fallback).substring(0, 40);
      } else {
        candidate.hotspot_title = `综合 · ${candidate.candidate_id}`;
      }
    }
    candidate.editorial = this.getEditorial(id);
    candidate.messages = this.listEditorialMessages(id);
    // Load all source documents for composite candidates
    if (candidate.composite) {
      candidate.hotspots = this.candidateHotspots(candidate.id);
      candidate.source_documents = candidate.hotspots.map(h => ({
        hotspot_id: h.id,
        title: h.title,
        url: h.url,
        source: this.getHotspotSource(h.id)
      }));
      candidate.source_document = candidate.source_documents.find(s => s.source?.status === 'ok')?.source ?? null;
    } else {
      candidate.source_document = this.getHotspotSource(candidate.hotspot_id);
    }
    return candidate;
  }

  candidateHotspots(candidateRowId) {
    return this.db.prepare(`SELECT h.* FROM candidate_hotspots ch
      JOIN hotspots h ON h.id=ch.hotspot_id
      WHERE ch.candidate_row_id=? ORDER BY h.id`).all(candidateRowId);
  }

  getHotspotSource(hotspotId) {
    return this.db.prepare('SELECT * FROM hotspot_sources WHERE hotspot_id=?').get(hotspotId) ?? null;
  }

  saveHotspotSource(hotspotId, input) {
    this.db.prepare(`INSERT INTO hotspot_sources
      (hotspot_id,url,final_url,status,title,description,author,published_at,content,content_chars,fetched_at,error,cache_path,fetch_method)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(hotspot_id) DO UPDATE SET url=excluded.url,final_url=excluded.final_url,status=excluded.status,
        title=excluded.title,description=excluded.description,author=excluded.author,published_at=excluded.published_at,
        content=excluded.content,content_chars=excluded.content_chars,fetched_at=excluded.fetched_at,error=excluded.error,cache_path=excluded.cache_path,fetch_method=excluded.fetch_method`)
      .run(hotspotId,input.url||'',input.final_url||'',input.status||'error',input.title||'',input.description||'',input.author||'',
        input.published_at||'',input.content||'',Number(input.content_chars)||0,input.fetched_at||new Date().toISOString(),input.error||'',input.cache_path||'',input.fetch_method||'');
    return this.getHotspotSource(hotspotId);
  }

  deleteCandidate(id) {
    this.db.prepare('DELETE FROM candidates WHERE id=?').run(id);
  }

  updateCandidate(id, fields) {
    const allowed = ['pool_role','risk_level','angle','thesis','h_score','b_score','p_score','s_score','d_score','f_score','status'];
    const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
    if (!entries.length) return this.getCandidate(id);
    entries.push(['updated_at', new Date().toISOString()]);
    this.db.prepare(`UPDATE candidates SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=?`)
      .run(...entries.map(([key,value]) => key.endsWith('_score') && value === '' ? null : value), id);
    return this.getCandidate(id);
  }

  getEditorial(candidateId) {
    return this.db.prepare('SELECT * FROM editorial_sessions WHERE candidate_row_id=?').get(candidateId) ?? {
      candidate_row_id: Number(candidateId), editor_question: '', confirmed_facts: '', author_opinions: '',
      confirmed_experiences: '', rejected_angles: '', open_questions: '', forbidden_claims: '',
      next_action: 'DISCUSS', experience_required: 0, brief_status: 'DISCUSS',
    };
  }

  saveEditorial(candidateId, input) {
    const now = new Date().toISOString();
    const fields = ['editor_question','confirmed_facts','author_opinions','confirmed_experiences','rejected_angles','open_questions','forbidden_claims','next_action','experience_required','brief_status'];
    const values = fields.map((key) => input[key] ?? this.getEditorial(candidateId)[key]);
    this.db.prepare(`INSERT INTO editorial_sessions (candidate_row_id,${fields.join(',')},updated_at)
      VALUES (?,${fields.map(() => '?').join(',')},?)
      ON CONFLICT(candidate_row_id) DO UPDATE SET ${fields.map((key) => `${key}=excluded.${key}`).join(',')},updated_at=excluded.updated_at`)
      .run(candidateId, ...values, now);
    return this.getEditorial(candidateId);
  }

  addEditorialMessage(candidateId, role, content) {
    const result=this.db.prepare('INSERT INTO editorial_messages (candidate_row_id,role,content,created_at) VALUES (?,?,?,?)')
      .run(candidateId,role,String(content),new Date().toISOString());
    return this.db.prepare('SELECT * FROM editorial_messages WHERE id=?').get(Number(result.lastInsertRowid));
  }

  listEditorialMessages(candidateId) {
    return this.db.prepare('SELECT * FROM editorial_messages WHERE candidate_row_id=? ORDER BY id').all(candidateId);
  }

  saveDocument({ batchId, candidateId = null, kind, title = '', content = '', filePath = null, status = 'draft' }) {
    const now = new Date().toISOString();
    const visibleChars = content.replace(/^#.*$/gm,'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_`>#-]/g,'').replace(/\s/g,'').length;
    this.db.prepare(`INSERT INTO documents
      (batch_id,candidate_row_id,kind,title,content,file_path,visible_chars,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(batch_id,candidate_row_id,kind) DO UPDATE SET title=excluded.title,content=excluded.content,
      file_path=excluded.file_path,visible_chars=excluded.visible_chars,status=excluded.status,updated_at=excluded.updated_at`)
      .run(batchId,candidateId,kind,title,content,filePath,visibleChars,status,now,now);
    return this.getDocument(batchId, candidateId, kind);
  }

  getDocument(batchId, candidateId, kind) {
    const clause = candidateId == null ? 'candidate_row_id IS NULL' : 'candidate_row_id=?';
    const values = candidateId == null ? [batchId,kind] : [batchId,candidateId,kind];
    return this.db.prepare(`SELECT * FROM documents WHERE batch_id=? AND ${clause} AND kind=?`).get(...values) ?? null;
  }


  getDocumentContent(id) {
    return this.db.prepare("SELECT content, title, kind FROM documents WHERE id=?").get(id) ?? null;
  }

  listDocuments(batchId) {

    return this.db.prepare(`SELECT d.*, c.candidate_id, h.title AS hotspot_title FROM documents d
      LEFT JOIN candidates c ON c.id=d.candidate_row_id LEFT JOIN hotspots h ON h.id=c.hotspot_id
      WHERE d.batch_id=? ORDER BY d.updated_at DESC`).all(batchId);
  }

  upsertArtifact(artifact) {
    this.db.prepare(`INSERT INTO artifacts
      (batch_id, kind, name, file_path, size, modified_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET batch_id=excluded.batch_id, kind=excluded.kind,
        name=excluded.name, size=excluded.size, modified_at=excluded.modified_at, status=excluded.status`)
      .run(artifact.batchId ?? null, artifact.kind, artifact.name, artifact.path,
        artifact.size, artifact.modifiedAt, artifact.status ?? 'ready');
  }

  listArtifacts({ limit=300, batchId } = {}) {
    if (batchId) {
      return this.db.prepare(`SELECT a.*, b.batch_date, b.title AS batch_title
        FROM artifacts a LEFT JOIN batches b ON b.id=a.batch_id
        WHERE a.batch_id=? ORDER BY a.modified_at DESC LIMIT ?`).all(batchId, limit);
    }
    return this.db.prepare(`SELECT a.*, b.batch_date, b.title AS batch_title
      FROM artifacts a LEFT JOIN batches b ON b.id=a.batch_id
      ORDER BY a.modified_at DESC LIMIT ?`).all(limit);
  }

  getArtifact(id) {
    return this.db.prepare('SELECT * FROM artifacts WHERE id=?').get(id) ?? null;
  }

  recordModelCall(input) {
    const result = this.db.prepare(`INSERT INTO model_calls
      (provider,model,purpose,batch_id,candidate_row_id,estimated_input_tokens,prompt_tokens,
       completion_tokens,compressed,latency_ms,status,error,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.provider, input.model, input.purpose || 'unknown', input.batchId ?? null,
      input.candidateId ?? null, input.estimatedInputTokens ?? 0, input.promptTokens ?? null,
      input.completionTokens ?? null, input.compressed ? 1 : 0, input.latencyMs ?? 0,
      input.status, input.error ?? null, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  updateModelCall(id, fields) {
    const allowed = ['status','error'];
    const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
    if (!entries.length) return;
    this.db.prepare(`UPDATE model_calls SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=?`)
      .run(...entries.map(([,value]) => value), id);
  }

  listModelCalls(limit = 100) {
    return this.db.prepare(`SELECT * FROM model_calls ORDER BY id DESC LIMIT ?`).all(limit);
  }

  createAiRun({ id, batchId, type, provider }) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO ai_runs (id,batch_id,type,provider,status,progress,created_at,updated_at)
      VALUES (?,?,?,?, 'running','准备执行',?,?)`).run(id, batchId, type, provider, now, now);
    return this.getAiRun(id);
  }

  updateAiRun(id, fields) {
    const allowed = ['status','progress','result_json','error'];
    const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
    if (!entries.length) return this.getAiRun(id);
    entries.push(['updated_at', new Date().toISOString()]);
    this.db.prepare(`UPDATE ai_runs SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=?`)
      .run(...entries.map(([, value]) => value), id);
    return this.getAiRun(id);
  }

  getAiRun(id) {
    return this.db.prepare('SELECT * FROM ai_runs WHERE id=?').get(id) ?? null;
  }

  listAiRuns(batchId, limit = 30) {
    return this.db.prepare('SELECT * FROM ai_runs WHERE batch_id=? ORDER BY created_at DESC LIMIT ?').all(batchId, limit);
  }

  saveAnalyzedCandidates(batchId, records) {
    this.addCandidates(batchId, records.map((item) => item.hotspotId));
    for (const item of records) {
      const row = this.db.prepare('SELECT id FROM candidates WHERE batch_id=? AND hotspot_id=?').get(batchId, item.hotspotId);
      if (!row) continue;
      this.updateCandidate(row.id, {
        pool_role: item.poolRole,
        risk_level: item.riskLevel,
        angle: item.angle,
        thesis: item.thesis,
        h_score: item.h,
        b_score: item.b,
        p_score: item.p,
        s_score: item.s,
        d_score: item.d,
        f_score: item.f,
        status: 'analyzed',
      });
      const editorial=this.getEditorial(row.id);
      if(!editorial.editor_question && item.editorQuestion) this.saveEditorial(row.id,{...editorial,editor_question:item.editorQuestion,next_action:'DISCUSS',brief_status:'DISCUSS'});
    }
    return this.listCandidates(batchId);
  }

  listFinalArticles({ week, month, limit = 200 } = {}) {
    const where = ["d.kind='final'"];
    const values = [];
    if (week) {
      const year = parseInt(week.slice(0,4));
      const w = parseInt(week.slice(6));
      if (!isNaN(year) && !isNaN(w)) {
        const jan4 = new Date(year, 0, 4);
        const dow = jan4.getDay() || 7;
        const mondayW1 = new Date(jan4); mondayW1.setDate(jan4.getDate() - dow + 1);
        const monday = new Date(mondayW1); monday.setDate(mondayW1.getDate() + (w - 1) * 7);
        const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
        where.push("d.updated_at >= ? AND d.updated_at <= ?");
        values.push(monday.getFullYear()+'-'+String(monday.getMonth()+1).padStart(2,'0')+'-'+String(monday.getDate()).padStart(2,'0')+'T00:00:00.000Z', sunday.getFullYear()+'-'+String(sunday.getMonth()+1).padStart(2,'0')+'-'+String(sunday.getDate()).padStart(2,'0')+'T23:59:59.999Z');
      }
    }
    if (month) { where.push("strftime('%Y-%m', d.updated_at)=?"); values.push(month); }
    values.push(limit);
    return this.db.prepare(`SELECT d.id, d.batch_id, d.candidate_row_id, d.title, d.visible_chars,
      d.status, d.updated_at, d.created_at,
      c.candidate_id, c.pool_role, c.h_score, c.f_score,
      b.batch_date, b.title AS batch_title,
      COALESCE(h.title, d.title) AS hotspot_title,
      h.raw_json
      FROM documents d
      LEFT JOIN candidates c ON c.id=d.candidate_row_id
      LEFT JOIN batches b ON b.id=d.batch_id
      LEFT JOIN hotspots h ON h.id=c.hotspot_id
      WHERE ${where.join(' AND ')}
      ORDER BY d.updated_at DESC LIMIT ?`).all(...values);
  }

  findSimilarArticles(candidateId) {
    const candidate = this.getCandidate(candidateId);
    if (!candidate) return [];
    // 提取当前候选的事件 key 和关键词
    const keys = new Set();
    if (candidate.composite) {
      const hotspots = this.candidateHotspots(candidate.id);
      for (const h of hotspots) {
        try { const t = JSON.parse(h.raw_json || '{}'); if (t.aiTags?.eventKey) keys.add(t.aiTags.eventKey); } catch {}
      }
    } else if (candidate.hotspot_id) {
      const hotspot = this.db.prepare('SELECT raw_json FROM hotspots WHERE id=?').get(candidate.hotspot_id);
      if (hotspot) { try { const t = JSON.parse(hotspot.raw_json || '{}'); if (t.aiTags?.eventKey) keys.add(t.aiTags.eventKey); } catch {} }
    }
    // 标题关键词（去掉常见虚词）
    const stopWords = new Set(['的', '了', '在', '是', '有', '和', '与', '及', '或', '被', '把', '从', '对', '到', '让', '用', '为', '以', '于', '之',
      'the', 'a', 'an', 'of', 'in', 'on', 'to', 'for', 'with', 'by', 'and', 'or', 'not', 'at', 'from', 'that', 'this', 'its', 'their']);
    const titleWords = new Set(candidate.hotspot_title?.toLowerCase().split(/[\s,，。、；：·｜|()（）]+/).filter(w => w.length > 1 && !stopWords.has(w)) || []);
    if (!keys.size && !titleWords.size) return [];
    // 查找所有已完结文章（排除当前候选自身）
    const finals = this.db.prepare(`SELECT d.id, d.batch_id, d.candidate_row_id, d.title, d.visible_chars,
      d.updated_at, c.candidate_id, c.pool_role,
      b.batch_date, b.title AS batch_title,
      h.raw_json, h.title AS hotspot_title
      FROM documents d
      LEFT JOIN candidates c ON c.id=d.candidate_row_id
      LEFT JOIN batches b ON b.id=d.batch_id
      LEFT JOIN hotspots h ON h.id=c.hotspot_id
      WHERE d.kind='final' AND d.candidate_row_id IS NOT NULL AND d.candidate_row_id != ?
      ORDER BY d.updated_at DESC LIMIT 200`).all(candidateId);
    const results = [];
    for (const f of finals) {
      let score = 0; let matchedKey = ''; let matchedWords = [];
      // 事件 key 匹配（强信号）
      if (keys.size && f.raw_json) {
        try {
          const t = JSON.parse(f.raw_json || '{}');
          if (t.aiTags?.eventKey && keys.has(t.aiTags.eventKey)) { score += 80; matchedKey = t.aiTags.eventKey; }
        } catch {}
      }
      // 标题关键词重叠（弱信号）
      if (titleWords.size) {
        const fTitle = (f.hotspot_title || f.title || '').toLowerCase();
        for (const w of titleWords) { if (fTitle.includes(w)) { score += 15; matchedWords.push(w); } }
      }
      if (score >= 15) {
        results.push({ id: f.id, title: f.title || f.hotspot_title || '', batchDate: f.batch_date, batchTitle: f.batch_title,
          updatedAt: f.updated_at, candidateId: f.candidate_id, poolRole: f.pool_role,
          score, matchedKey, matchedWords: matchedWords.slice(0, 5) });
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  articleStats() {
    // 统计已完结文章：kind='final' 的 documents 或 '文章终稿' 的 artifacts
    const byPeriod = this.db.prepare(`
      SELECT strftime('%Y-%W', d.updated_at) AS week,
        strftime('%Y-%m', d.updated_at) AS month,
        COUNT(*) AS count
      FROM documents d WHERE d.kind='final'
      GROUP BY week ORDER BY week DESC LIMIT 12`).all();
    const totalFinal = this.db.prepare("SELECT COUNT(*) AS n FROM documents WHERE kind='final'").get().n;
    const thisMonth = this.db.prepare(`
      SELECT COUNT(*) AS n FROM documents
      WHERE kind='final' AND strftime('%Y-%m', updated_at)=strftime('%Y-%m','now')`).get().n;
    const thisWeek = this.db.prepare(`
      SELECT COUNT(*) AS n FROM documents
      WHERE kind='final' AND strftime('%Y-%W', updated_at)=strftime('%Y-%W','now')`).get().n;
    // 按分类统计：从 candidates 表的 pool_role 推断
    const byRole = this.db.prepare(`
      SELECT c.pool_role, COUNT(*) AS count
      FROM documents d JOIN candidates c ON c.id=d.candidate_row_id
      WHERE d.kind='final' AND c.pool_role!=''
      GROUP BY c.pool_role ORDER BY count DESC`).all();
    return { totalFinal, thisMonth, thisWeek, byPeriod, byRole };
  }

  listLogs({ limit = 100, logType } = {}) {
    const queries = [];
    if (!logType || logType === 'ai') {
      queries.push(`SELECT 'ai' AS log_type, CAST(id AS TEXT) AS id, batch_id, type AS subtype, provider, status, COALESCE(error,progress) AS message, created_at AS ts FROM ai_runs`);
    }
    if (!logType || logType === 'source') {
      queries.push(`SELECT 'source' AS log_type, CAST(id AS TEXT) AS id, batch_id, source AS subtype, source AS provider, status, COALESCE(error,'') AS message, ended_at AS ts FROM source_runs`);
    }
    if (!logType || logType === 'model') {
      queries.push(`SELECT 'model' AS log_type, CAST(id AS TEXT) AS id, COALESCE(batch_id,'') AS batch_id, purpose AS subtype, provider, status, COALESCE(error,'') AS message, created_at AS ts FROM model_calls`);
    }
    if (!queries.length) return [];
    const union = queries.join(' UNION ALL ');
    return this.db.prepare(`${union} ORDER BY ts DESC LIMIT ?`).all(limit);
  }

  overview() {
    return {
      batches: this.db.prepare('SELECT COUNT(*) AS n FROM batches').get().n,
      hotspots: this.db.prepare('SELECT COUNT(*) AS n FROM hotspots').get().n,
      artifacts: this.db.prepare('SELECT COUNT(*) AS n FROM artifacts').get().n,
      latest: this.listBatches(1)[0] ?? null,
      sourceHealth: this.db.prepare(`SELECT source, status, item_count, error, ended_at
        FROM source_runs WHERE id IN (SELECT MAX(id) FROM source_runs GROUP BY source)
        ORDER BY source`).all(),
    };
  }

  close() {
    this.db.close();
  }
}