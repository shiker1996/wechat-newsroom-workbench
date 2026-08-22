import { SOCIAL_CARD_PAGE_ROLES } from './social-card-role.mjs';
import { getSocialCardTemplatePack } from './social-card-template-registry.mjs';
import { getSocialCardSupplementSlots } from './social-card-supplement-slots.mjs';

export const SOCIAL_CARD_CAPACITY_SCHEMA_VERSION = 1;
export const SOCIAL_CARD_CANVAS = Object.freeze({ width: 375, height: 667 });

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function themeMetrics(themeDefinition = null) {
  const tokens = themeDefinition?.tokens || {};
  const typography = tokens.typography || {};
  const spacing = tokens.spacing || {};
  const shape = tokens.shape || {};
  return {
    themeId: String(themeDefinition?.id || ''),
    themeVersion: String(themeDefinition?.version || ''),
    themeHash: String(themeDefinition?.hash || ''),
    bodyPx: finite(typography.bodyPx, 11),
    h1Px: finite(typography.h1Px, 32),
    lineHeight: finite(typography.lineHeight, 1.45),
    articlePaddingPx: finite(spacing.articlePaddingPx, 18),
    sectionPx: finite(spacing.sectionPx, 24),
    paragraphPx: finite(spacing.paragraphPx, 12),
    cardGapPx: finite(spacing.cardGapPx, 12),
    borderWidthPx: finite(shape.borderWidthPx, 1),
    shadow: String(shape.shadow || 'none'),
  };
}

function cloneCapacity(value, structural) {
  const source = value || {};
  return {
    structural: {
      maxBlocks: finite(structural?.maxBlocks, 4),
      maxItems: finite(structural?.maxItems, 9),
    },
    visual: {
      bodyHeightPx: finite(source.bodyHeightPx, 420),
      maxTitleLines: finite(source.maxTitleLines, 3),
      maxTextChars: finite(source.maxTextChars, 300),
      maxListItemLines: finite(source.maxListItemLines, 2),
      minBodyUtilization: finite(source.minBodyUtilization, .5),
      maxBodyUtilization: finite(source.maxBodyUtilization, .94),
    },
    split: {
      allowed: source.splitAllowed === true,
      blockTypes: Array.isArray(source.splitBlockTypes) ? [...source.splitBlockTypes] : [],
      preserveTitle: source.preserveTitle !== false,
      maxContinuationPages: finite(source.maxContinuationPages, 2),
    },
    calibration: String(source.calibration || 'phase1-baseline'),
  };
}

/**
 * 将模板声明与当前主题 Token 合并为可记录、可供后续预检使用的容量 profile。
 * 阶段 1 只计算和记录，不改变现有预算裁剪、渲染或布局修复行为。
 */
export function resolveSocialCardCapacityProfile({ templatePack = null, themeDefinition = null, channelMode = 'wechat', contentType = 'repository' } = {}) {
  const pack = templatePack || getSocialCardTemplatePack();
  const metrics = themeMetrics(themeDefinition);
  const roles = {};
  for (const role of SOCIAL_CARD_PAGE_ROLES) {
    const declared = pack?.roles?.[role] || {};
    const base = cloneCapacity(declared.capacity, declared);
    const visual = base.visual;
    // 这是校准前的保守估算：主题的字号、行高和外层留白只影响 profile 记录，
    // 不直接改变当前 renderer。真实像素仍由浏览器审计决定。
    const paddingDelta = (metrics.articlePaddingPx - 18) * 2;
    const typographyDelta = (metrics.bodyPx - 11) * 3 + (metrics.lineHeight - 1.45) * 18;
    const frameDelta = Math.max(0, metrics.borderWidthPx - 1) * 3 + (metrics.shadow === 'none' ? 0 : 4);
    const effectiveBodyHeightPx = Math.round(clamp(visual.bodyHeightPx - paddingDelta - typographyDelta - frameDelta, 280, SOCIAL_CARD_CANVAS.height));
    const densityScale = clamp(420 / Math.max(280, effectiveBodyHeightPx), .72, 1.45);
    roles[role] = {
      role,
      template: String(declared.template || ''),
      supplementSlots: (Array.isArray(declared.supplementSlots)
        ? declared.supplementSlots
        : getSocialCardSupplementSlots(role)).map((slot) => ({ ...slot, blockTypes: Array.isArray(slot.blockTypes) ? [...slot.blockTypes] : [] })),
      structural: base.structural,
      visual: {
        ...visual,
        bodyHeightPx: effectiveBodyHeightPx,
        estimatedMaxTextChars: Math.max(80, Math.round(visual.maxTextChars / densityScale)),
        estimatedMaxListItemLines: visual.maxListItemLines,
      },
      split: base.split,
      calibration: base.calibration,
    };
  }
  return {
    schemaVersion: SOCIAL_CARD_CAPACITY_SCHEMA_VERSION,
    source: 'phase1-baseline',
    canvas: { ...SOCIAL_CARD_CANVAS },
    templatePack: {
      id: String(pack?.id || ''),
      version: Number(pack?.version || 0),
    },
    channelMode: channelMode === 'xiaohongshu' ? 'xiaohongshu' : 'wechat',
    contentType: String(contentType || 'repository'),
    theme: metrics,
    roles,
  };
}

export function capacityProfileForRole(profile, role = 'concept') {
  return profile?.roles?.[role] || profile?.roles?.concept || null;
}
