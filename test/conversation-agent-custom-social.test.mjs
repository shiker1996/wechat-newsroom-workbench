import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../server/platform/core/store.mjs';
import { ToolRegistry } from '../server/platform/tools/registry.mjs';
import { runCustomSocialAgentTurn } from '../server/features/social-cards/application/agent/custom-social-adapter.mjs';

function call(capability, input, id = capability) { return { id, name: capability, input }; }
function native(callId, toolCalls) { return { callId, content: '', toolCalls, model: 'mock', usage: { total_tokens: 10 } }; }
function gateway(sequence) {
  let index = 0;
  return {
    config: { defaultProvider: 'mock', providers: { mock: { maxOutputTokens: 4096, supportsNativeTools: true, supportsToolCallStreaming: false } } },
    async complete({ messages }) { const next = sequence[index++]; return typeof next === 'function' ? next({ messages }) : next; },
  };
}
function registry() {
  const value = new ToolRegistry();
  value.register({
    manifest: { id: 'search', name: '搜索', version: '1.0.0', capabilities: ['cap_content_web_search'], riskLevel: 'network-read', inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, maxResults: { type: 'integer' } } }, outputSchema: { type: 'object' } },
    adapter: { async execute() { return { status: 'ok', data: { answer: '公开资料', results: [{ title: '官方说明', url: 'https://docs.example.com/guide' }] }, artifacts: [], warnings: [], provenance: {} }; } },
  });
  value.register({
    manifest: { id: 'repo', name: '仓库', version: '1.0.0', capabilities: ['cap_content_repository_inspect'], riskLevel: 'network-read', inputSchema: { type: 'object', required: ['sourceUrl'], properties: { sourceUrl: { type: 'string' } } }, outputSchema: { type: 'object' } },
    adapter: { async execute(input) { return { status: 'ok', data: { sourceUrl: input.sourceUrl, description: '仓库事实', readmeMarkdown: '安装说明' }, artifacts: [], warnings: [], provenance: {} }; } },
  });
  return value;
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-social-agent-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), 'config', 'capability-consumers.json'), path.join(root, 'config', 'capability-consumers.json'));
  const store = new Store(path.join(root, 'test.db'));
  const batch = store.createBatch({ date: '2026-08-14', title: '自定义图文 Agent' });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store, batch };
}

test('自定义图文先搜索素材，再用表单工具更新，最后用结束工具提交', async (t) => {
  const { root, store, batch } = fixture(t);
  const result = await runCustomSocialAgentTurn({
    gateway: gateway([
      native('search', [call('cap_content_web_search', { query: 'Agent 教程' }, 'search')]),
      ({ messages }) => {
        assert.ok(messages.some((item) => item.role === 'tool' && item.content.includes('docs.example.com')));
        return native('form', [call('cap_agent_form_update', { operations: [
          { field: 'content_type', op: 'replace', value: 'tutorial' },
          { field: 'channel', op: 'replace', value: 'wechat' },
          { field: 'topic', op: 'replace', value: 'Agent 教程' },
          { field: 'audience', op: 'replace', value: '开发者' },
          { field: 'points', op: 'append', values: ['【体验】官方文档给出安装方式', '【建议】先测试', '【建议】保留边界'] },
          { field: 'steps', op: 'append', values: ['安装', '运行'] },
          { field: 'expected_pages', op: 'set', value: 6 },
        ] }, 'form')]);
      },
      native('finish', [call('cap_agent_conversation_finish', { assistantReply: '素材已加入图文策划，方案已整理。' }, 'finish')]),
    ]),
    store, registry: registry(), batchId: batch.id, draft: {}, workspaceRoot: root,
  });
  assert.equal(result.toolCalls, 3);
  assert.equal(result.reply, '素材已加入图文策划，方案已整理。');
  assert.equal(result.ready, true);
  assert.match(result.formUpdates.points[0], /^【素材】/);
  assert.match(result.formUpdates.points[0], /https:\/\/docs\.example\.com\/guide/);
  assert.deepEqual(result.formUpdates.materialUrls, ['https://docs.example.com/guide']);
  const attachments = store.listConversationFactAttachments({ batchId: batch.id, entryPoint: 'custom-social' });
  assert.ok(attachments.some((item) => item.capability === 'cap_content_web_search'));
});

test('仓库分析只接受用户提供的 GitHub 资源', async (t) => {
  const { root, store, batch } = fixture(t);
  const result = await runCustomSocialAgentTurn({
    gateway: gateway([
      native('repo', [call('cap_content_repository_inspect', { resourceId: 'material:1' }, 'repo')]),
      native('finish', [call('cap_agent_conversation_finish', { assistantReply: '请提供 GitHub 仓库地址。' }, 'finish')]),
    ]),
    store, registry: registry(), batchId: batch.id, draft: { materialUrls: ['https://example.com/not-github'] }, workspaceRoot: root,
  });
  assert.equal(result.ready, false);
  assert.equal(store.listAgentToolCalls(result.agentRunId)[0].error_code, 'RESOURCE_NOT_ALLOWED');
});

test('自定义图文允许普通文本回复；不解析旧 JSON', async (t) => {
  const { root, store, batch } = fixture(t);
  const oldJson = JSON.stringify({ type: 'final', assistantReply: '不应接受', briefUpdates: { topic: '不应写入' } });
  const result = await runCustomSocialAgentTurn({ gateway: gateway([{ callId: 'legacy', content: oldJson, model: 'mock', usage: {} }]), store, registry: registry(), batchId: batch.id, draft: {}, workspaceRoot: root });
  assert.equal(result.reply, oldJson);
});

test('自定义图文生产路由使用 Agent、事实附件和原生工具设置', () => {
  const adapter = fs.readFileSync(new URL('../server/features/social-cards/application/agent/custom-social-adapter.mjs', import.meta.url), 'utf8');
  const route = fs.readFileSync(new URL('../server/platform/http/routes/candidate-routes.mjs', import.meta.url), 'utf8');
  assert.match(adapter, /cap_agent_conversation_finish/);
  assert.match(adapter, /nativeTools: true/);
  assert.match(route, /runCustomSocialAgentTurn/);
  assert.match(route, /listConversationFactAttachments/);
});
