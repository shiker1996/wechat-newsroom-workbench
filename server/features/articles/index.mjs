// 文章业务垂直入口。
// 生产路由、任务和编辑代理从这里取得文章生成、排版、配图和视觉规划能力。
export {
  ARTICLE_LENGTH_RANGE,
  ARTICLE_STAGE_CONTRACT,
  articleLengthStatus,
  articleStageOutputIssue,
  authorizedWritingBrief,
  buildArticleStageSystem,
  buildDraftUserPrompt,
  buildPublicationClaimRegister,
  compositeSourceText,
  extractArticleTitle,
  normalizePlanningResult,
  publicationComplianceIssue,
  publicationCompliancePrompt,
  publicationFactBaseIssues,
  runArticlePipeline,
  scanPublicationRisk,
  selectWriterSkill,
  sourceCacheIssue,
  unverifiedFactBaseIssue,
} from './application/article-pipeline.mjs';

export {
  TYPESET_STAGE_CONTRACT,
  TYPESET_THEMES,
  defaultTypesetTheme,
  enforceWechatFlowLayout,
  extractHtmlModelOutput,
  htmlPreservesStructure,
  markdownToHtml,
  runTypesetPipeline,
} from './application/typeset-pipeline.mjs';

export { mapBreakingArticleScore, normalizeScore, routeBreakingAnalysis, runBreakingAnalysisPipeline } from './llm/breaking-analysis-pipeline.mjs';
export { dailyFocusOptions, dailyVisibleChars, normalizeDailyQuality, runDailyPipeline, selectDailyEvents } from './llm/daily-pipeline.mjs';
export { runTutorialPipeline, tutorialVisibleChars } from './llm/tutorial-pipeline.mjs';
export { analyzeVisualComplexity, normalizeVisualPlan, planArticleVisuals, insertVisualFences } from './llm/visual-planner.mjs';
export { imageManifestFile, planImagePlaceholders, registerGeneratedImageAssets, uploadImageToCdn, buildImagesMarkdown, applyImagePlan, parseImagePlaceholders, saveImageMetadata, registerGeneratedSlotImage, getImageWorkspace, saveLocalImage } from './application/image-workflow.mjs';
export { generateArticleImage } from './application/article-image-generator.mjs';
export { runCoverImageJob } from './application/cover-image-generator.mjs';
export { runAiVisualCoverJob } from './application/ai-visual-cover-generator.mjs';
export { AI_VISUAL_COVER_STAGE_CONTRACT, createAiVisualCoverStageRecorder, writeAiVisualCoverDeliveryGate, writeAiVisualCoverGenerationReport, writeAiVisualCoverSkillManifest } from './application/ai-visual-cover-pipeline.mjs';
export { AI_VISUAL_COVER_FINAL_HTML, AI_VISUAL_COVER_HEIGHT, AI_VISUAL_COVER_HTML, AI_VISUAL_COVER_WIDTH, buildAiVisualCoverScaffold, buildCoverThemeSnapshot, buildCoverVisualInput } from './application/ai-visual-cover-composer.mjs';
export { evaluateEditorialReadiness, substantiveDecision, confirmedFactsDecision, researchBasisDecision, EDITORIAL_FIELDS } from './domain/editorial-readiness.mjs';
export { normalizeResearchPoints, researchPointsComplete, mergeResearchPoints, normalizeRejectedAngles } from './domain/research-selection.mjs';
export { normalizeResearchCoverageResult, researchCoverageNeedsRevision } from './domain/research-coverage.mjs';
export { finalizeEditorialResult, buildEditorialMessages } from './llm/editorial-room.mjs';
export { EDITORIAL_AGENT_CAPABILITIES, runEditorialAgentTurn } from './application/agent/editorial-adapter.mjs';
export { TUTORIAL_AGENT_CAPABILITIES, runTutorialAgentTurn, tutorialProjectAttachmentArguments } from './application/agent/tutorial-adapter.mjs';
