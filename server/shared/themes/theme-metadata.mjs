const CREATION_METHODS = new Set(['manual', 'ai', 'import', 'clone']);

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function object(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function list(value, max, itemMax) {
  return Array.isArray(value) ? value.map((item) => text(item, itemMax)).filter(Boolean).slice(0, max) : [];
}

function basedOn(value) {
  if (!object(value)) return null;
  const id = text(value.id || value.themeId, 64);
  const version = text(value.version, 30);
  return id ? { id, ...(version ? { version } : {}) } : null;
}

function intent(value) {
  if (!object(value)) return {};
  const tone = list(value.tone, 3, 30);
  return {
    ...(text(value.prompt, 500) ? { prompt: text(value.prompt, 500) } : {}),
    ...(text(value.scene, 40) ? { scene: text(value.scene, 40) } : {}),
    ...(tone.length ? { tone } : {}),
    ...(text(value.brightness, 20) ? { brightness: text(value.brightness, 20) } : {}),
    ...(text(value.readingPriority, 30) ? { readingPriority: text(value.readingPriority, 30) } : {}),
  };
}

function aiProvenance(value) {
  if (!object(value)) return {};
  return Object.fromEntries([
    ['serviceId', 80], ['model', 120], ['promptVersion', 80], ['callId', 120], ['generatedAt', 40],
  ].map(([key, max]) => [key, text(value[key], max)]).filter(([, value]) => value));
}

function designSummary(value) {
  return Array.isArray(value) ? value.filter(object).map((item) => ({
    title: text(item.title, 20) || '设计说明',
    description: text(item.description, 100) || text(item.title, 20) || '按主题意图生成的视觉方案',
  })).slice(0, 6) : [];
}

function repairs(value) {
  return Array.isArray(value) ? value.filter(object).map((item) => ({
    field: text(item.field, 120),
    before: item.before === undefined ? null : structuredClone(item.before),
    after: item.after === undefined ? null : structuredClone(item.after),
    reason: text(item.reason, 180),
  })).filter((item) => item.field || item.reason).slice(0, 50) : [];
}

function templateMatchEvidence(value, definition) {
  const source = object(value) ? value : definition?.social?.templateMatch;
  if (!object(source)) return {};
  const signals = list(source.signals, 12, 100);
  return {
    ...(text(source.packId, 80) ? { packId: text(source.packId, 80) } : {}),
    ...(text(source.source, 40) ? { source: text(source.source, 40) } : {}),
    ...(text(source.confidence, 20) ? { confidence: text(source.confidence, 20) } : {}),
    ...(text(source.reason, 180) ? { reason: text(source.reason, 180) } : {}),
    ...(signals.length ? { signals } : {}),
  };
}

export function normalizeThemeMetadata(input = {}, { creationMethod = 'manual', basedOn: fallbackBasedOn = null, definition = null } = {}) {
  const value = object(input) ? input : {};
  const method = CREATION_METHODS.has(value.creationMethod) ? value.creationMethod : creationMethod;
  return {
    schemaVersion: 1,
    creationMethod: CREATION_METHODS.has(method) ? method : 'manual',
    basedOn: basedOn(value.basedOn || fallbackBasedOn),
    intent: intent(value.intent),
    aiProvenance: aiProvenance(value.aiProvenance),
    designSummary: designSummary(value.designSummary),
    repairs: repairs(value.repairs),
    templateMatchEvidence: templateMatchEvidence(value.templateMatchEvidence, definition),
  };
}

export function themeMetadataSummary(metadata) {
  const value = normalizeThemeMetadata(metadata);
  return {
    creationMethod: value.creationMethod,
    basedOn: value.basedOn,
    hasAiProvenance: Object.keys(value.aiProvenance).length > 0,
    hasDesignSummary: value.designSummary.length > 0,
    templatePackId: value.templateMatchEvidence.packId || null,
  };
}

export { CREATION_METHODS };
