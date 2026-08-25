function plainSummary(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function socialCandidatePresentation(rawJson, factSheet, socialScore) {
  let raw = {}; try { raw = JSON.parse(rawJson || '{}'); } catch {}
  let facts = {}; try { facts = JSON.parse(factSheet?.data_json || '{}'); } catch {}
  const eventProfile = socialScore?.score?.scoreProfile === 'event';
  const scoreModel = socialScore?.score?.scoreModel || '';
  const description = plainSummary(raw.aiTags?.relevanceReason);
  const reasons = []; const channels = raw.discoveryChannels || []; const score = socialScore?.score || {};
  if (eventProfile) {
    if (Number(score.informationDensity) >= 14) reasons.push('信息密度高');
    if (Number(score.visualNarrative) >= 14) reasons.push('适合视觉叙事');
    if (Number(score.conflictEmotion) >= 10) reasons.push('冲突明确');
    if (Number(score.evidenceCompleteness) >= 10) reasons.push('证据较完整');
    return { repository_description: description, social_selection_reason: reasons.slice(0, 4).join(' · ') || '突发事件图文' };
  }
  if (scoreModel === 'g_social-v1') {
    const label = candidateClassLabel(socialScore?.score?.contentClass);
    const reasons = [label, Number(score.factSupport) >= 60 ? '事实支撑充分' : null, Number(score.visualPotential) >= 60 ? '适合图文表达' : null,
      Number(score.readerValue) >= 45 ? '读者价值明确' : null, Number(score.productionReadiness) >= 60 ? '生产资料较完整' : null,
      score.qualificationReason && score.qualificationStatus !== 'auto_eligible' ? score.qualificationReason : null].filter(Boolean);
    return { repository_description: description, social_selection_reason: reasons.slice(0, 4).join(' · ') || label };
  }
  if (channels.includes('trending') || raw.sourceType === 'trending') reasons.push('GitHub Trending');
  if (channels.includes('ai-search') || raw.sourceType === 'ai-search') reasons.push(raw.interestScore != null
    ? `AI 兴趣发现 · 兴趣契合 ${raw.interestScore}/10` : 'AI 兴趣发现');
  if (channels.includes('search')) reasons.push('近期增长发现');
  if (channels.includes('mentioned')) reasons.push('其他热点提及');
  const stars = Number(facts.stars?.value ?? raw.stars);
  if (Number.isFinite(stars) && stars > 0) reasons.push(`${stars.toLocaleString('en-US')} Stars`);
  const dimensions = [['工具定位清晰', score.toolClarity], ['使用场景明确', score.scenarioValue],
    ['适合演示', score.demonstrability], ['适合拆页', score.visualPotential], ['具备收藏价值', score.saveSearchValue]]
    .filter(([, value]) => Number(value) >= 12).sort((left, right) => Number(right[1]) - Number(left[1]));
  if (dimensions[0]) reasons.push(dimensions[0][0]);
  return { repository_description: description, social_selection_reason: reasons.slice(0, 4).join(' · ') };
}

function candidateClassLabel(contentClass) {
  return { github_project: 'GitHub 项目图文', news_event: '事件图文', open_source_technology: '开源技术图文', open_source_trend: '开源趋势图文' }[String(contentClass || '')] || '图文候选';
}

function displayCompositeTitle(candidate, hotspots) {
  const stored = String(candidate.hotspot_titles || '').trim();
  if (stored) {
    const separator = stored.indexOf(' || ');
    return (separator > 0 ? stored.substring(0, separator) : stored).substring(0, 60);
  }
  if (hotspots[0]?.title) return hotspots[0].title.substring(0, 40);
  return `综合 · ${candidate.candidate_id}`;
}

export class CandidateQueryService {
  constructor(db, repositories) {
    this.db = db;
    this.repositories = repositories;
  }

  list(batchId, track = 'article') {
    const normalizedTrack = this.repositories.candidates.normalizeTrack(track);
    const all = this.db.prepare(`SELECT c.*, h.title AS hotspot_title, h.url, h.source, h.source_group, h.source_type, h.source_name, h.category, h.market_scope, h.raw_json AS hotspot_raw_json,
      e.next_action, e.brief_status, e.editor_question, ct.status AS track_status, ct.score AS track_score,
      ct.pool_role AS track_pool_role, ct.output_mode, ct.selected_at, ct.locked_at
      FROM candidates c LEFT JOIN hotspots h ON h.id=c.hotspot_id
      LEFT JOIN editorial_sessions e ON e.candidate_row_id=c.id
      JOIN candidate_tracks ct ON ct.candidate_row_id=c.id AND ct.track=?
      WHERE c.batch_id=? ORDER BY COALESCE(ct.score,c.f_score,-1) DESC, c.id ASC`).all(normalizedTrack, batchId);
    return all.map((candidate) => {
      if (candidate.composite) {
        const hotspots = this.repositories.candidates.hotspots(candidate.id);
        candidate.hotspot_count = hotspots.length;
        candidate.hotspot_title = displayCompositeTitle(candidate, hotspots);
      }
      candidate.track = normalizedTrack;
      candidate.tracks = this.repositories.candidates.listTracks(candidate.id);
      if (normalizedTrack === 'social_cards') {
        candidate.social_score = this.repositories.socialCandidates.getScore(candidate.id);
        Object.assign(candidate, socialCandidatePresentation(candidate.hotspot_raw_json,
          this.repositories.socialCandidates.getFactSheet(candidate.id), candidate.social_score));
      }
      return candidate;
    });
  }

  get(id) {
    const candidate = this.db.prepare(`SELECT c.*, h.title AS hotspot_title, h.url, h.source, h.source_group, h.source_type, h.source_name, h.category, h.market_scope, h.published_at, h.raw_json AS hotspot_raw_json
      FROM candidates c LEFT JOIN hotspots h ON h.id=c.hotspot_id WHERE c.id=?`).get(id);
    if (!candidate) return null;
    candidate.tracks = this.repositories.candidates.listTracks(id);
    if (candidate.composite) candidate.hotspot_title = displayCompositeTitle(candidate,
      this.repositories.candidates.hotspots(candidate.id));
    candidate.editorial = this.repositories.editorial.getArticle(id);
    candidate.card_editorial = this.repositories.editorial.getCard(id);
    candidate.repository_fact_sheet = this.repositories.socialCandidates.getFactSheet(id);
    candidate.social_score = this.repositories.socialCandidates.getScore(id);
    candidate.materials = candidate.hotspot_id ? this.repositories.hotspots.listMaterials(candidate.hotspot_id) : [];
    Object.assign(candidate, socialCandidatePresentation(candidate.hotspot_raw_json,
      candidate.repository_fact_sheet, candidate.social_score));
    candidate.messages = this.repositories.editorial.listMessages(id);
    if (candidate.composite) {
      candidate.hotspots = this.repositories.candidates.hotspots(candidate.id);
      candidate.source_documents = candidate.hotspots.map((hotspot) => ({
        hotspot_id: hotspot.id, title: hotspot.title, url: hotspot.url,
        source: this.repositories.candidates.getHotspotSource(hotspot.id),
      }));
      candidate.source_document = candidate.source_documents.find((item) => item.source?.status === 'ok')?.source ?? null;
    } else {
      candidate.source_document = this.repositories.candidates.getHotspotSource(candidate.hotspot_id);
    }
    return candidate;
  }

  getByHotspot(batchId, hotspotId) {
    const row = this.db.prepare('SELECT id FROM candidates WHERE batch_id=? AND hotspot_id=? ORDER BY id LIMIT 1')
      .get(batchId, Number(hotspotId));
    return row ? this.get(row.id) : null;
  }
}
