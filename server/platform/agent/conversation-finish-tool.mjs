// 对话 Agent 的可选显式结束工具。
//
// 表单变化由业务工具写入；模型也可以直接返回普通文本作为本轮回复。
// 只有模型主动调用本工具时，才使用这个显式结束出口。

export const CONVERSATION_FINISH_CAPABILITY = 'agent.conversation.finish';

export function buildConversationFinishTool({
  capability = CONVERSATION_FINISH_CAPABILITY,
  name = '结束本轮对话',
  description = '提交本轮给作者的最终回复。表单字段必须先通过对应表单工具写入。',
} = {}) {
  return Object.freeze({
    capability,
    name,
    description,
    plugin: 'agent-application',
    version: '1.0.0',
    riskLevel: 'local-write',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['assistantReply'],
      properties: {
        assistantReply: { type: 'string', minLength: 1, maxLength: 4000 },
      },
    },
  });
}

export function createConversationFinishHandler() {
  return async (input = {}) => {
    const assistantReply = String(input.assistantReply || '').trim();
    if (!assistantReply) {
      return { status: 'error', error: { code: 'INVALID_INPUT', message: 'assistantReply 不能为空' } };
    }
    if (assistantReply.length > 4000) {
      return { status: 'error', error: { code: 'INVALID_INPUT', message: 'assistantReply 不能超过 4000 个字符' } };
    }
    return {
      status: 'ok',
      data: { assistantReply },
      artifacts: [],
      warnings: [],
      provenance: { provider: 'agent-application', operation: 'conversation-finish' },
    };
  };
}
