import { createLlmEvent } from './events.mjs';
import { parseToolArguments } from './stream-events.mjs';

function nextTurnId() {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function responsesEndpoint(baseUrl) {
  const value = String(baseUrl || '').replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  return /\/responses$/i.test(value) ? value : `${value}/responses`;
}

function messageContent(message) {
  if (Array.isArray(message?.content)) return message.content;
  return String(message?.content ?? '');
}

// Responses 的历史不是 Chat Completions 的 assistant.tool_calls/tool 消息，
// 而是 function_call/function_call_output input item。普通消息仍保持 message item。
export function wireResponsesInput(messages = [], { nativeTools = false } = {}) {
  const output = [];
  for (const message of messages) {
    const { protected: _protected, tool_calls: toolCalls, tool_call_id: toolCallId, ...rest } = message || {};
    if (rest.role === 'tool' && nativeTools && toolCallId) {
      output.push({ type: 'function_call_output', call_id: String(toolCallId), output: String(rest.content ?? '') });
      continue;
    }
    if (rest.role === 'assistant' && nativeTools && Array.isArray(toolCalls) && toolCalls.length) {
      if (String(rest.content ?? '').trim()) output.push({ type: 'message', role: 'assistant', content: messageContent(rest) });
      for (const call of toolCalls) {
        const functionCall = call?.function || call || {};
        output.push({
          type: 'function_call',
          call_id: String(call?.id || call?.call_id || `call_${output.length + 1}`),
          name: String(functionCall.name || ''),
          arguments: typeof functionCall.arguments === 'string' ? functionCall.arguments : JSON.stringify(functionCall.arguments || {}),
        });
      }
      continue;
    }
    if (rest.role === 'tool') {
      output.push({ role: 'user', content: String(rest.content ?? '') });
      continue;
    }
    output.push({ role: rest.role, content: messageContent(rest) });
  }
  return output;
}

export function responsesToolDefinitions(tools = []) {
  return tools.map((tool) => {
    const builtinType = String(tool?.type || '').trim();
    if (builtinType === 'web_search' || builtinType === 'web_search_2025_08_26') {
      return { type: builtinType };
    }
    const fn = tool?.function || tool || {};
    return {
      type: 'function',
      name: String(fn.name || tool.name || ''),
      description: String(fn.description || tool.description || '').slice(0, 1024),
      parameters: structuredClone(fn.parameters || tool.parameters || { type: 'object' }),
      ...(fn.strict != null || tool.strict != null ? { strict: Boolean(fn.strict ?? tool.strict) } : {}),
    };
  });
}

export function responsesReasoningPayload(thinking, provider) {
  if (thinking === false) {
    // DeepSeek Responses 在省略 reasoning 时默认开启思考；必须显式传 effort:none。
    if (provider.responsesReasoningToggle || provider.protocol === 'responses') return { reasoning: { effort: 'none' } };
    return {};
  }
  if (!provider.reasoningEffort && !provider.responsesReasoning) return {};
  return { reasoning: { effort: provider.reasoningEffort || 'medium' } };
}

export function responsesPayload({ provider, messages, maxOutputTokens, temperature = 0.2, jsonMode = false, thinking, tools = [], toolChoice = null, nativeTools = false, stream = false }) {
  // Responses API 的工具必须通过 tools 传入；联网搜索使用 DeepSeek 的内置
  // web_search tool，不使用 Chat Completions 风格的 webSearch 顶层开关。
  const responseTools = Array.isArray(tools) ? tools : [];
  const payload = {
    model: provider.model,
    input: wireResponsesInput(messages, { nativeTools }),
    max_output_tokens: Math.min(maxOutputTokens || provider.maxOutputTokens, provider.maxOutputTokens),
    temperature,
  };
  if (stream) payload.stream = true;
  Object.assign(payload, responsesReasoningPayload(thinking, provider));
  if (responseTools.length) payload.tools = responsesToolDefinitions(responseTools);
  if (toolChoice) payload.tool_choice = toolChoice;
  if (jsonMode && !responseTools.length) payload.text = { format: { type: 'json_object' } };
  return payload;
}

function outputItems(data) {
  return Array.isArray(data?.output) ? data.output : [];
}

function outputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  return outputItems(data).flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((part) => part?.type === 'output_text' || part?.type === 'text')
    .map((part) => String(part.text || '')).join('');
}

function outputReasoning(data) {
  return outputItems(data).flatMap((item) => {
    if (item?.type !== 'reasoning') return [];
    if (Array.isArray(item.content)) return item.content;
    if (Array.isArray(item.summary)) return item.summary;
    return [];
  }).map((part) => String(part.text || part.content || '')).join('');
}

function normalizeResponsesUsage(usage = {}) {
  const reasoningTokens = usage.output_tokens_details?.reasoning_tokens
    ?? usage.completion_tokens_details?.reasoning_tokens;
  return {
    ...usage,
    prompt_tokens: usage.prompt_tokens ?? usage.input_tokens,
    completion_tokens: usage.completion_tokens ?? usage.output_tokens,
    ...(reasoningTokens == null ? {} : {
      completion_tokens_details: { ...(usage.completion_tokens_details || {}), reasoning_tokens: reasoningTokens },
    }),
  };
}

export function normalizeResponsesToolCalls(data) {
  return outputItems(data).flatMap((item, index) => {
    if (item?.type === 'web_search_call') {
      return [{
        id: String(item.id || `web_search_${index + 1}`),
        name: 'web_search',
        input: item.action || item.input || {},
        providerExecuted: true,
        status: item.status || null,
      }];
    }
    if (item?.type !== 'function_call') return [];
    const name = String(item.name || '').trim();
    if (!name) throw new Error(`工具调用 #${index + 1} 缺少名称`);
    return [{
      id: String(item.call_id || item.id || `call_${index + 1}`),
      name,
      input: parseToolArguments(item.arguments ?? item.input),
      providerExecuted: false,
    }];
  });
}

export function normalizeResponsesResponse(data, providerName = 'Responses') {
  const toolCalls = normalizeResponsesToolCalls(data);
  const content = outputText(data);
  const reasoning = outputReasoning(data);
  const status = String(data?.status || 'completed');
  const incompleteReason = data?.incomplete_details?.reason || data?.response?.incomplete_details?.reason;
  const finishReason = status === 'completed' ? 'stop' : status === 'incomplete' ? (incompleteReason || 'length') : status;
  if (status === 'failed' || data?.error) throw new Error(`${providerName} ${data.error?.message || 'Responses 响应失败'}`);
  if (!content.trim() && !toolCalls.length) throw new Error(`${providerName} 未返回文本内容（status=${status}）`);
  return { content, reasoning, usage: normalizeResponsesUsage(data?.usage || {}), id: data?.id || null, finishReason, toolCalls };
}

async function* readResponsesSseFrames(response) {
  if (!response.body) throw new Error('未返回流式响应体');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  let dataLines = [];
  const flush = () => {
    if (!dataLines.length) return null;
    const dataText = dataLines.join('\n').trim();
    const result = { event: eventName, data: dataText };
    eventName = '';
    dataLines = [];
    if (!dataText || dataText === '[DONE]') return { ...result, done: true };
    try { return { ...result, data: JSON.parse(dataText) }; }
    catch { return { ...result, parseError: dataText.slice(0, 500) }; }
  };
  try {
    const consume = function* (line) {
      if (line === '') { const frame = flush(); if (frame) yield frame; return; }
      if (line.startsWith(':')) return;
      const separator = line.indexOf(':');
      const field = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
      if (field === 'event') eventName = value;
      if (field === 'data') dataLines.push(value);
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) yield* consume(line);
    }
    buffer += decoder.decode();
    if (buffer) yield* consume(buffer);
    const frame = flush();
    if (frame) yield frame;
  } finally { try { reader.releaseLock?.(); } catch {} }
}

function eventPayload(frame) {
  return frame?.data && typeof frame.data === 'object' ? frame.data : {};
}

export async function* responsesEvents(response, { turnId = nextTurnId() } = {}) {
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
  for await (const frame of readResponsesSseFrames(response)) {
    if (frame.done) break;
    if (frame.parseError) { yield emit('error', { code: 'LLM_SSE_INVALID_JSON', message: 'Responses 流式事件不是合法 JSON', raw: frame.parseError, retryable: true }); return; }
    const data = eventPayload(frame);
    const eventType = String(frame.event || data.type || '').trim();
    const responseData = data.response || {};
    responseId = data.response_id || data.id || responseData.id || responseId;
    usage = data.usage || responseData.usage || usage;
    if (eventType === 'response.output_text.delta') {
      const text = data.delta ?? data.text ?? '';
      if (text) {
        if (!textStarted) { textStarted = true; yield emit('text-start', { blockId: textBlockId }); }
        yield emit('text-delta', { blockId: textBlockId, text: String(text) });
      }
    } else if (eventType === 'response.reasoning_text.delta' || eventType === 'response.reasoning_summary_text.delta' || eventType === 'response.reasoning.delta') {
      const text = data.delta ?? data.text ?? '';
      if (text) {
        if (!reasoningStarted) { reasoningStarted = true; yield emit('reasoning-start', { blockId: reasoningBlockId }); }
        yield emit('reasoning-delta', { blockId: reasoningBlockId, text: String(text) });
      }
    } else if (eventType === 'response.output_item.added') {
      const item = data.item || {};
      if (item.type === 'function_call') {
        const callId = String(item.call_id || item.id || `${turnId}:call:${toolStates.size}`);
        toolStates.set(String(item.id || callId), { callId, name: String(item.name || ''), arguments: String(item.arguments || ''), started: false });
      }
    } else if (eventType === 'response.function_call_arguments.delta') {
      const key = String(data.item_id || data.output_index || data.call_id || '0');
      const state = toolStates.get(key) || { callId: String(data.call_id || `${turnId}:call:${key}`), name: String(data.name || ''), arguments: '', started: false };
      if (data.call_id) state.callId = String(data.call_id);
      if (data.name) state.name = String(data.name);
      if (!state.started) { state.started = true; yield emit('tool-input-start', { callId: state.callId, name: state.name }); }
      const delta = String(data.delta || '');
      if (delta) { state.arguments += delta; yield emit('tool-input-delta', { callId: state.callId, name: state.name, delta }); }
      toolStates.set(key, state);
    } else if (eventType === 'response.output_item.done') {
      const item = data.item || {};
      if (item.type === 'function_call') {
        const key = String(item.id || item.call_id || data.output_index || toolStates.size);
        const state = toolStates.get(key) || { callId: String(item.call_id || item.id), name: String(item.name || ''), arguments: '', started: false };
        state.callId = String(item.call_id || state.callId);
        state.name = String(item.name || state.name);
        state.arguments = String(item.arguments ?? state.arguments);
        if (!state.started) { state.started = true; yield emit('tool-input-start', { callId: state.callId, name: state.name }); }
        toolStates.set(key, state);
      }
    } else if (eventType === 'response.completed') {
      finishReason = 'stop';
    } else if (eventType === 'response.incomplete') {
      finishReason = responseData.incomplete_details?.reason || data.incomplete_details?.reason || 'length';
    } else if (eventType === 'response.failed') {
      yield emit('error', { code: 'LLM_RESPONSES_FAILED', message: data.error?.message || responseData.error?.message || 'Responses 流式响应失败', retryable: true });
      return;
    }
  }
  if (textStarted) yield emit('text-end', { blockId: textBlockId });
  if (reasoningStarted) yield emit('reasoning-end', { blockId: reasoningBlockId });
  for (const state of toolStates.values()) {
    yield emit('tool-input-end', { callId: state.callId, name: state.name });
    try { yield emit('tool-call', { callId: state.callId, name: state.name, input: parseToolArguments(state.arguments), providerExecuted: false }); }
    catch (error) { yield emit('tool-error', { callId: state.callId, name: state.name, code: 'INVALID_TOOL_ARGUMENTS', message: `工具参数不是合法 JSON：${error.message}`, retryable: true }); }
  }
  if (usage) yield emit('usage', { usage: normalizeResponsesUsage(usage) });
  if (!finishReason) { yield emit('error', { code: 'LLM_STREAM_INCOMPLETE', message: 'Responses 流式响应结束前未收到终止事件', retryable: true }); return; }
  yield emit('finish', { reason: finishReason, responseId });
}
