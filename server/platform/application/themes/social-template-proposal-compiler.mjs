import { colorContrast } from '../../../shared/themes/theme-validator.mjs';
import { socialThemeDefinition } from '../../../shared/themes/social-theme-compiler.mjs';
import { SOCIAL_THEME_SPECIMEN } from './theme-preview.mjs';
import { renderStoryboardHtml } from '../../../features/social-cards/index.mjs';
import { SOCIAL_CARD_PAGE_ROLES } from '../../../shared/rendering/social-card-role.mjs';
import { SOCIAL_CARD_RENDERER_BLOCK_TYPES, getSocialCardTemplatePack } from '../../../shared/rendering/social-card-template-registry.mjs';
import { validateSocialTemplateProposal, SocialTemplateProposalError, SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES } from '../../../shared/themes/social-template-proposal.mjs';

const DENSITIES = new Set(['compact', 'standard', 'airy']);
const DECORATIONS = new Set(['none', 'grid-line', 'orbit', 'stamp', 'index-line', 'paper-rule', 'accent-edge']);
const HEADING_TREATMENTS = new Set(['plain', 'accent-bar', 'highlight-block', 'underline', 'numbered']);

function esc(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
}

function issue(field, code, message, role = '') {
  return { field, code, message, ...(role ? { role } : {}) };
}

function safeTheme(themeDefinition) {
  return themeDefinition?.social ? themeDefinition : socialThemeDefinition('ice-blue', { fallback: false });
}

export function compileSocialTemplateProposalPack(proposal) {
  const value = validateSocialTemplateProposal(proposal, { allowSystemFields: true });
  const suffix = esc(value.proposalId || 'draft').slice(-36) || 'draft';
  const roles = Object.fromEntries(SOCIAL_CARD_PAGE_ROLES.map((role) => {
    const source = value.roles[role];
    return [role, Object.freeze({
      template: source.layout,
      supportedBlocks: [...source.supportedBlocks],
      maxBlocks: source.maxBlocks,
      maxItems: source.maxItems,
      notes: source.notes || '',
    })];
  }));
  const roleTemplates = Object.fromEntries(SOCIAL_CARD_PAGE_ROLES.map((role) => [role, value.roles[role].layout]));
  return Object.freeze({
    id: `proposal-${suffix}-v1`,
    version: 1,
    label: value.label,
    renderer: 'current-deterministic-renderer',
    roleTemplates,
    roles,
    fallbackTemplate: null,
    proposalId: value.proposalId,
    source: 'proposal',
    surface: { ...value.surface },
  });
}

export function compileSocialTemplateProposalCss(pack) {
  const scope = `[data-template-pack="${pack.id}"]`;
  const density = pack.surface.density === 'compact'
    ? `${scope} .page-content-stack{padding:20px 18px;gap:9px}${scope} .page li{padding:6px 8px 6px 22px;font-size:10px}`
    : pack.surface.density === 'airy'
      ? `${scope} .page-content-stack{padding:30px 24px;gap:16px}${scope} .content-block{gap:8px}${scope} .page li{padding:10px 11px 10px 25px}`
      : '';
  const decoration = {
    none: `${scope} .page:after{display:none}`,
    'grid-line': `${scope} .page{background-image:linear-gradient(color-mix(in srgb,var(--accent) 8%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--accent) 8%,transparent) 1px,transparent 1px);background-size:20px 20px}`,
    orbit: `${scope} .page:after{border-radius:50%;border:2px solid var(--accent2);opacity:.3}`,
    stamp: `${scope} .eyebrow{width:max-content;padding:4px 7px;border:1px solid currentColor;transform:rotate(-2deg)}`,
    'index-line': `${scope} .page-content-stack:before{content:"";position:absolute;right:16px;top:15px;width:42px;border-top:2px solid var(--accent2);opacity:.5}`,
    'paper-rule': `${scope} .page h1{border-top:2px solid var(--line);border-bottom:1px solid var(--accent);padding:10px 0}`,
    'accent-edge': `${scope} .page-content-stack{border-left:5px solid var(--accent)}`,
  }[pack.surface.decoration] || '';
  const heading = {
    plain: '',
    'accent-bar': `${scope} .page h1{padding-left:12px;border-left:3px solid var(--accent)}`,
    'highlight-block': `${scope} .page h1{display:inline-block;width:max-content;max-width:100%;padding:6px 9px;background:var(--accent);color:var(--inverse)}`,
    underline: `${scope} .page h1{padding-bottom:8px;border-bottom:3px solid var(--accent)}`,
    numbered: `${scope} .page h1:before{content:attr(data-page-number) "  ";font:700 11px ui-monospace,Consolas,monospace;color:var(--accent2)}`,
  }[pack.surface.headingTreatment] || '';
  return `${density}${decoration}${heading}`;
}

export function auditSocialTemplateProposal({ proposal, themeDefinition = null, html = '' } = {}) {
  const issues = [];
  let value;
  try {
    value = validateSocialTemplateProposal(proposal, { allowSystemFields: true });
  } catch (error) {
    if (error instanceof SocialTemplateProposalError) return { valid: false, productionEligible: false, issues: error.issues, repairPlan: { programmatic: [], aiAssisted: [] }, checks: { schema: false, roles: false, renderer: false, colors: false, typography: false, pseudoElements: false, componentVisibility: false, layout: false, unsafe: false } };
    throw error;
  }
  const theme = safeTheme(themeDefinition);
  const colors = theme.tokens.colors;
  const typography = theme.tokens.typography;
  const surface = colors.surface;
  const checks = { schema: true, roles: true, renderer: true, colors: true, typography: true, pseudoElements: true, componentVisibility: true, layout: true, unsafe: true };
  for (const role of SOCIAL_CARD_PAGE_ROLES) {
    const config = value.roles[role];
    if (!config) { checks.roles = false; issues.push(issue(`roles.${role}`, 'ROLE_MISSING', '页面角色未覆盖', role)); continue; }
    const unsupported = config.supportedBlocks.filter((type) => !SOCIAL_CARD_RENDERER_BLOCK_TYPES.includes(type));
    if (unsupported.length) { checks.renderer = false; issues.push(issue(`roles.${role}.supportedBlocks`, 'BLOCK_UNSUPPORTED', `包含未登记内容块：${unsupported.join('、')}`, role)); }
    if (config.maxBlocks > 4 && !['cover', 'ending'].includes(role)) issues.push(issue(`roles.${role}.maxBlocks`, 'BLOCK_BUDGET_HIGH', '内容块预算偏高，固定 375×667 样稿可能更容易溢出', role));
  }
  if (!DENSITIES.has(value.surface.density) || !DECORATIONS.has(value.surface.decoration) || !HEADING_TREATMENTS.has(value.surface.headingTreatment)) { checks.roles = false; issues.push(issue('surface', 'SURFACE_INVALID', '表面配置不在受控枚举内')); }
  const contrastChecks = [
    ['colors.text', colors.text, surface, 4.5, '正文与内容表面'],
    ['colors.muted', colors.muted, surface, 3, '辅助文字与内容表面'],
    ['colors.accentSecondary', colors.accentSecondary, surface, 3, '列表标记与内容表面'],
    ['colors.inverseText', colors.inverseText, colors.accent, 3, '反白文字与强调表面'],
  ];
  for (const [field, foreground, background, minimum, label] of contrastChecks) {
    if (colorContrast(foreground, background) < minimum) { checks.colors = false; issues.push(issue(field, 'LOW_CONTRAST', `${label}对比度不足 ${minimum}:1`)); }
  }
  if (!(typography.h1Px > typography.h2Px && typography.h2Px >= typography.bodyPx && typography.bodyPx >= typography.captionPx)) {
    checks.typography = false; issues.push(issue('tokens.typography', 'TYPE_SCALE_INVALID', '标题、正文和辅助文字的字号层级不满足 h1 > h2 ≥ body ≥ caption'));
  }
  if (colorContrast(colors.accentSecondary, surface) < 3) { checks.pseudoElements = false; issues.push(issue('social.list.marker', 'PSEUDO_ELEMENT_INVISIBLE', '列表 ::before 使用 accentSecondary 时与列表背景对比度不足')); }
  if (html) {
    if (/<script\b|\son[a-z]+\s*=|<iframe\b|javascript:|https?:\/\//i.test(html)) { checks.unsafe = false; issues.push(issue('html', 'UNSAFE_HTML', '正式样稿包含脚本、事件属性或外部资源')); }
    const pages = (html.match(/<section class="page /g) || []).length;
    const stacks = (html.match(/class="page-content-stack"/g) || []).length;
    if (pages !== SOCIAL_THEME_SPECIMEN.pages.length || stacks !== pages || !html.includes('width:375px;height:667px;overflow:hidden')) { checks.layout = false; issues.push(issue('html', 'LAYOUT_STRUCTURE', '固定样稿未保持 375×667 画布或逐页内容栈')); }
    if ((html.match(/data-template-id="[^"]+"/g) || []).length !== pages) { checks.layout = false; issues.push(issue('html', 'TEMPLATE_METADATA_MISSING', '逐页模板元数据不完整')); }
    for (const [className, label] of [['stat-row', '数据组件'], ['step-col', '步骤组件'], ['compare-block', '对比组件'], ['note-block', '提示组件'], ['tl', '时间线组件']]) {
      if (!html.includes(className)) { checks.componentVisibility = false; issues.push(issue(`components.${className}`, 'COMPONENT_NOT_VISIBLE', `${label}未出现在正式固定样稿`)); }
    }
  }
  const programmatic = [], aiAssisted = [];
  for (const item of issues) {
    if (['LOW_CONTRAST', 'PSEUDO_ELEMENT_INVISIBLE'].includes(item.code)) programmatic.push({ field: item.field, action: 'switch-to-registered-semantic-color', reason: '程序可从当前主题已登记的语义颜色中选择可见组合' });
    else if (['LAYOUT_STRUCTURE', 'COMPONENT_NOT_VISIBLE', 'BLOCK_BUDGET_HIGH'].includes(item.code)) aiAssisted.push({ field: item.field, action: 'revise-proposal-density-or-role-layout', reason: '保留事实和角色目标，由 AI 提供受控版式调整建议后再由程序复审' });
  }
  const valid = issues.every((item) => !['LOW_CONTRAST', 'TYPE_SCALE_INVALID', 'PSEUDO_ELEMENT_INVISIBLE', 'COMPONENT_NOT_VISIBLE', 'UNSAFE_HTML', 'LAYOUT_STRUCTURE', 'TEMPLATE_METADATA_MISSING', 'BLOCK_UNSUPPORTED', 'ROLE_MISSING', 'SURFACE_INVALID'].includes(item.code));
  return { valid, productionEligible: valid && value.source !== 'ai-html-draft' && !value.draft, issues, repairPlan: { programmatic, aiAssisted }, checks };
}

export function compileSocialTemplateProposal({ proposal, themeDefinition = null, channelMode = 'xiaohongshu' } = {}) {
  const value = validateSocialTemplateProposal(proposal, { allowSystemFields: true });
  const theme = safeTheme(themeDefinition);
  const templatePack = compileSocialTemplateProposalPack(value);
  const html = renderStoryboardHtml({
    topic: SOCIAL_THEME_SPECIMEN.topic,
    repository: SOCIAL_THEME_SPECIMEN.repository,
    pages: SOCIAL_THEME_SPECIMEN.pages,
    contentType: SOCIAL_THEME_SPECIMEN.contentType,
    sourceLabel: SOCIAL_THEME_SPECIMEN.sourceLabel,
    channelMode,
    visualStyle: theme.id,
    themeDefinition: theme,
    compositionMode: 'template',
    templatePackOverride: templatePack,
    templateCssOverride: compileSocialTemplateProposalCss(templatePack),
  });
  const audit = auditSocialTemplateProposal({ proposal: value, themeDefinition: theme, html });
  return { schemaVersion: 1, proposalId: value.proposalId, status: value.status, templatePack: { id: templatePack.id, version: templatePack.version, label: templatePack.label, renderer: templatePack.renderer, roleTemplates: { ...templatePack.roleTemplates } }, html, audit };
}
