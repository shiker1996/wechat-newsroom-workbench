// 图文业务垂直入口。
// 生产调用方从这里获取图文事实、门禁、故事板和交付流水线能力。
export {
  SOCIAL_CARD_STAGE_CONTRACT,
  SOCIAL_CARD_COMPOSITION_MODES,
  SOCIAL_CARD_LAYOUTS,
  acceptSoftDensityOnlyLayoutReport,
  adaptiveContentPageIndexes,
  cleanCardPlanJson,
  describeCardLayouts,
  normalizeCardComposition,
  renderStoryboardHtml,
  runAudit,
  runSocialCardPipeline,
} from './application/social-card-pipeline.mjs';
export { SOCIAL_CARD_BEAUTIFY_DELIVERY_GATE, SOCIAL_CARD_BEAUTIFY_HTML, SOCIAL_CARD_BEAUTIFY_OUTPUT, SOCIAL_CARD_BEAUTIFY_REPORT, applyBeautifyShellPatch, buildBeautifyShell, extractBeautifiedHtml, extractBeautifyPatch, runSocialCardBeautify, validateAiVisualScreenshotSet, validateBeautifiedHtml, validateBeautifyPatch } from './application/social-card-beautify.mjs';
export { buildSocialCardCopyInput, buildSocialCardCopySkillPrompt, buildSocialCardCopySystemPrompt, generateSocialCardCopy, validateSocialCardCopy } from './application/social-card-copy.mjs';
export { SOCIAL_CARD_AI_VISUAL_ARTIFACTS, SOCIAL_CARD_AI_VISUAL_FAILURE_CODES, classifySocialCardAiVisualFailure, collectSocialCardAiVisualArtifacts, writeSocialCardAiVisualBaseline } from './application/social-card-ai-visual-baseline.mjs';
export { SOCIAL_CARD_AI_VISUAL_STAGE_CONTRACT, createSocialCardAiVisualStageRecorder, writeSocialCardAiVisualSkillManifest } from './application/social-card-ai-visual-pipeline.mjs';
export { filterAiVisualGenerationCatalog, runSocialCardAiVisualGenerationAgent } from './application/social-card-ai-visual-agent.mjs';
export { filterAiVisualRepairCatalog, runSocialCardAiVisualRepairAgent } from './application/social-card-ai-visual-repair-agent.mjs';

export { CUSTOM_CONTENT_TYPES, CUSTOM_SOURCE_LEVELS, evaluateCardGate, evaluateClassifiedCardGate, evaluateCustomCardGate, evaluateEventCardGate } from './domain/social-card-gate.mjs';
export { buildCustomFactSheet, customFactMarkdown, customSourceUrl, parseLines, parsePointLine } from './application/custom-fact-service.mjs';
export { createRepositoryCandidate } from './application/repository-candidate.mjs';
export { BUILTIN_SOCIAL_CARD_STORYBOARD_SKILLS, SOCIAL_CARD_STORYBOARD_CONTRACTS, buildSocialCardFactEnvelope, buildSocialCardStoryboardSystemPrompt, toLegacySocialCardPromptInput } from './application/storyboard-contracts.mjs';
export { SOCIAL_CONTENT_TYPES, SOCIAL_ROUTE_VERSION, contentTypeForSocialRoute, normalizeSocialContentClass, socialRouteForContentClass, socialRouteForContentType, socialStoryboardClassForContentClass, socialStoryboardSkillForContentClass } from './domain/social-routing.mjs';
export { CUSTOM_SOCIAL_AGENT_CAPABILITIES, runCustomSocialAgentTurn } from './application/agent/custom-social-adapter.mjs';
export { enrichEventAnalysis, eventGroupsForCandidate, resolveEventAnalysis } from '../research/index.mjs';
