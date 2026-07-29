import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { markdownVisibleChars } from '../domain/markdown-visible-chars.mjs';

function publishedTimestamp(item) {
  const value = Date.parse(item.published_at || item.created_at || '');
  return Number.isFinite(value) ? value : 0;
}

function newestFirst(a,b) {
  return publishedTimestamp(b)-publishedTimestamp(a) || Number(b.score ?? -1)-Number(a.score ?? -1) || b.id-a.id;
}

function plainSummary(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function socialCandidatePresentation(rawJson, factSheet, socialScore) {
  let raw={};try{raw=JSON.parse(rawJson||'{}');}catch{}
  let facts={};try{facts=JSON.parse(factSheet?.data_json||'{}');}catch{}
  const eventProfile=socialScore?.score?.scoreProfile==='event';
  const description=plainSummary(facts.description||raw.description||raw.summary||raw.notes);
  const reasons=[];const channels=raw.discoveryChannels||[];const score=socialScore?.score||{};
  if(eventProfile){
    if(Number(score.informationDensity)>=14)reasons.push('信息密度高');
    if(Number(score.visualNarrative)>=14)reasons.push('适合视觉叙事');
    if(Number(score.conflictEmotion)>=10)reasons.push('冲突明确');
    if(Number(score.evidenceCompleteness)>=10)reasons.push('证据较完整');
    return {repository_description:description,social_selection_reason:reasons.slice(0,4).join(' · ')||'突发事件图文'};
  }
  if(channels.includes('trending')||raw.sourceType==='trending')reasons.push('GitHub Trending');
  if(channels.includes('search'))reasons.push('近期增长发现');
  if(channels.includes('mentioned'))reasons.push('其他热点提及');
  const stars=Number(facts.stars?.value??raw.stars);
  if(Number.isFinite(stars)&&stars>0)reasons.push(`${stars.toLocaleString('en-US')} Stars`);
  const dimensions=[['工具定位清晰',score.toolClarity],['使用场景明确',score.scenarioValue],['适合演示',score.demonstrability],['适合拆页',score.visualPotential],['具备收藏价值',score.saveSearchValue]]
    .filter(([,value])=>Number(value)>=12).sort((a,b)=>Number(b[1])-Number(a[1]));
  if(dimensions[0])reasons.push(dimensions[0][0]);
  return {repository_description:description,social_selection_reason:reasons.slice(0,4).join(' · ')};
}

function repositoryKey(url,rawJson='') {
  let raw={};try{raw=JSON.parse(rawJson||'{}');}catch{}
  const declared=String(raw.repository||'').trim().replace(/\.git$/i,'').toLowerCase();
  if(declared)return declared;
  try{const parsed=new URL(String(url||''));if(parsed.hostname.toLowerCase()!=='github.com')return '';const parts=parsed.pathname.split('/').filter(Boolean).slice(0,2);return parts.length===2?parts.join('/').replace(/\.git$/i,'').toLowerCase():'';}catch{return '';}
}

export class Store {
  constructor(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  migrate() {
    const candidateTracksExisted = Boolean(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='candidate_tracks'").get());
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS batches (
        id TEXT PRIMARY KEY,
        batch_date TEXT NOT NULL,
        title TEXT NOT NULL,
        batch_type TEXT NOT NULL DEFAULT 'regular',
        requested_tracks TEXT NOT NULL DEFAULT '["article"]',
        status TEXT NOT NULL DEFAULT 'draft',
        lifecycle_status TEXT NOT NULL DEFAULT 'active',
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
        research_eligible INTEGER NOT NULL DEFAULT 1,
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
      CREATE TABLE IF NOT EXISTS hotspot_materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hotspot_id INTEGER NOT NULL,
        url TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        final_url TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '',
        published_at TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        content_chars INTEGER NOT NULL DEFAULT 0,
        fetched_at TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        fetch_method TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(hotspot_id, url),
        FOREIGN KEY(hotspot_id) REFERENCES hotspots(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS breaking_analyses (
        batch_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        analysis_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS candidate_tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_row_id INTEGER NOT NULL,
        track TEXT NOT NULL CHECK(track IN ('article','social_cards')),
        status TEXT NOT NULL DEFAULT 'pooled',
        score REAL,
        pool_role TEXT NOT NULL DEFAULT '',
        output_mode TEXT NOT NULL DEFAULT '',
        selected_at TEXT NOT NULL,
        locked_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(candidate_row_id, track),
        FOREIGN KEY(candidate_row_id) REFERENCES candidates(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS repository_fact_sheets (
        candidate_row_id INTEGER PRIMARY KEY,
        repository TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        data_json TEXT NOT NULL DEFAULT '{}',
        checked_at TEXT,
        error TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        FOREIGN KEY(candidate_row_id) REFERENCES candidates(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS candidate_social_scores (
        candidate_row_id INTEGER PRIMARY KEY,
        score_json TEXT NOT NULL DEFAULT '{}',
        final_score REAL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(candidate_row_id) REFERENCES candidates(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS card_editorial_sessions (
        candidate_row_id INTEGER PRIMARY KEY,
        target_reader TEXT NOT NULL DEFAULT '',
        pain_point TEXT NOT NULL DEFAULT '',
        tool_positioning TEXT NOT NULL DEFAULT '',
        must_highlight TEXT NOT NULL DEFAULT '',
        must_disclose TEXT NOT NULL DEFAULT '',
        getting_started TEXT NOT NULL DEFAULT '',
        forbidden_claims TEXT NOT NULL DEFAULT '',
        output_mode TEXT NOT NULL DEFAULT 'wechat-tool-cards',
        visual_style TEXT NOT NULL DEFAULT 'ice-blue',
        composition_mode TEXT NOT NULL DEFAULT 'smart',
        layout_style TEXT NOT NULL DEFAULT 'auto',
        recommended_pages INTEGER NOT NULL DEFAULT 6,
        card_plan_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'DISCUSS',
        updated_at TEXT NOT NULL,
        FOREIGN KEY(candidate_row_id) REFERENCES candidates(id) ON DELETE CASCADE
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
      CREATE TABLE IF NOT EXISTS document_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        visible_chars INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft',
        reason TEXT NOT NULL DEFAULT 'save',
        created_at TEXT NOT NULL,
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_document_revisions_document
        ON document_revisions(document_id, id DESC);
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
        generation_snapshot_id INTEGER,
        created_at TEXT NOT NULL,
        FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE SET NULL,
        FOREIGN KEY(candidate_row_id) REFERENCES candidates(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS generation_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT,
        candidate_row_id INTEGER,
        purpose TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE SET NULL,
        FOREIGN KEY(candidate_row_id) REFERENCES candidates(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS skill_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        config_json TEXT NOT NULL,
        config_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        published_at TEXT,
        UNIQUE(skill_id, version)
      );
      CREATE TABLE IF NOT EXISTS tool_executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT,
        candidate_row_id INTEGER,
        generation_snapshot_id INTEGER,
        skill_id TEXT,
        capability TEXT NOT NULL,
        plugin TEXT,
        plugin_version TEXT,
        status TEXT NOT NULL,
        error_code TEXT,
        input_keys_json TEXT NOT NULL DEFAULT '[]',
        authorized_external_write INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE SET NULL,
        FOREIGN KEY(candidate_row_id) REFERENCES candidates(id) ON DELETE SET NULL,
        FOREIGN KEY(generation_snapshot_id) REFERENCES generation_snapshots(id) ON DELETE SET NULL
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
      CREATE TABLE IF NOT EXISTS custom_article_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        candidate_row_id INTEGER,
        latest_job_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(batch_id, request_id),
        UNIQUE(batch_id, fingerprint),
        FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE,
        FOREIGN KEY(candidate_row_id) REFERENCES candidates(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS visual_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        candidate_row_id INTEGER,
        visual_type TEXT NOT NULL,
        action TEXT NOT NULL,
        heading TEXT NOT NULL DEFAULT '',
        purpose TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE,
        FOREIGN KEY(candidate_row_id) REFERENCES candidates(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_hotspots_batch ON hotspots(batch_id);
      CREATE INDEX IF NOT EXISTS idx_hotspots_title ON hotspots(title);
      CREATE INDEX IF NOT EXISTS idx_hotspot_materials_hotspot ON hotspot_materials(hotspot_id,position);
      CREATE INDEX IF NOT EXISTS idx_artifacts_batch ON artifacts(batch_id);
      CREATE INDEX IF NOT EXISTS idx_candidates_batch ON candidates(batch_id);
      CREATE INDEX IF NOT EXISTS idx_candidate_tracks_track ON candidate_tracks(track,candidate_row_id);
      CREATE INDEX IF NOT EXISTS idx_editorial_messages_candidate ON editorial_messages(candidate_row_id,id);
      CREATE INDEX IF NOT EXISTS idx_documents_batch ON documents(batch_id);
      CREATE INDEX IF NOT EXISTS idx_model_calls_created ON model_calls(created_at);
      CREATE INDEX IF NOT EXISTS idx_generation_snapshots_batch ON generation_snapshots(batch_id, candidate_row_id, id);
      CREATE INDEX IF NOT EXISTS idx_tool_executions_task ON tool_executions(batch_id, candidate_row_id, id);
      CREATE INDEX IF NOT EXISTS idx_tool_executions_capability ON tool_executions(capability, id);
      CREATE INDEX IF NOT EXISTS idx_ai_runs_batch ON ai_runs(batch_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_custom_article_candidate ON custom_article_requests(candidate_row_id);
      CREATE INDEX IF NOT EXISTS idx_subscription_runs_batch ON subscription_runs(batch_id,id);
      CREATE INDEX IF NOT EXISTS idx_subscription_runs_source ON subscription_runs(source_key,id);
      CREATE INDEX IF NOT EXISTS idx_visual_decisions_type ON visual_decisions(visual_type,action);
    `);
    const batchColumns=new Set(this.db.prepare('PRAGMA table_info(batches)').all().map((column)=>column.name));
    if(!batchColumns.has('batch_type'))this.db.exec("ALTER TABLE batches ADD COLUMN batch_type TEXT NOT NULL DEFAULT 'regular'");
    const modelCallColumns=new Set(this.db.prepare('PRAGMA table_info(model_calls)').all().map((column)=>column.name));
    if(!modelCallColumns.has('generation_snapshot_id'))this.db.exec('ALTER TABLE model_calls ADD COLUMN generation_snapshot_id INTEGER');
    if(!batchColumns.has('requested_tracks'))this.db.exec("ALTER TABLE batches ADD COLUMN requested_tracks TEXT NOT NULL DEFAULT '[\"article\"]'");
    if(!batchColumns.has('max_age_hours'))this.db.exec("ALTER TABLE batches ADD COLUMN max_age_hours INTEGER");
    if(!batchColumns.has('lifecycle_status'))this.db.exec("ALTER TABLE batches ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active'");
    this.db.exec("UPDATE batches SET lifecycle_status='archived',status='review' WHERE status='archived'");
    const materialColumns=new Set(this.db.prepare('PRAGMA table_info(hotspot_materials)').all().map((column)=>column.name));
    for(const [name,definition] of Object.entries({
      status:"TEXT NOT NULL DEFAULT 'pending'",final_url:"TEXT NOT NULL DEFAULT ''",title:"TEXT NOT NULL DEFAULT ''",
      author:"TEXT NOT NULL DEFAULT ''",published_at:"TEXT NOT NULL DEFAULT ''",description:"TEXT NOT NULL DEFAULT ''",
      content:"TEXT NOT NULL DEFAULT ''",content_chars:'INTEGER NOT NULL DEFAULT 0',fetched_at:"TEXT NOT NULL DEFAULT ''",
      error:"TEXT NOT NULL DEFAULT ''",fetch_method:"TEXT NOT NULL DEFAULT ''",
    }))if(!materialColumns.has(name))this.db.exec(`ALTER TABLE hotspot_materials ADD COLUMN ${name} ${definition}`);
    const sourceColumns=new Set(this.db.prepare('PRAGMA table_info(hotspot_sources)').all().map((column)=>column.name));
    if(!sourceColumns.has('fetch_method'))this.db.exec("ALTER TABLE hotspot_sources ADD COLUMN fetch_method TEXT NOT NULL DEFAULT ''");
    if(!sourceColumns.has('quality_json'))this.db.exec("ALTER TABLE hotspot_sources ADD COLUMN quality_json TEXT NOT NULL DEFAULT ''");
    if(!sourceColumns.has('evidence_level'))this.db.exec("ALTER TABLE hotspot_sources ADD COLUMN evidence_level TEXT NOT NULL DEFAULT ''");
    const hotspotColumns=new Set(this.db.prepare('PRAGMA table_info(hotspots)').all().map((column)=>column.name));
    if(!hotspotColumns.has('source_group'))this.db.exec("ALTER TABLE hotspots ADD COLUMN source_group TEXT NOT NULL DEFAULT ''");
    if(!hotspotColumns.has('source_type'))this.db.exec("ALTER TABLE hotspots ADD COLUMN source_type TEXT NOT NULL DEFAULT ''");
    if(!hotspotColumns.has('source_name'))this.db.exec("ALTER TABLE hotspots ADD COLUMN source_name TEXT NOT NULL DEFAULT ''");
    if(!hotspotColumns.has('research_eligible'))this.db.exec("ALTER TABLE hotspots ADD COLUMN research_eligible INTEGER NOT NULL DEFAULT 1");
    this.db.exec(`UPDATE hotspots SET research_eligible=0 WHERE id IN (
      SELECT c.hotspot_id FROM candidates c
      JOIN candidate_tracks ct ON ct.candidate_row_id=c.id
      WHERE ct.output_mode IN ('wechat-experience','wechat-tutorial','wechat-custom-cards','xiaohongshu-custom-cards')
    )`);
    this.db.exec(`UPDATE hotspots SET research_eligible=0
      WHERE source_type='manual'
      AND (raw_json LIKE '%"notes":"自主写作（%' OR raw_json LIKE '%"notes":"自定义图文（%')`);
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
    if(!candidateCols.has('dimension'))this.db.exec("ALTER TABLE candidates ADD COLUMN dimension TEXT NOT NULL DEFAULT 'event'");
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
    if (!candidateTracksExisted) {
      const trackNow = new Date().toISOString();
      this.db.prepare(`INSERT OR IGNORE INTO candidate_tracks
        (candidate_row_id,track,status,score,pool_role,output_mode,selected_at,locked_at,updated_at)
        SELECT id,'article',status,f_score,pool_role,'',created_at,
          CASE WHEN status IN ('locked','drafting','review','preview','published') THEN updated_at ELSE NULL END,?
        FROM candidates`).run(trackNow);
    }
    const cardEditorialColumns=new Set(this.db.prepare('PRAGMA table_info(card_editorial_sessions)').all().map((column)=>column.name));
    if(!cardEditorialColumns.has('card_plan_json'))this.db.exec("ALTER TABLE card_editorial_sessions ADD COLUMN card_plan_json TEXT NOT NULL DEFAULT '[]'");
    if(!cardEditorialColumns.has('layout_style'))this.db.exec("ALTER TABLE card_editorial_sessions ADD COLUMN layout_style TEXT NOT NULL DEFAULT 'auto'");
    if(!cardEditorialColumns.has('composition_mode'))this.db.exec("ALTER TABLE card_editorial_sessions ADD COLUMN composition_mode TEXT NOT NULL DEFAULT 'template'");
    const artifactColumns=new Set(this.db.prepare('PRAGMA table_info(artifacts)').all().map((column)=>column.name));
    if(!artifactColumns.has('candidate_row_id'))this.db.exec('ALTER TABLE artifacts ADD COLUMN candidate_row_id INTEGER REFERENCES candidates(id) ON DELETE SET NULL');
    if(!artifactColumns.has('track'))this.db.exec("ALTER TABLE artifacts ADD COLUMN track TEXT NOT NULL DEFAULT ''");
    this.db.exec(`UPDATE artifacts SET candidate_row_id=(SELECT c.id FROM candidates c JOIN batches b ON b.id=c.batch_id
      WHERE (lower(replace(artifacts.file_path,'\\','/')) LIKE '%/social-cards/'||b.batch_date||'-'||lower(c.candidate_id)||'/%'
        OR lower(replace(artifacts.file_path,'\\','/')) LIKE '%/social-cards/'||lower(b.id)||'-'||lower(c.candidate_id)||'/%') LIMIT 1),track='social_cards'
      WHERE candidate_row_id IS NULL AND lower(replace(file_path,'\\','/')) LIKE '%/social-cards/%'`);
    // 图文池已改用独立 Social Fit 预选，清理旧文章研判产生的自动图文轨道；手动加入与正式图文预选不受影响。
    this.db.prepare("DELETE FROM candidate_tracks WHERE track='social_cards' AND pool_role='AI 图文推荐'").run();
  }

  createBatch({ date, title, note = '', batchType = 'regular', requestedTracks = ['article'] }) {
    const now = new Date().toISOString();
    const id = `${date}-${Math.random().toString(36).slice(2, 8)}`;
    this.db.prepare(`INSERT INTO batches
      (id, batch_date, title, batch_type, requested_tracks, status, stage, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'draft', 'collect', ?, ?, ?)`)
      .run(id, date, title, batchType, JSON.stringify(requestedTracks), note, now, now);
    return this.getBatch(id);
  }

  createBreakingBatch({ date, title, note = '', urls = [], requestedTracks = ['article'] }) {
    const safeTitle=String(title||'').trim();
    if(!safeTitle)throw new Error('请输入突发事件标题');
    const safeUrls=[...new Set((urls||[]).map((value)=>String(value||'').trim()).filter(Boolean))];
    if(!safeUrls.length)throw new Error('请至少提供一个素材链接');
    for(const value of safeUrls){let parsed;try{parsed=new URL(value);}catch{throw new Error(`素材链接无效：${value}`);}if(!['http:','https:'].includes(parsed.protocol))throw new Error(`素材链接仅支持 HTTP/HTTPS：${value}`);}
    const tracks=[...new Set((requestedTracks||[]).filter((value)=>['article','social_cards'].includes(value)))];
    if(!tracks.length)throw new Error('请至少选择文章或图文方向');
    const batch=this.createBatch({date,title:`突发专题｜${safeTitle}`,note,batchType:'breaking',requestedTracks:tracks});
    const hotspot=this.addManualHotspot(batch.id,{title:safeTitle,url:safeUrls[0],notes:note,materialUrls:safeUrls});
    return {...this.getBatch(batch.id),intake_hotspot_id:hotspot.id};
  }

  listBatches(limit = 60) {
    return this.db.prepare(`
      SELECT b.*,
        (SELECT COUNT(*) FROM hotspots h WHERE h.batch_id=b.id) AS hotspot_count,
        (SELECT COUNT(*) FROM artifacts a WHERE a.batch_id=b.id) AS artifact_count
      FROM batches b ORDER BY batch_date DESC, created_at DESC LIMIT ?
    `).all(limit);
  }

  latestActiveBatch() {
    return this.db.prepare(`SELECT b.*,
      (SELECT COUNT(*) FROM hotspots h WHERE h.batch_id=b.id) AS hotspot_count,
      (SELECT COUNT(*) FROM artifacts a WHERE a.batch_id=b.id) AS artifact_count
      FROM batches b WHERE b.lifecycle_status='active'
      ORDER BY batch_date DESC, created_at DESC LIMIT 1`).get() ?? null;
  }

  getBatch(id) {
    const batch = this.db.prepare('SELECT * FROM batches WHERE id=?').get(id);
    if (!batch) return null;
    try { batch.requested_tracks_list=JSON.parse(batch.requested_tracks||'["article"]'); } catch { batch.requested_tracks_list=['article']; }
    batch.sources = this.db.prepare(
      'SELECT * FROM source_runs WHERE batch_id=? ORDER BY id DESC'
    ).all(id);
    batch.subscription_runs = this.db.prepare(
      'SELECT * FROM subscription_runs WHERE batch_id=? ORDER BY id DESC'
    ).all(id);
    batch.hotspots = this.db.prepare('SELECT * FROM hotspots WHERE batch_id=?').all(id).sort(newestFirst)
      .map((item)=>({...item,materials:this.listHotspotMaterials(item.id)}));
    batch.artifacts = this.db.prepare(
      'SELECT * FROM artifacts WHERE batch_id=? ORDER BY modified_at DESC'
    ).all(id);
    batch.ai_runs = this.listAiRuns(id, 20);
    batch.ai_status = {
      tagged: batch.hotspots.filter((item) => {
        try { return Boolean(JSON.parse(item.raw_json).aiTags?.eventKey); } catch { return false; }
      }).length,
      total: batch.hotspots.length,
      // auto 任务包含完整的事件研判阶段，步骤条应与手动 research 使用同一完成状态。
      // 注意：不能从截断的 ai_runs 列表里找——排版等重试会把研判记录挤出窗口，导致步骤条永远不到 done。
      latestResearch: this.db.prepare("SELECT * FROM ai_runs WHERE batch_id=? AND type IN ('research','auto') ORDER BY created_at DESC LIMIT 1").get(id) ?? null,
    };
    return batch;
  }

  updateBatch(id, fields) {
    const allowed = ['title', 'status', 'lifecycle_status', 'stage', 'note', 'max_age_hours'];
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

  getSourceRun(id) {
    return this.db.prepare('SELECT * FROM source_runs WHERE id=?').get(Number(id)) ?? null;
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

  listSubscriptionHealthHistory({ days = 14, limit = 500 } = {}) {
    const safeDays = Math.max(1, Math.min(90, Number(days) || 14));
    const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 500));
    return this.db.prepare(`SELECT * FROM subscription_runs
      WHERE ended_at >= datetime('now', ?)
      ORDER BY ended_at DESC, id DESC LIMIT ?`).all(`-${safeDays} days`, safeLimit);
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
      (batch_id, source, source_group, source_type, source_name, external_id, title, url, category, market_scope, score, published_at, raw_json, research_eligible, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(batch_id, source, title) DO UPDATE SET
        url=excluded.url, published_at=excluded.published_at, source_group=excluded.source_group,
        source_type=excluded.source_type,source_name=excluded.source_name,raw_json=excluded.raw_json,
        research_eligible=excluded.research_eligible`);
    const now = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      for (const item of items) {
        const sourceKey=item.sourceKey||sourceGroup; const sourceType=item.sourceType||sourceGroup; const sourceName=item.sourceName||sourceKey;
        insert.run(batchId, sourceKey, item.sourceGroup||sourceGroup, sourceType, sourceName, item.id ?? null, item.title, item.url ?? null,
          item.category ?? '待分类', item.marketScope ?? '待标注', item.score ?? null,
          item.publishedAt ?? null, JSON.stringify(item), item.researchEligible === false ? 0 : 1, now);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  addManualHotspot(batchId, { title, url, category, notes, materialUrls = [], researchEligible = true }) {
    const safeTitle = String(title || '').trim();
    if (!safeTitle) throw new Error('标题不能为空');
    const key = `manual:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
    const item = {
      sourceKey: key, sourceType: 'manual', sourceName: '手动添加',
      id: key, title: safeTitle, url: url?.trim() || null,
      category: category || '待分类', marketScope: '手动补入',
      publishedAt: new Date().toISOString(), notes: notes?.trim() || '',
      researchEligible,
      materialUrls:[...new Set([url,...materialUrls].map((value)=>String(value||'').trim()).filter(Boolean))],
    };
    this.addHotspots(batchId, 'manual', [item]);
    const hotspot=this.db.prepare('SELECT * FROM hotspots WHERE batch_id=? AND source=?').get(batchId,key)??null;
    if(hotspot){
      const insert=this.db.prepare('INSERT OR IGNORE INTO hotspot_materials (hotspot_id,url,position,created_at) VALUES (?,?,?,?)');
      item.materialUrls.forEach((materialUrl,index)=>insert.run(hotspot.id,materialUrl,index,new Date().toISOString()));
    }
    return hotspot;
  }

  listHotspotMaterials(hotspotId) {
    return this.db.prepare('SELECT * FROM hotspot_materials WHERE hotspot_id=? ORDER BY position,id').all(Number(hotspotId));
  }

  addBreakingMaterials(batchId, urls) {
    const batch=this.getBatch(batchId);if(!batch||batch.batch_type!=='breaking')throw new Error('突发专题不存在');
    const hotspot=batch.hotspots[0];if(!hotspot)throw new Error('突发专题没有事件');
    const safe=[...new Set((urls||[]).map((value)=>String(value||'').trim()).filter(Boolean))];
    if(!safe.length)throw new Error('请至少提供一个素材链接');
    const insert=this.db.prepare('INSERT OR IGNORE INTO hotspot_materials (hotspot_id,url,position,created_at) VALUES (?,?,?,?)');
    let position=this.db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM hotspot_materials WHERE hotspot_id=?').get(hotspot.id).n;
    for(const value of safe){let parsed;try{parsed=new URL(value);}catch{throw new Error(`素材链接无效：${value}`);}if(!['http:','https:'].includes(parsed.protocol))throw new Error(`素材链接仅支持 HTTP/HTTPS：${value}`);const result=insert.run(hotspot.id,value,position,new Date().toISOString());if(result.changes)position+=1;}
    return this.listHotspotMaterials(hotspot.id);
  }

  saveHotspotMaterialResult(materialId, input) {
    const allowed=['status','final_url','title','author','published_at','description','content','content_chars','fetched_at','error','fetch_method'];
    const entries=Object.entries(input||{}).filter(([key])=>allowed.includes(key));
    if(entries.length)this.db.prepare(`UPDATE hotspot_materials SET ${entries.map(([key])=>`${key}=?`).join(',')} WHERE id=?`)
      .run(...entries.map(([,value])=>value??''),Number(materialId));
    return this.db.prepare('SELECT * FROM hotspot_materials WHERE id=?').get(Number(materialId))??null;
  }

  saveBreakingAnalysis(batchId, analysis, status='ready') {
    const now=new Date().toISOString();
    this.db.prepare(`INSERT INTO breaking_analyses (batch_id,status,analysis_json,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(batch_id) DO UPDATE SET status=excluded.status,analysis_json=excluded.analysis_json,updated_at=excluded.updated_at`)
      .run(batchId,status,JSON.stringify(analysis||{}),now);
    return this.getBreakingAnalysis(batchId);
  }

  getBreakingAnalysis(batchId) {
    const row=this.db.prepare('SELECT * FROM breaking_analyses WHERE batch_id=?').get(batchId);
    if(!row)return null;
    try{return {...row,analysis:JSON.parse(row.analysis_json||'{}')};}catch{return {...row,analysis:{}};}
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
      eventParts: tags.eventParts ?? raw.aiTags?.eventParts ?? null,
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

  addCandidates(batchId, hotspotIds, { tracks = ['article'] } = {}) {
    const existingCount = this.db.prepare('SELECT COUNT(*) AS n FROM candidates WHERE batch_id=?').get(batchId).n;
    const insert = this.db.prepare('INSERT OR IGNORE INTO candidates (batch_id, hotspot_id, candidate_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    const now = new Date().toISOString();
    let offset = existingCount;
    for (const hotspotId of [...new Set(hotspotIds.map(Number))]) {
      if (!this.db.prepare('SELECT 1 FROM hotspots WHERE id=? AND batch_id=?').get(hotspotId, batchId)) continue;
      const linked = this.db.prepare('SELECT id FROM candidates WHERE batch_id=? AND hotspot_id=? ORDER BY id LIMIT 1').get(batchId, hotspotId);
      if (linked) {
        this.addCandidateTracks(linked.id, tracks);
        continue;
      }
      const existing=this.db.prepare('SELECT id FROM candidates WHERE batch_id=? AND candidate_id=?').get(batchId,`C${String(offset+1).padStart(3,'0')}`);
      if(existing)continue;
      offset += 1;
      insert.run(batchId, hotspotId, `C${String(offset).padStart(3,'0')}`, now, now);
      const created = this.db.prepare('SELECT id FROM candidates WHERE batch_id=? AND candidate_id=?').get(batchId, `C${String(offset).padStart(3,'0')}`);
      const hotspot = this.db.prepare('SELECT title, category FROM hotspots WHERE id=? AND batch_id=?').get(hotspotId, batchId);
      if (created && hotspot) {
        // 手动入池也必须具备可审计的初始评分与写作元数据，后续可由研判任务覆盖。
        this.db.prepare(`UPDATE candidates SET pool_role='人工补选', angle=?, thesis=?, h_score=60, b_score=60, p_score=60, s_score=0, d_score=60, f_score=60, status='scored', updated_at=? WHERE id=?`)
          .run(hotspot.title, hotspot.title, now, created.id);
        this.addCandidateTracks(created.id, tracks);
      }
    }
    return this.listCandidates(batchId);
  }

  createCompositeCandidate(batchId, hotspotIds, { title='', poolRole='综合选题', tracks=['article'], dimension='event' } = {}) {
    const now = new Date().toISOString();
    const normalizedIds = [...new Set(hotspotIds.map(Number))].sort((a,b) => a-b);
    if (normalizedIds.length) {
      const placeholders = normalizedIds.map(() => '?').join(',');
      const existing = this.db.prepare(`SELECT c.id FROM candidates c
        JOIN candidate_hotspots ch ON ch.candidate_row_id=c.id
        WHERE c.batch_id=? AND c.composite=1
        GROUP BY c.id HAVING COUNT(*)=? AND SUM(CASE WHEN ch.hotspot_id IN (${placeholders}) THEN 1 ELSE 0 END)=?`)
        .get(batchId, normalizedIds.length, ...normalizedIds, normalizedIds.length);
      if (existing) {
        // 已存在的综合候选也要刷新标题与维度：维度模板或分组口径调整后，重跑研判能让展示标题同步更新
        if (title) this.db.prepare('UPDATE candidates SET hotspot_titles=?, dimension=?, updated_at=? WHERE id=?').run(title, dimension, now, existing.id);
        return this.addCandidateTracks(existing.id, tracks);
      }
    }
    const existingCount = this.db.prepare('SELECT COUNT(*) AS n FROM candidates WHERE batch_id=?').get(batchId).n;
    const candidateId = `S${String(existingCount+1).padStart(3,'0')}`;
    const displayTitle = title || hotspotIds.map(id => {
      const h = this.db.prepare('SELECT title FROM hotspots WHERE id=? AND batch_id=?').get(id, batchId);
      return h ? h.title : null;
    }).filter(Boolean).join(' || ');
    const result = this.db.prepare(`INSERT OR IGNORE INTO candidates
      (batch_id, hotspot_id, candidate_id, pool_role, status, composite, hotspot_titles, dimension, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pooled', 1, ?, ?, ?, ?)`)
      .run(batchId, null, candidateId, poolRole, displayTitle, dimension, now, now);
    const rowId = Number(result.lastInsertRowid);
    if (rowId && normalizedIds.length) {
      const linkInsert = this.db.prepare('INSERT OR IGNORE INTO candidate_hotspots (candidate_row_id, hotspot_id, created_at) VALUES (?, ?, ?)');
      for (const hId of normalizedIds) {
        if (this.db.prepare('SELECT 1 FROM hotspots WHERE id=? AND batch_id=?').get(hId, batchId)) {
          linkInsert.run(rowId, hId, now);
        }
      }
    }
    if (rowId) this.addCandidateTracks(rowId, tracks);
    return this.getCandidate(rowId);
  }

  findCompositeByTitle(batchId, title) {
    return this.db.prepare('SELECT * FROM candidates WHERE batch_id=? AND composite=1 AND hotspot_titles=? ORDER BY id LIMIT 1').get(batchId, String(title || '')) ?? null;
  }

  replaceCompositeMembers(candidateId, hotspotIds, batchId) {
    const now = new Date().toISOString();
    const normalizedIds = [...new Set(hotspotIds.map(Number))];
    this.db.prepare('DELETE FROM candidate_hotspots WHERE candidate_row_id=?').run(Number(candidateId));
    const linkInsert = this.db.prepare('INSERT OR IGNORE INTO candidate_hotspots (candidate_row_id, hotspot_id, created_at) VALUES (?, ?, ?)');
    for (const hId of normalizedIds) {
      if (this.db.prepare('SELECT 1 FROM hotspots WHERE id=? AND batch_id=?').get(hId, batchId)) linkInsert.run(Number(candidateId), hId, now);
    }
  }

  listCandidates(batchId, track = 'article') {
    const normalizedTrack = this.normalizeTrack(track);
    const all = this.db.prepare(`SELECT c.*, h.title AS hotspot_title, h.url, h.source, h.source_group, h.source_type, h.source_name, h.category, h.market_scope, h.raw_json AS hotspot_raw_json,
      e.next_action, e.brief_status, e.editor_question, ct.status AS track_status, ct.score AS track_score,
      ct.pool_role AS track_pool_role, ct.output_mode, ct.selected_at, ct.locked_at
      FROM candidates c LEFT JOIN hotspots h ON h.id=c.hotspot_id
      LEFT JOIN editorial_sessions e ON e.candidate_row_id=c.id
      JOIN candidate_tracks ct ON ct.candidate_row_id=c.id AND ct.track=?
      WHERE c.batch_id=? ORDER BY COALESCE(ct.score,c.f_score,-1) DESC, c.id ASC`).all(normalizedTrack, batchId);
    // For composite candidates, use first segment of hotspot_titles (before || ) as display title
    return all.map(c => {
      if (c.composite) {
        const hotspots = this.candidateHotspots(c.id);
        c.hotspot_count = hotspots.length;
        let fallback = c.hotspot_titles || '';
        if (String(fallback).trim()) {
          const stored = String(fallback).trim(); const titleSep = stored.indexOf(' || ');
          c.hotspot_title = (titleSep > 0 ? stored.substring(0, titleSep) : stored).substring(0, 60);
        } else if (hotspots[0]?.title) {
          const sep = fallback.indexOf(' || ');
          c.hotspot_title = hotspots[0].title.substring(0, 40);
        } else {
          c.hotspot_title = `综合 · ${c.candidate_id}`;
        }
      }
      c.track = normalizedTrack;
      c.tracks = this.listCandidateTracks(c.id);
      if(normalizedTrack==='social_cards'){
        c.social_score=this.getSocialScore(c.id);
        Object.assign(c,socialCandidatePresentation(c.hotspot_raw_json,this.getRepositoryFactSheet(c.id),c.social_score));
      }
      return c;
    });
  }

  getCandidate(id) {
    const candidate = this.db.prepare(`SELECT c.*, h.title AS hotspot_title, h.url, h.source, h.source_group, h.source_type, h.source_name, h.category, h.market_scope, h.published_at, h.raw_json AS hotspot_raw_json
      FROM candidates c LEFT JOIN hotspots h ON h.id=c.hotspot_id WHERE c.id=?`).get(id);
    if (!candidate) return null;
    candidate.tracks = this.listCandidateTracks(id);
    // For composite candidates, use the first associated hotspot title or first segment of hotspot_titles as display name
    if (candidate.composite) {
      const hotspots = this.candidateHotspots(candidate.id);
      let fallback = candidate.hotspot_titles || '';
      if (String(fallback).trim()) {
        const stored = String(fallback).trim(); const titleSep = stored.indexOf(' || ');
        candidate.hotspot_title = (titleSep > 0 ? stored.substring(0, titleSep) : stored).substring(0, 60);
      } else if (hotspots[0]?.title) {
        const sep = fallback.indexOf(' || ');
        candidate.hotspot_title = hotspots[0].title.substring(0, 40);
      } else {
        candidate.hotspot_title = `综合 · ${candidate.candidate_id}`;
      }
    }
    candidate.editorial = this.getEditorial(id);
    candidate.card_editorial = this.getCardEditorial(id);
    candidate.repository_fact_sheet = this.getRepositoryFactSheet(id);
    candidate.social_score = this.getSocialScore(id);
    candidate.materials = candidate.hotspot_id ? this.listHotspotMaterials(candidate.hotspot_id) : [];
    Object.assign(candidate,socialCandidatePresentation(candidate.hotspot_raw_json,candidate.repository_fact_sheet,candidate.social_score));
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

  getCandidateByHotspot(batchId, hotspotId) {
    const row=this.db.prepare('SELECT id FROM candidates WHERE batch_id=? AND hotspot_id=? ORDER BY id LIMIT 1').get(batchId,Number(hotspotId));
    return row?this.getCandidate(row.id):null;
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
      (hotspot_id,url,final_url,status,title,description,author,published_at,content,content_chars,fetched_at,error,cache_path,fetch_method,quality_json,evidence_level)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(hotspot_id) DO UPDATE SET url=excluded.url,final_url=excluded.final_url,status=excluded.status,
        title=excluded.title,description=excluded.description,author=excluded.author,published_at=excluded.published_at,
        content=excluded.content,content_chars=excluded.content_chars,fetched_at=excluded.fetched_at,error=excluded.error,cache_path=excluded.cache_path,fetch_method=excluded.fetch_method,
        quality_json=excluded.quality_json,evidence_level=excluded.evidence_level`)
      .run(hotspotId,input.url||'',input.final_url||'',input.status||'error',input.title||'',input.description||'',input.author||'',
        input.published_at||'',input.content||'',Number(input.content_chars)||0,input.fetched_at||new Date().toISOString(),input.error||'',input.cache_path||'',input.fetch_method||'',
        input.quality?JSON.stringify(input.quality):(input.quality_json||''),input.evidence_level||'');
    return this.getHotspotSource(hotspotId);
  }

  deleteCandidate(id) {
    this.db.prepare('DELETE FROM candidates WHERE id=?').run(id);
  }

  normalizeTrack(track) {
    const value = String(track || 'article');
    if (!['article','social_cards'].includes(value)) throw new Error(`不支持的候选轨道：${value}`);
    return value;
  }

  listCandidateTracks(candidateId) {
    return this.db.prepare('SELECT * FROM candidate_tracks WHERE candidate_row_id=? ORDER BY track').all(Number(candidateId));
  }

  addCandidateTracks(candidateId, tracks, input = {}) {
    const candidate = this.db.prepare('SELECT * FROM candidates WHERE id=?').get(Number(candidateId));
    if (!candidate) return null;
    const values = [...new Set((Array.isArray(tracks) ? tracks : [tracks]).map((track) => this.normalizeTrack(track)))];
    const now = new Date().toISOString();
    const insert = this.db.prepare(`INSERT INTO candidate_tracks
      (candidate_row_id,track,status,score,pool_role,output_mode,selected_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(candidate_row_id,track) DO UPDATE SET
        score=COALESCE(excluded.score,candidate_tracks.score),
        pool_role=CASE WHEN excluded.pool_role<>'' THEN excluded.pool_role ELSE candidate_tracks.pool_role END,
        output_mode=CASE WHEN excluded.output_mode<>'' THEN excluded.output_mode ELSE candidate_tracks.output_mode END,
        updated_at=excluded.updated_at`);
    this.db.exec('BEGIN');
    try {
      for (const track of values) insert.run(candidate.id, track,
        input.status || (track === 'article' ? candidate.status : 'pooled'),
        input.score ?? (track === 'article' ? candidate.f_score : null),
        input.pool_role ?? candidate.pool_role ?? '',
        input.output_mode ?? (track === 'social_cards' ? 'wechat-tool-cards' : ''), now, now);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getCandidate(candidate.id);
  }

  removeCandidateTrack(candidateId, track) {
    const normalizedTrack = this.normalizeTrack(track);
    const candidate = this.db.prepare('SELECT id FROM candidates WHERE id=?').get(Number(candidateId));
    if (!candidate) return null;
    this.db.prepare('DELETE FROM candidate_tracks WHERE candidate_row_id=? AND track=?').run(candidate.id, normalizedTrack);
    return { candidateId: candidate.id, removed: normalizedTrack, tracks: this.listCandidateTracks(candidate.id) };
  }

  updateCandidateTrack(candidateId, track, fields) {
    const normalized=this.normalizeTrack(track); const allowed=['status','score','pool_role','output_mode','locked_at'];
    const entries=Object.entries(fields).filter(([key])=>allowed.includes(key));
    if(!entries.length)return this.listCandidateTracks(candidateId).find((item)=>item.track===normalized)||null;
    entries.push(['updated_at',new Date().toISOString()]);
    this.db.prepare(`UPDATE candidate_tracks SET ${entries.map(([key])=>`${key}=?`).join(',')} WHERE candidate_row_id=? AND track=?`)
      .run(...entries.map(([,value])=>value),candidateId,normalized);
    return this.listCandidateTracks(candidateId).find((item)=>item.track===normalized)||null;
  }

  updateCandidate(id, fields) {
    const allowed = ['pool_role','risk_level','angle','thesis','h_score','b_score','p_score','s_score','d_score','f_score','status'];
    const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
    if (!entries.length) return this.getCandidate(id);
    entries.push(['updated_at', new Date().toISOString()]);
    this.db.prepare(`UPDATE candidates SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=?`)
      .run(...entries.map(([key,value]) => key.endsWith('_score') && value === '' ? null : value), id);
    if (Object.hasOwn(fields, 'status') || Object.hasOwn(fields, 'f_score') || Object.hasOwn(fields, 'pool_role')) {
      const candidate = this.db.prepare('SELECT status,f_score,pool_role,updated_at FROM candidates WHERE id=?').get(id);
      this.db.prepare(`UPDATE candidate_tracks SET status=?,score=?,pool_role=?,
        locked_at=CASE WHEN ? IN ('locked','drafting','review','preview','published') THEN COALESCE(locked_at,?) ELSE locked_at END,
        updated_at=? WHERE candidate_row_id=? AND track='article'`)
        .run(candidate.status,candidate.f_score,candidate.pool_role,candidate.status,candidate.updated_at,candidate.updated_at,id);
    }
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
    const values = fields.map((key) => {
      const value=input[key] ?? this.getEditorial(candidateId)[key];
      return key==='experience_required' ? (value ? 1 : 0) : value;
    });
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
    const visibleChars = markdownVisibleChars(content);
    const previous = this.getDocument(batchId, candidateId, kind);
    if(previous&&candidateId==null){
      this.db.prepare(`UPDATE documents SET title=?,content=?,file_path=?,visible_chars=?,status=?,updated_at=? WHERE id=?`)
        .run(title,content,filePath,visibleChars,status,now,previous.id);
    }else this.db.prepare(`INSERT INTO documents
      (batch_id,candidate_row_id,kind,title,content,file_path,visible_chars,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(batch_id,candidate_row_id,kind) DO UPDATE SET title=excluded.title,content=excluded.content,
      file_path=excluded.file_path,visible_chars=excluded.visible_chars,status=excluded.status,updated_at=excluded.updated_at`)
      .run(batchId,candidateId,kind,title,content,filePath,visibleChars,status,now,now);
    const document = this.getDocument(batchId, candidateId, kind);
    if (!previous || previous.title !== title || previous.content !== content || previous.status !== status) {
      this.db.prepare(`INSERT INTO document_revisions
        (document_id,title,content,visible_chars,status,reason,created_at) VALUES (?,?,?,?,?,?,?)`)
        .run(document.id,title,content,visibleChars,status,previous ? 'save' : 'initial',now);
      this.db.prepare(`DELETE FROM document_revisions WHERE document_id=? AND id NOT IN
        (SELECT id FROM document_revisions WHERE document_id=? ORDER BY id DESC LIMIT 50)`).run(document.id,document.id);
    }
    return document;
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
      (batch_id, kind, name, file_path, size, modified_at, status, candidate_row_id, track)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET batch_id=excluded.batch_id, kind=excluded.kind,
        name=excluded.name, size=excluded.size, modified_at=excluded.modified_at, status=excluded.status,
        candidate_row_id=COALESCE(excluded.candidate_row_id,artifacts.candidate_row_id),track=CASE WHEN excluded.track='' THEN artifacts.track ELSE excluded.track END`)
      .run(artifact.batchId ?? null, artifact.kind, artifact.name, artifact.path,
        artifact.size, artifact.modifiedAt, artifact.status ?? 'ready', artifact.candidateId ?? null, artifact.track ?? '');
  }

  listArtifacts({ limit=300, batchId } = {}) {
    if (batchId) {
      return this.db.prepare(`SELECT a.*, b.batch_date, b.title AS batch_title, c.candidate_id, COALESCE(h.title,c.hotspot_titles) AS hotspot_title
        FROM artifacts a LEFT JOIN batches b ON b.id=a.batch_id LEFT JOIN candidates c ON c.id=a.candidate_row_id LEFT JOIN hotspots h ON h.id=c.hotspot_id
        WHERE a.batch_id=? ORDER BY a.modified_at DESC LIMIT ?`).all(batchId, limit);
    }
    return this.db.prepare(`SELECT a.*, b.batch_date, b.title AS batch_title, c.candidate_id, COALESCE(h.title,c.hotspot_titles) AS hotspot_title
      FROM artifacts a LEFT JOIN batches b ON b.id=a.batch_id LEFT JOIN candidates c ON c.id=a.candidate_row_id LEFT JOIN hotspots h ON h.id=c.hotspot_id
      ORDER BY a.modified_at DESC LIMIT ?`).all(limit);
  }

  getArtifact(id) {
    return this.db.prepare('SELECT * FROM artifacts WHERE id=?').get(id) ?? null;
  }

  recordModelCall(input) {
    const snapshotId=input.generationSnapshotId ?? (input.batchId ? this.db.prepare(`SELECT id FROM generation_snapshots
      WHERE batch_id=? AND ((? IS NULL AND candidate_row_id IS NULL) OR candidate_row_id=?)
      ORDER BY id DESC LIMIT 1`).get(input.batchId,input.candidateId??null,input.candidateId??null)?.id : null);
    const result = this.db.prepare(`INSERT INTO model_calls
      (provider,model,purpose,batch_id,candidate_row_id,estimated_input_tokens,prompt_tokens,
       completion_tokens,compressed,latency_ms,status,error,generation_snapshot_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.provider, input.model, input.purpose || 'unknown', input.batchId ?? null,
      input.candidateId ?? null, input.estimatedInputTokens ?? 0, input.promptTokens ?? null,
      input.completionTokens ?? null, input.compressed ? 1 : 0, input.latencyMs ?? 0,
      input.status, input.error ?? null, snapshotId ?? null, new Date().toISOString());
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

  saveGenerationSnapshot({ batchId = null, candidateId = null, purpose, snapshot }) {
    const now = new Date().toISOString();
    const result = this.db.prepare(`INSERT INTO generation_snapshots
      (batch_id,candidate_row_id,purpose,snapshot_json,created_at) VALUES (?,?,?,?,?)`)
      .run(batchId, candidateId, purpose, JSON.stringify(snapshot), now);
    return { id:Number(result.lastInsertRowid), batchId, candidateId, purpose, snapshot, createdAt:now };
  }

  listGenerationSnapshots({ batchId = null, candidateId = null, limit = 50 } = {}) {
    const where=[]; const values=[];
    if(batchId){where.push('batch_id=?');values.push(batchId);}
    if(candidateId){where.push('candidate_row_id=?');values.push(candidateId);}
    values.push(Math.min(200, Math.max(1, Number(limit)||50)));
    return this.db.prepare(`SELECT * FROM generation_snapshots ${where.length?`WHERE ${where.join(' AND ')}`:''} ORDER BY id DESC LIMIT ?`)
      .all(...values).map((row)=>({...row,snapshot:JSON.parse(row.snapshot_json)}));
  }

  getGenerationSnapshot(id) {
    const row=this.db.prepare('SELECT * FROM generation_snapshots WHERE id=?').get(id);
    return row?{...row,snapshot:JSON.parse(row.snapshot_json)}:null;
  }

  findLatestGenerationSnapshot({ batchId, candidateId = null, purposes = [] }) {
    if (!batchId || !purposes.length) return null;
    const placeholders=purposes.map(()=>'?').join(',');
    const row=this.db.prepare(`SELECT * FROM generation_snapshots
      WHERE batch_id=? AND ((? IS NULL AND candidate_row_id IS NULL) OR candidate_row_id=?)
        AND purpose IN (${placeholders})
      ORDER BY id DESC LIMIT 1`).get(batchId,candidateId,candidateId,...purposes);
    return row?{...row,snapshot:JSON.parse(row.snapshot_json)}:null;
  }

  saveToolExecution({ batchId = null, candidateId = null, generationSnapshotId = null, skillId = null, record }) {
    const result=this.db.prepare(`INSERT INTO tool_executions
      (batch_id,candidate_row_id,generation_snapshot_id,skill_id,capability,plugin,plugin_version,status,error_code,
       input_keys_json,authorized_external_write,started_at,finished_at,duration_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      batchId,candidateId,generationSnapshotId,skillId,record.capability,record.plugin,record.version,
      record.status,record.errorCode,JSON.stringify(record.inputKeys||[]),record.authorizedExternalWrite?1:0,
      record.startedAt,record.finishedAt,Number(record.durationMs)||0,
    );
    return {id:Number(result.lastInsertRowid),batchId,candidateId,generationSnapshotId,skillId,...record};
  }

  listToolExecutions({ batchId = null, candidateId = null, capability = null, limit = 100 } = {}) {
    const where=[];const values=[];
    if(batchId){where.push('batch_id=?');values.push(batchId);}
    if(candidateId){where.push('candidate_row_id=?');values.push(candidateId);}
    if(capability){where.push('capability=?');values.push(capability);}
    values.push(Math.min(500,Math.max(1,Number(limit)||100)));
    return this.db.prepare(`SELECT * FROM tool_executions ${where.length?`WHERE ${where.join(' AND ')}`:''} ORDER BY id DESC LIMIT ?`)
      .all(...values).map((row)=>({...row,input_keys:JSON.parse(row.input_keys_json),authorized_external_write:Boolean(row.authorized_external_write)}));
  }

  saveSkillVersion({ skillId, config, configHash, publish = false }) {
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const current=this.db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM skill_versions WHERE skill_id=?').get(skillId);
      const version=Number(current.version)+1;const now=new Date().toISOString();
      if(publish)this.db.prepare("UPDATE skill_versions SET status='archived' WHERE skill_id=? AND status='published'").run(skillId);
      const result=this.db.prepare(`INSERT INTO skill_versions
        (skill_id,version,status,config_json,config_hash,created_at,published_at) VALUES (?,?,?,?,?,?,?)`)
        .run(skillId,version,publish?'published':'draft',JSON.stringify(config),configHash,now,publish?now:null);
      this.db.exec('COMMIT');
      return {id:Number(result.lastInsertRowid),skillId,version,status:publish?'published':'draft',config,configHash,createdAt:now,publishedAt:publish?now:null};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  removeSkillVersion(id) { this.db.prepare('DELETE FROM skill_versions WHERE id=?').run(id); }
  setPublishedSkillVersion(skillId, version) {
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare("UPDATE skill_versions SET status='archived' WHERE skill_id=? AND status='published'").run(skillId);
      this.db.prepare("UPDATE skill_versions SET status='published',published_at=COALESCE(published_at,?) WHERE skill_id=? AND version=?").run(new Date().toISOString(),skillId,version);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  getSkillVersion(skillId, version = null) {
    const row=version
      ? this.db.prepare('SELECT * FROM skill_versions WHERE skill_id=? AND version=?').get(skillId,version)
      : this.db.prepare("SELECT * FROM skill_versions WHERE skill_id=? ORDER BY CASE status WHEN 'published' THEN 0 ELSE 1 END, version DESC LIMIT 1").get(skillId);
    return row?{...row,config:JSON.parse(row.config_json)}:null;
  }

  listSkillVersions(skillId) {
    return this.db.prepare('SELECT * FROM skill_versions WHERE skill_id=? ORDER BY version DESC').all(skillId)
      .map((row)=>({...row,config:JSON.parse(row.config_json)}));
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

  findCustomArticleRequest(batchId, { requestId = '', fingerprint = '' } = {}) {
    if (requestId) {
      const found=this.db.prepare('SELECT * FROM custom_article_requests WHERE batch_id=? AND request_id=?').get(batchId,requestId);
      if(found)return found;
    }
    return fingerprint
      ? this.db.prepare('SELECT * FROM custom_article_requests WHERE batch_id=? AND fingerprint=?').get(batchId,fingerprint)??null
      : null;
  }

  createCustomArticleRequest({ batchId, requestId, fingerprint }) {
    const now=new Date().toISOString();
    this.db.prepare(`INSERT OR IGNORE INTO custom_article_requests
      (batch_id,request_id,fingerprint,created_at,updated_at) VALUES (?,?,?,?,?)`)
      .run(batchId,requestId,fingerprint,now,now);
    return this.findCustomArticleRequest(batchId,{requestId,fingerprint});
  }

  updateCustomArticleRequest(id, { candidateId, latestJobId } = {}) {
    const entries=[];
    if(candidateId!==undefined)entries.push(['candidate_row_id',candidateId]);
    if(latestJobId!==undefined)entries.push(['latest_job_id',latestJobId]);
    if(!entries.length)return this.db.prepare('SELECT * FROM custom_article_requests WHERE id=?').get(id)??null;
    entries.push(['updated_at',new Date().toISOString()]);
    this.db.prepare(`UPDATE custom_article_requests SET ${entries.map(([key])=>`${key}=?`).join(',')} WHERE id=?`)
      .run(...entries.map(([,value])=>value),id);
    return this.db.prepare('SELECT * FROM custom_article_requests WHERE id=?').get(id)??null;
  }

  getCustomArticleRequestByCandidate(candidateId) {
    return this.db.prepare('SELECT * FROM custom_article_requests WHERE candidate_row_id=? ORDER BY id DESC LIMIT 1').get(Number(candidateId))??null;
  }

  listCustomArticleProjects(batchId) {
    return this.db.prepare(`SELECT c.id,c.candidate_id,c.status,c.created_at,c.updated_at,
      h.title,ct.output_mode,ct.status AS track_status,
      r.latest_job_id,ar.status AS job_status,ar.progress AS job_progress,ar.error AS job_error,
      d.id AS document_id,d.kind AS document_kind,d.title AS document_title,d.updated_at AS document_updated_at
      FROM candidates c
      JOIN candidate_tracks ct ON ct.candidate_row_id=c.id AND ct.track='article'
      LEFT JOIN hotspots h ON h.id=c.hotspot_id
      LEFT JOIN custom_article_requests r ON r.candidate_row_id=c.id
      LEFT JOIN ai_runs ar ON ar.id=r.latest_job_id
      LEFT JOIN documents d ON d.id=(
        SELECT id FROM documents WHERE batch_id=c.batch_id AND candidate_row_id=c.id
        AND kind IN ('final','draft') ORDER BY CASE kind WHEN 'final' THEN 0 ELSE 1 END,updated_at DESC LIMIT 1
      )
      WHERE c.batch_id=? AND ct.output_mode IN ('wechat-experience','wechat-tutorial')
      ORDER BY c.updated_at DESC,c.id DESC`).all(batchId);
  }

  getDocumentById(id) {
    return this.db.prepare("SELECT * FROM documents WHERE id=?").get(id) ?? null;
  }

  listDocumentRevisions(documentId) {
    return this.db.prepare(`SELECT id,document_id,title,visible_chars,status,reason,created_at,
      length(content) AS content_length FROM document_revisions WHERE document_id=? ORDER BY id DESC`).all(documentId);
  }

  getDocumentRevision(documentId, revisionId) {
    return this.db.prepare("SELECT * FROM document_revisions WHERE document_id=? AND id=?").get(documentId,revisionId) ?? null;
  }

  restoreFromDatabase(backupPath) {
    const sourceDb=new DatabaseSync(backupPath,{readOnly:true});
    try {
      const current=this.db.prepare("SELECT name,sql FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      const source=sourceDb.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      if(JSON.stringify(current)!==JSON.stringify(source))throw new Error('备份数据库结构与当前版本不匹配');
      const violations=sourceDb.prepare('PRAGMA foreign_key_check').all();
      if(violations.length)throw new Error('备份数据库存在关联完整性错误');
      const snapshots=current.map(({name})=>({
        name,
        columns:sourceDb.prepare(`PRAGMA table_info("${name.replaceAll('"','""')}")`).all().map((item)=>item.name),
        rows:sourceDb.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all()
      }));
      this.db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
      try {
        for(const {name} of current.slice().reverse())this.db.exec(`DELETE FROM "${name.replaceAll('"','""')}"`);
        for(const table of snapshots){
          if(!table.rows.length)continue;
          const quoted=table.columns.map((name)=>`"${name.replaceAll('"','""')}"`).join(',');
          const insert=this.db.prepare(`INSERT INTO "${table.name.replaceAll('"','""')}" (${quoted}) VALUES (${table.columns.map(()=>'?').join(',')})`);
          for(const row of table.rows)insert.run(...table.columns.map((name)=>row[name]));
        }
        this.db.exec('COMMIT');
      } catch(error) { this.db.exec('ROLLBACK'); throw error; }
      finally { this.db.exec('PRAGMA foreign_keys=ON'); }
    } finally { sourceDb.close(); }
    return this.db.prepare("SELECT COUNT(*) AS count FROM batches").get();
  }

  listRecentAiRuns(limit = 30) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 30));
    return this.db.prepare('SELECT * FROM ai_runs ORDER BY updated_at DESC LIMIT ?').all(safeLimit);
  }

  listRecentRuns(limit = 40) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 40));
    return this.db.prepare(`SELECT id, 'ai' AS run_kind, batch_id, type, provider, status, progress,
      error, created_at, updated_at FROM ai_runs
      UNION ALL
      SELECT 'source:' || id, 'source' AS run_kind, batch_id, source, source, status,
      CASE WHEN status='success' THEN '采集完成' ELSE COALESCE(error, status) END,
      error, started_at, COALESCE(ended_at, started_at) FROM source_runs
      ORDER BY updated_at DESC LIMIT ?`).all(safeLimit);
  }

  saveAnalyzedCandidates(batchId, records) {
    for (const item of records) {
      const ids = [...new Set((Array.isArray(item.hotspotIds) && item.hotspotIds.length ? item.hotspotIds : [item.hotspotId]).filter((v) => v != null).map(Number))];
      item._hotspotIds = ids;
      item._rowId = null;
      if (ids.length > 1) {
        // 多报道事件：候选锚定整个事件（全部报道），而不是只锚定代表热点
        const composite = this.createCompositeCandidate(batchId, ids, { title: item.title || '', poolRole: item.poolRole || '综合选题', tracks: ['article'], dimension: item.dimension || 'event' });
        item._rowId = composite?.id ?? null;
      } else if (ids.length === 1) {
        this.addCandidates(batchId, ids);
      }
    }
    for (const item of records) {
      const row = item._rowId ? { id: item._rowId } : this.db.prepare('SELECT id FROM candidates WHERE batch_id=? AND hotspot_id=?').get(batchId, item._hotspotIds?.[0] ?? item.hotspotId);
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

  saveSocialPreselection(batchId, records) {
    const selectedCandidateIds = [];
    const completedRepositories = new Set(this.db.prepare(`SELECT h.url,h.raw_json
      FROM artifacts a
      JOIN candidates c ON c.id=a.candidate_row_id
      JOIN hotspots h ON h.id=c.hotspot_id
      WHERE a.track='social_cards' AND a.name='my-design.html' AND a.status='ready'
        AND c.batch_id<>?`).all(batchId)
      .map((row)=>repositoryKey(row.url,row.raw_json)).filter(Boolean));
    for (const item of records || []) {
      const hotspot=this.db.prepare('SELECT url,raw_json FROM hotspots WHERE id=? AND batch_id=?').get(item.hotspotId,batchId);
      const repository=repositoryKey(hotspot?.url,hotspot?.raw_json);
      if(repository&&completedRepositories.has(repository))continue;
      this.addCandidates(batchId, [item.hotspotId], { tracks:['social_cards'] });
      const row = this.db.prepare('SELECT id FROM candidates WHERE batch_id=? AND hotspot_id=? ORDER BY id LIMIT 1').get(batchId, item.hotspotId);
      if (!row) continue;
      selectedCandidateIds.push(row.id);
      this.addCandidateTracks(row.id, ['social_cards'], {
        status:'pooled', score:item.socialScore ?? null, pool_role:'AI 图文预选', output_mode:'wechat-tool-cards',
      });
      if(item.socialScoreDetails)this.saveSocialScore(row.id,item.socialScoreDetails);
    }
    const placeholders = selectedCandidateIds.map(() => '?').join(',');
    this.db.prepare(`DELETE FROM candidate_tracks WHERE track='social_cards' AND pool_role='AI 图文预选'
      AND candidate_row_id IN (SELECT id FROM candidates WHERE batch_id=?)
      ${selectedCandidateIds.length ? `AND candidate_row_id NOT IN (${placeholders})` : ''}`)
      .run(batchId, ...selectedCandidateIds);
    return this.listCandidates(batchId, 'social_cards');
  }

  getRepositoryFactSheet(candidateId) {
    const row = this.db.prepare('SELECT * FROM repository_fact_sheets WHERE candidate_row_id=?').get(Number(candidateId));
    if (!row) return null;
    try { return { ...row, data:JSON.parse(row.data_json || '{}') }; } catch { return { ...row, data:{} }; }
  }

  saveRepositoryFactSheet(candidateId, input) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO repository_fact_sheets
      (candidate_row_id,repository,source_url,status,data_json,checked_at,error,updated_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(candidate_row_id) DO UPDATE SET
      repository=excluded.repository,source_url=excluded.source_url,status=excluded.status,data_json=excluded.data_json,
      checked_at=excluded.checked_at,error=excluded.error,updated_at=excluded.updated_at`)
      .run(candidateId,input.repository||'',input.sourceUrl||'',input.status||'ok',JSON.stringify(input.data||input),input.checkedAt||now,input.error||'',now);
    return this.getRepositoryFactSheet(candidateId);
  }

  getSocialScore(candidateId) {
    const row=this.db.prepare('SELECT * FROM candidate_social_scores WHERE candidate_row_id=?').get(Number(candidateId));
    if(!row)return null;
    try{return {...row,score:JSON.parse(row.score_json||'{}')};}catch{return {...row,score:{}};}
  }

  saveSocialScore(candidateId, score) {
    const now=new Date().toISOString();
    this.db.prepare(`INSERT INTO candidate_social_scores (candidate_row_id,score_json,final_score,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(candidate_row_id) DO UPDATE SET score_json=excluded.score_json,final_score=excluded.final_score,updated_at=excluded.updated_at`)
      .run(candidateId,JSON.stringify(score),score.finalScore??null,now);
    this.db.prepare("UPDATE candidate_tracks SET score=?,updated_at=? WHERE candidate_row_id=? AND track='social_cards'").run(score.finalScore??null,now,candidateId);
    return this.getSocialScore(candidateId);
  }

  getCardEditorial(candidateId) {
    return this.db.prepare('SELECT * FROM card_editorial_sessions WHERE candidate_row_id=?').get(Number(candidateId)) ?? {
      candidate_row_id:Number(candidateId),target_reader:'',pain_point:'',tool_positioning:'',must_highlight:'',must_disclose:'',getting_started:'',
      forbidden_claims:'',output_mode:'wechat-tool-cards',visual_style:'ice-blue',composition_mode:'smart',layout_style:'auto',recommended_pages:6,card_plan_json:'[]',status:'DISCUSS',updated_at:''
    };
  }

  saveCardEditorial(candidateId, input) {
    const current=this.getCardEditorial(candidateId); const now=new Date().toISOString();
    const fields=['target_reader','pain_point','tool_positioning','must_highlight','must_disclose','getting_started','forbidden_claims','output_mode','visual_style','composition_mode','layout_style','recommended_pages','card_plan_json','status'];
    const values=fields.map((key)=>input[key]??current[key]);
    this.db.prepare(`INSERT INTO card_editorial_sessions (candidate_row_id,${fields.join(',')},updated_at) VALUES (?,${fields.map(()=>'?').join(',')},?)
      ON CONFLICT(candidate_row_id) DO UPDATE SET ${fields.map((key)=>`${key}=excluded.${key}`).join(',')},updated_at=excluded.updated_at`)
      .run(candidateId,...values,now);
    return this.getCardEditorial(candidateId);
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
        where.push("b.batch_date >= ? AND b.batch_date <= ?");
        values.push(monday.getFullYear()+'-'+String(monday.getMonth()+1).padStart(2,'0')+'-'+String(monday.getDate()).padStart(2,'0'), sunday.getFullYear()+'-'+String(sunday.getMonth()+1).padStart(2,'0')+'-'+String(sunday.getDate()).padStart(2,'0'));
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

  listCalendarContent({ month, limit = 400 } = {}) {
    const articleWhere = ["d.kind='final'"];
    const socialWhere = ["a.track='social_cards'", "a.name='my-design.html'", "a.status='ready'"];
    const articleValues = [];
    const socialValues = [];
    if (month) {
      articleWhere.push("strftime('%Y-%m', COALESCE(b.batch_date,d.updated_at))=?");
      socialWhere.push("strftime('%Y-%m', COALESCE(b.batch_date,a.modified_at))=?");
      articleValues.push(month);
      socialValues.push(month);
    }
    const articles = this.db.prepare(`SELECT 'article' AS content_type, d.id, d.batch_id,
      d.candidate_row_id, d.title, d.status, d.updated_at, c.candidate_id, c.pool_role,
      b.batch_date, b.title AS batch_title, COALESCE(h.title,d.title) AS hotspot_title
      FROM documents d
      LEFT JOIN candidates c ON c.id=d.candidate_row_id
      LEFT JOIN batches b ON b.id=d.batch_id
      LEFT JOIN hotspots h ON h.id=c.hotspot_id
      WHERE ${articleWhere.join(' AND ')}`).all(...articleValues);
    const socialCards = this.db.prepare(`SELECT 'social_cards' AS content_type, a.id, a.batch_id,
      a.candidate_row_id, COALESCE(h.title,c.hotspot_titles,'图文内容') AS title,
      a.status, a.modified_at AS updated_at, c.candidate_id,
      COALESCE(NULLIF(ct.pool_role,''),c.pool_role) AS pool_role, b.batch_date, b.title AS batch_title,
      COALESCE(h.title,c.hotspot_titles,'图文内容') AS hotspot_title
      FROM artifacts a
      LEFT JOIN candidates c ON c.id=a.candidate_row_id
      LEFT JOIN candidate_tracks ct ON ct.candidate_row_id=c.id AND ct.track='social_cards'
      LEFT JOIN batches b ON b.id=a.batch_id
      LEFT JOIN hotspots h ON h.id=c.hotspot_id
      WHERE ${socialWhere.join(' AND ')}`).all(...socialValues);
    return [...articles, ...socialCards]
      .sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')))
      .slice(0, limit);
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

  findSimilarSocialCards(candidateId) {
    const candidate=this.getCandidate(candidateId);if(!candidate)return [];
    const currentRepository=repositoryKey(candidate.url,candidate.hotspot_raw_json);
    const words=new Set(String(candidate.hotspot_title||'').toLowerCase().split(/[\s,，。、；：·｜|()（）/\-_]+/).filter((word)=>word.length>2));
    const rows=this.db.prepare(`SELECT a.id AS artifact_id,a.candidate_row_id,a.modified_at,c.candidate_id,
      COALESCE(h.title,c.hotspot_titles,'图文内容') AS title,h.url,h.raw_json,b.batch_date,b.title AS batch_title
      FROM artifacts a
      JOIN candidates c ON c.id=a.candidate_row_id
      LEFT JOIN hotspots h ON h.id=c.hotspot_id
      LEFT JOIN batches b ON b.id=a.batch_id
      WHERE a.track='social_cards' AND a.name='my-design.html' AND a.status='ready'
        AND a.candidate_row_id IS NOT NULL AND a.candidate_row_id!=?
      ORDER BY a.modified_at DESC LIMIT 300`).all(candidateId);
    const matches=[];
    for(const row of rows){
      const historicalRepository=repositoryKey(row.url,row.raw_json);let score=0;let reason='';const matchedWords=[];
      if(currentRepository&&historicalRepository===currentRepository){score=100;reason='同一仓库';}
      else if(words.size){const title=String(row.title||'').toLowerCase();for(const word of words)if(title.includes(word)){score+=15;matchedWords.push(word);}if(score>=15)reason=`相似关键词：${matchedWords.slice(0,3).join('、')}`;}
      if(score>=15)matches.push({artifactId:row.artifact_id,candidateRowId:row.candidate_row_id,candidateId:row.candidate_id,
        title:row.title,batchDate:row.batch_date,batchTitle:row.batch_title,updatedAt:row.modified_at,score,reason});
    }
    return matches.sort((a,b)=>b.score-a.score||String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,5);
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
      SELECT COUNT(*) AS n
      FROM documents d LEFT JOIN batches b ON b.id=d.batch_id WHERE d.kind='final' AND strftime('%Y-%m', b.batch_date)=strftime('%Y-%m','now')`).get().n;
    const thisWeek = this.db.prepare(`
      SELECT COUNT(*) AS n
      FROM documents d LEFT JOIN batches b ON b.id=d.batch_id WHERE d.kind='final' AND strftime('%Y-%W', b.batch_date)=strftime('%Y-%W','now')`).get().n;
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


  saveEliminationReasons(batchId, ranking) {
    const update = this.db.prepare('UPDATE hotspots SET raw_json=? WHERE id=?');
    for (const item of ranking) {
      if (item.eliminationReason && item.hotspotId) {
        const row = this.db.prepare('SELECT raw_json FROM hotspots WHERE id=?').get(item.hotspotId);
        if (row) {
          let j = {};
          try { j = JSON.parse(row.raw_json || '{}'); } catch {}
          j.eliminationReason = item.eliminationReason;
          update.run(JSON.stringify(j), item.hotspotId);
        }
      }
    }
  }

  overview() {
    const globalTrackCounts = this.db.prepare(`SELECT
      SUM(CASE WHEN track='article' THEN 1 ELSE 0 END) AS article_candidates,
      SUM(CASE WHEN track='social_cards' THEN 1 ELSE 0 END) AS social_candidates
      FROM candidate_tracks`).get();
    const latest = this.latestActiveBatch();
    const currentTrackCounts = latest ? this.db.prepare(`SELECT
      SUM(CASE WHEN ct.track='article' AND ct.status IN ('locked','drafting','review','preview') THEN 1 ELSE 0 END) AS article_in_progress,
      SUM(CASE WHEN ct.track='social_cards' AND ct.status NOT IN ('pooled','published','removed') THEN 1 ELSE 0 END) AS social_in_progress
      FROM candidate_tracks ct
      JOIN candidates c ON c.id=ct.candidate_row_id
      WHERE c.batch_id=?`).get(latest.id) : {};
    const current = latest ? {
      failedRuns: Number(this.db.prepare(`SELECT
        (SELECT COUNT(*) FROM ai_runs WHERE batch_id=? AND status='failed') +
        (SELECT COUNT(*) FROM source_runs WHERE batch_id=? AND status IN ('failed','error')) AS n`).get(latest.id, latest.id).n || 0),
      pendingArticleCandidates: Number(this.db.prepare(`SELECT COUNT(*) AS n FROM candidate_tracks ct
        JOIN candidates c ON c.id=ct.candidate_row_id
        WHERE c.batch_id=? AND ct.track='article' AND ct.status='pooled'`).get(latest.id).n || 0),
      blockedBriefs: Number(this.db.prepare(`SELECT COUNT(*) AS n FROM editorial_sessions e
        JOIN candidates c ON c.id=e.candidate_row_id
        JOIN candidate_tracks ct ON ct.candidate_row_id=c.id AND ct.track='article'
        WHERE c.batch_id=? AND e.brief_status!='LOCKED' AND ct.status!='removed'`).get(latest.id).n || 0),
      sourceOk: Number(this.db.prepare(`SELECT COUNT(*) AS n FROM source_runs
        WHERE batch_id=? AND status IN ('ok','completed')`).get(latest.id).n || 0),
      sourceTotal: Number(this.db.prepare(`SELECT COUNT(DISTINCT source) AS n FROM source_runs WHERE batch_id=?`).get(latest.id).n || 0),
    } : { failedRuns:0, pendingArticleCandidates:0, blockedBriefs:0, sourceOk:0, sourceTotal:0 };
    const efficiency = latest ? (() => {
      const ai = this.db.prepare(`SELECT
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
        FROM ai_runs WHERE batch_id=?`).get(latest.id);
      const tracks = this.db.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN ct.status NOT IN ('pooled','removed') THEN 1 ELSE 0 END) AS progressed
        FROM candidate_tracks ct JOIN candidates c ON c.id=ct.candidate_row_id WHERE c.batch_id=?`).get(latest.id);
      const output = this.db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE batch_id=?').get(latest.id);
      // 采集到研判：从最早一次采集开始到最近一次研判（research/auto）完成的墙钟耗时
      const collectStartAt = this.db.prepare('SELECT MIN(started_at) AS t FROM source_runs WHERE batch_id=?').get(latest.id).t;
      const researchEndAt = this.db.prepare("SELECT MAX(updated_at) AS t FROM ai_runs WHERE batch_id=? AND type IN ('research','auto') AND status='completed'").get(latest.id).t;
      const collectToResearchDurationMs = collectStartAt && researchEndAt ? Math.max(0, Date.parse(researchEndAt) - Date.parse(collectStartAt)) : null;
      const decidedAi=Number(ai.completed||0)+Number(ai.failed||0);
      const totalTracks=Number(tracks.total||0);
      const bottleneck=current.failedRuns?"存在失败任务，优先处理重试"
        :current.blockedBriefs?`${current.blockedBriefs} 个简报卡在成稿门禁`
        :current.pendingArticleCandidates?`${current.pendingArticleCandidates} 个文章候选等待确认`
        :!latest.hotspot_count?"尚未采集热点"
        :!Number(output.n||0)?"生产链已推进，但尚未形成产物"
        :"当前生产链没有明显阻塞";
      return {
        aiSuccessRate:decidedAi?Math.round(Number(ai.completed||0)/decidedAi*100):null,
        candidateConversionRate:totalTracks?Math.round(Number(tracks.progressed||0)/totalTracks*100):null,
        artifactCount:Number(output.n||0),
        collectToResearchDurationMs,
        bottleneck,
      };
    })() : { aiSuccessRate:null, candidateConversionRate:null, artifactCount:0, collectToResearchDurationMs:null, bottleneck:"建立当前批次后开始记录效率" };
    const baselineRows=latest?this.db.prepare(`SELECT b.id,
      (SELECT SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) FROM ai_runs ar WHERE ar.batch_id=b.id) AS ai_completed,
      (SELECT SUM(CASE WHEN status IN ('completed','failed') THEN 1 ELSE 0 END) FROM ai_runs ar WHERE ar.batch_id=b.id) AS ai_decided,
      (SELECT COUNT(*) FROM candidate_tracks ct JOIN candidates c ON c.id=ct.candidate_row_id WHERE c.batch_id=b.id) AS track_total,
      (SELECT COUNT(*) FROM candidate_tracks ct JOIN candidates c ON c.id=ct.candidate_row_id WHERE c.batch_id=b.id AND ct.status NOT IN ('pooled','removed')) AS track_progressed,
      (SELECT COUNT(*) FROM artifacts a WHERE a.batch_id=b.id) AS artifact_count,
      (SELECT MIN(started_at) FROM source_runs sr2 WHERE sr2.batch_id=b.id) AS collect_start_at,
      (SELECT MAX(updated_at) FROM ai_runs ar2 WHERE ar2.batch_id=b.id AND ar2.type IN ('research','auto') AND ar2.status='completed') AS research_end_at
      FROM batches b WHERE b.id<>? ORDER BY b.batch_date DESC,b.created_at DESC LIMIT 5`).all(latest.id):[];
    const average=(values)=>values.length?Math.round(values.reduce((sum,value)=>sum+value,0)/values.length):null;
    const efficiencyBaseline={
      sampleSize:baselineRows.length,
      aiSuccessRate:average(baselineRows.filter((row)=>Number(row.ai_decided||0)>0).map((row)=>Number(row.ai_completed||0)/Number(row.ai_decided)*100)),
      candidateConversionRate:average(baselineRows.filter((row)=>Number(row.track_total||0)>0).map((row)=>Number(row.track_progressed||0)/Number(row.track_total)*100)),
      artifactCount:average(baselineRows.map((row)=>Number(row.artifact_count||0))),
      collectToResearchDurationMs:average(baselineRows.filter((row)=>row.collect_start_at&&row.research_end_at).map((row)=>Math.max(0,Date.parse(row.research_end_at)-Date.parse(row.collect_start_at)))),
    };
    return {
      batches: this.db.prepare('SELECT COUNT(*) AS n FROM batches').get().n,
      hotspots: this.db.prepare('SELECT COUNT(*) AS n FROM hotspots').get().n,
      artifacts: this.db.prepare('SELECT COUNT(*) AS n FROM artifacts').get().n,
      articleCandidates: Number(globalTrackCounts.article_candidates || 0),
      socialCandidates: Number(globalTrackCounts.social_candidates || 0),
      articleInProgress: Number(currentTrackCounts.article_in_progress || 0),
      socialInProgress: Number(currentTrackCounts.social_in_progress || 0),
      latest,
      current,
      efficiency,
      efficiencyBaseline,
      sourceHealth: this.db.prepare(`SELECT source, status, item_count, error, ended_at
        FROM source_runs WHERE id IN (SELECT MAX(id) FROM source_runs GROUP BY source)
        ORDER BY source`).all(),
    };
  }

  close() {
    this.db.close();
  }

  saveVisualDecision({ batchId, candidateId = null, visualType, action, heading = '', purpose = '' }) {
    if (!['mermaid','echarts'].includes(visualType) || !['inserted','ignored'].includes(action)) throw new Error('可视化决策无效');
    const result=this.db.prepare(`INSERT INTO visual_decisions
      (batch_id,candidate_row_id,visual_type,action,heading,purpose,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run(batchId,candidateId,visualType,action,String(heading),String(purpose),new Date().toISOString());
    return this.db.prepare('SELECT * FROM visual_decisions WHERE id=?').get(result.lastInsertRowid);
  }

  visualDecisionStats() {
    return this.db.prepare(`SELECT visual_type,
      SUM(CASE WHEN action='inserted' THEN 1 ELSE 0 END) AS inserted,
      SUM(CASE WHEN action='ignored' THEN 1 ELSE 0 END) AS ignored
      FROM visual_decisions GROUP BY visual_type`).all();
  }
}
