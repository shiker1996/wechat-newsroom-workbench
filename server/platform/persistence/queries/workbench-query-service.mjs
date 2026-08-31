function repositoryKey(url, rawJson = '') {
  let raw = {};
  try { raw = JSON.parse(rawJson || '{}'); } catch {}
  const declared = String(raw.repository || '').trim().replace(/\.git$/i, '').toLowerCase();
  if (declared) return declared;
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.hostname.toLowerCase() !== 'github.com') return '';
    const parts = parsed.pathname.split('/').filter(Boolean).slice(0, 2);
    return parts.length === 2 ? parts.join('/').replace(/\.git$/i, '').toLowerCase() : '';
  } catch { return ''; }
}

export class WorkbenchQueryService {
  constructor(db, collaborators = {}) {
    this.db = db;
    this.getCandidate = collaborators.getCandidate || (() => null);
    this.candidateHotspots = collaborators.candidateHotspots || (() => []);
    this.latestActiveBatch = collaborators.latestActiveBatch || (() => null);
  }

  listFinalArticles({ week, month, limit = 200 } = {}) {
    const where = ["d.kind='final'"];
    const values = [];
    if (week) {
      const year = parseInt(week.slice(0, 4));
      const w = parseInt(week.slice(6));
      if (!isNaN(year) && !isNaN(w)) {
        const jan4 = new Date(year, 0, 4);
        const dow = jan4.getDay() || 7;
        const mondayW1 = new Date(jan4); mondayW1.setDate(jan4.getDate() - dow + 1);
        const monday = new Date(mondayW1); monday.setDate(mondayW1.getDate() + (w - 1) * 7);
        const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
        where.push('b.batch_date >= ? AND b.batch_date <= ?');
        values.push(
          `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`,
          `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`,
        );
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
    // 内容日历只把最终 HTML 视为图文已交付：AI 视觉版优先，程序版回退。
    // copy.txt 是发布文案，不代表图文页面已经生成，因此不能单独进入日历。
    const socialWhere = ["marker.track='social_cards'", "marker.name IN ('ai-beautified.html','my-design.html')", "marker.status='ready'", "marker.id=(SELECT fallback_marker.id FROM artifacts fallback_marker WHERE fallback_marker.track='social_cards' AND fallback_marker.batch_id=marker.batch_id AND fallback_marker.candidate_row_id=marker.candidate_row_id AND fallback_marker.name IN ('ai-beautified.html','my-design.html') AND fallback_marker.status='ready' ORDER BY CASE fallback_marker.name WHEN 'ai-beautified.html' THEN 0 ELSE 1 END,fallback_marker.id DESC LIMIT 1)"];
    const articleValues = [];
    const socialValues = [];
    if (month) {
      articleWhere.push("strftime('%Y-%m', COALESCE(b.batch_date,d.updated_at))=?");
      socialWhere.push("strftime('%Y-%m', COALESCE(b.batch_date,marker.modified_at))=?");
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
    const socialCards = this.db.prepare(`SELECT 'social_cards' AS content_type,
      COALESCE(ai.id,original.id,marker.id) AS id, marker.batch_id,
      marker.candidate_row_id, COALESCE(h.title,c.hotspot_titles,'图文内容') AS title,
      COALESCE(ai.status,original.status,marker.status) AS status,
      COALESCE(ai.modified_at,original.modified_at,marker.modified_at) AS updated_at, c.candidate_id,
      COALESCE(NULLIF(ct.pool_role,''),c.pool_role) AS pool_role, b.batch_date, b.title AS batch_title,
      COALESCE(h.title,c.hotspot_titles,'图文内容') AS hotspot_title
      FROM artifacts marker
      LEFT JOIN artifacts ai ON ai.track='social_cards' AND ai.name='ai-beautified.html' AND ai.status='ready'
        AND ai.batch_id=marker.batch_id AND ai.candidate_row_id=marker.candidate_row_id
      LEFT JOIN artifacts original ON original.track='social_cards' AND original.name='my-design.html' AND original.status='ready'
        AND original.batch_id=marker.batch_id AND original.candidate_row_id=marker.candidate_row_id
      LEFT JOIN candidates c ON c.id=marker.candidate_row_id
      LEFT JOIN candidate_tracks ct ON ct.candidate_row_id=c.id AND ct.track='social_cards'
      LEFT JOIN batches b ON b.id=marker.batch_id
      LEFT JOIN hotspots h ON h.id=c.hotspot_id
      WHERE ${socialWhere.join(' AND ')}`).all(...socialValues);
    return [...articles, ...socialCards]
      .sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')))
      .slice(0, limit);
  }

  findSimilarArticles(candidateId) {
    const candidate = this.getCandidate(candidateId);
    if (!candidate) return [];
    const keys = new Set();
    if (candidate.composite) {
      for (const hotspot of this.candidateHotspots(candidate.id)) {
        try {
          const tags = JSON.parse(hotspot.raw_json || '{}');
          if (tags.aiTags?.eventKey) keys.add(tags.aiTags.eventKey);
        } catch {}
      }
    } else if (candidate.hotspot_id) {
      const hotspot = this.db.prepare('SELECT raw_json FROM hotspots WHERE id=?').get(candidate.hotspot_id);
      try {
        const tags = JSON.parse(hotspot?.raw_json || '{}');
        if (tags.aiTags?.eventKey) keys.add(tags.aiTags.eventKey);
      } catch {}
    }
    const stopWords = new Set(['的', '了', '在', '是', '和', '与', '及', '被', '把', '从', '对', '到', '让', '用',
      'the', 'a', 'an', 'of', 'in', 'on', 'to', 'for', 'with', 'by', 'and', 'or', 'not', 'at', 'from', 'that', 'this', 'its', 'their']);
    const titleWords = new Set(candidate.hotspot_title?.toLowerCase()
      .split(/[\s,，。、；：·|()（）]+/).filter((word) => word.length > 1 && !stopWords.has(word)) || []);
    if (!keys.size && !titleWords.size) return [];
    const finals = this.db.prepare(`SELECT d.id, d.batch_id, d.candidate_row_id, d.title, d.visible_chars,
      d.updated_at, c.candidate_id, c.pool_role, b.batch_date, b.title AS batch_title,
      h.raw_json, h.title AS hotspot_title
      FROM documents d
      LEFT JOIN candidates c ON c.id=d.candidate_row_id
      LEFT JOIN batches b ON b.id=d.batch_id
      LEFT JOIN hotspots h ON h.id=c.hotspot_id
      WHERE d.kind='final' AND d.candidate_row_id IS NOT NULL AND d.candidate_row_id != ?
      ORDER BY d.updated_at DESC LIMIT 200`).all(candidateId);
    const results = [];
    for (const final of finals) {
      let score = 0; let matchedKey = ''; const matchedWords = [];
      if (keys.size && final.raw_json) {
        try {
          const tags = JSON.parse(final.raw_json || '{}');
          if (tags.aiTags?.eventKey && keys.has(tags.aiTags.eventKey)) { score += 80; matchedKey = tags.aiTags.eventKey; }
        } catch {}
      }
      const finalTitle = (final.hotspot_title || final.title || '').toLowerCase();
      for (const word of titleWords) if (finalTitle.includes(word)) { score += 15; matchedWords.push(word); }
      if (score >= 15) results.push({
        id: final.id, title: final.title || final.hotspot_title || '', batchDate: final.batch_date,
        batchTitle: final.batch_title, updatedAt: final.updated_at, candidateId: final.candidate_id,
        poolRole: final.pool_role, score, matchedKey, matchedWords: matchedWords.slice(0, 5),
      });
    }
    return results.sort((left, right) => right.score - left.score).slice(0, 5);
  }

  findSimilarSocialCards(candidateId) {
    const candidate = this.getCandidate(candidateId);
    if (!candidate) return [];
    const currentRepository = repositoryKey(candidate.url, candidate.hotspot_raw_json);
    const words = new Set(String(candidate.hotspot_title || '').toLowerCase()
      .split(/[\s,，。、；：·|()（）/\-_]+/).filter((word) => word.length > 2));
    const rows = this.db.prepare(`SELECT a.id AS artifact_id,a.candidate_row_id,a.modified_at,c.candidate_id,
      COALESCE(h.title,c.hotspot_titles,'图文内容') AS title,h.url,h.raw_json,b.batch_date,b.title AS batch_title
      FROM artifacts a JOIN candidates c ON c.id=a.candidate_row_id
      LEFT JOIN hotspots h ON h.id=c.hotspot_id LEFT JOIN batches b ON b.id=a.batch_id
      WHERE a.track='social_cards' AND a.name='my-design.html' AND a.status='ready'
        AND a.candidate_row_id IS NOT NULL AND a.candidate_row_id!=?
      ORDER BY a.modified_at DESC LIMIT 300`).all(candidateId);
    const matches = [];
    for (const row of rows) {
      const historicalRepository = repositoryKey(row.url, row.raw_json);
      let score = 0; let reason = ''; const matchedWords = [];
      if (currentRepository && historicalRepository === currentRepository) { score = 100; reason = '同一仓库'; }
      else {
        const title = String(row.title || '').toLowerCase();
        for (const word of words) if (title.includes(word)) { score += 15; matchedWords.push(word); }
        if (score >= 15) reason = `相似关键词：${matchedWords.slice(0, 3).join('、')}`;
      }
      if (score >= 15) matches.push({ artifactId: row.artifact_id, candidateRowId: row.candidate_row_id,
        candidateId: row.candidate_id, title: row.title, batchDate: row.batch_date, batchTitle: row.batch_title,
        updatedAt: row.modified_at, score, reason });
    }
    return matches.sort((left, right) => right.score - left.score
      || String(right.updatedAt).localeCompare(String(left.updatedAt))).slice(0, 5);
  }

  articleStats() {
    const byPeriod = this.db.prepare(`SELECT strftime('%Y-%W', d.updated_at) AS week,
      strftime('%Y-%m', d.updated_at) AS month, COUNT(*) AS count
      FROM documents d WHERE d.kind='final'
      GROUP BY week ORDER BY week DESC LIMIT 12`).all();
    const totalFinal = this.db.prepare("SELECT COUNT(*) AS n FROM documents WHERE kind='final'").get().n;
    const thisMonth = this.db.prepare(`SELECT COUNT(*) AS n FROM documents d
      LEFT JOIN batches b ON b.id=d.batch_id WHERE d.kind='final'
      AND strftime('%Y-%m', b.batch_date)=strftime('%Y-%m','now')`).get().n;
    const thisWeek = this.db.prepare(`SELECT COUNT(*) AS n FROM documents d
      LEFT JOIN batches b ON b.id=d.batch_id WHERE d.kind='final'
      AND strftime('%Y-%W', b.batch_date)=strftime('%Y-%W','now')`).get().n;
    const byRole = this.db.prepare(`SELECT c.pool_role, COUNT(*) AS count
      FROM documents d JOIN candidates c ON c.id=d.candidate_row_id
      WHERE d.kind='final' AND c.pool_role!=''
      GROUP BY c.pool_role ORDER BY count DESC`).all();
    return { totalFinal, thisMonth, thisWeek, byPeriod, byRole };
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

  listLogs({ limit = 100, logType } = {}) {
    const queries = [];
    // 统一日志各分支列数需保持一致：模型调用的详情字段在其他类型下以 NULL 占位
    const modelDetailCols = 'model, output_text, reasoning_text, prompt_tokens, completion_tokens, reasoning_tokens, estimated_input_tokens, latency_ms, compressed, output_budget_json, generation_snapshot_id';
    const nullDetailCols = modelDetailCols.split(', ').map((col) => `NULL AS ${col}`).join(', ');
    if (!logType || logType === 'ai') queries.push(`SELECT 'ai' AS log_type, CAST(id AS TEXT) AS id, batch_id, type AS subtype, provider, status, COALESCE(error,progress) AS message, created_at AS ts, ${nullDetailCols} FROM ai_runs`);
    if (!logType || logType === 'source') queries.push(`SELECT 'source' AS log_type, CAST(id AS TEXT) AS id, batch_id, source AS subtype, source AS provider, status, COALESCE(error,'') AS message, ended_at AS ts, ${nullDetailCols} FROM source_runs`);
    if (!logType || logType === 'model') queries.push(`SELECT 'model' AS log_type, CAST(id AS TEXT) AS id, COALESCE(batch_id,'') AS batch_id, purpose AS subtype, provider, status, COALESCE(error,'') AS message, created_at AS ts, ${modelDetailCols} FROM model_calls`);
    if (!queries.length) return [];
    return this.db.prepare(`${queries.join(' UNION ALL ')} ORDER BY ts DESC LIMIT ?`).all(limit);
  }
}
