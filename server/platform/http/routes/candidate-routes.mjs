import fs from 'node:fs';
import path from 'node:path';
import { isPureProjectEvent, readDiscussionResearchContext, scoreCards } from '../../../features/research/index.mjs';
import { routeBreakingAnalysis } from '../../../features/articles/index.mjs';
import { buildCustomFactSheet, customFactMarkdown, customSourceUrl, socialRouteForContentClass } from '../../../features/social-cards/index.mjs';
import { createRepositoryCandidate } from '../../../features/social-cards/index.mjs';
import { extractLocalProjectPath, readLocalProjectViaRegistry as readLocalProject } from '../../integrations/local-project-reader.mjs';
import { resolveSkillToolPolicy } from '../../skills/pipeline-runtime.mjs';
import { attachInformationSearch } from '../../integrations/information-search.mjs';
import { resolveArticleStageSkills, resolveEntryWriterSkill } from '../../skills/entry-routing.mjs';
import { respond, customArticleFingerprint, createNdjsonSession } from '../route-helpers.mjs';
import { getToolRegistry } from '../../tools/index.mjs';
import { materialBriefPointLines, materialBriefPrelude } from '../../../features/content-planning/material-brief-service.mjs';
import { runTutorialAgentTurn, tutorialProjectAttachmentArguments } from '../../../features/articles/application/agent/tutorial-adapter.mjs';
import { getFactAttachment, selectConversationSearchAttachments } from '../../agent/fact-attachments.mjs';
import { runCustomSocialAgentTurn } from '../../../features/social-cards/application/agent/custom-social-adapter.mjs';
import { runWithThinkingSink } from '../../llm/gateway.mjs';

function readJsonFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function selectedWritingMaterialIds(input = {}) {
  const raw = Array.isArray(input.selectedMaterialIds)
    ? input.selectedMaterialIds
    : String(input.selectedMaterialIds || '').split(/[\s,，]+/).filter(Boolean);
  return [...new Set(raw.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))].slice(0, 20);
}

function resolveSelectedWritingMaterials(store, input = {}) {
  const ids = selectedWritingMaterialIds(input);
  const materials = ids.map((id) => store.getWritingMaterial(id));
  const missing = ids.filter((id, index) => !materials[index]);
  if (missing.length) throw new Error(`选中的素材不存在：${missing.join('、')}`);
  return materials;
}

function materialPointLines(materials = []) {
  return materials.flatMap((material) => {
    const title = String(material.title || '未命名素材').trim();
    const chunks = String(material.raw_text || '').split(/\r?\n|(?<=[。！？])/).map((value) => value.trim()).filter(Boolean).slice(0, 8);
    return chunks.map((value) => `【素材】${title}：${value.slice(0, 900)}`);
  }).slice(0, 24);
}

function mergeWritingMaterialPoints(points, materials) {
  const existing = Array.isArray(points) ? points.map((value) => String(value || '').trim()).filter(Boolean) : String(points || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  return [...existing, ...materialPointLines(materials).filter((value) => !existing.includes(value))];
}

function writingMaterialContext(materials = []) {
  return materials.map((material) => ({
    id: Number(material.id), title: String(material.title || '').trim(), source_type: material.source_type,
    captured_at: material.captured_at, tags: material.tags || [],
    raw_text: String(material.raw_text || '').slice(0, 6000),
  }));
}

// 已确认简报：作为文章/图文生产的一等输入。简报素材为源，简报要点承担文章结构。
function resolveConfirmedBrief(store, input = {}) {
  const briefId = Number(input.briefId || 0);
  if (!Number.isInteger(briefId) || briefId <= 0) return null;
  const brief = store.getWritingMaterialBrief(briefId);
  if (!brief || brief.status !== 'confirmed') return null;
  const points = materialBriefPointLines(brief);
  const preserveDraftPoints = (rawPoints) => {
    const existing = Array.isArray(rawPoints)
      ? rawPoints.map((value) => String(value || '').trim()).filter(Boolean)
      : String(rawPoints || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    return existing.length ? existing : (points.length
      ? points
      : mergeWritingMaterialPoints(rawPoints, brief.materialIds.map((id) => store.getWritingMaterial(id)).filter(Boolean)));
  };
  return {
    brief,
    points,
    materials: brief.materialIds.map((id) => store.getWritingMaterial(id)).filter(Boolean),
    prelude: materialBriefPrelude(brief),
    pointLines: preserveDraftPoints,
    preludeFor(inputDraft) {
      const draft = inputDraft && typeof inputDraft === 'object' ? inputDraft : {};
      return {
        topic: String(draft.topic || this.prelude.topic || '').trim(),
        thesis: String(draft.thesis || this.prelude.thesis || '').trim(),
        audience: String(draft.audience || this.prelude.audience || '').trim(),
      };
    },
  };
}

function saveSocialClassification(store, candidateId, route) {
  const values = [route.contentClass, 'snapshot', '手动从事件热榜加入图文池', new Date().toISOString(), candidateId];
  if (store.db?.prepare) store.db.prepare('UPDATE candidates SET content_class=?, classification_status=?, classification_reason=?, updated_at=? WHERE id=?').run(...values);
  else store.updateCandidate?.(candidateId, { content_class: route.contentClass, classification_status: 'snapshot', classification_reason: '手动从事件热榜加入图文池' });
}

function compositeScoreContext({ root, batchId, hotspots, store }) {
  const sourcesDir = path.join(root || '', 'topics', `${batchId}-orchestrated`, 'sources');
  const ranking = readJsonFile(path.join(sourcesDir, 'preselection-ranking.json'));
  const rankingByHotspot = new Map((ranking?.items || []).map((item) => [Number(item.hotspotId), item]));
  const items = (hotspots || []).map((hotspot) => ({
    hotspot,
    ranking: rankingByHotspot.get(Number(hotspot.id)) || null,
    source: store.getHotspotSource?.(hotspot.id) || null,
  }));
  const eventValues = items.map((item) => Number(item.ranking?.eventValue ?? item.ranking?.t ?? item.ranking?.eventHeatScore))
    .filter((value) => Number.isFinite(value));
  const facts = items.flatMap(({ hotspot, source }) => {
    let raw = {}; try { raw = JSON.parse(hotspot.raw_json || '{}'); } catch {}
    const tags = raw.aiTags || {};
    const excerpt = String(source?.description || source?.content || '').replace(/\s+/g, ' ').trim().slice(0, 700);
    return [`${hotspot.title || '(无标题)'}；分类：${hotspot.category || '待评估'}；关键词：${(tags.keywords || []).join('、')}${excerpt ? `；资料摘要：${excerpt}` : ''}`];
  });
  const category = items.map((item) => item.hotspot.category).find(Boolean) || '';
  const riskLevel = items.map((item) => item.ranking?.riskLevel || '').find((value) => value && value !== '待评估') || '待评估';
  const eventValue = eventValues.length ? Math.max(...eventValues) : null;
  return {
    category,
    riskLevel,
    eventValue,
    scoreStatus: eventValue == null ? 'needs_source_data' : 'ready',
    scoreWarning: eventValue == null ? '批次没有找到对应的事件热榜价值 T，请先补齐热榜或事实资料' : '',
    facts,
  };
}

export async function handleCandidateRoutes({ request, response, pathname, searchParams, root, config, store, body, json, models, aiJobs, localSecurity,
  batchWorkdir, articleWorkdir, socialCardWorkdir, writeUtf8, candidateRepositoryUrl, candidateEventGroups, attachEventConclusions,
  evaluateCustomCardGate }) {
  const similarMatch = pathname.match(/^\/api\/candidates\/(\d+)\/similar$/);
  if (similarMatch && request.method === 'GET') return respond(json, response, 200, store.findSimilarArticles(Number(similarMatch[1])));
  const similarSocialMatch = pathname.match(/^\/api\/candidates\/(\d+)\/similar-social$/);
  if (similarSocialMatch && request.method === 'GET') return respond(json, response, 200, store.findSimilarSocialCards(Number(similarSocialMatch[1])));

  const candidatesMatch = pathname.match(/^\/api\/batches\/([^/]+)\/candidates$/);
  if (candidatesMatch && request.method === 'GET') {
    try {
      const batchId = decodeURIComponent(candidatesMatch[1]); const track = searchParams.get('track') || 'article'; const kind = searchParams.get('kind') || 'all';
      let candidates = typeof store.listCandidateSummaries === 'function'
        ? store.listCandidateSummaries(batchId, track)
        : store.listCandidates(batchId, track);
      if (track === 'article' && kind !== 'all') {
        const independent = (item) => ['wechat-experience', 'wechat-tutorial'].includes(String(item.output_mode || ''));
        candidates = candidates.filter((item) => kind === 'independent' ? independent(item) : kind === 'hotspot' ? !independent(item) : true);
      }
      for (const candidate of candidates) candidate.member_hotspot_ids = candidate.composite ? store.candidateHotspots(candidate.id).map((item) => item.id) : [candidate.hotspot_id].filter(Boolean);
      if (track === 'article') candidates = attachEventConclusions(candidates, batchId);
      return respond(json, response, 200, candidates);
    } catch (error) { return respond(json, response, 400, { error: error.message }); }
  }
  const promoteArticleMatch = pathname.match(/^\/api\/candidates\/(\d+)\/promote-article$/);
  if (promoteArticleMatch && request.method === 'POST') {
    const candidate = store.getCandidate(Number(promoteArticleMatch[1]));
    if (!candidate) return respond(json, response, 404, { error: '候选不存在' });
    const input = await body(request);
    const contentClass = String(input.contentClass || input.content_class || '').trim();
    if (!['open_source_technology', 'open_source_trend'].includes(contentClass)) {
      return respond(json, response, 400, { error: '人工晋级只能选择 open_source_technology 或 open_source_trend' });
    }
    const evidence = Array.isArray(input.evidence) ? input.evidence.filter((item) => item && String(item.claim || '').trim()) : [];
    if (!evidence.length) return respond(json, response, 400, { error: '人工晋级必须提供至少一条可核验的技术或趋势证据' });
    const features = input.features && typeof input.features === 'object' ? input.features : {};
    const reason = String(input.reason || '').trim();
    if (!reason) return respond(json, response, 400, { error: '人工晋级必须填写分类理由' });
    store.db.prepare(`UPDATE candidates SET content_class=?, classification_status='manual', classification_confidence=1, classification_reason=?, classification_evidence_json=?, classification_features_json=?, article_eligible=1, article_eligibility_reason=?, content_route='article', score_status='ready', score_warning='', status='pooled', updated_at=? WHERE id=?`)
      .run(contentClass, reason, JSON.stringify(evidence), JSON.stringify(features), '人工晋级后仍需通过事实基座门禁', new Date().toISOString(), candidate.id);
    store.addCandidateTracks(candidate.id, ['article'], { status: 'pooled', pool_role: '人工晋级文章' });
    return respond(json, response, 200, store.getCandidate(candidate.id));
  }
  const breakingAnalysisMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ai\/breaking-analysis$/);
  if (breakingAnalysisMatch && request.method === 'POST') {
    const input = await body(request); const batchId = decodeURIComponent(breakingAnalysisMatch[1]); const batch = store.getBatch(batchId);
    if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    if (batch.batch_type !== 'breaking') return respond(json, response, 400, { error: '只有突发专题可以执行该分析' });
    return respond(json, response, 202, aiJobs.start({ batchId, provider: input.provider, type: 'breaking-analysis' }));
  }
  const breakingResultMatch = pathname.match(/^\/api\/batches\/([^/]+)\/breaking-analysis$/);
  if (breakingResultMatch && request.method === 'GET') { const result = store.getBreakingAnalysis(decodeURIComponent(breakingResultMatch[1])); return respond(json, response, result ? 200 : 404, result || { error: '尚未生成突发分析' }); }
  const breakingMaterialsMatch = pathname.match(/^\/api\/batches\/([^/]+)\/breaking-materials$/);
  if (breakingMaterialsMatch && request.method === 'POST') {
    try { const input = await body(request); const urls = Array.isArray(input.urls) ? input.urls : String(input.urls || '').split(/\r?\n/); return respond(json, response, 201, { materials: store.addBreakingMaterials(decodeURIComponent(breakingMaterialsMatch[1]), urls) }); }
    catch (error) { return respond(json, response, 400, { error: error.message }); }
  }
  const breakingRouteMatch = pathname.match(/^\/api\/batches\/([^/]+)\/breaking-analysis\/route$/);
  if (breakingRouteMatch && request.method === 'POST') {
    try { const input = await body(request); return respond(json, response, 200, routeBreakingAnalysis({ store, batchId: decodeURIComponent(breakingRouteMatch[1]), tracks: input.tracks })); }
    catch (error) { return respond(json, response, 400, { error: error.message }); }
  }
  if (candidatesMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(candidatesMatch[1]); const input = await body(request);
    if (!Array.isArray(input.hotspotIds)) return respond(json, response, 400, { error: 'hotspotIds 必须是数组' });
    const tracks = Array.isArray(input.tracks) && input.tracks.length ? input.tracks : ['article'];
    if (tracks.includes('article')) {
      const batch = store.getBatch(batchId);
      const projects = (batch?.hotspots || []).filter((hotspot) => input.hotspotIds.some((id) => Number(id) === Number(hotspot.id)))
        .filter((hotspot) => isPureProjectEvent({ representative_title: hotspot.title, title: hotspot.title, articles: [hotspot] }));
      if (projects.length) return respond(json, response, 409, { error: '纯项目默认只能进入图文池；如需写文章，请先补充技术机制或生态趋势证据并人工晋级分类', code: 'ARTICLE_ROUTE_REQUIRES_PROMOTION', hotspotIds: projects.map((item) => item.id) });
    }
    const added = store.addCandidates(batchId, input.hotspotIds, { tracks });
    if (tracks.includes('social_cards') && (input.socialContentClass || input.socialOutputMode)) {
      const contentClass = String(input.socialContentClass || (String(input.socialOutputMode || '').includes('technology') ? 'open_source_technology' : String(input.socialOutputMode || '').includes('trend') ? 'open_source_trend' : 'news_event'));
      const route = socialRouteForContentClass(contentClass);
      const socialCandidates = store.listCandidates(batchId, 'social_cards').filter((candidate) => input.hotspotIds.some((hotspotId) => Number(hotspotId) === Number(candidate.hotspot_id)));
      for (const candidate of socialCandidates) {
        saveSocialClassification(store, candidate.id, route);
        store.updateCandidateTrack(candidate.id, 'social_cards', { output_mode: route.outputMode, pool_role: input.poolRole || route.poolRole });
        store.saveCardEditorial(candidate.id, { ...store.getCardEditorial(candidate.id), output_mode: route.outputMode });
      }
    }
    if (tracks.includes('social_cards') && input.socialScoreDetails && input.hotspotIds.length === 1) { const candidate = added.find((item) => Number(item.hotspot_id) === Number(input.hotspotIds[0])); if (candidate) store.saveSocialScore(candidate.id, input.socialScoreDetails); }
    return respond(json, response, 201, store.listCandidates(batchId, input.track || tracks[0]));
  }
  const compositeMatch = pathname.match(/^\/api\/batches\/([^/]+)\/candidates\/composite$/);
  if (compositeMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(compositeMatch[1]); const input = await body(request);
    if (!Array.isArray(input.hotspotIds) || input.hotspotIds.length < 2) return respond(json, response, 400, { error: '综合选题至少需要 2 个热点' });
    const compositeBatch = store.getBatch(batchId);
    const compositeProjects = (compositeBatch?.hotspots || []).filter((hotspot) => input.hotspotIds.some((id) => Number(id) === Number(hotspot.id)))
      .filter((hotspot) => isPureProjectEvent({ representative_title: hotspot.title, title: hotspot.title, articles: [hotspot] }));
    if ((Array.isArray(input.tracks) ? input.tracks : ['article']).includes('article') && compositeProjects.length) {
      return respond(json, response, 409, { error: '综合选题包含纯项目，不能直接进入文章路线；请先人工晋级项目分类或仅选择非项目事件', code: 'ARTICLE_ROUTE_REQUIRES_PROMOTION', hotspotIds: compositeProjects.map((item) => item.id) });
    }
    const composite = store.createCompositeCandidate(batchId, input.hotspotIds, input);
    if ((Array.isArray(input.tracks) ? input.tracks : []).includes('social_cards') && composite && (input.socialContentClass || !candidateRepositoryUrl(composite))) {
      const route = socialRouteForContentClass(input.socialContentClass || 'news_event');
      saveSocialClassification(store, composite.id, route);
      store.updateCandidateTrack(composite.id, 'social_cards', { output_mode: route.outputMode, pool_role: input.poolRole || route.poolRole });
      store.saveCardEditorial(composite.id, { ...store.getCardEditorial(composite.id), output_mode: route.outputMode });
    }
    try {
      if (composite && models) {
        const providerConfig = models.config.providers[models.config.defaultProvider];
        const context = compositeScoreContext({ root, batchId, hotspots: composite.hotspots, store });
        const hotInfo = context.facts.slice(0, 5).map((fact) => `- ${fact}`).join('\n');
        const result = await models.complete({ purpose: 'composite-score', batchId, jsonMode: true, maxOutputTokens: Math.min(3000, providerConfig.maxOutputTokens), messages: [{ role: 'system', protected: true, content: '你是热点探索编辑。只能依据给出的事实生成综合选题临时评分；不要把缺失事实当作 0 分。返回严格JSON：{"bScores":{"angleUniqueness":0,"emotionSpread":0,"titleHook":0,"readerStakeScore":0,"factSupport":0},"hProfile":{"historicalType":"bigtech","fiveSenseCount":0,"fiveQuestionCount":0,"recommendationFit":0,"emotionTheme":0,"searchFriendly":0},"angle":"","thesis":""}' }, { role: 'user', protected: true, content: `综合选题标题：${composite.hotspot_title}\n事件价值 T：${context.eventValue == null ? '缺失（不要生成正式 F 分）' : context.eventValue}\n包含以下热点信息：\n${hotInfo}` }] });
        let parsed; try { parsed = JSON.parse(result.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { parsed = null; }
        if (parsed) {
          const card = { bScores: parsed.bScores || {}, hProfile: parsed.hProfile || { historicalType: 'bigtech', fiveSenseCount: 0, fiveQuestionCount: 0, recommendationFit: 0, emotionTheme: 0, searchFriendly: 0 }, angle: parsed.angle || '', thesis: parsed.thesis || '', source: { title: composite.hotspot_title, category: context.category, riskLevel: context.riskLevel, poolRole: '综合选题', hotspotId: null, composite: true, eventValue: context.eventValue, scoreStatus: context.scoreStatus, scoreWarning: context.scoreWarning } };
          const scored = scoreCards([card], { items: [] });
          if (scored.length) store.updateCandidate(composite.id, { h_score: scored[0].h, b_score: scored[0].b, p_score: scored[0].p.toFixed(1), research_value: scored[0].researchValue, s_score: scored[0].s, d_score: scored[0].d, competition_penalty: scored[0].competitionPenalty, f_score: scored[0].f, event_value: scored[0].eventValue, article_value: scored[0].a, content_route: scored[0].contentRoute, score_status: scored[0].scoreStatus, score_warning: scored[0].scoreWarning, angle: parsed.angle || '', thesis: parsed.thesis || '', status: scored[0].scoreStatus === 'needs_source_data' ? 'pooled' : 'scored' });
        }
      }
    } catch { /* auto-scoring is best-effort */ }
    return respond(json, response, 201, store.getCandidate(composite.id));
  }

  const customSocialChatMatch = pathname.match(/^\/api\/batches\/([^/]+)\/custom-social-chat\/stream$/);
  // agent-callsite: custom-social
  if (customSocialChatMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(customSocialChatMatch[1]); if (!store.getBatch(batchId)) return respond(json, response, 404, { error: '批次不存在' });
    const input = await body(request); const draft = input.draft && typeof input.draft === 'object' ? input.draft : {}; const projectPath = String(draft.localProjectPath || '').trim() || extractLocalProjectPath(input.answer);
    let chatBriefSource = null, chatMaterials = [];
    try { chatBriefSource = resolveConfirmedBrief(store, draft); chatMaterials = chatBriefSource ? chatBriefSource.materials : resolveSelectedWritingMaterials(store, draft); }
    catch { chatBriefSource = null; chatMaterials = []; }
    const chatDraft = chatMaterials.length || chatBriefSource ? {
      ...draft,
      points: chatBriefSource ? chatBriefSource.pointLines(draft.points) : mergeWritingMaterialPoints(draft.points, chatMaterials),
      ...(chatBriefSource ? { topic: draft.topic || chatBriefSource.prelude.topic, thesis: draft.thesis || chatBriefSource.prelude.thesis, audience: draft.audience || chatBriefSource.prelude.audience, briefId: Number(chatBriefSource.brief.id) } : {}),
      selectedMaterialContext: writingMaterialContext(chatMaterials),
    } : draft;
    if (projectPath && !localSecurity?.consume(request, 'local-project-read')) return respond(json, response, 403, { code: 'CONFIRMATION_REQUIRED', error: '请先确认允许读取该本地项目' });
    response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no', connection: 'keep-alive' });
    const stream=createNdjsonSession(request,response);const send=stream.send;
    try { const policy=await resolveSkillToolPolicy({workspaceRoot:root,skillId:'custom-card-storyboard'});const result=await runWithThinkingSink((delta)=>send({type:'thinking',text:delta}),async()=>runCustomSocialAgentTurn({gateway:models,store,registry:await getToolRegistry(),provider:input.provider,batchId,draft:chatDraft,history:Array.isArray(input.history)?input.history.slice(-40):[],answer:String(input.answer||''),projectPath,workspaceRoot:root,documentRoots:config.documentSearch?.roots||[],allowedCapabilities:policy.allowedCapabilities,budget:config.conversationAgent,onEvent:send}));if(result.reply)send({type:'assistant.delta',text:result.reply});send({type:'done',data:{reply:result.reply,formUpdates:result.formUpdates,ready:result.ready,usage:result.usage,model:result.model,agentRunId:result.agentRunId,toolCalls:result.toolCalls}}); }
    catch (error) { send({ type: 'error', error: error.message }); }
    stream.end(); return true;
  }
  const repositorySocialMatch = pathname.match(/^\/api\/batches\/([^/]+)\/repository-candidates$/);
  if (repositorySocialMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(repositorySocialMatch[1]); if (!store.getBatch(batchId)) return respond(json, response, 404, { error: '批次不存在' });
    const input = await body(request); try { return respond(json, response, 201, { candidate: createRepositoryCandidate({ store, batchId, url: input.url, channel: input.channel }) }); }
    catch (error) { return respond(json, response, 400, { error: `添加仓库图文失败：${error.message}` }); }
  }
  const customSocialMatch = pathname.match(/^\/api\/batches\/([^/]+)\/custom-social-candidates$/);
  if (customSocialMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(customSocialMatch[1]); const batch = store.getBatch(batchId); if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    const input = await body(request); const outputMode = String(input.channel || '').trim() === 'xiaohongshu' ? 'xiaohongshu-custom-cards' : 'wechat-custom-cards';
    try {
      const cachedAttachments=store.listConversationFactAttachments({batchId,entryPoint:'custom-social'}),materialCache=new Map(cachedAttachments.filter((item)=>item.capability==='cap_content_url_fetch').map((item)=>[item.data.final_url||item.data.url||item.data.requested_url,item.data]).filter(([url])=>url));
      const briefSource = resolveConfirmedBrief(store, input);
      const selectedWritingMaterials = briefSource ? briefSource.materials : resolveSelectedWritingMaterials(store, input);
      const briefPrelude = briefSource ? briefSource.preludeFor(input) : null;
      const cardInput = {
        ...input,
        ...(briefPrelude ? { topic: briefPrelude.topic, thesis: briefPrelude.thesis, audience: briefPrelude.audience, briefId: Number(briefSource.brief.id) } : {}),
        points: briefSource ? briefSource.pointLines(input.points) : mergeWritingMaterialPoints(input.points, selectedWritingMaterials),
      };
      const fact = await buildCustomFactSheet({ input: cardInput, root, materialCache, hasUserMaterialContext: Boolean(selectedWritingMaterials.length || briefSource) }); const toolPolicy = await resolveSkillToolPolicy({ workspaceRoot: root, skillId: 'custom-card-storyboard' });
      fact.selected_material_ids = selectedWritingMaterials.map((item) => Number(item.id)); if (briefSource) fact.brief_id = Number(briefSource.brief.id);
      for(const attachment of cachedAttachments){if(attachment.capability!=='cap_content_repository_inspect')continue;if(String(attachment.data?._agentQuery||'').trim()!==String(fact.topic||'').trim())continue;fact.repository_inspection=attachment.data;}
      for(const [capability,attachment] of selectConversationSearchAttachments(cachedAttachments,fact.topic)){const query=String(attachment.data?._agentQuery||fact.topic||'');if(capability==='cap_content_web_search')fact.web_search={query,provider:'conversation-agent',answer:attachment.data.answer||'',results:attachment.data.results||[],warnings:attachment.data.warnings||[],searched_at:attachment.updated_at};if(capability==='cap_content_news_search')fact.news_search={query,provider:'conversation-agent',answer:attachment.data.answer||'',results:attachment.data.results||[],warnings:attachment.data.warnings||[],searched_at:attachment.updated_at};if(capability==='cap_content_document_search')fact.document_search={query,provider:'conversation-agent',documents:attachment.data.documents||[],warnings:attachment.data.warnings||[],searched_at:attachment.updated_at};}
      await attachInformationSearch({ fact, input, root, toolContext: { store, batchId, skillId: 'custom-card-storyboard', allowedCapabilities: toolPolicy.allowedCapabilities }, documentRoots: config.documentSearch?.roots || [] });
      const materialUrls = (fact.materials || []).map((item) => item.url); const hotspot = store.addManualHotspot(batch.id, { title: fact.topic, url: materialUrls[0] || null, materialUrls, notes: `自定义图文（${fact.content_type_label}）`, researchEligible: false });
      if (!hotspot) throw new Error('手工热点创建失败'); store.addCandidates(batch.id, [hotspot.id], { tracks: ['social_cards'] });
      const candidate = store.listCandidates(batch.id, 'social_cards').find((item) => Number(item.hotspot_id) === Number(hotspot.id)); if (!candidate) throw new Error('自定义图文候选创建失败');
      store.updateCandidate(candidate.id, { angle: fact.topic, thesis: fact.thesis || fact.topic }); store.updateCandidateTrack(candidate.id, 'social_cards', { status: 'pooled', pool_role: '自定义图文', output_mode: outputMode });
      store.saveCardEditorial(candidate.id, { ...store.getCardEditorial(candidate.id), output_mode: outputMode, recommended_pages: fact.expected_pages, target_reader: fact.audience, status: 'DISCUSS' });
      const saved = store.saveRepositoryFactSheet(candidate.id, { repository: '', sourceUrl: customSourceUrl(candidate.id), status: 'ok', data: fact, checkedAt: fact.built_at });
      const dir = socialCardWorkdir(store.getBatch(batch.id), candidate); const jsonPath = path.join(dir, 'custom-fact-sheet.json'); const mdPath = path.join(dir, 'fact-sheet.md');
      const jsonFile = writeUtf8(jsonPath, JSON.stringify(fact, null, 2)); const mdFile = writeUtf8(mdPath, customFactMarkdown(fact));
      store.upsertArtifact({ batchId: batch.id, kind: '自定义事实基座', name: path.basename(jsonPath), path: jsonPath, ...jsonFile }); store.upsertArtifact({ batchId: batch.id, kind: '图文事实清单', name: path.basename(mdPath), path: mdPath, ...mdFile });
      const editorial = store.getCardEditorial(candidate.id); return respond(json, response, 201, { candidate: store.getCandidate(candidate.id), facts: saved, gate: evaluateCustomCardGate(candidate, saved, editorial) });
    } catch (error) { return respond(json, response, 400, { error: `创建自定义图文失败：${error.message}` }); }
  }
  if (pathname === '/api/tools/local-project/read' && request.method === 'POST') {
    if (!localSecurity?.consume(request, 'local-project-read')) return respond(json, response, 403, { code: 'CONFIRMATION_REQUIRED', error: '请先确认允许读取该本地项目' });
    const input = await body(request); try { const project = await readLocalProject(input.path, { toolContext: { store } }); return respond(json, response, 200, { root: project.root, summary: project.summary, files: project.files.map(({ path: filePath, size, truncated }) => ({ path: filePath, size, truncated })), skipped: project.skipped, truncated: project.truncated }); }
    catch (error) { return respond(json, response, 400, { error: `读取本地项目失败：${error.message}` }); }
  }
  const tutorialChatMatch = pathname.match(/^\/api\/batches\/([^/]+)\/tutorial-chat\/stream$/);
  // agent-callsite: independent-writing
  if (tutorialChatMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(tutorialChatMatch[1]); if (!store.getBatch(batchId)) return respond(json, response, 404, { error: '批次不存在' });
    const input = await body(request); const tutorialBriefSource = resolveConfirmedBrief(store, input.draft && typeof input.draft === 'object' ? input.draft : {});
    let selectedWritingMaterials;
    try { selectedWritingMaterials = tutorialBriefSource ? tutorialBriefSource.materials : resolveSelectedWritingMaterials(store, input.draft && typeof input.draft === 'object' ? input.draft : {}); }
    catch (error) { return respond(json, response, 400, { error: error.message }); }
    const rawDraft = input.draft && typeof input.draft === 'object' ? { ...input.draft } : {};
    const draft = tutorialBriefSource || selectedWritingMaterials.length
      ? {
          ...rawDraft,
          points: tutorialBriefSource ? tutorialBriefSource.pointLines(rawDraft.points) : mergeWritingMaterialPoints(rawDraft.points, selectedWritingMaterials),
          ...(tutorialBriefSource ? { topic: rawDraft.topic || tutorialBriefSource.prelude.topic, thesis: rawDraft.thesis || tutorialBriefSource.prelude.thesis, audience: rawDraft.audience || tutorialBriefSource.prelude.audience, briefId: Number(tutorialBriefSource.brief.id) } : {}),
          selectedMaterialContext: writingMaterialContext(selectedWritingMaterials),
        }
      : rawDraft;
    const suppliedPath = String(draft.localProjectPath || '').trim() || extractLocalProjectPath(input.answer); const tutorialMode = String(draft.articleMode || '').trim() === 'tutorial' || Boolean(suppliedPath) || /教程|项目|仓库/.test(String(input.answer || '')); const detectedPath = tutorialMode ? suppliedPath : '';
    if (detectedPath && !localSecurity?.consume(request, 'local-project-read')) return respond(json, response, 403, { code: 'CONFIRMATION_REQUIRED', error: '请先确认允许读取该本地项目' });
    let projectContext = null; const projectReadError = ''; if (detectedPath) draft.localProjectPath = detectedPath;
    response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no', connection: 'keep-alive' }); const stream=createNdjsonSession(request,response);const send=stream.send;
    try { const policy=await resolveSkillToolPolicy({workspaceRoot:root,skillId:String(draft.articleMode||'')==='experience'?'wechat-mp-personal-writing':'wechat-mp-tutorial'});const result=await runWithThinkingSink((delta)=>send({type:'thinking',text:delta}),async()=>runTutorialAgentTurn({gateway:models,store,registry:await getToolRegistry(),provider:input.provider,batchId,draft,history:Array.isArray(input.history)?input.history:[],answer:String(input.answer||''),projectPath:detectedPath,workspaceRoot:root,documentRoots:config.documentSearch?.roots||[],allowedCapabilities:policy.allowedCapabilities,budget:config.conversationAgent,onEvent:send}));projectContext=result.projectContext;if(result.reply)send({type:'assistant.delta',text:result.reply});send({type:'done',data:{...result,projectContext:undefined,project:projectContext?{root:detectedPath,summary:projectContext.summary,files:projectContext.files.map((item)=>item.path),truncated:projectContext.truncated}:null,projectReadError}}); }
    catch (error) { send({ type: 'error', error: error.message }); } stream.end(); return true;
  }
  return handleIndependentCreation({ request, response, pathname, root, config, store, body, json, aiJobs, articleWorkdir, writeUtf8, readLocalProject, resolveSkillToolPolicy, resolveArticleStageSkills, resolveEntryWriterSkill, buildCustomFactSheet, attachInformationSearch, customArticleFingerprint, candidateEventGroups, localSecurity });
}

async function handleIndependentCreation({ request, response, pathname, root, config, store, body, json, aiJobs, articleWorkdir, writeUtf8, readLocalProject, resolveSkillToolPolicy, resolveArticleStageSkills, resolveEntryWriterSkill, buildCustomFactSheet, attachInformationSearch, customArticleFingerprint, candidateEventGroups, localSecurity }) {
  const tutorialMatch = pathname.match(/^\/api\/batches\/([^/]+)\/(?:custom-articles|tutorials)$/);
  if (tutorialMatch && request.method === 'GET') {
    const batchId = decodeURIComponent(tutorialMatch[1]); if (!store.getBatch(batchId)) return respond(json, response, 404, { error: '批次不存在' });
    const projects = store.listCustomArticleProjects(batchId).map((item) => ({ ...item, project_status: item.document_id ? 'draft_ready' : item.job_status === 'running' ? 'generating' : ['failed', 'interrupted'].includes(item.job_status) ? 'failed' : 'ready_to_generate' }));
    return respond(json, response, 200, projects);
  }
  if (tutorialMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(tutorialMatch[1]); const batch = store.getBatch(batchId); if (!batch) return respond(json, response, 404, { error: '批次不存在' }); const input = await body(request);
    try {
      const articleMode = String(input.articleMode || 'tutorial').trim() === 'experience' ? 'experience' : 'tutorial';
      const briefSource = resolveConfirmedBrief(store, input);
      const selectedWritingMaterials = briefSource ? briefSource.materials : resolveSelectedWritingMaterials(store, input);
      const briefPrelude = briefSource ? briefSource.preludeFor(input) : null;
      const factInput = {
        ...input,
        ...(briefPrelude ? { topic: briefPrelude.topic, thesis: briefPrelude.thesis, audience: briefPrelude.audience, briefId: Number(briefSource.brief.id) } : {}),
        points: briefSource ? briefSource.pointLines(input.points) : input.points,
      };
      if (articleMode === 'tutorial' && String(input.localProjectPath || '').trim() && !localSecurity?.consume(request, 'local-project-read')) return respond(json, response, 403, { code: 'CONFIRMATION_REQUIRED', error: '请先确认允许读取该本地项目' });
      const recommendedSkillId = articleMode === 'experience' ? 'wechat-mp-personal-writing' : 'wechat-mp-tutorial';
      const skillSelection = await resolveEntryWriterSkill({ workspaceRoot: root, entryPoint: 'independent-writing', contentType: articleMode, requestedSkillId: String(input.skillId || ''), recommendedSkillId });
      const stageSelections = await resolveArticleStageSkills({ workspaceRoot: root, entryPoint: 'independent-writing', requested: input.stageSkills && typeof input.stageSkills === 'object' ? input.stageSkills : {} });
      const fingerprint = customArticleFingerprint(batchId, input); const requestId = String(input.creationRequestId || fingerprint).trim();
      let creation = store.findCustomArticleRequest(batchId, { requestId, fingerprint }) || store.createCustomArticleRequest({ batchId, requestId, fingerprint });
      if (creation?.candidate_row_id) { const candidate = store.getCandidate(creation.candidate_row_id); let job = creation.latest_job_id ? aiJobs.get(creation.latest_job_id) : null; if (candidate && !job) { job = aiJobs.start({ batchId, candidateId: candidate.id, provider: input.provider, type: 'tutorial', skillSelection, stageSelections }); store.updateCustomArticleRequest(creation.id, { latestJobId: job.id }); } if (candidate && job) return respond(json, response, 200, { ...job, candidate, reused: true }); }
      let project = null; if (articleMode === 'tutorial' && String(input.localProjectPath || '').trim()) { const cached=getFactAttachment(store,{batchId,capability:'cap_filesystem_project_read',arguments:tutorialProjectAttachmentArguments(input.localProjectPath)});if(cached)project={root:String(input.localProjectPath).trim(),...cached.data};else{const toolPolicy = await resolveSkillToolPolicy({ workspaceRoot: root, skillId: skillSelection.selectedSkill }); project = await readLocalProject(input.localProjectPath, { toolContext: { store, batchId, skillId: skillSelection.selectedSkill, allowedCapabilities: toolPolicy.allowedCapabilities } });} }
      const cachedAttachments=store.listConversationFactAttachments({batchId}),materialCache=new Map(cachedAttachments.filter((item)=>item.capability==='cap_content_url_fetch').map((item)=>[item.data.final_url||item.data.url||item.data.requested_url,item.data]).filter(([url])=>url));
      const fact = await buildCustomFactSheet({ input: { ...factInput, content_type: articleMode === 'experience' ? 'opinion' : 'tutorial', scenario: input.environment }, root, hasUserMaterialContext: Boolean(project || selectedWritingMaterials.length || briefSource),materialCache }); fact.article_mode = articleMode; fact.environment = String(input.environment || '').trim(); fact.selected_material_ids = selectedWritingMaterials.map((item) => Number(item.id)); if (briefSource) fact.brief_id = Number(briefSource.brief.id); fact.writing_materials = writingMaterialContext(selectedWritingMaterials);
      fact.prerequisites = String(input.prerequisites || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean); fact.expected_results = String(input.expected_results || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean); fact.common_errors = String(input.common_errors || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      if (project) fact.local_project = { root: project.root, files: project.files.map(({ path: filePath, size, excerpt, truncated }) => ({ path: filePath, size, excerpt, truncated })), summary: project.summary, truncated: project.truncated };
      if (articleMode === 'tutorial' && !fact.environment) throw new Error('请填写实际运行环境或版本边界'); if (articleMode === 'tutorial' && fact.steps.length < 2) throw new Error('教程步骤至少需要 2 步'); if (articleMode === 'experience' && !fact.thesis) throw new Error('心得经验文章需要明确核心观点');
      if (fact.materials.some((item) => item.status !== 'ok')) throw new Error(`素材抓取失败：${fact.materials.filter((item) => item.status !== 'ok').map((item) => item.url).join('、')}`);
      for(const [capability,attachment] of selectConversationSearchAttachments(store.listConversationFactAttachments({batchId}),fact.topic)){const query=String(attachment.data?._agentQuery||fact.topic||'');if(capability==='cap_content_web_search')fact.web_search={query,provider:'conversation-agent',answer:attachment.data.answer||'',results:attachment.data.results||[],warnings:attachment.data.warnings||[],searched_at:attachment.updated_at};if(capability==='cap_content_news_search')fact.news_search={query,provider:'conversation-agent',answer:attachment.data.answer||'',results:attachment.data.results||[],warnings:attachment.data.warnings||[],searched_at:attachment.updated_at};if(capability==='cap_content_document_search')fact.document_search={query,provider:'conversation-agent',documents:attachment.data.documents||[],warnings:attachment.data.warnings||[],searched_at:attachment.updated_at};}
      const toolPolicy = await resolveSkillToolPolicy({ workspaceRoot: root, skillId: skillSelection.selectedSkill }); await attachInformationSearch({ fact, input, root, toolContext: { store, batchId, skillId: skillSelection.selectedSkill, allowedCapabilities: toolPolicy.allowedCapabilities }, documentRoots: config.documentSearch?.roots || [] });
      const materialUrls = fact.materials.map((item) => item.url); const hotspot = store.addManualHotspot(batchId, { title: fact.topic, url: materialUrls[0] || null, materialUrls, notes: `自主写作（${articleMode === 'experience' ? '心得经验' : '使用教程'}）${selectedWritingMaterials.length ? ` · 素材入箱 ${selectedWritingMaterials.map((item) => item.id).join('、')}` : ''}`, researchEligible: false }); store.addCandidates(batchId, [hotspot.id], { tracks: ['article'] });
      const candidate = store.listCandidates(batchId, 'article').find((item) => Number(item.hotspot_id) === Number(hotspot.id)); if (!candidate) throw new Error('自主写作项目创建失败'); store.updateCandidate(candidate.id, { angle: articleMode === 'experience' ? `经验分享：${fact.topic}` : `实操教程：${fact.topic}`, thesis: articleMode === 'experience' ? fact.thesis : `帮助 ${fact.audience || '目标读者'} 在 ${fact.environment} 完成 ${fact.topic}`, status: 'locked' }); store.updateCandidateTrack(candidate.id, 'article', { status: 'locked', pool_role: '自主写作', output_mode: articleMode === 'experience' ? 'wechat-experience' : 'wechat-tutorial' }); for (const material of selectedWritingMaterials) store.updateWritingMaterial(material.id, { status: 'developing' });
      const experiences = fact.points.filter((item) => item.source_level === 'author_experience').map((item) => item.text).join('\n'); const facts = fact.points.filter((item) => item.source_level !== 'model_suggestion').map((item) => item.text).join('\n'); store.saveEditorial(candidate.id, { editor_question: '', confirmed_facts: facts, author_opinions: articleMode === 'experience' ? fact.thesis : '', confirmed_experiences: experiences, rejected_angles: '', open_questions: '', forbidden_claims: '不得将模型建议写成实测或确定结果，不得虚构作者经历', next_action: 'WRITE_NOW', experience_required: articleMode === 'experience' || Boolean(experiences), brief_status: 'LOCKED' });
      const dir = articleWorkdir(batch, candidate); const factPath = path.join(dir, '01-tutorial-fact-base.json'); const briefPath = path.join(dir, 'article-brief.md'); const factFile = writeUtf8(factPath, JSON.stringify(fact, null, 2)); const briefFile = writeUtf8(briefPath, `---\nbrief_status: LOCKED\ncandidate_id: ${candidate.candidate_id}\narticle_mode: ${articleMode}\nexperience_required: ${articleMode === 'experience' || Boolean(experiences)}\nfinal_readiness: WRITE_NOW\n---\n\n# ${fact.topic}\n`); store.upsertArtifact({ batchId, candidateId: candidate.id, track: 'article', kind: '自主写作事实基座', name: '01-tutorial-fact-base.json', path: factPath, ...factFile }); store.upsertArtifact({ batchId, candidateId: candidate.id, track: 'article', kind: '锁定简报', name: 'article-brief.md', path: briefPath, ...briefFile });
      store.updateCustomArticleRequest(creation.id, { candidateId: candidate.id }); const job = aiJobs.start({ batchId, candidateId: candidate.id, provider: input.provider, type: 'tutorial', skillSelection, stageSelections }); store.updateCustomArticleRequest(creation.id, { latestJobId: job.id }); return respond(json, response, 202, { ...job, candidate: store.getCandidate(candidate.id) });
    } catch (error) { return respond(json, response, 400, { error: `创建自主写作失败：${error.message}` }); }
  }
  const retryMatch = pathname.match(/^\/api\/candidates\/(\d+)\/custom-article-runs$/);
  if (retryMatch && request.method === 'POST') {
    const candidate = store.getCandidate(Number(retryMatch[1])); if (!candidate) return respond(json, response, 404, { error: '自主写作项目不存在' }); const creation = store.getCustomArticleRequestByCandidate(candidate.id); const outputMode = candidate.tracks?.find((item) => item.track === 'article')?.output_mode || candidate.output_mode || ''; if (!creation && !['wechat-experience', 'wechat-tutorial'].includes(outputMode)) return respond(json, response, 409, { error: '该候选不是自主写作项目' }); const input = await body(request); const explicitSkillId = String(input.skillId || '').trim(); const requestedStages = input.stageSkills && typeof input.stageSkills === 'object' ? input.stageSkills : {}; const hasExplicitStages = Object.values(requestedStages).some((value) => String(value || '').trim()); const previousSnapshot = (input.useLatestSkill === true || explicitSkillId || hasExplicitStages) ? null : store.findLatestGenerationSnapshot({ batchId: candidate.batch_id, candidateId: candidate.id, purposes: ['tutorial', 'personal-writing'] }); const articleMode = outputMode === 'wechat-experience' ? 'experience' : 'tutorial'; const skillSelection = previousSnapshot ? null : await resolveEntryWriterSkill({ workspaceRoot: root, entryPoint: 'independent-writing', contentType: articleMode, requestedSkillId: explicitSkillId, recommendedSkillId: articleMode === 'experience' ? 'wechat-mp-personal-writing' : 'wechat-mp-tutorial' }); const stageSelections = previousSnapshot ? null : await resolveArticleStageSkills({ workspaceRoot: root, entryPoint: 'independent-writing', requested: requestedStages }); const job = aiJobs.start({ batchId: candidate.batch_id, candidateId: candidate.id, provider: previousSnapshot ? null : input.provider, type: 'tutorial', snapshotId: previousSnapshot?.id || null, skillSelection, stageSelections }); if (creation) store.updateCustomArticleRequest(creation.id, { latestJobId: job.id }); return respond(json, response, 202, { ...job, candidate });
  }
  const candidateMatch = pathname.match(/^\/api\/candidates\/(\d+)$/);
  if (candidateMatch && request.method === 'GET') { const candidate = store.getCandidate(Number(candidateMatch[1])); if (candidate) { candidate.events = candidateEventGroups(candidate); const card = candidate.events.map((group) => group.card).find(Boolean); if (card) candidate.event_card = card; candidate.research_context = readDiscussionResearchContext({ workspaceRoot: root, batchId: candidate.batch_id, candidate, events: candidate.events }); } return respond(json, response, candidate ? 200 : 404, candidate ?? { error: '候选不存在' }); }
  if (candidateMatch && request.method === 'PATCH') { const candidate = store.updateCandidate(Number(candidateMatch[1]), await body(request)); return respond(json, response, candidate ? 200 : 404, candidate ?? { error: '候选不存在' }); }
  if (candidateMatch && request.method === 'DELETE') { store.deleteCandidate(Number(candidateMatch[1])); return respond(json, response, 200, { ok: true }); }
  const candidateTracksMatch = pathname.match(/^\/api\/candidates\/(\d+)\/tracks$/);
  if (candidateTracksMatch && request.method === 'POST') return respond(json, response, 409, { error: '文章池与图文池使用独立评分，不支持候选跨池添加' });
  const candidateTrackMatch = pathname.match(/^\/api\/candidates\/(\d+)\/tracks\/([^/]+)$/);
  if (candidateTrackMatch && request.method === 'DELETE') { try { const result = store.removeCandidateTrack(Number(candidateTrackMatch[1]), decodeURIComponent(candidateTrackMatch[2])); return respond(json, response, result ? 200 : 404, result ?? { error: '候选不存在' }); } catch (error) { return respond(json, response, 400, { error: error.message }); } }
  return false;
}
