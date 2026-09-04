import { createLlmEvent } from './events.mjs';

function nextTurnId() {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function* readSseFrames(response) {
  if (!response.body) throw new Error('未返回流式响应体');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    const parseLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) return null;
      const dataText = trimmed.slice(5).trim();
      if (!dataText) return null;
      if (dataText === '[DONE]') return { done: true };
      try {
        return { data: JSON.parse(dataText) };
      } catch {
        return { parseError: dataText.slice(0, 500) };
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const frame = parseLine(line);
        if (frame) yield frame;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const frame = parseLine(buffer);
      if (frame) yield frame;
    }
  } finally {
    try { reader.releaseLock?.(); } catch {}
  }
}

export function parseToolArguments(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  const text = String(raw || '').trim();
  if (!text) return {};
  return JSON.parse(text);
}

// 调用方使用协议无关的 { type:'function', name }；Chat Completions
// 仍要求把函数名放在 function.name 中。auto/required 和 provider 扩展
// 选项保持原样透传。
export function normalizeChatToolChoice(toolChoice) {
  if (!toolChoice || typeof toolChoice === 'string') return toolChoice || null;
  if (toolChoice.type !== 'function') return toolChoice;
  const name = String(toolChoice.name || toolChoice.function?.name || '').trim();
  if (!name) throw new Error('Chat Completions tool_choice 缺少函数名称');
  return { type: 'function', function: { name } };
}

export function normalizeChatToolCalls(toolCalls = []) {
  return (Array.isArray(toolCalls) ? toolCalls : []).map((call, index) => {
    const name = String(call?.function?.name || call?.name || '').trim();
    if (!name) throw new Error(`工具调用 #${index + 1} 缺少名称`);
    let input;
    try {
      input = parseToolArguments(call?.function?.arguments ?? call?.input);
    } catch (error) {
      throw Object.assign(new Error(`工具 ${name} 参数不是合法 JSON：${error.message}`), {
        code: 'INVALID_TOOL_ARGUMENTS',
        cause: error,
      });
    }
    return {
      id: String(call?.id || `call_${index + 1}`),
      name,
      input,
      providerExecuted: false,
    };
  });
}

export async function* chatCompletionsEvents(response, { turnId = nextTurnId() } = {}) {
  let sequence = 0;
  let responseId = null;
  let finishReason = null;
  let textStarted = false;
  let reasoningStarted = false;
  let usage = null;
  const textBlockId = `${turnId}:text`;
  const reasoningBlockId = `${turnId}:reasoning`;
  const toolStates = new Map();
  const emit = (type, payload = {}) => createLlmEvent(type, { turnId, seq: ++sequence, ...payload });

  yield emit('turn-start');

  for await (const frame of readSseFrames(response)) {
    if (frame.done) {
      break;
    }
    if (frame.parseError) {
      yield emit('error', { code: 'LLM_SSE_INVALID_JSON', message: '流式事件不是合法 JSON', raw: frame.parseError, retryable: true });
      return;
    }

    const data = frame.data || {};
    responseId = data.id || responseId;
    if (data.usage) usage = data.usage;
    const choice = data.choices?.[0];
    const delta = choice?.delta || {};

    const text = delta.content ?? choice?.message?.content ?? '';
    if (text) {
      if (!textStarted) {
        textStarted = true;
        yield emit('text-start', { blockId: textBlockId });
      }
      yield emit('text-delta', { blockId: textBlockId, text: String(text) });
    }

    const reasoning = delta.reasoning_content ?? choice?.message?.reasoning_content ?? '';
    if (reasoning) {
      if (!reasoningStarted) {
        reasoningStarted = true;
        yield emit('reasoning-start', { blockId: reasoningBlockId });
      }
      yield emit('reasoning-delta', { blockId: reasoningBlockId, text: String(reasoning) });
    }

    for (const item of delta.tool_calls || []) {
      const key = String(item.index ?? item.id ?? toolStates.size);
      const state = toolStates.get(key) || {
        index: item.index,
        callId: item.id || `${turnId}:call:${key}`,
        name: '',
        arguments: '',
        started: false,
      };
      if (item.id) state.callId = item.id;
      if (item.function?.name) state.name = String(item.function.name);
      if (!state.started) {
        state.started = true;
        yield emit('tool-input-start', { callId: state.callId, name: state.name });
      }
      const argumentDelta = item.function?.arguments;
      if (argumentDelta) {
        const deltaText = String(argumentDelta);
        state.arguments += deltaText;
        yield emit('tool-input-delta', { callId: state.callId, name: state.name, delta: deltaText });
      }
      toolStates.set(key, state);
    }

    if (choice?.finish_reason) finishReason = String(choice.finish_reason);
  }

  if (textStarted) yield emit('text-end', { blockId: textBlockId });
  if (reasoningStarted) yield emit('reasoning-end', { blockId: reasoningBlockId });

  for (const state of toolStates.values()) {
    yield emit('tool-input-end', { callId: state.callId, name: state.name });
    try {
      const input = parseToolArguments(state.arguments);
      yield emit('tool-call', { callId: state.callId, name: state.name, input, providerExecuted: false });
    } catch (error) {
      yield emit('tool-error', {
        callId: state.callId,
        name: state.name,
        code: 'INVALID_TOOL_ARGUMENTS',
        message: `工具参数不是合法 JSON：${error.message}`,
        retryable: true,
      });
    }
  }

  if (usage) yield emit('usage', { usage });
  if (!finishReason) {
    yield emit('error', { code: 'LLM_STREAM_INCOMPLETE', message: '流式响应结束前未收到终止事件', retryable: true });
    return;
  }
  if (finishReason) yield emit('finish', { reason: finishReason, responseId });
}
