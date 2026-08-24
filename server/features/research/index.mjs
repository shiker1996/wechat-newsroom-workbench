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
  selectSocialCandidates,
  topicValueForEvent,
  runResearchPipeline,
} from './application/research-pipeline.mjs';

export { eventGroupsForCandidate, resolveEventAnalysis, synthesizeEventAnalysis } from './application/event-fact-service.mjs';
export { loadStableBatchEvents, resolveStableBatchEvents } from './application/stable-event-service.mjs';
export { runEventResolutionBackfill, writeEventResolutionBackfillReport } from './application/event-resolution-backfill.mjs';
export { buildEventResolutionOperationsMetrics, readEventResolutionReview } from './application/event-resolution-operations.mjs';
export { buildTopicScoreOperationsMetrics } from './application/topic-score-operations.mjs';
export { CandidateSelectionService } from './application/candidate-selection-service.mjs';
export { classifyResearchFailure, recordResearchFailure } from './application/research-failure.mjs';
export { buildEventHeatRanking, loadPreviousEventHeatItems, scoreEventHeat } from './domain/event-heat-ranking.mjs';
export { projectStableEvents } from './domain/event-resolution-cluster-projection.mjs';
export { duplicatePenaltyForHeat, EVENT_RESOLUTION_POLICY } from './domain/event-resolution-policy.mjs';
export { loadShadowHistory, materializeStableEvents, resolveEventShadow, structuredMatch, buildEventTitle } from './domain/event-resolution-shadow.mjs';
export { clusterItems as clusterResearchItems, isFreshForBatch as isResearchItemFresh, tagsOf } from './domain/hotspot-clustering.mjs';
export { isResearchEligibleHotspot } from './domain/hotspot-pipeline-scope.mjs';
export { buildHotspotAtlas } from './rendering/hotspot-atlas.mjs';
export { dimensionPartsOf } from './domain/hotspot-dimensions.mjs';
