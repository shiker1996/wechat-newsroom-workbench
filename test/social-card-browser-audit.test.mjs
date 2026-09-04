import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { loadPluginManifests } from '../server/platform/tools/manifest-loader.mjs';
import { buildConversationToolCatalog } from '../server/platform/agent/tool-catalog.mjs';
import { ToolRegistry } from '../server/platform/tools/registry.mjs';

test('浏览器审计工具对 AI 暴露独立能力并把目标页传给本地执行器', async () => {
  const [plugin] = await loadPluginManifests({
    pluginsRoot: path.resolve('plugins'),
    allowlist: ['social-card-layout-audit'],
  });
  const registry = new ToolRegistry().register(plugin);
  const catalog = buildConversationToolCatalog({
    registry,
    entryCapabilities: ['cap_content_social_card_browser_audit'],
  });
  assert.deepEqual(catalog.map((item) => item.capability), ['cap_content_social_card_browser_audit']);

  let received = null;
  const result = await plugin.adapter.execute({
    page: 3,
    patch: { css: '', pages: [{ page: 3, page_html: '<div>第三页</div>' }] },
  }, {
    auditSocialCardBrowser: async (patch, options) => {
      received = { patch, options };
      return {
        patchValid: true,
        changedByModel: true,
        auditedPage: 3,
        layout: { valid: true, pages: [{ page: 3, styleSamples: [{ selector: 'div', fontSize: '14px' }] }] },
      };
    },
  });
  assert.equal(result.status, 'ok');
  assert.equal(received.options.page, 3);
  assert.equal(received.patch.pages[0].page, 3);
  assert.deepEqual(result.data.layout.pages[0].styleSamples, [{ selector: 'div', fontSize: '14px' }]);
});
