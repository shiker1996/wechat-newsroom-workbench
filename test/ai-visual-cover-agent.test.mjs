import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_VISUAL_DOCUMENT_WRITE,
  AI_VISUAL_PROJECT_READ,
  runAiVisualDocumentAgent,
} from '../server/platform/agent/ai-visual-document-agent.mjs';

test('shared AI visual document Agent supports a single 900x383 article cover', async () => {
  const calls = [];
  const writes = [];
  const replies = [
    JSON.stringify({
      type: 'tool_requests',
      assistant_note: '追加封面 HTML',
      requests: [{
        requestId: 'tr_cover_append_1',
        capability: AI_VISUAL_DOCUMENT_WRITE,
        arguments: {
          operation: 'append',
          content: '<!doctype html><html><head><style>.page{width:900px;height:383px}</style></head><body><main class="page"><h1>示例封面</h1></main></body></html>',
        },
        reason: '追加封面 HTML',
      }],
    }),
    JSON.stringify({
      type: 'tool_requests',
      assistant_note: '完成封面写入',
      requests: [{
        requestId: 'tr_cover_finish',
        capability: AI_VISUAL_DOCUMENT_WRITE,
        arguments: { operation: 'finish' },
        reason: '结束封面写入',
      }],
    }),
    JSON.stringify({ type: 'final', assistantReply: '已完成' }),
  ];

  let html = '';
  const toolHandlers = {
    [AI_VISUAL_PROJECT_READ]: async () => ({ status: 'ok', data: { files: [] } }),
    [AI_VISUAL_DOCUMENT_WRITE]: async (args) => {
      writes.push(args);
      if (args.operation === 'append') html += args.content;
      return { status: 'ok', data: { operation: args.operation } };
    },
  };

  const result = await runAiVisualDocumentAgent({
    batchId: 'batch-cover',
    candidateId: 'candidate-cover',
    provider: 'test-provider',
    gateway: {
      async complete(request) {
        calls.push(request);
        return { content: replies.shift() };
      },
    },
    registry: {},
    catalog: [
      { capability: AI_VISUAL_PROJECT_READ },
      { capability: AI_VISUAL_DOCUMENT_WRITE },
      { capability: 'filesystem.project.delete' },
    ],
    agentSystem: '你是封面视觉 Agent。',
    renderRequest: { canvas: { width: 900, height: 383 }, outputPath: 'ai-cover.html' },
    workspaceFiles: ['cover-visual-input.json', 'cover-theme-design-spec.md'],
    requiredPageCount: 1,
    canvas: { width: 900, height: 383 },
    outputPath: 'ai-cover.html',
    documentLabel: '公众号封面',
    entryPoint: 'article-cover-ai-visual-generation',
    skillId: 'article-cover-ai-visual-generator',
    purpose: 'article-cover-ai-visual-generation-agent',
    documentWriteSessionId: 'cover-session',
    getPageCount: () => (html.match(/class="page"/g) ?? []).length,
    toolContext: { toolHandlers },
  });

  assert.equal(result.type, 'final');
  assert.equal(result.pageCount, 1);
  assert.equal(result.documentFinished, true);
  assert.equal(result.outputPath, 'ai-cover.html');
  assert.deepEqual(result.canvas, { width: 900, height: 383 });
  assert.deepEqual(writes.map((item) => item.operation), ['begin', 'append', 'finish']);
  assert.match(writes[1].content, /示例封面/);
  assert.deepEqual(result.allowedCapabilities, [AI_VISUAL_PROJECT_READ, AI_VISUAL_DOCUMENT_WRITE]);
  assert.match(calls.flatMap((call) => call.messages).map((message) => message.content).join('\n'), /900×383/);
});
