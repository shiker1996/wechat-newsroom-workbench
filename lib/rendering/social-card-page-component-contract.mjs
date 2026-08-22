/**
 * Social 图文页面组件契约（阶段 0）。
 *
 * 这里仅冻结字段和语义来源，不负责生成页面专属组件，也不改变当前
 * 装箱策略。后续阶段会让 page/role/semanticIntent 真正参与组件生成。
 */
export const SOCIAL_CARD_PAGE_COMPONENT_SCHEMA_VERSION = 1;

export const SOCIAL_CARD_COMPONENT_KINDS = Object.freeze(['core', 'supplement']);

// 唯一的槽位语义来源。事实索引筛选、组件池装箱和后续页面组件生成都应
// 读取这里，避免 social-card-fact-index 与 content-components 各自维护一份。
export const SOCIAL_CARD_SLOT_SEMANTIC_TAGS = Object.freeze({
  'concept.context': ['context', 'source'],
  'concept.pain_point': ['limitation', 'context'],
  'concept.mechanism': ['capability', 'run', 'network'],
  'concept.conclusion': ['release', 'output'],
  'feature.capability': ['capability'],
  'feature.usage': ['run', 'install', 'platform'],
  'feature.output': ['output', 'metric'],
  'steps.prerequisite': ['platform', 'permission', 'network'],
  'steps.install': ['install'],
  'steps.run': ['run', 'install'],
  'steps.verify': ['output', 'run'],
  'steps.boundary': ['limitation', 'security'],
  'data.metric': ['metric', 'release'],
  'data.scope': ['platform', 'context'],
  'data.source': ['source'],
  'compare.options': ['capability', 'platform'],
  'compare.criteria': ['metric', 'source', 'maturity'],
  'compare.tradeoff': ['limitation', 'security'],
  'evidence.source': ['source'],
  'evidence.implementation': ['capability', 'run', 'install'],
  'evidence.release': ['release', 'timeline'],
  'timeline.event': ['timeline', 'release'],
  'timeline.change': ['timeline', 'release', 'capability'],
  'timeline.status': ['maturity', 'release'],
  'risk.permission': ['permission', 'security'],
  'risk.network': ['network', 'permission'],
  'risk.maturity': ['maturity', 'limitation'],
  'risk.cost_security': ['security', 'metric', 'limitation'],
});

export function socialCardSlotSemanticTags(role = '', slotId = '') {
  return [...(SOCIAL_CARD_SLOT_SEMANTIC_TAGS[`${String(role || '').trim()}.${String(slotId || '').trim()}`] || [])];
}

const TAG_TO_INTENT = Object.freeze({
  context: 'context',
  limitation: 'boundary',
  capability: 'capability',
  run: 'run',
  install: 'install',
  output: 'verify',
  metric: 'metric',
  release: 'release',
  timeline: 'timeline',
  platform: 'prerequisite',
  permission: 'prerequisite',
  network: 'prerequisite',
  security: 'boundary',
  maturity: 'maturity',
  source: 'source',
});

const DISPLAY_LABELS = Object.freeze({
  coreCapabilities: '具体能力',
  installation: '安装方式',
  sections: '使用说明',
  usage: '使用方式',
  output: '输出结果',
  latestRelease: '最新发布',
  maturity: '成熟度',
  sourceUrl: '来源地址',
  repository: '仓库信息',
  language: '运行环境',
});

const INTENT_LABELS = Object.freeze({
  context: '背景说明',
  capability: '具体能力',
  install: '安装方式',
  run: '运行方式',
  verify: '验证方式',
  prerequisite: '前置条件',
  boundary: '边界与限制',
  output: '输出结果',
  metric: '关键指标',
  release: '发布信息',
  timeline: '阶段变化',
  source: '来源证据',
  maturity: '成熟度',
});

const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

function candidatePath(candidate = {}) {
  return text(candidate.path);
}

export function isSocialCardFactMetadataCandidate(candidate = {}) {
  const path = candidatePath(candidate);
  const label = text(candidate.label);
  const claim = text(candidate.text);
  if (/^facts\.(?:repository|language|topics|tags|keywords|categories)(?:\[|$)/i.test(path)) return true;
  if (/^facts\.(?:forks|stars|watchers|openIssues|closedIssues|downloads|contributors|size)(?:\.|\[|$)/i.test(path)) return true;
  if (label === 'coreCapabilities' && /^项目主题\s*[:：]/.test(claim)) return true;
  return false;
}

export function socialCardFactComponentPresentation(candidate = {}) {
  const semanticIntentCandidates = Array.isArray(candidate.semantic_intent_candidates) && candidate.semantic_intent_candidates.length
    ? [...new Set(candidate.semantic_intent_candidates.map(text).filter(Boolean))]
    : semanticIntentCandidatesForTags(candidate.tags);
  const firstIntent = semanticIntentCandidates[0] || '';
  const rawLabel = text(candidate.label);
  const mappedLabel = DISPLAY_LABELS[rawLabel];
  const displayLabel = text(candidate.display_label) || mappedLabel || INTENT_LABELS[firstIntent] || (rawLabel === 'sections' ? '使用说明' : rawLabel || '补充事实');
  const metadata = isSocialCardFactMetadataCandidate(candidate);
  return {
    displayLabel,
    semanticIntentCandidates,
    semanticIntent: firstIntent,
    componentEligible: !metadata,
    componentExclusionReason: metadata ? 'metadata-or-classification' : '',
  };
}

export function semanticIntentCandidatesForTags(tags = []) {
  const result = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const intent = TAG_TO_INTENT[String(tag || '').trim()];
    if (intent && !result.includes(intent)) result.push(intent);
  }
  return result;
}

/**
 * 统一返回事实组件的自然展示标签；原始 path/label 只保留在审计字段中。
 */
export function displayLabelForSocialCardFact(candidate = {}) {
  return socialCardFactComponentPresentation(candidate).displayLabel;
}

export function normalizeSocialCardPageComponent(component = {}, { kind = '' } = {}) {
  const normalizedKind = SOCIAL_CARD_COMPONENT_KINDS.includes(String(component.kind || kind))
    ? String(component.kind || kind)
    : '';
  return {
    ...component,
    schemaVersion: Number(component.schemaVersion || SOCIAL_CARD_PAGE_COMPONENT_SCHEMA_VERSION),
    ...(normalizedKind ? { kind: normalizedKind } : {}),
    componentId: text(component.componentId || component.component_id || component.id),
    page: Number.isInteger(Number(component.page)) ? Number(component.page) : null,
    role: text(component.role),
    semanticIntent: text(component.semanticIntent || component.semantic_intent),
    semanticIntentCandidates: [...new Set((Array.isArray(component.semanticIntentCandidates)
      ? component.semanticIntentCandidates
      : Array.isArray(component.semantic_intent_candidates) ? component.semantic_intent_candidates : []).map(text).filter(Boolean))],
    displayLabel: text(component.displayLabel || component.display_label),
    renderCandidates: [...new Set((Array.isArray(component.renderCandidates)
      ? component.renderCandidates
      : Array.isArray(component.render_candidates) ? component.render_candidates : []).map(text).filter(Boolean))],
    preferredRender: text(component.preferredRender || component.preferred_render),
    estimatedHeightPx: component.estimatedHeightPx ?? component.estimated_height_px ?? null,
    slotId: text(component.slotId || component.slot_id),
  };
}
