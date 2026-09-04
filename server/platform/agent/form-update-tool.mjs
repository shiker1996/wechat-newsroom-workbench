// Agent 业务表单的统一增量更新协议。
//
// 表单字段不是一次性整包提交：多值字段使用 append/remove/clear，单值字段使用
// replace/set/clear。这样模型可以补一条而不覆盖旧内容，也不能用“返回一份较短
// 的数组”隐式删除用户已经确认的内容。

const OPERATIONS = Object.freeze(['append', 'replace', 'set', 'remove', 'clear']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asLines(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(asLines);
  return String(value).split(/\r?\n+/u).map((item) => item.trim()).filter(Boolean);
}

function entryKey(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function uniqueLines(values) {
  const result = [];
  const seen = new Set();
  for (const value of asLines(values)) {
    const key = entryKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(String(value).trim());
  }
  return result;
}

function fieldKind(spec) {
  return spec?.kind === 'list' || spec?.kind === 'url-list' ? 'list' : spec?.kind || 'text';
}

function normalizeValue(spec, value) {
  if (typeof spec?.normalize === 'function') return spec.normalize(value);
  const kind = fieldKind(spec);
  if (kind === 'list') return uniqueLines(value);
  if (kind === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  if (kind === 'boolean') return value === true;
  return String(value ?? '').trim();
}

function validateValue(spec, value) {
  if (typeof spec?.validate !== 'function') return true;
  return spec.validate(value) === true;
}

function normalizeState(state, fields) {
  const source = isObject(state) ? state : {};
  const next = {};
  for (const [field, spec] of Object.entries(fields || {})) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
    const value = normalizeValue(spec, source[field]);
    if (value !== undefined) next[field] = value;
  }
  return next;
}

function operationValues(operation) {
  if (Object.prototype.hasOwnProperty.call(operation, 'values')) return operation.values;
  return operation.value;
}

function fail(field, message) {
  return { field, message };
}

function applyOne(current, operation, spec) {
  const kind = fieldKind(spec);
  const op = String(operation.op || operation.operation || '').trim();
  if (!OPERATIONS.includes(op)) return { error: fail(operation.field, `不支持的操作：${op || '空'}`) };
  const allowed = Array.isArray(spec.operations) ? spec.operations : kind === 'list' ? ['append', 'replace', 'remove', 'clear'] : ['replace', 'set', 'clear'];
  if (!allowed.includes(op)) return { error: fail(operation.field, `字段不支持 ${op} 操作`) };

  if (op === 'clear') return { value: kind === 'list' ? [] : kind === 'boolean' ? false : kind === 'number' ? undefined : '' };

  const raw = operationValues(operation);
  if (raw === undefined) return { error: fail(operation.field, `${op} 操作缺少 value 或 values`) };

  if (kind === 'list') {
    const incoming = uniqueLines(raw);
    if (!incoming.length) return { error: fail(operation.field, '列表操作至少需要一条非空内容') };
    if (spec.kind === 'url-list' && incoming.some((item) => !/^https?:\/\//iu.test(item))) {
      return { error: fail(operation.field, 'URL 列表只能包含 http/https 地址') };
    }
    if (typeof spec.validate === 'function' && incoming.some((item) => !validateValue(spec, item))) {
      return { error: fail(operation.field, '列表中包含不符合字段规则的内容') };
    }
    const existing = uniqueLines(current);
    if (op === 'append') return { value: uniqueLines([...existing, ...incoming]) };
    if (op === 'remove') {
      const targets = new Set(incoming.map(entryKey));
      return { value: existing.filter((item) => !targets.has(entryKey(item))) };
    }
    const value = uniqueLines(incoming);
    return { value };
  }

  if (kind === 'text') {
    if (op === 'append' || op === 'remove') {
      const incoming = uniqueLines(raw);
      if (!incoming.length) return { error: fail(operation.field, '文本增量操作至少需要一条非空内容') };
      const existing = uniqueLines(current);
      if (op === 'append') return { value: uniqueLines([...existing, ...incoming]).join('\n') };
      const targets = new Set(incoming.map(entryKey));
      return { value: existing.filter((item) => !targets.has(entryKey(item))).join('\n') };
    }
    const value = normalizeValue(spec, raw);
    if (value === undefined || !validateValue(spec, value)) return { error: fail(operation.field, '值不符合字段规则') };
    return { value };
  }

  if (op !== 'replace' && op !== 'set') return { error: fail(operation.field, `${kind} 字段只能使用 replace/set/clear`) };
  const value = normalizeValue(spec, raw);
  if (value === undefined || !validateValue(spec, value)) return { error: fail(operation.field, '值不符合字段规则') };
  return { value };
}

export function normalizeFormState(state, fields = {}) {
  return normalizeState(state, fields);
}

export function applyFormUpdateOperations(state, operations, fields = {}) {
  const current = normalizeState(state, fields);
  const next = { ...current };
  const applied = [];
  const errors = [];
  if (!Array.isArray(operations) || !operations.length) return { ok: false, state: current, applied, errors: [fail('', 'operations 至少需要一项')] };
  for (const operation of operations) {
    if (!isObject(operation)) {
      errors.push(fail('', '每个 operation 必须是对象'));
      continue;
    }
    const field = String(operation.field || '').trim();
    const spec = fields[field];
    if (!field || !spec) {
      errors.push(fail(field, `不可更新的表单字段：${field || '空'}`));
      continue;
    }
    const result = applyOne(next[field], { ...operation, field }, spec);
    if (result.error) {
      errors.push(result.error);
      continue;
    }
    if (result.value === undefined) delete next[field];
    else next[field] = result.value;
    applied.push({ field, op: String(operation.op || operation.operation), value: result.value });
  }
  if (errors.length) return { ok: false, state: current, applied: [], errors };
  return { ok: true, state: normalizeState(next, fields), applied, errors: [] };
}

export function buildFormUpdateTool({ capability = 'cap_agent_form_update', name = '更新表单', description = '以增量方式更新当前 Agent 的策划表单。多值字段追加/删除，单值字段明确替换。', fields = {} } = {}) {
  const fieldNames = Object.keys(fields);
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
      required: ['operations'],
      properties: {
        operations: {
          type: 'array',
          minItems: 1,
          maxItems: 12,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['field', 'op'],
            properties: {
              field: { type: 'string', enum: fieldNames },
              op: { type: 'string', enum: OPERATIONS },
              value: {},
              values: { type: 'array' },
            },
          },
        },
        reason: { type: 'string', maxLength: 500 },
      },
    },
  });
}

export function createFormUpdateHandler({ getState, setState, fields = {}, normalize = normalizeFormState } = {}) {
  if (typeof getState !== 'function' || typeof setState !== 'function') throw new TypeError('表单工具需要 getState/setState');
  return async (input = {}) => {
    const result = applyFormUpdateOperations(getState(), input.operations, fields);
    if (!result.ok) {
      return { status: 'error', error: { code: 'INVALID_INPUT', message: result.errors.map((item) => `${item.field ? `${item.field}：` : ''}${item.message}`).join('；') } };
    }
    const state = normalize(result.state, fields);
    await setState(state, result);
    return {
      status: 'ok',
      data: { formState: state, applied: result.applied.map(({ field, op }) => ({ field, op })), reason: String(input.reason || '').trim() },
      artifacts: [],
      warnings: [],
      provenance: { provider: 'agent-application', operation: 'form-update' },
    };
  };
}

