import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SOCIAL_CARD_AI_VISUAL_FAILURE_CODES = Object.freeze({
  INPUTS: 'inputs',
  COPY: 'copy',
  MODEL_JSON_TRUNCATED: 'model-json-truncated',
  AGENT_BUDGET: 'agent-budget',
  SCREENSHOTS: 'screenshots',
  DELIVERY_GATE: 'delivery-gate',
  UNKNOWN: 'unknown',
});

export const SOCIAL_CARD_AI_VISUAL_ARTIFACTS = Object.freeze([
  { name: 'card-plan.json', stage: 'inputs', required: true },
  { name: 'repository-fact-sheet.json', stage: 'inputs', required: false },
  { name: 'event-analysis.json', stage: 'inputs', required: false },
  { name: 'custom-fact-sheet.json', stage: 'inputs', required: false },
  { name: 'ai-visual-card-plan.json', stage: 'inputs', required: false },
  { name: 'social-theme-snapshot.json', stage: 'inputs', required: true },
  { name: 'copy.txt', stage: 'copy', required: true },
  { name: 'social-theme-design-spec.md', stage: 'inputs', required: true },
  { name: 'my-design.html', stage: 'programmatic-render', required: false },
  { name: 'ai-beautified.html', stage: 'generation', required: false },
  { name: 'ai-beautified-delivery-gate.json', stage: 'delivery-gate', required: false },
  { name: 'ai-beautify-report.json', stage: 'delivery-gate', required: false },
  { name: 'social-card-ai-visual-skill-manifest.json', stage: 'inputs', required: false },
  { name: 'social-card-ai-visual-stage-executions.json', stage: 'delivery-gate', required: false },
  { name: 'layout-report.json', stage: 'programmatic-render', required: false },
  { name: 'delivery-report.json', stage: 'programmatic-render', required: false },
  { name: 'ai-beautified-output', stage: 'screenshots', directory: true, required: false },
  { name: 'output', stage: 'programmatic-render', directory: true, required: false },
]);

function messageOf(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return [error.code, error.message, error.error?.message].filter(Boolean).join(' ');
}

export function classifySocialCardAiVisualFailure(error, { stage = '', source = 'runtime' } = {}) {
  const message = messageOf(error);
  const normalized = message.toLowerCase();
  let code = SOCIAL_CARD_AI_VISUAL_FAILURE_CODES.UNKNOWN;
  let inferredStage = stage || 'unknown';

  if (/配套文案|social-card-copy|话题标签/.test(normalized)) {
    code = SOCIAL_CARD_AI_VISUAL_FAILURE_CODES.COPY;
    inferredStage = stage || 'copy';
  } else if (/model_json_truncated|json.*截断|结构未闭合|输出达到上限/.test(normalized)) {
    code = SOCIAL_CARD_AI_VISUAL_FAILURE_CODES.MODEL_JSON_TRUNCATED;
    inferredStage = stage || 'agent';
  } else if (/agent_budget_exceeded|工具调用预算|模型步骤预算|总耗时预算|超过.*预算/.test(normalized)) {
    code = SOCIAL_CARD_AI_VISUAL_FAILURE_CODES.AGENT_BUDGET;
    inferredStage = stage || 'agent';
  } else if (/png|截图|screenshots|render.*image|生成图片/.test(normalized)) {
    code = SOCIAL_CARD_AI_VISUAL_FAILURE_CODES.SCREENSHOTS;
    inferredStage = stage || 'screenshots';
  } else if (/交付门禁|delivery.*gate|artifact|产物登记/.test(normalized)) {
    code = SOCIAL_CARD_AI_VISUAL_FAILURE_CODES.DELIVERY_GATE;
    inferredStage = stage || 'delivery-gate';
  } else if (/读取|来源|fact-sheet|card-plan|theme.*spec|layout.*guide/.test(normalized)) {
    code = SOCIAL_CARD_AI_VISUAL_FAILURE_CODES.INPUTS;
    inferredStage = stage || 'inputs';
  }

  return { code, stage: inferredStage, source, message };
}

function fileDigest(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return '';
  }
}

function describeArtifact(workdir, definition) {
  const artifactPath = path.join(workdir, definition.name);
  let exists = false;
  let size = 0;
  let modifiedAt = '';
  let digest = '';
  try {
    const stat = fs.statSync(artifactPath);
    exists = true;
    size = stat.isFile() ? stat.size : 0;
    modifiedAt = stat.mtime.toISOString();
    if (stat.isFile()) digest = `sha256:${fileDigest(artifactPath)}`;
  } catch {}
  return {
    name: definition.name,
    stage: definition.stage,
    required: Boolean(definition.required),
    type: definition.directory ? 'directory' : 'file',
    exists,
    size,
    modifiedAt,
    digest,
  };
}

export function collectSocialCardAiVisualArtifacts(workdir) {
  return SOCIAL_CARD_AI_VISUAL_ARTIFACTS.map((definition) => describeArtifact(workdir, definition));
}

export function writeSocialCardAiVisualBaseline({
  workdir,
  candidateId = null,
  batchId = null,
  contentType = '',
  channelMode = '',
  themeId = '',
  requiredPageCount = 0,
  storyboardPageCount = 0,
} = {}) {
  if (!workdir) throw new TypeError('缺少 AI 视觉基线工作目录');
  fs.mkdirSync(workdir, { recursive: true });
  const baseline = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    candidateId,
    batchId,
    contentType,
    channelMode,
    themeId,
    requiredPageCount: Number(requiredPageCount) || 0,
    storyboardPageCount: Number(storyboardPageCount) || 0,
    currentFlow: {
      entryPoint: 'social-card-beautify',
      agentEntryPoint: 'social-card-ai-visual',
      generationPhase: 'document_write begin + append + finish',
      copyPhase: 'shared social-card-copy before visual generation',
      screenshotsPhase: 'html-pages-to-images after generation',
      deliveryPhase: 'HTML + copy + PNG existence and count check',
      programmaticFallback: false,
    },
    failureTaxonomy: Object.values(SOCIAL_CARD_AI_VISUAL_FAILURE_CODES),
    artifacts: collectSocialCardAiVisualArtifacts(workdir),
  };
  const target = path.join(workdir, 'ai-visual-baseline.json');
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, target);
  return { path: target, baseline };
}
