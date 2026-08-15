import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadSkillBundle } from '../lib/llm/skill-runtime.mjs';
import { selectionPrompt } from '../lib/llm/selection-prompts.mjs';

const workspaceRoot = process.cwd();

test('选题阶段 5 个技能均可按名加载', () => {
  for (const skillName of ['hotspot-tagging', 'hotspot-brainstorm', 'hotspot-synthesis', 'event-card-generator', 'editorial-room-chat', 'tutorial-chat', 'custom-social-chat']) {
    const bundle = loadSkillBundle({ workspaceRoot, skillName });
    assert.equal(bundle.fallback, false, `${skillName} 应从项目技能目录加载`);
    assert.ok(bundle.prompt.length > 100, `${skillName} prompt 不能为空`);
  }
});

test('技能文本与代码 fallback 的核心 JSON 契约一致', () => {
  const cases = [
    ['hotspot-tagging', 'lib/llm/tasks.mjs', ['"eventParts"', '"preScores"', '"blackHorseSignals"', '严格 JSON']],
    ['hotspot-brainstorm', 'lib/llm/research-pipeline.mjs', ['"writeReadiness"', '"bScores"', '"hProfile"', '探索']],
    ['hotspot-synthesis', 'lib/llm/research-pipeline.mjs', ['"saturationPenalty"', '"metaNarratives"', '"combination"']],
    ['event-card-generator', 'lib/llm/research-pipeline.mjs', ['"confirmed_facts"', '"source_increment"', '"unverified"']],
  ];
  for (const [skillName, sourceFile, markers] of cases) {
    const skillText = fs.readFileSync(path.join(workspaceRoot, 'skills', skillName, 'SKILL.md'), 'utf8');
    const codeText = fs.readFileSync(path.join(workspaceRoot, sourceFile), 'utf8');
    for (const marker of markers) {
      assert.ok(skillText.includes(marker), `${skillName} 缺少契约标记 ${marker}`);
      assert.ok(codeText.includes(marker), `${sourceFile} fallback 缺少契约标记 ${marker}`);
    }
  }
});

test('三个对话 agent 的技能是唯一事实源（代码不再内联 prompt）', () => {
  const cases = [
    ['editorial-room-chat', 'lib/llm/editorial-room.mjs', ['"briefUpdates"', 'assistantReply', '"forbidden_claims"', '不要再套 output 层'], '你是公众号编辑会主持人'],
    ['tutorial-chat', 'lib/llm/tutorial-chat.mjs', ['"briefUpdates"', 'assistantReply', '【体验】'], '你是微信公众号自主写作的策划编辑'],
    ['custom-social-chat', 'lib/llm/custom-social-chat.mjs', ['"briefUpdates"', 'assistantReply', '【素材】'], '你是图文策划编辑'],
  ];
  for (const [skillName, sourceFile, markers, inlinePrefix] of cases) {
    const skillText = fs.readFileSync(path.join(workspaceRoot, 'skills', skillName, 'SKILL.md'), 'utf8');
    const codeText = fs.readFileSync(path.join(workspaceRoot, sourceFile), 'utf8');
    for (const marker of markers) {
      assert.ok(skillText.includes(marker), `${skillName} 缺少契约标记 ${marker}`);
    }
    assert.ok(!codeText.includes(inlinePrefix), `${sourceFile} 仍内联 prompt（应只从技能加载）`);
  }
});

test('对话 agent 技能缺失时 selectionPrompt 直接抛错（fail-fast）', () => {
  assert.throws(() => selectionPrompt({ workspaceRoot, skillName: 'no-such-skill' }), /无法加载/);
});

test('editorial-room-chat 技能使用账号上下文占位符', () => {
  const skillText = fs.readFileSync(path.join(workspaceRoot, 'skills', 'editorial-room-chat', 'SKILL.md'), 'utf8');
  assert.ok(skillText.includes('{{ACCOUNT_CONTEXT}}'));
});

test('selectionPrompt 在技能缺失时回退内联原文', () => {
  const fallback = '内联兜底 prompt';
  const missing = selectionPrompt({ workspaceRoot, skillName: 'no-such-skill', fallback });
  assert.equal(missing.prompt, fallback);
  assert.equal(missing.bundle.fallback, true);
  const loaded = selectionPrompt({ workspaceRoot, skillName: 'hotspot-synthesis', fallback });
  assert.notEqual(loaded.prompt, fallback);
  assert.ok(loaded.prompt.includes('热点综合研判器'));
});

test('selectionPrompt 无 workspaceRoot 时用 process.cwd() 兜底', () => {
  const loaded = selectionPrompt({ skillName: 'hotspot-tagging', fallback: 'x' });
  assert.equal(loaded.bundle.fallback, false);
});
