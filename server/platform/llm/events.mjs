const EVENT_TYPES = Object.freeze([
  'turn-start',
  'text-start',
  'text-delta',
  'text-end',
  'reasoning-start',
  'reasoning-delta',
  'reasoning-end',
  'tool-input-start',
  'tool-input-delta',
  'tool-input-end',
  'tool-call',
  'tool-result',
  'tool-error',
  'usage',
  'finish',
  'error',
]);

const EVENT_TYPE_SET = new Set(EVENT_TYPES);

export { EVENT_TYPES };

export function createLlmEvent(type, payload = {}) {
  if (!EVENT_TYPE_SET.has(type)) throw new TypeError(`未知 LLMEvent 类型：${type}`);
  return Object.freeze({ ...payload, type });
}

export function isLlmEvent(value, type = null) {
  return Boolean(value && typeof value === 'object'
    && EVENT_TYPE_SET.has(value.type)
    && (type == null || value.type === type));
}

