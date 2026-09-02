// 研究业务垂直入口。
// HTTP、后台任务和其他业务能力只应从这里取得研究用例与只读投影，
// 不再直接穿透到 llm/domain 的历史目录。
export {
  DIMENSION_POOL_ROLES,
  brainstorm,
  clusterItems,
  deterministicTimeliness,
  dimensionSelections,
  ensureBatchEventCards,
  focusedCategories,
  generateEventCards,
  isFreshForBatch,
  isSocialCardCandidate,
  markdownRanked,
  preselection,
  resolveScoring,
  scoreCards,
  selectArticlePool,
  selectBriefPool,
  selectDimensionPool,
  selectSocialPool,
  selectSocialCandidates,
  topicValueForEvent,
  runResearchPipeline,
} from './application/research-pipeline.mjs';

export { eventGroupsForCandidate, resolveEventAnalysis, synthesizeEventAnalysis } from './application/event-fact-service.mjs';
export { enrichEventAnalysis, readEventAnalysisCache, sourceInput as eventResearchSourceInput, sourceSignature as eventResearchSourceSignature } from './application/event-research-analysis.mjs';
export { loadStableBatchEvents, resolveStableBatchEvents } from './application/stable-event-service.mjs';
export { runEventResolutionBackfill, writeEventResolutionBackfillReport } from './application/event-resolution-backfill.mjs';
export { buildEventResolutionOperationsMetrics, readEventResolutionReview } from './application/event-resolution-operations.mjs';
export { buildTopicScoreOperationsMetrics } from './application/topic-score-operations.mjs';
export { CandidateSelectionService } from './application/candidate-selection-service.mjs';
export { classifyResearchFailure, recordResearchFailure } from './application/research-failure.mjs';
export { buildEventHeatRanking, loadPreviousEventHeatItems, scoreClassifiedEvent, scoreEventHeat } from './domain/event-heat-ranking.mjs';
export { DISCUSSION_RESEARCH_SCHEMA_VERSION, DISCUSSION_RESEARCH_TOP_K, DISCUSSION_RESEARCH_TOP_K_OPTIONS, resolveDiscussionResearchTopK, DISCUSSION_RESEARCH_EXCLUDED_CONTENT_CLASSES, buildDiscussionResearch, discussionResearchMarkdown, readDiscussionResearchContext } from './domain/discussion-research.mjs';
export {
  RESEARCH_SEARCH_SCHEMA_VERSION,
  RESEARCH_SEARCH_TASK_TYPES,
  RESEARCH_SEARCH_TARGETS,
  RESEARCH_SEARCH_RELATION_AXES,
  RESEARCH_SEARCH_POLICY,
  buildResearchSearchBaseline,
  buildInternalResearchSearchTasks,
  buildRelationResearchSearchTasks,
  emptyResearchSearchLedger,
  normalizeResearchSearchTask,
  validateResearchSearchTask,
} from './domain/research-search.mjs';
export { executeInternalResearchSearch, researchSearchEvidenceForEvent } from './application/research-search-stage.mjs';
export {
  buildDiscussionResearchModelInput,
  buildDiscussionResearchModelMessages,
  buildSingleEventResearchModelInput,
  buildDiscussionRelationCandidateGroups,
  buildDiscussionRelationCandidatePairs,
  buildInternalResearchModelInput,
  buildRelationResearchModelInput,
  buildTopicResearchModelInput,
  cleanSingleEventResearchReport,
  generateDiscussionResearch,
  generateDiscussionResearchSinglePass,
  generateDiscussionResearchHypotheses,
  generateDiscussionResearchTopics,
  normalizeDiscussionResearchModel,
  verifyDiscussionResearch,
  buildVerifiedResearchMaterials,
} from './application/research/discussion-research-stage.mjs';
export { buildTopicCandidates, selectTopicCandidates, topicCandidatesMarkdown, discussionQuestionForContext } from './domain/topic-candidate-generation.mjs';
export { projectStableEvents } from './domain/event-resolution-cluster-projection.mjs';
export { duplicatePenaltyForHeat, EVENT_RESOLUTION_POLICY } from './domain/event-resolution-policy.mjs';
export { loadShadowHistory, materializeStableEvents, resolveEventShadow, structuredMatch, buildEventTitle } from './domain/event-resolution-shadow.mjs';
export { clusterItems as clusterResearchItems, isFreshForBatch as isResearchItemFresh, tagsOf } from './domain/hotspot-clustering.mjs';
export { isResearchEligibleHotspot } from './domain/hotspot-pipeline-scope.mjs';
export { buildHotspotAtlas } from './rendering/hotspot-atlas.mjs';
export { dimensionPartsOf } from './domain/hotspot-dimensions.mjs';
export { classifyContentRoute, deriveClassificationFeatures, isPureProjectEvent, normalizeEventClassification, scoreStatusForCard } from './domain/content-routing.mjs';
export { G_SOCIAL_CLASS_CAPS, G_SOCIAL_THRESHOLDS, G_SOCIAL_WEIGHTS, scoreSocialCandidate } from './domain/social-scoring.mjs';
