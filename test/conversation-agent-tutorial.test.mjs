import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../server/platform/core/store.mjs';
import { ToolRegistry } from '../server/platform/tools/registry.mjs';
import { toolNameForCapability } from '../server/platform/agent/tool-catalog.mjs';
import { runTutorialAgentTurn, tutorialProjectAttachmentArguments } from '../server/features/articles/application/agent/tutorial-adapter.mjs';
import { getFactAttachment } from '../server/platform/agent/fact-attachments.mjs';
import { buildCustomFactSheet } from '../server/features/social-cards/index.mjs';

function call(capability, input, id = capability) { return { id, name: toolNameForCapability(capability), input }; }
function native(callId, toolCalls) { return { callId, content: '', toolCalls, model: 'mock', usage: { total_tokens: 10 } }; }
function gateway(sequence) {
  let index = 0;
  return {
    config: { defaultProvider: 'mock', providers: { mock: { maxOutputTokens: 4096, supportsNativeTools: true, supportsToolCallStreaming: false } } },
    async complete({ messages }) { const next = sequence[index++]; return typeof next === 'function' ? next({ messages }) : next; },
  };
}
function projectRegistry() {
  const registry = new ToolRegistry();
  registry.register({
    manifest: { id: 'mock-project', name: '项目读取', version: '1.0.0', capabilities: ['filesystem.project.read'], riskLevel: 'read-only', pathInputs: ['path'], inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, options: { type: 'object' } } }, outputSchema: { type: 'object' } },
    adapter: { async execute(input) { return { status: 'ok', data: { root: input.path, summary: '读取 1/1 个文本文件，共 18 字符', files: [{ path: 'README.md', size: 18, excerpt: 'npm run dev\n实际说明', truncated: false }], totalFiles: 1, totalChars: 18, truncated: false, skipped: {} }, artifacts: [], warnings: [], provenance: {} }; } },
  });
  return registry;
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tutorial-agent-'));
  const project = path.join(root, 'demo-project');
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), 'config', 'capability-consumers.json'), path.join(root, 'config', 'capability-consumers.json'));
  const store = new Store(path.join(root, 'test.db'));
  const batch = store.createBatch({ date: '2026-08-14', title: '自主写作 Agent' });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, project, store, batch };
}

test('自主写作先读取项目，再用表单工具写入，最后用结束工具提交', async (t) => {
  const { root, project, store, batch } = fixture(t);
  const result = await runTutorialAgentTurn({
    gateway: gateway([
      ({ messages }) => {
        assert.ok(messages.some((item) => item.role === 'tool' && item.content.includes('README.md')));
        assert.doesNotMatch(messages.find((item) => item.role === 'tool').content, /demo-project/);
        return native('form', [call('agent.form.update', { operations: [
          { field: 'articleMode', op: 'replace', value: 'tutorial' },
          { field: 'topic', op: 'replace', value: '运行演示项目' },
          { field: 'audience', op: 'replace', value: '开发者' },
          { field: 'environment', op: 'replace', value: 'Node.js 22' },
          { field: 'points', op: 'append', values: ['【素材】README 提供启动命令', '【素材】项目包含运行说明', '【建议】执行前检查版本'] },
          { field: 'steps', op: 'append', values: ['安装依赖', '运行 npm run dev'] },
        ] }, 'form')]);
      },
      ({ messages }) => {
        assert.ok(messages.some((item) => item.role === 'tool' && item.content.includes('运行演示项目')));
        return native('finish', [call('agent.conversation.finish', { assistantReply: '项目材料已读取，事实表已整理。' }, 'finish')]);
      },
    ]),
    store, registry: projectRegistry(), provider: 'mock', batchId: batch.id, draft: { articleMode: 'tutorial' }, answer: `读取 ${project}`, projectPath: project, workspaceRoot: root,
  });
  assert.equal(result.toolCalls, 3); // 程序确定性项目读取 + 表单更新 + 结束
  assert.equal(result.reply, '项目材料已读取，事实表已整理。');
  assert.equal(result.ready, true);
  assert.equal(result.projectContext.files[0].path, 'README.md');
  assert.equal('root' in result.projectContext, false);
  const cached = getFactAttachment(store, { batchId: batch.id, capability: 'filesystem.project.read', arguments: tutorialProjectAttachmentArguments(project) });
  assert.equal(cached.data.summary, result.projectContext.summary);
});

test('自主写作 Agent 的表单工具追加去重，不覆盖已有要点', async (t) => {
  const { root, store, batch } = fixture(t);
  const result = await runTutorialAgentTurn({
    gateway: gateway([
      ({ messages }) => {
        assert.ok(messages.some((item) => item.role === 'system' && item.content.includes('agent.form.update')));
        return native('form', [call('agent.form.update', { operations: [
          { field: 'topic', op: 'replace', value: '工具运行复盘' },
          { field: 'points', op: 'append', values: ['旧要点', '新增要点'] },
        ] }, 'form')]);
      },
      ({ messages }) => {
        assert.ok(messages.some((item) => item.role === 'tool' && item.content.includes('新增要点')));
        return native('finish', [call('agent.conversation.finish', { assistantReply: '已记录本轮表单变化。' }, 'finish')]);
      },
    ]),
    store, registry: projectRegistry(), provider: 'mock', batchId: batch.id, draft: { articleMode: 'tutorial', points: ['旧要点'] }, workspaceRoot: root,
  });
  assert.equal(result.toolCalls, 2);
  assert.equal(result.formUpdates.topic, '工具运行复盘');
  assert.deepEqual(result.formUpdates.points, ['旧要点', '新增要点']);
});

test('项目材料不能让心得模式绕过【体验】门禁', async (t) => {
  const { root, project, store, batch } = fixture(t);
  const result = await runTutorialAgentTurn({
    gateway: gateway([
      native('form', [call('agent.form.update', { operations: [
        { field: 'articleMode', op: 'replace', value: 'experience' },
        { field: 'topic', op: 'replace', value: '项目心得' },
        { field: 'audience', op: 'replace', value: '开发者' },
        { field: 'thesis', op: 'replace', value: '工具仍需打磨' },
        { field: 'points', op: 'append', values: ['【素材】项目包含 README', '【素材】有启动命令', '【建议】检查版本'] },
      ] }, 'form')]),
      native('finish', [call('agent.conversation.finish', { assistantReply: '还需要作者亲自体验后的判断。' }, 'finish')]),
    ]),
    store, registry: projectRegistry(), provider: 'mock', batchId: batch.id, draft: { articleMode: 'experience' }, projectPath: project, workspaceRoot: root,
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ['至少一条【体验】']);
});

test('自主写作允许普通文本回复；不解析旧 JSON', async (t) => {
  const { root, store, batch } = fixture(t);
  const oldJson = JSON.stringify({ assistantReply: '不应接受', briefUpdates: { topic: '不应写入' } });
  const result = await runTutorialAgentTurn({ gateway: gateway([{ callId: 'legacy', content: oldJson, model: 'mock', usage: {} }]), store, registry: projectRegistry(), provider: 'mock', batchId: batch.id, draft: {}, workspaceRoot: root });
  assert.equal(result.reply, oldJson);
});

test('创建事实表可直接复用对话阶段 URL 附件而不重复抓取', async () => {
  let fetched = 0;
  const url = 'https://example.com/material';
  const fact = await buildCustomFactSheet({ input: { content_type: 'tutorial', topic: '示例', points: ['【素材】A', '【素材】B', '【建议】C'], materialUrls: [url] }, root: process.cwd(), materialCache: new Map([[url, { title: '缓存材料', content: '已读取正文' }]]), fetchImpl: async () => { fetched += 1; throw new Error('不应调用'); } });
  assert.equal(fetched, 0);
  assert.equal(fact.materials[0].title, '缓存材料');
  assert.equal(fact.materials[0].status, 'ok');
});
