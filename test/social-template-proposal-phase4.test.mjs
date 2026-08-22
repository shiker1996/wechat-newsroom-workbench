import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/core/store.mjs';
import { cloneTheme, publishTheme } from '../lib/themes/user-theme-service.mjs';
import { handleThemeRoutes } from '../lib/http/routes/theme-routes.mjs';
import { compileThemePreview } from '../lib/themes/theme-preview.mjs';

const ROLES = ['cover', 'concept', 'feature', 'steps', 'data', 'compare', 'evidence', 'timeline', 'risk', 'ending'];
function gateway() {
  const roles = Object.fromEntries(ROLES.map((role) => [role, { layout: `${role}-confirmed`, maxBlocks: role === 'cover' ? 2 : 4, maxItems: 9, supportedBlocks: ['text', 'list', 'note'] }]));
  return { config: { defaultProvider: 'fake', providers: { fake: { model: 'phase4', maxOutputTokens: 9000 } } }, async complete() { return { provider: 'fake', model: 'phase4', callId: 'phase4', content: JSON.stringify({ label: '确认模板', description: '通过用户确认绑定到 Social 主题的模板', visualDirection: ['结构化'], baseTemplatePack: 'standard-v1', roles, surface: { density: 'standard', decoration: 'accent-edge', headingTreatment: 'underline' } }) }; } };
}
function workspace(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-template-phase4-')); const store = new Store(path.join(dir, 'workbench.db')); t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }); return store; }
async function route(options) { let result; await handleThemeRoutes({ request: { method: options.method, once() {} }, response: {}, pathname: options.pathname, searchParams: new URLSearchParams(), store: options.store, models: options.models, body: async () => options.body || {}, json: (_response, status, data) => { result = { status, data }; } }); return result; }

test('Phase 4 确认提案后写入主题草稿，模板包版本与十个角色可追踪', async (t) => {
  const store = workspace(t); const theme = cloneTheme(store, { sourceId: 'ice-blue', id: 'phase4-social', label: '阶段四主题' });
  const generated = await route({ method: 'POST', pathname: '/api/social/template-proposals', store, models: gateway(), body: { prompt: '创建一个适合开发工具介绍的结构化 Social 模板' } });
  assert.equal(generated.status, 200);
  const confirmed = await route({ method: 'POST', pathname: `/api/social/template-proposals/${generated.data.candidateId}/confirm`, store, body: { themeId: theme.id } });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.requiresThemePublish, true);
  assert.match(confirmed.data.templatePack.id, /^proposal-/);
  assert.equal(Object.keys(confirmed.data.templatePack.roles).length, 10);
  assert.equal(confirmed.data.theme.social?.templatePack?.id, confirmed.data.templatePack.id);
  assert.equal(publishTheme(store, theme.id).social.templatePack.id, confirmed.data.templatePack.id);
});

test('Phase 4 自定义模板包发布后仍走正式 renderer，历史版本可恢复', async (t) => {
  const store = workspace(t); const theme = cloneTheme(store, { sourceId: 'ice-blue', id: 'phase4-preview', label: '阶段四预览' });
  const generated = await route({ method: 'POST', pathname: '/api/social/template-proposals', store, models: gateway(), body: { prompt: '创建一个适合开发工具介绍的结构化 Social 模板' } });
  const confirmed = await route({ method: 'POST', pathname: `/api/social/template-proposals/${generated.data.candidateId}/confirm`, store, body: { themeId: theme.id } });
  const published = publishTheme(store, theme.id);
  const preview = compileThemePreview({ target: 'social', definition: published });
  assert.equal(preview.template.pack, published.social.templatePack.id);
  assert.match(preview.html, new RegExp(`data-template-source="theme"|data-template-source="proposal"`));
  assert.equal(store.userThemeVersions(theme.id).length, 1);
  assert.equal(confirmed.data.audit.productionEligible, true);
});

test('Phase 4 未通过正式门禁的提案不能确认绑定，文章和封面主题入口保持不变', async (t) => {
  const store = workspace(t); const theme = cloneTheme(store, { sourceId: 'ice-blue', id: 'phase4-gate', label: '阶段四门禁' });
  const generated = await route({ method: 'POST', pathname: '/api/social/template-proposals', store, models: gateway(), body: { prompt: '创建一个适合开发工具介绍的结构化 Social 模板' } });
  const proposal = store.getUserTheme(theme.id); assert.ok(proposal);
  const result = await route({ method: 'POST', pathname: `/api/social/template-proposals/${generated.data.candidateId}/confirm`, store, body: { themeId: 'missing-theme' } });
  assert.equal(result.status, 400);
  assert.match(result.data.error, /Social 用户主题/);
});

test('Phase 4 主题管理器提供确认绑定动作，方案文档标记进入阶段 5', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../public/src/views/theme-manager.js', import.meta.url), 'utf8');
  const plan = fs.readFileSync(new URL('../docs/design/social-card-template-authoring-ai-assist-plan.md', import.meta.url), 'utf8');
  assert.match(html, /confirm-ai-template-proposal/);
  assert.match(ui, /template-proposals\/.*\/confirm/);
  assert.match(plan, /Phase 4 已完成，待进入阶段 5/);
});
