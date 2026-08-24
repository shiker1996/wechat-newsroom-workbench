const ROLE_TARGETS = Object.freeze({
  concept: 0.72,
  feature: 0.72,
  steps: 0.68,
  data: 0.72,
  compare: 0.72,
  evidence: 0.70,
  timeline: 0.68,
  risk: 0.68,
});

const TEMPLATE_DELTAS = Object.freeze({
  'clean-v1': 0,
  'editorial-v1': 0,
  'brutalist-v1': -0.04,
  'neon-v1': -0.04,
});

export const SOCIAL_CARD_DENSITY_TARGETS = Object.freeze({
  schemaVersion: 1,
  hardMinimum: 0.50,
  continuationMinimum: 0.62,
  coverMinimum: 0.45,
  endingMinimum: 0.45,
  roleMinimums: ROLE_TARGETS,
  templateDeltas: TEMPLATE_DELTAS,
});

const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function resolveSocialCardDensityTarget(page = {}, { templatePackId = '', targets = SOCIAL_CARD_DENSITY_TARGETS } = {}) {
  const kind = String(page?.kind || 'content');
  if (kind === 'cover') return number(targets.coverMinimum, 0.45);
  if (kind === 'ending') return number(targets.endingMinimum, 0.45);
  const role = String(page?.role || '');
  const base = number(targets.roleMinimums?.[role], 0.70);
  const delta = number(targets.templateDeltas?.[String(templatePackId || '')], 0);
  const continuation = Number(page?.continuation_index || 0) > 1;
  const value = continuation ? number(targets.continuationMinimum, 0.62) : base + delta;
  return Math.max(number(targets.hardMinimum, 0.50), Math.min(0.90, value));
}

export function assessSocialCardDensityTargets(report = {}, cardPlan = [], { templatePackId = '', targets = SOCIAL_CARD_DENSITY_TARGETS } = {}) {
  const pages = Array.isArray(report?.pages) ? report.pages : [];
  const plan = Array.isArray(cardPlan) ? cardPlan : [];
  const underfilled = [];
  for (const item of pages) {
    const pageNumber = Number(item?.page);
    const page = Number.isInteger(pageNumber) ? plan[pageNumber - 1] : null;
    if (!page || page.kind === 'cover' || page.kind === 'ending') continue;
    const issues = Array.isArray(item?.issues) ? item.issues.map(String) : [];
    if (issues.some((issue) => ['overflow', 'clipped', 'horizontal_overflow', 'text_too_small', 'overfilled', 'invalid_page_grid_structure', 'missing_content_stack', 'empty_page_body'].includes(issue))) continue;
    const utilization = number(item?.utilization, 0) / 100;
    const target = resolveSocialCardDensityTarget(page, { templatePackId, targets });
    if (utilization > 0 && utilization < target) {
      underfilled.push({
        page: pageNumber,
        role: String(page.role || ''),
        kind: String(page.kind || 'content'),
        continuationIndex: Number(page.continuation_index || 0) || null,
        utilization: number(item?.utilization, 0),
        target: Math.round(target * 100),
        gap: Math.round((target - utilization) * 1000) / 10,
      });
    }
  }
  return { schemaVersion: 1, templatePackId: String(templatePackId || ''), pages: underfilled };
}

