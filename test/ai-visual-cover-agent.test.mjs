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
      { capability: 'cap_filesystem_project_delete' },
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

test('shared AI visual document Agent can use native function tools for append and finish', async () => {
  const calls = [];
  const writes = [];
  let html = '';
  const appendContent = '<!doctype html><html><body><main class="page"><h1>原生封面</h1></main></body></html>';
  const toolHandlers = {
    [AI_VISUAL_PROJECT_READ]: async () => ({ status: 'ok', data: { files: [] } }),
    [AI_VISUAL_DOCUMENT_WRITE]: async (args) => {
      writes.push(args);
      if (args.operation === 'append') html += args.content;
      return { status: 'ok', data: { operation: args.operation } };
    },
  };
  const documentTool = 'cap_filesystem_project_document_write';
  let modelCalls = 0;
  const gateway = {
    config: { defaultProvider: 'test-provider', providers: { 'test-provider': { supportsNativeTools: true, supportsToolCallStreaming: false, maxOutputTokens: 10000 } } },
    async complete(input) {
      calls.push(input);
      assert.equal(input.nativeTools, true);
      assert.equal(input.jsonMode, false);
      assert.equal(input.tools.length, 2);
      modelCalls += 1;
      if (modelCalls === 1) return { content: '', toolCalls: [{ id: 'call_append', name: documentTool, input: { operation: 'append', content: appendContent } }] };
      if (modelCalls === 2) return { content: '', toolCalls: [{ id: 'call_finish', name: documentTool, input: { operation: 'finish' } }] };
      return { content: JSON.stringify({ type: 'final', assistantReply: '已完成' }) };
    },
  };
  const result = await runAiVisualDocumentAgent({
    batchId: 'batch-native-cover', candidateId: 'candidate-native-cover', provider: 'test-provider', gateway,
    registry: {},
    catalog: [{ capability: AI_VISUAL_PROJECT_READ }, { capability: AI_VISUAL_DOCUMENT_WRITE }],
    agentSystem: '你是封面视觉 Agent。', renderRequest: {}, workspaceFiles: ['cover-visual-input.json'],
    requiredPageCount: 1, canvas: { width: 900, height: 383 }, outputPath: 'ai-cover.html', documentLabel: '公众号封面',
    documentWriteSessionId: 'native-cover-session', getPageCount: () => (html.match(/class="page"/g) ?? []).length,
    toolContext: { toolHandlers },
  });
  assert.equal(result.type, 'final');
  assert.equal(result.documentFinished, true);
  assert.deepEqual(writes.map((item) => item.operation), ['begin', 'append', 'finish']);
  assert.match(html, /原生封面/);
  assert.equal(calls[2].tools[1].function.name, documentTool);
});

test('shared AI visual document Agent forwards streamed thinking events', async () => {
  const events = [];
  const documentTool = 'cap_filesystem_project_document_write';
  let html = '';
  let modelCalls = 0;
  const gateway = {
    config: { defaultProvider: 'test-provider', providers: { 'test-provider': { supportsNativeTools: true, supportsToolCallStreaming: true, maxOutputTokens: 10000 } } },
    async streamComplete(input, onDelta, onThinking) {
      modelCalls += 1;
      if (input.thinking) onThinking(`规划片段${modelCalls}`);
      if (modelCalls === 1) return { content: '', toolCalls: [{ id: 'call_append_stream', name: documentTool, input: { operation: 'append', content: '<main class="page">流式封面</main>' } }] };
      if (modelCalls === 2) return { content: '', toolCalls: [{ id: 'call_finish_stream', name: documentTool, input: { operation: 'finish' } }] };
      return { content: JSON.stringify({ type: 'final', assistantReply: '已完成' }) };
    },
  };
  const toolHandlers = {
    [AI_VISUAL_PROJECT_READ]: async () => ({ status: 'ok', data: { files: [] } }),
    [AI_VISUAL_DOCUMENT_WRITE]: async (args) => {
      if (args.operation === 'append') html += args.content;
      return { status: 'ok', data: { operation: args.operation } };
    },
  };
  const result = await runAiVisualDocumentAgent({
    batchId: 'batch-stream-thinking', candidateId: 'candidate-stream-thinking', provider: 'test-provider', gateway,
    registry: {}, catalog: [{ capability: AI_VISUAL_PROJECT_READ }, { capability: AI_VISUAL_DOCUMENT_WRITE }],
    agentSystem: '你是封面视觉 Agent。', renderRequest: {}, workspaceFiles: ['cover-visual-input.json'],
    requiredPageCount: 1, canvas: { width: 900, height: 383 }, outputPath: 'ai-cover.html', documentLabel: '公众号封面',
    documentWriteSessionId: 'stream-thinking-session', getPageCount: () => (html.match(/class="page"/g) ?? []).length,
    toolContext: { toolHandlers }, onEvent: (event) => events.push(event),
  });
  assert.equal(result.type, 'final');
  assert.deepEqual(events.filter((event) => event.type === 'assistant.thinking').map((event) => event.text), ['规划片段1']);
});
