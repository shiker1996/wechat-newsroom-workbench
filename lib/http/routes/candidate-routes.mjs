import fs from 'node:fs';
import path from 'node:path';
import { scoreCards } from '../../llm/research-pipeline.mjs';
import { routeBreakingAnalysis } from '../../llm/breaking-analysis-pipeline.mjs';
import { buildCustomFactSheet, customFactMarkdown, customSourceUrl } from '../../domain/custom-fact-builder.mjs';
import { createRepositoryCandidate } from '../../domain/repository-candidate.mjs';
import { runCustomSocialChatStream } from '../../llm/custom-social-chat.mjs';
import { runTutorialChatStream } from '../../llm/tutorial-chat.mjs';
import { extractLocalProjectPath, readLocalProjectViaRegistry as readLocalProject } from '../../integrations/local-project-reader.mjs';
import { resolveSkillToolPolicy } from '../../skills/pipeline-runtime.mjs';
import { attachInformationSearch } from '../../integrations/information-search.mjs';
import { resolveArticleStageSkills, resolveEntryWriterSkill } from '../../skills/entry-routing.mjs';
import { respond, customArticleFingerprint } from '../route-helpers.mjs';

export async function handleCandidateRoutes({ request, response, pathname, searchParams, root, config, store, body, json, models, aiJobs,
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
      let candidates = store.listCandidates(batchId, track);
      if (track === 'article' && kind !== 'all') {
        const independent = (item) => ['wechat-experience', 'wechat-tutorial'].includes(String(item.output_mode || ''));
        candidates = candidates.filter((item) => kind === 'independent' ? independent(item) : kind === 'hotspot' ? !independent(item) : true);
      }
      for (const candidate of candidates) candidate.member_hotspot_ids = candidate.composite ? store.candidateHotspots(candidate.id).map((item) => item.id) : [candidate.hotspot_id].filter(Boolean);
      if (track === 'article') attachEventConclusions(candidates, batchId);
      return respond(json, response, 200, candidates);
    } catch (error) { return respond(json, response, 400, { error: error.message }); }
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
    const tracks = Array.isArray(input.tracks) && input.tracks.length ? input.tracks : ['article']; const added = store.addCandidates(batchId, input.hotspotIds, { tracks });
    if (tracks.includes('social_cards') && input.socialScoreDetails && input.hotspotIds.length === 1) { const candidate = added.find((item) => Number(item.hotspot_id) === Number(input.hotspotIds[0])); if (candidate) store.saveSocialScore(candidate.id, input.socialScoreDetails); }
    return respond(json, response, 201, store.listCandidates(batchId, input.track || tracks[0]));
  }
  const compositeMatch = pathname.match(/^\/api\/batches\/([^/]+)\/candidates\/composite$/);
  if (compositeMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(compositeMatch[1]); const input = await body(request);
    if (!Array.isArray(input.hotspotIds) || input.hotspotIds.length < 2) return respond(json, response, 400, { error: '综合选题至少需要 2 个热点' });
    const composite = store.createCompositeCandidate(batchId, input.hotspotIds, input);
    if ((Array.isArray(input.tracks) ? input.tracks : []).includes('social_cards') && composite && !candidateRepositoryUrl(composite)) {
      store.updateCandidateTrack(composite.id, 'social_cards', { output_mode: 'wechat-event-cards' });
      store.saveCardEditorial(composite.id, { ...store.getCardEditorial(composite.id), output_mode: 'wechat-event-cards' });
    }
    try {
      if (composite && models) {
        const providerConfig = models.config.providers[models.config.defaultProvider];
        const hotInfo = (composite.hotspots || []).slice(0, 5).map((h) => `- ${h.title || '(无标题)'}：${h.source || '未知来源'}`).join('\n');
        const result = await models.complete({ purpose: 'composite-score', batchId, jsonMode: true, maxOutputTokens: Math.min(3000, providerConfig.maxOutputTokens), messages: [{ role: 'system', protected: true, content: '你是热点探索编辑。对综合选题生成临时评分。返回严格JSON：{"bScores":{},"hProfile":{},"angle":"","thesis":""}' }, { role: 'user', protected: true, content: `综合选题标题：${composite.hotspot_title}\n包含以下热点信息：\n${hotInfo}` }] });
        let parsed; try { parsed = JSON.parse(result.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { parsed = null; }
        if (parsed) {
          const card = { bScores: parsed.bScores || {}, hProfile: parsed.hProfile || { historicalType: 'bigtech', fiveSenseCount: 0, fiveQuestionCount: 0, recommendationFit: 0, emotionTheme: 0, searchFriendly: 0 }, angle: parsed.angle || '', thesis: parsed.thesis || '', source: { title: composite.hotspot_title, category: '', riskLevel: '待评估', poolRole: '综合选题', hotspotId: null } };
          const scored = scoreCards([card], { items: [] });
          if (scored.length) store.updateCandidate(composite.id, { h_score: scored[0].h, b_score: scored[0].b, p_score: scored[0].p.toFixed(1), s_score: scored[0].s, d_score: scored[0].d, f_score: scored[0].f, angle: parsed.angle || '', thesis: parsed.thesis || '', status: 'scored' });
        }
      }
    } catch { /* auto-scoring is best-effort */ }
    return respond(json, response, 201, store.getCandidate(composite.id));
  }

  const customSocialChatMatch = pathname.match(/^\/api\/batches\/([^/]+)\/custom-social-chat\/stream$/);
  if (customSocialChatMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(customSocialChatMatch[1]); if (!store.getBatch(batchId)) return respond(json, response, 404, { error: '批次不存在' });
    const input = await body(request); response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no', connection: 'keep-alive' });
    const send = (event) => response.write(`${JSON.stringify(event)}\n`);
    try { const result = await runCustomSocialChatStream({ gateway: models, store, provider: input.provider, batchId, draft: input.draft && typeof input.draft === 'object' ? input.draft : {}, history: Array.isArray(input.history) ? input.history.slice(-40) : [], answer: String(input.answer || ''), onText: (text) => send({ type: 'delta', text }), onThinking: (text) => send({ type: 'thinking', text }) }); send({ type: 'done', data: { reply: result.reply, formUpdates: result.formUpdates, ready: result.ready, usage: result.usage, model: result.model } }); }
    catch (error) { send({ type: 'error', error: error.message }); }
    response.end(); return true;
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
      const fact = await buildCustomFactSheet({ input, root }); const toolPolicy = await resolveSkillToolPolicy({ workspaceRoot: root, skillId: 'custom-card-storyboard' });
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
    const input = await body(request); try { const project = await readLocalProject(input.path, { toolContext: { store } }); return respond(json, response, 200, { root: project.root, summary: project.summary, files: project.files.map(({ path: filePath, size, truncated }) => ({ path: filePath, size, truncated })), skipped: project.skipped, truncated: project.truncated }); }
    catch (error) { return respond(json, response, 400, { error: `读取本地项目失败：${error.message}` }); }
  }
  const tutorialChatMatch = pathname.match(/^\/api\/batches\/([^/]+)\/tutorial-chat\/stream$/);
  if (tutorialChatMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(tutorialChatMatch[1]); if (!store.getBatch(batchId)) return respond(json, response, 404, { error: '批次不存在' });
    const input = await body(request); const draft = input.draft && typeof input.draft === 'object' ? { ...input.draft } : {}; const tutorialMode = String(draft.articleMode || '').trim() === 'tutorial' || /教程|项目|仓库/.test(String(input.answer || '')); const detectedPath = tutorialMode ? (String(draft.localProjectPath || '').trim() || extractLocalProjectPath(input.answer)) : '';
    let projectContext = null; let projectReadError = ''; if (detectedPath) { draft.localProjectPath = detectedPath; try { const toolPolicy = await resolveSkillToolPolicy({ workspaceRoot: root, skillId: 'wechat-mp-tutorial' }); projectContext = await readLocalProject(detectedPath, { toolContext: { store, batchId, skillId: 'wechat-mp-tutorial', allowedCapabilities: toolPolicy.allowedCapabilities } }); } catch (error) { projectReadError = error.message; } }
    response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no', connection: 'keep-alive' }); const send = (event) => response.write(`${JSON.stringify(event)}\n`);
    try { const result = await runTutorialChatStream({ gateway: models, store, provider: input.provider, batchId, draft, history: Array.isArray(input.history) ? input.history : [], answer: String(input.answer || ''), projectContext, projectReadError, onText: (text) => send({ type: 'delta', text }), onThinking: (text) => send({ type: 'thinking', text }) }); send({ type: 'done', data: { ...result, project: projectContext ? { root: projectContext.root, summary: projectContext.summary, files: projectContext.files.map((item) => item.path), truncated: projectContext.truncated } : null, projectReadError } }); }
    catch (error) { send({ type: 'error', error: error.message }); } response.end(); return true;
  }
  return handleIndependentCreation({ request, response, pathname, root, config, store, body, json, aiJobs, articleWorkdir, writeUtf8, readLocalProject, resolveSkillToolPolicy, resolveArticleStageSkills, resolveEntryWriterSkill, buildCustomFactSheet, attachInformationSearch, customArticleFingerprint, candidateEventGroups });
}

async function handleIndependentCreation({ request, response, pathname, root, config, store, body, json, aiJobs, articleWorkdir, writeUtf8, readLocalProject, resolveSkillToolPolicy, resolveArticleStageSkills, resolveEntryWriterSkill, buildCustomFactSheet, attachInformationSearch, customArticleFingerprint, candidateEventGroups }) {
  const tutorialMatch = pathname.match(/^\/api\/batches\/([^/]+)\/(?:custom-articles|tutorials)$/);
  if (tutorialMatch && request.method === 'GET') {
    const batchId = decodeURIComponent(tutorialMatch[1]); if (!store.getBatch(batchId)) return respond(json, response, 404, { error: '批次不存在' });
    const projects = store.listCustomArticleProjects(batchId).map((item) => ({ ...item, project_status: item.document_id ? 'draft_ready' : item.job_status === 'running' ? 'generating' : ['failed', 'interrupted'].includes(item.job_status) ? 'failed' : 'ready_to_generate' }));
    return respond(json, response, 200, projects);
  }
  if (tutorialMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(tutorialMatch[1]); const batch = store.getBatch(batchId); if (!batch) return respond(json, response, 404, { error: '批次不存在' }); const input = await body(request);
    try {
      const articleMode = String(input.articleMode || 'tutorial').trim() === 'experience' ? 'experience' : 'tutorial'; const recommendedSkillId = articleMode === 'experience' ? 'wechat-mp-personal-writing' : 'wechat-mp-tutorial';
      const skillSelection = await resolveEntryWriterSkill({ workspaceRoot: root, entryPoint: 'independent-writing', contentType: articleMode, requestedSkillId: String(input.skillId || ''), recommendedSkillId });
      const stageSelections = await resolveArticleStageSkills({ workspaceRoot: root, entryPoint: 'independent-writing', requested: input.stageSkills && typeof input.stageSkills === 'object' ? input.stageSkills : {} });
      const fingerprint = customArticleFingerprint(batchId, input); const requestId = String(input.creationRequestId || fingerprint).trim();
      let creation = store.findCustomArticleRequest(batchId, { requestId, fingerprint }) || store.createCustomArticleRequest({ batchId, requestId, fingerprint });
      if (creation?.candidate_row_id) { const candidate = store.getCandidate(creation.candidate_row_id); let job = creation.latest_job_id ? aiJobs.get(creation.latest_job_id) : null; if (candidate && !job) { job = aiJobs.start({ batchId, candidateId: candidate.id, provider: input.provider, type: 'tutorial', skillSelection, stageSelections }); store.updateCustomArticleRequest(creation.id, { latestJobId: job.id }); } if (candidate && job) return respond(json, response, 200, { ...job, candidate, reused: true }); }
      let project = null; if (articleMode === 'tutorial' && String(input.localProjectPath || '').trim()) { const toolPolicy = await resolveSkillToolPolicy({ workspaceRoot: root, skillId: skillSelection.selectedSkill }); project = await readLocalProject(input.localProjectPath, { toolContext: { store, batchId, skillId: skillSelection.selectedSkill, allowedCapabilities: toolPolicy.allowedCapabilities } }); }
      const fact = await buildCustomFactSheet({ input: { ...input, content_type: articleMode === 'experience' ? 'opinion' : 'tutorial', scenario: input.environment }, root, hasUserMaterialContext: Boolean(project) }); fact.article_mode = articleMode; fact.environment = String(input.environment || '').trim();
      fact.prerequisites = String(input.prerequisites || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean); fact.expected_results = String(input.expected_results || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean); fact.common_errors = String(input.common_errors || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      if (project) fact.local_project = { root: project.root, files: project.files.map(({ path: filePath, size, excerpt, truncated }) => ({ path: filePath, size, excerpt, truncated })), summary: project.summary, truncated: project.truncated };
      if (articleMode === 'tutorial' && !fact.environment) throw new Error('请填写实际运行环境或版本边界'); if (articleMode === 'tutorial' && fact.steps.length < 2) throw new Error('教程步骤至少需要 2 步'); if (articleMode === 'experience' && !fact.thesis) throw new Error('心得经验文章需要明确核心观点');
      if (fact.materials.some((item) => item.status !== 'ok')) throw new Error(`素材抓取失败：${fact.materials.filter((item) => item.status !== 'ok').map((item) => item.url).join('、')}`);
      const toolPolicy = await resolveSkillToolPolicy({ workspaceRoot: root, skillId: skillSelection.selectedSkill }); await attachInformationSearch({ fact, input, root, toolContext: { store, batchId, skillId: skillSelection.selectedSkill, allowedCapabilities: toolPolicy.allowedCapabilities }, documentRoots: config.documentSearch?.roots || [] });
      const materialUrls = fact.materials.map((item) => item.url); const hotspot = store.addManualHotspot(batchId, { title: fact.topic, url: materialUrls[0] || null, materialUrls, notes: `自主写作（${articleMode === 'experience' ? '心得经验' : '使用教程'}）`, researchEligible: false }); store.addCandidates(batchId, [hotspot.id], { tracks: ['article'] });
      const candidate = store.listCandidates(batchId, 'article').find((item) => Number(item.hotspot_id) === Number(hotspot.id)); if (!candidate) throw new Error('自主写作项目创建失败'); store.updateCandidate(candidate.id, { angle: articleMode === 'experience' ? `经验分享：${fact.topic}` : `实操教程：${fact.topic}`, thesis: articleMode === 'experience' ? fact.thesis : `帮助 ${fact.audience || '目标读者'} 在 ${fact.environment} 完成 ${fact.topic}`, status: 'locked' }); store.updateCandidateTrack(candidate.id, 'article', { status: 'locked', pool_role: '自主写作', output_mode: articleMode === 'experience' ? 'wechat-experience' : 'wechat-tutorial' });
      const experiences = fact.points.filter((item) => item.source_level === 'author_experience').map((item) => item.text).join('\n'); const facts = fact.points.filter((item) => item.source_level !== 'model_suggestion').map((item) => item.text).join('\n'); store.saveEditorial(candidate.id, { editor_question: '', confirmed_facts: facts, author_opinions: articleMode === 'experience' ? fact.thesis : '', confirmed_experiences: experiences, rejected_angles: '', open_questions: '', forbidden_claims: '不得将模型建议写成实测或确定结果，不得虚构作者经历', next_action: 'WRITE_NOW', experience_required: articleMode === 'experience' || Boolean(experiences), brief_status: 'LOCKED' });
      const dir = articleWorkdir(batch, candidate); const factPath = path.join(dir, '01-tutorial-fact-base.json'); const briefPath = path.join(dir, 'article-brief.md'); const factFile = writeUtf8(factPath, JSON.stringify(fact, null, 2)); const briefFile = writeUtf8(briefPath, `---\nbrief_status: LOCKED\ncandidate_id: ${candidate.candidate_id}\narticle_mode: ${articleMode}\nexperience_required: ${articleMode === 'experience' || Boolean(experiences)}\nfinal_readiness: WRITE_NOW\n---\n\n# ${fact.topic}\n`); store.upsertArtifact({ batchId, candidateId: candidate.id, track: 'article', kind: '自主写作事实基座', name: '01-tutorial-fact-base.json', path: factPath, ...factFile }); store.upsertArtifact({ batchId, candidateId: candidate.id, track: 'article', kind: '锁定简报', name: 'article-brief.md', path: briefPath, ...briefFile });
      store.updateCustomArticleRequest(creation.id, { candidateId: candidate.id }); const job = aiJobs.start({ batchId, candidateId: candidate.id, provider: input.provider, type: 'tutorial', skillSelection, stageSelections }); store.updateCustomArticleRequest(creation.id, { latestJobId: job.id }); return respond(json, response, 202, { ...job, candidate: store.getCandidate(candidate.id) });
    } catch (error) { return respond(json, response, 400, { error: `创建自主写作失败：${error.message}` }); }
  }
  const retryMatch = pathname.match(/^\/api\/candidates\/(\d+)\/custom-article-runs$/);
  if (retryMatch && request.method === 'POST') {
    const candidate = store.getCandidate(Number(retryMatch[1])); if (!candidate) return respond(json, response, 404, { error: '自主写作项目不存在' }); if (!['wechat-experience', 'wechat-tutorial'].includes(candidate.output_mode)) return respond(json, response, 409, { error: '该候选不是自主写作项目' }); const input = await body(request); const creation = store.getCustomArticleRequestByCandidate(candidate.id); const explicitSkillId = String(input.skillId || '').trim(); const requestedStages = input.stageSkills && typeof input.stageSkills === 'object' ? input.stageSkills : {}; const hasExplicitStages = Object.values(requestedStages).some((value) => String(value || '').trim()); const previousSnapshot = (input.useLatestSkill === true || explicitSkillId || hasExplicitStages) ? null : store.findLatestGenerationSnapshot({ batchId: candidate.batch_id, candidateId: candidate.id, purposes: ['tutorial', 'personal-writing'] }); const articleMode = candidate.output_mode === 'wechat-experience' ? 'experience' : 'tutorial'; const skillSelection = previousSnapshot ? null : await resolveEntryWriterSkill({ workspaceRoot: root, entryPoint: 'independent-writing', contentType: articleMode, requestedSkillId: explicitSkillId, recommendedSkillId: articleMode === 'experience' ? 'wechat-mp-personal-writing' : 'wechat-mp-tutorial' }); const stageSelections = previousSnapshot ? null : await resolveArticleStageSkills({ workspaceRoot: root, entryPoint: 'independent-writing', requested: requestedStages }); const job = aiJobs.start({ batchId: candidate.batch_id, candidateId: candidate.id, provider: previousSnapshot ? null : input.provider, type: 'tutorial', snapshotId: previousSnapshot?.id || null, skillSelection, stageSelections }); if (creation) store.updateCustomArticleRequest(creation.id, { latestJobId: job.id }); return respond(json, response, 202, { ...job, candidate });
  }
  const candidateMatch = pathname.match(/^\/api\/candidates\/(\d+)$/);
  if (candidateMatch && request.method === 'GET') { const candidate = store.getCandidate(Number(candidateMatch[1])); if (candidate) { candidate.events = candidateEventGroups(candidate); const card = candidate.events.map((group) => group.card).find(Boolean); if (card) candidate.event_card = card; } return respond(json, response, candidate ? 200 : 404, candidate ?? { error: '候选不存在' }); }
  if (candidateMatch && request.method === 'PATCH') { const candidate = store.updateCandidate(Number(candidateMatch[1]), await body(request)); return respond(json, response, candidate ? 200 : 404, candidate ?? { error: '候选不存在' }); }
  if (candidateMatch && request.method === 'DELETE') { store.deleteCandidate(Number(candidateMatch[1])); return respond(json, response, 200, { ok: true }); }
  const candidateTracksMatch = pathname.match(/^\/api\/candidates\/(\d+)\/tracks$/);
  if (candidateTracksMatch && request.method === 'POST') return respond(json, response, 409, { error: '文章池与图文池使用独立评分，不支持候选跨池添加' });
  const candidateTrackMatch = pathname.match(/^\/api\/candidates\/(\d+)\/tracks\/([^/]+)$/);
  if (candidateTrackMatch && request.method === 'DELETE') { try { const result = store.removeCandidateTrack(Number(candidateTrackMatch[1]), decodeURIComponent(candidateTrackMatch[2])); return respond(json, response, result ? 200 : 404, result ?? { error: '候选不存在' }); } catch (error) { return respond(json, response, 400, { error: error.message }); } }
  return false;
}
