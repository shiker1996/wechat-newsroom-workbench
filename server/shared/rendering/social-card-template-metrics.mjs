const ISSUE_UNDERFILLED = new Set(['underfilled']);
const ISSUE_OVERFLOW = new Set(['overflow', 'clipped', 'horizontal_overflow', 'vertical_overflow', 'overfilled']);

function pageIssues(page) {
  return new Set(Array.isArray(page?.issues) ? page.issues.map((issue) => String(issue)) : []);
}

export function summarizeSocialCardPageRoles(plan = [], report = null) {
  const pages = Array.isArray(plan) ? plan : [];
  const reportPages = Array.isArray(report?.pages) ? report.pages : [];
  const result = {};
  for (let index = 0; index < pages.length; index += 1) {
    const role = String(pages[index]?.role || pages[index]?.kind || 'content');
    const page = reportPages[index] || {};
    const issues = pageIssues(page);
    const item = result[role] || { pages: 0, layoutPass: 0, underfilledPages: 0, overflowPages: 0 };
    item.pages += 1;
    item.layoutPass += page.valid === true ? 1 : 0;
    item.underfilledPages += issues.has('underfilled') ? 1 : 0;
    item.overflowPages += [...ISSUE_OVERFLOW].some((issue) => issues.has(issue)) ? 1 : 0;
    result[role] = item;
  }
  return result;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function summarizeDynamicFillAudits(value) {
  const audits = (Array.isArray(value) ? value : value ? [value] : []).filter((item) => item && typeof item === 'object');
  const pages = audits.flatMap((audit) => Array.isArray(audit.pages) ? audit.pages : []);
  const rejected = pages.flatMap((page) => Array.isArray(page.rejectedOperations) ? page.rejectedOperations : []);
  const stopReasonCounts = {};
  for (const page of pages) {
    const reason = String(page?.stopReason || 'unknown');
    stopReasonCounts[reason] = (stopReasonCounts[reason] || 0) + 1;
  }
  const duplicateRejected = rejected.filter((item) => /重复|overlap|already_used|slot/i.test(JSON.stringify(item))).length;
  const targetReached = pages.filter((page) => page?.stopReason === 'target_utilization_reached').length;
  const estimatedTargetReached = pages.filter((page) => {
    const target = Number(page?.targetUtilization);
    const estimated = Number(page?.estimatedUtilization ?? page?.utilizationAfter);
    return Number.isFinite(target) && Number.isFinite(estimated) && estimated >= target;
  }).length;
  return {
    runs: audits.length,
    pages: pages.length,
    rejectedOperations: rejected.length,
    duplicateRejectedOperations: duplicateRejected,
    targetReachedPages: targetReached,
    targetDensityRate: pages.length ? targetReached / pages.length : null,
    estimatedTargetDensityRate: pages.length ? estimatedTargetReached / pages.length : null,
    stopReasonCounts,
  };
}

function summarizeJointPackingAudits(value) {
  const audits = (Array.isArray(value) ? value : value ? [value] : []).filter((item) => item && typeof item === 'object');
  const mismatchCount = audits.reduce((sum, item) => sum + numberOrZero(item.mismatchCount ?? item.summary?.mismatchCount), 0);
  const browserOnlyOverflowPages = audits.reduce((sum, item) => sum + (Array.isArray(item.browserOnlyOverflowPages) ? item.browserOnlyOverflowPages.length : Array.isArray(item.summary?.browserOnlyOverflowPages) ? item.summary.browserOnlyOverflowPages.length : 0), 0);
  const staticOnlyOverflowPages = audits.reduce((sum, item) => sum + (Array.isArray(item.staticOnlyOverflowPages) ? item.staticOnlyOverflowPages.length : Array.isArray(item.summary?.staticOnlyOverflowPages) ? item.summary.staticOnlyOverflowPages.length : 0), 0);
  const deltas = audits.map((item) => Number(item.meanAbsoluteUtilizationDelta ?? item.summary?.meanAbsoluteUtilizationDelta)).filter(Number.isFinite);
  return {
    attempts: audits.length,
    mismatchCount,
    browserOnlyOverflowPages,
    staticOnlyOverflowPages,
    meanAbsoluteUtilizationDelta: deltas.length ? deltas.reduce((sum, item) => sum + item, 0) / deltas.length : null,
  };
}

function summarizePlanOperations(operations = []) {
  const counts = {};
  for (const operation of Array.isArray(operations) ? operations : []) {
    const op = String(operation?.op || 'unknown');
    counts[op] = (counts[op] || 0) + 1;
  }
  return counts;
}

export function classifySocialTemplateFallbackKind({ requestedTemplate, renderedTemplate, source = '', fallback = false } = {}) {
  const requestedId = String(requestedTemplate?.id || '');
  const renderedId = String(renderedTemplate?.id || '');
  if (requestedId && renderedId && requestedId !== renderedId) return 'automatic-template';
  if (renderedId !== 'standard-v1') return 'none';
  if (source === 'fallback') return 'resolver-fallback';
  if (source === 'default' || fallback) return 'resolver-default';
  return 'explicit-compatibility';
}

export function summarizeSocialTemplateRun({
  requestedTemplate = null,
  renderedTemplate = null,
  channelMode = 'wechat',
  contentType = 'repository',
  report = null,
  fallback = false,
  operation = 'generation',
  success = true,
  editMode = '',
  targetPage = null,
  initialLayoutPass = null,
  auditAttempts = null,
  themeId = '',
  pageRoleStats = null,
  structuralReflowAttempted = false,
  structuralReflowSuccess = false,
  structureRepairCount = 0,
  contentPlanAdjustmentCount = 0,
  textRepairCount = 0,
  pagesAdded = 0,
  planOperations = [],
  noOpRepair = false,
  hardGateFailure = false,
  sourceAtomLossCount = 0,
  avgUtilization = null,
  jointPackingAudit = null,
  rolloutProfile = null,
  dynamicFillAudits = null,
} = {}) {
  const pages = Array.isArray(report?.pages) ? report.pages : [];
  const underfilledPages = pages.filter((page) => [...pageIssues(page)].some((issue) => ISSUE_UNDERFILLED.has(issue))).length;
  const overflowPages = pages.filter((page) => [...pageIssues(page)].some((issue) => ISSUE_OVERFLOW.has(issue))).length;
  const layoutPass = report && typeof report.valid === 'boolean' ? report.valid : null;
  const normalizedInitialLayoutPass = typeof initialLayoutPass === 'boolean' ? initialLayoutPass : null;
  const normalizedAuditAttempts = Number.isInteger(Number(auditAttempts)) && Number(auditAttempts) >= 0 ? Number(auditAttempts) : null;
  const planOperationCounts = summarizePlanOperations(planOperations);
  const calculatedUtilization = avgUtilization == null
    ? (() => {
      const values = pages.map((page) => Number(page?.utilization)).filter((value) => Number.isFinite(value));
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    })()
    : Number(avgUtilization);
  const jointPacking = summarizeJointPackingAudits(jointPackingAudit);
  const dynamicFill = summarizeDynamicFillAudits(dynamicFillAudits);
  return {
    schemaVersion: 1,
    operation: operation === 'page-regeneration' ? 'page-regeneration' : 'generation',
    success: success !== false,
    requestedTemplate: requestedTemplate ? { id: String(requestedTemplate.id || ''), version: requestedTemplate.version ?? null, source: String(requestedTemplate.source || '') } : null,
    renderedTemplate: renderedTemplate ? { id: String(renderedTemplate.id || ''), version: renderedTemplate.version ?? null, source: String(renderedTemplate.source || '') } : null,
    channelMode: channelMode === 'xiaohongshu' ? 'xiaohongshu' : 'wechat',
    contentType: String(contentType || 'repository'),
    themeId: String(themeId || ''),
    pageCount: pages.length,
    layoutPass,
    fallback: Boolean(fallback),
    fallbackKind: classifySocialTemplateFallbackKind({ requestedTemplate, renderedTemplate, source: renderedTemplate?.source || requestedTemplate?.source || '', fallback }),
    initialLayoutPass: normalizedInitialLayoutPass,
    auditAttempts: normalizedAuditAttempts,
    strictFailure: operation === 'generation' && success === false && layoutPass === false,
    underfilledPages,
    overflowPages,
    editMode: ['expand', 'compress', 'restructure'].includes(editMode) ? editMode : '',
    targetPage: Number.isInteger(Number(targetPage)) && Number(targetPage) > 0 ? Number(targetPage) : null,
    pageRoleStats: pageRoleStats && typeof pageRoleStats === 'object' ? pageRoleStats : {},
    structuralReflowAttempted: Boolean(structuralReflowAttempted),
    structuralReflowSuccess: Boolean(structuralReflowSuccess),
    structureRepairCount: numberOrZero(structureRepairCount),
    contentPlanAdjustmentCount: numberOrZero(contentPlanAdjustmentCount),
    textRepairCount: numberOrZero(textRepairCount),
    pagesAdded: numberOrZero(pagesAdded),
    planOperationCounts,
    pagesSplit: numberOrZero(planOperationCounts.split_block) + numberOrZero(planOperationCounts.split_page),
    pagesMerged: numberOrZero(planOperationCounts.merge_pages),
    blocksMoved: numberOrZero(planOperationCounts.move_block),
    factBlocksAdded: numberOrZero(planOperationCounts.add_fact_block),
    sourceAtomLossCount: numberOrZero(sourceAtomLossCount),
    avgUtilization: Number.isFinite(calculatedUtilization) ? calculatedUtilization : null,
    jointPackingAuditAttempts: jointPacking.attempts,
    jointPackingMismatchCount: jointPacking.mismatchCount,
    jointPackingBrowserOnlyOverflowPages: jointPacking.browserOnlyOverflowPages,
    jointPackingStaticOnlyOverflowPages: jointPacking.staticOnlyOverflowPages,
    jointPackingMeanAbsoluteUtilizationDelta: jointPacking.meanAbsoluteUtilizationDelta,
    dynamicFillRuns: dynamicFill.runs,
    dynamicFillPages: dynamicFill.pages,
    dynamicFillRejectedOperations: dynamicFill.rejectedOperations,
    duplicateSupplementRejectedCount: dynamicFill.duplicateRejectedOperations,
    dynamicFillTargetReachedPages: dynamicFill.targetReachedPages,
    dynamicFillTargetDensityRate: dynamicFill.targetDensityRate,
    dynamicFillEstimatedTargetDensityRate: dynamicFill.estimatedTargetDensityRate,
    dynamicFillStopReasonCounts: dynamicFill.stopReasonCounts,
    rolloutProfile: rolloutProfile && typeof rolloutProfile === 'object' ? rolloutProfile : null,
    noOpRepair: Boolean(noOpRepair),
    hardGateFailure: Boolean(hardGateFailure),
    recordedAt: new Date().toISOString(),
  };
}

function mergeRoleStats(target, source) {
  for (const [role, value] of Object.entries(source && typeof source === 'object' ? source : {})) {
    const current = target[role] || { pages: 0, layoutPass: 0, underfilledPages: 0, overflowPages: 0 };
    target[role] = {
      pages: current.pages + numberOrZero(value?.pages),
      layoutPass: current.layoutPass + numberOrZero(value?.layoutPass),
      underfilledPages: current.underfilledPages + numberOrZero(value?.underfilledPages),
      overflowPages: current.overflowPages + numberOrZero(value?.overflowPages),
    };
  }
}

export function aggregateSocialTemplateMetricsByDimension(rows = []) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.operation !== 'generation') continue;
    const template = String(row.requested_template_id || row.requestedTemplate?.id || 'unknown');
    const theme = String(row.theme_id || row.themeId || 'unknown');
    const roleStats = row.pageRoleStats && Object.keys(row.pageRoleStats).length ? row.pageRoleStats : { all: {
      pages: numberOrZero(row.page_count), layoutPass: row.layout_pass ? numberOrZero(row.page_count) : 0,
      underfilledPages: numberOrZero(row.underfilled_pages), overflowPages: numberOrZero(row.overflow_pages),
    } };
    for (const [role, value] of Object.entries(roleStats)) {
      const key = `${template}|${theme}|${role}`;
      const current = groups.get(key) || { templatePackId: template, themeId: theme, role, runs: 0, pages: 0, layoutPass: 0, underfilledPages: 0, overflowPages: 0, pagesAdded: 0, pagesSplit: 0, pagesMerged: 0, blocksMoved: 0, factBlocksAdded: 0, contentPlanAdjustmentRounds: 0, sourceAtomLossCount: 0, utilizationTotal: 0, utilizationSamples: 0, structuralReflowRuns: 0, structuralReflowSuccesses: 0, textRepairRuns: 0, jointPackingAuditAttempts: 0, jointPackingMismatchCount: 0, jointPackingBrowserOnlyOverflowPages: 0, jointPackingStaticOnlyOverflowPages: 0, jointPackingDeltaTotal: 0, jointPackingDeltaSamples: 0 };
      current.runs += 1;
      current.pages += numberOrZero(value?.pages);
      current.layoutPass += numberOrZero(value?.layoutPass);
      current.underfilledPages += numberOrZero(value?.underfilledPages);
      current.overflowPages += numberOrZero(value?.overflowPages);
      current.pagesAdded += numberOrZero(row.pages_added ?? row.pagesAdded) / Math.max(1, Object.keys(roleStats).length);
      current.pagesSplit += numberOrZero(row.pages_split ?? row.pagesSplit) / Math.max(1, Object.keys(roleStats).length);
      current.pagesMerged += numberOrZero(row.pages_merged ?? row.pagesMerged) / Math.max(1, Object.keys(roleStats).length);
      current.blocksMoved += numberOrZero(row.blocks_moved ?? row.blocksMoved) / Math.max(1, Object.keys(roleStats).length);
      current.factBlocksAdded += numberOrZero(row.fact_blocks_added ?? row.factBlocksAdded) / Math.max(1, Object.keys(roleStats).length);
      current.contentPlanAdjustmentRounds += numberOrZero(row.content_plan_adjustment_count ?? row.contentPlanAdjustmentCount) / Math.max(1, Object.keys(roleStats).length);
      current.sourceAtomLossCount += numberOrZero(row.source_atom_loss_count ?? row.sourceAtomLossCount) / Math.max(1, Object.keys(roleStats).length);
      const utilization = Number(row.avg_utilization ?? row.avgUtilization);
      if (Number.isFinite(utilization)) { current.utilizationTotal += utilization; current.utilizationSamples += 1; }
      current.structuralReflowRuns += row.structural_reflow_attempted || row.structuralReflowAttempted ? 1 : 0;
      current.structuralReflowSuccesses += row.structural_reflow_success || row.structuralReflowSuccess ? 1 : 0;
      current.textRepairRuns += numberOrZero(row.text_repair_count ?? row.textRepairCount) > 0 ? 1 : 0;
      current.jointPackingAuditAttempts += numberOrZero(row.joint_packing_audit_attempts ?? row.jointPackingAuditAttempts) / Math.max(1, Object.keys(roleStats).length);
      current.jointPackingMismatchCount += numberOrZero(row.joint_packing_mismatch_count ?? row.jointPackingMismatchCount) / Math.max(1, Object.keys(roleStats).length);
      current.jointPackingBrowserOnlyOverflowPages += numberOrZero(row.joint_packing_browser_only_overflow ?? row.jointPackingBrowserOnlyOverflowPages) / Math.max(1, Object.keys(roleStats).length);
      current.jointPackingStaticOnlyOverflowPages += numberOrZero(row.joint_packing_static_only_overflow ?? row.jointPackingStaticOnlyOverflowPages) / Math.max(1, Object.keys(roleStats).length);
      const jointDelta = Number(row.joint_packing_mean_delta ?? row.jointPackingMeanAbsoluteUtilizationDelta);
      if (Number.isFinite(jointDelta)) { current.jointPackingDeltaTotal += jointDelta; current.jointPackingDeltaSamples += 1; }
      groups.set(key, current);
    }
  }
  return [...groups.values()].map((item) => ({
    ...item,
    layoutPassRate: item.pages ? item.layoutPass / item.pages : null,
    underfilledRate: item.pages ? item.underfilledPages / item.pages : null,
    overflowRate: item.pages ? item.overflowPages / item.pages : null,
    structuralReflowSuccessRate: item.structuralReflowRuns ? item.structuralReflowSuccesses / item.structuralReflowRuns : null,
    averageContentPlanAdjustmentRounds: item.runs ? item.contentPlanAdjustmentRounds / item.runs : 0,
    averageUtilization: item.utilizationSamples ? item.utilizationTotal / item.utilizationSamples : null,
    jointPackingMismatchRate: item.jointPackingAuditAttempts ? item.jointPackingMismatchCount / item.jointPackingAuditAttempts : null,
    averageJointPackingMeanAbsoluteUtilizationDelta: item.jointPackingDeltaSamples ? item.jointPackingDeltaTotal / item.jointPackingDeltaSamples : null,
  })).sort((a, b) => `${a.templatePackId}|${a.themeId}|${a.role}`.localeCompare(`${b.templatePackId}|${b.themeId}|${b.role}`));
}

export function buildSocialTemplateCalibrationReport(rows = [], { minSamples = 3 } = {}) {
  const dimensions = aggregateSocialTemplateMetricsByDimension(rows);
  const recommendations = dimensions.map((item) => {
    const enoughSamples = item.pages >= Math.max(1, Number(minSamples) || 3);
    const direction = !enoughSamples ? 'collect-more-samples' : item.overflowRate >= 0.15 ? 'decrease-capacity' : item.underfilledRate >= 0.3 ? 'increase-capacity' : 'keep';
    return { ...item, enoughSamples, recommendation: direction, jointPackingCalibrationNeeded: item.jointPackingMismatchRate != null && item.jointPackingMismatchRate >= 0.2, rendererExtensionNeeded: false };
  });
  return {
    schemaVersion: 1,
    sampleCount: (Array.isArray(rows) ? rows : []).filter((row) => row.operation === 'generation').length,
    dimensions: recommendations,
    rendererExtensionNeeded: false,
    rendererExtensionCandidates: [],
    note: '只有出现经过程序验证但现有结构原语无法承载的结构缺口时，才进入 renderer 扩展评估；容量偏差只调整 profile。',
  };
}

export function aggregateSocialTemplateMetrics(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const generations = list.filter((row) => row.operation === 'generation');
  const pageOperations = list.filter((row) => row.operation === 'page-regeneration');
  const pageCount = generations.reduce((sum, row) => sum + numberOrZero(row.pageCount), 0);
  const underfilledPages = generations.reduce((sum, row) => sum + numberOrZero(row.underfilledPages), 0);
  const overflowPages = generations.reduce((sum, row) => sum + numberOrZero(row.overflowPages), 0);
  const successfulPages = pageOperations.filter((row) => Number(row.success) !== 0 && row.success !== false).length;
  const fallbackKindCount = (kind) => generations.filter((row) => row.fallbackKind === kind).length;
  return {
    schemaVersion: 1,
    usageCount: generations.length,
    pageCount,
    layoutPassRate: generations.length ? generations.filter((row) => Number(row.layoutPass) !== 0 && row.layoutPass !== false).length / generations.length : null,
    fallbackRate: generations.length ? generations.filter((row) => Number(row.fallback) !== 0 && row.fallback !== false).length / generations.length : null,
    automaticTemplateFallbackRate: generations.length ? fallbackKindCount('automatic-template') / generations.length : null,
    resolverFallbackRate: generations.length ? fallbackKindCount('resolver-fallback') / generations.length : null,
    resolverDefaultRate: generations.length ? fallbackKindCount('resolver-default') / generations.length : null,
    explicitCompatibilityRate: generations.length ? fallbackKindCount('explicit-compatibility') / generations.length : null,
    underfilledRate: pageCount ? underfilledPages / pageCount : null,
    overflowRate: pageCount ? overflowPages / pageCount : null,
    singlePageRegenerationCount: pageOperations.length,
    singlePageRegenerationSuccessRate: pageOperations.length ? successfulPages / pageOperations.length : null,
    structuralReflowRunCount: generations.reduce((sum, row) => sum + (row.structuralReflowAttempted || row.structural_reflow_attempted ? 1 : 0), 0),
    structuralReflowSuccessRate: (() => { const attempted = generations.filter((row) => row.structuralReflowAttempted || row.structural_reflow_attempted); return attempted.length ? attempted.filter((row) => row.structuralReflowSuccess || row.structural_reflow_success).length / attempted.length : null; })(),
    pagesAdded: generations.reduce((sum, row) => sum + numberOrZero(row.pagesAdded ?? row.pages_added), 0),
    pagesSplit: generations.reduce((sum, row) => sum + numberOrZero(row.pagesSplit ?? row.pages_split), 0),
    pagesMerged: generations.reduce((sum, row) => sum + numberOrZero(row.pagesMerged ?? row.pages_merged), 0),
    blocksMoved: generations.reduce((sum, row) => sum + numberOrZero(row.blocksMoved ?? row.blocks_moved), 0),
    factBlocksAdded: generations.reduce((sum, row) => sum + numberOrZero(row.factBlocksAdded ?? row.fact_blocks_added), 0),
    dynamicFillRuns: generations.reduce((sum, row) => sum + numberOrZero(row.dynamicFillRuns ?? row.dynamic_fill_runs), 0),
    dynamicFillRejectedOperations: generations.reduce((sum, row) => sum + numberOrZero(row.dynamicFillRejectedOperations ?? row.dynamic_fill_rejected_operations), 0),
    duplicateSupplementRejectedCount: generations.reduce((sum, row) => sum + numberOrZero(row.duplicateSupplementRejectedCount ?? row.duplicate_supplement_rejected_count), 0),
    dynamicFillTargetReachedPages: generations.reduce((sum, row) => sum + numberOrZero(row.dynamicFillTargetReachedPages ?? row.dynamic_fill_target_reached_pages), 0),
    contentPlanAdjustmentRounds: generations.reduce((sum, row) => sum + numberOrZero(row.contentPlanAdjustmentCount ?? row.content_plan_adjustment_count), 0),
    averageContentPlanAdjustmentRounds: generations.length ? generations.reduce((sum, row) => sum + numberOrZero(row.contentPlanAdjustmentCount ?? row.content_plan_adjustment_count), 0) / generations.length : 0,
    sourceAtomLossCount: generations.reduce((sum, row) => sum + numberOrZero(row.sourceAtomLossCount ?? row.source_atom_loss_count), 0),
    averageUtilization: (() => { const values = generations.map((row) => Number(row.avgUtilization ?? row.avg_utilization)).filter((value) => Number.isFinite(value)); return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; })(),
    jointPackingAuditAttempts: generations.reduce((sum, row) => sum + numberOrZero(row.jointPackingAuditAttempts ?? row.joint_packing_audit_attempts), 0),
    jointPackingMismatchCount: generations.reduce((sum, row) => sum + numberOrZero(row.jointPackingMismatchCount ?? row.joint_packing_mismatch_count), 0),
    jointPackingBrowserOnlyOverflowPages: generations.reduce((sum, row) => sum + numberOrZero(row.jointPackingBrowserOnlyOverflowPages ?? row.joint_packing_browser_only_overflow), 0),
    jointPackingStaticOnlyOverflowPages: generations.reduce((sum, row) => sum + numberOrZero(row.jointPackingStaticOnlyOverflowPages ?? row.joint_packing_static_only_overflow), 0),
    jointPackingMismatchRate: (() => { const attempts = generations.reduce((sum, row) => sum + numberOrZero(row.jointPackingAuditAttempts ?? row.joint_packing_audit_attempts), 0); const mismatches = generations.reduce((sum, row) => sum + numberOrZero(row.jointPackingMismatchCount ?? row.joint_packing_mismatch_count), 0); return attempts ? mismatches / attempts : null; })(),
    averageJointPackingMeanAbsoluteUtilizationDelta: (() => { const values = generations.map((row) => Number(row.jointPackingMeanAbsoluteUtilizationDelta ?? row.joint_packing_mean_delta)).filter(Number.isFinite); return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; })(),
    noOpRepairRate: generations.length ? generations.filter((row) => row.noOpRepair || row.no_op_repair).length / generations.length : 0,
    calibration: buildSocialTemplateCalibrationReport(list),
  };
}
