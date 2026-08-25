import { applyWorkbenchSchema } from './workbench-schema.mjs';
export { applyWorkbenchSchema };

export const WORKBENCH_SCHEMA_VERSION = 20;

export function runDatabaseMigrations(db, migrateSchema) {
  if (!db || typeof db.exec !== 'function') throw new TypeError('数据库连接无效');
  if (arguments.length >= 2) {
    if (typeof migrateSchema !== 'function') throw new TypeError('迁移定义无效');
    migrateSchema();
  } else {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    let applied=Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get().version||0);
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
  }
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) throw new Error(`数据库迁移后存在 ${violations.length} 项外键完整性错误`);
}
