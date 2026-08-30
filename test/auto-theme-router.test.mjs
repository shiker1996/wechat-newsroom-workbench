import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';
import { availableThemeDefinitions, normalizeThemeCandidates, resolveAutoTheme } from '../server/platform/application/themes/auto-theme-router.mjs';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-theme-router-'));
  const store = new Store(path.join(root, 'workbench.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store };
}

test('主题路由目录按目标提供主题，且 AI 候选只接受存在的主题 ID', () => {
  const catalog = availableThemeDefinitions(null, 'social');
  assert.ok(catalog.some((theme) => theme.id === 'ice-blue'));
  const normalized = normalizeThemeCandidates({ candidates: [
    { themeId: 'neon', score: 90, reason: '技术终端' },
    { themeId: 'missing-theme', score: 100 },
    { themeId: 'ice-blue', score: 80 },
    { themeId: 'neon', score: 70 },
  ] }, 'social', catalog);
  assert.deepEqual(normalized.map((item) => item.id), ['neon', 'ice-blue']);
});

test('自动主题路由缓存同一内容，并在多个近似候选之间受控轮换', async (t) => {
  const { store } = workspace(t);
  const batch = store.createBatch({ date: '2026-08-30', title: '主题路由测试' });
  const calls = [];
  const gateway = { complete: async (request) => {
    calls.push(request);
    return { content: JSON.stringify({ candidates: [
      { themeId: 'neon', score: 95, reason: '终端和技术教程匹配' },
      { themeId: 'ice-blue', score: 90, reason: '清爽工具图文匹配' },
      { themeId: 'retro-terminal', score: 84, reason: '复古终端备选' },
    ] }), callId: calls.length };
  } };
  const first = await resolveAutoTheme({ gateway, store, batchId: batch.id, target: 'social', context: { title: '技术教程 A' }, provider: 'fake' });
  const same = await resolveAutoTheme({ gateway, store, batchId: batch.id, target: 'social', context: { title: '技术教程 A' }, provider: 'fake' });
  const next = await resolveAutoTheme({ gateway, store, batchId: batch.id, target: 'social', context: { title: '技术教程 B' }, provider: 'fake' });
  assert.equal(first.themeId, 'neon');
  assert.equal(same.themeId, first.themeId);
  assert.equal(next.themeId, 'ice-blue');
  assert.equal(calls.length, 2);
  assert.equal(store.listRecentThemeRouting({ target: 'social', limit: 10 }).length, 2);
});
