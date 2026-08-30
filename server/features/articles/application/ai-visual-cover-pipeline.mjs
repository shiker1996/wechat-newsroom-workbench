import fs from 'node:fs';
import path from 'node:path';

export const AI_VISUAL_COVER_STAGE_CONTRACT = Object.freeze([
  { id: 'inputs', skill: 'fixed-program' },
  { id: 'generation', skill: 'article-cover-ai-visual-generator' },
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
    skill: bundle.skillName || '',
    hash: bundle.hash || '',
    files: Array.isArray(bundle.files) ? [...bundle.files] : [],
    fallback: Boolean(bundle.fallback),
    manifestStatus: bundle.manifestStatus || '',
  };
}

export function writeAiVisualCoverSkillManifest({ workdir, runtime = null, bundles = [], catalog = [] } = {}) {
  const manifest = {
    schemaVersion: 1,
    purpose: 'article-cover-ai-visual',
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
  const filePath = path.join(workdir, 'cover-ai-skill-manifest.json');
  writeJson(filePath, manifest);
  return { path: filePath, manifest };
}

export function createAiVisualCoverStageRecorder({ workdir, batchId = null, candidateId = null, snapshotId = null } = {}) {
  if (!workdir) throw new TypeError('缺少 AI 封面阶段记录工作目录');
  const executionsPath = path.join(workdir, 'cover-ai-stage-executions.json');
  const stages = [];
  const persist = () => writeJson(executionsPath, {
    schemaVersion: 1,
    pipeline: 'article-cover-ai-visual',
    batchId,
    candidateId,
    snapshotId,
    updatedAt: new Date().toISOString(),
    stages,
  });
  const assertNextStage = (stage, skill) => {
    const expected = AI_VISUAL_COVER_STAGE_CONTRACT[stages.length];
    if (!expected || expected.id !== stage || expected.skill !== skill) throw new Error(`AI 封面契约阶段不一致：期望 ${expected?.id || '结束'}/${expected?.skill || '-'}，实际 ${stage}/${skill}`);
  };
  const start = (stage, { skill = 'fixed-program', inputArtifacts = [], outputArtifact = '', detail = '', metadata = {} } = {}) => {
    assertNextStage(stage, skill);
    const entry = { stage, skill, inputArtifacts: Array.isArray(inputArtifacts) ? [...inputArtifacts] : [inputArtifacts].filter(Boolean), outputArtifact, status: 'running', gate: 'pending', detail, metadata: { ...metadata }, startedAt: new Date().toISOString(), completedAt: '' };
    stages.push(entry);
    persist();
    let closed = false;
    const close = ({ status = 'completed', gate = status === 'completed' ? 'passed' : status, outputArtifact: finalOutput = outputArtifact, detail: finalDetail = detail, metadata: finalMetadata = {} } = {}) => {
      if (closed) return entry;
      closed = true;
      Object.assign(entry, { status, gate, outputArtifact: finalOutput, detail: finalDetail, metadata: { ...entry.metadata, ...finalMetadata }, completedAt: new Date().toISOString() });
      persist();
      return entry;
    };
    return { entry, finish: (options = {}) => close(options), fail: (error, options = {}) => close({ ...options, status: 'failed', gate: 'failed', detail: options.detail || error?.message || String(error || '阶段失败') }) };
  };
  return { path: executionsPath, start, get stages() { return stages.map((stage) => ({ ...stage, inputArtifacts: [...stage.inputArtifacts], metadata: { ...stage.metadata } })); } };
}

export function writeAiVisualCoverGenerationReport({ workdir, mode = 'ai-visual', status = 'passed', theme = {}, routing = null, agent = null, inputs = [], artifacts = {} } = {}) {
  const report = {
    schemaVersion: 1,
    mode,
    status,
    generatedAt: new Date().toISOString(),
    theme: { id: theme.id || '', label: theme.label || '', version: theme.version || '', hash: theme.hash || '' },
    routing,
    inputs: [...inputs],
    artifacts: { ...artifacts },
    agent: agent ? { type: agent.type || '', agentRunId: agent.agentRunId || null, modelSteps: agent.modelSteps || 0, toolCalls: agent.toolCalls || 0, pageCount: agent.pageCount || 0, documentFinished: agent.documentFinished === true } : null,
  };
  const filePath = path.join(workdir, 'cover-ai-generation.json');
  writeJson(filePath, report);
  return { path: filePath, report };
}

export function writeAiVisualCoverDeliveryGate({ workdir, status, registered = false, checks = {}, artifacts = {}, reason = '' } = {}) {
  const gate = { schemaVersion: 1, status, registered: Boolean(registered), checkedAt: new Date().toISOString(), reason, checks, artifacts };
  const filePath = path.join(workdir, 'cover-ai-delivery-gate.json');
  writeJson(filePath, gate);
  return { path: filePath, gate };
}
