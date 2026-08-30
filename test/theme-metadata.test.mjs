import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';
import { cloneTheme, exportWorkspaceTheme, importThemeDraft, publishTheme, saveThemeDraft } from '../server/platform/application/themes/user-theme-service.mjs';
import { getBuiltinThemeRegistry } from '../server/shared/themes/theme-registry.mjs';

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-metadata-'));
  const store = new Store(path.join(dir, 'themes.db'));
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return store;
}

test('主题创建元数据覆盖 AI、复制和版本快照，且不进入定义 JSON', (t) => {
  const store = workspace(t);
  const source = cloneTheme(store, { sourceId: 'magazine-warm', id: 'metadata-source', label: '元数据源主题' });
  const aiMetadata = {
    creationMethod: 'ai',
    intent: { prompt: '做一套适合技术深解的克制主题', scene: '技术教程', tone: ['editorial'], brightness: 'light', readingPriority: 'long-form' },
    aiProvenance: { serviceId: 'openai', model: 'gpt-test', promptVersion: 'theme-create-v2', callId: 'call-1', generatedAt: '2026-08-30T00:00:00.000Z' },
    designSummary: [{ title: '纸张层次', description: '暖白底色搭配红色强调' }],
    repairs: [{ field: 'tokens.colors.text', reason: '修复正文对比度' }],
  };
  saveThemeDraft(store, { id: 'metadata-source', target: 'article', definition: source, metadata: aiMetadata });
  const current = store.getThemeMetadata('metadata-source');
  assert.equal(current.creationMethod, 'ai');
  assert.equal(current.intent.scene, '技术教程');
  assert.equal(current.aiProvenance.callId, 'call-1');
  assert.equal(current.designSummary[0].title, '纸张层次');
  assert.equal(JSON.parse(store.getUserTheme('metadata-source').draft_json).metadata, undefined);

  publishTheme(store, 'metadata-source');
  const version = store.userThemeVersions('metadata-source')[0];
  assert.equal(version.metadata.aiProvenance.promptVersion, 'theme-create-v2');
  assert.equal(version.metadata.creationMethod, 'ai');
});

test('复制和导入主题保留来源关系并分别标记 creationMethod', (t) => {
  const store = workspace(t);
  const cloned = cloneTheme(store, { sourceId: 'ice-blue', id: 'metadata-clone', label: '冷调副本' });
  const cloneMetadata = store.getThemeMetadata(cloned.id);
  assert.equal(cloneMetadata.creationMethod, 'clone');
  assert.deepEqual(cloneMetadata.basedOn, { id: 'ice-blue', version: getBuiltinThemeRegistry().get('ice-blue').version });

  const exported = exportWorkspaceTheme(store, cloned.id, { draft: true });
  exported.id = 'metadata-import';
  const imported = importThemeDraft(store, { definition: exported });
  const importMetadata = store.getThemeMetadata(imported.theme.id);
  assert.equal(importMetadata.creationMethod, 'import');
  assert.deepEqual(importMetadata.basedOn, cloneMetadata.basedOn);
  assert.equal(imported.theme.metadata, undefined);
});
