export const SOCIAL_CARD_LAYOUTS = Object.freeze(['auto', 'poster', 'editorial', 'data', 'checklist', 'steps', 'minimal']);

export function recommendedCardLayout(page, channelMode = 'wechat') {
  if (page?.kind === 'cover') return 'poster';
  if (page?.kind === 'ending') return 'minimal';
  const blocks = Array.isArray(page?.content_blocks) ? page.content_blocks : [];
  const types = blocks.map((block) => block?.type);
  const semanticKind = String(page?.kind || '').toLowerCase();
  const text = blocks.map((block) => `${block?.title || ''}\n${block?.content || ''}`).join('\n');
  if (types.some((type) => type === 'stats' || type === 'compare')) return 'data';
  if (types.some((type) => type === 'steps' || type === 'timeline')
    || /^(quickstart|step|steps|howto|tutorial|process|timeline)$/.test(semanticKind)
    || (text.match(/(?:^|\s)\d+(?:\.\s+|、\s*)/g) || []).length >= 2) return 'steps';
  if (types.some((type) => type === 'list' || type === 'scenes')) return 'checklist';
  if (types.some((type) => type === 'highlight') || /^(highlight|conclusion|summary)$/.test(semanticKind)) return 'minimal';
  return 'editorial';
}

function layoutFitsPage(layout, page) {
  const types = (Array.isArray(page?.content_blocks) ? page.content_blocks : []).map((block) => block?.type);
  if (layout === 'data') return types.some((type) => type === 'stats' || type === 'compare');
  if (layout === 'steps') return types.some((type) => type === 'steps' || type === 'timeline');
  if (layout === 'checklist') return types.some((type) => type === 'list' || type === 'scenes');
  return true;
}

export function resolveCardLayoutDecision(page, requested = 'auto', channelMode = 'wechat') {
  const pageChoice = SOCIAL_CARD_LAYOUTS.includes(page?.layout_style) ? page.layout_style : 'auto';
  const globalChoice = SOCIAL_CARD_LAYOUTS.includes(requested) ? requested : 'auto';
  const desired = pageChoice !== 'auto' ? pageChoice : globalChoice;
  const recommended = recommendedCardLayout(page, channelMode);
  if (desired === 'auto') return { layout: recommended, source: 'recommended', reason: channelMode === 'xiaohongshu' ? '按小红书内容节奏推荐' : '按公众号信息密度推荐' };
  if (!layoutFitsPage(desired, page)) return { layout: recommended, source: 'fallback', requested: desired, reason: `${desired} 与当前内容块不匹配，已安全降级` };
  return { layout: desired, source: pageChoice !== 'auto' ? 'manual' : 'group', reason: pageChoice !== 'auto' ? '逐页手动指定' : '整组版式指定' };
}

export function resolveCardLayout(page, requested = 'auto', channelMode = 'wechat') {
  return resolveCardLayoutDecision(page, requested, channelMode).layout;
}
