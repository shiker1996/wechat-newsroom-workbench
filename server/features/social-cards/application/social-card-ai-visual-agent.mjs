import {
  AI_VISUAL_DOCUMENT_WRITE,
  filterAiVisualGenerationCatalog,
  runAiVisualDocumentAgent,
  shouldUseAiVisualPlanningThinking,
} from '../../../platform/agent/ai-visual-document-agent.mjs';

export {
  AI_VISUAL_DOCUMENT_WRITE,
  filterAiVisualGenerationCatalog,
  shouldUseAiVisualPlanningThinking,
};

/**
 * Social card compatibility wrapper around the shared AI visual document Agent.
 *
 * Keep this feature-level entry point stable so existing callers retain the
 * social-card-specific output contract while the protocol implementation can
 * also be reused by article cover generation.
 */
export async function runSocialCardAiVisualGenerationAgent(options = {}) {
  return runAiVisualDocumentAgent({
    ...options,
    entryPoint: 'social-card-ai-visual-generation',
    skillId: 'social-card-ai-visual-generator',
    purpose: 'social-card-ai-visual-generation-agent',
    outputPath: 'ai-beautified.html',
    documentLabel: '社交卡',
    canvas: { width: 375, height: 667 },
  });
}
