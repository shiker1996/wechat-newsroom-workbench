import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifySocialCardAiVisualFailure, collectSocialCardAiVisualArtifacts, SOCIAL_CARD_AI_VISUAL_FAILURE_CODES, writeSocialCardAiVisualBaseline } from '../server/features/social-cards/application/social-card-ai-visual-baseline.mjs';
import { createSocialCardAiVisualStageRecorder, SOCIAL_CARD_AI_VISUAL_STAGE_CONTRACT, writeSocialCardAiVisualSkillManifest } from '../server/features/social-cards/application/social-card-ai-visual-pipeline.mjs';
import { filterAiVisualGenerationCatalog, runSocialCardAiVisualGenerationAgent, shouldUseAiVisualPlanningThinking } from '../server/features/social-cards/application/social-card-ai-visual-agent.mjs';
import { normalizeToolRequest, validateToolRequest } from '../server/platform/agent/tool-protocol.mjs';

test('AI 视觉 Agent 的工具理由过长时在严格校验前截断', () => {
  const request = normalizeToolRequest({ requestId: 'tr_visual', capability: 'filesystem.project.read', arguments: {}, reason: '很长的工具调用说明'.repeat(40) });
  assert.equal([...request.reason].length, 160);
  assert.equal(validateToolRequest(request).reason, request.reason);
});

test('AI 视觉基线统一归类模型、截图和交付错误', () => {
  assert.equal(classifySocialCardAiVisualFailure({ code: 'MODEL_JSON_TRUNCATED', message: 'JSON 被截断' }).code, SOCIAL_CARD_AI_VISUAL_FAILURE_CODES.MODEL_JSON_TRUNCATED);
  assert.equal(classifySocialCardAiVisualFailure('AI 视觉 Agent 达到工具调用预算').code, SOCIAL_CARD_AI_VISUAL_FAILURE_CODES.AGENT_BUDGET);
  assert.equal(classifySocialCardAiVisualFailure('PNG 截图生成失败').code, SOCIAL_CARD_AI_VISUAL_FAILURE_CODES.SCREENSHOTS);
});

test('AI 视觉基线枚举输入和输出产物，不读取候选目录之外的文件', () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-card-ai-visual-baseline-'));
  fs.writeFileSync(path.join(workdir, 'event-analysis.json'), '{"analysis":{}}', 'utf8');
  fs.writeFileSync(path.join(workdir, 'ai-beautified.html'), '<!doctype html><html></html>', 'utf8');
  const artifacts = collectSocialCardAiVisualArtifacts(workdir);
  assert.equal(artifacts.find((item) => item.name === 'event-analysis.json').exists, true);
  assert.equal(artifacts.find((item) => item.name === 'ai-beautified.html').exists, true);
  assert.equal(artifacts.find((item) => item.name === 'card-plan.json').required, true);
  assert.equal(artifacts.find((item) => item.name === 'ai-visual-card-plan.json').required, false);
  assert.equal(artifacts.find((item) => item.name === 'social-theme-snapshot.json').required, true);
  assert.equal(artifacts.some((item) => item.name === 'layout-guide.md'), false);
  assert.equal(artifacts.some((item) => item.name.includes('..')), false);
});

test('AI 视觉运行开始时写入可追溯基线文件', () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-card-ai-visual-baseline-'));
  const result = writeSocialCardAiVisualBaseline({ workdir, candidateId: 1017, batchId: 'batch-1', contentType: 'event', channelMode: 'xiaohongshu', themeId: 'ice-blue', requiredPageCount: 5, storyboardPageCount: 5 });
  const baseline = JSON.parse(fs.readFileSync(result.path, 'utf8'));
  assert.equal(baseline.candidateId, 1017);
  assert.equal(baseline.currentFlow.generationPhase, 'document_write begin + append + finish');
  assert.equal(baseline.currentFlow.programmaticFallback, false);
  assert.equal(baseline.requiredPageCount, 5);
  assert.equal(fs.existsSync(result.path), true);
});

test('AI 视觉阶段记录器严格校验阶段顺序并持久化执行记录', () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-card-ai-visual-stage-'));
  const recorder = createSocialCardAiVisualStageRecorder({ workdir, batchId: 'batch-1', candidateId: 1017, snapshotId: 'snapshot-1' });
  const inputs = recorder.start('inputs', { inputArtifacts: ['fact-sheet.md'], outputArtifact: 'manifest.json' });
  inputs.finish({ detail: 'inputs ready' });
  const copy = recorder.start('copy', { skill: 'xiaohongshu-article-generator', outputArtifact: 'copy.txt' });
  copy.finish({ detail: 'copy ready' });
  const generation = recorder.start('generation', { skill: 'social-card-ai-visual-generator', outputArtifact: 'ai-beautified.html' });
  generation.fail(new Error('test failure'));
  assert.throws(() => recorder.start('delivery-gate', { skill: 'fixed-program' }), /阶段不一致/);
  const saved = JSON.parse(fs.readFileSync(recorder.path, 'utf8'));
  assert.deepEqual(saved.stages.map((stage) => stage.stage), ['inputs', 'copy', 'generation']);
  assert.equal(saved.stages[2].status, 'failed');
  assert.deepEqual(SOCIAL_CARD_AI_VISUAL_STAGE_CONTRACT.map((stage) => stage.id), ['inputs', 'copy', 'generation', 'screenshots', 'delivery-gate']);
});

test('AI 视觉技能清单记录快照、模型和实际可见能力', () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-card-ai-visual-manifest-'));
  const result = writeSocialCardAiVisualSkillManifest({
    workdir,
    runtime: { snapshotId: 'snapshot-1', provider: 'deepseek', providerConfig: { model: 'deepseek-chat' }, allowedCapabilities: ['filesystem.project.read'] },
    bundles: [{ skillName: 'social-card-ai-visual-generator', hash: 'hash-1', files: ['SKILL.md'] }],
    catalog: [{ capability: 'filesystem.project.read', name: '项目文件读取', implementations: [{ riskLevel: 'read-only' }] }],
  });
  const manifest = JSON.parse(fs.readFileSync(result.path, 'utf8'));
  assert.equal(manifest.snapshotId, 'snapshot-1');
  assert.equal(manifest.model, 'deepseek-chat');
  assert.equal(manifest.skills[0].skill, 'social-card-ai-visual-generator');
  assert.equal(manifest.tools[0].capability, 'filesystem.project.read');
});

test('全量生成 Agent 的工具目录不包含浏览器观察和审计能力', () => {
  const catalog = filterAiVisualGenerationCatalog([
    { capability: 'filesystem.project.read' },
    { capability: 'filesystem.project.write' },
    { capability: 'filesystem.project.document_write' },
    { capability: 'content.social_card.browser_inspect' },
    { capability: 'content.social_card.browser_audit' },
  ]);
  assert.deepEqual(catalog.map((item) => item.capability), ['filesystem.project.read', 'filesystem.project.document_write']);
});

test('AI 视觉生成只在首次实际写入前开启 thinking', () => {
  assert.equal(shouldUseAiVisualPlanningThinking({ sourceRead: false, documentStarted: false, planningThinkingUsed: false }), false);
  assert.equal(shouldUseAiVisualPlanningThinking({ sourceRead: true, documentStarted: true, planningThinkingUsed: false }), true);
  assert.equal(shouldUseAiVisualPlanningThinking({ sourceRead: true, documentStarted: true, planningThinkingUsed: true }), false);
});

test('AI 视觉分块 JSON 完整时直接写入，不受 content.length 人为门槛影响', async () => {
  const oversizedContent = '<section class="page">P1</section>' + 'x'.repeat(8_001);
  const replies = [
    JSON.stringify({ type: 'tool_requests', assistant_note: '追加页面', requests: [{ requestId: 'tr_visual_oversized', capability: 'filesystem.project.document_write', arguments: { operation: 'append', content: oversizedContent }, reason: '追加 HTML' }] }),
    JSON.stringify({ type: 'tool_requests', assistant_note: '完成文档', requests: [{ requestId: 'tr_visual_finish', capability: 'filesystem.project.document_write', arguments: { operation: 'finish' }, reason: '结束文档写入' }] }),
    JSON.stringify({ type: 'final', assistantReply: '已完成' }),
  ];
  const calls = [];
  const writes = [];
  let html = '';
  const gateway = {
    async complete(input) {
      calls.push(input);
      return { callId: `visual-${calls.length}`, content: replies.shift() };
    },
  };
  const toolHandlers = {
    'filesystem.project.read': async () => ({ status: 'ok', data: { files: [] } }),
    'filesystem.project.document_write': async (args) => {
      writes.push(args);
      if (args.operation === 'append') html += args.content;
      return { status: 'ok', data: { operation: args.operation } };
    },
  };
  const result = await runSocialCardAiVisualGenerationAgent({
    gateway,
    store: null,
    batchId: 'batch-oversized',
    candidateId: 1,
    provider: 'mock',
    registry: {},
    catalog: [{ capability: 'filesystem.project.read' }, { capability: 'filesystem.project.document_write' }],
    agentSystem: '',
    renderRequest: {},
    workspaceFiles: ['card-plan.json'],
    requiredPageCount: 1,
    getPageCount: () => (html.match(/class="page"/g) || []).length,
    documentWriteSessionId: 'session-oversized',
    toolContext: { toolHandlers },
  });
  assert.equal(result.type, 'final');
  assert.deepEqual(writes.map((item) => item.operation), ['begin', 'append', 'finish']);
  assert.equal(writes.some((item) => item.operation === 'append' && !item.content), false);
  assert.equal(writes.find((item) => item.operation === 'append').content, oversizedContent);
  assert.equal(calls.length, 3);
});
