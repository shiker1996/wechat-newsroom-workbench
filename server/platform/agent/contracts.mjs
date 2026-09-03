// Shared contract constants for production conversation agents and their phase-0 baseline tests.
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
  maxHistoryChars: 120000,
  timeoutMs: 90000,
  maxDuplicateCalls: 1,
});

export const CONVERSATION_AGENT_BUDGET_LIMITS = Object.freeze({
  // 视觉 Agent 需要一次完整读取、整组初审和若干“修复后再审计”轮次；
  // 24 步仍是异常循环的上限，但不会把正常的整组修复截断在 16 步。
  maxModelSteps: 24,
  maxToolCalls: 24,
  maxParallelToolCalls: 4,
  // 文件读取类 Agent 需要把多个候选资料文件交给模型；16KB 会把
  // card-plan.json 截成前缀，导致事实文件后半段无法进入模型上下文。
  maxToolResultChars: 80000,
  maxTotalToolResultChars: 320000,
  maxHistoryChars: 300000,
  timeoutMs: 300000,
  maxDuplicateCalls: 1,
});
