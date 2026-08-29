/**
 * JSON 尾部语法修复。
 *
 * 这里只处理一种低风险情况：模型已经输出了完整字段和值，只在 JSON
 * 末尾漏了闭合符，或在请求数组结束前漏了一个请求对象的 `}`。不补字段、
 * 不截断字符串、不猜测 HTML/CSS，也不改写任何业务内容。
 */

export function stripJsonFence(value) {
  return String(value ?? '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function scanJsonStructure(text) {
  const stack = [];
  let quoted = false;
  let escaped = false;

  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === '{' || char === '[') {
      stack.push(char);
      continue;
    }
    if (char !== '}' && char !== ']') continue;
    const open = stack.pop();
    if ((open === '{' && char !== '}') || (open === '[' && char !== ']')) {
      return { quoted: false, stack, mismatch: true };
    }
  }

  return { quoted, stack, mismatch: false };
}

function closeMissingSuffix(text) {
  const scan = scanJsonStructure(text);
  if (scan.quoted || scan.mismatch || !scan.stack.length) return null;
  const suffix = [...scan.stack].reverse().map((open) => (open === '{' ? '}' : ']')).join('');
  return `${text}${suffix}`;
}

function insertOneMissingRequestBrace(text) {
  const candidates = [];
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char !== ']') continue;

    // 只尝试在数组结束符前插入一个请求对象右括号，再由统一的后缀
    // 闭合逻辑补剩余外层括号。最终还必须通过完整信封校验。
    const inserted = `${text.slice(0, index)}}${text.slice(index)}`;
    candidates.push(closeMissingSuffix(inserted) || inserted);
  }
  return candidates;
}

function legacyPageRequestCandidates(text) {
  if (!text.includes('"pages":[{"page"') || !text.includes('"page_html"')) return [];
  if (!text.endsWith('"}}]') || text.split('"}}],"reason"').length !== 2) return [];

  // 兼容历史上出现过的页面 patch 尾部错位形态；仍然只接受最终能
  // 通过严格 envelope 形状校验的唯一候选。
  return [text.replace('"}}],"reason"', '"}]}} ,"reason"').replace(/"\}\}\]$/, '"}]}').replace('}} ,"reason"', '}},"reason"')];
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isCompleteToolRequestsEnvelope(value, { allowMissingToolRequestReason = false, allowMissingToolRequestAssistantNote = false } = {}) {
  if (!isObject(value) || value.type !== 'tool_requests') return false;
  if ((!allowMissingToolRequestAssistantNote && typeof value.assistant_note !== 'string')
    || (allowMissingToolRequestAssistantNote && hasOwn(value, 'assistant_note') && typeof value.assistant_note !== 'string')
    || !hasOwn(value, 'requests') || !Array.isArray(value.requests) || value.requests.length < 1) return false;
  return value.requests.every((request) => isObject(request)
    && typeof request.requestId === 'string'
    && typeof request.capability === 'string'
    && hasOwn(request, 'arguments')
    && isObject(request.arguments)
    && (allowMissingToolRequestReason || typeof request.reason === 'string'));
}

function isCompleteFinalEnvelope(value) {
  return isObject(value) && value.type === 'final' && typeof value.assistantReply === 'string';
}

function isRepairableEnvelope(value, options) {
  return isCompleteToolRequestsEnvelope(value, options) || isCompleteFinalEnvelope(value);
}

function parseCandidate(candidate, options) {
  try {
    const value = JSON.parse(candidate);
    return isRepairableEnvelope(value, options) ? value : null;
  } catch {
    return null;
  }
}

/**
 * @returns {{ text: string, value: object, strategy: string } | null}
 */
export function repairJsonSyntaxOnly(value, options = {}) {
  const text = stripJsonFence(value);
  if (!text.startsWith('{')) return null;

  const candidates = new Map();
  const add = (candidate, strategy) => {
    if (!candidate) return;
    const parsed = parseCandidate(candidate, options);
    if (parsed) candidates.set(candidate, { text: candidate, value: parsed, strategy });
  };

  add(closeMissingSuffix(text), 'append-missing-closers');
  for (const candidate of insertOneMissingRequestBrace(text)) add(candidate, 'insert-request-closer');
  for (const candidate of legacyPageRequestCandidates(text)) add(candidate, 'repair-legacy-page-request-tail');

  // 多个候选都能解析时，说明缺失位置无法唯一确定，宁可交给原有
  // 模型修复流程，也不自动选择一个可能改变结构的结果。
  return candidates.size === 1 ? [...candidates.values()][0] : null;
}
