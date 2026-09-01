// 编辑室底稿的增量更新协议。
// 多值字段默认追加并去重；单值字段必须通过 set/replace 明确替换。

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asValues(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(asValues);
  return String(value)
    .split(/\r?\n+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeEntry(value) {
  return String(value || '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function meaningful(value) {
  return asValues(value).length > 0;
}

export function hasEditorialPatch(value) {
  if (typeof value === 'string' || Array.isArray(value)) return meaningful(value);
  if (!isObject(value)) return false;
  return value.clear === true
    || meaningful(value.append)
    || meaningful(value.remove)
    || value.replace !== undefined
    || value.set !== undefined;
}

function patchOf(value) {
  if (isObject(value)) return value;
  return { append: value };
}

function validEntries(value, validator) {
  return asValues(value).filter((entry) => validator(entry));
}

function removeEntries(entries, remove) {
  const targets = new Set(asValues(remove).map(normalizeEntry).filter(Boolean));
  if (!targets.size) return entries;
  return entries.filter((entry) => !targets.has(normalizeEntry(entry)));
}

function appendUnique(entries, additions) {
  const seen = new Set(entries.map(normalizeEntry).filter(Boolean));
  for (const entry of additions) {
    const key = normalizeEntry(entry);
    if (!key || seen.has(key)) continue;
    entries.push(entry.trim());
    seen.add(key);
  }
  return entries;
}

export function mergeAppendEditorialField(current, update, validator = () => true) {
  const patch = patchOf(update);
  if (patch.clear === true) return '';

  const replacing = patch.replace !== undefined;
  const replacement = replacing ? validEntries(patch.replace, validator) : [];
  // replace 也必须提供至少一条合格内容；否则保留旧值，只有 clear:true 才能清空。
  const entries = replacement.length ? replacement : validEntries(current, validator);
  appendUnique(entries, validEntries(patch.append, validator));
  return removeEntries(entries, patch.remove).join('\n');
}

export function mergeSingleEditorialField(current, update, validator = () => true) {
  const patch = patchOf(update);
  if (patch.clear === true) return '';
  const next = patch.set !== undefined ? patch.set : patch.replace;
  if (next === undefined) {
    // 兼容旧模型返回字符串：单值字段的字符串本身就是一次完整替换。
    if (!isObject(update) && meaningful(update)) return validator(String(update).trim()) ? String(update).trim() : String(current || '').trim();
    return String(current || '').trim();
  }
  const value = asValues(next).join('\n').trim();
  return value && validator(value) ? value : String(current || '').trim();
}
