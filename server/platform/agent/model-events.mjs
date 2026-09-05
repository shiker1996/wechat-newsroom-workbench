import { AgentContractError } from './tool-protocol.mjs';

// Gateway-normalized calls, Chat Completions calls, and Responses function calls
// all enter the existing native envelope/history path.
export function normalizeModelTurn(turn) {
  if (!turn || typeof turn !== 'object') return turn;
  const calls = turn.toolCalls || turn.tool_calls || (Array.isArray(turn.output) ? turn.output.filter((item) => item.type === 'function_call') : undefined);
  if (!Array.isArray(calls)) return turn;
  return { ...turn, toolCalls: calls.map((call) => {
    let input = call.input ?? call.function?.arguments ?? call.arguments ?? {};
    if (typeof input === 'string') {
      try { input = JSON.parse(input); }
      catch { throw new AgentContractError('INVALID_TOOL_ARGUMENTS', '原生工具参数不是合法 JSON'); }
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AgentContractError('INVALID_TOOL_ARGUMENTS', '原生工具参数必须是对象');
    return { id: call.call_id || call.id, name: call.name || call.function?.name, input };
  }) };
}

const INTERNAL_TYPES = Object.freeze({ 'assistant.delta': 'model.text', 'assistant.thinking': 'model.thinking', done: 'run.completed', error: 'run.failed', 'agent.limit': 'run.limited' });
export function toHarnessEvent(event) {
  return Object.freeze({ ...event, type: INTERNAL_TYPES[event.type] || event.type, schemaVersion: 1 });
}
