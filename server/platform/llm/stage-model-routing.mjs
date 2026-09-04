// 流程阶段模型路由只负责选择已配置的 provider；不改变业务 Agent、Skill 或工具协议。
// 页面只配置 fast / balanced / quality 三个模型档位；deterministic 是固定的程序化档位。
// 流程节点到档位的映射在这里维护，未命中配置时回退到调用方传入的 provider。

export const MODEL_PROFILE_KEYS = Object.freeze(['fast', 'balanced', 'quality', 'deterministic']);

export const DEFAULT_STAGE_PROFILES = Object.freeze({
  collection: 'fast',
  'collection.field-enrichment': 'fast',
  'collection.candidate-ranking': 'fast',
  tagging: 'fast',
  'event-card': 'fast',
  research: 'quality',
  'research.brainstorm': 'balanced',
  'research.synthesis': 'quality',
  'editorial-room': 'quality',
  drafting: 'quality',
  'drafting.fact-base': 'quality',
  'material-brief': 'quality',
  'drafting.planning': 'quality',
  'drafting.body': 'quality',
  'drafting.title': 'quality',
  'drafting.humanize': 'quality',
  'drafting.review': 'quality',
  'drafting.seo': 'quality',
  'drafting.final-gate': 'quality',
  'drafting.visual-plan': 'quality',
  typeset: 'deterministic',
  'typeset.design': 'fast',
  'typeset.html-llm': 'balanced',
  'visual-theme-routing': 'balanced',
  'cover.semantic-analysis': 'balanced',
  'cover.ai-visual': 'quality',
  'graphic-analysis.event': 'quality',
  'graphic-analysis.facts': 'deterministic',
  'storyboard.plan': 'balanced',
  'graphic-generation.copy': 'balanced',
  'graphic-generation.content-plan': 'fast',
  'graphic-generation.layout-repair': 'fast',
});

export const MODEL_PROFILE_UI_FIELDS = Object.freeze(MODEL_PROFILE_KEYS.map((profile) => Object.freeze({ field: profile, profile })));

const PURPOSE_STAGE_RULES = Object.freeze([
  [/^source-field-enrichment$/, 'collection.field-enrichment'],
  [/^source-candidate-ranking$/, 'collection.candidate-ranking'],
  [/^repo-discovery-(queries|interest-filter)$/, 'collection'],
  [/^hotspot-tagging$/, 'tagging'],
  [/^event-card$/, 'event-card'],
  [/^(discussion-research|breaking-analysis)$/, 'research'],
  [/^event-research-analysis$/, 'graphic-analysis.event'],
  [/^hotspot-brainstorm-explore$/, 'research.brainstorm'],
  [/^hotspot-synthesis-provisional$/, 'research.synthesis'],
  [/^composite-score$/, 'research.synthesis'],
  [/^editorial-room$/, 'editorial-room'],
  [/^article-fact-base$/, 'drafting.fact-base'],
  [/^material-brief$/, 'material-brief'],
  [/^article-planning$/, 'drafting.planning'],
  [/^(article|tutorial|daily)-drafting(?:-pipeline)?$/, 'drafting.body'],
  [/^article-drafting-pipeline$/, 'drafting.body'],
  [/^(title-generation|article-title-generation|tutorial-title-generation|daily-title-generation)/, 'drafting.title'],
  [/humanize/, 'drafting.humanize'],
  [/(?:article|tutorial|daily)-review/, 'drafting.review'],
  [/(?:article|tutorial|daily)-seo/, 'drafting.seo'],
  [/(?:quality-gate|publication-compliance|article-length-gate)/, 'drafting.final-gate'],
  [/^article-(?:visual-plan|image-plan)/, 'drafting.visual-plan'],
  [/^theme-routing-(article|social|cover)$/, 'visual-theme-routing'],
  [/^magazine-design$/, 'typeset.design'],
  [/^typeset-html$/, 'typeset.html-llm'],
  [/^cover-semantic-analysis$/, 'cover.semantic-analysis'],
  [/^article-cover-ai-visual/, 'cover.ai-visual'],
  [/^social-card-editorial/, 'storyboard.plan'],
  [/^social-card-(?:page-restructure|page-regeneration)$/, 'storyboard.repair'],
  [/^social-card-cover-title-lines$/, 'graphic-generation.copy'],
  [/^social-card-copy$/, 'graphic-generation.copy'],
  [/^social-card-content-planner$/, 'graphic-generation.content-plan'],
  [/^social-card-layout-repair$/, 'graphic-generation.layout-repair'],
]);

const UI_FIELD_STAGE_MAP = Object.freeze({
  collection: 'collection',
  collectionFieldEnrichment: 'collection.field-enrichment',
  collectionCandidateRanking: 'collection.candidate-ranking',
  tagging: 'tagging',
  eventCard: 'event-card',
  research: 'research',
  researchBrainstorm: 'research.brainstorm',
  researchSynthesis: 'research.synthesis',
  editorialRoom: 'editorial-room',
  drafting: 'drafting',
  draftingFactBase: 'drafting.fact-base',
  draftingPlanning: 'drafting.planning',
  draftingBody: 'drafting.body',
  draftingTitle: 'drafting.title',
  draftingReview: 'drafting.review',
  draftingSeo: 'drafting.seo',
  draftingFinalGate: 'drafting.final-gate',
  draftingVisualPlan: 'drafting.visual-plan',
  typesetDesign: 'typeset.design',
  typesetHtmlLlm: 'typeset.html-llm',
  coverThemeRouting: 'visual-theme-routing',
  coverSemanticAnalysis: 'cover.semantic-analysis',
  coverAiVisual: 'cover.ai-visual',
  graphicAnalysis: 'graphic-analysis.event',
  storyboard: 'storyboard.plan',
  graphicGeneration: 'graphic-generation.copy',
  graphicGenerationContentPlan: 'graphic-generation.content-plan',
  graphicGenerationLayoutRepair: 'graphic-generation.layout-repair',
});

export const STAGE_MODEL_UI_FIELDS = Object.freeze(Object.entries(UI_FIELD_STAGE_MAP)
  .map(([field, stage]) => Object.freeze({ field, stage })));

export function stageForPurpose(purpose) {
  const key = String(purpose || '');
  return PURPOSE_STAGE_RULES.find(([pattern]) => pattern.test(key))?.[1] || '';
}

function ancestors(stage) {
  const value = String(stage || '').trim();
  if (!value) return [];
  const parts = value.split('.');
  return [value, ...parts.slice(0, -1).map((_, index) => parts.slice(0, parts.length - index - 1).join('.'))];
}

function configuredValue(stageModels, stage) {
  for (const key of ancestors(stage)) {
    const value = stageModels?.[key];
    if (typeof value === 'string' && value.trim()) return { key, value: value.trim() };
  }
  return null;
}

export function normalizeStageModels(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, provider]) => [String(key).trim(), String(provider ?? '').trim()])
    .filter(([key, provider]) => key && provider));
}

export function normalizeModelProfiles(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([profile]) => MODEL_PROFILE_KEYS.includes(profile))
    .map(([profile, provider]) => [profile, String(provider ?? '').trim()])
    .filter(([, provider]) => provider));
}

export function modelProfilesFromUiFields(value) {
  return normalizeModelProfiles(Object.fromEntries(MODEL_PROFILE_UI_FIELDS.map(({ field, profile }) => [profile, value?.[field]])));
}

export function stageModelsFromProfiles(value) {
  const profiles = normalizeModelProfiles(value);
  // 没有配置档位时不主动改变旧任务的单模型行为。
  if (!Object.keys(profiles).length) return {};
  return Object.fromEntries(Object.entries(DEFAULT_STAGE_PROFILES).flatMap(([stage, profile]) => {
    const provider = profiles[profile] || (profile === 'deterministic' ? 'deterministic' : '');
    return provider ? [[stage, provider]] : [];
  }));
}

export function stageModelsFromUiFields(value) {
  const normalized = {};
  for (const { field, stage } of STAGE_MODEL_UI_FIELDS) {
    const provider = String(value?.[field] ?? '').trim();
    if (provider) normalized[stage] = provider;
  }
  return normalized;
}

export function resolveStageModelProvider({ stage = '', purpose = '', stageModels = {}, providers = {}, fallbackProvider = '' } = {}) {
  const effectiveStage = String(stage || '').trim() || stageForPurpose(purpose);
  const configured = configuredValue(stageModels, effectiveStage);
  if (!configured) return { stage: effectiveStage, provider: fallbackProvider || '', configured: false, disabled: false };
  if (configured.value === 'deterministic' || configured.value === 'none') {
    return { stage: effectiveStage, provider: '', configured: true, disabled: true, source: configured.key };
  }
  if (!providers[configured.value]) {
    throw new Error(`阶段模型配置无效：${effectiveStage} → ${configured.value}（模型服务不存在或未加载）`);
  }
  return { stage: effectiveStage, provider: configured.value, configured: true, disabled: false, source: configured.key };
}

export function resolveStageModelsSnapshot({ stageModels = {}, providers = {} } = {}) {
  const normalized = normalizeStageModels(stageModels);
  const resolved = {};
  for (const [stage, configuredProvider] of Object.entries(normalized)) {
    if (configuredProvider === 'deterministic' || configuredProvider === 'none') {
      resolved[stage] = { provider: '', model: '', disabled: true };
      continue;
    }
    if (!providers[configuredProvider]) {
      throw new Error(`阶段模型配置无效：${stage} → ${configuredProvider}（模型服务不存在或未加载）`);
    }
    resolved[stage] = { provider: configuredProvider, model: String(providers[configuredProvider].model || ''), disabled: false };
  }
  return resolved;
}
