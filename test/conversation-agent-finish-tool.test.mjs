import assert from 'node:assert/strict';
import test from 'node:test';
import { runConversationAgent } from '../server/platform/agent/conversation-agent.mjs';
import { buildConversationToolCatalog, toolNameForCapability } from '../server/platform/agent/tool-catalog.mjs';
import { buildConversationFinishTool, createConversationFinishHandler, CONVERSATION_FINISH_CAPABILITY } from '../server/platform/agent/conversation-finish-tool.mjs';

function registry() { return { listCapabilities: () => [], resolve: () => null }; }
function nativeFinish(reply) { return { nativeTools: true, content: '', toolCalls: [{ id: 'finish-call', name: toolNameForCapability(CONVERSATION_FINISH_CAPABILITY), input: { assistantReply: reply } }] }; }

test('结束工具校验 assistantReply', async () => {
  const handler = createConversationFinishHandler();
  assert.equal((await handler({ assistantReply: '完成' })).status, 'ok');
  assert.equal((await handler({ assistantReply: ' ' })).error.code, 'INVALID_INPUT');
  assert.equal((await handler({ assistantReply: 'x'.repeat(4001) })).error.code, 'INVALID_INPUT');
  assert.equal(buildConversationFinishTool().capability, CONVERSATION_FINISH_CAPABILITY);
});

test('运行器收到结束工具后直接完成，不解析普通文本 JSON', async () => {
  const finishTool = buildConversationFinishTool();
  const catalog = buildConversationToolCatalog({ registry: registry(), applicationTools: [finishTool] });
  const result = await runConversationAgent({
    entryPoint: 'test', catalog, registry: registry(), messages: [],
    toolContext: { toolHandlers: { [CONVERSATION_FINISH_CAPABILITY]: createConversationFinishHandler() } },
    modelStep: async () => nativeFinish('本轮完成'),
  });
  assert.equal(result.type, 'final');
  assert.equal(result.assistantReply, '本轮完成');
  assert.equal(result.toolCalls, 1);
});

test('原生工具轮次没有 toolCalls 时返回普通文本，不回退解析 JSON', async () => {
  const finishTool = buildConversationFinishTool();
  const catalog = buildConversationToolCatalog({ registry: registry(), applicationTools: [finishTool] });
  const legacyJson = '{"type":"final","assistantReply":"不应解析"}';
  const result = await runConversationAgent({
    entryPoint: 'test', catalog, registry: registry(), messages: [],
    modelStep: async () => ({ nativeTools: true, content: '{"type":"final","assistantReply":"不应解析"}' }),
  });
  assert.equal(result.type, 'final');
  assert.equal(result.assistantReply, legacyJson);
  assert.equal(result.toolCalls, 0);
});
