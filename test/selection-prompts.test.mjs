import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadSkillBundle } from '../server/platform/llm/skill-runtime.mjs';
import { selectionPrompt } from '../server/features/research/llm/selection-prompts.mjs';

const workspaceRoot = process.cwd();

test('选题阶段 5 个技能均可按名加载', () => {
  for (const skillName of ['hotspot-tagging', 'hotspot-brainstorm', 'hotspot-synthesis', 'event-card-generator', 'discussion-researcher', 'editorial-room-chat', 'tutorial-chat', 'custom-social-chat']) {
    const bundle = loadSkillBundle({ workspaceRoot, skillName });
    assert.equal(bundle.fallback, false, `${skillName} 应从项目技能目录加载`);
    assert.ok(bundle.prompt.length > 100, `${skillName} prompt 不能为空`);
  }
});

test('选题编排使用技能作为 Prompt 唯一事实源', () => {
  const source = fs.readFileSync(path.join(workspaceRoot, 'server/features/research/application/research-pipeline.mjs'), 'utf8');
  for (const skillName of ['hotspot-brainstorm', 'hotspot-synthesis', 'event-card-generator']) {
    assert.match(source, new RegExp(`skillName: ['"]${skillName}['"]`));
  }
  assert.doesNotMatch(source, /const (BRAINSTORM_SYSTEM|SYNTHESIS_SYSTEM|EVENT_CARD_SYSTEM)\s*=/);
});

test('三个对话 agent 的技能是唯一事实源（代码不再内联 prompt）', () => {
  const cases = [
    ['editorial-room-chat', 'server/features/articles/llm/editorial-room.mjs', ['cap_agent_conversation_finish', 'assistantReply', '"forbidden_claims"', 'cap_agent_form_update'], '你是公众号编辑会主持人'],
    ['tutorial-chat', 'server/features/articles/llm/tutorial-chat.mjs', ['assistantReply', '【体验】', 'cap_agent_form_update'], '你是微信公众号自主写作的策划编辑'],
    ['custom-social-chat', 'server/features/social-cards/llm/custom-social-chat.mjs', ['cap_agent_conversation_finish', 'assistantReply', '【素材】', 'cap_agent_form_update'], '你是图文策划编辑'],
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
  assert.ok(skillText.includes('首次进入时默认不选'));
  assert.ok(skillText.includes('角度和命题明确后'));
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
