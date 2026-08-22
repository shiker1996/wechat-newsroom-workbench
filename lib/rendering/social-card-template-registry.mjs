import { SOCIAL_CARD_PAGE_ROLES } from './social-card-role.mjs';
import { getSocialCardSupplementSlots } from './social-card-supplement-slots.mjs';

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};

export const SOCIAL_CARD_RENDERER_BLOCK_TYPES = Object.freeze([
  'text', 'list', 'code', 'note', 'stats', 'compare', 'steps', 'timeline', 'scenes', 'highlight',
]);

export const SOCIAL_CARD_CHANNEL_BLOCK_TYPES = Object.freeze({
  wechat: Object.freeze(['text', 'list', 'code', 'note']),
  xiaohongshu: SOCIAL_CARD_RENDERER_BLOCK_TYPES,
});

// 阶段 1 的容量基线：这是模板感知预检使用的“安全估算”，不是最终布局门禁。
// 最终是否溢出仍以 375×667 浏览器审计为准；阶段 2 才会用这些字段驱动拆页。
const ROLE_CAPACITY_BASELINES = Object.freeze({
  cover: Object.freeze({ bodyHeightPx: 470, maxTitleLines: 4, maxTextChars: 180, maxListItemLines: 2, minBodyUtilization: .45, maxBodyUtilization: .90, splitAllowed: false, splitBlockTypes: [] }),
  concept: Object.freeze({ bodyHeightPx: 432, maxTitleLines: 3, maxTextChars: 360, maxListItemLines: 2, minBodyUtilization: .50, maxBodyUtilization: .94, splitAllowed: true, splitBlockTypes: ['list', 'text', 'note'] }),
  feature: Object.freeze({ bodyHeightPx: 424, maxTitleLines: 3, maxTextChars: 300, maxListItemLines: 2, minBodyUtilization: .50, maxBodyUtilization: .94, splitAllowed: true, splitBlockTypes: ['list', 'text', 'note'] }),
  steps: Object.freeze({ bodyHeightPx: 420, maxTitleLines: 3, maxTextChars: 280, maxListItemLines: 2, minBodyUtilization: .50, maxBodyUtilization: .94, splitAllowed: true, splitBlockTypes: ['steps', 'list', 'text'] }),
  data: Object.freeze({ bodyHeightPx: 410, maxTitleLines: 3, maxTextChars: 240, maxListItemLines: 2, minBodyUtilization: .45, maxBodyUtilization: .94, splitAllowed: true, splitBlockTypes: ['stats', 'compare', 'list'] }),
  compare: Object.freeze({ bodyHeightPx: 404, maxTitleLines: 3, maxTextChars: 220, maxListItemLines: 2, minBodyUtilization: .45, maxBodyUtilization: .94, splitAllowed: true, splitBlockTypes: ['compare', 'list'] }),
  evidence: Object.freeze({ bodyHeightPx: 416, maxTitleLines: 3, maxTextChars: 300, maxListItemLines: 2, minBodyUtilization: .50, maxBodyUtilization: .94, splitAllowed: true, splitBlockTypes: ['list', 'text', 'note'] }),
  timeline: Object.freeze({ bodyHeightPx: 408, maxTitleLines: 3, maxTextChars: 260, maxListItemLines: 2, minBodyUtilization: .50, maxBodyUtilization: .94, splitAllowed: true, splitBlockTypes: ['timeline', 'list'] }),
  risk: Object.freeze({ bodyHeightPx: 420, maxTitleLines: 3, maxTextChars: 280, maxListItemLines: 2, minBodyUtilization: .50, maxBodyUtilization: .94, splitAllowed: true, splitBlockTypes: ['list', 'text', 'note'] }),
  ending: Object.freeze({ bodyHeightPx: 430, maxTitleLines: 3, maxTextChars: 180, maxListItemLines: 2, minBodyUtilization: .20, maxBodyUtilization: .90, splitAllowed: false, splitBlockTypes: [] }),
});

const PACK_CAPACITY_DELTAS = Object.freeze({
  'standard-v1': 0,
  'neon-v1': -16,
  'brutalist-v1': -34,
  'editorial-v1': -22,
  'clean-v1': -10,
});

function roleCapacity(packId, role) {
  const baseline = ROLE_CAPACITY_BASELINES[role] || ROLE_CAPACITY_BASELINES.concept;
  return Object.freeze({
    ...baseline,
    bodyHeightPx: Math.max(320, baseline.bodyHeightPx + (PACK_CAPACITY_DELTAS[packId] || 0)),
    calibration: 'phase1-baseline',
  });
}

function roleCapability(packId, role, values) {
  return Object.freeze({ ...values, supplementSlots: getSocialCardSupplementSlots(role), capacity: roleCapacity(packId, role) });
}

const STANDARD_ROLE_TEMPLATES = Object.freeze({
  cover: 'hero-stack',
  concept: 'concept-split',
  feature: 'feature-ledger',
  steps: 'sequence-rail',
  data: 'metric-board',
  compare: 'comparison-board',
  evidence: 'evidence-ledger',
  timeline: 'timeline-rail',
  risk: 'risk-sidebar',
  ending: 'closing-focus',
});

const STANDARD_ROLE_CAPABILITIES = Object.freeze(Object.fromEntries(
  SOCIAL_CARD_PAGE_ROLES.map((role) => [role, roleCapability('standard-v1', role, {
    template: STANDARD_ROLE_TEMPLATES[role],
    supportedBlocks: SOCIAL_CARD_RENDERER_BLOCK_TYPES,
    maxBlocks: role === 'cover' ? 2 : role === 'ending' ? 2 : 4,
    maxItems: 9,
  })]),
));

const NEON_ROLE_TEMPLATES = Object.freeze({
  cover: 'hero-metrics', concept: 'problem-stack', feature: 'feature-stack', steps: 'steps-rail',
  data: 'metric-board', compare: 'comparison-board', evidence: 'evidence-ledger',
  timeline: 'timeline-rail', risk: 'risk-frame', ending: 'closing-cta',
});

const NEON_ROLE_CAPABILITIES = Object.freeze(Object.fromEntries(
  SOCIAL_CARD_PAGE_ROLES.map((role) => [role, roleCapability('neon-v1', role, {
    template: NEON_ROLE_TEMPLATES[role],
    supportedBlocks: SOCIAL_CARD_RENDERER_BLOCK_TYPES,
    maxBlocks: role === 'cover' ? 3 : role === 'ending' ? 3 : 4,
    maxItems: role === 'cover' ? 6 : 9,
  })]),
));

const BRUTALIST_ROLE_TEMPLATES = Object.freeze({
  cover: 'poster-cover', concept: 'thesis-split', feature: 'feature-grid', steps: 'numbered-steps',
  data: 'stat-stamp', compare: 'versus-board', evidence: 'proof-ledger', timeline: 'event-strip',
  risk: 'warning-panel', ending: 'hard-cta',
});

const BRUTALIST_ROLE_CAPABILITIES = Object.freeze(Object.fromEntries(
  SOCIAL_CARD_PAGE_ROLES.map((role) => [role, roleCapability('brutalist-v1', role, {
    template: BRUTALIST_ROLE_TEMPLATES[role],
    supportedBlocks: SOCIAL_CARD_RENDERER_BLOCK_TYPES,
    maxBlocks: role === 'cover' ? 2 : role === 'ending' ? 2 : 4,
    maxItems: role === 'cover' ? 5 : 9,
  })]),
));

const EDITORIAL_ROLE_TEMPLATES = Object.freeze({
  cover: 'paper-poster', concept: 'margin-thesis', feature: 'column-notes', steps: 'numbered-margin',
  data: 'data-table', compare: 'compare-sheet', evidence: 'source-ledger', timeline: 'timeline-strip',
  risk: 'risk-note', ending: 'closing-editor',
});

const EDITORIAL_ROLE_CAPABILITIES = Object.freeze(Object.fromEntries(
  SOCIAL_CARD_PAGE_ROLES.map((role) => [role, roleCapability('editorial-v1', role, {
    template: EDITORIAL_ROLE_TEMPLATES[role],
    supportedBlocks: SOCIAL_CARD_RENDERER_BLOCK_TYPES,
    maxBlocks: role === 'cover' ? 2 : role === 'ending' ? 3 : 4,
    maxItems: role === 'cover' ? 5 : 9,
  })]),
));

const CLEAN_ROLE_TEMPLATES = Object.freeze({
  cover: 'clean-cover', concept: 'clean-problem', feature: 'clean-feature', steps: 'clean-steps',
  data: 'clean-data', compare: 'clean-compare', evidence: 'clean-evidence', timeline: 'clean-timeline',
  risk: 'clean-risk', ending: 'clean-ending',
});

const CLEAN_ROLE_CAPABILITIES = Object.freeze(Object.fromEntries(
  SOCIAL_CARD_PAGE_ROLES.map((role) => [role, roleCapability('clean-v1', role, {
    template: CLEAN_ROLE_TEMPLATES[role],
    supportedBlocks: SOCIAL_CARD_RENDERER_BLOCK_TYPES,
    maxBlocks: role === 'cover' ? 2 : role === 'ending' ? 3 : 4,
    maxItems: role === 'cover' ? 6 : 9,
  })]),
));

export const SOCIAL_CARD_TEMPLATE_PACKS = freeze({
  'standard-v1': {
    id: 'standard-v1',
    version: 1,
    label: '标准兼容模板',
    renderer: 'current-deterministic-renderer',
    roleTemplates: STANDARD_ROLE_TEMPLATES,
    roles: STANDARD_ROLE_CAPABILITIES,
    fallbackTemplate: null,
  },
  'neon-v1': {
    id: 'neon-v1',
    version: 1,
    label: '霓虹编辑卡',
    renderer: 'neon-v1',
    roleTemplates: NEON_ROLE_TEMPLATES,
    roles: NEON_ROLE_CAPABILITIES,
    fallbackTemplate: 'standard-v1',
  },
  'brutalist-v1': {
    id: 'brutalist-v1',
    version: 1,
    label: '野兽硬卡',
    renderer: 'brutalist-v1',
    roleTemplates: BRUTALIST_ROLE_TEMPLATES,
    roles: BRUTALIST_ROLE_CAPABILITIES,
    fallbackTemplate: 'standard-v1',
  },
  'editorial-v1': {
    id: 'editorial-v1',
    version: 1,
    label: '编辑纸页',
    renderer: 'editorial-v1',
    roleTemplates: EDITORIAL_ROLE_TEMPLATES,
    roles: EDITORIAL_ROLE_CAPABILITIES,
    fallbackTemplate: 'standard-v1',
  },
  'clean-v1': {
    id: 'clean-v1',
    version: 1,
    label: '清爽编辑卡',
    renderer: 'clean-v1',
    roleTemplates: CLEAN_ROLE_TEMPLATES,
    roles: CLEAN_ROLE_CAPABILITIES,
    fallbackTemplate: 'standard-v1',
  },
});

export const DEFAULT_SOCIAL_CARD_TEMPLATE_PACK = 'standard-v1';

export function getSocialCardTemplatePack(id = DEFAULT_SOCIAL_CARD_TEMPLATE_PACK) {
  return SOCIAL_CARD_TEMPLATE_PACKS[String(id || DEFAULT_SOCIAL_CARD_TEMPLATE_PACK)] || null;
}

export function listSocialCardTemplatePacks() {
  return Object.values(SOCIAL_CARD_TEMPLATE_PACKS);
}

export function socialCardTemplateEditorCatalog() {
  return listSocialCardTemplatePacks().map((pack) => ({
    id: pack.id,
    version: pack.version,
    label: pack.label,
    renderer: pack.renderer,
    fallbackTemplate: pack.fallbackTemplate,
    roleTemplates: { ...pack.roleTemplates },
    roles: Object.fromEntries(Object.entries(pack.roles).map(([role, value]) => [role, {
      template: value.template,
      maxBlocks: value.maxBlocks,
      maxItems: value.maxItems,
      supplementSlots: value.supplementSlots ? value.supplementSlots.map((slot) => ({ ...slot, blockTypes: [...slot.blockTypes] })) : [],
      capacity: value.capacity ? { ...value.capacity, splitBlockTypes: [...value.capacity.splitBlockTypes] } : null,
      supportedBlocks: [...value.supportedBlocks],
    }])),
  }));
}
