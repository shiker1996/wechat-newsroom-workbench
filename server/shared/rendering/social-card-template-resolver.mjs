import { createHash } from 'node:crypto';
import { inferCardPageRole, SOCIAL_CARD_PAGE_ROLES } from './social-card-role.mjs';
import {
  DEFAULT_SOCIAL_CARD_TEMPLATE_PACK,
  getSocialCardTemplatePack,
  SOCIAL_CARD_CHANNEL_BLOCK_TYPES,
  SOCIAL_CARD_RENDERER_BLOCK_TYPES,
} from './social-card-template-registry.mjs';
import { resolveSocialCardCapacityProfile } from './social-card-capacity.mjs';
import { getSocialCardSupplementSlots } from './social-card-supplement-slots.mjs';

const asTemplatePackId = (value) => {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') return String(value.id || '').trim();
  return '';
};

export function resolveSocialCardTemplateContext({ themeDefinition = null, channelMode = 'wechat', contentType = 'repository', templatePackId = '', templatePack = null } = {}) {
  const themeTemplatePack = themeDefinition?.social?.templatePack && typeof themeDefinition.social.templatePack === 'object' && themeDefinition.social.templatePack.roles ? themeDefinition.social.templatePack : null;
  const configuredId = asTemplatePackId(templatePackId)
    || asTemplatePackId(themeDefinition?.social?.templatePack)
    || asTemplatePackId(themeDefinition?.social?.template);
  const requestedId = configuredId || DEFAULT_SOCIAL_CARD_TEMPLATE_PACK;
  const customPack = (templatePack && typeof templatePack === 'object' && templatePack.id ? templatePack : null) || themeTemplatePack;
  const configuredPack = customPack || getSocialCardTemplatePack(requestedId);
  const pack = configuredPack || getSocialCardTemplatePack(DEFAULT_SOCIAL_CARD_TEMPLATE_PACK);
  const source = customPack ? 'proposal' : configuredPack ? (templatePackId ? 'fallback' : configuredId ? 'theme' : 'default') : 'fallback';
  return Object.freeze({
    pack,
    requestedId,
    source,
    fallback: !configuredPack && !customPack,
    reason: configuredPack ? '' : `主题模板包 ${requestedId} 不存在，已回退 ${DEFAULT_SOCIAL_CARD_TEMPLATE_PACK}`,
    channelMode: channelMode === 'xiaohongshu' ? 'xiaohongshu' : 'wechat',
    contentType: String(contentType || 'repository'),
  });
}

export function getSocialCardTemplateCapabilities(options = {}) {
  const context = resolveSocialCardTemplateContext(options);
  const channelBlocks = SOCIAL_CARD_CHANNEL_BLOCK_TYPES[context.channelMode] || SOCIAL_CARD_CHANNEL_BLOCK_TYPES.wechat;
  const capacityProfile = resolveSocialCardCapacityProfile({
    templatePack: context.pack,
    themeDefinition: options.themeDefinition,
    channelMode: context.channelMode,
    contentType: context.contentType,
  });
  const roles = Object.fromEntries(SOCIAL_CARD_PAGE_ROLES.map((role) => {
    const capability = context.pack.roles[role];
    return [role, {
      template: context.pack.roleTemplates[role],
      supportedBlocks: capability.supportedBlocks.filter((type) => channelBlocks.includes(type)),
      maxBlocks: capability.maxBlocks,
      maxItems: capability.maxItems,
      supplementSlots: (Array.isArray(capability.supplementSlots) ? capability.supplementSlots : getSocialCardSupplementSlots(role))
        .map((slot) => ({ ...slot, blockTypes: slot.blockTypes.filter((type) => channelBlocks.includes(type)) }))
        .filter((slot) => slot.blockTypes.length),
      capacity: capacityProfile.roles[role],
    }];
  }));
  return Object.freeze({
    capacityProfileVersion: capacityProfile.schemaVersion,
    templatePack: { id: context.pack.id, version: context.pack.version, label: context.pack.label, renderer: context.pack.renderer, fallbackTemplate: context.pack.fallbackTemplate || null },
    source: context.source,
    fallback: context.fallback,
    reason: context.reason,
    channelMode: context.channelMode,
    contentType: context.contentType,
    allowedBlockTypes: [...channelBlocks],
    rendererBlockTypes: [...SOCIAL_CARD_RENDERER_BLOCK_TYPES],
    capacityProfile,
    roles,
  });
}

function parseStoryboardSnapshot(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function createSocialCardStoryboardThemeSnapshot({ themeDefinition = null, channelMode = 'wechat', contentType = 'repository' } = {}) {
  const capabilities = getSocialCardTemplateCapabilities({ themeDefinition, channelMode, contentType });
  const capacityProfile = capabilities.capacityProfile;
  const capacityHash = `sha256:${createHash('sha256').update(JSON.stringify(capacityProfile)).digest('hex')}`;
  return Object.freeze({
    schemaVersion: 2,
    themeId: themeDefinition?.id || '',
    themeVersion: themeDefinition?.version || '',
    themeHash: themeDefinition?.hash || '',
    templatePack: { ...capabilities.templatePack },
    capacityProfileVersion: capabilities.capacityProfileVersion,
    capacityHash,
    capacityProfile,
    channelMode: capabilities.channelMode,
    contentType: capabilities.contentType,
  });
}

export function resolveSocialCardStoryboardThemeState({ editorial = null, themeDefinition = null, channelMode = 'wechat', contentType = 'repository' } = {}) {
  const cardPlan = parseStoryboardSnapshot(editorial?.card_plan_json);
  const hasStoryboard = Array.isArray(cardPlan) && cardPlan.length > 0;
  const current = createSocialCardStoryboardThemeSnapshot({ themeDefinition, channelMode, contentType });
  const snapshot = parseStoryboardSnapshot(editorial?.storyboard_theme_snapshot_json);
  if (!hasStoryboard) return Object.freeze({ status: 'empty', canRender: false, requiresStoryboard: true, hasStoryboard: false, current, snapshot: null, reason: '尚未生成故事板' });
  // 新链路要求故事板在生成时锁定模板能力。历史故事板没有快照，
  // 无法证明页面组件与当前模板可承载范围一致，因此不得直接进入渲染。
  if (!snapshot?.templatePack?.id) return Object.freeze({ status: 'needs-storyboard', canRender: false, requiresStoryboard: true, hasStoryboard: true, current, snapshot: null, reason: '历史故事板未记录主题快照，请先重新生成故事板' });
  const samePack = snapshot.templatePack.id === current.templatePack.id && Number(snapshot.templatePack.version) === Number(current.templatePack.version);
  const sameContext = samePack && snapshot.channelMode === current.channelMode && snapshot.contentType === current.contentType;
  if (sameContext && snapshot.themeId === current.themeId) return Object.freeze({ status: 'current', canRender: true, requiresStoryboard: false, hasStoryboard: true, current, snapshot, reason: '故事板与当前主题、模板能力一致' });
  if (sameContext) return Object.freeze({ status: 'render-only', canRender: true, requiresStoryboard: false, hasStoryboard: true, current, snapshot, reason: '模板能力未变化，可直接换肤并重新渲染图文' });
  return Object.freeze({ status: 'needs-storyboard', canRender: false, requiresStoryboard: true, hasStoryboard: true, current, snapshot, reason: '当前主题或渠道的模板能力已变化，请先重新生成故事板' });
}

export function buildSocialCardTemplateCapabilityPrompt(capabilities) {
  if (!capabilities?.templatePack) return '';
  const roleLines = Object.entries(capabilities.roles || {})
    .map(([role, value]) => `- ${role}：版式 ${value.template}；支持 ${value.supportedBlocks.join('、') || '无'}；内容块上限 ${value.maxBlocks}；列表/结构化条目上限 ${value.maxItems}；可补槽位 ${(value.supplementSlots || []).map((slot) => slot.id).join('、') || '无'}`)
    .join('\n');
  return [
    '## Social 版式能力约束（由程序提供）',
    `当前主题模板包：${capabilities.templatePack.id} v${capabilities.templatePack.version}；渠道：${capabilities.channelMode}。`,
    '故事板先决定页面目标、事实和内容块；以下信息仅用于生成可被当前版式承载的内容，不是要求固定卡片数量。',
    roleLines,
    `当前渠道允许的内容块：${capabilities.allowedBlockTypes.join('、')}`,
    '不要输出 HTML、CSS、坐标、尺寸或内部模板代码；不要为了适配版式静默删除事实。若内容超过承载范围，应保留事实并通过拆页、兼容版式或后续程序回退处理。',
  ].filter(Boolean).join('\n');
}

export function resolveSocialCardTemplate(page = {}, options = {}) {
  const context = resolveSocialCardTemplateContext(options);
  const role = SOCIAL_CARD_PAGE_ROLES.includes(page.role) ? page.role : inferCardPageRole(page);
  const capability = context.pack.roles[role] || context.pack.roles.concept;
  const explicit = String(page.layout_intent || '').trim();
  const templateId = explicit && Object.values(context.pack.roleTemplates).includes(explicit)
    ? explicit
    : capability.template;
  return Object.freeze({
    templateId,
    templatePack: context.pack.id,
    templateVersion: context.pack.version,
    role,
    source: explicit ? 'storyboard' : context.source === 'theme' ? 'theme-role-template' : 'default-role-template',
    fallback: context.fallback,
    reason: context.reason,
  });
}

function listItemCount(block) {
  if (Array.isArray(block?.items)) return block.items.length;
  if (block?.type === 'list') return String(block?.content || '').split(/\n+/).filter((line) => line.trim()).length;
  return 0;
}

export function validateSocialCardTemplateCompatibility(pages, options = {}) {
  const capabilities = getSocialCardTemplateCapabilities(options);
  const pageResults = (Array.isArray(pages) ? pages : []).map((page, index) => {
    const template = resolveSocialCardTemplate(page, options);
    const role = capabilities.roles[template.role] || capabilities.roles.concept;
    const blocks = Array.isArray(page?.content_blocks) ? page.content_blocks : [];
    const issues = [];
    const blockTypes = blocks.map((block) => String(block?.type || 'text'));
    for (const type of blockTypes) {
      if (!capabilities.rendererBlockTypes.includes(type)) issues.push({ code: 'UNKNOWN_BLOCK_FALLBACK', severity: 'warning', message: `${type} 将由通用 text-block 兜底` });
      else if (!role.supportedBlocks.includes(type)) issues.push({ code: 'BLOCK_TYPE_UNSUPPORTED', severity: 'warning', message: `${template.role} 模板不声明支持 ${type}` });
    }
    if (blocks.length > role.maxBlocks) issues.push({ code: 'BLOCK_BUDGET_EXCEEDED', severity: 'warning', message: `内容块 ${blocks.length} 个，超过当前模板建议上限 ${role.maxBlocks}` });
    const items = blocks.reduce((total, block) => total + listItemCount(block), 0);
    if (items > role.maxItems) issues.push({ code: 'ITEM_BUDGET_EXCEEDED', severity: 'warning', message: `结构化条目 ${items} 个，超过当前模板建议上限 ${role.maxItems}` });
    return { page: index + 1, role: template.role, template: template.templateId, templatePack: template.templatePack, templateVersion: template.templateVersion, issues };
  });
  return Object.freeze({
    valid: true,
    templatePack: capabilities.templatePack,
    source: capabilities.source,
    fallback: capabilities.fallback,
    warnings: pageResults.flatMap((page) => page.issues.map((issue) => ({ ...issue, page: page.page }))),
    pages: pageResults,
  });
}
