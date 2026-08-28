import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifySocialCardAiVisualFailure, collectSocialCardAiVisualArtifacts, SOCIAL_CARD_AI_VISUAL_FAILURE_CODES, writeSocialCardAiVisualBaseline } from '../server/features/social-cards/application/social-card-ai-visual-baseline.mjs';
import { createSocialCardAiVisualStageRecorder, SOCIAL_CARD_AI_VISUAL_STAGE_CONTRACT, writeSocialCardAiVisualSkillManifest } from '../server/features/social-cards/application/social-card-ai-visual-pipeline.mjs';
import { filterAiVisualGenerationCatalog } from '../server/features/social-cards/application/social-card-ai-visual-agent.mjs';
import { filterAiVisualRepairCatalog } from '../server/features/social-cards/application/social-card-ai-visual-repair-agent.mjs';
import { normalizeToolRequest, validateToolRequest } from '../server/platform/agent/tool-protocol.mjs';

test('AI 视觉 Agent 的工具理由过长时在严格校验前截断', () => {
  const request = normalizeToolRequest({ requestId: 'tr_visual', capability: 'filesystem.project.read', arguments: {}, reason: '很长的工具调用说明'.repeat(40) });
  assert.equal([...request.reason].length, 160);
  assert.equal(validateToolRequest(request).reason, request.reason);
});

test('AI 视觉基线统一归类模型、结构、布局和截图错误', () => {
  assert.equal(classifySocialCardAiVisualFailure({ code: 'MODEL_JSON_TRUNCATED', message: 'JSON 被截断' }).code, SOCIAL_CARD_AI_VISUAL_FAILURE_CODES.MODEL_JSON_TRUNCATED);
  assert.equal(classifySocialCardAiVisualFailure('AI 视觉 Agent 达到工具调用预算').code, SOCIAL_CARD_AI_VISUAL_FAILURE_CODES.AGENT_BUDGET);
  assert.equal(classifySocialCardAiVisualFailure('页面数量改变（原 6，新 1）').code, SOCIAL_CARD_AI_VISUAL_FAILURE_CODES.PAGE_COUNT);
  assert.equal(classifySocialCardAiVisualFailure('P2 text_invisible；P3 vertical_imbalance').code, SOCIAL_CARD_AI_VISUAL_FAILURE_CODES.LAYOUT_AUDIT);
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
  assert.equal(artifacts.some((item) => item.name.includes('..')), false);
});

test('AI 视觉运行开始时写入可追溯基线文件', () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-card-ai-visual-baseline-'));
  const result = writeSocialCardAiVisualBaseline({ workdir, candidateId: 1017, batchId: 'batch-1', contentType: 'event', channelMode: 'xiaohongshu', themeId: 'ice-blue', requiredPageCount: 5, storyboardPageCount: 5 });
  const baseline = JSON.parse(fs.readFileSync(result.path, 'utf8'));
  assert.equal(baseline.candidateId, 1017);
  assert.equal(baseline.currentFlow.generationAndRepairShareAgent, true);
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
  assert.throws(() => recorder.start('final-audit', { skill: 'fixed-program' }), /阶段不一致/);
  const saved = JSON.parse(fs.readFileSync(recorder.path, 'utf8'));
  assert.deepEqual(saved.stages.map((stage) => stage.stage), ['inputs', 'copy', 'generation']);
  assert.equal(saved.stages[2].status, 'failed');
  assert.deepEqual(SOCIAL_CARD_AI_VISUAL_STAGE_CONTRACT.map((stage) => stage.id).slice(0, 3), ['inputs', 'copy', 'generation']);
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
    { capability: 'content.social_card.browser_inspect' },
    { capability: 'content.social_card.browser_audit' },
  ]);
  assert.deepEqual(catalog.map((item) => item.capability), ['filesystem.project.read', 'filesystem.project.write']);
});

test('单页修复 Agent 的工具目录不包含确定性浏览器审计能力', () => {
  const catalog = filterAiVisualRepairCatalog([
    { capability: 'filesystem.project.write' },
    { capability: 'content.social_card.browser_inspect' },
    { capability: 'content.social_card.browser_audit' },
    { capability: 'filesystem.project.read' },
  ]);
  assert.deepEqual(catalog.map((item) => item.capability), ['filesystem.project.write', 'content.social_card.browser_inspect']);
});
