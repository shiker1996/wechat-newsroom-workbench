const STRUCTURED_ITEM_BLOCKS = new Set(['list', 'steps', 'timeline', 'scenes', 'stats', 'compare', 'text']);

function textLength(value) {
  return String(value ?? '').trim().length;
}

function itemCount(block) {
  if (Array.isArray(block?.items)) return block.items.length;
  if (Array.isArray(block?.rows)) return block.rows.length;
  if (block?.type === 'list') return String(block?.content || '').split(/\n+/).filter((line) => line.trim()).length;
  return 0;
}

function blockTextLength(block) {
  const values = [];
  if (block?.title) values.push(block.title);
  if (block?.content) values.push(block.content);
  if (Array.isArray(block?.items)) values.push(...block.items.map((item) => typeof item === 'string' ? item : JSON.stringify(item)));
  if (Array.isArray(block?.rows)) values.push(...block.rows.map((item) => Array.isArray(item) ? item.join(' ') : JSON.stringify(item)));
  return values.reduce((sum, value) => sum + textLength(value), 0);
}

export function summarizeSocialCardPlanPage(page = {}, index = 0) {
  const blocks = Array.isArray(page?.content_blocks) ? page.content_blocks : [];
  return {
    page: index + 1,
    kind: String(page?.kind || ''),
    role: String(page?.role || page?.kind || 'content'),
    pageGroupId: String(page?.page_group_id || ''),
    continuationOf: page?.continuation_of == null ? null : Number(page.continuation_of),
    continuationIndex: page?.continuation_index == null ? null : Number(page.continuation_index),
    blockCount: blocks.length,
    itemCount: blocks.reduce((sum, block) => sum + itemCount(block), 0),
    textChars: blocks.reduce((sum, block) => sum + blockTextLength(block), 0),
    blocks: blocks.map((block, blockIndex) => ({
      index: blockIndex,
      type: String(block?.type || 'text'),
      itemCount: itemCount(block),
      textChars: blockTextLength(block),
      splittable: STRUCTURED_ITEM_BLOCKS.has(String(block?.type || '')),
    })),
  };
}

export function summarizeSocialCardPlan(plan = []) {
  const pages = Array.isArray(plan) ? plan : [];
  const pageSummaries = pages.map((page, index) => summarizeSocialCardPlanPage(page, index));
  const roles = {};
  for (const page of pageSummaries) {
    const role = page.role || 'content';
    roles[role] = (roles[role] || 0) + 1;
  }
  return {
    pageCount: pages.length,
    blockCount: pageSummaries.reduce((sum, page) => sum + page.blockCount, 0),
    itemCount: pageSummaries.reduce((sum, page) => sum + page.itemCount, 0),
    textChars: pageSummaries.reduce((sum, page) => sum + page.textChars, 0),
    roles,
    pages: pageSummaries,
  };
}

export function summarizeSocialCardLayoutReport(report = null) {
  const pages = Array.isArray(report?.pages) ? report.pages : [];
  return {
    valid: report?.valid === true,
    pageCount: pages.length,
    pages: pages.map((page) => ({
      page: Number(page?.page) || 0,
      kind: String(page?.kind || ''),
      valid: page?.valid === true,
      utilization: Number.isFinite(Number(page?.utilization)) ? Number(page.utilization) : null,
      issues: Array.isArray(page?.issues) ? page.issues.map(String) : [],
      overflowPixels: Number(page?.overflowPixels) || 0,
      clippedPixels: Number(page?.clippedPixels) || 0,
      horizontalOverflowPixels: Number(page?.horizontalOverflowPixels) || 0,
    })),
  };
}

export function summarizeSocialCardPlanOperations(operations = []) {
  const list = Array.isArray(operations) ? operations : [];
  const counts = {};
  for (const operation of list) {
    const name = String(operation?.op || 'unknown');
    counts[name] = (counts[name] || 0) + 1;
  }
  return { total: list.length, counts, operations: list };
}

export function buildSocialCardPlanBaseline({
  originalPlan = [],
  finalPlan = [],
  template = null,
  capacityProfile = null,
  operations = [],
  report = null,
  auditAttempts = [],
  repair = {},
  operation = 'generation',
} = {}) {
  const original = summarizeSocialCardPlan(originalPlan);
  const final = summarizeSocialCardPlan(finalPlan);
  const normalizedOperations = summarizeSocialCardPlanOperations(operations);
  const audit = summarizeSocialCardLayoutReport(report);
  const initialAudit = Array.isArray(auditAttempts) && auditAttempts.length ? auditAttempts[0] : null;
  return {
    schemaVersion: 1,
    operation: operation === 'page-regeneration' ? 'page-regeneration' : 'generation',
    recordedAt: new Date().toISOString(),
    template: template ? {
      requested: template.requested || null,
      rendered: template.rendered || null,
      themeId: String(template.themeId || ''),
      capacityProfileVersion: template.capacityProfileVersion ?? null,
      capacityProfile: capacityProfile || null,
    } : { requested: null, rendered: null, themeId: '', capacityProfileVersion: null, capacityProfile: capacityProfile || null },
    plans: { original, final },
    changes: {
      pageDelta: final.pageCount - original.pageCount,
      blockDelta: final.blockCount - original.blockCount,
      itemDelta: final.itemCount - original.itemCount,
      textCharDelta: final.textChars - original.textChars,
      operations: normalizedOperations,
    },
    audits: {
      attemptCount: Array.isArray(auditAttempts) ? auditAttempts.length : 0,
      initialLayoutPass: initialAudit?.valid === true ? true : initialAudit ? false : null,
      final: audit,
      attempts: Array.isArray(auditAttempts) ? auditAttempts : [],
    },
    repairs: {
      structuralReflowAttempted: Boolean(repair.structuralReflowAttempted),
      structureRepairCount: Number(repair.structureRepairCount || 0),
      textRepairCount: Number(repair.textRepairCount || 0),
      safeCompositionPages: Array.isArray(repair.safeCompositionPages) ? repair.safeCompositionPages.map(Number).filter(Number.isInteger) : [],
      relaxedDensityPages: Array.isArray(repair.relaxedDensityPages) ? repair.relaxedDensityPages.map(Number).filter(Number.isInteger) : [],
      expandedDensityPages: Array.isArray(repair.expandedDensityPages) ? repair.expandedDensityPages.map(Number).filter(Number.isInteger) : [],
      fitContentPages: Array.isArray(repair.fitContentPages) ? repair.fitContentPages.map(Number).filter(Number.isInteger) : [],
      phaseHistory: Array.isArray(repair.phaseHistory) ? repair.phaseHistory : [],
    },
  };
}
