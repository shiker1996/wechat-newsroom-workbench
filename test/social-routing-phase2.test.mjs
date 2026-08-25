import test from 'node:test';
import assert from 'node:assert/strict';
import { contentTypeForSocialRoute, socialRouteForContentClass } from '../server/features/social-cards/domain/social-routing.mjs';
import { buildSocialCardFactEnvelope, toLegacySocialCardPromptInput } from '../server/features/social-cards/application/storyboard-contracts.mjs';
import { evaluateClassifiedCardGate } from '../server/features/social-cards/domain/social-card-gate.mjs';

const analysis = (facts = {}, sourceCount = 2) => ({
  analysis: {
    eventSummary: '分类事实摘要',
    factBase: { confirmedFacts: ['已确认事实'], claims: [], ...facts },
    sources: Array.from({ length: sourceCount }, (_, index) => ({ status: 'ok', url: `https://source-${index}.example` })),
    sourceAudit: { independentSourceCount: sourceCount, issues: [] },
  },
});

const editorial = { card_plan_json: JSON.stringify([{}, {}, {}, {}]), must_disclose: '据公开素材整理', forbidden_claims: '不得虚构', target_reader: '开发者', pain_point: '判断成本' };

test('四类分类稳定映射到内容类型、输出模式和故事板技能', () => {
  assert.deepEqual(socialRouteForContentClass('github_project'), {
    contentClass: 'github_project', contentType: 'repository', outputMode: 'wechat-tool-cards', storyboardSkill: 'repository-card-storyboard', poolRole: 'AI 工具图文预选', label: '工具图文', channel: 'wechat', routeVersion: 'social-route-v2',
  });
  assert.equal(socialRouteForContentClass('open_source_technology').outputMode, 'wechat-event-cards');
  assert.equal(socialRouteForContentClass('open_source_technology').storyboardSkill, 'open-source-technology-storyboard');
  assert.equal(socialRouteForContentClass('open_source_trend', 'xiaohongshu').outputMode, 'xiaohongshu-event-cards');
  assert.equal(contentTypeForSocialRoute({ content_class: 'open_source_trend' }), 'event');
  assert.equal(contentTypeForSocialRoute({ tracks: [{ track: 'social_cards', output_mode: 'wechat-event-cards' }] }), 'event');
});

test('技术与趋势事实信封使用分类字段并选择专属 legacy 输入', () => {
  const technology = buildSocialCardFactEnvelope({ contentType: 'technology', channelMode: 'wechat', topic: '技术', facts: { repository: 'x' }, eventAnalysis: analysis({ mechanisms: [{ claim: '机制' }] }).analysis, outputMode: 'wechat-technology-cards' });
  assert.equal(technology.entryPoint, 'social-event');
  assert.equal(technology.contentType, 'event');
  assert.ok(technology.facts.mechanisms.length);
  assert.ok(toLegacySocialCardPromptInput(technology).event_analysis);
});

test('技术与趋势故事板门禁优先检查类型证据', () => {
  const blockedTechnology = evaluateClassifiedCardGate({}, 'technology', analysis(), editorial);
  assert.equal(blockedTechnology.ready, false);
  assert.match(blockedTechnology.issues.join('；'), /机制、架构或性能/);
  const readyTechnology = evaluateClassifiedCardGate({}, 'technology', analysis({ mechanisms: [{ claim: '分层机制' }] }), editorial);
  assert.equal(readyTechnology.ready, true);
  const blockedTrend = evaluateClassifiedCardGate({}, 'trend', analysis({}, 1), editorial);
  assert.equal(blockedTrend.ready, false);
  const readyTrend = evaluateClassifiedCardGate({}, 'trend', analysis({ signals: [{ claim: '多个主体开始采用' }], actors: [{ name: 'A' }, { name: 'B' }] }), editorial);
  assert.equal(readyTrend.ready, true);
});
