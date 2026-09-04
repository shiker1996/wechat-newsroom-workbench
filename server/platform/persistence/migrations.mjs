import { applyWorkbenchSchema } from './workbench-schema.mjs';
export { applyWorkbenchSchema };

export const WORKBENCH_SCHEMA_VERSION = 37;

export function runDatabaseMigrations(db, migrateSchema) {
  if (!db || typeof db.exec !== 'function') throw new TypeError('数据库连接无效');
  if (arguments.length >= 2) {
    if (typeof migrateSchema !== 'function') throw new TypeError('迁移定义无效');
    migrateSchema();
  } else {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const recordedVersions = new Set(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => Number(row.version)));
    let applied = 0;
    while (recordedVersions.has(applied + 1)) applied += 1;
    // 兼容测试/历史库中间版本被删除的情况：高版本记录不能掩盖缺失的迁移，
    // 后续版本记录会在事务中重新写入，迁移始终按连续版本推进。
    const recordedMax = Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get().version || 0);
    if (recordedMax > applied) db.prepare('DELETE FROM schema_migrations WHERE version > ?').run(applied);
    if(applied>WORKBENCH_SCHEMA_VERSION)throw new Error(`数据库版本 ${applied} 高于当前支持版本 ${WORKBENCH_SCHEMA_VERSION}`);
    if(applied<1){
      db.exec('BEGIN IMMEDIATE');
      try{applyWorkbenchSchema(db);db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(1,?)').run(new Date().toISOString());db.exec('COMMIT');applied=1;}
      catch(error){db.exec('ROLLBACK');throw error;}
    }
    if(applied<2){db.exec('BEGIN IMMEDIATE');try{const columns=new Set(db.prepare('PRAGMA table_info(model_calls)').all().map((column)=>column.name));if(!columns.has('output_budget_json'))db.exec('ALTER TABLE model_calls ADD COLUMN output_budget_json TEXT');db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(2,?)').run(new Date().toISOString());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
    // v3：applyWorkbenchSchema 全程幂等（CREATE IF NOT EXISTS + 列存在性守卫），重放一次补齐
    // v1/v2 期间陆续加入的存量库补丁（如 agent_runs.allowed_capabilities_json、conversation_fact_attachments 等）
    if(applied<3){db.exec('BEGIN IMMEDIATE');try{applyWorkbenchSchema(db);db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(3,?)').run(new Date().toISOString());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
    // v4：model_calls 增加 output_text（模型原始输出留档，排查编辑室等业务决策更新问题）
    if(applied<4){db.exec('BEGIN IMMEDIATE');try{const columns=new Set(db.prepare('PRAGMA table_info(model_calls)').all().map((column)=>column.name));if(!columns.has('output_text'))db.exec('ALTER TABLE model_calls ADD COLUMN output_text TEXT');db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(4,?)').run(new Date().toISOString());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
    // v5：model_calls 增加 reasoning_text（thinking 内容落库，排查重复提问等对话决策问题）
    if(applied<5){db.exec('BEGIN IMMEDIATE');try{const columns=new Set(db.prepare('PRAGMA table_info(model_calls)').all().map((column)=>column.name));if(!columns.has('reasoning_text'))db.exec('ALTER TABLE model_calls ADD COLUMN reasoning_text TEXT');db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(5,?)').run(new Date().toISOString());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
    // v6：collection_sources 增加 dismissed 软删除标记（用户在采集源页删除的配置来源不被同步重建）
    if(applied<6){db.exec('BEGIN IMMEDIATE');try{const columns=new Set(db.prepare('PRAGMA table_info(collection_sources)').all().map((column)=>column.name));if(!columns.has('dismissed'))db.exec('ALTER TABLE collection_sources ADD COLUMN dismissed INTEGER NOT NULL DEFAULT 0');db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(6,?)').run(new Date().toISOString());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
    if(applied<7){db.exec('BEGIN IMMEDIATE');try{applyWorkbenchSchema(db);db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(7,?)').run(new Date().toISOString());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
    if(applied<8){db.exec('BEGIN IMMEDIATE');try{const columns=new Set(db.prepare('PRAGMA table_info(card_editorial_sessions)').all().map((column)=>column.name));if(!columns.has('storyboard_theme_snapshot_json'))db.exec("ALTER TABLE card_editorial_sessions ADD COLUMN storyboard_theme_snapshot_json TEXT NOT NULL DEFAULT '{}'");db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(8,?)').run(new Date().toISOString());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
    // v9：Social 模板运行指标增加主题、页面角色和结构重排校准字段。
    if(applied<9){db.exec('BEGIN IMMEDIATE');try{const columns=new Set(db.prepare('PRAGMA table_info(social_template_metrics)').all().map((column)=>column.name));
      if(!columns.has('theme_id'))db.exec("ALTER TABLE social_template_metrics ADD COLUMN theme_id TEXT NOT NULL DEFAULT ''");
      if(!columns.has('page_roles_json'))db.exec("ALTER TABLE social_template_metrics ADD COLUMN page_roles_json TEXT NOT NULL DEFAULT '{}'");
      if(!columns.has('structural_reflow_attempted'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN structural_reflow_attempted INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('structural_reflow_success'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN structural_reflow_success INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('structure_repair_count'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN structure_repair_count INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('text_repair_count'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN text_repair_count INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('content_plan_adjustment_count'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN content_plan_adjustment_count INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('pages_added'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN pages_added INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('pages_split'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN pages_split INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('pages_merged'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN pages_merged INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('blocks_moved'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN blocks_moved INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('fact_blocks_added'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN fact_blocks_added INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('plan_operation_counts_json'))db.exec("ALTER TABLE social_template_metrics ADD COLUMN plan_operation_counts_json TEXT NOT NULL DEFAULT '{}'");
      if(!columns.has('source_atom_loss_count'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN source_atom_loss_count INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('avg_utilization'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN avg_utilization REAL');
      if(!columns.has('rollout_profile_json'))db.exec("ALTER TABLE social_template_metrics ADD COLUMN rollout_profile_json TEXT NOT NULL DEFAULT '{}'");
      if(!columns.has('no_op_repair'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN no_op_repair INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('hard_gate_failure'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN hard_gate_failure INTEGER NOT NULL DEFAULT 0');
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(9,?)').run(new Date().toISOString());db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v10：Social 内容计划灰度指标统一落库。
    if(applied<10){db.exec('BEGIN IMMEDIATE');try{const columns=new Set(db.prepare('PRAGMA table_info(social_template_metrics)').all().map((column)=>column.name));
      if(!columns.has('content_plan_adjustment_count'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN content_plan_adjustment_count INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('pages_split'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN pages_split INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('pages_merged'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN pages_merged INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('blocks_moved'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN blocks_moved INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('fact_blocks_added'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN fact_blocks_added INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('plan_operation_counts_json'))db.exec("ALTER TABLE social_template_metrics ADD COLUMN plan_operation_counts_json TEXT NOT NULL DEFAULT '{}'");
      if(!columns.has('source_atom_loss_count'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN source_atom_loss_count INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('avg_utilization'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN avg_utilization REAL');
      if(!columns.has('rollout_profile_json'))db.exec("ALTER TABLE social_template_metrics ADD COLUMN rollout_profile_json TEXT NOT NULL DEFAULT '{}'");
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(10,?)').run(new Date().toISOString());db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v11：Social 补充装箱增加静态预估与浏览器审计对照指标。
    if(applied<11){db.exec('BEGIN IMMEDIATE');try{const columns=new Set(db.prepare('PRAGMA table_info(social_template_metrics)').all().map((column)=>column.name));
      if(!columns.has('joint_packing_audit_attempts'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN joint_packing_audit_attempts INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('joint_packing_mismatch_count'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN joint_packing_mismatch_count INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('joint_packing_browser_only_overflow'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN joint_packing_browser_only_overflow INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('joint_packing_static_only_overflow'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN joint_packing_static_only_overflow INTEGER NOT NULL DEFAULT 0');
      if(!columns.has('joint_packing_mean_delta'))db.exec('ALTER TABLE social_template_metrics ADD COLUMN joint_packing_mean_delta REAL');
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(11,?)').run(new Date().toISOString());db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v12：事件归并基座，补齐跨批次事件记录与报道归属表；DDL 本身保持幂等。
    if(applied<12){db.exec('BEGIN IMMEDIATE');try{applyWorkbenchSchema(db);db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(12,?)').run(new Date().toISOString());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
    // v13：人工校正审计层。只记录编辑决策，不直接改写自动归并结果。
    if(applied<13){db.exec('BEGIN IMMEDIATE');try{db.exec(`CREATE TABLE IF NOT EXISTS event_resolution_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      event_id TEXT NOT NULL DEFAULT '',
      decision_type TEXT NOT NULL CHECK(decision_type IN ('merge','split','misreport')),
      target_event_id TEXT NOT NULL DEFAULT '',
      hotspot_ids_json TEXT NOT NULL DEFAULT '[]',
      reason TEXT NOT NULL DEFAULT '',
      actor TEXT NOT NULL DEFAULT 'editor',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      reverted_at TEXT,
      FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_event_resolution_decisions_batch ON event_resolution_decisions(batch_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_event_resolution_decisions_event ON event_resolution_decisions(event_id,created_at);`);db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(13,?)').run(new Date().toISOString());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
    // v14：选题价值评分落库，兼容已存在的旧版 candidates 表。
    if(applied<14){db.exec('BEGIN IMMEDIATE');try{
      const columns=new Set(db.prepare('PRAGMA table_info(candidates)').all().map((column)=>column.name));
      if(!columns.has('topic_value'))db.exec('ALTER TABLE candidates ADD COLUMN topic_value REAL');
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(14,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v15：文章选题评分拆出事件价值 T、文章化质量 A，保留 topic_value 作为旧字段兼容。
    if(applied<15){db.exec('BEGIN IMMEDIATE');try{
      const columns=new Set(db.prepare('PRAGMA table_info(candidates)').all().map((column)=>column.name));
      if(!columns.has('event_value'))db.exec('ALTER TABLE candidates ADD COLUMN event_value REAL');
      if(!columns.has('article_value'))db.exec('ALTER TABLE candidates ADD COLUMN article_value REAL');
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(15,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v16：补齐旧版 candidates 表缺失的读者利益与选题评分列。
    // 部分存量库已记录到 v15，但从未经过包含 reader_stake_score 的完整建表迁移。
    if(applied<16){db.exec('BEGIN IMMEDIATE');try{
      const columns=new Set(db.prepare('PRAGMA table_info(candidates)').all().map((column)=>column.name));
      if(!columns.has('distribution_lane'))db.exec("ALTER TABLE candidates ADD COLUMN distribution_lane TEXT NOT NULL DEFAULT '推荐池'");
      if(!columns.has('reader_stake'))db.exec("ALTER TABLE candidates ADD COLUMN reader_stake TEXT NOT NULL DEFAULT ''");
      if(!columns.has('reader_stake_score'))db.exec('ALTER TABLE candidates ADD COLUMN reader_stake_score REAL');
      if(!columns.has('topic_value'))db.exec('ALTER TABLE candidates ADD COLUMN topic_value REAL');
      if(!columns.has('event_value'))db.exec('ALTER TABLE candidates ADD COLUMN event_value REAL');
      if(!columns.has('article_value'))db.exec('ALTER TABLE candidates ADD COLUMN article_value REAL');
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(16,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v17：将系统默认的 GitHub Search 旧 30 天窗口收敛到 7 天。
    // 只迁移 legacy-config 创建的默认来源，不覆盖用户通过 API 显式保存的自定义窗口。
    if(applied<17){db.exec('BEGIN IMMEDIATE');try{
      const rows=db.prepare("SELECT id,label,origin,config_json FROM collection_sources WHERE source_key='github:search'").all();
      for(const row of rows){
        let config={};try{config=JSON.parse(row.config_json||'{}');}catch{}
        const legacyDefault=Number(config.createdWithinDays)===30 && (row.origin==='legacy-config' || String(row.label||'').includes('最近 30 天'));
        if(!legacyDefault)continue;
        config.createdWithinDays=7;
        const label=String(row.label||'').replace('最近 30 天','最近 7 天');
        db.prepare('UPDATE collection_sources SET label=?,config_json=?,updated_at=? WHERE id=?').run(label,JSON.stringify(config),new Date().toISOString(),row.id);
      }
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(17,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v18：保存内容路线与评分资料状态，避免综合选题缺少 T/事实时伪造 0 分。
    if(applied<18){db.exec('BEGIN IMMEDIATE');try{
      const columns=new Set(db.prepare('PRAGMA table_info(candidates)').all().map((column)=>column.name));
      if(!columns.has('content_route'))db.exec("ALTER TABLE candidates ADD COLUMN content_route TEXT NOT NULL DEFAULT 'article'");
      if(!columns.has('score_status'))db.exec("ALTER TABLE candidates ADD COLUMN score_status TEXT NOT NULL DEFAULT 'ready'");
      if(!columns.has('score_warning'))db.exec("ALTER TABLE candidates ADD COLUMN score_warning TEXT NOT NULL DEFAULT ''");
      if(!columns.has('format'))db.exec("ALTER TABLE candidates ADD COLUMN format TEXT NOT NULL DEFAULT ''");
      if(!columns.has('material_type'))db.exec("ALTER TABLE candidates ADD COLUMN material_type TEXT NOT NULL DEFAULT ''");
      if(!columns.has('historical_type'))db.exec("ALTER TABLE candidates ADD COLUMN historical_type TEXT NOT NULL DEFAULT ''");
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(18,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v19：稳定事件保存内容分类、分类证据和文章/图文资格，供事件热榜与热点全景读取。
    if(applied<19){db.exec('BEGIN IMMEDIATE');try{
      const columns=new Set(db.prepare('PRAGMA table_info(event_records)').all().map((column)=>column.name));
      if(!columns.has('content_class'))db.exec("ALTER TABLE event_records ADD COLUMN content_class TEXT NOT NULL DEFAULT 'news_event'");
      if(!columns.has('classification_confidence'))db.exec('ALTER TABLE event_records ADD COLUMN classification_confidence REAL');
      if(!columns.has('classification_reason'))db.exec("ALTER TABLE event_records ADD COLUMN classification_reason TEXT NOT NULL DEFAULT ''");
      if(!columns.has('classification_evidence_json'))db.exec("ALTER TABLE event_records ADD COLUMN classification_evidence_json TEXT NOT NULL DEFAULT '[]'");
      if(!columns.has('classification_features_json'))db.exec("ALTER TABLE event_records ADD COLUMN classification_features_json TEXT NOT NULL DEFAULT '{}'");
      if(!columns.has('classification_missing_evidence_json'))db.exec("ALTER TABLE event_records ADD COLUMN classification_missing_evidence_json TEXT NOT NULL DEFAULT '[]'");
      if(!columns.has('article_eligible'))db.exec('ALTER TABLE event_records ADD COLUMN article_eligible INTEGER NOT NULL DEFAULT 1');
      if(!columns.has('social_eligible'))db.exec('ALTER TABLE event_records ADD COLUMN social_eligible INTEGER NOT NULL DEFAULT 1');
      if(!columns.has('default_route'))db.exec("ALTER TABLE event_records ADD COLUMN default_route TEXT NOT NULL DEFAULT 'editorial_review'");
      if(!columns.has('classification_status'))db.exec("ALTER TABLE event_records ADD COLUMN classification_status TEXT NOT NULL DEFAULT 'needs_review'");
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(19,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v20：候选保存内容分类快照和文章事实门禁结果，避免锁定后依赖事件重新分类。
    if(applied<20){db.exec('BEGIN IMMEDIATE');try{
      const columns=new Set(db.prepare('PRAGMA table_info(candidates)').all().map((column)=>column.name));
      if(!columns.has('content_class'))db.exec("ALTER TABLE candidates ADD COLUMN content_class TEXT NOT NULL DEFAULT 'news_event'");
      if(!columns.has('classification_status'))db.exec("ALTER TABLE candidates ADD COLUMN classification_status TEXT NOT NULL DEFAULT 'needs_review'");
      if(!columns.has('classification_confidence'))db.exec('ALTER TABLE candidates ADD COLUMN classification_confidence REAL');
      if(!columns.has('classification_reason'))db.exec("ALTER TABLE candidates ADD COLUMN classification_reason TEXT NOT NULL DEFAULT ''");
      if(!columns.has('classification_evidence_json'))db.exec("ALTER TABLE candidates ADD COLUMN classification_evidence_json TEXT NOT NULL DEFAULT '[]'");
      if(!columns.has('classification_features_json'))db.exec("ALTER TABLE candidates ADD COLUMN classification_features_json TEXT NOT NULL DEFAULT '{}'");
      if(!columns.has('article_eligible'))db.exec('ALTER TABLE candidates ADD COLUMN article_eligible INTEGER NOT NULL DEFAULT 1');
      if(!columns.has('article_eligibility_reason'))db.exec("ALTER TABLE candidates ADD COLUMN article_eligibility_reason TEXT NOT NULL DEFAULT ''");
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(20,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v21：保存自动主题路由的内容版本、候选排序和受控轮换结果；与实际渲染使用记录分离。
    if(applied<21){db.exec('BEGIN IMMEDIATE');try{
      db.exec(`CREATE TABLE IF NOT EXISTS theme_routing_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT,
        candidate_row_id INTEGER,
        candidate_key TEXT NOT NULL,
        target TEXT NOT NULL CHECK(target IN ('article','social','cover')),
        content_hash TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'auto' CHECK(mode IN ('auto','fallback','manual')),
        selected_theme_id TEXT NOT NULL,
        ranked_themes_json TEXT NOT NULL DEFAULT '[]',
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(batch_id,candidate_key,target,content_hash),
        FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE,
        FOREIGN KEY(candidate_row_id) REFERENCES candidates(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_theme_routing_recent ON theme_routing_decisions(target,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_theme_routing_batch ON theme_routing_decisions(batch_id,target,created_at DESC);`);
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(21,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v22：主题创建元数据与发布版本快照独立落库，保持视觉定义 JSON 契约纯净。
    if(applied<22){db.exec('BEGIN IMMEDIATE');try{
      db.exec(`CREATE TABLE IF NOT EXISTS theme_metadata (
        theme_id TEXT PRIMARY KEY,
        creation_method TEXT NOT NULL DEFAULT 'manual' CHECK(creation_method IN ('manual','ai','import','clone')),
        based_on_json TEXT NOT NULL DEFAULT '{}',
        intent_json TEXT NOT NULL DEFAULT '{}',
        ai_provenance_json TEXT NOT NULL DEFAULT '{}',
        design_summary_json TEXT NOT NULL DEFAULT '[]',
        repairs_json TEXT NOT NULL DEFAULT '[]',
        template_match_evidence_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(theme_id) REFERENCES theme_definitions(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS theme_version_metadata (
        theme_version_id INTEGER PRIMARY KEY,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY(theme_version_id) REFERENCES theme_versions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_theme_metadata_method ON theme_metadata(creation_method,updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_theme_version_metadata_created ON theme_version_metadata(created_at DESC);`);
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(22,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v23：自主写作素材池、栏目配置、内容计划与公众号导出复盘数据。
    if(applied<23){db.exec('BEGIN IMMEDIATE');try{
      db.exec(`CREATE TABLE IF NOT EXISTS content_columns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        writing_modes_json TEXT NOT NULL DEFAULT '["experience"]',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS writing_materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL DEFAULT 'text' CHECK(source_type IN ('conversation','reading','life','project','text')),
        title TEXT NOT NULL DEFAULT '',
        raw_text TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'inbox' CHECK(status IN ('inbox','developing','planned','archived')),
        tags_json TEXT NOT NULL DEFAULT '[]',
        evidence_json TEXT NOT NULL DEFAULT '[]',
        iteration_json TEXT NOT NULL DEFAULT '{}',
        assessment_json TEXT NOT NULL DEFAULT '{}',
        recommended_column_id INTEGER,
        next_teaser TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(recommended_column_id) REFERENCES content_columns(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_writing_materials_status_updated ON writing_materials(status,updated_at DESC);
      CREATE TABLE IF NOT EXISTS material_content_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        material_id INTEGER NOT NULL,
        column_id INTEGER,
        title_direction TEXT NOT NULL DEFAULT '',
        title_intent TEXT NOT NULL DEFAULT '',
        plan_type TEXT NOT NULL DEFAULT 'draft',
        planned_date TEXT,
        status TEXT NOT NULL DEFAULT 'idea' CHECK(status IN ('idea','planned','writing','done','cancelled')),
        teaser TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(material_id) REFERENCES writing_materials(id) ON DELETE CASCADE,
        FOREIGN KEY(column_id) REFERENCES content_columns(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_material_plans_date ON material_content_plans(planned_date,status);
      CREATE TABLE IF NOT EXISTS article_publications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER,
        document_id INTEGER,
        content_url TEXT NOT NULL DEFAULT '',
        published_at TEXT NOT NULL DEFAULT '',
        title_at_publish TEXT NOT NULL DEFAULT '',
        column_id INTEGER,
        content_pillar TEXT NOT NULL DEFAULT '',
        content_role TEXT NOT NULL DEFAULT '',
        distribution_lane TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','registered','awaiting_metrics','reviewed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(plan_id IS NOT NULL OR document_id IS NOT NULL),
        FOREIGN KEY(plan_id) REFERENCES material_content_plans(id) ON DELETE CASCADE,
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
        FOREIGN KEY(column_id) REFERENCES content_columns(id) ON DELETE SET NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_article_publications_plan ON article_publications(plan_id) WHERE plan_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_article_publications_document ON article_publications(document_id) WHERE document_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS wechat_import_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_name TEXT NOT NULL,
        import_type TEXT NOT NULL,
        format TEXT NOT NULL,
        row_count INTEGER NOT NULL DEFAULT 0,
        imported_at TEXT NOT NULL,
        error TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS wechat_user_growth_daily (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        import_batch_id INTEGER NOT NULL,
        stat_date TEXT NOT NULL,
        new_followers INTEGER,
        unfollowers INTEGER,
        net_followers INTEGER,
        total_followers INTEGER,
        UNIQUE(stat_date),
        FOREIGN KEY(import_batch_id) REFERENCES wechat_import_batches(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS wechat_article_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        import_batch_id INTEGER NOT NULL,
        notified INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL,
        published_date TEXT NOT NULL,
        reads INTEGER NOT NULL DEFAULT 0,
        shares INTEGER NOT NULL DEFAULT 0,
        follows_after_read INTEGER NOT NULL DEFAULT 0,
        delivery INTEGER,
        delivery_rate REAL,
        completion_rate REAL,
        content_url TEXT NOT NULL DEFAULT '',
        UNIQUE(notified,title,published_date),
        FOREIGN KEY(import_batch_id) REFERENCES wechat_import_batches(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS wechat_content_trends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        import_batch_id INTEGER NOT NULL,
        stat_date TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT '',
        reads INTEGER,
        shares INTEGER,
        original_reads INTEGER,
        favorites INTEGER,
        published_count INTEGER,
        article_channel TEXT NOT NULL DEFAULT '',
        article_title TEXT NOT NULL DEFAULT '',
        article_date TEXT NOT NULL DEFAULT '',
        article_reads INTEGER,
        article_read_share REAL,
        UNIQUE(stat_date,channel,article_channel,article_title),
        FOREIGN KEY(import_batch_id) REFERENCES wechat_import_batches(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS wechat_regular_reader_trends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        import_batch_id INTEGER NOT NULL,
        period TEXT NOT NULL UNIQUE,
        regular_readers INTEGER,
        regular_reader_rate REAL,
        FOREIGN KEY(import_batch_id) REFERENCES wechat_import_batches(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_wechat_article_date ON wechat_article_metrics(published_date,notified);
      CREATE INDEX IF NOT EXISTS idx_wechat_trend_date ON wechat_content_trends(stat_date);
      CREATE INDEX IF NOT EXISTS idx_wechat_import_type ON wechat_import_batches(import_type,imported_at DESC);`);
      db.prepare(`INSERT OR IGNORE INTO content_columns(name,description,writing_modes_json,created_at,updated_at)
        VALUES ('真实复盘','从项目、生活和工作经历中提炼可复用判断。','["experience"]',?,?)`).run(new Date().toISOString(), new Date().toISOString());
      db.prepare(`INSERT OR IGNORE INTO content_columns(name,description,writing_modes_json,created_at,updated_at)
        VALUES ('工具与实践','记录工具使用、工程过程和可复现的方法。','["experience","tutorial"]',?,?)`).run(new Date().toISOString(), new Date().toISOString());
      db.prepare(`INSERT OR IGNORE INTO content_columns(name,description,writing_modes_json,created_at,updated_at)
        VALUES ('读书与观察','把阅读和日常观察转成带有个人判断的内容。','["experience"]',?,?)`).run(new Date().toISOString(), new Date().toISOString());
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(23,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v24：文章发布元数据，统一承接内容计划和文章编辑器的公众号发布关联。
    if(applied<24){db.exec('BEGIN IMMEDIATE');try{
      db.exec(`CREATE TABLE IF NOT EXISTS article_publications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER,
        document_id INTEGER,
        content_url TEXT NOT NULL DEFAULT '',
        published_at TEXT NOT NULL DEFAULT '',
        title_at_publish TEXT NOT NULL DEFAULT '',
        column_id INTEGER,
        content_pillar TEXT NOT NULL DEFAULT '',
        content_role TEXT NOT NULL DEFAULT '',
        distribution_lane TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','registered','awaiting_metrics','reviewed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(plan_id IS NOT NULL OR document_id IS NOT NULL),
        FOREIGN KEY(plan_id) REFERENCES material_content_plans(id) ON DELETE CASCADE,
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
        FOREIGN KEY(column_id) REFERENCES content_columns(id) ON DELETE SET NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_article_publications_plan ON article_publications(plan_id) WHERE plan_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_article_publications_document ON article_publications(document_id) WHERE document_id IS NOT NULL;`);
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(24,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v25：本地文章产物索引与扫描记录，供公众号数据匹配正文和证据资产。
    if(applied<25){db.exec('BEGIN IMMEDIATE');try{
      db.exec(`CREATE TABLE IF NOT EXISTS article_artifact_index (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        artifact_id INTEGER,
        file_path TEXT NOT NULL UNIQUE,
        root_path TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        normalized_title TEXT NOT NULL DEFAULT '',
        article_date TEXT NOT NULL DEFAULT '',
        version_label TEXT NOT NULL DEFAULT '',
        content_url TEXT NOT NULL DEFAULT '',
        batch_id TEXT,
        document_id INTEGER,
        plan_id INTEGER,
        material_id INTEGER,
        column_id INTEGER,
        evidence_paths_json TEXT NOT NULL DEFAULT '[]',
        relation_method TEXT NOT NULL DEFAULT '',
        relation_confidence TEXT NOT NULL DEFAULT 'none',
        status TEXT NOT NULL DEFAULT 'indexed' CHECK(status IN ('indexed','ambiguous','unreadable')),
        scan_error TEXT NOT NULL DEFAULT '',
        file_size INTEGER NOT NULL DEFAULT 0,
        modified_at TEXT NOT NULL,
        indexed_at TEXT NOT NULL,
        FOREIGN KEY(artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL,
        FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE SET NULL,
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE SET NULL,
        FOREIGN KEY(plan_id) REFERENCES material_content_plans(id) ON DELETE SET NULL,
        FOREIGN KEY(material_id) REFERENCES writing_materials(id) ON DELETE SET NULL,
        FOREIGN KEY(column_id) REFERENCES content_columns(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_article_artifact_title ON article_artifact_index(normalized_title);
      CREATE INDEX IF NOT EXISTS idx_article_artifact_date ON article_artifact_index(article_date);
      CREATE INDEX IF NOT EXISTS idx_article_artifact_plan ON article_artifact_index(plan_id);
      CREATE TABLE IF NOT EXISTS article_artifact_index_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        roots_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('running','completed','partial','failed')),
        files_seen INTEGER NOT NULL DEFAULT 0,
        indexed_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        error_json TEXT NOT NULL DEFAULT '[]',
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_article_artifact_runs_started ON article_artifact_index_runs(started_at DESC);`);
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(25,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v26：公众号文章指标与本地文章产物的匹配、确认和重匹配日志。
    if(applied<26){db.exec('BEGIN IMMEDIATE');try{
      db.exec(`CREATE TABLE IF NOT EXISTS wechat_article_metric_matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric_id INTEGER NOT NULL UNIQUE,
        article_artifact_id INTEGER,
        match_method TEXT NOT NULL DEFAULT 'unmatched',
        confidence TEXT NOT NULL DEFAULT 'none' CHECK(confidence IN ('high','medium','low','none')),
        status TEXT NOT NULL DEFAULT 'unmatched' CHECK(status IN ('pending','confirmed','auto_confirmed','rejected','unmatched')),
        candidate_ids_json TEXT NOT NULL DEFAULT '[]',
        candidate_snapshot_json TEXT NOT NULL DEFAULT '[]',
        matched_title TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        confirmed_at TEXT,
        FOREIGN KEY(metric_id) REFERENCES wechat_article_metrics(id) ON DELETE CASCADE,
        FOREIGN KEY(article_artifact_id) REFERENCES article_artifact_index(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wechat_metric_matches_status ON wechat_article_metric_matches(status,updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_wechat_metric_matches_artifact ON wechat_article_metric_matches(article_artifact_id);
      CREATE TABLE IF NOT EXISTS wechat_article_match_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('auto_match','rematch','confirm','reject','reset')),
        from_artifact_id INTEGER,
        to_artifact_id INTEGER,
        match_method TEXT NOT NULL DEFAULT '',
        confidence TEXT NOT NULL DEFAULT 'none',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY(match_id) REFERENCES wechat_article_metric_matches(id) ON DELETE CASCADE,
        FOREIGN KEY(from_artifact_id) REFERENCES article_artifact_index(id) ON DELETE SET NULL,
        FOREIGN KEY(to_artifact_id) REFERENCES article_artifact_index(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wechat_match_logs_match ON wechat_article_match_logs(match_id,id DESC);`);
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(26,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v27：已匹配公众号文章的正文快照与证据资产关联。
    if(applied<27){db.exec('BEGIN IMMEDIATE');try{
      db.exec(`CREATE TABLE IF NOT EXISTS article_content_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric_id INTEGER NOT NULL,
        article_artifact_id INTEGER,
        source_kind TEXT NOT NULL CHECK(source_kind IN ('local_final','local_reviewed','local_humanized','local_draft','local_html','external_url')),
        source_path TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        final_url TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        content_chars INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ok' CHECK(status IN ('ok','error')),
        error TEXT NOT NULL DEFAULT '',
        fetched_at TEXT NOT NULL,
        is_current INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY(metric_id) REFERENCES wechat_article_metrics(id) ON DELETE CASCADE,
        FOREIGN KEY(article_artifact_id) REFERENCES article_artifact_index(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_article_content_current ON article_content_snapshots(metric_id,is_current,id DESC);
      CREATE INDEX IF NOT EXISTS idx_article_content_artifact ON article_content_snapshots(article_artifact_id,id DESC);
      CREATE TABLE IF NOT EXISTS article_evidence_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_artifact_id INTEGER NOT NULL,
        content_snapshot_id INTEGER,
        asset_path TEXT NOT NULL,
        asset_type TEXT NOT NULL CHECK(asset_type IN ('screenshot','log','code_diff','chart','failure','result','other')),
        label TEXT NOT NULL DEFAULT '',
        detected_method TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(article_artifact_id,asset_path),
        FOREIGN KEY(article_artifact_id) REFERENCES article_artifact_index(id) ON DELETE CASCADE,
        FOREIGN KEY(content_snapshot_id) REFERENCES article_content_snapshots(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_article_evidence_artifact ON article_evidence_assets(article_artifact_id,id DESC);
      CREATE INDEX IF NOT EXISTS idx_article_evidence_type ON article_evidence_assets(asset_type);`);
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(27,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v28：正文确定性特征与公众号创作反馈快照。
    if(applied<28){db.exec('BEGIN IMMEDIATE');try{
      db.exec(`CREATE TABLE IF NOT EXISTS article_content_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_snapshot_id INTEGER NOT NULL UNIQUE,
        metric_id INTEGER NOT NULL,
        extraction_version TEXT NOT NULL DEFAULT 'v1',
        features_json TEXT NOT NULL DEFAULT '{}',
        extracted_at TEXT NOT NULL,
        FOREIGN KEY(content_snapshot_id) REFERENCES article_content_snapshots(id) ON DELETE CASCADE,
        FOREIGN KEY(metric_id) REFERENCES wechat_article_metrics(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_article_content_features_metric ON article_content_features(metric_id,extracted_at DESC);
      CREATE TABLE IF NOT EXISTS content_feedback_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        generated_at TEXT NOT NULL,
        metric_window_start TEXT NOT NULL DEFAULT '',
        metric_window_end TEXT NOT NULL DEFAULT '',
        source_metric_ids_json TEXT NOT NULL DEFAULT '[]',
        source_batch_ids_json TEXT NOT NULL DEFAULT '[]',
        linked_article_count INTEGER NOT NULL DEFAULT 0,
        feature_count INTEGER NOT NULL DEFAULT 0,
        confidence TEXT NOT NULL DEFAULT 'low' CHECK(confidence IN ('low','medium','high')),
        topic_signals_json TEXT NOT NULL DEFAULT '[]',
        title_signals_json TEXT NOT NULL DEFAULT '[]',
        body_signals_json TEXT NOT NULL DEFAULT '[]',
        channel_signals_json TEXT NOT NULL DEFAULT '[]',
        recommendations_json TEXT NOT NULL DEFAULT '[]',
        unresolved_questions_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_content_feedback_generated ON content_feedback_snapshots(generated_at DESC);`);
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(28,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v29：公众号指标允许独立保存内容类型；未匹配记录保持待判定，不再默认归入文章。
    if(applied<29){db.exec('BEGIN IMMEDIATE');try{
      const columns = new Set(db.prepare('PRAGMA table_info(wechat_article_metric_matches)').all().map((column) => column.name));
      if (!columns.has('content_type')) db.exec("ALTER TABLE wechat_article_metric_matches ADD COLUMN content_type TEXT NOT NULL DEFAULT 'unknown' CHECK(content_type IN ('unknown','article','social'))");
      db.exec("UPDATE wechat_article_metric_matches SET content_type=CASE WHEN content_type='unknown' AND article_artifact_id IS NOT NULL AND EXISTS (SELECT 1 FROM article_artifact_index aa WHERE aa.id=wechat_article_metric_matches.article_artifact_id AND aa.artifact_type='图文发布文案') THEN 'social' WHEN content_type='unknown' AND article_artifact_id IS NOT NULL THEN 'article' ELSE content_type END WHERE content_type='unknown'");
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(29,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v30：公众号复盘反馈的 AI 调整草案，确认前只保存在数据库，不改变运行中的配置和技能。
    if(applied<30){db.exec('BEGIN IMMEDIATE');try{
      db.exec(`CREATE TABLE IF NOT EXISTS content_feedback_adjustment_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feedback_snapshot_id INTEGER,
        generated_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected')),
        provider TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        source_json TEXT NOT NULL DEFAULT '{}',
        changes_json TEXT NOT NULL DEFAULT '[]',
        warnings_json TEXT NOT NULL DEFAULT '[]',
        confirmed_at TEXT,
        FOREIGN KEY(feedback_snapshot_id) REFERENCES content_feedback_snapshots(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_content_feedback_adjustment_status ON content_feedback_adjustment_drafts(status,id DESC);`);
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(30,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v31：正文反馈按实际写作技能保留映射；没有映射时禁止反推技能配置。
    if(applied<31){db.exec('BEGIN IMMEDIATE');try{
      const columns = new Set(db.prepare('PRAGMA table_info(content_feedback_snapshots)').all().map((column) => column.name));
      if (!columns.has('writer_skill_evidence_json')) db.exec("ALTER TABLE content_feedback_snapshots ADD COLUMN writer_skill_evidence_json TEXT NOT NULL DEFAULT '[]'");
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(31,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v32：model_calls 增加原生工具调用留档，避免成功的工具轮次被误显示为无输出
    if(applied<32){db.exec('BEGIN IMMEDIATE');try{const columns=new Set(db.prepare('PRAGMA table_info(model_calls)').all().map((column)=>column.name));if(!columns.has('tool_calls_json'))db.exec('ALTER TABLE model_calls ADD COLUMN tool_calls_json TEXT');db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(32,?)').run(new Date().toISOString());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
    // v33：保存精简后的常规文章评分：研判价值 J 与竞争扣分 C。
    if(applied<33){db.exec('BEGIN IMMEDIATE');try{
      const columns=new Set(db.prepare('PRAGMA table_info(candidates)').all().map((column)=>column.name));
      if(!columns.has('research_value'))db.exec('ALTER TABLE candidates ADD COLUMN research_value REAL');
      if(!columns.has('competition_penalty'))db.exec('ALTER TABLE candidates ADD COLUMN competition_penalty REAL');
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(33,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v34：编辑会锁定时必须记录作者采用的研判主线，保证研判一路传入成稿。
    if(applied<34){db.exec('BEGIN IMMEDIATE');try{
      const columns=new Set(db.prepare('PRAGMA table_info(editorial_sessions)').all().map((column)=>column.name));
      if(!columns.has('research_basis'))db.exec("ALTER TABLE editorial_sessions ADD COLUMN research_basis TEXT NOT NULL DEFAULT ''");
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(34,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v35：保存作者在编辑室明确采用的事件内/事件间研判拓展点。
    if(applied<35){db.exec('BEGIN IMMEDIATE');try{
      const columns=new Set(db.prepare('PRAGMA table_info(editorial_sessions)').all().map((column)=>column.name));
      if(!columns.has('adopted_research_points_json'))db.exec("ALTER TABLE editorial_sessions ADD COLUMN adopted_research_points_json TEXT NOT NULL DEFAULT '[]'");
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(35,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v36：存量库的 extension_settings 约束增加供应商连接资源类型。
    // v35 之后的数据库不会再次执行 applyWorkbenchSchema，因此这里必须显式重建旧表约束。
    if(applied<36){db.exec('BEGIN IMMEDIATE');try{
      const extensionSettingsSql=String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='extension_settings'").get()?.sql||'');
      if(extensionSettingsSql && !/model-connection/i.test(extensionSettingsSql)){
        db.exec(`
          CREATE TABLE extension_settings_next (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            extension_type TEXT NOT NULL CHECK(extension_type IN ('skill','tool','collector','model-provider','model-connection','system')),
            extension_id TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'workspace', schema_version INTEGER NOT NULL DEFAULT 1,
            value_json TEXT NOT NULL DEFAULT '{}', configured INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'needs_configuration', config_hash TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(extension_type,extension_id,scope)
          );
          INSERT INTO extension_settings_next SELECT * FROM extension_settings;
          DROP TABLE extension_settings;
          ALTER TABLE extension_settings_next RENAME TO extension_settings;
          CREATE INDEX idx_extension_settings_type ON extension_settings(extension_type,extension_id);
        `);
      }
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(36,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
    // v37：素材简报实体。保存“素材可以从什么角度写”的提炼结果，与素材评估（系统推荐）分开，
    // 不与评估覆盖；一条素材可对应多份简报，作者确认后锁定为主题进入文章/图文生产。
    if(applied<37){db.exec('BEGIN IMMEDIATE');try{
      db.exec(`CREATE TABLE IF NOT EXISTS writing_material_briefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        material_ids_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed','superseded')),
        fact_summary_json TEXT NOT NULL DEFAULT '[]',
        context TEXT NOT NULL DEFAULT '',
        tension TEXT NOT NULL DEFAULT '',
        why_it_matters TEXT NOT NULL DEFAULT '',
        mainline_candidates_json TEXT NOT NULL DEFAULT '[]',
        selected_mainline_id TEXT NOT NULL DEFAULT '',
        confirmed_topic TEXT NOT NULL DEFAULT '',
        confirmed_thesis TEXT NOT NULL DEFAULT '',
        discussion_question TEXT NOT NULL DEFAULT '',
        audience TEXT NOT NULL DEFAULT '',
        evidence_refs_json TEXT NOT NULL DEFAULT '[]',
        missing_evidence_json TEXT NOT NULL DEFAULT '[]',
        recommended_formats_json TEXT NOT NULL DEFAULT '[]',
        author_experience_confirmed INTEGER NOT NULL DEFAULT 0,
        readiness_flags_json TEXT NOT NULL DEFAULT '[]',
        confirmed_by TEXT NOT NULL DEFAULT '',
        confirmed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_material_briefs_status ON writing_material_briefs(material_ids_json,status,updated_at DESC);
      CREATE TABLE IF NOT EXISTS writing_material_brief_materials (
        brief_id INTEGER NOT NULL,
        material_id INTEGER NOT NULL,
        PRIMARY KEY(brief_id, material_id),
        FOREIGN KEY(brief_id) REFERENCES writing_material_briefs(id) ON DELETE CASCADE,
        FOREIGN KEY(material_id) REFERENCES writing_materials(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_material_brief_materials_material ON writing_material_brief_materials(material_id,brief_id);`);
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(37,?)').run(new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}}
  }
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) throw new Error(`数据库迁移后存在 ${violations.length} 项外键完整性错误`);
}
