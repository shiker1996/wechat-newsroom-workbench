export function applyWorkbenchSchema(db) {
    const candidateTracksExisted = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='candidate_tracks'").get());
    db.exec(`
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
      CREATE TABLE IF NOT EXISTS candidate_sources (
        candidate_row_id INTEGER NOT NULL,
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
        quality_json TEXT NOT NULL DEFAULT '',
        evidence_level TEXT NOT NULL DEFAULT '',
        UNIQUE(candidate_row_id, url),
        FOREIGN KEY(candidate_row_id) REFERENCES candidates(id) ON DELETE CASCADE
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
        distribution_lane TEXT NOT NULL DEFAULT '推荐池',
        reader_stake TEXT NOT NULL DEFAULT '',
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
        reasoning_tokens INTEGER,
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
      CREATE TABLE IF NOT EXISTS theme_definitions (
        id TEXT PRIMARY KEY,
        owner_scope TEXT NOT NULL DEFAULT 'workspace',
        target TEXT NOT NULL CHECK(target IN ('article','social','cover')),
        label TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'user',
        active_version_id INTEGER,
        status TEXT NOT NULL DEFAULT 'draft',
        draft_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(active_version_id) REFERENCES theme_versions(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS theme_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        theme_id TEXT NOT NULL,
        version TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        definition_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'published',
        created_at TEXT NOT NULL,
        published_at TEXT,
        UNIQUE(theme_id,version),
        FOREIGN KEY(theme_id) REFERENCES theme_definitions(id) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS theme_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        theme_id TEXT NOT NULL,
        version TEXT NOT NULL,
        target TEXT NOT NULL CHECK(target IN ('article','social','cover')),
        source TEXT NOT NULL,
        batch_id TEXT,
        candidate_row_id INTEGER,
        used_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_hotspots_batch ON hotspots(batch_id);
      CREATE INDEX IF NOT EXISTS idx_hotspots_title ON hotspots(title);
      CREATE INDEX IF NOT EXISTS idx_hotspot_materials_hotspot ON hotspot_materials(hotspot_id,position);
      CREATE INDEX IF NOT EXISTS idx_artifacts_batch ON artifacts(batch_id);
      CREATE INDEX IF NOT EXISTS idx_candidates_batch ON candidates(batch_id);
      CREATE INDEX IF NOT EXISTS idx_candidate_sources_candidate ON candidate_sources(candidate_row_id,url);
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
      CREATE INDEX IF NOT EXISTS idx_theme_versions_theme ON theme_versions(theme_id,id DESC);
      CREATE INDEX IF NOT EXISTS idx_theme_usage_theme ON theme_usage(theme_id,used_at DESC);
    `);
    const batchColumns=new Set(db.prepare('PRAGMA table_info(batches)').all().map((column)=>column.name));
    if(!batchColumns.has('batch_type'))db.exec("ALTER TABLE batches ADD COLUMN batch_type TEXT NOT NULL DEFAULT 'regular'");
    const modelCallColumns=new Set(db.prepare('PRAGMA table_info(model_calls)').all().map((column)=>column.name));
    if(!modelCallColumns.has('generation_snapshot_id'))db.exec('ALTER TABLE model_calls ADD COLUMN generation_snapshot_id INTEGER');
    if(!modelCallColumns.has('reasoning_tokens'))db.exec('ALTER TABLE model_calls ADD COLUMN reasoning_tokens INTEGER');
    if(!batchColumns.has('requested_tracks'))db.exec("ALTER TABLE batches ADD COLUMN requested_tracks TEXT NOT NULL DEFAULT '[\"article\"]'");
    if(!batchColumns.has('max_age_hours'))db.exec("ALTER TABLE batches ADD COLUMN max_age_hours INTEGER");
    if(!batchColumns.has('lifecycle_status'))db.exec("ALTER TABLE batches ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active'");
    db.exec("UPDATE batches SET lifecycle_status='archived',status='review' WHERE status='archived'");
    const materialColumns=new Set(db.prepare('PRAGMA table_info(hotspot_materials)').all().map((column)=>column.name));
    for(const [name,definition] of Object.entries({
      status:"TEXT NOT NULL DEFAULT 'pending'",final_url:"TEXT NOT NULL DEFAULT ''",title:"TEXT NOT NULL DEFAULT ''",
      author:"TEXT NOT NULL DEFAULT ''",published_at:"TEXT NOT NULL DEFAULT ''",description:"TEXT NOT NULL DEFAULT ''",
      content:"TEXT NOT NULL DEFAULT ''",content_chars:'INTEGER NOT NULL DEFAULT 0',fetched_at:"TEXT NOT NULL DEFAULT ''",
      error:"TEXT NOT NULL DEFAULT ''",fetch_method:"TEXT NOT NULL DEFAULT ''",
    }))if(!materialColumns.has(name))db.exec(`ALTER TABLE hotspot_materials ADD COLUMN ${name} ${definition}`);
    const sourceColumns=new Set(db.prepare('PRAGMA table_info(hotspot_sources)').all().map((column)=>column.name));
    if(!sourceColumns.has('fetch_method'))db.exec("ALTER TABLE hotspot_sources ADD COLUMN fetch_method TEXT NOT NULL DEFAULT ''");
    if(!sourceColumns.has('quality_json'))db.exec("ALTER TABLE hotspot_sources ADD COLUMN quality_json TEXT NOT NULL DEFAULT ''");
    if(!sourceColumns.has('evidence_level'))db.exec("ALTER TABLE hotspot_sources ADD COLUMN evidence_level TEXT NOT NULL DEFAULT ''");
    const hotspotColumns=new Set(db.prepare('PRAGMA table_info(hotspots)').all().map((column)=>column.name));
    if(!hotspotColumns.has('source_group'))db.exec("ALTER TABLE hotspots ADD COLUMN source_group TEXT NOT NULL DEFAULT ''");
    if(!hotspotColumns.has('source_type'))db.exec("ALTER TABLE hotspots ADD COLUMN source_type TEXT NOT NULL DEFAULT ''");
    if(!hotspotColumns.has('source_name'))db.exec("ALTER TABLE hotspots ADD COLUMN source_name TEXT NOT NULL DEFAULT ''");
    if(!hotspotColumns.has('research_eligible'))db.exec("ALTER TABLE hotspots ADD COLUMN research_eligible INTEGER NOT NULL DEFAULT 1");
    // Migration：主题 target CHECK 放宽到 cover（SQLite 不能改 CHECK，重建两张主题表；幂等——新库 DDL 已含 cover）
    const themeTableSql=(name)=>db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name)?.sql||'';
    if(themeTableSql('theme_definitions').includes("CHECK(target IN ('article','social'))")||themeTableSql('theme_usage').includes("CHECK(target IN ('article','social'))")){
      db.exec('PRAGMA foreign_keys=OFF');
      try {
        if(themeTableSql('theme_usage').includes("CHECK(target IN ('article','social'))")){
          db.exec(`CREATE TABLE theme_usage_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            theme_id TEXT NOT NULL,
            version TEXT NOT NULL,
            target TEXT NOT NULL CHECK(target IN ('article','social','cover')),
            source TEXT NOT NULL,
            batch_id TEXT,
            candidate_row_id INTEGER,
            used_at TEXT NOT NULL
          )`);
          db.exec('INSERT INTO theme_usage_new (id,theme_id,version,target,source,batch_id,candidate_row_id,used_at) SELECT id,theme_id,version,target,source,batch_id,candidate_row_id,used_at FROM theme_usage');
          db.exec('DROP TABLE theme_usage');
          db.exec('ALTER TABLE theme_usage_new RENAME TO theme_usage');
        }
        if(themeTableSql('theme_definitions').includes("CHECK(target IN ('article','social'))")){
          db.exec(`CREATE TABLE theme_definitions_new (
            id TEXT PRIMARY KEY,
            owner_scope TEXT NOT NULL DEFAULT 'workspace',
            target TEXT NOT NULL CHECK(target IN ('article','social','cover')),
            label TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'user',
            active_version_id INTEGER,
            status TEXT NOT NULL DEFAULT 'draft',
            draft_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(active_version_id) REFERENCES theme_versions(id) ON DELETE SET NULL
          )`);
          db.exec('INSERT INTO theme_definitions_new (id,owner_scope,target,label,source,active_version_id,status,draft_json,created_at,updated_at) SELECT id,owner_scope,target,label,source,active_version_id,status,draft_json,created_at,updated_at FROM theme_definitions');
          db.exec('DROP TABLE theme_definitions');
          db.exec('ALTER TABLE theme_definitions_new RENAME TO theme_definitions');
        }
      } finally { db.exec('PRAGMA foreign_keys=ON'); }
    }
    db.exec(`UPDATE hotspots SET research_eligible=0 WHERE id IN (
      SELECT c.hotspot_id FROM candidates c
      JOIN candidate_tracks ct ON ct.candidate_row_id=c.id
      WHERE ct.output_mode IN ('wechat-experience','wechat-tutorial','wechat-custom-cards','xiaohongshu-custom-cards')
    )`);
    db.exec(`UPDATE hotspots SET research_eligible=0
      WHERE source_type='manual'
      AND (raw_json LIKE '%"notes":"自主写作（%' OR raw_json LIKE '%"notes":"自定义图文（%')`);
    const legacy=db.prepare("SELECT id,source,raw_json FROM hotspots WHERE source_group='' OR source_type='' OR source_name=''").all();
    const updateSource=db.prepare('UPDATE hotspots SET source=?,source_group=?,source_type=?,source_name=? WHERE id=?');
    for(const row of legacy) {
      let raw={}; try{raw=JSON.parse(row.raw_json);}catch{}
      const sourceGroup=raw.subreddit?'reddit':'rsshub';
      const sourceType=raw.subreddit?'reddit':/^\/twitter\/user\//i.test(raw.route||'')?'twitter':/^https?:/i.test(raw.route||'')?'direct':'rsshub';
      const identity=raw.subreddit?`r/${raw.subreddit}`:String(raw.route||row.source).replace(/[?&]limit=\d+/g,'').replace(/[?&]$/,'');
      const sourceKey=`${sourceType}:${identity}`;
      const sourceName=raw.feedLabel||(raw.subreddit?`r/${raw.subreddit}`:raw.route)||row.source;
      updateSource.run(sourceKey,sourceGroup,sourceType,sourceName,row.id);
    }
    const candidateCols=new Set(db.prepare('PRAGMA table_info(candidates)').all().map((col)=>col.name));
    if(!candidateCols.has('composite'))db.exec("ALTER TABLE candidates ADD COLUMN composite INTEGER NOT NULL DEFAULT 0");
    if(!candidateCols.has('hotspot_titles'))db.exec("ALTER TABLE candidates ADD COLUMN hotspot_titles TEXT NOT NULL DEFAULT ''");
    if(!candidateCols.has('dimension'))db.exec("ALTER TABLE candidates ADD COLUMN dimension TEXT NOT NULL DEFAULT 'event'");
    const linkTableExists=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='candidate_hotspots'").get();
    if(!linkTableExists)db.exec(`
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
      const oldIdx = db.prepare('SELECT "unique" FROM pragma_index_list(?) WHERE name=?').get('candidates','sqlite_autoindex_candidates_1');
      if(oldIdx) needsMigration=true;
    } catch{needsMigration=true;}
    if(needsMigration) {
      let cols=[];
      try{cols = db.prepare('PRAGMA index_info('+String.fromCharCode(39)+'sqlite_autoindex_candidates_1'+String.fromCharCode(39)+')').all();}catch{}
      if(cols.length===2&&cols.some(c=>c.name==='hotspot_id')) {
        try {
          db.exec('BEGIN TRANSACTION');
          db.prepare('INSERT INTO candidates (batch_id, hotspot_id, candidate_id, status, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)')
            .run('_mig_test_null','_MIG_TEST_S000','pooled',new Date().toISOString(),new Date().toISOString());
          db.prepare('DELETE FROM candidates WHERE batch_id=?').run('_mig_test_null');
          db.exec('COMMIT');
        } catch(e) {
          db.exec('ROLLBACK');
          db.exec('CREATE TABLE candidates_new (id INTEGER PRIMARY KEY AUTOINCREMENT,batch_id TEXT NOT NULL,hotspot_id INTEGER,candidate_id TEXT NOT NULL,pool_role TEXT NOT NULL DEFAULT '+String.fromCharCode(39)+'人工补选'+String.fromCharCode(39)+',risk_level TEXT NOT NULL DEFAULT '+String.fromCharCode(39)+'待评估'+String.fromCharCode(39)+',angle TEXT NOT NULL DEFAULT '+String.fromCharCode(39)+String.fromCharCode(39)+',thesis TEXT NOT NULL DEFAULT '+String.fromCharCode(39)+String.fromCharCode(39)+',h_score REAL,b_score REAL,p_score REAL,s_score REAL,d_score REAL,f_score REAL,status TEXT NOT NULL DEFAULT '+String.fromCharCode(39)+'pooled'+String.fromCharCode(39)+',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,composite INTEGER NOT NULL DEFAULT 0,hotspot_titles TEXT NOT NULL DEFAULT '+String.fromCharCode(39)+String.fromCharCode(39)+',UNIQUE(batch_id, candidate_id),FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE)');
          // Use explicit column names so old table's created_at/updated_at/composite/hotspot_titles map correctly
          db.exec('INSERT INTO candidates_new (id,batch_id,hotspot_id,candidate_id,pool_role,risk_level,angle,thesis,h_score,b_score,p_score,s_score,d_score,f_score,status,created_at,updated_at,composite,hotspot_titles) SELECT id,batch_id,hotspot_id,candidate_id,pool_role,risk_level,angle,thesis,h_score,b_score,p_score,s_score,d_score,f_score,status,created_at,updated_at,composite,hotspot_titles FROM candidates');
          db.exec('DROP TABLE candidates');
          db.exec('ALTER TABLE candidates_new RENAME TO candidates');
          db.exec('CREATE INDEX IF NOT EXISTS idx_candidates_batch ON candidates(batch_id)');
        }
      }
    }
    const finalCandidateCols=new Set(db.prepare('PRAGMA table_info(candidates)').all().map((col)=>col.name));
    if(!finalCandidateCols.has('distribution_lane'))db.exec("ALTER TABLE candidates ADD COLUMN distribution_lane TEXT NOT NULL DEFAULT '推荐池'");
    if(!finalCandidateCols.has('reader_stake'))db.exec("ALTER TABLE candidates ADD COLUMN reader_stake TEXT NOT NULL DEFAULT ''");
    if (!candidateTracksExisted) {
      const trackNow = new Date().toISOString();
      db.prepare(`INSERT OR IGNORE INTO candidate_tracks
        (candidate_row_id,track,status,score,pool_role,output_mode,selected_at,locked_at,updated_at)
        SELECT id,'article',status,f_score,pool_role,'',created_at,
          CASE WHEN status IN ('locked','drafting','review','preview','published') THEN updated_at ELSE NULL END,?
        FROM candidates`).run(trackNow);
    }
    const cardEditorialColumns=new Set(db.prepare('PRAGMA table_info(card_editorial_sessions)').all().map((column)=>column.name));
    if(!cardEditorialColumns.has('card_plan_json'))db.exec("ALTER TABLE card_editorial_sessions ADD COLUMN card_plan_json TEXT NOT NULL DEFAULT '[]'");
    if(!cardEditorialColumns.has('layout_style'))db.exec("ALTER TABLE card_editorial_sessions ADD COLUMN layout_style TEXT NOT NULL DEFAULT 'auto'");
    if(!cardEditorialColumns.has('composition_mode'))db.exec("ALTER TABLE card_editorial_sessions ADD COLUMN composition_mode TEXT NOT NULL DEFAULT 'template'");
    const artifactColumns=new Set(db.prepare('PRAGMA table_info(artifacts)').all().map((column)=>column.name));
    if(!artifactColumns.has('candidate_row_id'))db.exec('ALTER TABLE artifacts ADD COLUMN candidate_row_id INTEGER REFERENCES candidates(id) ON DELETE SET NULL');
    if(!artifactColumns.has('track'))db.exec("ALTER TABLE artifacts ADD COLUMN track TEXT NOT NULL DEFAULT ''");
    db.exec(`UPDATE artifacts SET candidate_row_id=(SELECT c.id FROM candidates c JOIN batches b ON b.id=c.batch_id
      WHERE (lower(replace(artifacts.file_path,'\\','/')) LIKE '%/social-cards/'||b.batch_date||'-'||lower(c.candidate_id)||'/%'
        OR lower(replace(artifacts.file_path,'\\','/')) LIKE '%/social-cards/'||lower(b.id)||'-'||lower(c.candidate_id)||'/%') LIMIT 1),track='social_cards'
      WHERE candidate_row_id IS NULL AND lower(replace(file_path,'\\','/')) LIKE '%/social-cards/%'`);
    // 图文池已改用独立 Social Fit 预选，清理旧文章研判产生的自动图文轨道；手动加入与正式图文预选不受影响。
    db.prepare("DELETE FROM candidate_tracks WHERE track='social_cards' AND pool_role='AI 图文推荐'").run();
}

export function runDatabaseMigrations(db, migrateSchema = () => applyWorkbenchSchema(db)) {
  if (!db || typeof db.exec !== 'function') throw new TypeError('数据库连接无效');
  if (typeof migrateSchema !== 'function') throw new TypeError('迁移定义无效');
  migrateSchema();
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) throw new Error(`数据库迁移后存在 ${violations.length} 项外键完整性错误`);
}
