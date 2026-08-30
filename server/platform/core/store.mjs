import { openWorkbenchDatabase } from '../persistence/database.mjs';
import { AiRunRepository } from '../persistence/repositories/ai-run-repository.mjs';
import { BatchRepository } from '../persistence/repositories/batch-repository.mjs';
import { ContentRepository } from '../persistence/repositories/content-repository.mjs';
import { RuntimeAuditRepository } from '../persistence/repositories/runtime-audit-repository.mjs';
import { SourceRunRepository } from '../persistence/repositories/source-run-repository.mjs';
import { HotspotRepository } from '../persistence/repositories/hotspot-repository.mjs';
import { CandidateRepository } from '../persistence/repositories/candidate-repository.mjs';
import { runDatabaseMigrations } from '../persistence/migrations.mjs';
import { ThemeRepository } from '../persistence/repositories/theme-repository.mjs';
import { VisualDecisionRepository } from '../persistence/repositories/visual-decision-repository.mjs';
import { WorkbenchQueryService } from '../persistence/queries/workbench-query-service.mjs';
import { EditorialRepository } from '../persistence/repositories/editorial-repository.mjs';
import { SocialCandidateRepository } from '../persistence/repositories/social-candidate-repository.mjs';
import { CustomArticleRepository } from '../persistence/repositories/custom-article-repository.mjs';
import { PipelineFailureRepository } from '../persistence/repositories/pipeline-failure-repository.mjs';
import { ExtensionSettingRepository } from '../persistence/repositories/extension-setting-repository.mjs';
import { CollectionSourceRepository } from '../persistence/repositories/collection-source-repository.mjs';
import { EventResolutionRepository } from '../persistence/repositories/event-resolution-repository.mjs';
import { EventResolutionReviewRepository } from '../persistence/repositories/event-resolution-review-repository.mjs';
import { AgentRunRepository } from '../persistence/repositories/agent-run-repository.mjs';
import { SocialTemplateMetricsRepository } from '../persistence/repositories/social-template-metrics-repository.mjs';
import { SocialTemplateProposalMetricsRepository } from '../persistence/repositories/social-template-proposal-metrics-repository.mjs';
import { BatchQueryService } from '../persistence/queries/batch-query-service.mjs';
import { CandidateQueryService } from '../persistence/queries/candidate-query-service.mjs';
import { EventResolutionQueryService } from '../persistence/queries/event-resolution-query-service.mjs';
import { createCandidateSelectionService } from '../application/store-services.mjs';
import { DatabaseRestoreService } from '../persistence/database-restore-service.mjs';



export class Store {
  constructor(dbPath) {
    this.db = openWorkbenchDatabase(dbPath);
    runDatabaseMigrations(this.db);
    this.repositories = Object.freeze({
      aiRuns: new AiRunRepository(this.db),
      batches: new BatchRepository(this.db),
      content: new ContentRepository(this.db),
      runtimeAudit: new RuntimeAuditRepository(this.db),
      sourceRuns: new SourceRunRepository(this.db),
      hotspots: new HotspotRepository(this.db),
      candidates: new CandidateRepository(this.db),
      themes: new ThemeRepository(this.db),
      visualDecisions: new VisualDecisionRepository(this.db),
      editorial: new EditorialRepository(this.db),
      socialCandidates: new SocialCandidateRepository(this.db),
      customArticles: new CustomArticleRepository(this.db),
      pipelineFailures: new PipelineFailureRepository(this.db),
      extensionSettings: new ExtensionSettingRepository(this.db),
      collectionSources: new CollectionSourceRepository(this.db),
      eventResolution: new EventResolutionRepository(this.db),
      eventResolutionReview: new EventResolutionReviewRepository(this.db),
      agentRuns: new AgentRunRepository(this.db),
      socialTemplateMetrics: new SocialTemplateMetricsRepository(this.db),
      socialTemplateProposalMetrics: new SocialTemplateProposalMetricsRepository(this.db),
    });
    this.queries = Object.freeze({
      batches: new BatchQueryService(this.db),
      candidates: new CandidateQueryService(this.db, this.repositories),
      eventResolution: new EventResolutionQueryService(this.db),
      workbench: new WorkbenchQueryService(this.db, {
        getCandidate: (id) => this.getCandidate(id),
        candidateHotspots: (id) => this.candidateHotspots(id),
        latestActiveBatch: () => this.latestActiveBatch(),
      }),
    });
    this.services = Object.freeze({
      candidateSelection: createCandidateSelectionService(this.db, this.repositories, this.queries.candidates),
      databaseRestore: new DatabaseRestoreService(this.db),
    });
  }

  close() {
    if(!this.db)return;
    try{this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}finally{this.db.close();this.db=null;}
  }

  getExtensionSetting(extensionType,extensionId,scope='workspace') { return this.repositories.extensionSettings.get(extensionType,extensionId,scope); }
  saveExtensionSetting(input) { return this.repositories.extensionSettings.save(input); }
  listExtensionSettings(extensionType=null) { return this.repositories.extensionSettings.list(extensionType); }
  listCollectionSources() { return this.repositories.collectionSources.list(); }
  startAgentRun(input) { return this.repositories.agentRuns.start(input); }
  finishAgentRun(id,fields) { return this.repositories.agentRuns.finish(id,fields); }
  getAgentRun(id) { return this.repositories.agentRuns.get(id); }
  listAgentRuns(limit=100) { return this.repositories.agentRuns.list(limit); }
  getAgentOperationsOverview(limit=100) { return this.repositories.agentRuns.overview(limit); }
  startAgentToolCall(input) { return this.repositories.agentRuns.startToolCall(input); }
  finishAgentToolCall(input) { return this.repositories.agentRuns.finishToolCall(input); }
  listAgentToolCalls(agentRunId) { return this.repositories.agentRuns.listToolCalls(agentRunId); }
  saveConversationFactAttachment(input) { return this.repositories.agentRuns.saveAttachment(input); }
  getConversationFactAttachment(input) { return this.repositories.agentRuns.getAttachment(input); }
  listConversationFactAttachments(input) { return this.repositories.agentRuns.listAttachments(input); }
  listEnabledCollectionSources(options={}) { return this.repositories.collectionSources.listEnabled(options); }
  getCollectionSource(id) { return this.repositories.collectionSources.get(id); }
  upsertCollectionSource(input) { return this.repositories.collectionSources.upsert(input); }



  createBatch({ date, title, note = '', batchType = 'regular', requestedTracks = ['article'] }) {
    const id = this.repositories.batches.create({ date, title, note, batchType, requestedTracks });
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
    return this.repositories.batches.list(limit);
  }

  saveEventResolutionShadow(batchId, shadow) {
    return this.repositories.eventResolution.upsertShadow(batchId, shadow);
  }

  saveEventClassification(eventId, classification) {
    return this.repositories.eventResolution.saveClassification(eventId, classification);
  }

  getEventRecord(eventId) {
    return this.repositories.eventResolution.get(eventId);
  }

  listEventRecords(options = {}) {
    return this.repositories.eventResolution.list(options);
  }

  listEventHotspots(options = {}) {
    return this.repositories.eventResolution.listHotspots(options);
  }

  recordEventResolutionDecision(input = {}) {
    return this.repositories.eventResolutionReview.record(input);
  }

  listEventResolutionDecisions(options = {}) {
    return this.repositories.eventResolutionReview.list(options);
  }

  revertEventResolutionDecision(id) {
    return this.repositories.eventResolutionReview.revert(id);
  }

  latestActiveBatch() {
    return this.repositories.batches.latestActive();
  }

  getBatch(id) {
    return this.queries.batches.getBatch(id);
  }

  updateBatch(id, fields) {
    this.repositories.batches.update(id, fields);
    return this.getBatch(id);
  }

  getBatchDeleteCounts(batchId) {
    return this.repositories.batches.deleteCounts(batchId);
  }

  // 仅删除 batches 行：子表由外键 ON DELETE CASCADE 清理，审计类表（model_calls/artifacts 等）
  // 按 ON DELETE SET NULL 脱钩保留。产物目录清理由 features/batches/application/batch-deletion.mjs 负责。
  deleteBatch(id) {
    return this.repositories.batches.delete(id);
  }

  startSourceRun(batchId, source) {
    return this.repositories.sourceRuns.start(batchId, source);
  }

  finishSourceRun(id, status, itemCount = 0, error = null) {
    this.repositories.sourceRuns.finish(id, status, itemCount, error);
    if (status === 'failed' || status === 'interrupted') {
      const run = this.repositories.sourceRuns.get(id);
      if (run) this.recordPipelineFailure({ batchId: run.batch_id, stage: 'collect', objectType: 'source',
        objectKey: `source:${run.id}`, sourceRunId: run.id, title: run.source,
        errorCode: status === 'interrupted' ? 'interrupted' : 'source_failed', errorMessage: error || `${run.source} 采集失败`,
        detail: { source: run.source, status } });
    }
  }

  getSourceRun(id) {
    return this.repositories.sourceRuns.get(id);
  }

  recordSubscriptionRun(batchId, result, { indexFailure = true } = {}) {
    const id = this.repositories.sourceRuns.recordSubscription(batchId, result);
    if (indexFailure && (result.status === 'failed' || result.status === 'interrupted')) {
      this.recordPipelineFailure({ batchId, stage: 'collect', objectType: 'subscription',
        objectKey: `subscription:${id}`, subscriptionRunId: id, title: result.sourceName || result.sourceKey,
        errorCode: result.status === 'interrupted' ? 'interrupted' : 'subscription_failed',
        errorMessage: result.error || `${result.sourceName || result.sourceKey} 采集失败`,
        detail: { sourceGroup: result.sourceGroup, sourceType: result.sourceType, sourceKey: result.sourceKey,
          sourceName: result.sourceName, durationMs: Number(result.durationMs || 0) } });
    }
    return id;
  }

  recordPipelineFailure(input) { return this.repositories.pipelineFailures.record(input); }
  listPipelineFailures(batchId, options = {}) { return this.repositories.pipelineFailures.listBatch(batchId, options); }
  getPipelineFailure(id) { return this.repositories.pipelineFailures.get(id); }
  startPipelineFailureRetry(id) { return this.repositories.pipelineFailures.startRetry(id); }
  resolvePipelineFailure(id) { return this.repositories.pipelineFailures.resolve(id); }
  failPipelineFailureRetry(id, errorMessage, detail) { return this.repositories.pipelineFailures.retryFailed(id, errorMessage, detail); }
  skipPipelineFailure(id, reason = '') { return this.repositories.pipelineFailures.skip(id, reason); }
  reopenPipelineFailure(id) { return this.repositories.pipelineFailures.reopen(id); }

  listSubscriptionHealth() {
    return this.repositories.sourceRuns.health();
  }

  listSubscriptionHealthHistory({ days = 14, limit = 500 } = {}) {
    return this.repositories.sourceRuns.history({ days, limit });
  }

  recoverInterruptedWork() {
    return this.repositories.sourceRuns.recoverInterrupted();
  }

  addHotspots(batchId, sourceGroup, items) {
    return this.repositories.hotspots.add(batchId, sourceGroup, items);
  }

  addManualHotspot(batchId, { title, url, category, notes, materialUrls = [], researchEligible = true }) {
    return this.repositories.hotspots.addManual(batchId, { title, url, category, notes, materialUrls, researchEligible });
  }

  listHotspotMaterials(hotspotId) {
    return this.repositories.hotspots.listMaterials(hotspotId);
  }

  addBreakingMaterials(batchId, urls) {
    return this.repositories.hotspots.addBreakingMaterials(batchId, urls);
  }

  saveHotspotMaterialResult(materialId, input) {
    return this.repositories.hotspots.saveMaterialResult(materialId, input);
  }

  saveBreakingAnalysis(batchId, analysis, status='ready') {
    return this.repositories.hotspots.saveBreakingAnalysis(batchId, analysis, status);
  }

  getBreakingAnalysis(batchId) {
    return this.repositories.hotspots.getBreakingAnalysis(batchId);
  }

  listHotspots({ q = '', source = '', date = '', limit = 200 }) {
    return this.repositories.hotspots.list({ q, source, date, limit });
  }

  getHotspot(id) {
    return this.repositories.hotspots.get(id);
  }

  setHotspotResearchEligible(id, eligible) { return this.repositories.hotspots.setResearchEligible(id, eligible); }

  updateHotspotTags(id, tags) {
    return this.repositories.hotspots.updateTags(id, tags);
  }

  getBatchOverview(batchId) {
    return this.queries.batches.getOverview(batchId);
  }

  addCandidates(batchId, hotspotIds, { tracks = ['article'] } = {}) {
    this.repositories.candidates.addFromHotspots(batchId, hotspotIds, { tracks });
    return this.listCandidates(batchId);
  }

  createCompositeCandidate(batchId, hotspotIds, { title='', poolRole='综合选题', tracks=['article'], dimension='event' } = {}) {
    const id = this.repositories.candidates.createComposite(batchId, hotspotIds, { title, poolRole, tracks, dimension });
    return id == null ? null : this.getCandidate(id);
  }

  findCompositeByTitle(batchId, title) {
    return this.repositories.candidates.findCompositeByTitle(batchId, title);
  }

  replaceCompositeMembers(candidateId, hotspotIds, batchId) {
    return this.repositories.candidates.replaceCompositeMembers(candidateId, hotspotIds, batchId);
  }

  listCandidates(batchId, track = 'article') {
    return this.queries.candidates.list(batchId, track);
  }

  getCandidate(id) {
    return this.queries.candidates.get(id);
  }

  getCandidateByHotspot(batchId, hotspotId) {
    return this.queries.candidates.getByHotspot(batchId, hotspotId);
  }

  candidateHotspots(candidateRowId) {
    return this.repositories.candidates.hotspots(candidateRowId);
  }

  getHotspotSource(hotspotId) {
    return this.repositories.candidates.getHotspotSource(hotspotId);
  }

  saveHotspotSource(hotspotId, input) {
    return this.repositories.candidates.saveHotspotSource(hotspotId, input);
  }

  listCandidateSources(candidateRowId) {
    return this.repositories.candidates.listSources(candidateRowId);
  }

  saveCandidateSource(candidateRowId, input) {
    return this.repositories.candidates.saveSource(candidateRowId, input);
  }

  deleteCandidate(id) {
    return this.repositories.candidates.delete(id);
  }

  normalizeTrack(track) {
    return this.repositories.candidates.normalizeTrack(track);
  }

  listCandidateTracks(candidateId) {
    return this.repositories.candidates.listTracks(candidateId);
  }

  addCandidateTracks(candidateId, tracks, input = {}) {
    const id = this.repositories.candidates.addTracks(candidateId, tracks, input);
    return id == null ? null : this.getCandidate(id);
  }

  removeCandidateTrack(candidateId, track) {
    return this.repositories.candidates.removeTrack(candidateId, track);
  }

  updateCandidateTrack(candidateId, track, fields) {
    return this.repositories.candidates.updateTrack(candidateId, track, fields);
  }

  updateCandidate(id, fields) {
    this.repositories.candidates.update(id, fields);
    return this.getCandidate(id);
  }

  getEditorial(candidateId) {
    return this.repositories.editorial.getArticle(candidateId);
  }

  saveEditorial(candidateId, input) {
    return this.repositories.editorial.saveArticle(candidateId, input);
  }

  addEditorialMessage(candidateId, role, content) {
    return this.repositories.editorial.addMessage(candidateId, role, content);
  }

  listEditorialMessages(candidateId) {
    return this.repositories.editorial.listMessages(candidateId);
  }

  saveDocument({ batchId, candidateId = null, kind, title = '', content = '', filePath = null, status = 'draft' }) {
    return this.repositories.content.saveDocument({ batchId, candidateId, kind, title, content, filePath, status });
  }

  getDocument(batchId, candidateId, kind) {
    return this.repositories.content.getDocument(batchId, candidateId, kind);
  }


  getDocumentContent(id) {
    return this.repositories.content.getDocumentContent(id);
  }

  listDocuments(batchId) {
    return this.repositories.content.listDocuments(batchId);
  }

  upsertArtifact(artifact) {
    return this.repositories.content.upsertArtifact(artifact);
  }

  listArtifacts({ limit=300, batchId } = {}) {
    return this.repositories.content.listArtifacts({ limit, batchId });
  }

  getArtifact(id) {
    return this.repositories.content.getArtifact(id);
  }

  recordModelCall(input) {
    return this.repositories.runtimeAudit.recordModelCall(input);
  }

  updateModelCall(id, fields) {
    return this.repositories.runtimeAudit.updateModelCall(id, fields);
  }

  listModelCalls(limit = 100) {
    return this.repositories.runtimeAudit.listModelCalls(limit);
  }

  saveGenerationSnapshot({ batchId = null, candidateId = null, purpose, snapshot }) {
    return this.repositories.runtimeAudit.saveSnapshot({ batchId, candidateId, purpose, snapshot });
  }

  listGenerationSnapshots({ batchId = null, candidateId = null, limit = 50 } = {}) {
    return this.repositories.runtimeAudit.listSnapshots({ batchId, candidateId, limit });
  }

  getGenerationSnapshot(id) {
    return this.repositories.runtimeAudit.getSnapshot(id);
  }

  findLatestGenerationSnapshot({ batchId, candidateId = null, purposes = [] }) {
    return this.repositories.runtimeAudit.findLatestSnapshot({ batchId, candidateId, purposes });
  }

  saveToolExecution({ batchId = null, candidateId = null, generationSnapshotId = null, skillId = null, record }) {
    return this.repositories.runtimeAudit.saveToolExecution({ batchId, candidateId, generationSnapshotId, skillId, record });
  }

  listToolExecutions({ batchId = null, candidateId = null, capability = null, plugin = null, limit = 100 } = {}) {
    return this.repositories.runtimeAudit.listToolExecutions({ batchId, candidateId, capability, plugin, limit });
  }

  saveSkillVersion({ skillId, config, configHash, publish = false }) {
    return this.repositories.runtimeAudit.saveSkillVersion({ skillId, config, configHash, publish });
  }

  listToolInvocation(resolutionId) { return this.repositories.runtimeAudit.listToolInvocation(resolutionId); }

  removeSkillVersion(id) { return this.repositories.runtimeAudit.removeSkillVersion(id); }
  setPublishedSkillVersion(skillId, version) {
    return this.repositories.runtimeAudit.setPublishedSkillVersion(skillId, version);
  }

  getSkillVersion(skillId, version = null) {
    return this.repositories.runtimeAudit.getSkillVersion(skillId, version);
  }

  listSkillVersions(skillId) {
    return this.repositories.runtimeAudit.listSkillVersions(skillId);
  }

  createAiRun({ id, batchId, type, provider }) {
    return this.repositories.aiRuns.create({ id, batchId, type, provider });
  }

  updateAiRun(id, fields) {
    return this.repositories.aiRuns.update(id, fields);
  }

  getAiRun(id) {
    return this.repositories.aiRuns.get(id);
  }

  listAiRuns(batchId, limit = 30) {
    return this.repositories.aiRuns.listByBatch(batchId, limit);
  }

  findCustomArticleRequest(batchId, { requestId = '', fingerprint = '' } = {}) {
    return this.repositories.customArticles.find(batchId, { requestId, fingerprint });
  }

  createCustomArticleRequest({ batchId, requestId, fingerprint }) {
    return this.repositories.customArticles.create({ batchId, requestId, fingerprint });
  }

  updateCustomArticleRequest(id, { candidateId, latestJobId } = {}) {
    return this.repositories.customArticles.update(id, { candidateId, latestJobId });
  }

  getCustomArticleRequestByCandidate(candidateId) {
    return this.repositories.customArticles.getByCandidate(candidateId);
  }

  listCustomArticleProjects(batchId) {
    return this.repositories.customArticles.listProjects(batchId);
  }

  getDocumentById(id) {
    return this.repositories.content.getDocumentById(id);
  }

  listDocumentRevisions(documentId) {
    return this.repositories.content.listDocumentRevisions(documentId);
  }

  getDocumentRevision(documentId, revisionId) {
    return this.repositories.content.getDocumentRevision(documentId, revisionId);
  }

  restoreFromDatabase(backupPath) {
    return this.services.databaseRestore.restore(backupPath);
  }

  listRecentAiRuns(limit = 30) {
    return this.repositories.aiRuns.listRecent(limit);
  }

  listRecentRuns(limit = 40) {
    return this.repositories.aiRuns.listRecentWork(limit);
  }

  saveAnalyzedCandidates(batchId, records) {
    return this.services.candidateSelection.saveAnalyzed(batchId, records);
  }

  clearGeneratedArticleCandidates(batchId) {
    return this.services.candidateSelection.clearGeneratedArticleCandidates(batchId);
  }

  saveSocialPreselection(batchId, records) {
    return this.services.candidateSelection.saveSocialPreselection(batchId, records);
  }

  getRepositoryFactSheet(candidateId) {
    return this.repositories.socialCandidates.getFactSheet(candidateId);
  }

  saveRepositoryFactSheet(candidateId, input) {
    return this.repositories.socialCandidates.saveFactSheet(candidateId, input);
  }

  getSocialScore(candidateId) {
    return this.repositories.socialCandidates.getScore(candidateId);
  }

  saveSocialScore(candidateId, score) {
    return this.repositories.socialCandidates.saveScore(candidateId, score);
  }

  getCardEditorial(candidateId) {
    return this.repositories.editorial.getCard(candidateId);
  }

  saveCardEditorial(candidateId, input) {
    return this.repositories.editorial.saveCard(candidateId, input);
  }

  listFinalArticles(input = {}) {
    return this.queries.workbench.listFinalArticles(input);
  }

  listCalendarContent(input = {}) {
    return this.queries.workbench.listCalendarContent(input);
  }

  findSimilarArticles(candidateId) {
    return this.queries.workbench.findSimilarArticles(candidateId);
  }

  findSimilarSocialCards(candidateId) {
    return this.queries.workbench.findSimilarSocialCards(candidateId);
  }

  articleStats() {
    return this.queries.workbench.articleStats();
  }

  listLogs(input = {}) {
    return this.queries.workbench.listLogs(input);
  }


  saveEliminationReasons(batchId, ranking) {
    return this.repositories.hotspots.saveEliminationReasons(batchId, ranking);
  }

  overview() {
    return this.queries.workbench.overview();
  }

  close() {
    this.db.close();
  }

  saveVisualDecision({ batchId, candidateId = null, visualType, action, heading = '', purpose = '' }) {
    return this.repositories.visualDecisions.save({ batchId, candidateId, visualType, action, heading, purpose });
  }

  visualDecisionStats() {
    return this.repositories.visualDecisions.stats();
  }

  listUserThemes({target=null,includeArchived=false}={}) {
    return this.repositories.themes.list({ target, includeArchived });
  }

  getUserTheme(id) { return this.repositories.themes.get(id); }

  saveUserThemeDraft({id,target,label,definitionJson,metadata=null}) {
    return this.repositories.themes.saveDraft({ id, target, label, definitionJson, metadata });
  }

  publishUserTheme({id,version,definitionJson,contentHash,metadata=null}) {
    return this.repositories.themes.publish({ id, version, definitionJson, contentHash, metadata });
  }

  archiveUserTheme(id) { return this.repositories.themes.archive(id); }
  userThemeVersions(id) { return this.repositories.themes.versions(id); }
  getUserThemeVersion(id,version) { return this.repositories.themes.getVersion(id, version); }
  getThemeMetadata(id) { return this.repositories.themes.getMetadata(id); }
  saveThemeMetadata(input) { return this.repositories.themes.saveMetadata(input); }
  getThemeVersionMetadata(id) { return this.repositories.themes.getVersionMetadata(id); }
  recordThemeUsage(input) { return this.repositories.themes.recordUsage(input); }
  themeUsageStats(id) { return this.repositories.themes.usageStats(id); }
  getThemeRoutingDecision(input) { return this.repositories.themes.getRoutingDecision(input); }
  saveThemeRoutingDecision(input) { return this.repositories.themes.saveRoutingDecision(input); }
  listRecentThemeRouting(input) { return this.repositories.themes.listRecentRouting(input); }
  listBatchThemeRouting(input) { return this.repositories.themes.listBatchRouting(input); }
  themeArchiveImpact(id) { return this.repositories.themes.archiveImpact(id); }
  recordSocialTemplateMetric(input) { return this.repositories.socialTemplateMetrics.record(input); }
  listSocialTemplateMetrics(input = {}) { return this.repositories.socialTemplateMetrics.list(input); }
  socialTemplateMetricsStats(input = {}) { return this.repositories.socialTemplateMetrics.stats(input); }
  recordSocialTemplateProposalMetric(input) { return this.repositories.socialTemplateProposalMetrics.record(input); }
  listSocialTemplateProposalMetrics(input = {}) { return this.repositories.socialTemplateProposalMetrics.list(input); }
  socialTemplateProposalMetricsStats(input = {}) { return this.repositories.socialTemplateProposalMetrics.stats(input); }
}
