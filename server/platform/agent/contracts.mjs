// Phase 0 contract baseline only. Production conversations do not consume this module yet.
export const CONVERSATION_AGENT_SCHEMA_VERSION = 1;

export const CONVERSATION_AGENT_ENTRY_POINTS = Object.freeze([
  'editorial',
  'independent-writing',
  'custom-social',
]);

export const CONVERSATION_AGENT_ERROR_CODES = Object.freeze([
  'INVALID_AGENT_ENVELOPE',
  'CAPABILITY_NOT_VISIBLE',
  'INVALID_TOOL_ARGUMENTS',
  'RESOURCE_NOT_ALLOWED',
  'TOOL_DEPENDENCY_MISSING',
  'TOOL_PERMISSION_DENIED',
  'TOOL_TIMEOUT',
  'TOOL_EXECUTION_FAILED',
  'TOOL_OUTPUT_INVALID',
  'AGENT_BUDGET_EXCEEDED',
  'AGENT_ABORTED',
]);

export const CONVERSATION_AGENT_STREAM_EVENTS = Object.freeze([
  'assistant.delta',
  'assistant.thinking',
  'tool.requested',
  'tool.running',
  'tool.completed',
  'tool.failed',
  'tool.needs_confirmation',
  'agent.limit',
  'done',
  'error',
]);

export const CONVERSATION_AGENT_BUDGET_DEFAULTS = Object.freeze({
  maxModelSteps: 3,
  maxToolCalls: 5,
  maxParallelToolCalls: 3,
  maxToolResultChars: 8000,
  maxTotalToolResultChars: 24000,
  timeoutMs: 90000,
  maxDuplicateCalls: 1,
});

export const CONVERSATION_AGENT_BUDGET_LIMITS = Object.freeze({
  maxModelSteps: 5,
  maxToolCalls: 8,
  maxParallelToolCalls: 4,
  maxToolResultChars: 16000,
  maxTotalToolResultChars: 48000,
  timeoutMs: 90000,
  maxDuplicateCalls: 1,
});
