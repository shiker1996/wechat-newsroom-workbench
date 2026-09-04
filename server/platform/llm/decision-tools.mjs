export const DECISION_TOOLS_EXTENSION_TYPE = 'system';
export const DECISION_TOOLS_EXTENSION_ID = 'llm-decision-tools';
export const DEFAULT_DECISION_TOOL_SETTINGS = Object.freeze({
  decisionToolsEnabled: false,
  decisionToolOverrides: Object.freeze({}),
});

export class DecisionToolError extends Error {
  constructor(code, message, issues = []) {
    super(message);
    this.name = 'DecisionToolError';
    this.code = code;
    this.issues = issues;
  }
}

function providerOf(gateway, providerName = '') {
  const name = providerName || gateway?.config?.defaultProvider;
  return { name, provider: gateway?.config?.providers?.[name] || null };
}

// 当前 provider 配置已经有 supportsNativeTools。supportsForcedToolChoice
// 作为可选的更窄能力开关：未配置时兼容旧配置，显式 false 才禁用。
export function providerSupportsForcedToolChoice(gateway, providerName = '') {
  const { provider } = providerOf(gateway, providerName);
  return provider?.supportsNativeTools === true && provider?.supportsForcedToolChoice !== false;
}

export function supportsDecisionTools(gateway, providerName = '') {
  return providerSupportsForcedToolChoice(gateway, providerName);
}

export function normalizeDecisionToolSettings(value = {}) {
  const overrides = value?.decisionToolOverrides ?? value?.overrides;
  const decisionToolOverrides = Object.fromEntries(
    Object.entries(overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {})
      .filter(([name, enabled]) => String(name).trim() && typeof enabled === 'boolean')
      .map(([name, enabled]) => [String(name).trim(), enabled]),
  );
  return {
    decisionToolsEnabled: value?.decisionToolsEnabled === true || value?.enabled === true,
    decisionToolOverrides,
  };
}

export function readDecisionToolSettings(repository, scope = 'workspace') {
  const stored = repository?.get?.(DECISION_TOOLS_EXTENSION_TYPE, DECISION_TOOLS_EXTENSION_ID, scope);
  return normalizeDecisionToolSettings(stored?.value || DEFAULT_DECISION_TOOL_SETTINGS);
}

export function saveDecisionToolSettings(repository, value, scope = 'workspace') {
  if (!repository?.save) throw new TypeError('缺少决策工具设置仓库');
  const settings = normalizeDecisionToolSettings(value);
  repository.save({
    extensionType: DECISION_TOOLS_EXTENSION_TYPE,
    extensionId: DECISION_TOOLS_EXTENSION_ID,
    scope,
    value: settings,
    configured: true,
    status: 'ready',
  });
  return settings;
}

export function decisionToolEnabled({ gateway, provider = '', repository = null, toolName = '', settings = null } = {}) {
  if (!supportsDecisionTools(gateway, provider)) return false;
  const current = settings ? normalizeDecisionToolSettings(settings) : readDecisionToolSettings(repository);
  if (!current.decisionToolsEnabled) return false;
  const override = current.decisionToolOverrides[String(toolName || '').trim()];
  return override !== false;
}

export function decisionToolDefinition({ name, description = '', parameters = { type: 'object' }, strict = false } = {}) {
  const toolName = String(name || '').trim();
  if (!toolName) throw new TypeError('决策工具缺少名称');
  return {
    type: 'function',
    function: {
      name: toolName,
      description: String(description || '').slice(0, 1024),
      parameters: structuredClone(parameters || { type: 'object' }),
      ...(strict ? { strict: true } : {}),
    },
  };
}

export const DECISION_TITLE_PLAN_TOOL = decisionToolDefinition({
  name: 'decision.title_plan',
  description: '生成标题候选、选中标题和核心关键词，不新增事实或结论。',
  parameters: {
    type: 'object',
    required: ['selectedTitle', 'titleCandidates', 'coreKeywords'],
    properties: {
      selectedTitle: { type: 'string', minLength: 1, maxLength: 120 },
      titleCandidates: {
        type: 'array', minItems: 1, maxItems: 12,
        items: {
          type: 'object', required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 120 },
            reason: { type: 'string', maxLength: 500 },
            score: { type: 'number', minimum: 0, maximum: 100 },
          },
        },
      },
      coreKeywords: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 40 } },
    },
  },
});

export function normalizeDecisionTitlePlan(value, { fallbackTitle = '' } = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const titleCandidates = [];
  const seen = new Set();
  for (const item of Array.isArray(source.titleCandidates) ? source.titleCandidates : []) {
    const title = String(typeof item === 'string' ? item : item?.title || '').trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    titleCandidates.push({
      ...(typeof item === 'object' && item ? item : {}),
      title,
      reason: String(typeof item === 'object' && item ? item.reason || '' : '').trim(),
    });
  }
  const fallback = String(fallbackTitle || '').trim();
  if (!titleCandidates.length && fallback) titleCandidates.push({ title: fallback, reason: '' });
  const requested = String(source.selectedTitle || '').trim();
  const selectedTitle = titleCandidates.find((item) => item.title === requested)?.title
    || titleCandidates[0]?.title
    || fallback;
  const coreKeywords = [...new Set((Array.isArray(source.coreKeywords) ? source.coreKeywords : [])
    .map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 12);
  return { ...source, selectedTitle, titleCandidates, coreKeywords };
}

function pathText(path) {
  return path || '$';
}

function issue(path, code, message) {
  return { path: pathText(path), code, message };
}

function typeMatches(value, type) {
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'null') return value === null;
  return true;
}

function validateValue(value, schema = {}, path = '$') {
  const issues = [];
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    issues.push(issue(path, 'ENUM', `值不在允许枚举中`));
    return issues;
  }
  if (Object.hasOwn(schema, 'const') && !Object.is(schema.const, value)) {
    issues.push(issue(path, 'CONST', '值不符合固定值约束'));
    return issues;
  }
  if (schema.type && !typeMatches(value, schema.type)) {
    issues.push(issue(path, 'TYPE', `类型应为 ${schema.type}`));
    return issues;
  }
  if (typeof value === 'string') {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) issues.push(issue(path, 'MIN_LENGTH', `字符串长度不能少于 ${schema.minLength}`));
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) issues.push(issue(path, 'MAX_LENGTH', `字符串长度不能超过 ${schema.maxLength}`));
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) issues.push(issue(path, 'MINIMUM', `数值不能小于 ${schema.minimum}`));
    if (typeof schema.maximum === 'number' && value > schema.maximum) issues.push(issue(path, 'MAXIMUM', `数值不能大于 ${schema.maximum}`));
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) issues.push(issue(path, 'MIN_ITEMS', `数组项数不能少于 ${schema.minItems}`));
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) issues.push(issue(path, 'MAX_ITEMS', `数组项数不能超过 ${schema.maxItems}`));
    if (schema.items) value.forEach((item, index) => issues.push(...validateValue(item, schema.items, `${path}[${index}]`)));
  }
  if (typeMatches(value, 'object')) {
    const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (!Object.hasOwn(value, key)) issues.push(issue(`${path}.${key}`, 'REQUIRED', '缺少必填字段'));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) issues.push(issue(`${path}.${key}`, 'ADDITIONAL_PROPERTY', '不允许出现额外字段'));
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) issues.push(...validateValue(value[key], childSchema, `${path}.${key}`));
    }
  }
  return issues;
}

export function validateDecisionToolArguments(value, schema = { type: 'object' }) {
  const issues = validateValue(value, schema);
  return { valid: issues.length === 0, issues };
}

export function extractDecisionToolArguments(result, { toolName, schema = { type: 'object' } } = {}) {
  const expectedName = String(toolName || '').trim();
  const calls = Array.isArray(result?.toolCalls) ? result.toolCalls : [];
  if (calls.length !== 1) throw new DecisionToolError('INVALID_TOOL_CALL_COUNT', `决策工具应返回 1 次调用，实际为 ${calls.length} 次`);
  const call = calls[0];
  if (String(call?.name || '').trim() !== expectedName) throw new DecisionToolError('INVALID_TOOL_NAME', `决策工具名称不匹配：期望 ${expectedName}，实际 ${call?.name || '空'}`);
  if (call?.providerExecuted === true) throw new DecisionToolError('PROVIDER_EXECUTED_TOOL', '决策工具不能由 provider 代执行');
  const input = call?.input;
  const validation = validateDecisionToolArguments(input, schema);
  if (!validation.valid) throw new DecisionToolError('INVALID_TOOL_ARGUMENTS', '决策工具参数校验失败', validation.issues);
  return input;
}

async function runFallback(fallback, context) {
  if (typeof fallback === 'function') return fallback(context);
  return fallback;
}

export async function callDecisionTool({
  gateway,
  provider = '',
  repository = null,
  settings = null,
  purpose,
  batchId = null,
  candidateId = null,
  definition,
  schema = definition?.function?.parameters || { type: 'object' },
  messages = [],
  fallback,
  enabled = null,
} = {}) {
  if (typeof gateway?.complete !== 'function') throw new TypeError('缺少模型 gateway.complete');
  const toolName = String(definition?.function?.name || definition?.name || '').trim();
  if (!toolName) throw new TypeError('决策工具定义缺少函数名称');
  const useTool = enabled == null
    ? decisionToolEnabled({ gateway, provider, repository, toolName, settings })
    : enabled === true;
  if (!useTool) return { mode: 'fallback', value: await runFallback(fallback, { reason: 'disabled' }), reason: 'disabled' };

  let result = null;
  try {
    result = await gateway.complete({
      provider,
      purpose,
      batchId,
      candidateId,
      thinking: false,
      jsonMode: false,
      nativeTools: false,
      tools: [definition],
      toolChoice: { type: 'function', name: toolName },
      messages,
    });
    const value = extractDecisionToolArguments(result, { toolName, schema });
    return { mode: 'tool', value, result };
  } catch (error) {
    if (result?.callId != null) {
      gateway.store?.updateModelCall?.(result.callId, {
        status: error instanceof DecisionToolError ? 'invalid_output' : 'failed',
        error: `[${error.code || 'DECISION_TOOL_FAILED'}] ${error.message}`,
      });
    }
    if (fallback === undefined) throw error;
    return {
      mode: 'fallback',
      value: await runFallback(fallback, { reason: error.code || 'failed', error, result }),
      reason: error.code || 'failed',
      error,
      result,
    };
  }
}
