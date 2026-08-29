import fs from 'node:fs';
import path from 'node:path';

export const SOCIAL_CARD_AI_VISUAL_STAGE_CONTRACT = Object.freeze([
  { id: 'inputs', skill: 'fixed-program' },
  { id: 'copy', skill: 'xiaohongshu-article-generator' },
  { id: 'generation', skill: 'social-card-ai-visual-generator' },
  { id: 'screenshots', skill: 'html-pages-to-images' },
  { id: 'delivery-gate', skill: 'fixed-program' },
]);

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function skillSnapshot(bundle) {
  if (!bundle) return null;
  return {
    skill: bundle.skillName || bundle.writerSkill || '',
    hash: bundle.hash || '',
    files: Array.isArray(bundle.files) ? [...bundle.files] : [],
    fallback: Boolean(bundle.fallback),
    manifestStatus: bundle.manifestStatus || '',
  };
}

export function writeSocialCardAiVisualSkillManifest({
  workdir,
  runtime = null,
  bundles = [],
  catalog = [],
  purpose = 'social-card-ai-visual',
} = {}) {
  if (!workdir) throw new TypeError('缺少 AI 视觉技能清单工作目录');
  const manifest = {
    schemaVersion: 1,
    purpose,
    generatedAt: new Date().toISOString(),
    snapshotId: runtime?.snapshotId || null,
    provider: runtime?.provider || '',
    model: runtime?.providerConfig?.model || runtime?.providerConfig?.provider?.model || '',
    skills: bundles.map(skillSnapshot).filter(Boolean),
    allowedCapabilities: Array.isArray(runtime?.allowedCapabilities) ? [...runtime.allowedCapabilities] : null,
    tools: (Array.isArray(catalog) ? catalog : []).map((item) => ({
      capability: item.capability || '',
      name: item.name || '',
      riskLevel: item.implementations?.[0]?.riskLevel || '',
    })),
  };
  const filePath = path.join(workdir, 'social-card-ai-visual-skill-manifest.json');
  writeJson(filePath, manifest);
  return { path: filePath, manifest };
}

export function createSocialCardAiVisualStageRecorder({
  workdir,
  batchId = null,
  candidateId = null,
  snapshotId = null,
} = {}) {
  if (!workdir) throw new TypeError('缺少 AI 视觉阶段记录工作目录');
  const executionsPath = path.join(workdir, 'social-card-ai-visual-stage-executions.json');
  const stages = [];

  const persist = () => writeJson(executionsPath, {
    schemaVersion: 1,
    pipeline: 'social-card-ai-visual',
    batchId,
    candidateId,
    snapshotId,
    updatedAt: new Date().toISOString(),
    stages,
  });

  const assertNextStage = (stage, skill) => {
    const expected = SOCIAL_CARD_AI_VISUAL_STAGE_CONTRACT[stages.length];
    if (!expected || expected.id !== stage || expected.skill !== skill) {
      throw new Error(`AI 视觉契约阶段不一致：期望 ${expected?.id || '结束'}/${expected?.skill || '-'}，实际 ${stage}/${skill}`);
    }
    return expected;
  };

  const start = (stage, {
    skill = 'fixed-program',
    inputArtifacts = [],
    outputArtifact = '',
    detail = '',
    metadata = {},
  } = {}) => {
    assertNextStage(stage, skill);
    const entry = {
      stage,
      skill,
      inputArtifacts: Array.isArray(inputArtifacts) ? [...inputArtifacts] : [inputArtifacts].filter(Boolean),
      outputArtifact,
      status: 'running',
      gate: 'pending',
      detail,
      metadata: metadata && typeof metadata === 'object' ? { ...metadata } : {},
      startedAt: new Date().toISOString(),
      completedAt: '',
    };
    stages.push(entry);
    persist();
    let closed = false;
    const close = ({ status = 'completed', gate = status === 'completed' ? 'passed' : status, outputArtifact: finalOutput = outputArtifact, detail: finalDetail = detail, metadata: finalMetadata = {} } = {}) => {
      if (closed) return entry;
      closed = true;
      entry.status = status;
      entry.gate = gate;
      entry.outputArtifact = finalOutput;
      entry.detail = finalDetail;
      entry.metadata = { ...entry.metadata, ...(finalMetadata && typeof finalMetadata === 'object' ? finalMetadata : {}) };
      entry.completedAt = new Date().toISOString();
      persist();
      return entry;
    };
    return {
      entry,
      finish: (options = {}) => close(options),
      fail: (error, options = {}) => close({ ...options, status: 'failed', gate: 'failed', detail: options.detail || error?.message || String(error || '阶段失败') }),
    };
  };

  const failCurrent = (error) => {
    const current = stages.at(-1);
    if (!current || current.status !== 'running') return;
    current.status = 'failed';
    current.gate = 'failed';
    current.detail = error?.message || String(error || '阶段失败');
    current.completedAt = new Date().toISOString();
    persist();
  };

  return {
    path: executionsPath,
    start,
    failCurrent,
    get stages() { return stages.map((stage) => ({ ...stage, inputArtifacts: [...stage.inputArtifacts], metadata: { ...stage.metadata } })); },
  };
}
