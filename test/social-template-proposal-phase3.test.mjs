import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileSocialTemplateProposal, compileSocialTemplateProposalPack, auditSocialTemplateProposal } from '../server/platform/application/themes/social-template-proposal-compiler.mjs';
import { handleThemeRoutes } from '../server/platform/http/routes/theme-routes.mjs';

const ROLES = ['cover', 'concept', 'feature', 'steps', 'data', 'compare', 'evidence', 'timeline', 'risk', 'ending'];
function proposal(overrides = {}) {
  return {
    schemaVersion: 1, proposalId: 'proposal-social-phase3abcd', target: 'social', label: '阶段三模板', description: '用于正式 renderer 预览与审计的模板提案', visualDirection: ['清晰', '结构化'], baseTemplatePack: 'standard-v1',
    roles: Object.fromEntries(ROLES.map((role) => [role, { layout: `${role}-proposal`, maxBlocks: role === 'cover' ? 2 : 4, maxItems: 9, supportedBlocks: ['text', 'list', 'note'] }])),
    surface: { density: 'standard', decoration: 'accent-edge', headingTreatment: 'underline' }, status: 'draft', source: 'ai-proposal', provenance: { model: 'test', promptVersion: 'v1', createdAt: new Date().toISOString() }, ...overrides,
  };
}

test('Phase 3 提案编译为隔离的受控模板包，不修改全局模板注册表', () => {
  const compiled = compileSocialTemplateProposal({ proposal: proposal() });
  assert.match(compiled.templatePack.id, /^proposal-proposal-social-phase3abcd-v1$/);
  assert.equal(compiled.templatePack.roleTemplates.feature, 'feature-proposal');
  assert.equal(compiled.audit.productionEligible, true);
  assert.equal((compiled.html.match(/data-template-id="[^"]+"/g) || []).length, 5);
  assert.match(compiled.html, /data-template-source="proposal"/);
  assert.equal(compileSocialTemplateProposalPack(proposal()).fallbackTemplate, null);
});

test('Phase 3 正式样稿审计覆盖列表伪元素、字体层级和固定画布', () => {
  const compiled = compileSocialTemplateProposal({ proposal: proposal() });
  assert.equal(compiled.audit.checks.colors, true);
  assert.equal(compiled.audit.checks.typography, true);
  assert.equal(compiled.audit.checks.pseudoElements, true);
  assert.equal(compiled.audit.checks.layout, true);
  const bad = auditSocialTemplateProposal({ proposal: proposal(), themeDefinition: { social: {}, tokens: { colors: { surface: '#ffffff', text: '#ffffff', muted: '#ffffff', accent: '#ffffff', accentSecondary: '#ffffff', inverseText: '#ffffff' }, typography: { h1Px: 12, h2Px: 16, bodyPx: 18, captionPx: 20 } } } });
  assert.equal(bad.productionEligible, false);
  assert.ok(bad.issues.some((item) => item.code === 'LOW_CONTRAST' || item.code === 'TYPE_SCALE_INVALID'));
});

test('Phase 3 HTML/CSS 草稿保持仅预览状态，不能通过生产资格', () => {
  const compiled = compileSocialTemplateProposal({ proposal: proposal({ status: 'preview-only', source: 'ai-html-draft', draft: { html: '<p>安全草稿</p>', css: '.x{color:red}', sanitized: true, sandboxOnly: true } }) });
  assert.equal(compiled.audit.valid, true);
  assert.equal(compiled.audit.productionEligible, false);
});

test('Phase 3 模板提案 compile API 返回固定样稿和逐项审计', async () => {
  const roles = Object.fromEntries(ROLES.map((role) => [role, { layout: `${role}-proposal`, maxBlocks: role === 'cover' ? 2 : 4, maxItems: 9, supportedBlocks: ['text', 'list', 'note'] }]));
  const model = { config: { defaultProvider: 'fake', providers: { fake: { model: 'phase3', maxOutputTokens: 9000 } } }, async complete() { return { provider: 'fake', model: 'phase3', callId: 'phase3', content: JSON.stringify({ label: '阶段三模板', description: '用于 API 测试的模板提案', visualDirection: ['清晰'], baseTemplatePack: 'standard-v1', roles, surface: { density: 'standard', decoration: 'accent-edge', headingTreatment: 'underline' } }) }; } };
  let generated;
  const request = { method: 'POST', once() {} };
  await handleThemeRoutes({ request, response: {}, pathname: '/api/social/template-proposals', searchParams: new URLSearchParams(), store: { getUserTheme() { return null; } }, models: model, body: async () => ({ prompt: '创建一个适合工具介绍的结构化 Social 模板' }), json: (_r, status, data) => { generated = { status, data }; } });
  assert.equal(generated.status, 200);
  let compiled;
  await handleThemeRoutes({ request, response: {}, pathname: `/api/social/template-proposals/${generated.data.candidateId}/compile`, searchParams: new URLSearchParams(), store: { getUserTheme() { return null; } }, body: async () => ({}), json: (_r, status, data) => { compiled = { status, data }; } });
  assert.equal(compiled.status, 200);
  assert.equal(compiled.data.audit.checks.layout, true);
  assert.match(compiled.data.html, /data-template-pack="proposal-/);
});

test('Phase 3 文档和主题管理器暴露正式编译入口语义', () => {
  const api = fs.readFileSync(new URL('../API.md', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../public/src/views/theme-manager.js', import.meta.url), 'utf8');
  assert.match(api, /template-proposals\/:proposalId\/compile/);
  assert.match(ui, /TEMPLATE PROPOSAL JSON/);
});

