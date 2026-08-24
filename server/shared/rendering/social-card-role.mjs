export const SOCIAL_CARD_COMPOSITION_MODES = Object.freeze(['smart', 'template']);
export const SOCIAL_CARD_PAGE_ROLES = Object.freeze(['cover','concept','feature','steps','data','compare','evidence','timeline','risk','ending']);

export function stableCardCompositionSeed(page = {}, pageIndex = 0, seed = '') {
  const value = `${seed}|${pageIndex}|${page.kind || ''}|${page.title || ''}|${(page.content_blocks || []).map((block) => block?.type || '').join(',')}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function inferCardPageRole(page = {}) {
  if (page.kind === 'cover') return 'cover';
  if (page.kind === 'ending') return 'ending';
  const kind = String(page.kind || '').toLowerCase();
  const types = (Array.isArray(page.content_blocks) ? page.content_blocks : []).map((block) => block?.type);
  if (types.includes('timeline') || /timeline|what-happened/.test(kind)) return 'timeline';
  if (types.includes('steps') || /quickstart|step|howto|tutorial/.test(kind)) return 'steps';
  if (types.includes('stats')) return 'data';
  if (types.includes('compare') || /positions/.test(kind)) return 'compare';
  if (/evidence/.test(kind)) return 'evidence';
  if (/risk|limitation|boundary/.test(kind)) return 'risk';
  if (/capability|feature|scenario|item/.test(kind)) return 'feature';
  return 'concept';
}
